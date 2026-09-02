# CoEditor 前端插件机制

CoEditor 的核心编辑器保持精简，一切非核心能力以插件形式提供。插件在**编译时**注入，无需运行时动态加载。

## 设计原则

- 插件是纯前端机制（`packages/client`），后端（`packages/server`）不感知插件
- 插件代码直接编译进产物（Taro alias 替换注册表，config/index.ts 中 @plugin-registry），无运行时下载
- 开源版自带 `settings`、`user` 插件；部署方可替换注册表注入自己的插件集
- 编译时未注册插件时，运行时行为与无插件完全一致
- **UI + 数据 + 事件三支柱**：
  - UI：锚点替换（宿主声明布局，插件命中锚点替换实现）
  - 数据：stores 直连（插件直接订阅 zustand store、调用公开 action）
  - 事件：极简通知（`bus` 事件总线，fire-and-forget，不做命令层）

### 三条纪律

1. **ctx 恒空**：插槽 ctx 一律为空（`SlotCtx = Record<string, never>`），作为扩展哨位保留（additive 兼容）。数据走 stores、动作走公开 action
2. **数据走 stores，写操作走公开 action**：插件不得直接 import 内部实现拼装业务流（如 SSE 流式链路），能力收敛在宿主公开 action 一个入口
3. **事件只通知**：事件柱只有 fire-and-forget 的通知层；UI 触发动作 = 调用公开 action（Promise 直连），不经过事件总线

## 文件结构

```
packages/client/src/
├── plugin/
│   ├── types.ts          # 插件接口 + 插槽 ctx 规约
│   ├── registry.ts       # 默认插件注册表（可被编译时替换）
│   ├── index.ts          # 运行时入口：getPlugins() / runInit() / getCurrentUser()
│   ├── slot-core.ts      # 链式渲染纯逻辑（可测试）
│   ├── lifecycle-core.ts # onInit / getCurrentUser 纯逻辑
│   ├── SlotHost.tsx      # 区块插槽组件（含 ErrorBoundary）
│   ├── LayoutShell.tsx   # 页面骨架（variant 布局 + 锚点树）
│   └── CustomPageSlot.tsx # 自定义页面位渲染（pages/custom/{1..10}）
├── pages/
│   ├── index/            # 首页（variant="home"）
│   ├── edit/             # 编辑页（variant="editor"）
│   ├── settings/         # 设置页（variant="settings"，固定形态，与首页同款布局，内容 = settings.body 插槽）
│   └── custom/           # 扩展页面位 1~10（variant="custom"）
├── plugins/
│   ├── settings/         # 内置插件：设置页内容（偏好 + API 配置 + 数据目录）
│   │   ├── index.tsx     # 插件定义（ui.slots['settings.body']）
│   │   ├── SettingsPage.tsx   # 设置页内容组件（偏好 + ApiConfigSection + DataDirSection）
│   │   ├── ApiConfigSection.tsx # BYOK 配置区块
│   │   └── DataDirSection.tsx   # 数据目录配置区块
│   └── user/             # 内置插件：当前用户
│       └── index.ts      # 插件定义（user.get，返回 default-user）
├── components/settings/
│   ├── SettingsMenu.tsx  # 设置下拉菜单（语言/主题 + 高级设置入口 + 插件菜单项）
│   └── SettingsPrefs.tsx # 偏好区组件（审阅风格/CoT/主题/语言，齿轮与设置页共用）
└── stores/
    └── settingsStore.ts  # 审阅风格状态（settings.get/update）
```

## 页面形态（variant）

页面骨架由 `LayoutShell` 提供，**页面类型通过 `variant` 显式声明**（不靠 props 组合推断）：

```
页面类型（variant）：
  home     = 全宽 content（首页：文档列表等，无侧栏）
  editor   = sidepanel + (editorpanel | aipanel)（编辑页）
  settings = 全宽 content（设置页：固定页，与首页同款壳，内容 = settings.body 插槽）
  custom   = 全宽 content（扩展页面位 pages/custom/{1..10}）

页面 = Taro 页面（pages/index、pages/edit、pages/settings、pages/custom/{1..10}）+ LayoutShell variant
```

