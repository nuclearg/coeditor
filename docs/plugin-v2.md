# CoEditor 插件体系 v2 设计（2026-08）

> 本文档记录插件体系的目标形态与设计决策（含历轮评审结论与明确不做的内容）。
> 现有机制的实现细节仍见 `docs/plugin.md`（v1），本文件不重复描述。
> 状态：**已落地（2026-08）**——LayoutShell 骨架（sidepanel+main）、锚点树、ctx 收空、bus 事件总线、审阅维度验证样本完成。

## 1. 背景与动机

v1 插槽体系（11 个外围插槽）暴露的问题：

1. **panel 核心区不能动**：sidebar/editorpanel/aipanel 只有上下左右外围插槽，中间核心区对插件关闭；首页甚至没有插槽。需要"替换任意区块实现"的能力
2. **ctx 膨胀**：ctx 曾塞数据/积木/动作句柄，每个字段都是宿主的维护义务 + 插件的依赖面；实际插件不消费 ctx 字段，说明 ctx 承载数据的必要性为零
3. **UI 与动作耦合**：按钮即动作，无法替换动作实现或注入新动作形态（如"审阅"→"按维度审阅"下拉）

## 2. 设计原则：UI + 数据 + 事件 三支柱

| 支柱 | 形态 | 说明 |
|---|---|---|
| **UI** | 锚点替换 | 宿主声明布局（layout 树是红线），插件只能命中已声明锚点替换实现，不能突破布局 |
| **数据** | stores 直连 | 插件直接订阅宿主 zustand store、调用公开 action；写操作唯一入口 = 宿主 action |
| **事件** | 极简通知 | `bus`（`src/plugin/bus.ts`）事件总线（`pluginId:事件名` 命名空间，fire-and-forget），不做命令层 |

### 三条纪律（评审结论，写死）

1. **ctx 恒空**：ctx 一律为空（`SlotCtx = Record<string, never>`），作为扩展哨位保留（类比 win32 `lpReserved`：additive 兼容，将来加字段是纯增量，现有插件零迁移）。新增字段需评审——"动作句柄"也不进 ctx，动作一律收敛为公开 action（数据柱）
2. **数据走 stores，写操作走公开 action**：插件不得直接 import 内部实现拼装业务流（如 SSE 流式链路），能力收敛在宿主公开 action 一个入口
3. **事件只通知**：事件柱只有 fire-and-forget 的通知层。**明确不做命令层**（invoke/useAction/动作注册表/中间件/超时/深度限制）——评审结论：合理但性价比过低，UI 直接调用公开 action 即可

## 3. UI 支柱：锚点替换模型

```
宿主声明布局（唯一事实源，LayoutShell 骨架）：
  页面 = sidepanel + main（左右两栏）
  sidepanel = sidepanel.head + sidepanel.body + sidepanel.foot
  main = main.head + main.body + main.foot
  main.body = 首页内容 or (editorpanel + aipanel)
  editorpanel = editorpanel.head + editorpanel.body + editorpanel.foot
  aipanel = aipanel.head + aipanel.body + aipanel.foot
  所有 head/foot 再分为 left/middle/right 三栏（留空默认不展示）

插件声明（只能命中锚点）：
  ui.slots = { 'main.body': (defaults) => <LoginGate/> }   // 区块级替换
  ui.slots = { 'review-button': (defaults) => <Dropdown/> } // 组件级装饰
```

- 插件**不能**：声明新锚点、调整区块顺序/尺寸、覆盖 layout 之外的东西
- 插件**可以**：替换任意已声明区块的实现（含核心区 body）、链式装饰现有实现（返回 defaults 保持原样）
- 布局限制由渲染器强制：宿主只认 SlotCtxMap 里的锚点 id，未知 id 编译期即被拒绝——**限制是机制不是约定**

### 锚点两级

| 级别 | 例子 | 说明 |
|---|---|---|
| 区块级 | `sidepanel` / `main` / `editorpanel` / `aipanel` / `main.body` | 替换整个面板/主区 |
| 组件级 | `review-button`、head/foot 的 left/middle/right | 细粒度装饰；**克制**：按真实需求逐个开放 |

