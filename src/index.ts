#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { initConfig, loadConfig } from "./config.js";
import { cleanupStaleCopies } from "./settings.js";
import { killAllProcesses } from "./subprocess.js";
import { registerAddModel } from "./tools/add_model.js";
import { registerDelegateTask } from "./tools/delegate_task.js";
import { registerListModels } from "./tools/list_models.js";
import { registerSetRoutingMode } from "./tools/set_routing_mode.js";
import { registerGetStatus } from "./tools/get_status.js";

async function main() {
  // Initialize config directory and files
  initConfig();

  // Cleanup old temp files from previous sessions
  cleanupStaleCopies();

  const config = loadConfig();

  const server = new McpServer({
    name: "multi-model-mcp-plugin",
    version: "0.1.0",
  });

  // Register all tools
  registerAddModel(server);
  registerDelegateTask(server);
  registerListModels(server);
  registerSetRoutingMode(server);
  registerGetStatus(server);

  // Start server
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Graceful shutdown
  const shutdown = () => {
    killAllProcesses();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
