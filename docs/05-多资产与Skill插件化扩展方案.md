# 柠萌旅行记 Agent 工作台：多资产与 Skill 插件化扩展方案

版本：V3.0  
依赖：`04-制作端与管理端整合优化交互方案.md`

## 1. 本次扩展结论

V3 增加两个平台级能力：

1. **资产集合 `AssetCollection`**：支持一次添加、绑定、预览、筛选和传递多张图片、多段视频或混合参考素材。
2. **插件注册表 `PluginRegistry`**：允许管理员配置插件输入输出、运行策略和节点 UI，并将现有 Skill 分析后生成插件适配器。

核心边界：

- 多资产不是多个独立素材节点堆叠，而是一个带类型和角色的集合；
- Skill 转插件生成的是“适配器与契约”，不修改原始 Skill；
- 自动分析只能生成草稿，正式启用必须经过人工确认和沙盒测试；
- 插件执行仍然创建 NodeRun，并受 Preflight、Runner、权限、Validator 和审计约束。

## 2. 多资产数据模型

### 2.1 AssetItem

```ts
interface AssetItem {
  id: string;
  collectionId: string;
  type: 'image' | 'video' | 'audio' | 'document' | 'json';
  role: string;
  name: string;
  uri: string;
  mimeType: string;
  size: number;
  width?: number;
  height?: number;
  durationMs?: number;
  hash: string;
  version: number;
  source: 'upload' | 'project' | 'node_output' | 'external';
  status: 'ready' | 'uploading' | 'invalid' | 'duplicate' | 'stale';
  metadata: Record<string, unknown>;
}
```

### 2.2 AssetCollection

```ts
interface AssetCollection {
  id: string;
  name: string;
  acceptedTypes: string[];
  cardinality: { min: number; max?: number };
  items: AssetItem[];
  coverAssetId?: string;
  ordering: 'manual' | 'name' | 'shot' | 'created_at';
  collectionHash: string;
  version: number;
}
```

插件输入连接传递 `AssetCollectionRef`：

```ts
interface AssetCollectionRef {
  collectionId: string;
  version: number;
  collectionHash: string;
  selectedItemIds?: string[];
}
```

集合版本或选择范围发生变化时，编排器重新计算下游 STALE。

## 3. 多资产添加交互

### 3.1 入口

制作端提供四种添加方式：

- 从本机批量选择文件；
- 拖入多个文件或一个文件夹；
- 从工程资产库多选；
- 从其他节点的产物集合中引用。

粘贴板可以追加多张图片，但必须在写入前显示待添加列表。

### 3.2 添加面板

多资产面板分为三个区域：

1. **来源区**：本机上传、工程资产、节点产物、外部 URI。
2. **待添加队列**：缩略图、名称、类型、尺寸、Hash、重复状态和上传进度。
3. **批量设置区**：资产角色、标签、镜号范围、排序、目标集合和重复处理策略。

重复处理策略：

- 跳过相同 Hash；
- 引用既有资产；
- 作为新版本加入；
- 保留两者并要求重新命名。

默认选择“引用既有资产”，避免无意义复制。

### 3.3 提交前校验

- 文件类型是否被输入端口接受；
- 数量是否满足 min/max；
- 单文件和总大小限制；
- 必填角色是否已分配；
- 镜号是否重复或越界；
- 路径是否位于允许读取范围；
- Hash 是否重复；
- 插件是否声明可以接收集合。

校验失败只阻止对应文件；用户可移除异常项后继续提交其他资产。

## 4. 多资产节点与预览

### 4.1 资产集合节点

节点标准态包含：

- 集合名称和数量，例如 `角色参考 12 张`；
- 2×2 或 3×2 代表性缩略图；
- 类型、角色覆盖率、集合版本和 Hash；
- `添加资产`、`打开集合`、`仅看异常`；
- 单个集合输入端口和单个集合输出端口。

