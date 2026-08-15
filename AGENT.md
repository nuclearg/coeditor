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

## 前端插件机制（v2）

页面骨架定死（三端一致），UI 是内置默认实现，插件通过**锚点树**扩展。

- **锚点树**：`sidepanel` / `main` / `editorpanel` / `aipanel` 区块 + `head/body/foot` + `left/middle/right` 子锚点 + 组件级 `review-button`
- **ctx 恒空纪律**：`SlotCtx = Record<string, never>`；数据走 stores、动作走公开 action、零件直接 import 宿主组件
- **插件接口**：`app.onInit` / `settings.menuItems` / `user.get` / `i18n` / `request.getHeaders·onResponse` / `ui.slots`
- **事件总线**（`src/plugin/bus.ts`）：自研无依赖 `bus.on/off/emit`，事件名约定 `pluginId:事件名`
- **布局骨架**（`src/plugin/LayoutShell.tsx`）：宽屏 sidebar|editor|ai 三栏并排、editor/ai 可拖拽；窄屏 editor 上 ai 下、sidebar 变浮层
- **内置插件**（`src/plugins/`）：`api-config`、`user`
- **设置下拉菜单**（`components/settings/SettingsMenu.tsx`）：审阅风格 radio（核心，非插件）+ 插件菜单项
- 详细文档见 docs/plugin-v2.md

