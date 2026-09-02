# CoEditor 存储布局

CoEditor 后端采用**纯文件系统存储**（无数据库）。本文档描述磁盘上的目录/文件结构、每个文件的格式与用途。

## 数据根目录

```
DATA_ROOT = 环境变量 COEDITOR_DATA_DIR（必须显式设置，缺失时启动报错）
- dev 模式：packages/server/package.json 的 dev script 自动设为 ../../data
- 生产模式：start.sh 设为脚本所在目录/data
- 测试：vitest setupFiles 设为临时目录
```

生产部署通过 `bash start.sh` 启动，数据位于项目根 `data/`。

## 目录树总览

```
data/
├── prompts/                         # AI 审阅 prompt 模板（按审阅风格，随代码仓库提交）
│   ├── gentle.json                  # 温和：平衡优缺点，建设性建议
│   ├── strict.json                  # 严厉：批判性审阅，只找问题
│   └── praise.json                  # 鼓励：以肯定为主，温和提建议
├── templates/                       # 文档模板（定义文档的附件种类，随代码仓库提交）
│   └── novel.json                   # 小说模板：大纲 / 世界观 / 人设 / 人物关系
└── users/
    └── {userId}/                    # 当前只有 default_user（单用户模式）
        ├── config.json              # 用户设置（AppSettings，⚠️ 含明文 API Key）
        └── docs/
            └── {docId}/             # 一个文档一个目录
                ├── document.json    # 文档元数据（含 templateId、attachmentOrder）
                ├── attachments/     # 附件（按类型拆分目录，一个类型一个附件）
                ├── chapters/        # 章节树
                └── conversations/   # AI 会话 + turn
```

## 各文件详解

### 根级

### prompts/

每个文件对应一种审阅风格，字段固定（`PromptFile`）：

```jsonc
{
  "fulltextReview":   "全文审阅系统提示词",
  "chapterReview":    "章节审阅系统提示词",
  "attachmentReview": "附件审阅系统提示词",
  "paragraphReview":  "段落审阅系统提示词",
  "casual":           "自由问答系统提示词"
}
```

读取时与内置默认值合并（`{ ...defaults, ...data }`），文件缺失/字段缺失时回退默认。

### templates/

每个文件对应一个文档模板（`DocumentTemplate`），定义该文档可用的附件种类：

```jsonc
{
  "id": "novel",
  "name": "小说",
  "attachments": [
    { "type": "outline",    "name": "大纲",     "contextLabel": "文章大纲" },
    { "type": "worldview",  "name": "世界观",   "contextLabel": "世界观设定" }
  ]
}
```

- `type`：附件类型 key（同时用作附件目录名与附件 ID）
- `name`：附件显示名
- `contextLabel`：附件内容拼入 AI 审阅上下文时的包装标签（`[文章大纲]\n${content}`）

### users/{userId}/

| 路径 | 格式 | 内容 |
|---|---|---|
| `config.json` | JSON | `AppSettings`：`{ apiKey, apiBaseUrl, model, style }`。<br>⚠️ **apiKey 为明文存储**，`settings.get` 返回时才掩码 |

### users/{userId}/docs/{docId}/

#### `document.json`

```jsonc
{
  "id": "20260811052918_x4podxx",
  "userId": "default_user",
  "title": "文档标题",
  "description": "",
  "templateId": "novel",                    // 所属模板（决定附件种类）
  "attachmentOrder": ["outline", "worldview"],  // 附件顺序（唯一排序依据，按模板初始化）
  "chapterOrder": ["<chapterId>", "..."],   // 章节顺序（唯一排序依据）
  "createdAt": "2026-08-11T05:30:03.398Z",
  "updatedAt": "2026-08-11T05:30:03.398Z"
}
```

#### `attachments/`

```
attachments/
└── {type}/                     # 附件类型 key（如 outline / worldview）
    ├── {type}.json             # 附件元数据（outline.json / worldview.json）
    └── {draftId}.md            # 附件草稿内容（一个草稿一个文件）
```

`{type}.json`：

