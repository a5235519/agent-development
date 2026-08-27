# 柠萌旅行记 Agent 工作台交互原型 V4

基于完整制作流程、评估闭环、管理端治理、多资产、插件配置和 Skill 转插件方案实现的浏览器交互草稿。

## 已实现的主路径

- 制作工作区、评估工作区与管理控制台切换
- 测试集、基线/候选版本、Evaluator、人工复核与发布 Gate 评估画布
- 失败样本图片对照、证据解释及一键加入回归集
- EvaluationSuite、EvaluationRun、Evaluator 与 GateDecision 领域契约
- 可替换的 Mock Agent Workbench API，界面运行态已不再依赖页面内定时器
- 六阶段导航与 React Flow 无限画布
- 多资产集合节点及 Artifact Store 批量上传弹层
- 多文件上传队列、图片本地预览、Artifact Role 与重复处理策略
- 工程 Artifact 查询，展示镜号、SHA-256、生产 Run 与文件大小
- 画布资产集合与分镜集合按 Artifact Store 实时刷新，空工程使用明确标记的示例降级
- 工程资产支持文件名、镜号、Hash 与 Artifact Role 筛选
- 右侧检查器支持真实脚本内容、相邻镜、版本时间线与来源血缘查看
- 资产支持“上传替换版本”，自动继承版本组和来源 Artifact
- 版本检查器支持持久化“设为当前”，并提供可点击的上下游关系图
- 上游版本变化会递归标记下游 Artifact 为 `STALE`，画布同步显示失效镜头
- 评估工作区通过 SSE/EventSource 接收开始、完成和失败事件
- 页面刷新后可从本地 Run ID 或服务端运行列表恢复 EvaluationRun
- 镜号覆盖与来源完整性结果进入真实指标聚合，不再只显示固定示例分数
- EvaluationRun 完成后自动持久化 GateDecision，并回写制作阶段状态
- SSE 连接提供周期性 `HEARTBEAT`，前端据此续租运行所有权
- 使用 `localStorage + sessionStorage` 实现跨标签页执行锁，阻止重复创建评估 Run
- 统一 SQLite Repository 持久化 EvaluationRun、Event、Artifact、GateDecision 和回归样本
- SQLite 使用 WAL 与事务写入，并支持从旧 JSON 元数据一次性迁移
- 服务重启后恢复 Run、事件、资产、Gate 和回归样本，Artifact 文件内容继续独立存放
- Repository Factory 支持 SQLite/PostgreSQL 驱动切换，两个 Adapter 通过同一套契约测试
- 服务端持久化租约阻止同工程评估被重复创建，并支持续租、释放与过期接管
- Evaluation Event 改为追加式事件表，按 Run 与 sequence 回放，不再整批覆盖
- Run、Artifact、Gate 和回归样本采用细粒度 upsert，降低多实例快照互相覆盖风险
- 跨实例 SSE：PostgreSQL 使用 `LISTEN/NOTIFY + 补偿轮询`，SQLite 使用 sequence 游标轮询
- Human Review 自动从失败样本创建任务，支持证据图预览、领取锁、意见和 PASS/FAIL/NEEDS_CHANGES
- 复核提交生成新的 GateDecision 并保留 `supersedesDecisionId`，同时写入不可覆盖的审计事件
- Reviewer/Admin 权限由 API 强制校验；当前原型使用请求头模拟身份，正式身份服务仍待接入
- 图片、脚本、执行、问题、版本检查器
- 任务优先条：当前阻塞、证据、最小修复范围与下一 Gate
- 图片资产、结构化脚本、前后镜连续性同屏切换
- 插件执行预检已接入真实 NodeRun 队列 API 与 SSE 进度
- Validator 失败及 S13 单镜修复支持取消、超时和一次受控重试
- `storyboard-draft@1.4.0` Plugin Contract 在服务端白名单冻结，浏览器不能提交命令、Shell 或工作目录
- Local Contract Runner 提供注册、心跳、租约、审计与 NodeRun Receipt；当前为 `contract-dry-run`，尚不伪造图片产物
- 配置 `CODEX_GATEWAY_URL` 后切换为 `remote-codex-app-server`，复用 Remote Codex Control 的 Gateway/Runner/stdio JSONL 链路
- 每次真实运行创建独立 attempt 目录，输入文件只读，Codex 只能在 `staging/` 产出
- Collector 强制校验 `node-result.json`、路径边界、符号链接、Artifact Role、镜号覆盖与 SHA-256 后才提交产物
- 修复运行必须冻结正式脚本、视觉参考、S12 和 S14；缺项时前后端 Preflight 均阻止创建 Codex Turn
- 可切换的管理总览、工程、模板、Runner、权限与审计视图
- 插件输入输出 Schema 编辑与节点实时预览
- Skill 分析、AI 推断确认门禁和六步插件转换向导

