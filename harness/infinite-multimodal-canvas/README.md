# 无限节点画布多模态 Harness

本 Harness 用于先验证无限画布的产品交互与工作流契约，再接入真实后端、模型或 Codex Runner。

它覆盖五类基础组合：

1. 文生图（Text → Image）
2. 图生图（Image + Text → Image）
3. 文生视频（Text → Video）
4. 图生视频（Image + Text → Video）
5. 图 + 文 + 插件（Image Collection + Text + Plugin → Artifact Collection）

当前版本不调用任何真实模型。它提供：

- 类型化节点与端口目录；
- 五类可加载到画布的工作流模板；
- 拓扑、端口兼容性、必填输入和执行范围校验；
- 设计、运行、审阅三种模式的交互验收规则；
- 未来接入 NodeRun、Artifact、Plugin 与 Skill Adapter 的稳定边界。

## 目录

```text
infinite-multimodal-canvas/
├── HARNESS.md
├── README.md
├── package.json
├── bin/validate.mjs
├── catalog/node-definitions.json
├── examples/workflows.json
├── schemas/harness-manifest.schema.json
├── schemas/workflow.schema.json
├── prototype/index.html
├── prototype/graph-core.js
├── prototype/main.js
├── prototype/styles.css
└── tests/harness.test.mjs
```

## 本地验证

```bash
npm test
npm run validate
npm run benchmark
npm run build
npm run build:xyflow-spike
```

`npm run dev` 使用 Harness 自带的零依赖静态服务器；可通过 `HARNESS_PORT` 修改端口。

验证成功表示模板能被节点画布安全加载；不表示真实 AI 模型已经可用。

## 可点击 Web 原型

`prototype/` 是独立、无后端的交互验证页，当前支持：

- 五类组合模板切换；
- 26 个类型化节点，按素材、生成、转换、插件、控制、质量和结果分组；
- 文生图、图生图、文生视频、图生视频和分镜插件模板均连接 Validator 与 Gate；
- 节点目录搜索、拖入和双击添加；
- 节点拖动、框选、Shift 多选、整组拖动/复制/删除、撤销和重做；
- Typed Port 拖拽连线、实时兼容高亮与点击连线备用路径；
- 端口释放到空白时只推荐兼容节点，并在创建后自动接线；
- 节点分组、折叠、整组移动以及节点启用/禁用；
- 连线扩大命中区域、重接来源与重接目标；
- 节点/连线/画布右键菜单；
- 节点 Inspector 的配置、输入、输出、运行、问题、历史视图；
- 多资产选择、预览与模拟绑定；
- 多资产引用和角色写入节点配置，并在节点摘要中显示真实绑定数量；
- 设计、运行、审阅模式；
- 本地预检、模拟 NodeRun 和运行抽屉；
- 浏览器本地自动保存；
- Inspector 未选择时隐藏、节点库可收起、DAG 拓扑布局与 70% 最低可读缩放；
- 基于真实节点范围和当前视口计算的可导航缩略图；
- 无固定像素边界的世界坐标，可容纳负坐标和远距离节点；
- 节点与分组拖动只更新被移动节点、相邻连线和所属分组，不重建整张画布；
- 连线锚点优先读取真实 DOM 端口中心，适配动态节点高度；
- 与实际操作一致的快捷键帮助面板；
- 插件配置管理中心，支持草稿、已发布版本和本地持久化；
- 可增删并配置插件输入/输出端口的类型、基数和必填约束；
- Skill 文本分析、媒体/脚本/Prompt 识别及插件 Schema 转换；
- 插件契约测试台，可验证 JSON、必填输入并生成模拟 Artifact 收据；
- 发布后的自定义插件立即进入节点库并可拖入画布；
- 完整工作流、所选节点、运行到此、从此运行四种执行范围；
- WorkflowRun 与 NodeRun 的 queued、running、succeeded、failed、blocked、skipped 状态；
- 可选择节点注入模拟故障，并从失败节点重试、继续下游执行；
- 运行事件时间线、问题列表、冻结输入与输出快照、最终运行收据；
- 图片集合、视频和脚本文档 Artifact 查看器；
- 独立工程管理中心，可创建、切换并保存多个本地工程；
- 工程、当前工程 ID 与 WorkflowDraft 使用同一持久化状态树，刷新和切换不再读取独立全局画布草稿；
- 首次载入自动迁移 V0.7 工程及其遗留画布草稿；
- 工作流草稿、发布版本、版本恢复与版本时间线；
- 成功运行自动归档到工程运行历史，并可回看 JSON 收据；
- 发布快照锁定插件 NodeDefinition 版本与 Executor Ref；
- V0.7 工作流 JSON 导出、格式校验与导入为草稿；
- V0.8 画布检查、版本发布、JSON 导入和 CLI 共用同一个 `graph-core`；
- 校验结果使用稳定错误码，可定位节点、连线和字段路径；
- `file://` 下通过内嵌目录数据加载，不依赖 JSON `fetch`。

