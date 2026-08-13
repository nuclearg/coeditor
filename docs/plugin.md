# CoEditor 前端插件机制

CoEditor 的核心编辑器保持精简，一切非核心能力以插件形式提供。插件在**编译时**注入，无需运行时动态加载。

## 设计原则

- 插件是纯前端机制（`packages/client`），后端（`packages/server`）不感知插件
- 插件代码直接编译进产物（Taro alias 替换注册表，config/index.ts 中 @plugin-registry），无运行时下载
- 开源版自带 `api-config`、`user` 插件；部署方可替换注册表注入自己的插件集
- 编译时未注册插件时，运行时行为与无插件完全一致

## 文件结构

```
packages/client/src/
├── plugin/
│   ├── types.ts          # 插件接口 + 插槽 ctx 规约
│   ├── registry.ts       # 默认插件注册表（可被编译时替换）
│   ├── index.ts          # 运行时入口：getPlugins() / runInit() / getCurrentUser()
│   ├── slot-core.ts      # 链式渲染纯逻辑（可测试）
│   ├── lifecycle-core.ts # onInit / getCurrentUser 纯逻辑
│   └── SlotHost.tsx      # 区块插槽组件（含 ErrorBoundary）
├── plugins/
│   ├── api-config/       # 内置插件：API 配置弹窗
│   │   ├── index.tsx     # 插件定义（settings.menuItems + ui.host）
│   │   ├── store.ts      # 弹窗开关状态（zustand）
│   │   └── ApiConfigDialog.tsx
│   └── user/             # 内置插件：当前用户
│       └── index.ts      # 插件定义（user.get，返回 default-user）
├── components/settings/
│   └── SettingsMenu.tsx  # 设置下拉菜单（审阅风格 + 插件菜单项）
└── stores/
    └── settingsStore.ts  # 审阅风格状态（settings.get/update）
```

## 插件接口

`packages/client/src/plugin/types.ts`。按**主体**（app / settings / user / ui）分组，扩展点为"主体.动作"形式：

```ts
interface RadioOption {
  label: string
  value: string
}

interface UserInfo {
  name: string
}

type PluginMenuItem =
  | { type: 'action'; label: string | (() => string); onClick: () => void }  // 点击触发；label 支持函数（语言切换后生效）
  | { type: 'link'; label: string | (() => string); url: string }            // 外跳链接（新标签打开）
  | {                                                             // 单项选择组
      type: 'radio-group'
      label: string | (() => string)
      options: RadioOption[]
      value: string
      onChange: (value: string) => void
    }

interface CoEditorPlugin {
  id: string

  /** 应用级 */
  app?: {
    /** 应用启动钩子：启动时依次执行。可在此检查登录态并自行跳转 */
    onInit?: () => Promise<void>
  }

  /** 设置菜单 */
  settings?: {
    /** 向设置下拉菜单贡献的结构化菜单项（受控渲染，多插件聚合） */
    menuItems?: PluginMenuItem[]
    /** 【兼容别名】替换设置入口按钮，等价于 ui.slots['topbar-settings'] */
    trigger?: (ctx: { open: () => void }) => ReactNode
  }

  /** 用户 */
  user?: {
    /** 当前用户信息（排他：第一个返回非 null 的插件生效）。
     *  注入 topbar-right 插槽的 ctx.user；该插槽默认不渲染任何内容，
     *  需插件注册插槽渲染函数（如调用 ctx.renderSettingsBadge）才会展示 */
    get?: () => Promise<UserInfo | null>
  }

  /** 区块插槽（链式装饰） */
  ui?: {
    /** 【兼容别名】全局根部挂载，等价于 ui.slots['root'] */
    host?: () => ReactNode
    /** 命名插槽：所有插件的渲染函数按注册顺序链式作用于 defaults */
    slots?: Partial<Record<PluginSlot, (defaults: ReactNode, ctx: SlotCtx) => ReactNode>>
  }

  /** 插件自带文案字典，框架启动时合并进全局 i18n（key 以 plugin.<id>. 为前缀） */
  i18n?: {
    zh: Record<string, string>
    en: Record<string, string>
  }
}
```

## 区块插槽（Slot）