不会因为有 19 张图片而产生 19 个端口或 19 条主画布连线。

### 4.2 产物集合节点

适用于分镜、图片批次、视频批次：

- 网格中显示镜号或任务号；
- 每项独立显示 READY、RUNNING、FAIL、STALE；
- 节点标题显示聚合覆盖率，例如 `18/19`；
- 支持“全部运行”“仅运行失败项”“仅重新校验”；
- 批量运行创建 BatchRun，但每个资产任务仍有独立 NodeRun。

### 4.3 统一预览器

点击资产集合后，右侧检查器“内容”标签支持：

- 网格、列表、故事板、时间线四种视图；
- 类型、角色、镜号、状态、版本和来源筛选；
- 多选、全选当前筛选结果、反选；
- 大图、视频播放、文档和 JSON 预览；
- 选中资产的元数据、引用、版本和关联脚本；
- 两张图片并排、叠加或拖动分割线对比；
- 生成联系表并下载。

双击资产进入全屏沉浸预览；Esc 返回原选择和滚动位置。

### 4.4 多资产绑定

把集合连接到插件输入端口时打开“输入映射”Popover：

- 显示端口要求的类型、数量和角色；
- 支持绑定整个集合、当前选择或筛选结果；
- 支持将不同角色映射到插件的不同输入字段；
- 保存后冻结 `AssetCollectionRef` 到 NodeRun 输入快照；
- 后续集合变化不会悄悄改变已经创建的 NodeRun。

## 5. 插件模型

### 5.1 PluginManifest

```ts
interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  source: {
    type: 'skill_adapter' | 'native' | 'remote';
    skillRef?: string;
  };
  operations: PluginOperation[];
  permissions: PermissionDeclaration[];
  runtime: RuntimePolicy;
  status: 'draft' | 'testing' | 'enabled' | 'deprecated' | 'disabled';
}
```

### 5.2 PluginOperation

```ts
interface PluginOperation {
  id: string;
  title: string;
  inputSchema: JSONSchema;
  outputSchema: JSONSchema;
  uiSchema: PluginUISchema;
  executionAdapter: ExecutionAdapter;
  validators: ValidatorRef[];
  timeoutMs: number;
  retryPolicy: RetryPolicy;
}
```

### 5.3 支持的输入类型

| 输入类型 | UI 控件 | 端口语义 |
|---|---|---|
| string / text | 单行、长文本、代码编辑器 | `config.text` |
| number | 数字框、滑杆 | `config.number` |
| boolean | Switch / Checkbox | `config.boolean` |
| enum | Select / Radio / Segmented | `config.enum` |
| image | 单图选择器 | `artifact.image` |
| images | 多图集合选择器 | `artifact.image_collection` |
| video / videos | 视频或视频集合 | `artifact.video[_collection]` |
| document | 文件、脚本或文档引用 | `artifact.document` |
| artifactRef | 上游产物选择器 | 对应 Artifact 类型 |
| object / array | 表单生成器或 JSON 编辑器 | `data.object` / `data.array` |
| secretRef | 凭据引用，不显示明文 | `security.secret_ref` |

每个输入字段可定义：

- required；
- min/max 或 minItems/maxItems；
- accepted mime types；
- asset role；
- default；
- visibleWhen；
- readOnlyWhenRunning；
- validation message；
- 是否显示为节点端口。

### 5.4 支持的输出类型

- 单文件 Artifact；
- AssetCollection；
- 结构化 JSON；
- 文档或脚本；
- Problem；
- Receipt；
- 流式事件仅属于 NodeRun，不作为最终输出。

输出必须定义：

- JSON Schema；
- Artifact role；
- 数量范围；
- 文件命名规则；
- 目标目录模板；
- 预览 renderer；
- 必需 Validator；
- 是否允许空输出或部分成功。

## 6. 插件配置管理交互

### 6.1 插件列表

管理控制台增加“插件管理”：

