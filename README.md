# Multi-Model MCP Plugin

Claude Code plugin，让主 agent 能将任务委派给使用不同底层模型（DeepSeek、Qwen 等）的子 Claude Code 进程。

## 工作原理

通过 `claude -p --settings <path>` 启动子 Claude Code 进程，临时 settings 文件把 API endpoint 切换到外部厂商。每个模型一个 JSON 配置文件，既是元数据也是运行时 settings，零转换。

```
用户 → Claude (主 agent)
         ├── /add-model    → 添加模型（引导式交互）
         ├── /list-models  → 查看可用模型
         ├── /delegate     → 委托任务给子模型
         ├── set_routing_mode(mode)  → 切换路由模式（MCP 工具）
         └── get_status              → 查看状态（MCP 工具）
```

## 安装

> ⚠️ 本项目**未发布到官方 marketplace**，需本地安装。

**第一步：构建**

```bash
cd /path/to/multi-model-mcp-plugin
npm install
npm run build
```

**第二步：安装为本地 plugin**

在 Claude Code 中运行：

```
/plugin install /path/to/multi-model-mcp-plugin
```

Windows 示例：

```
/plugin install C:/Users/yang/Desktop/multi-model-mcp-plugin
```

安装后重启 Claude Code 即可生效，无需手动修改任何配置文件。

## 使用

### 添加模型

```
/add-model
```

按提示输入模型名、API 端点、API Key、描述，plugin 自动加密存储。

### 查看可用模型

```
/list-models
```

### 委托任务

```
/delegate
```

或直接描述任务，Claude 会根据路由规则自动选择模型。

### 路由模式 / 状态查询

通过 MCP 工具调用：

```
set_routing_mode(mode: "auto")    # 自动根据规则选择模型
set_routing_mode(mode: "manual")  # 仅在用户指定时路由
set_routing_mode(mode: "off")     # 禁用外部模型

get_status                        # 查看当前状态
```

## 配置文件

- 全局配置：`~/.multi-model/config.json`
- 模型配置：`~/.multi-model/models/<name>.json`

## 要求

- Node.js >= 18
- Claude Code CLI（`claude` 命令可用）
- 外部模型 API 兼容 Anthropic 协议

## 安全

- API Key 使用 AES-256-CBC 加密存储，密钥从本机特征派生
- 子 Claude 进程默认禁止 `rm`、`git push` 等危险操作
- 子进程与用户交互式客户端完全隔离（独立进程、独立配置）
