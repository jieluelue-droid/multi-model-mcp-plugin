# Multi-Model MCP Plugin 设计文档

## 技术栈

- **语言**: TypeScript
- **框架**: `@modelcontextprotocol/sdk`（官方 MCP Server SDK）
- **运行时**: Node.js
- **子进程**: `child_process.spawn` 管理 `claude -p` 进程
- **配置**: JSON（模型配置文件即 settings.json，零转换）

## 概述

基于 MCP Server 实现的 Claude Code 多模型路由插件。核心机制：**MCP server 在后台启动「使用临时 settings.json 的 Claude Code 客户端」作为 subagent**——通过临时 settings 把底层模型 endpoint 换成 DeepSeek / Gemini 等外部厂商，从而复用 Claude Code 现成的工具、权限、agent loop，同时让任务真正跑在不同厂商的模型上。

## 核心机制：子 Claude 隔离启动

不自己重造工具和 agent loop，而是把 Claude Code 本身当作「带全套工具能力的 agent 外壳」，每个外部厂商对应一份临时 settings.json：

```
MCP server
  └── subprocess: claude -p "<task>" --settings /tmp/<model>-settings.json
        外壳 = Claude Code（工具/权限/agent loop 现成）
        大脑 = 临时 settings 指定的 endpoint（DeepSeek / Gemini / Claude 型号）
```

### 厂商接入方式

| 模型 | 协议 | 接入方式 |
|------|------|---------|
| DeepSeek 等国内厂商 | 兼容 Anthropic 协议 | 临时 settings 直接把 `ANTHROPIC_BASE_URL` 指向厂商，无需转换层 |
| Claude Opus / Sonnet / Haiku | 原生 | `--model` 指定型号即可，用于型号分工（主 Opus 规划、子 Sonnet/Haiku 干活省钱） |
| Gemini / Codex 等 | 不兼容 | 当前暂不支持，未来通过 OpenCode 客户端接入 |

### 模型配置文件（即 settings.json）

每个模型一个 JSON 文件，既是配置元数据，也是 `claude -p --settings` 直接使用的运行时 settings。自定义元数据用 `_` 前缀，Claude Code 自动忽略未知字段。

```jsonc
// ~/.multi-model/models/my-deepseek.json
{
  // 自定义元数据（_ 前缀，Claude Code 忽略）
  "_name": "my-deepseek",
  "_model": "deepseek-coder",
  "_description": "擅长代码生成、算法实现、代码重构，成本低速度快",
  "_added_at": "2026-06-01T12:00:00Z",

  // 以下是标准 settings.json 字段，直接传给 claude -p --settings
  "env": {
    "ANTHROPIC_BASE_URL": "https://api.deepseek.com",
    "ANTHROPIC_AUTH_TOKEN": "<deepseek-key>",
    "ANTHROPIC_MODEL": "deepseek-coder"
  },
  "mcpServers": {},          // 不挂本插件，切断递归自调用
  "permissions": {           // headless 无审批 UI，必须预先约束
    "allow": ["Read", "Edit", "Bash(npm test:*)"],
    "deny":  ["Bash(rm:*)", "Bash(git push:*)"]
  }
}
```

> **运行时行为**（实测确认）：`ANTHROPIC_MODEL`（模型名称）仅在启动时读取一次；`ANTHROPIC_BASE_URL` 和 `ANTHROPIC_AUTH_TOKEN` 每次请求时动态读取。因此 **每次 `delegate_task` 必须复制一份 settings 副本**，避免运行期间源文件被修改影响正在执行的子进程，也避免并发任务互相干扰。

### Settings 副本机制

```
~/.multi-model/models/my-deepseek.json    ← 源文件（模板，通过 add_model 管理）
/tmp/multi-model/<uuid>.json              ← 运行时副本，进程退出后清理
```

`delegate_task` 流程：
1. 读取源文件 `~/.multi-model/models/<name>.json`
2. 如需动态调整（permissions、cwd 等），在内存中修改
3. 写入副本 `/tmp/multi-model/<uuid>.json`
4. `claude -p --settings /tmp/multi-model/<uuid>.json "task"`
5. 进程结束后清理副本

### 隔离保证（不影响用户客户端）

子 Claude 是独立 OS 进程，与用户交互式客户端无共享状态，三层隔离：

| 维度 | 隔离方式 |
|------|---------|
| 配置/权限 | `--settings` 指向临时文件，不读用户 `~/.claude/settings.json` |
| 会话历史/缓存 | 独立 config 目录（按当前版本支持的 env/flag 覆盖） |
| 文件改动 | 指定 `cwd`，建议用 git worktree，改动可控可回滚 |
| 加载的 MCP | 临时 settings 里 `mcpServers: {}`，不挂本插件 → 切断递归 |
| 进程 | 各自独立进程，互不阻塞 |

## 新增模型指令

用户可通过 MCP tool `add_model` 动态添加模型，添加时需提供：

| 字段 | 必填 | 说明 |
|------|------|------|
| `name` | ✅ | 模型标识，如 `my-deepseek`、`work-qwen` |
| `model` | ✅ | 模型名称，即 API 调用时使用的模型 ID，如 `deepseek-coder`、`qwen-coder` |
| `api_base_url` | ✅ | 模型请求地址，如 `https://api.deepseek.com` |
| `api_key` | ✅ | API Key，加密存储于本地配置 |
| `description` | ✅ | 描述什么情况下启用此 subagent，用于路由决策和用户参考 |