- 搜索、来源、状态、版本、能力和引用 Workflow 筛选；
- 显示插件名称、operations、当前版本、状态、最近测试和引用数量；
- 操作：查看、复制为草稿、测试、启用、弃用、禁用；
- 已被 Workflow 引用的版本不能直接删除。

### 6.2 插件编辑器

插件编辑器使用标准后台，不使用无限画布。标签为：

1. `基础信息`
2. `输入`
3. `输出`
4. `节点 UI`
5. `执行适配`
6. `权限与安全`
7. `测试与发布`

#### 输入编辑器

- 左侧字段列表；
- 中间 JSON Schema 或表单配置；
- 右侧实时预览节点控件和输入端口；
- 支持字段排序、分组、条件显示和集合数量规则。

#### 输出编辑器

- 定义 Artifact 或集合类型；
- 配置命名和路径模板；
- 选择预览器；
- 绑定 Validator；
- 实时预览插件节点的输出区和端口。

#### 节点 UI

允许配置：

- 节点标题、图标和说明；
- 标准态显示哪些字段；
- 图片格尺寸和最大缩略图数量；
- 主按钮文案；
- 高级字段是否只在检查器显示；
- 是否支持批量运行；
- 不允许注入任意 HTML 或脚本。

### 6.3 插件版本状态

```text
DRAFT → TESTING → ENABLED → DEPRECATED → DISABLED
```

- 已启用版本不可原地修改；
- 修改生成新草稿版本；
- 新版本发布前计算 NodeDefinition、Workflow 和工程引用影响；
- 禁用只阻止新 NodeRun，不篡改历史运行和产物。

## 7. Skill 添加与分析

### 7.1 Skill 来源

管理员可以从以下来源添加：

- 已安装 Skill 注册表；
- 本地 Skill 目录；
- Git 仓库路径；
- 手动粘贴 Skill 定义；
- 已登记的远程 Skill 引用。

添加时只读取声明允许的文件；不会扫描无关目录或自动执行 Skill。

### 7.2 分析流程

```text
选择 Skill 来源
→ 读取 SKILL.md 与直接引用资源
→ 识别 operation 和触发条件
→ 推断输入、输出、工具、权限和副作用
→ 检测不确定项
→ 生成插件适配器草稿
→ 人工完成映射
→ 沙盒测试
→ 发布插件版本
```

### 7.3 分析结果

分析报告包含：

- Skill 基本信息、版本和来源；
- 可转换的 operations；
- 明确输入、推断输入和缺失输入；
- 明确输出、非结构化输出和副作用；
- 使用的工具、网络、文件系统和凭据；
- 人工确认点和危险动作；
- timeout、重试和幂等性判断；
- 推荐 Artifact roles 和 Validators；
- 可转换度评分与阻塞原因。

### 7.4 转换等级

| 等级 | 条件 | 处理 |
|---|---|---|
| A：可直接适配 | 输入输出明确、无动态权限 | 自动生成草稿，测试后发布 |
| B：需要映射 | 输出非结构化或存在多 operation | 人工补充 Schema 和收集规则 |
| C：需要包装器 | 动态工具、交互式过程或复杂副作用 | 编写 ExecutionAdapter 后测试 |
| D：不可安全转换 | 无法界定输入输出、权限或完成条件 | 仅登记为外部 Skill，不允许作为插件运行 |

### 7.5 Skill 到插件的映射

| Skill 概念 | 插件概念 |
|---|---|
| Skill 名称和说明 | PluginManifest name / description |
| 触发意图 | operation title / description，不作为运行触发 |
| 参数和所需上下文 | inputSchema |
| 生成文件和结构化结果 | outputSchema / Artifact roles |
| 调用工具 | permissions / runtime |
| 执行步骤 | executionAdapter |
| 检查规则 | validators |
| 人工确认 | approval policy |
| SKILL.md 路径 | source.skillRef |

