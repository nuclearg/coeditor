# CoEditor API 参考

CoEditor 后端 HTTP API 完整文档。基于 `packages/server/src/routes/*` 的代码实况整理，是前后端协作的契约依据。

## 约定

### 传输与端口

- 服务地址：`http://localhost:3001`（`PORT` 环境变量可覆盖）
- 所有接口均走 **HTTP**，生产环境由 Nginx 反代 `/api` 到后端

### 请求

- RPC 风格：`POST /api/{resource}.{action}`，body 为 JSON
- `Content-Type: application/json`
- 请求体上限 **8MB**（`bodyLimit` 中间件）
- CORS：仅允许 `localhost` / `127.0.0.1` 来源（`cors` 中间件）

### 响应格式

除 `ai.chat`（SSE 流式）外，所有接口统一返回：

```jsonc
// 成功
{ "success": true, "data": <T> }

// 失败
{ "success": false, "error": "<错误信息>" }
```

- 业务错误（资源不存在、校验失败等）一律 HTTP 200 + `success: false`
- 未捕获的服务端异常由全局 `onError` 捕获，同样返回 HTTP 200 + `success: false`

### 数据模型（@coeditor/shared）

| 类型 | 字段 |
|---|---|
| `Document` | `id, userId, title, description, templateId, attachmentOrder: string[], chapterOrder: string[], createdAt, updatedAt` |
| `Chapter` | `id, documentId, title, paragraphOrder: string[], createdAt` |
| `Paragraph` | `id, chapterId, name, currentDraftId` |
| `ParagraphDraft` | `id, paragraphId, version: number, content, createdAt` |
| `DocumentTemplate` | `id, name, attachments: AttachmentDef[]` |
| `AttachmentDef` | `type, name, contextLabel` |
| `Attachment` | `id, documentId, name, currentDraftId, createdAt` |
| `AttachmentDraft` | `id, attachmentId, version: number, content, createdAt` |
| `AiConversation` | `id, type, documentId?, attachmentId?, paragraphId?, chapterId?, createdAt` |
| `AiTurn` | `id, conversationId, order: number, question, answers: AiAnswer[], currentAnswerIndex, createdAt` |
| `AiQuestion` | `content, questionVisible: boolean, createdAt` |
| `AiAnswer` | `id, content, thinking, model, createdAt` |
| `AppSettings` | `apiKey, apiBaseUrl, model, style` |

### 通用约束

