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

## 前端插件机制

核心编辑器保持精简，一切非核心能力以插件形式提供，编译时注入（Taro alias `@plugin-registry`，可用 `PLUGIN_REGISTRY_PATH` 环境变量替换注册表文件）。

- 插件接口（`src/plugin/types.ts`）：按主体分组（`app.onInit` 启动钩子 / `settings.menuItems` 结构化菜单项 / `user.get` 用户信息 / `i18n` 文案字典 / **`ui.slots` 区块插槽**——topbar/sidebar/editor/ai 四区块的外围上下左右共 11 个命名插槽，链式装饰模型，中间核心区不开给插件；`settings.trigger`、`ui.host` 为兼容别名）
- 内置插件（`src/plugins/`）：`api-config`（设置菜单 → API 配置弹窗）、`user`（固定返回 default-user）
- 设置下拉菜单（`components/settings/SettingsMenu.tsx`）：审阅风格 radio（核心功能，非插件）+ 插件贡献的菜单项
- 详细文档见 docs/plugin.md