```jsonc
// 示例：添加 DeepSeek 模型
add_model({
  name: "my-deepseek",
  model: "deepseek-coder",
  api_base_url: "https://api.deepseek.com",
  api_key: "sk-xxx",
  description: "擅长代码生成、算法实现、代码重构，成本低速度快，适合批量编码任务"
})
```

添加后直接写入 `~/.multi-model/models/<name>.json`，该文件即 settings.json，可直接传给 `claude -p --settings`，无需转换。

### 不兼容 Anthropic 协议的模型（未来计划）

对于 Gemini、Codex 等不兼容 Anthropic 协议的模型，当前暂不支持。**未来计划**：通过启动 OpenCode 等兼容多协议的客户端替代 Claude Code 作为 subagent 外壳，从而原生支持更多协议。此功能暂不实现，但架构上预留扩展点：

```
当前：  MCP server → claude -p --settings <临时配置>     （仅支持 Anthropic 协议）
未来：  MCP server → opencode -p --config <临时配置>     （支持 OpenAI/Gemini/等协议）
```

MCP server 的子进程管理层将抽象为统一接口，支持切换不同的 agent 外壳。

## 多模型能力

| 模型 | 擅长领域 | 特点 |
|------|---------|------|
| DeepSeek Coder | 代码生成、算法、重构 | 低成本、速度快 |
| Claude Opus | 架构设计、复杂推理、代码审查 | 推理能力强（通常即主 agent） |
| Claude Sonnet / Haiku | 通用编码、批量子任务 | 型号降级省钱 |

## 三层路由策略

1. **用户显式指定** — `@deepseek 写个快排` 直接路由
2. **规则匹配（零成本）** — 基于任务类型 / 关键词自动匹配
3. **主 agent 智能路由（兜底）** — Claude 分析任务后选择最佳模型

## 路由模式开关

- **auto** — 自动选择最佳模型
- **manual** — 只在用户 @指定模型 时才调用
- **off** — 禁用所有外部模型

## 用户确认机制

- 首次使用时询问用户选择路由模式
- 可配置 `require_confirmation: true`，每次启动子 agent 前征求同意
- 通过 tool description 约定行为规范，让 Claude 自动判断何时该问用户

## 技术架构

```
用户 → Claude (主 agent)
         ├── MCP tool: delegate_task(task, model?)  → 统一入口，自动/手动路由
         ├── MCP tool: add_model(name, url, key, desc) → 新增模型
         ├── MCP tool: list_models                   → 列出可用模型
         ├── MCP tool: set_routing_mode(mode)        → 模式切换
         └── MCP tool: get_status                    → 查看配置/统计
                          │
                          └── subprocess: claude -p --settings <临时配置>
```

## 配置文件结构

```
~/.multi-model/
├── config.json                    # 全局配置
└── models/                        # 每个模型一个 JSON 文件
    ├── my-deepseek.json           # 即 settings.json，可直接传给 --settings
    └── work-qwen.json
```

```jsonc
// ~/.multi-model/config.json —— 全局配置
{
  "enabled": true,
  "mode": "auto",                    // auto | manual | off
  "require_confirmation": false,
  "routing_rules": {
    "task_types": {
      "code-generation": "my-deepseek",
      "code-review": "claude-opus",
      "architecture-design": "claude-opus",
      "bug-fix": "claude-sonnet"
    }
  }
}
```

模型配置见上方「模型配置文件」章节，每个文件既是元数据也是运行时 settings。

## 注意事项

### 技术限制

- 子 Claude 是独立进程，需 server 管理超时、并发上限、僵尸进程回收、日志收集
- 上下文不会自动传给子 Claude，需手动决定把哪些文件/背景塞进 `-p` 的 prompt 或 cwd
- MCP tool 返回结果有大小限制，子 Claude 的长输出需分片或写文件落盘

### 成本控制

- 规则路由优先（免费、快、可预测），LLM 路由兜底
- 只把相关文件/片段放进子任务，不传整个对话历史
- 简单任务用 DeepSeek / Haiku，复杂任务才用 Opus / Gemini
- 记录每次子 Claude 调用的 token 消耗与厂商，方便用户监控

### 安全性

- API Key 加密存储于本地配置文件，明文不落盘，运行时解密
- **headless 子 Claude 无交互审批 UI**，临时 settings 的 `permissions.allow/deny` 必须认真配置（默认拒绝 `rm`、`git push`、写敏感目录等）
- 敏感信息默认拦截：内置 `.env`、`*credentials*`、密钥文件等默认不传给外部厂商，再叠加用户白名单
- 所有外部调用走 HTTPS

### 用户体验

- 暴露 routing log，让用户看到「为什么选了这个模型 / 起了哪个子 Claude」
- 提供 fallback：子任务结果不佳时换模型重试
- 用户可随时说「关闭路由」禁用插件

## 实现路径

1. **Phase 1** — 基础 MCP server + 子 Claude 隔离启动（subprocess + 临时 settings 模板 + delegate_task + add_model）
2. **Phase 2** — 规则路由 + 配置文件完整读写
3. **Phase 3** — 智能路由 + 确认机制 + 权限/敏感信息防护
4. **Phase 4** — 成本统计 + fallback 重试
5. **未来** — 支持 OpenCode 等多协议客户端作为 subagent 外壳，原生接入 Gemini/Codex 等不兼容 Anthropic 协议的模型
