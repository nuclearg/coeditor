# CoEditor 桌面壳（Tauri 2）

CoEditor 桌面客户端：内置本地 server（sidecar），开箱即用，数据全部留在本机。

## 形态

```
┌─ Tauri 壳（Rust）──────────────────────────┐
│  主窗口 (WKWebView)                        │
│    └─ http://127.0.0.1:<随机端口>/          │
│        ├─ /       → dist-h5（静态）         │
│        └─ /api/*  → Hono 业务接口（同源）    │
│  └─ sidecar：coeditor-server（bun 单文件）   │
│       └─ COEDITOR_WEB_ROOT → 捆绑 dist-h5  │
└────────────────────────────────────────────┘
```

- 同源直连：无 CORS、无跨源 localStorage
- 数据目录的一切逻辑（平台默认、指针文件、运行时切换、种子化）都在**服务端**：桌面壳不设置 `COEDITOR_DATA_DIR`，sidecar 像裸启动一样解析；种子（模板/提示词）由服务端内置（`seed.ts`），首次运行自动写入数据目录
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

产物：`src-tauri/target/release/bundle/macos/CoEditor.app` / `.dmg`。

## macOS 签名（易踩的坑）

`tauri.conf.json` 配了 `bundle.macOS.signingIdentity = "-"`（**ad-hoc 签名**），这是 Apple Silicon 上的硬要求：
未签名的包会被系统直接 SIGKILL，用户双击、Cmd+O、右键「打开」全部无效。

**坏签名比未公证严重得多**，两者别混为一谈：

| 状态 | 用户表现 | 用户能否自救 |
|---|---|---|
| **坏签名**（`Sealed Resources=none`，签名声称有资源但实际没有） | 内核 SIGKILL，**连「仍要打开」按钮都不出现** | ❌ 完全无法运行 |
| 未公证（签名有效但无公证票据） | 弹「无法验证开发者」 | ✅ 系统设置 → 隐私与安全性 → 仍要打开 |
| 有效签名 + 公证 | 无任何提示 | — |

历史上 Tauri 产出过坏签名（`code has no resources but signature indicates they must be present`），
所以加了**校验闸门**（CI 两个 workflow 都会跑，失败即中断，禁止把打不开的包发出去）：

```bash
cd desktop
bash scripts/verify-macos-signature.sh src-tauri/target/release/bundle/dmg/CoEditor.dmg
```

- 脚本会挂载 dmg、取出 `.app`、做 `codesign --verify --deep --strict`，并断言资源**已封存**
- ad-hoc 模式下校验失败会**自动按正确顺序重签**（先 sidecar、后 bundle，否则资源封存失效）
- `AUTO_REPAIR=0` 只校验不改动（CI 严格模式）
- 退出码：`0` 通过 / `1` 校验失败 / `2` 参数错误

> 注意：脚本刻意用 **bash 3.2 兼容**写法（macOS 自带版本）。**不要**用 `;;&`、`${var^^}` 等 bash 4+ 语法，
> 也不要把 `$VAR` 直接紧跟中文全角标点（如 `（$APP）`），bash 3.2 会把全角字符当成变量名的一部分而报
> unbound variable。需要相邻时一律写 `${APP}`。

**正式分发仍需** Apple Developer ID 签名 + 公证（$99/年）——ad-hoc 签名无法免除用户在
「隐私与安全性」中手动放行这一步。

## 关键文件

| 路径 | 说明 |
|---|---|
| `src-tauri/tauri.conf.json` | 窗口/捆绑配置；`externalBin` + `resources`（dist-h5）+ `macOS.signingIdentity`（ad-hoc） |
| `scripts/verify-macos-signature.sh` | 签名校验闸门（CI 失败即中断）+ ad-hoc 重签修复 |
| `scripts/macos-entitlements.plist` | ad-hoc 重签用 entitlements（WebKit JIT / 内嵌库加载；正式分发勿沿用） |
| `src-tauri/src/lib.rs` | sidecar 生命周期：随机端口 → 拉起（传 `COEDITOR_WEB_ROOT`）→ 就绪探测 → 退出 kill；**不涉及数据目录逻辑** |
| `../packages/server/src/index.ts` | `COEDITOR_WEB_ROOT` 静态服务（单端口同源，桌面壳专用） |
| `../packages/server/resources/` | 内置种子资源（templates/*.json，含审阅 prompt），构建时内联 |
| `../packages/server/src/seed.ts` | 汇总内置种子并在首次运行时写入数据目录 |
| `../packages/server/src/store/file-paths.ts` | 数据目录唯一权威：平台默认、指针文件、启动解析（env > 指针 > 默认） |
| `../packages/server/src/store/file-repository.ts` | 数据目录切换 + 首次运行写入内置种子 |
| `../packages/client/src/lib/desktop.ts` | 桌面适配：Tauri 内 `window.open` → 系统浏览器 |

## 数据与隐私

- 数据目录（平台默认）：macOS `~/Library/Application Support/coeditor`、Linux `~/.local/share/coeditor`、Windows `%LOCALAPPDATA%\coeditor`；首次运行由服务端自动写入内置种子（novel 模板 + 三个审阅风格提示词）
- 可在应用内「设置 → 数据目录」修改保存位置（支持系统文件夹选择器）；
  指针文件存放在平台默认数据目录内（macOS `~/Library/Application Support/coeditor/data-dir.json`、Linux `~/.local/share/coeditor/data-dir.json`、Windows `%LOCALAPPDATA%\coeditor\data-dir.json`），重启应用后依然生效。
  用户只感知"数据目录"这一个位置——指针文件仅在手工改成非默认目录时生成，改回默认即删除，删除数据目录时一并清除
- 清理：删除数据目录即回到全新状态（或从菜单卸载应用后手动删除）
- sidecar 只监听 `127.0.0.1` 随机端口，不对外暴露

## 已知限制 / 后续

- macOS 先行；Windows/Linux 需在 `tauri.conf.json` 调整 CSP 与 targets，并在 CI 矩阵补构建
- **发布分发需 Apple Developer ID 签名 + 公证（$99/年）**：当前仅 ad-hoc 签名，用户首次打开需在
  「系统设置 → 隐私与安全性 → 仍要打开」放行一次；未公证的包无法做到零摩擦
- Windows 侧尚未签名：`coeditor-server.exe`（sidecar）与 NSIS setup 需分别 Authenticode 签名，
  否则 SmartScreen 红屏；OV 证书约 $150–300/年，**别买 EV**（2024 起不再有即时信任待遇）
- 自更新（tauri-updater）未启用