### 锚点纪律

- **锚点 id 稳定性**：锚点 id 一经发布即为公开 API，改名破坏所有插件；锚点清单登记于 §6，变更需记录
- ctx 契约最小化：恒空为默认态；数据走 stores、动作走公开 action、零件直接 import 宿主组件

## 4. 数据支柱：stores 直连 + 公开 action

插件 `import { useXxxStore } from '@/stores'` 直接订阅（zustand 全局 store + 编译时 alias）。公开 stores/action：

| store | 内容 | 同步方 |
|---|---|---|
| `layoutStore` | sidebarOpen / toggle / close / settingsMenuOpen / **breadcrumb**（页面面包屑） | LayoutShell 持有侧栏状态；页面同步面包屑 |
| `editorStore` | dirty / saving / **doSave**（保存动作唯一入口） | 编辑页同步 |
| `reviewStore` | **startReview(focus?)**（发起审阅，seq + focus 通道） | 页面订阅 seq 走保存+autoSubmit 链路；AiPanel 消费 focus |
| `aiInputStore` | input / streaming / placeholder / **send / abort**（输入区受控协议） | AiPanel 注册实现，插件替换输入/发送按钮共用 |

- 写操作唯一入口：doSave / startReview 等；插件禁止拼装内部业务流（如直接 import api/stream 拼 SSE）
- 契约类型复用 `@coeditor/shared`，编译期校验

## 5. 事件支柱：bus 事件总线

`src/plugin/bus.ts`：`bus.on/off/emit`，事件名 `pluginId:事件名` 命名空间，fire-and-forget，单 handler 异常不阻断。

已使用事件：
- `auth:changed`（登录态变化，auth 插件发）
- `doc:changed`（文档创建/删除，documentStore 发）
- `review:completed` / `review:failed`（审阅流结束/失败，AiPanel 发）

**不做**：命令层（见纪律 3）、超时、深度限制、中间件、插件间 request/response。

## 6. 锚点登记（已落地）

| 锚点 | 级别 | ctx | 挂载处 |
|---|---|---|---|
| `root` | 特殊 | 空 | app.tsx |
| `settings-menu` | 组件 | 空 | SettingsMenu.tsx |
| `sidepanel` | 区块 | 空 | LayoutShell（sidebar 区块） |
| `sidepanel.head/body/foot` | 区块 | 空 | Sidebar.tsx（head=logo+标题/收起、body=章节树、foot） |
| `sidepanel.head.left/middle/right`、`sidepanel.foot.left/middle/right` | 组件 | 空 | Sidebar.tsx |
| `main` | 区块 | 空 | LayoutShell（main 容器） |
| `main.head/body/foot` | 区块 | 空 | LayoutShell（head=面包屑/设置、body=首页内容或 editor+ai、foot） |
| `main.head.left/middle/right`、`main.foot.left/middle/right` | 组件 | 空 | LayoutShell |
| `editorpanel` | 区块 | 空 | LayoutShell（editor 区块） |
| `editorpanel.head/body/foot` | 区块 | 空 | EditorPanel.tsx（head=draft tabs、body=书写区、foot=保存+审阅） |
| `editorpanel.head.left/middle/right`、`editorpanel.foot.left/middle/right` | 组件 | 空 | EditorPanel.tsx |
| `aipanel` | 区块 | 空 | LayoutShell（ai 区块） |
| `aipanel.head/body/foot` | 区块 | 空 | AiPanel.tsx（head=会话 tabs、body=对话气泡区、foot=输入+发送） |
| `aipanel.head.left/middle/right`、`aipanel.foot.left/middle/right` | 组件 | 空 | AiPanel.tsx |
| `review-button` | 组件 | 空 | EditorPanel.tsx（editorpanel.foot.right 内） |

注：v1 的 topbar-*/sidebar-top/bottom/editor-top/bottom/ai-top/bottom 及 `settings.trigger` 别名已随锚点树重构移除；`ui.host` → root 别名保留（slot-core）。

