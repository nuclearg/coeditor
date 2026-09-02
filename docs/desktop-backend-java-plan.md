# 开源版后端 Node → Java 重写改造方案

> 状态：方案已定，待实施（2026-08-31 讨论定稿，计划次日开工）
> 原则：**保持文件系统 JSON 存储（不用 DB）**、Tauri 套壳不变、复用 coeditor-svr 的 AI/模板资产

---

## 1. 背景与目标

开源版（`coeditor`）当前前后端都是 Node.js：前端 Taro H5（复用），后端 Hono RPC（`packages/server`，~4884 行 TS，含测试），Tauri 桌面壳用 `bun build --compile` 打成单文件 sidecar（用户无需装 Node）。

**问题**：Node 后端用户看不懂、不敢改 → 开源版演进僵死；且与 SaaS（coeditor-svr，Java）形成"一个前端、两套后端"的平行实现，必然漂移。

**目标**：用 Java 重写开源版后端（沿用个人 Java 技术栈），**存储行为保持文件系统 JSON 不变**（无 DB、无 JPA、无 Flyway），套进 Tauri 壳（用户零安装运行时）。

---

## 2. 现状（已核实的事实）

### 2.1 Node 后端规模
- `packages/server/src/`：11 个 route（documents/chapters/paragraphs/paragraph-drafts/attachments/attachment-drafts/templates/conversations/turns/ai/settings），业务代码 ~2952 行 + 测试 ~1900 行
- 契约：`POST /api/{resource}.{action}` → `{success, data|error}`（与 svr 同一契约，同一前端在用）

### 2.2 文件存储行为（Java 复刻必须对齐）
- 布局：`data-dir.json` 指针 → `DATA_ROOT/users/{userId}/docs/{docId}`、`config.json`、`templates/{templateId}.json`
- 原子写：临时文件 `*.tmp.{pid}.{ts}.{counter}` → `rename`（同卷原子）
- 读损坏 JSON：`readJSONOrNull` 降级为 null（warn）；`readJSONOrThrow` 包装用户文案
- 软删：移 `trash/` 目录（保留可手工找回），rename 同卷原子
- 数据目录偏好：平台默认目录下 `data-dir.json`（macOS `~/Library/Application Support/coeditor/`），`COEDITOR_DATA_DIR_FILE` 可覆盖

### 2.3 Tauri 接线（不变）
- `desktop/src-tauri/tauri.conf.json`：`externalBin: ["binaries/coeditor-server"]`，`beforeDevCommand: scripts/dev.sh`，`beforeBuildCommand: build-desktop.sh`
- `lib.rs`：启动 spawn sidecar、退出 kill（与后端语言无关，原样复用）

---

## 3. 目标架构

```
Tauri 壳（不变；externalBin 换成 java 启动的 jar）
  └─ Java 后端（Spring Boot 4.1，web + jackson 两个 starter；无 jpa/flyway/datasource）
        ├─ FileRepository：复刻 Node file-io（原子写/损坏降级/trash 软删/布局/数据目录指针）
        ├─ Domain Service：翻译 Node 11 个 route 的纯业务逻辑
        ├─ AiRepo：从 coeditor-svr 直接搬（DeepSeek + SSE 流式 + thinking，与存储无关）
        ├─ TemplateManager：从 svr 搬（novel/essay 模板结构 + seed）
        └─ BYOK 配置：AI key/base/model 读用户 config.json（前端设置页已写，后端只读）
```

**数据目录兼容**：读取同一份 `data-dir.json` 指针 + 同一布局 → 存量用户数据零迁移（Node 版写过的文件 Java 直接读）。

---

## 4. 复用 / 翻译 / 砍掉边界

| 从 svr 直接搬（几乎零成本） | 翻译 Node（纯逻辑搬移） | 砍掉 |
|---|---|---|
| `AiRepo`（流式/SSE/thinking/错误处理，改配置源为文件） | 11 个 route 的**文件版**业务逻辑 | JPA/实体/DAO/Flyway |
| `TemplateManager`（模板结构 + seed） | `FileRepository`（照抄 file-io 行为，~300 行 Java） | 鉴权/cookie/JWT |
| `ReviewManager.buildSystemContent`（prompt 组装） | BYOK 配置读取（svr 是 env → 改读 config.json） | Billing/用户体系 |