UI 主干框架固定为四个区块：**topbar / sidebar / editor-panel / ai-panel**。每个区块只开放**外围**插槽（上下/左右），中间的**核心内容区**（品牌标题、内容树、书写区、消息流）永不开给插件。

### 链式装饰模型

所有插件的渲染函数**按注册顺序依次作用于 defaults**（后注册包裹先注册）：

```ts
let node = defaults
for (const plugin of plugins) {
  const render = plugin.ui?.slots?.[slot]
  if (render) node = render(node, ctx)
}
```

三种组合方式统一为这一种语义：

| 意图 | 写法 |
|---|---|
| 追加（append） | `(defaults) => <>{defaults}{自己的内容}</>` |
| 包裹（wrap） | `(defaults) => <View>{defaults}<badge/></View>` |
| 替换（replace） | `(_defaults) => 自己的内容` |

单个插件异常不阻断整链（框架 try/catch 隔离）。

### 插槽清单（11 个）

| 插槽 | defaults | ctx 关键字段 |
|---|---|---|
| `root` | null（全局挂载，原 ui.host） | 无 |
| `topbar-left` | 品牌区 | `nav`、`renderBrand({ logo?, title? })` |
| `topbar-right` | 无（默认不渲染内容） | `user`、`renderSettingsBadge({ icon?, label? })` |
| `topbar-settings` | 齿轮按钮 | `open`、`renderSettingsButton({ icon?, label? })` |
| `sidebar-top` | 标题 + 附件列表 + 全文入口 | `docId`、`doc`、`template`、`renderTitle()`、`renderAttachments()`、`renderFulltextEntry()` |
| `sidebar-bottom` | null | `docId` |
| `editor-top` | DraftTabs 版本行 | `activeDrafts`、`currentDraftId`、`renderDraftTabs()` |
| `editor-bottom` | 保存 + 审阅按钮行 | `dirty`、`saving`、`doSave`、`submitReview`、`renderSaveButton({ label? })`、`renderReviewButton()` |
| `ai-top` | 会话标题 + 新建 + 会话 tabs | `conversations`、`activeConvId`、`createConversation`、`renderTitle()`、`renderNewButton()`、`renderConversationTabs()` |
| `ai-bottom` | 输入框 + 发送按钮 | `streaming`、`send`、`abort`、`placeholder`、`renderInput()`、`renderSendButton()` |
| `settings-menu` | null（菜单末尾追加区，排在 menuItems 之后） | 无 |

### 规约三原则（升级兼容的依据）

1. **框架自己也用同一套积木**：默认片段（renderXxx）由框架用 `ui/` 原语构建，插件与框架能力一致
2. **ctx 只含只读数据 + 操作句柄**：插件永远接触不到内部状态（store、组件内部）；操作（open/doSave/send）由框架持有
3. **菜单/对话框本体永远是框架实现**：替换的只是入口按钮等外围片段；审阅风格、语言、菜单内容、书写区、消息流不可替换

### 示例：替换设置入口为人头 + 菜单追加用户卡片

```tsx
// 部署方插件
import type { CoEditorPlugin } from '@/plugin'

export const saasPlugin: CoEditorPlugin = {
  id: 'saas',
  i18n: {
    zh: { usage: '用量', orders: '订单', points: '积分', card: '我的账户' },
    en: { usage: 'Usage', orders: 'Orders', points: 'Points', card: 'My Account' },
  },
  ui: {
    slots: {
      // 设置入口：👤 人头替换齿轮（也可用 renderSettingsButton({ icon: 'user' }) 微调）
      'topbar-settings': (_defaults, { open }) => (
        <View onClick={open} style={{ padding: 10, borderRadius: 8 }}>
          <Icon name="user" size={28} />
        </View>
      ),
      // 菜单末尾：用户卡片
      'settings-menu': () => (
        <View className="menu-label">{t('plugin.saas.card')}</View>
      ),
      // 侧栏底部：推广位
      'sidebar-bottom': ({ docId }) => (
        <View className="menu-item" onClick={() => upgrade(docId)}>升级会员</View>
      ),
    },
  },
  settings: {
    menuItems: [
      { type: 'link', label: () => t('plugin.saas.usage'), url: 'https://account.example.com/usage' },
      { type: 'link', label: () => t('plugin.saas.orders'), url: 'https://account.example.com/orders' },
    ],
  },
}
```

### 微调 vs 深度定制

