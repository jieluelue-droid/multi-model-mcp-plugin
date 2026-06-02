import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadConfig } from "../config.js";
import { listAllModels } from "../settings.js";
import { getActiveProcessCount } from "../subprocess.js";

export function registerGetStatus(server: McpServer): void {
  server.tool(
    "get_status",
    "Get current plugin status: routing mode, enabled state, available models, and active subprocess count.",
    {},
    async () => {
      try {
        const config = loadConfig();
        const models = listAllModels();
        const activeProcs = getActiveProcessCount();

        const lines: string[] = [
          `**Plugin Status**`,
          `- Enabled: ${config.enabled}`,
          `- Routing mode: ${config.mode}`,
          `- Require confirmation: ${config.require_confirmation}`,
          `- Active subagents: ${activeProcs}`,
          `- Configured models: ${models.length}`,
        ];

        if (models.length > 0) {
          lines.push("", "**Models:**");
          for (const m of models) {
            lines.push(`  - ${m.name} (${m.model}) — ${m.description}`);
          }
        }

        if (Object.keys(config.routing_rules.task_types).length > 0) {
          lines.push("", "**Routing rules:**");
          for (const [pattern, model] of Object.entries(config.routing_rules.task_types)) {
            lines.push(`  - "${pattern}" → ${model}`);
          }
        }

        return {
          content: [{ type: "text", text: lines.join("\n") }],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Error: ${msg}` }],
          isError: true,
        };
      }
    },
  );
}