转换不会把自然语言步骤机械翻译成前端表单。只有稳定、可声明和可验证的字段进入 Schema。

## 8. Skill 转插件向导

向导共六步：

1. **选择来源**：选择 Skill 并冻结来源版本或 Git commit。
2. **分析报告**：查看输入输出、权限、副作用和转换等级。
3. **定义 Operations**：一个 Skill 可拆为多个插件操作。
4. **映射输入输出**：确认 Schema、资产角色、集合数量和 Validator。
5. **配置节点 UI**：选择节点内字段、预览器、端口和批量能力。
6. **沙盒测试与发布**：使用测试夹具运行，核对产物、权限和收据。

任何未解决的高风险权限、未声明输出或不确定写入路径都会阻止发布。

## 9. 制作端使用插件

插件发布后不会自动出现在所有画布：

1. 管理员将插件 operation 绑定到 NodeDefinition；
2. Workflow 草稿引用该 NodeDefinition；
3. Workflow 测试和发布；
4. 新工程或明确迁移的工程获得该插件节点；
5. 制作人员只能编辑 uiSchema 声明开放的输入；
6. 运行时冻结 PluginVersion、SkillVersion、输入集合 Hash 和策略版本。

制作模式右键不会显示完整插件商城，只显示当前 Frame 和端口契约允许的插件节点。

## 10. 执行与部分成功

多资产插件运行可能出现部分成功：

```text
BatchRun
├─ ItemRun S01 PASS
├─ ItemRun S02 PASS
├─ ItemRun S03 FAIL
└─ ItemRun S04 PASS
```

规则：

- 集合节点显示 `3/4` 和 `PARTIAL`；
- 成功产物立即可预览，但 Gate 根据 Workflow 规则决定是否阻塞；
- 用户可以“仅重试失败项”；
- 重试创建新的 ItemRun，并保留旧失败证据；
- 集合 Hash 在批次最终收集后生成；
- 插件不得把部分成功伪装为完整 PASS。

## 11. 管理与审计

必须记录：

- PluginManifest 和每个版本的 Diff；
- Skill 来源版本、分析报告和转换确认人；
- Schema、uiSchema、权限和 Validator 变更；
- 测试夹具、沙盒运行和测试收据；
- 插件启用、弃用和禁用；
- Workflow 引用和工程迁移；
- 每次 NodeRun 使用的 PluginVersion 与 SkillVersion；
- 多资产集合版本、选择范围和 collectionHash。

## 12. MVP 顺序

### Phase A：多资产

- AssetCollection / AssetItem；
- 批量添加、上传队列、去重；
- 集合节点与统一预览器；
- 整个集合或选中项绑定；
- 图片集合输出和部分成功。

### Phase B：原生插件配置

- PluginManifest 和 Operation；
- 输入输出 Schema 编辑器；
- 节点 UI 预览；
- 沙盒测试、版本和启用；
- NodeDefinition 绑定插件 operation。

### Phase C：Skill 转插件

- 已安装 Skill 发现；
- 静态分析报告；
- A/B 级 Skill 的适配器草稿；
- 人工映射、测试和发布；
- C/D 级只报告，不自动发布。

## 13. 验收标准

- 一次可添加至少 100 个资产，失败文件不阻止合法文件提交；
- 20 张图片在主画布只使用一条集合连接；
- 任意资产在两次操作内可查看大图、元数据、脚本、版本和来源；
- 插件输入输出能够生成类型化端口和表单；
- 输入可声明单值、集合、必填、数量、类型和角色；
- 输出可声明 Artifact、集合、Schema、路径和 Validator；
- Skill 分析报告明确区分事实、推断和待确认项；
- 未通过沙盒测试的插件不能启用；
- 插件或 Skill 版本变化不会静默改变既有工程；
- 任意 NodeRun 均可追溯 PluginVersion、SkillVersion、输入集合 Hash 和策略版本。