- **微调**：用 ctx 的 renderXxx 积木（`ctx.renderSettingsButton({ icon: 'user' })`、`ctx.renderBrand({ title: 'XXX' })`）——交互由框架保证
- **深度定制**：replace 插槽（不渲染 defaults，用 `ui/` 原语自建）

### 扩展点说明

| 扩展点 | 说明 |
|---|---|
| `app.onInit` | 应用启动钩子，框架依次调用所有插件的 `onInit`。不做任何判断/跳转——插件自行决定行为（如登录检查 + 自行跳转登录页） |
| `settings.menuItems` | 设置下拉菜单中的**结构化**条目（受控渲染，多插件聚合）。`action` 点击后菜单关闭并执行回调；`link` 新标签打开；`radio-group` 渲染单选分组 |
| `ui.slots` | **区块插槽（链式）**：见上文"区块插槽（Slot）"章节。追加/包裹/替换三种组合方式 |
| `user.get` | 当前用户信息（排他：第一个返回非 null 的插件生效）。注入 `topbar-right` 插槽的 `ctx.user`；该插槽默认不渲染内容，需插件注册插槽渲染函数（如调用 `ctx.renderSettingsBadge()`）才会展示 |
| `i18n` | 插件自带文案字典（zh/en），启动时合并进全局 i18n。菜单项 `label` 支持 `() => string`（配合 `t('plugin.<id>.<key>')`，语言切换后生效）；插槽组件内可直接用 `useT()` |
| `settings.trigger` / `ui.host` | **兼容别名**（分别等价于 `ui.slots['topbar-settings']` / `ui.slots['root']`），新代码请直接使用插槽 |

## 内置插件：api-config

开源版默认注册表（`src/plugin/registry.ts`）：

```ts
import { apiConfigPlugin } from '@/plugins/api-config'
import { userPlugin } from '@/plugins/user'

export const plugins: CoEditorPlugin[] = [apiConfigPlugin, userPlugin]
```

`api-config` 在设置菜单中贡献"API 配置"入口（`settings.menuItems`），点击弹出 Dialog（`ui.slots['root']` 挂载），配置项：

- **模型**：文本框 + 模型建议列表（从 OpenCode Zen 拉取，失败时用内置回退列表）
- **API Key**：密码输入框，密钥存储在本机服务端（`settings.get/update`），不随构建产物分发
- **API Base URL**：兼容 OpenAI 协议的地址，默认 `https://api.deepseek.com/v1`

配置保存到服务端（`POST /api/settings.update`），`ai.chat` 服务端读取，前端无需感知。

## 内置插件：user

开源版内置的用户插件，`user.get` 直接返回固定用户名（`default-user`），纯前端实现、不请求后端。

注意：`topbar-right` 插槽**默认不渲染任何内容**——`user.get` 只为该插槽提供 `ctx.user` 数据。该插件本身不注册插槽渲染函数，因此默认 Header 右侧为空；需要展示时，由插件注册 `ui.slots['topbar-right']` 渲染函数并调用 `ctx.renderSettingsBadge()`（框架积木，输出图标 + 用户名）。

```ts
// src/plugins/user/index.ts
export const userPlugin: CoEditorPlugin = {
  id: 'user',
  user: {
    get: async () => ({ name: 'default-user' }),
  },
}
```

部署方替换为真实用户系统时，只需在自定义注册表中提供带真实 `user.get`（配合 `app.onInit` 登录检查）的实现。

## 设置下拉菜单

Header 按钮（默认齿轮）→ `SettingsMenu`：

```
┌─────────────────────────────┐
│  审阅风格（核心功能，非插件） │
│  ○ 温和  ○ 严厉  ○ 鼓励     │
├─────────────────────────────┤
│  ← 插件贡献的菜单项 →        │
│  （默认：API 配置）          │
└─────────────────────────────┘
```

- 审阅风格为编辑器核心功能，直接硬编码在菜单中，通过 `settingsStore` 读写服务端
- 插件菜单项渲染在分隔线下方，多个插件的条目按注册表顺序排列

## 编译时注入

注册表通过 Taro alias `@plugin-registry` 解析（`packages/client/config/index.ts`）：

