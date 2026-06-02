import { loadConfig } from "./config.js";
import { listModelNames } from "./settings.js";

export interface RouteResult {
  model: string | null;
  reason: string;
}

/**
 * Determine which model to use for a task.
 *
 * Priority:
 * 1. Explicit model specified by user → use directly
 * 2. mode=off → no routing
 * 3. mode=manual + no explicit → no routing (user must @model)
 * 4. mode=auto → match routing_rules.task_types, fallback to null (main agent decides)
 */
export function route(task: string, explicitModel?: string): RouteResult {
  const config = loadConfig();

  // 1. Explicit model always wins
  if (explicitModel) {
    const available = listModelNames();
    if (!available.includes(explicitModel)) {
      return {
        model: null,
        reason: `Model "${explicitModel}" not found. Available: ${available.join(", ") || "none"}`,
      };
    }
    return { model: explicitModel, reason: "User explicitly specified" };
  }

  // 2. Disabled
  if (!config.enabled) {
    return { model: null, reason: "Plugin is disabled" };
  }

  // 3. Mode check
  if (config.mode === "off") {
    return { model: null, reason: "Routing mode is off" };
  }

  if (config.mode === "manual") {
    return { model: null, reason: "Routing mode is manual — specify a model with @model" };
  }

  // 4. Auto mode — try task_types rules
  const taskLower = task.toLowerCase();
  for (const [pattern, modelName] of Object.entries(config.routing_rules.task_types)) {
    if (taskLower.includes(pattern.toLowerCase())) {
      return { model: modelName, reason: `Matched routing rule: "${pattern}" → ${modelName}` };
    }
  }

  // No rule matched — main agent will use tool description to decide
  return { model: null, reason: "No routing rule matched; main agent should select model" };
}