> 注意：svr 的 Manager 全是 DB 驱动，不能直接搬；Node 版业务逻辑在 TS 里，翻译成 Java 即可。真正"抄作业"的是 **AiRepo + 模板 + prompt**（与存储无关的三块）。

---

## 5. 技术栈

- **Spring Boot 4.1**（与 svr 同版本）：`spring-boot-starter-web` + jackson（`JsonMapperBuilderCustomizer` 同 svr）
- 存储：`java.nio.file`（`Files.move(..., ATOMIC_MOVE)` 对等 rename；`ObjectMapper.readValue` 失败 → 降级对等）
- 打包：**jlink 精简 JRE + fat jar**（约 60MB + 60MB，用户无需装 Java；不走 native-image——Spring/JPA 反射坑多，且本方案已无 JPA）
- 端口：固定本地端口（与 Node 版一致，前端 API base 不变）

---

## 6. 分阶段实施计划

### Phase 0：PoC（半天，验证三大风险点）
- [ ] `FileRepository`：按 Node 布局读写 + 原子写 + 损坏降级 + trash 软删
- [ ] `documents.list/create/get` 文件存储跑通，返回 JSON 契约与 Node 一致
- [ ] Tauri `externalBin` 换成 java 启动 jar，WebView 里 BYOK 流程可用
- 通过 → 全量投入；不通过 → 重新评估

### Phase 1：存储层 + 基础域（1 周）
- [ ] `FileRepository` + `data-dir` 指针 + `config.json`（BYOK/AI 配置读取）
- [ ] documents / chapters / paragraphs / paragraph-drafts 四个 route 翻译 + 对齐 Node 测试
- [ ] templates（从 svr 搬模板结构 + seed）

### Phase 2：附件 + 会话 + AI（1 周）
- [ ] attachments / attachment-drafts / conversations / turns 翻译
- [ ] AiRepo 从 svr 搬入（BYOK 配置源）+ 流式 SSE
- [ ] settings（风格/CoT/数据目录）route

### Phase 3：收尾（0.5~1 周）
- [ ] Node 侧测试（8 个文件）逐一对齐为 Java 测试（vitest → JUnit/MockMvc）
- [ ] 前端契约核对（Node route 的字段逐一比对）
- [ ] jlink 打包 + Tauri externalBin 接线 + 构建脚本（build-desktop.sh 改 java）
- [ ] 存量文件数据兼容验证（Node 写的数据 Java 能读）
- [ ] AGENT.md / docs 更新

**总估**：1.5~3 周（一人）

---

## 7. 风险与对策

| 风险 | 对策 |
|---|---|
| 行为对齐漂移（Node 测试是唯一基准） | Phase 3 用 Node 测试清单逐条对拍，优先把 Node 测试转成 Java 测试 |
| 前端契约隐藏差异（Node 有些端点字段 svr 没有） | Phase 1 开始时做接口清单 diff（`routes/*.ts` 的请求/响应类型 vs 前端调用） |
| 文件并发/原子性 | 单进程 + 原子 rename，与 Node 完全同构，无新风险；确认 Windows rename 语义 |
| jlink 体积 | ~110MB 与 bun 单二进制 ~90MB 相当，可接受 |
| AI 流式行为不一致 | AiRepo 直接搬 svr（SaaS 已线上验证），行为天然一致 |

---

## 8. 验收标准

- [ ] 无 DB 依赖（依赖树里无 jpa/flyway/datasource）
- [ ] 存量 Node 数据目录可直接被 Java 版读取（零迁移）
- [ ] 前端零改动跑通全流程（建文档/编辑/审阅/AI 流式/BYOK 配置）
- [ ] Tauri 构建产物：用户安装后无任何运行时安装步骤
- [ ] Node 测试清单全部在 Java 侧有对应测试
