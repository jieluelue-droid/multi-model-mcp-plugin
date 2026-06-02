import { spawn, ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { MAX_OUTPUT_SIZE } from "./settings.js";

export interface SpawnResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  duration: number;
  outputFile?: string;
  timedOut: boolean;
}

const TMP_DIR = path.join(os.tmpdir(), "multi-model");

// Track active processes for cleanup
const activeProcesses = new Map<number, ChildProcess>();

export function getActiveProcessCount(): number {
  return activeProcesses.size;
}

export interface SpawnOptions {
  cwd?: string;
  timeout?: number; // ms, default 5 minutes
}

/**
 * Spawn a Claude Code subprocess with the given settings file.
 * Collects stdout (capped at MAX_OUTPUT_SIZE), writes overflow to a temp file.
 */
export function spawnClaude(
  task: string,
  settingsPath: string,
  options: SpawnOptions = {},
): Promise<SpawnResult> {
  const startTime = Date.now();
  const timeout = options.timeout ?? 5 * 60 * 1000;

  return new Promise((resolve) => {
    const args = ["-p", task, "--settings", settingsPath];
    if (options.cwd) {
      args.push("--cwd", options.cwd);
    }

    // On Windows, claude is a .cmd shim — must use shell:true or spawn the .cmd directly.
    // We use shell:true but quote the task argument to prevent space-splitting.
    const isWin = process.platform === "win32";
    const shellOpt = isWin ? true : false;

    const proc = spawn("claude", args, {
      cwd: options.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      shell: shellOpt,
      // On Windows with shell, Node auto-quotes args with spaces —
      // but we also quote explicitly for safety.
      windowsVerbatimArguments: !isWin,
    });

    let stdout = "";
    let stderr = "";
    let outputFile: string | undefined;
    let overflowed = false;
    let timedOut = false;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

    if (proc.pid) {
      activeProcesses.set(proc.pid, proc);
    }

    proc.stdout?.on("data", (data: Buffer) => {
      if (overflowed) {
        // Already overflowed, append to file
        if (outputFile) {
          fs.appendFileSync(outputFile, data);
        }
        return;
      }

      stdout += data.toString();

      if (stdout.length > MAX_OUTPUT_SIZE) {
        overflowed = true;
        // Write accumulated stdout to file, keep first chunk in result
        if (!fs.existsSync(TMP_DIR)) {
          fs.mkdirSync(TMP_DIR, { recursive: true });
        }
        outputFile = path.join(TMP_DIR, `output-${Date.now()}.txt`);
        fs.writeFileSync(outputFile, stdout);
        stdout = `[Output exceeded ${MAX_OUTPUT_SIZE} bytes. Full output written to: ${outputFile}]`;
      }
    });

    proc.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString();
      // Keep stderr shorter — only last 10KB
      if (stderr.length > 10 * 1024) {
        stderr = stderr.slice(-10 * 1024);
      }
    });

    proc.on("close", (code) => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      if (proc.pid) {
        activeProcesses.delete(proc.pid);
      }
      resolve({
        stdout,
        stderr,
        exitCode: code,
        duration: Date.now() - startTime,
        outputFile,
        timedOut,
      });
    });

    proc.on("error", (err) => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      if (proc.pid) {
        activeProcesses.delete(proc.pid);
      }
      resolve({
        stdout: "",
        stderr: err.message,
        exitCode: -1,
        duration: Date.now() - startTime,
        outputFile: undefined,
        timedOut: false,
      });
    });

    // Timeout handling
    timeoutHandle = setTimeout(() => {
      timedOut = true;
      proc.kill("SIGTERM");
      // Give it 5 seconds to exit gracefully, then force kill
      setTimeout(() => {
        try {
          proc.kill("SIGKILL");
        } catch {
          // Process may have already exited
        }
      }, 5000);
    }, timeout);
  });
}

/**
 * Kill all active subprocesses. Called during server shutdown.
 */
export function killAllProcesses(): void {
  for (const [pid, proc] of activeProcesses) {
    try {
      proc.kill("SIGTERM");
    } catch {
      // Best-effort
    }
    activeProcesses.delete(pid);
  }
}
