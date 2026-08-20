# CoEditor 桌面壳（Tauri 2）

开源版单机桌面客户端：内置本地 server（sidecar），开箱即用，数据全部留在本机。

## 形态

```
┌─ Tauri 壳（Rust）──────────────────────────┐
│  主窗口 (WKWebView)                        │
│    └─ http://127.0.0.1:<随机端口>/          │
│        ├─ /       → dist-h5（静态）         │
│        └─ /api/*  → Hono 业务接口（同源）    │
│  └─ sidecar：coeditor-server（bun 单文件）   │
│       ├─ COEDITOR_DATA_DIR → ~/Library/    │
│       │    Application Support/net.coeditor│
│       │    .lite.desktop/data              │
│       └─ COEDITOR_WEB_ROOT → 捆绑 dist-h5  │
└────────────────────────────────────────────┘
```

- 同源直连：无 CORS、无跨源 localStorage；数据目录首次运行自动种子化 prompts/templates
- 端口随机分配，退出时自动 kill sidecar
- 不依赖任何外部服务器——「我绝不偷你数据」的承诺在运行时不依赖你的任何基础设施

## 前置要求

- Rust（`rustup` 默认 toolchain）
- [bun](https://bun.sh)（编译 sidecar 单文件）
- Node ≥ 20.11 + pnpm（仓库已有）
- macOS：Xcode Command Line Tools

## 开发

```bash
# 1. 桌面工具链（仅首次）
cd desktop && npm install

# 2. 起壳（自动拉起 Taro dev server 5173 + Hono dev server 3001）
cd desktop && npx tauri dev
```

dev 模式窗口直连 `http://localhost:5173`（Taro devServer 已代理 `/api` → 3001），不拉起 sidecar。

## 构建发布

```bash
cd desktop
npx tauri build
```

`beforeBuildCommand`（`desktop/build-desktop.sh`）依次执行：

1. `pnpm --filter @coeditor/client build:h5` → dist-h5
2. esbuild 打包 server 单文件
3. `bun build --compile` 产出 sidecar → `src-tauri/binaries/coeditor-server-<triple>`

产物：`src-tauri/target/release/bundle/macos/CoEditor Desktop.app` / `.dmg`。

## 关键文件

| 路径 | 说明 |
|---|---|
| `src-tauri/tauri.conf.json` | 窗口/捆绑配置；`externalBin` + `resources`（dist-h5、seed-data） |
| `src-tauri/src/lib.rs` | sidecar 生命周期：随机端口 → 拉起 → 就绪探测 → 退出 kill；数据目录种子化 |
| `../packages/server/src/index.ts` | `COEDITOR_WEB_ROOT` 静态服务（单端口同源，桌面壳专用） |
| `../packages/client/src/lib/desktop.ts` | 桌面适配：Tauri 内 `window.open` → 系统浏览器 |

## 数据与隐私

- 数据目录：`~/Library/Application Support/net.coeditor.lite.desktop/data`
- 清理：删除该目录即回到全新状态（或从菜单卸载应用后手动删除）
- sidecar 只监听 `127.0.0.1` 随机端口，不对外暴露

## 已知限制 / 后续

- macOS 先行；Windows/Linux 需在 `tauri.conf.json` 调整 CSP 与 targets，并在 CI 矩阵补构建
- 发布分发需 Apple Developer ID 签名 + 公证（本机自用无需）
- 自更新（tauri-updater）未启用