它用于交互验收，真实运行仍必须通过受控 Runner。

## 画布接入原则

- 前端读取 `catalog/node-definitions.json` 生成节点库与端口。
- 前端读取 `examples/workflows.json` 生成模板画布。
- 创建连线时执行与 `bin/validate.mjs` 相同的端口兼容规则。
- 运行前冻结工作流版本、节点配置和输入资产引用。
- 真实执行必须由受控 Runner 根据 `executorRef` 路由，浏览器不得提交命令、目录或 Shell。

完整规则见 [HARNESS.md](./HARNESS.md)。

## V0.8 客观验收

V0.7 功能闭环完成后的独立验收、P0 阻塞项、模块评分与后端接入顺序见：

- [V0.8 客观验收与后端接入决策](./V0.8-客观验收与后端接入决策.md)
- [历史评估基线](./EVALUATION.md)

当前决策为：交互原型有条件通过，先完成状态、校验、画布内核、资产引用、运行归档和插件安全整改，再连接真实 Runner。

其中 P0-1“状态源分裂”已在 V0.8 完成：自动保存、手动保存、新建工程、切换工程和刷新恢复均以当前 Project 的 WorkflowDraft 为唯一来源。

P0-2“校验规则分裂”也已完成本地整改：浏览器预检、发布、导入和 CLI 均调用 `prototype/graph-core.js`，覆盖未知节点定义、非法端口、类型不兼容、单值端口重复连接、必填输入、未声明环路、插件执行路由和依赖锁。

P0-3 已完成第一阶段画布内核整改：移除固定 `5000×3200` 边界，支持负坐标、远坐标、动态网格、最低 2% 全图适配、真实端口锚点和拖动增量更新。`npm run benchmark` 提供 1000 节点计算基线；`?benchmarkNodes=300` 提供真实 DOM 基线。

P0-3 的 XYFlow 隔离 Spike 已完成：300/1000 节点可见区域渲染、Canvas Adapter、多资产节点、Typed Port 和 GraphCore 共用校验均已验证。正式入口尚未切换，迁移门槛与交互矩阵见 [XYFlow 迁移评估与 Canvas Adapter](./XYFLOW-迁移评估与Canvas-Adapter.md)。

M2 第一阶段已补齐 Canvas Adapter 往返一致性和领域命令历史。节点移动、菜单添加、节点与关联边合并删除均已验证可以一次撤销并重做；命令历史独立于 React 组件状态。

M2 第二阶段已完成显式多选、基础分组、Typed Port 新建与重连回归。合法连接可进入命令历史，非法类型连接与非法重连不会破坏现有图。

M2 第三阶段已完成 XYFlow Project Store：领域命令自动保存到当前工程，刷新、工程切换、版本发布/恢复和分组往返均已验证。Spike 使用隔离存储键，未连接真实后端，也不会覆盖正式 V0.8 原型状态。

M2 第四阶段已完成分组交互闭环：整组拖动、组内移动、折叠/展开、取消分组、刷新恢复和防嵌套规则均已验证；同时新增 [Project Repository 接口与冲突策略](./PROJECT-REPOSITORY-接口与冲突策略.md)，只提供接口与内存契约实现，未连接真实服务。

M3 第一阶段已完成模拟执行闭环：插件节点显示实际 `executorRef`，WorkflowRun/NodeRun 按拓扑推进，画布同步展示 queued/running/succeeded/failed/blocked 状态；支持故障注入、下游阻塞、从失败节点重试、事件时间线、运行收据，以及多图片与脚本文本 Artifact Viewer。成功运行会归档到当前工程，详情见 [M3 模拟运行与 Artifact 交互验收](./M3-模拟运行与Artifact交互验收.md)。