```tsx
// 首页
<LayoutShell variant="home" content={<DocumentList />} />

// 编辑页
<LayoutShell variant="editor" sidebar={<Sidebar/>} editor={<EditorPanel/>} ai={<AiPanel/>} />

// 扩展页面（自定义页面位模板）
<LayoutShell variant="custom" content={<CustomPageSlot index={1} />} />

// 设置页：variant="settings"，内容 = settings.body 插槽（页面模板见 pages/settings）
<LayoutShell variant="settings" content={<SlotHost slot="settings.body" />} />
```

- `isMobile` 只负责响应式布局（窄屏 editor 上 ai 下），不承担页面类型判断
- 首页/自定义页/设置页天然无侧栏（页面不传 sidebar，LayoutShell 不渲染）

## 设置页（page.settings）

`pages/settings` 是**开源版普通页面**：固定形态 `LayoutShell variant="settings"`（与 home/editor 齐名），壳与首页（index）一致——main.head 显示 logo + 页面标题，内容全宽滚动，页脚版权。内容区开放 **`settings.body` 插槽**（链式装饰机制，与其它 slot 一致；整页式内容如账户中心直接忽略 defaults 返回自身布局）：

- **开源版**默认注册表：`settingsPlugin` → 偏好区（审阅风格/CoT/主题/语言）+ API 配置（BYOK）+ 数据目录
- **SaaS 版**：saas 插件 → 个人中心（用量/充值/账单 + 退出登录），同样注册 `settings.body`

```ts
// 插件注册设置页内容（ui.slots）+ 页面标题/齿轮底部入口文案（缺省"高级设置"）
export const saasPlugin: CoEditorPlugin = {
  id: 'saas',
  settingsPageLabel: () => t('plugin.saas.account'),  // 页面标题 + 齿轮底部入口显示"个人中心"
  ui: {
    slots: {
      'settings.body': accountBodySlot,   // 设置页内容（SlotRenderer；可忽略 defaults）
    },
  },
}
```

页面标题 = `getSettingsPageLabel()`（`settingsPageLabel` 首个注册者生效，惰性函数语言切换后生效）→ 同时驱动 main.head 面包屑与 H5 浏览器标签 / 小程序导航栏标题。

齿轮下拉**底部固定入口**（插件 menuItems 与 settings-menu 插槽之后）→ `Taro.navigateTo('/pages/settings')`（可返回）。入口文案与页面标题共用 `settingsPageLabel`。

## 扩展页面位（page.custom.1~10）

开源版预留 10 个静态自定义页面（`pages/custom/{1..10}`，app.config 静态声明），插件通过 `pages.custom[N]` 注册组件填充（缺省显示占位提示）。适合**独立页面形态**的功能（如订单付款页），避免塞进 slot 破坏布局。

```ts
// 插件注册自定义页面
export const saasPlugin: CoEditorPlugin = {
  id: 'saas',
  pages: {
    custom: { 1: AccountPage },
  },
}
```

跳转：`Taro.navigateTo({ url: '/pages/custom/1' })`（H5 与 weapp 一致）。

## 插件接口

