# XYFlow 迁移评估与 Canvas Adapter 方案

更新日期：2026-08-13  
状态：P0-3 技术验证完成，建议分阶段迁移，不直接替换正式画布

## 1. 结论

建议以 `@xyflow/react 12.11.3` 作为画布交互内核候选，将现有 `graph-core`、NodeDefinition、WorkflowDraft、Artifact、Plugin 与 Skill Adapter 保留为产品领域层。

这不是“把现有页面改成 React Flow”这么简单。正确边界是：XYFlow 只负责视口、节点/连线渲染、命中、拖拽、框选、重连和可见区域渲染；项目状态、端口类型、发布锁、运行状态和资产语义仍由 Harness 控制。

当前决策为 **Proceed with staged migration（有条件推进）**。领域命令撤销栈、显式多选、分组完整交互、Typed Port、Project Store 持久化、版本恢复、模拟运行态与 Artifact Viewer 已在 Spike 完成；在鼠标右键人工复验、缩略图整改和生产级 Repository 实现完成前，不切换正式入口。

## 2. 实测结果

隔离 Spike 位于 `spikes/xyflow-canvas/`，没有改动正式 `prototype/` 入口。

| 项目 | 结果 | 证据/限制 |
| --- | --- | --- |
| 自定义多模态节点 | 通过 | NodeDefinition 驱动标题、端口、说明和资产预览 |
| 节点拖拽 | 通过 | 浏览器真实鼠标拖动后坐标 transform 发生变化 |
| 多资产可视化 | 通过 | Inspector 同时显示 4 个资产缩略图 |
| 模拟运行态 | 通过 | PREPARED/RUNNING/SUCCEEDED/FAILED/BLOCKED 注入节点外观，运行时冻结改图 |
| 插件执行路由 | 通过 | NodeRun 明示 `plugin://storyboard-draft/generate@1.4`，未在浏览器执行命令 |
| 失败与重试 | 通过 | 插件故障使下游 blocked，从失败节点复用冻结快照后成功 |
| Artifact Viewer | 通过 | 4 张图片候选网格和脚本文本均完成浏览器实测 |
| 运行归档 | 通过 | 成功 Run 写入当前工程，同 ID 幂等，最多保留 50 条 |
| Typed Port 校验 | 通过 | Canvas Adapter 调用既有 `GraphCore.compatible` |
| 统一发布前校验 | 通过 | 示例图得到“GraphCore 校验通过” |
| 右键添加 | 条件通过 | 指针右键代码路径存在；`Shift+F10` 键盘等价菜单已实测，鼠标右键仍需人工复验 |
| 多选与分组 | 通过 | 显式多选模式不依赖修饰键；两个节点可成组并一次撤销 |
| Typed Port 新建 | 通过 | 合法图片端口创建成功，错误文本到图片端口被拒绝 |
| 重连 | 通过 | 选中连线后重接成功且可撤销；非法重连保留原边 |
| 小地图与缩放控件 | 通过 | 内置 MiniMap/Controls，已适配暗色主题 |
| 300 节点 | 通过 | 状态 300，首屏约 200 ms，仅 9 个节点进入 DOM |
| 1000 节点 | 通过 | 状态 1000，首屏约 305 ms，仅 9 个节点进入 DOM |
| 生产包体 | 有风险 | JS gzip 约 132 KB；4 张原始预览图约 9.4 MB，应改缩略图与按需加载 |

性能数值是本机开发服务单次实测，只用于迁移方向判断，不是生产 SLA。

## 3. Canvas Adapter 边界

已实现 `spikes/xyflow-canvas/src/canvas-adapter.js`，负责四项转换：

1. `WorkflowNode → XYFlow Node`：保留 `definitionId`、配置和世界坐标。
2. `WorkflowEdge → XYFlow Edge`：映射 `sourcePort/targetPort` 到 Handle ID。
3. `XYFlow Connection → 类型校验`：复用 GraphCore 的端口兼容和单值端口约束。
4. `XYFlow Graph → WorkflowDraft`：还原节点、边、绝对坐标和插件依赖锁。

正式迁移时应扩展为稳定接口：

