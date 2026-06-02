# Plan: Multi-Model MCP Plugin

## Context

用户需要一个 MCP Server 插件，让 Claude Code 主 agent 能将任务委派给使用不同底层模型的子 Claude Code 进程。核心机制是通过临时 settings.json 把 API endpoint 切换到不同厂商（DeepSeek 等国内厂商兼容 Anthropic 协议，可直连）。项目放在 `C:\Users\yang\Desktop\multi-model-mcp-plugin\`。

技术栈：TypeScript + `@modelcontextprotocol/sdk` + Node.js stdio transport。

## 文件结构

```
C:\Users\yang\Desktop\multi-model-mcp-plugin\
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts              # 入口：创建 McpServer，注册 tools，启动 stdio transport
│   ├── tools/
│   │   ├── delegate_task.ts  # 核心工具：启动子 Claude，收集结果
│   │   ├── add_model.ts     # 新增模型：写入 settings JSON 文件
│   │   ├── list_models.ts   # 列出可用模型
│   │   ├── set_routing_mode.ts  # 切换路由模式
│   │   └── get_status.ts    # 查看配置/统计
│   ├── subprocess.ts         # 子进程管理（spawn/超时/回收/日志收集）
│   ├── settings.ts           # settings 副本生成（源文件复制 + 动态修改 + 清理）
│   ├── router.ts             # 路由逻辑（规则匹配）
│   └── config.ts             # 全局配置读写（~/.multi-model/config.json）
├── .gitignore
└── README.md
```

## Tasks

### Task 1: 项目初始化 ✅

- **Action**: 创建项目目录，初始化 package.json / tsconfig.json，安装依赖
- **依赖**: `@modelcontextprotocol/server`, `zod`
- **package.json 关键字段**: `"type": "module"`, `"bin": { "multi-model-mcp": "./build/index.js" }`
- **Validate**: `npm run build` 无报错

### Task 2: src/index.ts — MCP Server 入口 ✅

- **Action**: 创建 McpServer 实例，注册所有 tools，启动 StdioServerTransport
- **Mirror**: MCP SDK 官方模式：`new McpServer({ name, version })` → `registerTool` → `StdioServerTransport` → `server.connect(transport)`
- **Validate**: `npm run build && echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}' | node build/index.js` 有 JSON-RPC 响应

### Task 3: src/config.ts — 全局配置读写 ✅

- **Action**: 实现 `loadConfig()` / `saveConfig()` / `initConfig()`
- **配置路径**: `~/.multi-model/config.json`
- **默认配置**: `{ enabled: true, mode: "manual", require_confirmation: false, routing_rules: { task_types: {} } }`
- **首次运行自动创建目录和默认配置**
- **Validate**: 手动调用 `loadConfig()` 返回默认值

### Task 4: src/settings.ts — Settings 副本机制 ✅

- **Action**:
  - `createSettingsCopy(modelName: string)` → 读取 `~/.multi-model/models/<name>.json`，写入 `os.tmpdir()/multi-model/<uuid>.json`，返回副本路径
  - `cleanupSettingsCopy(path: string)` → 删除副本文件
  - `addModelSettings(name, model, apiBaseUrl, apiKey, description)` → 写入新的模型 settings JSON
- **文件格式**: 标准 settings.json + `_` 前缀元数据字段
- **Validate**: `addModelSettings` 后文件存在且内容正确；`createSettingsCopy` 后副本存在

### Task 5: src/subprocess.ts — 子进程管理 ✅

- **Action**: `spawnClaude(task: string, settingsPath: string, options: { cwd?, timeout? })` → 返回 `{ stdout, stderr, exitCode, duration }`
  - 使用 `child_process.spawn('claude', ['-p', task, '--settings', settingsPath], { cwd })`
  - 超时默认 5 分钟，超时后 `kill('SIGTERM')`
  - 流式收集 stdout，限制最大 100KB，超出写文件落盘
  - 记录进程 pid，用于日志和清理
  - 提供 `cleanupStaleProcesses()` 清理僵尸进程
- **Validate**: 用一个简单 task 测试子进程能正常启动、收集输出、超时 kill

### Task 6: src/router.ts — 路由逻辑 ✅

- **Action**: `route(task: string, explicitModel?: string)` → 返回模型 name
  - 显式指定 → 直接返回
  - mode=off → 返回 null
  - mode=manual + 无显式指定 → 返回 null
  - mode=auto → 先匹配 routing_rules.task_types，无匹配返回 null（由主 agent 兜底）
- **Validate**: 不同参数组合返回预期结果

### Task 7: src/tools/add_model.ts — 新增模型工具 ✅

- **Action**: 注册 `add_model` tool，参数：`name`, `model`, `api_base_url`, `api_key`, `description`
  - 调用 `settings.addModelSettings()` 写入模型文件
  - 校验：name 不重复、api_base_url 格式合法
  - API Key 写入时加密存储（用 Node.js `crypto` 模块，密钥从本机特征派生）
- **Validate**: 调用 add_model 后 `~/.multi-model/models/<name>.json` 存在

### Task 8: src/tools/delegate_task.ts — 核心委托工具 ✅

- **Action**: 注册 `delegate_task` tool，参数：`task`, `model?`, `cwd?`, `timeout?`
  - 调用 `router.route()` 确定模型
  - 调用 `settings.createSettingsCopy()` 创建副本
  - 调用 `subprocess.spawnClaude()` 启动子进程
  - 收集结果，调用 `settings.cleanupSettingsCopy()` 清理
  - 返回 `{ model, output, output_file?, duration }`
  - mode=auto 且无规则匹配时，让主 agent 通过 tool description 理解各模型能力自行选择
- **Validate**: 端到端——通过 MCP 调用 delegate_task，子 Claude 完成任务并返回结果

### Task 9: src/tools/list_models.ts — 列出模型 ✅

- **Action**: 读取 `~/.multi-model/models/` 目录，返回所有模型的 name / model / description
- **Validate**: 返回已添加的模型列表

### Task 10: src/tools/set_routing_mode.ts — 路由模式切换 ✅

- **Action**: 修改 `config.json` 的 `mode` 字段，校验值为 auto / manual / off
- **Validate**: 切换后 `get_status` 返回新值

### Task 11: src/tools/get_status.ts — 状态查询 ✅

- **Action**: 返回当前配置（mode、enabled）、可用模型列表、最近调用统计
- **Validate**: 返回正确状态

### Task 12: 集成测试 + README ✅

- **Action**: 在 Claude Code 的 settings.json 中配置 MCP server，测试完整流程
  - 添加模型 → 列出模型 → 委托任务 → 查看状态
- **README**: 安装说明、配置方法、使用示例
- **Validate**: 完整流程跑通

## 验证

```bash
# 构建
cd C:\Users\yang\Desktop\multi-model-mcp-plugin && npm install && npm run build

# 在 Claude Code settings.json 中添加 MCP server 配置
# 测试 add_model → list_models → delegate_task → get_status 完整流程
```

## 风险

| 风险 | 缓解 |
|------|------|
| `claude -p --settings` 标志行为与预期不符 | 手动验证；如不支持，改用 env 前缀方式启动子进程 |
| 子进程输出超出 MCP tool result 限制 | 实现 100KB 上限 + 文件落盘，返回文件路径 |
| API Key 加密方案强度 | 用本机特征派生密钥，满足本地存储安全需求即可 |
| Windows 上 `/tmp` 路径不存在 | 使用 `os.tmpdir()` 获取系统临时目录 |

## 实现顺序

按 Task 1 → 12 顺序执行，每个 Task 完成后验证再进入下一个。