```ts
alias: {
  '@': path.resolve(__dirname, '..', 'src'),
  '@plugin-registry': process.env.PLUGIN_REGISTRY_PATH
    ? path.resolve(process.env.PLUGIN_REGISTRY_PATH)
    : path.resolve(__dirname, '..', 'src/plugin/registry.ts'),
},
```

- 不设 `PLUGIN_REGISTRY_PATH`：使用默认注册表（api-config + user）
- 设置 `PLUGIN_REGISTRY_PATH`：构建时替换为指定文件（相对 client 目录或绝对路径均可）

部署方替换的注册表文件只需导出 `plugins: CoEditorPlugin[]`，且依赖的插件代码可放在任何位置（例如独立仓库，通过相对/绝对路径引用）。

### 示例：自定义注册表

```ts
// 自定义注册表文件（如 /path/to/registry.ts）
import type { CoEditorPlugin } from '@/plugin'
import { myPlugin } from './my-plugin'

const plugins: CoEditorPlugin[] = [myPlugin]
export { plugins }
```

```bash
PLUGIN_REGISTRY_PATH=/path/to/registry.ts pnpm --filter @coeditor/client build:h5
```

## 编写一个插件

以 `api-config` 插件为模板，一个完整插件包含：

1. **定义文件**：导出 `CoEditorPlugin`，`settings.menuItems` 里 `onClick` 直接调用 `useXxxStore.getState().open()`
2. **状态 store**（如有弹窗）：zustand store 管理弹窗开关
3. **UI 组件**：`ui.slots['root']` 返回的组件，挂在应用根部（所有页面之外，H5 与小程序一致）

```tsx
// 插件示例：在设置菜单贡献一个外跳项 + 启动时检查登录态
import type { CoEditorPlugin } from '@/plugin'
import { getStorage } from '@/lib/storage'

export const myPlugin: CoEditorPlugin = {
  id: 'my-plugin',
  settings: {
    menuItems: [
      { type: 'link', label: () => t('plugin.my.service'), url: 'https://example.com' },
    ],
  },
  i18n: {
    zh: { service: '我的服务' },
    en: { service: 'My Service' },
  },
  app: {
    onInit: async () => {
      // 登录检查等启动逻辑，跳转自行处理
      if (!getStorage('token')) {
        // H5：window.location.href = 'https://example.com/login'
        // 小程序：Taro.reLaunch({ url: '/pages/login/index' })
      }
    },
  },
}
```

### 示例：用户头像替换设置按钮（推荐用插槽）

`ui.slots['topbar-settings']` 把 Header 的设置按钮替换为自定义触发组件（如用户头像），点击后打开**同一个**下拉菜单，菜单内容不变（审阅风格 + 语言 + 所有插件的 `settings.menuItems`）：

```tsx
// 部署方插件：人头字符 👤 作为触发按钮 + 自带文案字典
import { View } from '@tarojs/components'
import { Icon } from '@/components/ui/Icon'
import type { CoEditorPlugin } from '@/plugin'
import { t } from '@/lib/i18n'

export const saasPlugin: CoEditorPlugin = {
  id: 'saas',
  i18n: {
    zh: { usage: '用量', orders: '订单', points: '积分' },
    en: { usage: 'Usage', orders: 'Orders', points: 'Points' },
  },
  ui: {
    slots: {
      'topbar-settings': (_defaults, { open }) => (
        <View onClick={open} style={{ padding: 10, borderRadius: 8 }}>
          <Icon name="user" size={28} />  {/* 👤 */}
        </View>
      ),
    },
  },
  settings: {
    menuItems: [
      { type: 'link', label: () => t('plugin.saas.usage'), url: 'https://account.example.com/usage' },
      { type: 'link', label: () => t('plugin.saas.orders'), url: 'https://account.example.com/orders' },
      { type: 'link', label: () => t('plugin.saas.points'), url: 'https://account.example.com/points' },
    ],
  },
}
```

> 更轻量的微调方式：`ctx.renderSettingsButton({ icon: 'user' })` 直接产出人头图标 + 框架保证的打开交互，无需 replace。

## 与后端的关系

- 插件机制完全在前端；后端接口（`settings.get/update`、`ai.chat` 等）保持不变
- 所有 API 走相对路径 `/api/*`，部署方保证同域或反代即可
- `AppSettings` 中的 `style`（审阅风格）由前端菜单直接读写服务端