```ts
interface CanvasAdapter {
  loadGraph(draft: WorkflowDraft): void;
  exportGraph(): WorkflowDraft;
  addNode(definitionId: string, position: Point): string;
  removeSelection(): void;
  setSelection(ids: string[]): void;
  createGroup(ids: string[]): string;
  setViewport(viewport: Viewport): void;
  fit(scope: 'all' | 'selection' | 'run-path'): void;
  subscribe(listener: (event: CanvasEvent) => void): () => void;
}
```

Adapter 不能写 localStorage、调用模型、执行插件或绕过 GraphCore。所有变更先产生领域事件，再由 Project Store 持久化。

## 4. 完整交互矩阵

| 能力 | XYFlow 原生 | Harness 领域层 | 迁移动作 |
| --- | --- | --- | --- |
| 无限平移、缩放、适配全图 | 是 | 保存 viewport | 直接适配 |
| 单节点/多节点拖拽 | 是 | 写入 WorkflowDraft | 用事务合并拖动事件 |
| 框选、键盘多选、删除 | 是 | 权限与锁定规则 | 补 Mac/Windows 快捷键测试 |
| 节点库拖入、右键添加 | 部分 | NodeDefinition 分类与推荐 | 保留现有节点库信息架构 |
| Typed Port 连线 | Handle 提供交互 | GraphCore 决定兼容性 | 统一进 Adapter |
| 连线重接 | 是 | 单值端口、环路校验 | 失败时回滚旧边并解释原因 |
| 端口释放到空白推荐节点 | 否 | 兼容定义筛选 | 复用现有产品逻辑 |
| 分组、折叠、组内坐标 | 基础 parent/group | 复合节点语义 | 单层分组已完成；嵌套明确禁用 |
| 撤销/重做 | 否 | Command/Event Log | Spike 已完成；正式 Project Store 尚未接入 |
| 多资产节点与预览 | 自定义节点 | Artifact/AssetRef | 缩略图、懒加载、版本角标 |
| 插件/Skill 节点 | 自定义节点 | 插件契约与版本锁 | 不交给画布库处理 |
| 运行态与问题定位 | 自定义样式 | WorkflowRun/NodeRun | 模拟 overlay、事件、失败/重试已完成 |
| Artifact 查看 | 自定义弹层 | Artifact/AssetRef | 图片集合与脚本文本已完成；待接真实存储签名 URL |
| 项目保存、发布、恢复 | 否 | Project Store | Spike 已完成；生产 Repository 仅有接口和内存契约 |

## 5. 分阶段迁移流程

### M1：适配层与双入口

- 保留 `prototype/` 为默认入口。
- 将 Spike 接入真实 Project Store 的只读副本。
- 对同一 WorkflowDraft 做双向序列化一致性测试。
- 验收：节点/边/插件锁/资产引用往返后无信息损失。

### M2：核心编辑能力

- 接入节点增删、Typed Port、重连、右键添加、框选和快捷键。
- 建立 Command/Event Log，完成撤销重做。
- 验收：现有交互矩阵 P0 项全部自动化通过。

### M3：多模态与复合能力

- 接入多资产缩略图、Artifact Viewer、分组折叠和运行态 overlay。
- 图片节点只加载缩略图；原图在 Viewer 中按需打开。
- 验收：300 节点、1000 资产引用下交互不冻结，内存有上限。

### M4：灰度切换

- 用 feature flag 切换旧/新画布，共用同一 Project Store 和 GraphCore。
- 对真实工程做回放、保存、刷新、版本恢复与运行收据验收。
- 连续通过后再删除旧渲染内核，不删除领域契约和历史迁移器。

## 6. M2 第一阶段结果与下一优先级

已完成：

1. Canvas Adapter 往返保留 `id/title/kind`、节点配置、连线端口和插件依赖锁。
2. 独立 `command-history.js` 管理领域命令，不以 React 组件状态充当历史源。
3. 节点添加、移动、删除、连线、重连和分组接入命令历史。
4. 删除节点及其关联连线合并为同一命令；撤销后同时恢复。
5. 工具栏撤销/重做及 `Cmd/Ctrl+Z`、`Cmd/Ctrl+Shift+Z` 快捷键。
6. `Shift+F10` 提供与画布右键菜单等价的键盘入口。

浏览器实测：拖动只生成 1 条命令，撤销恢复原坐标，重做恢复移动后坐标；删除 1 个节点及 1 条关联边后，一次撤销同时恢复；菜单添加节点后可一次撤销。