```jsonc
{
  "id": "outline",              // 附件 ID = 类型 key
  "documentId": "<docId>",
  "name": "大纲",                // 显示名（默认取模板定义）
  "currentDraftId": "<draftId>", // 指向当前激活的附件草稿
  "createdAt": "2026-08-11T05:30:03.398Z"
}
```

`{draftId}.md`：纯 Markdown 文本（附件正文）。**版本号与 createdAt 不落盘**：版本由目录内 `.md` 文件按文件名排序推导（`listAttachmentDrafts` 计算），createdAt 由 `parseIdCreated(draftId)` 从 ID 时间戳前缀推导（`/^(\d{14})_/`），推导失败时回退当前时间。

> 首次调用 `attachments.ensure` 时会自动创建 `{type}.json` 并生成一个空草稿文件，`currentDraftId` 指向该草稿；同时把类型记入 `document.json.attachmentOrder`。

#### `chapters/`

```
chapters/
└── {chapterId}/
    ├── chapter.json                  # 章节元数据
    └── paragraphs/
        └── {paragraphId}/
            ├── paragraph.json        # 段落元数据
            └── {draftId}.md          # 段落草稿内容（一个草稿一个文件）
```

`chapter.json`：

```jsonc
{
  "id": "<chapterId>",
  "documentId": "<docId>",
  "title": "章节标题",
  "paragraphOrder": ["<paragraphId>", "..."],   // 段落顺序（唯一排序依据）
  "createdAt": "2026-08-11T05:30:03.398Z"
}
```

`paragraph.json`：

```jsonc
{
  "id": "<paragraphId>",
  "chapterId": "<chapterId>",
  "name": "段落名",
  "currentDraftId": "<draftId>"    // 指向当前激活的段落草稿；无草稿时为空串 ""
}
```

> 注意：早期版本写入的 chapter.json / paragraph.json 可能残留 `order` 字段，代码从不读取（排序分别依赖 `document.json.chapterOrder` 与 `chapter.json.paragraphOrder`），新写入的数据不含该字段。

`{draftId}.md`：纯 Markdown 文本（段落正文）。**版本号与 createdAt 不落盘**：版本由目录内 `.md` 文件按文件名排序推导（`listParagraphDrafts` 计算），createdAt 由 `parseIdCreated(draftId)` 从 ID 时间戳前缀推导，推导失败时回退当前时间。

#### `conversations/`

```
conversations/
└── {convId}/                       # 一个会话一个目录
    ├── conversation.json           # 会话元数据
    └── {turnId}.json               # 每个 turn 一个文件
```

`conversation.json`（`AiConversation`）：

```jsonc
{
  "id": "<convId>",
  "type": "casual | attachment_review | paragraph_review | chapter_review",
  "documentId": "<docId>",                    // casual / 所有类型都带
  "attachmentId": "<type>",                   // attachment_review 时存在（附件类型 key）
  "paragraphDraftId": "<draftId>",            // paragraph_review 时存在
  "chapterId": "<chapterId>",                 // chapter_review 时存在
  "createdAt": "2026-08-11T05:30:03.398Z"
}
```

`{turnId}.json`（`AiTurn`）：

```jsonc
{
  "id": "<turnId>",
  "conversationId": "<convId>",
  "order": 1,                                  // 会话内顺序
  "question": {
    "content": "用户提问",
    "questionVisible": true,                   // false = AI 审阅自动提交的隐藏问题
    "createdAt": "2026-08-11T05:30:03.398Z"
  },
  "answers": [                                 // 候选答案列表
    {
      "id": "<answerId>",
      "content": "AI 回复正文",
      "thinking": "推理过程（reasoning_content）",
      "model": "deepseek-v4-pro",
      "createdAt": "2026-08-11T05:30:03.398Z"
    }
  ],
  "currentAnswerIndex": 0,                     // 当前选中的候选
  "createdAt": "2026-08-11T05:30:03.398Z"
}
```

## 文件格式与写盘规则

| 规则 | 说明 |
|---|---|
| JSON | `JSON.stringify(data, null, 2)` 缩进 2 空格写入 |
| Markdown | 原样文本写入（UTF-8） |
| 原子写入 | 所有写入先写 `{path}.tmp.{pid}.{ts}.{seq}` 临时文件，再 `rename` 到目标；失败时清理临时文件 |
| 目录创建 | 写入前自动 `mkdir -p`（无缓存，每次直接调用） |
| 编码 | 全部 UTF-8 |

