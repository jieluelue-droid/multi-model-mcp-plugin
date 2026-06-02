import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { route } from "../router.js";
import { createSettingsCopy, cleanupSettingsCopy, listAllModels } from "../settings.js";
import { spawnClaude } from "../subprocess.js";

export function registerDelegateTask(server: McpServer): void {
  // Build dynamic description with available models
  const getModelsHint = () => {
    const models = listAllModels();
    if (models.length === 0) return "";
    return `\n\nCurrently available models: ${models.map((m) => `"${m.name}" (${m.model} — ${m.description})`).join(", ")}`;
  };

  server.tool(
    "delegate_task",
    `Delegate a task to a subagent running on a different model. The subagent is a Claude Code process using the specified model's settings (API endpoint, model, permissions). If no model is specified, routing rules or the main agent will decide.${getModelsHint()}`,
    {
      task: z.string().describe("The task description to send to the subagent"),
      model: z.string().optional().describe("Model identifier (from add_model). If omitted, auto-routed based on config."),
      cwd: z.string().optional().describe("Working directory for the subagent process"),
      timeout: z.number().optional().describe("Timeout in seconds (default: 300)"),
    },
    async ({ task, model, cwd, timeout }) => {
      // Route to determine which model to use
      const routing = route(task, model);

      if (!routing.model) {
        return {
          content: [
            {
              type: "text",
              text: `No model selected. Reason: ${routing.reason}\n\nUse list_models to see available models, or specify one explicitly.`,
            },
          ],
          isError: true,
        };
      }

      let settingsCopyPath: string | undefined;

      try {
        // Create settings copy for this invocation
        settingsCopyPath = createSettingsCopy(routing.model);

        // Spawn subagent
        const result = await spawnClaude(task, settingsCopyPath, {
          cwd,
          timeout: timeout ? timeout * 1000 : undefined,
        });

        // Build response
        const parts: string[] = [];
        parts.push(`[Model: ${routing.model} | Reason: ${routing.reason} | Duration: ${(result.duration / 1000).toFixed(1)}s]`);

        if (result.timedOut) {
          parts.push("\n⚠️ Task timed out and was terminated.");
        }

        if (result.exitCode !== 0 && result.exitCode !== null) {
          parts.push(`\n⚠️ Process exited with code ${result.exitCode}`);
        }

        parts.push(`\n\n${result.stdout}`);

        if (result.outputFile) {
          parts.push(`\n\n📎 Full output written to: ${result.outputFile}`);
        }

        return {
          content: [{ type: "text", text: parts.join("") }],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Error delegating task to ${routing.model}: ${msg}` }],
          isError: true,
        };
      } finally {
        // Always cleanup settings copy
        if (settingsCopyPath) {
          cleanupSettingsCopy(settingsCopyPath);
        }
      }
    },
  );
}