M2 第二阶段已完成：

1. 新增显式“多选模式”，鼠标、触控和自动化均不依赖 Meta/Control 修饰键。
2. 两个节点可创建基础父组，分组作为单一命令撤销。
3. 合法 `image.collection → image.collection` 连线创建成功并进入命令历史。
4. 非法 `text.prompt → image.collection` 连接被 Typed Port 规则拒绝。
5. 连线选中后可重接到兼容插件端口；一次撤销恢复原目标。
6. 非法重连不会删除旧边，并提示“已保留原连线”。

M2 第三阶段已完成：

1. 独立 `project-store.js` 管理 `Project { draft, versions, runs, draftEvents }`。
2. 每个领域命令提交后自动将 WorkflowDraft 写回当前工程。
3. 刷新页面从当前工程恢复节点、边、配置和分组。
4. 新建及切换工程前先保存当前草稿，工程之间互不串图。
5. 发布版本后可恢复为新草稿；恢复本身进入命令历史并可撤销。
6. Canvas Adapter 补充分组成员、组坐标、尺寸及节点绝对坐标往返。
7. Project Store 使用独立 Spike 存储键，不读写正式原型的 V0.8 存储。

历史边界：页面刷新或切换工程时清空内存撤销栈，避免跨工程撤销；工程内仅持久化最近 100 条轻量 `draftEvents` 审计信息，不持久化整份 before/after 快照。

M2 第四阶段已完成：

1. 自定义 Group Node 支持选择、整体拖动、折叠、展开与取消分组。
2. 折叠只改变显示高度，展开尺寸独立保存，不会因折叠覆盖。
3. 取消分组先换算世界坐标，成员视觉位置不跳变。
4. 组内节点可独立移动并在刷新后恢复。
5. 当父组与成员同时被选中时，命令提交前归一化成员相对坐标，避免双重位移。
6. 折叠、展开、取消分组和移动分组均进入命令历史与自动保存。
7. 当前产品规则明确为单层分组；对已分组节点再次建组会阻止并解释原因。
8. 已定义未来 Project Repository 的异步接口、revision 乐观并发、离线和冲突策略，尚未连接真实后端。

M3 第一阶段已完成：

1. 新增纯领域 `run-engine.js`，按 DAG 拓扑构造 WorkflowRun 与 NodeRun。
2. PREPARED/RUNNING 期间冻结画布编辑，运行状态以节点 overlay 呈现。
3. 插件、内置校验器与本地内容节点分别展示真实 `executorRef` 路由。
4. 支持指定节点模拟超时，失败节点为 failed、尚未执行的下游为 blocked。
5. 支持从失败节点重试，已成功上游不重复执行，失败及下游复用冻结输入快照。
6. 运行面板提供 NodeRun 列表、问题、事件时间线和最终 receipt。
7. Artifact Viewer 支持 4 张图片候选网格和脚本文本；图片仍为演示原图，尚未完成缩略图治理。
8. 成功 Run 归档到当前 Project，同 ID 幂等更新并仅保留最近 50 条。

浏览器实测：7 个节点成功路径全部 SUCCEEDED；插件故障后 1 个 FAILED、3 个下游 BLOCKED；点击“从此重试”后同一 Run 转为 SUCCEEDED；工程运行计数正确增加；图片与文本 Viewer 均可打开。

下一优先级：

1. P0：为真实鼠标右键和跨平台快捷键完成最终人工设备验收。
2. P0：生成 256/512 像素缩略图并采用懒加载，禁止画布和 Viewer 首屏直接加载全部原图。
3. P0：将 Run Engine 接到受控 Runner API；前端只提交已发布版本 ID 和受限参数，不提交命令或目录。
4. P1：实现真实 Project Repository 前，再完成认证、Schema 校验、revision 冲突与离线 UI 原型。
5. P1：补运行历史列表、单次 Run 回放、Artifact 版本选择和失败节点诊断详情。

## 7. 不迁移的内容

- `catalog/node-definitions.json`
- `prototype/graph-core.js`
- Project/WorkflowDraft 唯一状态源
- Artifact、NodeRun、WorkflowRun 与发布收据
- Plugin 版本锁和 Skill → Plugin 转换契约

这些才是 Agent 工作台的核心；画布库只是交互基础设施。
