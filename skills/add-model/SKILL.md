---
description: Add a new model for task delegation. Use when the user wants to register a model like DeepSeek or Qwen with its API endpoint and key.
disable-model-invocation: true
---

Add a model for multi-model routing by calling the `add_model` MCP tool with the provided details:

- `name`: unique identifier (e.g. `my-deepseek`)
- `model`: model ID used in API calls (e.g. `deepseek-chat`)
- `api_base_url`: Anthropic-compatible endpoint (e.g. `https://api.deepseek.com/anthropic`)
- `api_key`: API key (will be encrypted and stored locally)
- `description`: when to use this model — used for auto-routing decisions

Collect any missing fields from the user before calling the tool.