## 一致性约束

1. **排序字段单一来源**
   - 附件顺序 = `document.json` 的 `attachmentOrder`（不读目录/文件名排序）
   - 章节顺序 = `document.json` 的 `chapterOrder`（不读目录/文件名排序）
   - 段落顺序 = `chapter.json` 的 `paragraphOrder`
   - turn 顺序 = `AiTurn.order` 字段

2. **草稿版本号与 createdAt 不落盘**
   - 版本由目录内 `.md` 文件名排序（字典序，即时间戳序）推导：`version = index + 1`
   - `createdAt` 由 `parseIdCreated(draftId)` 从 ID 时间戳前缀（`/^(\d{14})_/`）推导，失败时回退当前时间
   - 排序方向：列表返回**版本倒序**（最新的在前）

3. **currentDraftId 维护规则**
   - 创建草稿 → 自动把父实体 `currentDraftId` 指向它（附件/段落草稿均如此）
   - 删除当前草稿 → 自动切到"文件名排序最后一个"剩余草稿；无剩余则置空串 `""`
   - 附件/段落的 `currentDraftId` 可能为空串（尚无草稿），允许

4. **级联删除**
   - 删文档 → 删整个 `docs/{docId}/` 目录
   - 删附件 → 删 `attachments/{type}/`（含其草稿），并从 `attachmentOrder` 移除
   - 删章节 → 删 `chapters/{chapterId}/`（含其 paragraphs）
   - 删段落 → 删 `paragraphs/{paragraphId}/`（含其草稿）
   - 删会话 → 删 `conversations/{convId}/`（含其 turns）

5. **ID 生成格式**
   - `generateId()`：`<14位时间戳 yyyymmddHHMMSS>_<随机 base36>`，如 `20260811052918_x4podxx`
   - 时间戳前缀保证文件名按字典序排序 == 按创建时间排序（草稿版本推导依赖此性质）
   - 附件 ID 例外：直接使用模板定义的 `type`（outline / worldview 等），不做随机生成

6. **路径安全**
   - 所有 ID（docId/chapterId/paragraphId/draftId/convId/turnId）及附件 `type` 必须通过 `safeId` 校验（拒绝 `/`、`\`、`..`），防路径穿越

## 并发控制

- 单用户系统，**无锁**。所有写操作依赖原子写（tmp + rename）保证文件不被破坏
- 读-改-写操作（create/update/delete/reorder 及草稿维护）在并发写同一文件时可能丢失一次中间结果，但不会产生损坏文件；当前前端有防重机制（发送锁等），实际不会并发

## 完整示例树

```
data/
├── prompts/
│   ├── gentle.json
│   ├── strict.json
│   └── praise.json
├── templates/
│   └── novel.json
└── users/
    └── default_user/
        ├── config.json
        └── docs/
            └── 20260811052918_x4podxx/
                ├── document.json
                ├── attachments/
                │   ├── outline/
                │   │   ├── outline.json
                │   │   ├── 20260811053003_rijevck.md
                │   │   └── 20260811142651_1cs893z1bozo9d.md
                │   └── worldview/
                │       ├── worldview.json
                │       └── 20260811144815_ofgdcwqn28rm.md
                ├── chapters/
                │   └── 20260811053003_kbe0q23/
                │       ├── chapter.json
                │       └── paragraphs/
                │           ├── 20260811053003_yp92zvj/
                │           │   ├── paragraph.json
                │           │   ├── 20260811053459_21pbg1x.md
                │           │   └── 20260811125309_d8a9rrsh8y2d.md
                │           └── 20260811053049_gs8h1ie/
                │               ├── paragraph.json
                │               └── 20260811053710_o52s0fv.md
                └── conversations/
                    ├── 20260811144531_6bu9d81ra6d1g/
                    │   ├── conversation.json
                    │   └── 20260811144531_q2ibcu16oech3.json
                    └── 20260811144815_chh9y5js4dko/
                        ├── conversation.json
                        └── 20260811144815_ofgdcwqn28rm.json
```
