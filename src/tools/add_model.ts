import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { addModelSettings } from "../settings.js";

export function registerAddModel(server: McpServer): void {
  server.tool(
    "add_model",
    "Add a new model that can be used as a subagent. The model's API must be compatible with the Anthropic protocol (e.g. DeepSeek and other Chinese providers). After adding, the model can be used with delegate_task.",
    {
      name: z.string().describe("Unique identifier for this model, e.g. 'my-deepseek', 'work-qwen'"),
      model: z.string().describe("Model name used in API calls, e.g. 'deepseek-coder', 'qwen-coder'"),
      api_base_url: z.string().describe("API endpoint URL, e.g. 'https://api.deepseek.com'"),
      api_key: z.string().describe("API key for authentication (will be encrypted and stored locally)"),
      description: z.string().describe("When to use this subagent — helps routing decisions, e.g. 'Good at code generation, algorithms, refactoring'"),
    },
    async ({ name, model, api_base_url, api_key, description }) => {
      try {
        // Basic URL validation
        const url = new URL(api_base_url);
        if (!["http:", "https:"].includes(url.protocol)) {
          return {
            content: [{ type: "text", text: `Error: api_base_url must use http or https protocol` }],
            isError: true,
          };
        }

        addModelSettings(name, model, api_base_url, api_key, description);

        return {
          content: [
            {
              type: "text",
              text: `Model "${name}" added successfully.\n- Model: ${model}\n- API: ${api_base_url}\n- Description: ${description}\n\nYou can now use it with: delegate_task(task="${name}")`,
            },
          ],
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
