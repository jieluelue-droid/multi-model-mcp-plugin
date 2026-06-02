import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { loadConfig, saveConfig } from "../config.js";

export function registerSetRoutingMode(server: McpServer): void {
  server.tool(
    "set_routing_mode",
    "Change the routing mode. 'auto' = automatically select model based on rules, 'manual' = only route when user specifies a model, 'off' = disable all external model routing.",
    {
      mode: z.enum(["auto", "manual", "off"]).describe("Routing mode: auto, manual, or off"),
    },
    async ({ mode }) => {
      try {
        const config = loadConfig();
        config.mode = mode;
        saveConfig(config);

        return {
          content: [
            {
              type: "text",
              text: `Routing mode set to "${mode}".\n- auto: automatically select model based on rules and task type\n- manual: only route when user specifies a model\n- off: disable all external model routing`,
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
