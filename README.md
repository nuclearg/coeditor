# CoEditor

> AI 辅助写作工具 —— 人类是主笔，AI 是编辑。

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue.svg)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-18-blue.svg)](https://react.dev/)
[![Taro](https://img.shields.io/badge/Taro-4-green.svg)](https://taro-docs.jd.com/)
[![Hono](https://img.shields.io/badge/Hono-4-orange.svg)](https://hono.dev/)
[![pnpm](https://img.shields.io/badge/pnpm-workspace-orange.svg)](https://pnpm.io/)

CoEditor 面向**严肃文学创作**和**学术写作**，让 AI 像一位资深编辑一样辅助作者：审阅文稿、提出建议、给出修改示例片段——但绝不替代作者。所有内容由作者自己掌控。

一套代码同时产出 **PC/H5 网页** 与 **微信小程序**。

## 特性

- **多粒度审阅** — 段落 / 章节 / 全文 / 附件（大纲、世界观、人设等）多种审阅粒度，AI 面板随上下文自动切换
- **上下文感知** — 审阅上下文按文档模板自动拼入全部附件（大纲、世界观、人设等）；段落审阅附带前面段落；全文审阅包含所有内容
- **文档模板** — 文档归属于模板（小说/公文等），模板定义附件种类；每个附件都有版本管理，均可单独提交 AI 审阅
- **版本管理** — 每次手动保存生成新的 Draft，Tab 切换任意历史版本，可随时回退
- **Thinking 过程展示** — 模型推理过程灰色折叠显示，审阅结论可追溯
- **审阅风格** — 严厉 / 温和 / 鼓励三种编辑风格，写作途中一键切换
- **流式输出** — SSE 实时流式渲染，支持中止 / 重试 / 多候选答案
- **响应式** — PC 三栏可拖拽布局，移动端竖排滚动 + 侧滑目录
- **夜间模式** — 跟随系统，可手动切换
- **自带 AI 配置** — 兼容任何 OpenAI 协议端点（DeepSeek / OpenAI / Ollama / 本地网关），密钥存储在本机服务端

## 跨端支持

| 平台 | 说明 |
|------|------|
| H5 / PC | `pnpm dev:client`，浏览器直接使用 |
| 微信小程序 | `pnpm -C packages/client dev:weapp` 后用微信开发者工具打开 `project.config.json` |

同一份 React 代码通过 [Taro 4](https://taro-docs.jd.com/) 编译双端，业务逻辑（状态管理、审阅上下文组装、API 层、插件机制）完全共享。

## 界面布局

```
┌──────────┬─────────────────────┬──────────┐
│ 文章标题  │  全文/附件/章节/段落   │ 审阅区    │
│ ├─ 大纲   │                     │ AI 对话   │
│ ├─ 全文   │  # 章节标题          │ Markdown  │
│ └─ 章节   │  段落内容...         │ 流式渲染   │
│    └─ 段落 │                     │ 可重试    │
│           │  [保存] [提交AI审阅]   │          │
└──────────┴─────────────────────┴──────────┘
```

## 技术栈

- **前端**：React 18 · Taro 4（H5 + 微信小程序）· Zustand · marked / react-markdown
- **后端**：Hono · Zod v4 · SSE 流式 · 纯文件系统存储（无数据库，目录树即索引）
- **质量**：TypeScript 全栈 · Vitest 集成测试 · ESLint

## 快速开始

环境要求：Node.js ≥ 20.11（服务端使用 `import.meta.dirname`）、[pnpm](https://pnpm.io/)

```bash
# 安装依赖
pnpm install

# 开发（前后端并行）
pnpm dev

# 或分别启动
pnpm dev:server   # API 服务 http://localhost:3001
pnpm dev:client   # H5 前端 http://localhost:5173
```

打开 `http://localhost:5173`，点击右上角齿轮 → **API 配置**，填入你的 API Key 即可开始使用。

### 构建

```bash
pnpm --filter @coeditor/client build:h5      # H5 产物 → packages/client/dist-h5
pnpm --filter @coeditor/client build:weapp   # 小程序产物 → packages/client/dist-weapp
pnpm --filter @coeditor/client build         # 同上（默认 H5）
```

编译选项：

| 环境变量 | 说明 |
|----------|------|
| `API_BASE_URL` | API 后端地址（默认留空，走同域相对路径 `/api/*`）。跨域部署时指定，如 `API_BASE_URL=https://api.example.com pnpm build:h5` |
| `PLUGIN_REGISTRY_PATH` | 插件注册表文件路径，用于替换内置插件集（见 [docs/plugin.md](docs/plugin.md)） |

## AI 配置

支持所有兼容 OpenAI 协议的服务：

| 项 | 默认值 |
|----|--------|
| 模型 | `deepseek-v4-pro` |
| API Base URL | `https://api.deepseek.com/v1` |

设置面板提供 OpenCode Zen 模型列表自动补全。密钥只保存在你的本机服务端，不会上传任何第三方。

## 文档

- [docs/api.md](docs/api.md) — 完整 HTTP API 参考（40+ 端点，RPC 风格，可作为后端迁移契约）
- [docs/storage.md](docs/storage.md) — 文件系统存储规范（目录结构、原子写、一致性约束）
- [docs/plugin.md](docs/plugin.md) — 前端插件机制（编译时注入，内置 api-config / user 插件）

### API 设计

RPC 风格（全部 `POST` + dot notation），统一响应格式：

```jsonc
// 成功
{ "success": true, "data": <T> }

// 失败
{ "success": false, "error": "错误描述" }
```

```bash
# 列出文档
curl -X POST http://localhost:3001/api/documents.list \
  -H 'Content-Type: application/json' -d '{}'

# 创建章节
curl -X POST http://localhost:3001/api/chapters.create \
  -H 'Content-Type: application/json' \
  -d '{"docId": "xxx", "title": "第一章"}'
```

所有参数通过 Zod Schema 校验，ID 参数内置路径遍历防护。

## 测试

```bash
pnpm test
```

- 服务端：137 个接口 / 存储测试（`pnpm -C packages/server test`）
- 客户端：79 个测试（`pnpm -C packages/client test`）

## 项目结构

```
coeditor/
├── packages/
│   ├── shared/          # 共享类型、工具函数（generateId、AppSettings）
│   ├── server/          # Hono API 服务
│   │   ├── src/lib/     # RPC 框架、工具函数
│   │   ├── src/routes/  # RPC 路由（documents / chapters / paragraphs / attachments / templates / ai 等）
│   │   └── src/store/   # 文件系统存储层（Repository 抽象，可替换为数据库）
│   └── client/          # Taro 4 多端前端（H5 + 微信小程序）
│       ├── config/      # Taro 构建配置（含插件注册表注入）
│       └── src/
│           ├── api/         # RPC 客户端 + SSE 双端流式
│           ├── pages/       # index（文档列表）/ edit（编辑器）
│           ├── components/  # layout / conversation / document / ui / markdown
│           ├── plugin/      # 插件机制（编译时注入）
│           ├── plugins/     # 内置插件（api-config / data-dir / user）
│           ├── stores/      # Zustand 状态管理（按领域拆分）
│           └── hooks/       # 编辑器编排逻辑（视图模式 / 草稿管理 / 未保存守卫）
└── build.sh             # 生产构建脚本
```

审阅 prompt 已全部内置于文档模板（`packages/server/resources/templates/*.json`：顶层 `prompts` 按场景×风格 + 附件级 `prompts`），支持 `${}` 变量（`${附件type}` / `${document}` / `${currentChapter}` / `${currentParagraph}` / `${currentChapterPrevParagraphs}`），由服务端在 `ai.chat` 时组装渲染，不再有独立的 prompts 目录。

## 部署

### 1. 构建

```bash
pnpm install
bash build.sh
```

`build.sh` 执行三步：typecheck → client H5 构建 → server esbuild 单文件 bundle（内联全部依赖）。

| 产物 | 路径 |
|------|------|
| 前端静态文件 | `packages/client/dist-h5/` |
| 服务端 bundle | `packages/server/dist/server/src/index.js`（自包含，无需 node_modules） |

### 2. 启动

```bash
bash start.sh
```

`start.sh` 默认将 `COEDITOR_DATA_DIR` 设为脚本所在目录下的 `./data`；若在应用「设置 → 数据目录」中指定过其他目录（偏好持久化于平台默认数据目录内的 `data-dir.json`，即 macOS `~/Library/Application Support/coeditor/data-dir.json`、Linux `~/.local/share/coeditor/data-dir.json`、Windows `%LOCALAPPDATA%\coeditor\data-dir.json`），且未显式设置环境变量，则以该设置为准。启动前可用 `COEDITOR_DATA_DIR=/path bash start.sh` 覆盖。该指针文件只在用户**手工把数据目录改成非默认位置**时才会生成，改回默认目录即自动删除——用户只感知"数据目录"这一个位置，删除它时指针一并删除，无残留。

不设置任何环境变量裸启动 server 时，数据目录回退到平台默认：Linux `~/.local/share/coeditor`（XDG）、macOS `~/Library/Application Support/coeditor`、Windows `%LOCALAPPDATA%\coeditor`。首次运行 server 会把**内置种子**（`packages/server/resources/` 下的 novel 模板 + 三个审阅风格提示词，随包内联、类似 Java 的 `src/main/resources`）自动写入数据目录，开箱即用。

数据目录包含：`templates/`（文档模板，内置种子首次运行自动写入）、`users/`（用户文档与设置）。审阅 prompt 内置于模板，无独立 prompts 目录。

### 3. 反向代理（可选）

H5 产物由 server 内置静态 serve 提供，也可配合 Nginx 反代获得更好的静态文件性能：

```nginx
server {
    listen 80;
    server_name your.domain;

    root /path/to/coeditor/packages/client/dist-h5;
    location / { try_files $uri $uri/ /index.html; }
    location /api/ { proxy_pass http://127.0.0.1:3001; }
}
```

### 4. 微信小程序

小程序产物目录 `packages/client/dist-weapp`，用微信开发者工具导入即可。小程序内 API 请求指向已部署的 server 地址（通过构建时 `API_BASE_URL` 环境变量配置）。

## License

[Apache 2.0](LICENSE)
