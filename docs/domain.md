# CoEditor 领域模型（Domain Model）

> **本文档是领域模型的唯一权威来源。**
> 任何实现（开源版 `coeditor` / Java 版 `coeditor-svr` / 前端）若与本文冲突，以本文为准。
> 修改领域模型必须先改本文，再同步两端实现与 `docs/api.md`。

## 1. 产品定位

- **人类是主笔，AI 是编辑，绝不喧宾夺主**：AI 只对作者明确指定的内容给出审阅意见或回答，不代写、不覆盖原文。
- 产品核心价值：**向作者展示每个版本之间的完整历史**——适合精雕细琢的严肃文学创作。

## 2. 核心实体

| 实体 | 说明 |
|---|---|
| **Document**（文档） | 作品容器；归属一个用户；引用一个 Template |
| **Template**（模板） | 定义文档的附件种类 + **内置审阅 prompt**（顶层按场景×风格 + 附件级）；随包内联（`resources/templates/*.json`） |
| **Attachment**（附件） | 文档下按模板定义的设定材料（大纲 / 世界观 / 人设 / 人物关系…）；`type` 是业务键 |
| **Chapter**（章节） | 正文结构层；文档 1:N 章节（有序） |
| **Paragraph**（段落） | 正文基本单元；章节 1:N 段落（有序） |
| **Draft**（草稿） | 段落/附件内容的**版本快照**（content + version + createdAt），不可变；每次保存产生新版本 |
| **Conversation**（会话） | AI 对话组；1:N **Turn**；有类型（casual / attachment_review / paragraph_review / chapter_review） |
| **Turn** | 一次问答：question + answers[]（AI 可生成多个候选答案） |
| **Answer** | AI 回复（content + thinking + model） |

## 3. 关键关系（不变量）

### 3.1 版本历史

- `Paragraph 1:N ParagraphDraft`、`Attachment 1:N AttachmentDraft`——**版本历史完整保留、不可变**，`currentDraftId` 仅指向最新版本。
- 每次保存 → 创建新版本 → 切换 `currentDraftId`。
- 这是产品对"展示每个版本之间的完整历史"的模型基础。

### 3.2 draft:conversation 严格 1:N（核心不变量）

- **每个草稿版本拥有自己的会话（组）**；`draftId` 是会话的归属维度。
- **用户提问/审阅都基于某个 draftVersion 发起**：会话创建时记录 `draftId`，后续消息都落在该版本桶内。
- **每次保存产生新版本 → 切换会话窗口**（新版本对应空会话桶）。这是设计意图，不是缺陷。
- 无草稿概念的场景（章节审阅 / 全文审阅 / 闲聊）不设 `draftId`，按实体归属（`chapterId` / `documentId`）。
- 会话同时保留**实体归属**（`paragraphId` / `attachmentId`），用于 AI 上下文加载（按实体找内容、按 draftId 找版本内容）。

### 3.3 审阅

- **每次审阅总是新开会话**（不复用、不重试旧会话），便于对比不同版本的审阅意见。
- 审阅上下文 = **会话归属的 `draftId` 对应的草稿内容**（版本与内容严格一致，不读"当前最新草稿"）。
- 审阅风格（温和/严厉/鼓励）在模板 prompts 内按 `style` 细分。

### 3.4 审阅 prompt 与上下文

- prompt 全部内置于模板：顶层按场景（fulltext/chapter/paragraph/casual）× 风格（gentle/strict/praise），附件审阅用附件级 prompts；无独立 prompts 目录。
- 变量约定：`${附件type}`（如 `${outline}`，当前被审附件用自身 type）· `${document}`（全文正文，不含附件）· `${currentChapter}` · `${currentParagraph}` · `${currentChapterPrevParagraphs}`。
- **system prompt 由服务端组装并渲染变量**；丢弃客户端传入的 system 消息（防注入）；前端不传 contentContext。

## 4. 实体字段

```ts
Document     { id, userId, title, description, templateId, attachmentOrder, chapterOrder, createdAt, updatedAt }

Template     { id, name, desc?, summary?, prompts?: { 场景: { 风格: 文案 } }, attachments: AttachmentDef[] }
AttachmentDef{ type, name, contextLabel, prompts?: { 风格: 文案 } }   // 附件审阅 prompt

Attachment   { id, type, documentId, name, currentDraftId, createdAt }
AttachmentDraft { id, attachmentId, version, content, createdAt }

Chapter      { id, documentId, title, paragraphOrder, createdAt }
Paragraph    { id, chapterId, name, currentDraftId }
ParagraphDraft  { id, paragraphId, version, content, createdAt }

Conversation { id, type, documentId, attachmentId?, paragraphId?, chapterId?, draftId?, createdAt }
Turn         { id, conversationId, order, question, answers[], currentAnswerIndex, createdAt }
Answer       { id, content, thinking, model, createdAt }
```

## 5. 实现对照（双端必须一致）

| 概念 | 开源版（coeditor） | Java 版（coeditor-svr） |
|---|---|---|
| 类型定义 | `packages/shared/src/types.ts` | `web/editor/*Resp|Req`、`biz/editor/domain/*DO` |
| 会话归属 draftId | `AiConversation.draftId`；`conversations.create/list` 支持 draftId | `ConversationDO.draftId`；create/list 支持 draftId；Flyway `V3`（`editor_conversation.draft_id`） |
| 会话分桶 | 前端 `conversationStore`/`AiPanel` 按 `draftId` 分桶（`bucketId = draftId || parentId`） | 无前端（共用开源前端） |
| 按 draft 读内容 | `lib/prompt-context.ts`（`draftContent`） | `PromptRenderService`（`paragraphDraftContent`/`attachmentDraftContent`） |
| 审阅新开会话 | `AiPanel.autoSubmit` 总是 `createConversation` | 无（前端共用） |

## 6. 变更纪律

1. 修改领域模型 → 先改本文。
2. 双端实现（开源版 + Java 版）+ `docs/api.md` 必须同步，不允许一端先行另一端长期偏离。
3. `draft:conversation 1:N`、版本历史不可变、审阅总是新开会话、服务端组装 system prompt——四项核心不变量，**不得为局部实现便利而违背**。
