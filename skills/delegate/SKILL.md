---
description: Delegate a task to a subagent running on a different model. Use when the user wants to offload work to DeepSeek, Qwen, or another registered model.
---

Delegate the task to a subagent by calling the `delegate_task` MCP tool:

- `task`: full task description to send to the subagent
- `model`: (optional) model name from `list_models`; omit to use auto-routing
- `cwd`: (optional) working directory for the subagent
- `timeout`: (optional) seconds before timeout, default 300

If no model is specified and routing mode is `manual`, ask the user which model to use.
