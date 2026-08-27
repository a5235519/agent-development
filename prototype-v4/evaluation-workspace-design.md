# 柠萌旅行记 Agent 评估工作区

## 定位

评估工作区不是第二套制作画布，而是制作流程的质量控制层。它回答四个问题：候选工作流是否比基线更好、哪些样本失败、失败证据是什么、是否允许进入下一生产阶段。

## 信息架构

- 制作工作区：编排素材、脚本、Skill/插件与生成节点。
- 评估工作区：管理测试集、Evaluator、实验、失败样本与发布 Gate。
- 管理控制台：管理工程、插件、Skill、Runner、权限与审计收据。

三者共享 `Project → WorkflowVersion → NodeRun → Artifact → EvaluationRun → GateDecision` 主数据链，避免评估结果与实际产物脱节。

## 评估画布

画布固定表达一条可审计的评估拓扑：

1. `TestDataset`：黄金样本、边界样本、历史失败回归样本以及对应图片资产。
2. `BaselineVersion`：冻结的已发布工作流版本。
3. `CandidateVersion`：本次准备发布的候选版本。
4. `EvaluatorPack`：确定性规则、视觉 Judge、模型 Judge 与人工复核规则。
5. `MetricAggregator`：聚合质量、完整性、延迟和成本，并与基线比较。
6. `HumanReview`：收纳低置信度或必须人工判断的样本。
7. `ReleaseGate`：依据硬性规则、加权阈值和复核状态给出 `PASS / BLOCKED`。

## 核心交互

### 运行评估

用户选择基线与候选版本后点击“运行评估”。界面创建不可变 `EvaluationRun`，节点与连线进入运行态；完成后只更新结果，不覆盖上一轮记录。

### 检查失败样本

结果面板并列显示期望资产与候选资产，同时给出每个 Evaluator 的分数、证据、阈值和失败解释。用户可以将生产事故一键加入“历史失败回归集”，让问题从一次性修复变成永久测试。

### 发布 Gate

Gate 不等同于总分：任一必需规则失败、人工复核未完成或回归指标下降超过阈值时均保持 `BLOCKED`。只有 Gate 通过后，制作工作区下一阶段才解锁。

## Evaluator 分层

- Deterministic：镜号覆盖、文件命名、Schema、来源引用、必需输出。
- Vision Judge：角色外观、场景与构图连续性、视觉风格。
- Model Judge：脚本一致性、台词节奏、叙事逻辑；必须保存提示词版本和证据。
- Human Review：低置信度、风格取舍和高影响发布决策。

所有 Judge 输出统一为 `score / threshold / verdict / evidence / evaluator_version`，保证结果可复现和可比较。

## 当前原型覆盖

- 独立评估工作区与六个管理入口。
- 多图测试集节点、基线/候选分支、Evaluator、聚合、人工复核与发布 Gate。
- “运行评估 → 22/24 通过 → 打开失败样本 → 加入回归集”主路径。
- 失败样本的图片对照、指标证据与 Gate 阻塞状态。

## 工程化落地顺序

1. 先接真实 `NodeRun`、`Artifact` 和版本快照，禁止用当前 UI 示例数据做发布判断。
2. 实现确定性 Evaluator 与数据集版本管理。
3. 接入视觉/模型 Judge，并记录模型、提示词、温度、输入 Hash 与原始响应。
4. 增加实验队列、并发控制、成本统计和人工复核权限。
5. 将 GateDecision 回写制作工作区，形成阶段解锁和审计闭环。

## 开源方案映射

- Dify：管理面与版本发布模型。
- Langflow / Rivet：节点编辑、运行与调试体验。
- ComfyUI：多图片资产节点和预览密度。
- ChainForge：数据集 × 多版本 × 多 Evaluator 的评估编排。
- Phoenix / Langfuse：Trace、Span、Prompt 与成本追踪。
- Promptfoo / OpenAI Evals：测试集、断言、回归与 CI Gate。

这些项目只作为交互和架构参考，不直接拼接多个前端；产品仍维持统一对象模型和统一工作台。