## 7. 验证样本：审阅维度插件（已落地）

把"审阅"按钮扩展为下拉（先做两维：审剧情 / 审人物弧光）。三层拆分，各归其位：

| 层 | 归属 | 落地内容 |
|---|---|---|
| 维度能力 | **后端（svr）** | `ai.chat` 可选 `reviewFocus`（plot/character，`AiService.FOCUS_PROMPTS` 代码常量注入维度指令）；校验 `ReviewFocusInvalid`；集成测试覆盖 |
| 发起动作 | **client 公开 action** | `stores/reviewStore.ts` `startReview(focus?)` → 编辑页订阅 seq 走保存+autoSubmit 链路 → AiPanel 消费 focus 随 `streamAiResponse` 下发 `reviewFocus`；stream.ts `StreamParams` 加 reviewFocus；完成/失败发 `review:completed`/`review:failed` |
| UI 下拉 | **插件（coeditor-saas 闭源）** | `plugins/review.tsx` 装饰 `review-button` 锚点：下拉（综合/审剧情/审人物弧光）→ `startReview`；订阅 review 事件复位"审阅中"状态 |

理由：后端丢弃客户端 system 消息（防注入），维度指令前端塞不进去，只能走 reviewFocus 参数；SSE 链路封装在 client 内部，插件拼流会绕过归属/持久化/取消语义。

## 8. 落地记录（2026-08）

1. ✅ **LayoutShell 骨架**（workspace coeditor 重构线）：sidepanel + main 两栏、headbar→head/footbar→foot、窄屏浮层、侧栏宽度拖拽、面包屑
2. ✅ **锚点树统一命名**：`sidepanel`/`main`/`editorpanel`/`aipanel` + head/body/foot + left/middle/right（body 级锚点补齐）
3. ✅ **ctx 全收空**：所有锚点 ctx = `SlotCtx`（Record<string, never>）；受控协议（dirty/saving/doSave、输入框、发送）store 化（editorStore/aiInputStore/layoutStore）
4. ✅ **事件总线**：`bus.ts`；auth:changed / doc:changed / review:completed / review:failed
5. ✅ **验证样本**：svr reviewFocus → reviewStore.startReview → review-button 锚点 → SaaS review 插件下拉
6. ⏳ **auth 插件**：登录门挂 main.body（首页），bus 发 auth:changed；未登录强制回首页逻辑保留（登录门在首页 main.body）

## 9. 明确不做（防跑偏清单）

- ❌ 命令层（invoke/useAction/动作注册表/中间件/超时/深度限制）——评审结论：合理但性价比过低
- ❌ 面板注册系统（声明式 panels）——用户中心用锚点 + stores 足够，真需要再上
- ❌ 沙箱/Webview（L3 自由画布）——无第三方生态之前不碰
- ❌ ctx 承载数据或动作句柄——一律走数据柱
- ❌ 运行时动态加载插件——维持编译时注入（v1 原则不变）

## 10. 决策记录（2026-08）

1. **锚点替换模型**：插件只能在宿主声明布局内替换区块实现，不能突破 layout（"想画哪块画哪块"的收敛定义）
2. **ctx 恒空**：lpReserved 式扩展哨位；新增字段需评审（评审结论：现有插件零消费 ctx，清空零成本且 additive 兼容）
3. **三支柱**：UI（锚点替换）+ 数据（stores 直连 + 公开 action）+ 事件（bus 通知）；命令层经两轮讨论后砍掉
4. **事件 = 通知**，非命令：UI 触发动作 = 调用公开 action（Promise 直连），不经过事件总线
5. **能力归位原则**：prompt/编排/鉴权等核心能力进后端或宿主公开 action，插件只做 UI 与组合；防注入（丢 system 消息）等安全边界不因插件开放而放松
6. **本体归属**：插件体系属于 coeditor 本体（nuclearg/coeditor，workspace 根 `coeditor/` 仓库），SaaS 宿主（coeditor-saas）通过 submodule + 编译时注册表注入插件
