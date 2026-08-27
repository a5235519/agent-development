# Agent 工作台技术架构 V1

## 边界

前端只负责编辑、可视化、发起命令和订阅状态；Runner 才能调用 Codex、Skill 与插件。浏览器不得直接访问本地工程目录或持有执行凭证。

## 核心对象

| 对象 | 职责 | 不可变字段 |
| --- | --- | --- |
| Project | 柠萌旅行记单集工程 | `id`, `root`, `templateVersion` |
| WorkflowVersion | 一张已保存的节点图 | `version`, `nodeDefinitions`, `edges` |
| NodeRun | 单节点执行凭证 | `definitionVersion`, `inputSnapshot`, `skillRoute` |
| Artifact | 图片、脚本、视频或结构化结果 | `role`, `uri`, `hash`, `producerRunId` |
| EvaluationSuite | 测试集、版本、Evaluator 与 Gate 策略 | 所有版本引用 |
| EvaluationRun | 一次可复现的评估 | 数据集、候选、基线与 Evaluator 版本 |
| GateDecision | 阶段是否解锁 | `policyVersion`, `verdict`, `evidence` |

## API 契约

```text
GET  /api/projects/:projectId
GET  /api/projects/:projectId/workflow-versions/:version
POST /api/node-runs
GET  /api/node-runs/:runId
GET  /api/node-runs/:runId/events
GET  /api/artifacts?projectId=&role=&shotId=
POST /api/artifacts
GET  /api/artifacts/:artifactId/content

GET  /api/evaluation-suites/:suiteId
POST /api/evaluation-runs
GET  /api/evaluation-runs/:runId
GET  /api/evaluation-runs/:runId/events
POST /api/evaluation-datasets/:datasetId/regression-cases
POST /api/gate-decisions
POST /api/evaluator-runs
```

所有创建命令接受 `Idempotency-Key`；运行响应首先返回 `QUEUED/RUNNING` 收据，再通过 SSE 推送事件。前端刷新后通过 Run ID 恢复，而不是重新执行。

## 事件格式

```json
{
  "eventId": "evt_...",
  "runId": "eval_...",
  "sequence": 12,
  "type": "EVALUATOR_COMPLETED",
  "occurredAt": "2026-08-11T10:25:31.000Z",
  "payload": {
    "caseId": "CASE-013",
    "evaluatorId": "composition-continuity",
    "score": 0.63,
    "threshold": 0.80,
    "verdict": "FAIL",
    "evidenceArtifactIds": ["artifact_expected", "artifact_candidate"]
  }
}
```

客户端必须按 `sequence` 去重和排序；断线后携带最后的 `eventId` 继续订阅。

## Gate 规则

Gate 采用“硬规则优先、总分其次”：

1. 必需 Artifact、镜号覆盖和来源追踪任一失败，立即阻塞。
2. 必需人工复核未完成，保持阻塞。
3. 候选版本相对基线发生超阈值回归，保持阻塞。
4. 以上全部通过后再检查加权质量分。

GateDecision 只能引用已经完成的 EvaluationRun，且必须保存策略版本和失败证据。

## Runner 与 Codex

建议链路为：`Web → Gateway → Queue → Runner → Codex/Skill/Plugin → Artifact Store → Event Store`。

- Gateway：鉴权、幂等、权限策略和目录白名单。
- Queue：并发、取消、重试和优先级。
- Runner：创建隔离运行目录，解析插件契约，调用 Codex，并生成 NodeRun 收据。
- Artifact Store：保存文件与 Hash；元数据进入数据库。
- Event Store：追加式记录运行事件，供 UI 恢复与审计。

## 已实现的后端切片

- Node HTTP Evaluation API 与 `/api/health`。
- EvaluationSuite 查询、EvaluationRun 创建/查询和幂等键。
- EvaluationRun SSE 事件回放与完成通知。
- SQLite Repository 持久化，使用 WAL、事务写入和 Schema Migration 版本表。
- 旧 JSON 元数据可一次性迁移；Artifact 大文件继续与元数据分离存储。
- Repository Factory 可按环境选择 SQLite 或 PostgreSQL；两个 Adapter 运行相同契约测试。
- PostgreSQL 使用 JSONB、事务替换和独立版本化迁移 SQL。
- Evaluation Event 使用追加式事件表；服务端租约以原子获取、Token 续租和条件释放控制执行所有权。
- 常用业务写入使用实体级 upsert，避免整类快照覆盖并发实例新增的数据。
- PostgreSQL 使用 `LISTEN/NOTIFY` 推送事件，并以 sequence 轮询补偿断线窗口；SQLite 使用游标轮询实现本地跨实例订阅。
- Human Review 任务由 EvaluationRun 失败样本自动创建，领取使用持久化租约，提交必须携带领取 Token。
- 每次复核结论都会生成新 GateDecision，并通过 `supersedesDecisionId` 保留决策链；创建、领取和提交均进入审计实体。
- 历史失败回归样本写入与 GateDecision API。
- HTTP/Mock 双适配器；`VITE_AGENT_API=http` 时连接真实服务。
- API、SSE、幂等、持久化与 Gate 自动测试。
- Artifact 文件与元数据分离存储，记录 SHA-256、生产 Run 和来源 Artifact。
- 镜号覆盖、资产来源完整性两个确定性 Evaluator。
- SSE `Last-Event-ID` 断线续传与事件文件持久化。

## 下一实现切片

SQLite、本地恢复、EventSource、确定性 Evaluator 聚合和 Artifact 版本图谱已经落地。下一切片是生产持久化与执行面：

1. 接入 Queue 与 Codex Runner；Runner 只消费已发布插件契约，不接受浏览器任意命令。
2. 将原型请求头身份替换为正式用户、角色和工程授权服务。