`packages/client/src/plugin/types.ts`。按**主体**（app / settings / user / ui / pages）分组，扩展点为"主体.动作"形式：

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
  }

  /** 用户 */
  user?: {
    /** 当前用户信息（排他：第一个返回非 null 的插件生效），headbar 展示 */
    get?: () => Promise<UserInfo | null>
  }

  /** 区块插槽（链式装饰） */
  ui?: {
    /** 【兼容别名】全局根部挂载，等价于 ui.slots['root'] */
    host?: () => ReactNode
    /** 命名插槽：所有插件的渲染函数按注册顺序链式作用于 defaults */
    slots?: Partial<Record<PluginSlot, (defaults: ReactNode, ctx: SlotCtx) => ReactNode>>
  }

  /**
   * 自定义页面位：page.custom.1 ~ page.custom.10（路由 pages/custom/{n}）。
   * 开源版预留 10 个静态扩展页面，插件注册组件填充（缺省显示占位提示）。
   * 适合独立页面形态的功能（如订单付款页），避免塞进 slot 破坏布局。
   */
  pages?: {
    custom?: Partial<Record<number, ComponentType>>
  }

  /**
   * 设置页标题 + 齿轮下拉底部"进入设置页"菜单项文案：
   * 缺省为内置文案（"高级设置"/"Advanced Settings"）；插件可自定义（如 SaaS 用"个人中心"）。
   * 惰性函数（语言切换后生效）。设置页内容本身注册在 ui.slots['settings.body']。
   */
  settingsPageLabel?: string | (() => string)

  /** 插件自带文案字典，框架启动时合并进全局 i18n（key 以 plugin.<id>. 为前缀） */
  i18n?: {
    zh: Record<string, string>
    en: Record<string, string>
  }
}
```

## 区块插槽（Slot）

### 锚点替换模型

宿主声明布局（唯一事实源，LayoutShell 骨架），插件只能命中已声明锚点：

```
sidepanel = sidepanel.head + sidepanel.body + sidepanel.foot
main = main.head + main.body + main.foot
main.body = content（home/settings/custom）or (editorpanel + aipanel)（editor）
editorpanel = editorpanel.head + editorpanel.body + editorpanel.foot
aipanel = aipanel.head + aipanel.body + aipanel.foot
所有 head/foot 再分为 left/middle/right 三栏（留空默认不展示）
```

- 插件**不能**：声明新锚点、调整区块顺序/尺寸、覆盖 layout 之外的东西
- 插件**可以**：替换任意已声明区块的实现（含核心区 body）、链式装饰现有实现（返回 defaults 保持原样）
- 布局限制由渲染器强制：宿主只认 SlotCtxMap 里的锚点 id，未知 id 编译期即被拒绝——**限制是机制不是约定**

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

### 锚点两级

| 级别 | 例子 | 说明 |
|---|---|---|
| 区块级 | `sidepanel` / `main` / `editorpanel` / `aipanel` / `main.body` | 替换整个面板/主区 |
| 组件级 | `review-button`、head/foot 的 left/middle/right | 细粒度装饰；**克制**：按真实需求逐个开放 |

### 锚点清单

| 锚点 | 级别 | ctx | 挂载处 |
|---|---|---|---|
| `root` | 特殊 | 空 | app.tsx |
| `settings-menu` | 组件 | 空 | SettingsMenu.tsx |
| `sidepanel` | 区块 | 空 | LayoutShell（sidebar 区块） |
| `sidepanel.head/body/foot` | 区块 | 空 | Sidebar.tsx（head=logo+标题/收起、body=章节树、foot） |
| `sidepanel.head.left/middle/right`、`sidepanel.foot.left/middle/right` | 组件 | 空 | Sidebar.tsx |
| `main` | 区块 | 空 | LayoutShell（main 容器） |
| `main.head/body/foot` | 区块 | 空 | LayoutShell（head=面包屑/设置、body=content 或 editor+ai、foot） |
| `main.head.left/middle/right`、`main.foot.left/middle/right` | 组件 | 空 | LayoutShell |
| `editorpanel` | 区块 | 空 | LayoutShell（editor 区块） |
| `editorpanel.head/body/foot` | 区块 | 空 | EditorPanel.tsx（head=draft tabs、body=书写区、foot=保存+审阅） |
| `editorpanel.head.left/middle/right`、`editorpanel.foot.left/middle/right` | 组件 | 空 | EditorPanel.tsx |
| `aipanel` | 区块 | 空 | LayoutShell（ai 区块） |
| `aipanel.head/body/foot` | 区块 | 空 | AiPanel.tsx（head=会话 tabs、body=对话气泡区、foot=输入+发送） |
| `aipanel.head.left/middle/right`、`aipanel.foot.left/middle/right` | 组件 | 空 | AiPanel.tsx |
| `review-button` | 组件 | 空 | EditorPanel.tsx（editorpanel.foot.right 内） |

### 锚点 × 页面归属

锚点由"哪个页面渲染了它"决定出现范围；**同名共享锚点在所有 LayoutShell 页面命中同一渲染链**（defaults 随页面不同）：

| 归属 | 锚点 | 出现页面 |
|---|---|---|
| 共享（LayoutShell 全形态） | `root`、`settings-menu`、`main` / `main.head/body/foot`（含 left/middle/right） | index（home）、edit（editor）、settings、custom/{1..10} |
| 仅编辑页 | `sidepanel.*`、`editorpanel.*`、`aipanel.*`、`review-button` | 仅 edit |
| 仅设置页 | `settings.body` | 仅 settings |

**装饰器需要"只在某页面形态显示"时**（共享锚点无法从 id 判断当前页），用 `usePageVariant()`（stores/layoutStore，LayoutShell 随挂载/页面 onShow 同步）：

```tsx
// 例：公告条挂在共享锚点 main.head.middle，但只想在首页/编辑页出现
function AnnouncementBar() {
  const pageVariant = usePageVariant()
  if (pageVariant !== 'home' && pageVariant !== 'editor') return null
  // ...
}
```

页面形态：固定页 `home`（首页）/ `editor`（编辑页）/ `settings`（设置页）+ 扩展页 `custom`（pages/custom/{1..10}）；装饰器用 `usePageVariant()` 精确判断当前页。

### 锚点纪律

- **锚点 id 稳定性**：锚点 id 一经发布即为公开 API，改名破坏所有插件；变更需记录
- ctx 契约最小化：恒空为默认态；数据走 stores、动作走公开 action、零件直接 import 宿主组件

### 示例：替换设置入口为人头 + 菜单追加用户卡片

```tsx
// 部署方插件
import type { CoEditorPlugin } from '@/plugin'