- **`safeId`**：所有 ID 参数必须是字符串，且**禁止**包含 `/`、`\`、`..`（防路径穿越）
- **`generateId()` 格式**：`<14位时间戳>_<随机字符>`，例如 `20260811065506_8jc72a0`
- 所有时间为 ISO 8601 字符串（如 `2026-08-11T06:55:06.000Z`）

---


## 1. 文档 documents

### `POST /api/documents.list`
列出所有文档（按 `updatedAt` 倒序）。

- 请求：`{}`
- 响应：`Document[]`

### `POST /api/documents.create`
创建文档。

- 请求：
  ```jsonc
  {
    "id": "safeId, 可选（不传则自动生成）",
    "title": "string, 必填, 1-200 字",
    "description": "string, 可选, ≤2000 字",
    "templateId": "safeId, 可选（默认 'novel'）"
  }
  ```
- 响应：`Document`（新建时 `chapterOrder: []`，`attachmentOrder` 按模板初始化）

### `POST /api/documents.get`
获取单个文档。

- 请求：`{ "docId": "safeId" }`
- 响应：`Document`
- 错误：`文档不存在`

### `POST /api/documents.update`
更新文档标题/描述。

- 请求：`{ "docId": "safeId", "title?": "string, 1-200", "description?": "string, ≤2000" }`
- 响应：`Document`（`updatedAt` 自动刷新）

### `POST /api/documents.delete`
删除文档（**级联删除**全部章节/段落/草稿/会话）。

- 请求：`{ "docId": "safeId" }`
- 响应：`null`
- 错误：`文档不存在`

### `POST /api/documents.reorderChapters`
重排章节顺序。

- 请求：`{ "docId": "safeId", "chapterOrder": "safeId[]" }`
- 响应：`null`
- 错误：
  - `chapterOrder 包含重复的章节 ID`
  - `chapterOrder 必须包含所有现有章节 ID`
  - `文档不存在`

---

## 2. 章节 chapters

### `POST /api/chapters.list`
按文档章节顺序返回章节列表。

- 请求：`{ "docId": "safeId" }`
- 响应：`Chapter[]`

### `POST /api/chapters.create`
创建章节（自动追加到 `chapterOrder` 末尾）。

- 请求：`{ "docId": "safeId", "title": "string, 必填, 1-200 字" }`
- 响应：`Chapter`（新建时 `paragraphOrder: []`）
- 错误：`文档不存在`

### `POST /api/chapters.get`
获取单个章节。

- 请求：`{ "docId": "safeId", "chapterId": "safeId" }`
- 响应：`Chapter`
- 错误：`章节不存在`

### `POST /api/chapters.update`
更新章节标题。

- 请求：`{ "docId": "safeId", "chapterId": "safeId", "title?": "string, 1-200" }`
- 响应：`Chapter`

### `POST /api/chapters.delete`
删除章节（**级联删除**其段落/草稿，并从 `chapterOrder` 移除）。

- 请求：`{ "docId": "safeId", "chapterId": "safeId" }`
- 响应：`null`

---

## 3. 段落 paragraphs

### `POST /api/paragraphs.list`
按章节段落顺序返回段落列表。

- 请求：`{ "docId": "safeId", "chapterId": "safeId" }`
- 响应：`Paragraph[]`

### `POST /api/paragraphs.create`
创建段落（自动追加到 `paragraphOrder` 末尾）。

- 请求：`{ "docId": "safeId", "chapterId": "safeId", "name?": "string, ≤200" }`
- 响应：`Paragraph`（`currentDraftId: ""`）
- 错误：`章节不存在`

### `POST /api/paragraphs.get`
获取单个段落。

- 请求：`{ "docId": "safeId", "chapterId": "safeId", "paragraphId": "safeId" }`
- 响应：`Paragraph`
- 错误：`段落不存在`

### `POST /api/paragraphs.update`
更新段落名称/当前草稿。

- 请求：
  ```jsonc
  {
    "docId": "safeId", "chapterId": "safeId", "paragraphId": "safeId",
    "name?": "string, ≤200",
    "currentDraftId?": "safeId"
  }
  ```
- 响应：`Paragraph`

### `POST /api/paragraphs.delete`
删除段落（**级联删除**其草稿，并从 `paragraphOrder` 移除）。

- 请求：`{ "docId": "safeId", "chapterId": "safeId", "paragraphId": "safeId" }`
- 响应：`null`

### `POST /api/paragraphs.reorder`
重排段落顺序。

- 请求：`{ "docId": "safeId", "chapterId": "safeId", "paragraphOrder": "safeId[]" }`
- 响应：`null`
- 错误：
  - `paragraphOrder 包含重复的段落 ID`
  - `paragraphOrder 必须包含所有现有段落 ID`
  - `章节不存在`

---

## 4. 段落草稿 paragraphDrafts

### `POST /api/paragraphDrafts.list`
列出段落全部草稿（按版本倒序）。

- 请求：`{ "docId": "safeId", "chapterId": "safeId", "paragraphId": "safeId" }`
- 响应：`ParagraphDraft[]`

### `POST /api/paragraphDrafts.create`
创建新草稿（**自动把段落 `currentDraftId` 指向它**）。

- 请求：`{ "docId": "safeId", "chapterId": "safeId", "paragraphId": "safeId", "content": "string, ≤100000" }`
- 响应：`ParagraphDraft`（`version` 为当前序号）
- 错误：`段落不存在`

### `POST /api/paragraphDrafts.get`
获取单个草稿。

- 请求：`{ "docId": "safeId", "chapterId": "safeId", "paragraphId": "safeId", "draftId": "safeId" }`
- 响应：`ParagraphDraft`
- 错误：`草稿不存在`

### `POST /api/paragraphDrafts.delete`
删除草稿。若删除的是当前草稿，自动将 `currentDraftId` 切到最新剩余草稿（无剩余则为空串）。

- 请求：`{ "docId": "safeId", "chapterId": "safeId", "paragraphId": "safeId", "draftId": "safeId" }`
- 响应：`null`

---

## 5. 模板 templates

### `POST /api/templates.list`
列出全部文档模板（从数据目录 `templates/*.json` 加载，首次运行由内置资源 `resources/templates/` 种子化）。

- 请求：`{}`
- 响应：`DocumentTemplate[]`

### `POST /api/templates.get`
获取单个模板。

- 请求：`{ "templateId": "safeId" }`
- 响应：`DocumentTemplate`
- 错误：`模板不存在`

---

## 6. 附件 attachments

文档附件（如大纲、世界观、人设），种类由文档模板定义。附件 ID 即类型 key（如 `outline`），一个类型在文档中对应一个附件。

### `POST /api/attachments.list`
列出文档全部附件（按 `document.attachmentOrder` 顺序）。

- 请求：`{ "docId": "safeId" }`
- 响应：`Attachment[]`

### `POST /api/attachments.ensure`
按类型幂等创建附件（已存在则原样返回），**首次创建时生成一个空草稿**。名称优先取模板定义。

- 请求：`{ "docId": "safeId", "type": "safeId", "name": "string, ≤100, 可选" }`
- 响应：`Attachment`

### `POST /api/attachments.get`
获取单个附件。

- 请求：`{ "docId": "safeId", "type": "safeId" }`
- 响应：`Attachment`
- 错误：`附件不存在`

### `POST /api/attachments.update`
更新附件名称或切换当前草稿。

- 请求：`{ "docId": "safeId", "type": "safeId", "name": "string, ≤100, 可选", "currentDraftId": "safeId, 可选" }`
- 响应：`Attachment`
- 错误：`附件不存在`

### `POST /api/attachments.delete`
删除附件（含全部草稿，并从 `attachmentOrder` 移除）。

- 请求：`{ "docId": "safeId", "type": "safeId" }`
- 响应：`null`

---

## 7. 附件草稿 attachmentDrafts

### `POST /api/attachmentDrafts.list`
列出附件全部草稿（按版本倒序）。

- 请求：`{ "docId": "safeId", "type": "safeId" }`
- 响应：`AttachmentDraft[]`

### `POST /api/attachmentDrafts.create`
创建新附件草稿（**自动把附件 `currentDraftId` 指向它**；附件不存在时先自动创建）。

- 请求：`{ "docId": "safeId", "type": "safeId", "content": "string, ≤100000" }`
- 响应：`AttachmentDraft`
- 错误：`附件不存在`

### `POST /api/attachmentDrafts.get`
获取单个附件草稿。

- 请求：`{ "docId": "safeId", "type": "safeId", "draftId": "safeId" }`
- 响应：`AttachmentDraft`
- 错误：`草稿不存在`

### `POST /api/attachmentDrafts.delete`
删除附件草稿。若删除的是当前草稿，自动将 `currentDraftId` 切到最新剩余草稿。

- 请求：`{ "docId": "safeId", "type": "safeId", "draftId": "safeId" }`
- 响应：`null`

---

## 8. AI 会话 conversations

`ConversationType = 'casual' | 'attachment_review' | 'paragraph_review' | 'chapter_review'`

会话与文档实体（`parentId`）关联，关联字段随类型不同：

| type | parentId 含义 | 会话上落地的字段 |
|---|---|---|
| `casual` | 文档 ID | `documentId` |
| `attachment_review` | 附件类型 | `attachmentId` |
| `paragraph_review` | 段落 ID | `paragraphId` |
| `chapter_review` | 章节 ID | `chapterId` |

### `POST /api/conversations.list`
按类型 + 父实体列出会话。

- 请求：`{ "docId": "safeId", "parentId": "safeId", "type": "ConversationType" }`
- 响应：`AiConversation[]`

### `POST /api/conversations.create`
创建会话。

- 请求：`{ "docId": "safeId", "type": "ConversationType", "parentId": "safeId" }`
- 响应：`AiConversation`（自动携带 `documentId` 及类型对应关联字段）

### `POST /api/conversations.get`
获取单个会话。

- 请求：`{ "docId": "safeId", "convId": "safeId" }`
- 响应：`AiConversation`
- 错误：`会话不存在`

### `POST /api/conversations.delete`
删除会话（**级联删除**其全部 turn）。

- 请求：`{ "docId": "safeId", "convId": "safeId" }`
- 响应：`null`

---

## 9. 对话轮次 turns

### `POST /api/turns.list`
列出会话全部 turn（按 `order` 升序）。

- 请求：`{ "docId": "safeId", "convId": "safeId" }`
- 响应：`AiTurn[]`

### `POST /api/turns.create`
创建 turn（**无占位 answer，`answers: []`**——真实 answer 由 `ai.chat` 流式写入）。

- 请求：
  ```jsonc
  {
    "docId": "safeId", "convId": "safeId",
    "question": "string, ≤100000",
    "questionVisible?": "boolean"      // 默认 true
  }
  ```
- 响应：`AiTurn`

### `POST /api/turns.get`
获取单个 turn。传 `convId` 为 O(1) 直达；不传则全库扫描兜底。

- 请求：`{ "docId": "safeId", "turnId": "safeId", "convId?": "safeId" }`
- 响应：`AiTurn`
- 错误：`Turn 不存在`

### `POST /api/turns.delete`
删除 turn。传 `convId` 为 O(1) 直达；不传则扫描定位。

- 请求：`{ "docId": "safeId", "turnId": "safeId", "convId?": "safeId" }`
- 响应：`null`
- 错误：`Turn 不存在`

### `POST /api/turns.selectAnswer`
切换当前选中的 answer（多候选切换）。

- 请求：`{ "docId": "safeId", "turnId": "safeId", "convId?": "safeId", "answerIndex": "integer ≥ 0" }`
- 响应：`AiTurn`
- 错误：`Turn 不存在` / `无效的 answerIndex`

---

## 10. AI 能力 ai

### `POST /api/ai.chat`
**SSE 流式接口，不遵循标准响应格式。**

请求体：

```jsonc
{
  "docId": "safeId",
  "convId": "safeId",
  "turnId": "safeId",
  "answerId?": "safeId",                     // 流式持久化目标 answer（建议前端生成）
  "messages": [                               // 1-100 条
    { "role": "user|assistant|system", "content": "string ≤200000" }
  ],
  "model?": "string",                          // 缺省用设置中的模型
  "reviewType?": "paragraph|attachment|chapter|fulltext|casual"
}
```

服务端行为：

1. 按 `reviewType` + 审阅风格从**模板内置 prompts**选取并渲染 `${}` 变量（附件/全文/章节/段落/段落前文），**丢弃客户端传入的 system 消息**（防注入）
2. 调用 `{apiBaseUrl}/chat/completions`（OpenAI 兼容，`stream: true`）
3. **流式过程中节流（1s）将累积内容持久化到 turn 的 answer**（固定 `answerId` 原地更新）
4. **客户端断开不影响持久化**——后端继续读完 upstream 响应并完整落盘；只有 `ai.cancel` 才会中止
5. 限流：每 IP 20 次/分钟（取真实 TCP socket 地址，不信任 forwarding headers）

SSE 事件（`data: <json>`）：

```jsonc
{ "thinking": "<增量 thinking 片段>" }   // 推理过程增量
{ "content": "<增量 content 片段>" }     // 正文增量
{ "error": "<错误信息>" }                // 终止错误（连接失败/Key 无效/API 地址错误/上游异常等）
```

非流式 JSON 错误响应（校验失败/未配置 Key/限流）遵循标准格式：

```jsonc
{ "success": false, "error": "<错误信息>" }
```

### `POST /api/ai.cancel`
显式取消某个 turn 的流式生成（后端停止读取上游并落盘已生成部分）。

- 请求：`{ "docId": "safeId", "convId": "safeId", "turnId": "safeId" }`
- 响应：`null`

---

## 11. 设置 settings

### `POST /api/settings.get`
获取设置（API Key 掩码：仅保留末 4 位，其余 `*`；≤4 位时全 `*`）。

- 请求：`{}`
- 响应：`AppSettings`（`apiKey` 已掩码）

### `POST /api/settings.update`
更新设置。

- 请求：
  ```jsonc
  {
    "apiKey?": "string",                       // 空串=清除；含 * 的掩码值会被忽略（防回写污染）
    "apiBaseUrl?": "string, 必须是合法 URL",
    "model?": "string",
    "style?": "gentle | strict | praise"
  }
  ```
- 响应：`AppSettings`（`apiKey` 已掩码）

---

## 12. 健康检查

### `GET /api/health`
- 响应：`{ "success": true, "data": { "status": "ok" } }`

---

## 数据存储布局

```
data/
├── templates/                      # 文档模板（定义附件种类 + 内置审阅 prompt）
│   ├── novel.json  essay.json
├── users/
│   └── default_user/
│       ├── config.json             # AppSettings（含明文 API Key！）
│       └── docs/
│           └── {docId}/
│               ├── document.json
│               ├── attachments/    # 按附件类型拆分目录
│               │   └── {type}/     # 如 outline/、worldview/
│               │       ├── {type}.json
│               │       └── {draftId}.md
│               ├── chapters/
│               │   └── {chapterId}/
│               │       ├── chapter.json
│               │       └── paragraphs/
│               │           └── {paragraphId}/
│               │               ├── paragraph.json
│               │               └── {draftId}.md
│               └── conversations/
│                   └── {convId}/
│                       ├── conversation.json
│                       └── {turnId}.json
```

## 其他服务端行为

- **启动初始化**：`repo.initialize()` 确保用户目录 + 默认 config 存在
- **写入原子性**：所有 JSON/MD 写入走 tmp 文件 + rename；失败清理 tmp
- **并发控制**：单用户系统无锁；原子写保证文件不损坏，前端防重保证实际无并发写
- **路径安全**：所有 `docId/chapterId/paragraphId/draftId/convId/turnId` 均拒绝 `/`、`\`、`..`
