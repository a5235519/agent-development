# 柠萌旅行记 Agent Development

本仓库用于设计与实现“柠萌旅行记”可视化节点画布 Agent 工作台。

## 当前定位

- 产品形态：浏览器访问的 Web 工作台，不是桌面应用；
- 核心目标：减少脚本与视觉生产过程中的漏阶段、漏素材、漏检查和错误交付；
- 首版定位：固定生产流程的可视化执行与监控台，不是通用低代码节点编辑器；
- 执行方式：通过 Gateway / Runner 对接 `codex app-server`，浏览器不直接连接 Codex；
- 完成依据：产物契约、确定性验证器、Gate 与人工确认，而不是 AI 的自然语言完成声明。

## 方案文档

1. [可视化节点画布 Agent 方案](docs/01-可视化节点画布Agent方案.md)
   - 完整生产流程与节点体系；
   - 节点类型、端口、Frame、右键交互与语义缩放；
   - Skill、素材、产物、Gate、审批和执行凭证的画布表达；
   - Codex 远程执行拓扑。

2. [Agent 工作台客观评估与技术方案](docs/02-Agent工作台客观评估与技术方案.md)
   - 产品价值、技术可行性、范围与风险评估；
   - 推荐前后端架构、领域模型、状态机、API 和事件模型；
   - 现有 Remote Codex Control 的复用与改造边界；
   - MVP 范围、分阶段交付和验收矩阵。

3. [Agent 工作台完整交互方案](docs/03-Agent工作台完整交互方案.md)
   - 多视图 Web 工作台与无限画布的职责边界；
   - 工程创建、扫描映射、资产、运行、审批、QA、版本与交付；
   - 14 个连续交互场景和端到端主流程；
   - 完整 ImageGen/前端交互稿清单与验收标准。

## 推荐实施顺序

1. 定义 `workflow.schema.json` 和 `workflow.travel-v1.json`；
2. 定义状态转换、Skill Route Registry、NodeResult 与事件信封；
3. 从现有 EP 扫描生成 `project-manifest.json`；
4. 验证缺失检测、Gate、STALE、幂等和恢复；
5. 按完整交互方案搭建工程中心、扫描映射和只读工作台；
6. 搭建 React Flow 六 Frame 总览与阶段子画布；
7. 接入 Gateway / Runner / Codex 真实执行；
8. 补齐运行、审批、QA、版本和最终交付；
9. 最后扩展模板编辑及平台化能力。

## 建议目录（后续实施）

```text
agent-development/
├── README.md
├── docs/
├── apps/
│   ├── web/
│   ├── api/
│   └── runner/
├── packages/
│   ├── contracts/
│   ├── workflow-engine/
│   ├── codex-adapter/
│   └── validators/
└── examples/
    └── lemon-travel-project/
```

当前只整理方案文档，尚未创建前端或后端工程代码。