export const saasPlugin: CoEditorPlugin = {
  id: 'saas',
  i18n: {
    zh: { usage: '用量', orders: '订单', card: '我的账户' },
    en: { usage: 'Usage', orders: 'Orders', card: 'My Account' },
  },
  ui: {
    slots: {
      // 设置入口：👤 人头替换齿轮
      'main.head.right': (_defaults, ctx) => (
        <View onClick={ctx ? undefined : undefined} style={{ padding: 10, borderRadius: 8 }}>
          <Icon name="user" size={28} />
        </View>
      ),
      // 菜单末尾：用户卡片
      'settings-menu': () => (
        <View className="menu-label">{t('plugin.saas.card')}</View>
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

### 扩展点说明

| 扩展点 | 说明 |
|---|---|
| `app.onInit` | 应用启动钩子，框架依次调用所有插件的 `onInit`。不做任何判断/跳转——插件自行决定行为（如登录检查 + 自行跳转登录页） |
| `settings.menuItems` | 设置下拉菜单中的**结构化**条目（受控渲染，多插件聚合）。`action` 点击后菜单关闭并执行回调；`link` 新标签打开；`radio-group` 渲染单选分组 |
| `ui.slots` | **区块插槽（链式）**：见上文"区块插槽（Slot）"章节。追加/包裹/替换三种组合方式 |
| `pages.custom[N]` | **自定义页面位**（`pages/custom/{1..10}`）：插件注册组件填充独立页面（缺省占位提示）。适合订单付款页等整页形态，页面用 `LayoutShell variant="custom"` 渲染全宽内容 |
| `settings.body` | **设置页内容**（`pages/settings`，布局与首页一致）：注册到 `ui.slots` 的链式插槽，填充/装饰设置页内容区。开源版=偏好+BYOK+dataDir，SaaS=个人中心 |
| `settingsPageLabel` | **设置页标题 + 齿轮底部入口文案**：插件自定义（如 SaaS"个人中心"），缺省"高级设置"。惰性函数支持语言切换；设置页 head 面包屑与 H5/小程序标题由页面读取该值 |
| `user.get` | 当前用户信息（排他：第一个返回非 null 的插件生效），headbar 展示 |
| `i18n` | 插件自带文案字典（zh/en），启动时合并进全局 i18n。菜单项 `label` 支持 `() => string`（配合 `t('plugin.<id>.<key>')`，语言切换后生效）；插槽组件内可直接用 `useT()` |
| `ui.host` | **兼容别名**（等价于 `ui.slots['root']`），新代码请直接使用插槽 |

## 内置插件：settings

开源版默认注册表（`src/plugin/registry.ts`）：

```ts
import { settingsPlugin } from '@/plugins/settings'
import { userPlugin } from '@/plugins/user'

export const plugins: CoEditorPlugin[] = [settingsPlugin, userPlugin]
```

`settingsPlugin` 注册 `ui.slots['settings.body']`，填充设置页内容区，内容分三块：

1. **偏好区**：审阅风格 / 思考过程（CoT）/ 主题 / 语言（`SettingsPrefs`，齿轮下拉与设置页共用）
2. **API 配置（BYOK）**：模型（从 OpenCode Zen 拉取建议，失败用内置回退）+ API Key（存本机服务端 `settings.get/update`，不随构建产物分发）+ API Base URL
3. **数据目录**：展示/切换服务端数据保存目录（`DATA_ROOT`），桌面壳（Tauri）提供系统文件夹选择器

配置保存到服务端（`POST /api/settings.update`），`ai.chat` 服务端读取，前端无需感知。

## 内置插件：user

开源版内置的用户插件，`user.get` 直接返回固定用户名（`default-user`），纯前端实现、不请求后端。

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

## 数据支柱：stores 直连 + 公开 action

插件 `import { useXxxStore } from '@/stores'` 直接订阅（zustand 全局 store + 编译时 alias）。公开 stores/action：

| store | 内容 | 同步方 |
|---|---|---|
| `layoutStore` | sidebarOpen / toggle / close / settingsMenuOpen / **breadcrumb**（页面面包屑） | LayoutShell 持有侧栏状态；页面同步面包屑 |
| `editorStore` | dirty / saving / **doSave**（保存动作唯一入口） | 编辑页同步 |
| `reviewStore` | **startReview(focus?)**（发起审阅，seq + focus 通道） | 页面订阅 seq 走保存+autoSubmit 链路；AiPanel 消费 focus |
| `aiInputStore` | input / streaming / placeholder / **send / abort**（输入区受控协议） | AiPanel 注册实现，插件替换输入/发送按钮共用 |

- 写操作唯一入口：doSave / startReview 等；插件禁止拼装内部业务流（如直接 import api/stream 拼 SSE）
- 契约类型复用 `@coeditor/shared`，编译期校验

## 事件支柱：bus 事件总线

`src/plugin/bus.ts`：`bus.on/off/emit`，事件名 `pluginId:事件名` 命名空间，fire-and-forget，单 handler 异常不阻断。

已使用事件：
- `auth:changed`（登录态变化，auth 插件发）
- `doc:changed`（文档创建/删除，documentStore 发）
- `review:completed` / `review:failed`（审阅流结束/失败，AiPanel 发）

**不做**：命令层、超时、深度限制、中间件、插件间 request/response。

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

- 不设 `PLUGIN_REGISTRY_PATH`：使用默认注册表（settings + user）
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

以 `settings` 插件为模板，一个完整插件包含：

1. **定义文件**：导出 `CoEditorPlugin`，按需声明扩展点（`settings.body`（ui.slots） / `pages.custom` / `settings.menuItems` / `ui.slots` 等）
2. **页面/区块组件**：注册到扩展点的 React/Taro 组件（如设置页内容、自定义页面、插槽装饰）
3. **状态 store**（如有）：zustand store 管理本地状态

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

### 示例：注册设置页内容（settings.body，如个人中心）

```tsx
// 插件把设置页内容注册到 settings.body 插槽（页面壳由开源版提供，与首页布局一致）
import type { CoEditorPlugin } from '@/plugin'

export const saasPlugin: CoEditorPlugin = {
  id: 'saas',
  settingsPageLabel: () => t('plugin.saas.account'),   // 页面标题 + 齿轮入口显示"个人中心"
  ui: {
    slots: {
      'settings.body': () => <AccountPage />,           // 整页式内容：忽略 defaults 返回自身布局
    },
  },
}
```

### 示例：注册自定义页面（扩展页面位）

```tsx
// 插件注册 page.custom.1（如订单付款页），设置菜单入口 navigateTo 进入
import type { CoEditorPlugin } from '@/plugin'

export const saasPlugin: CoEditorPlugin = {
  id: 'saas',
  pages: {
    custom: { 1: CheckoutPage },
  },
  settings: {
    menuItems: [
      { type: 'action', label: () => t('plugin.saas.checkout'), onClick: () => Taro.navigateTo({ url: '/pages/custom/1' }) },
    ],
  },
}
```

## 与后端的关系

- 插件机制完全在前端；后端接口（`settings.get/update`、`ai.chat` 等）保持不变
- 所有 API 走相对路径 `/api/*`，部署方保证同域或反代即可
- `AppSettings` 中的 `style`（审阅风格）由前端菜单直接读写服务端