评估对象模型、Gate 规则和工程化建议见 [evaluation-workspace-design.md](./evaluation-workspace-design.md)。

领域规则位于 `src/domain/evaluation.js`，示例数据位于 `src/data/evaluationSuite.js`，后端适配边界位于 `src/services/mockAgentWorkbenchApi.js`。后续接入真实服务时应保持该接口语义，并替换 Mock 实现。

## 运行真实 Evaluation API

```bash
npm run dev:full
```

该命令同时启动 Vite Web 与 `127.0.0.1:8788` Evaluation API，并通过 Vite `/api` 代理连接。API 将实体元数据持久化到 `.data/agent-workbench.sqlite`，Artifact 文件内容存放在 `.data/artifact-files/`；普通 `npm run dev` 继续使用 Mock API，便于仅查看交互。首次启动会读取旧 JSON 元数据并迁移到 SQLite，之后不再写回旧 JSON。

真实 API 还提供 Artifact 上传、查询和内容读取，并保存 `SHA-256 / producerRunId / sourceArtifactIds` 来源链；制作工作区的“资产”入口已经接入这组接口。版本变化会递归写入下游失效状态。`POST /api/evaluator-runs` 可执行镜号覆盖与来源完整性校验。评估工作区使用 EventSource，SSE 支持 `Last-Event-ID`，断线后不会重复消费已确认事件。

也可以分别运行：

```bash
npm run dev:api
VITE_AGENT_API=http npm run dev
```

连接 PostgreSQL 时使用：

```bash
AGENT_REPOSITORY=postgres DATABASE_URL=postgresql://user:password@host:5432/agent_workbench npm run dev:api
```

服务启动时会按顺序执行 `server/migrations/postgres/` 中的版本化 SQL。当前 PostgreSQL Adapter 已完成存储契约、追加事件、服务端租约与跨实例 Event Pub/Sub；SQLite 本地模式通过轻量游标轮询提供相同 SSE 语义。

## 连接真实 Codex Runner

工作台不直接启动 Codex，也不接受浏览器传入 prompt、命令或 cwd。先启动 `remote-codex-control` 的 Gateway 与 Runner，并将 Runner 的 `ALLOWED_ROOTS` 限制为工作台 `.data/node-runs`：

```bash
# remote-codex-control
RUNNER_TOKEN=<local-token> npm run start:gateway
RUNNER_TOKEN=<local-token> \
ALLOWED_ROOTS=/absolute/path/to/prototype-v4/.data/node-runs \
npm run start:runner

# prototype-v4
CODEX_GATEWAY_URL=http://127.0.0.1:8787 npm run dev:full
```

Gateway 任务固定使用 `workspace-write + approvalPolicy=never`。Codex Turn 完成只代表执行结束；只有 Collector 提交成功后 NodeRun 才会是 `COMPLETED`。

## 本地运行

```bash
npm install
npm run dev
```

## 验证

```bash
npm run build
npm test
```

当前基线为 35/35 自动化测试通过，覆盖 Human Review、角色权限、Gate 修订、NodeRun 队列，以及 Codex Gateway 桥接、空输入门禁、隔离目录、越界拒绝、Artifact 提交和收据。SQLite 使用 Node 22 内置 `node:sqlite`；本地运行应使用 Node.js 22 或更高版本。

初版设计审查见 `interaction-audit.md`，场景化复评见 `interaction-audit-v2.md`，视觉与交互验收见 `design-qa.md`。
