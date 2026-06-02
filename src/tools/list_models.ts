import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { listAllModels } from "../settings.js";

export function registerListModels(server: McpServer): void {
  server.tool(
    "list_models",
    "List all available models that have been added via add_model. Shows name, model ID, and description for each.",
    {},
    async () => {
      const models = listAllModels();

      if (models.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: "No models configured yet. Use add_model to add one.",
            },
          ],
        };
      }

      const lines = models.map(
        (m) => `- **${m.name}** (model: ${m.model}) — ${m.description}`,
      );

      return {
        content: [
          {
            type: "text",
            text: `Available models:\n${lines.join("\n")}`,
          },
        ],
      };
    },
  );
}
