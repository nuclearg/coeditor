# CoEditor 文档

CoEditor 项目文档索引。文档基于源码实况维护，改动代码时请同步更新。

## 文档列表

| 文档 | 内容 | 适用读者 |
|------|------|----------|
| [api.md](api.md) | 完整 HTTP API 参考：RPC 约定、数据模型、40+ 端点请求/响应/错误语义 | 前端开发者、后端迁移者、API 调用方 |
| [storage.md](storage.md) | 文件系统存储规范：目录结构、文件格式、原子写、一致性约束、迁移机制 | 存储层开发者、需要直接读写数据文件的运维 |
| [plugin.md](plugin.md) | 前端插件机制（唯一权威）：插件接口、页面形态 variant、扩展页面位、锚点插槽、内置插件、编译时注入（`PLUGIN_REGISTRY_PATH`） | 部署方、需要扩展前端能力的开发者 |

## 快速导航

- **API 约定**：全部 `POST /api/{resource}.{action}`，统一 `{ success, data }` / `{ success, error }` 响应；除 `ai.chat`（SSE）外 HTTP 状态码恒为 200
- **AI 配置接口**：`settings.get` / `settings.update`（`api.md` §14）
- **流式对话**：`ai.chat`（SSE）、`ai.cancel`（`api.md` §12）
- **存储根目录**：`data/users/$userId/docs/...`（`storage.md` §2）

## 维护约定

- 新增/修改 RPC 端点时同步更新 `api.md` 对应章节
- 修改存储布局或文件格式时同步更新 `storage.md`
- 修改插件接口或注入机制时同步更新 `plugin.md`
