# CoEditor — AI 辅助写作工具

## 产品定位

让 AI 辅助作者进行文学创作、学术写作、材料编纂等文字工作。人类是主笔，AI 只负责像编辑一样提意见和建议，绝不喧宾夺主。

## 当前架构

- packages/shared：共享类型 + generateId + AppSettings
- packages/server：Hono API（RPC 风格 /api/{resource}.{action}），纯文件存储，单用户；文档模板（data/templates/*.json）定义文档的附件种类（大纲/世界观/人设等），prompt 拼接由前端按模板 `contextLabel` 组装
- packages/client：React SPA，**Taro 4 多端框架**（H5 + 微信小程序双端编译），组件为 Taro 原语 + 自定义 CSS（无 Radix/Tailwind），zustand 状态

双端要点：
- API 走相对路径 `/api/*`，同域或反代（H5：fetch；小程序：Taro.request）
- AI 流式（SSE）：`api/stream.ts` 双端适配（H5 fetch + ReadableStream / 小程序 wx.request enableChunked）
- markdown：H5 用 react-markdown（.md-content 排版样式），小程序用 marked + @tarojs/plugin-html 渲染
- `@coeditor/shared` 在构建时 alias 直接指向 `packages/shared/src/types.ts`（单一来源，无副本）；Taro 的 `compile.include` 不生效，改由 `config/index.ts` 的 `webpackChain`（`includeSharedSrc`）把 shared 源码目录加进 babel-loader 的 include
- 构建：`build:h5`（产物 dist-h5）/ `build:weapp`（产物 dist-weapp），小程序用微信开发者工具导入
- 后端地址约定：前端始终用相对路径 `/api/*`，由部署方保证同域或反代，不做编译时注入

## 前端插件机制与布局骨架

页面骨架定死（三端一致），UI 是内置默认实现，插件通过**区块 bar 网格插槽**扩展。

- **布局骨架**（`src/plugin/LayoutShell.tsx`）：topbar/bottombar 通栏 + 主区（宽屏 sidebar|editor|ai 三栏并排、editor/ai 可拖拽；窄屏 editor 上 ai 下、sidebar 变浮层）；sidebar 折叠状态由骨架持有（`LayoutContext`，`useLayout()` 消费）；`content` prop 供无区块页面（文档列表）使用
- **插槽网格**（`src/plugin/types.ts`）：24 个 bar 插槽 = 8 区块位（topbar/bottombar 通栏 + sidebar/editorpanel/aipanel 各自的 topbar/bottombar）× 左/中/右；**body 不开放**（编辑器/气泡为内置内容）；`root`、`settings-menu` 保留。插槽为链式装饰模型（`SlotHost`/`slot-core.ts`）
- **插件接口**：`app.onInit` / `settings.menuItems` / `user.get` / `i18n` / `request.getHeaders·onResponse` / `ui.slots`
- **事件总线**（`src/plugin/bus.ts`）：自研无依赖 `bus.on/off/emit`，事件名约定 `pluginId:事件名`
- **状态只读约定（君子协定）**：插槽 ctx 中 `readonly` 字段仅可读，变更走 ctx 回调或事件总线
- 区块默认内容：topbar/left（展开按钮+logo+title+面包屑）、topbar/right（设置按钮）、sidebar/topbar/right（关闭按钮）、editorpanel/bottombar/right（保存+审阅）、aipanel/bottombar/middle+right（输入框+发送按钮）
- 内置插件（`src/plugins/`）：`api-config`、`user`
- 设置下拉菜单（`components/settings/SettingsMenu.tsx`）：审阅风格 radio（核心，非插件）+ 插件菜单项
- 详细文档见 docs/plugin.md

