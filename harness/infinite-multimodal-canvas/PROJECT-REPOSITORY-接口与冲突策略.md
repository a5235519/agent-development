# Project Repository 接口与冲突策略

更新日期：2026-08-13  
状态：接口契约与内存参考实现已完成，未连接真实后端

## 1. 边界

`Project Store` 是当前浏览器会话的编辑状态与本地缓存；`Project Repository` 是未来持久化服务的唯一接口。画布、XYFlow、React 组件和 Canvas Adapter 不得直接调用 HTTP、数据库或对象存储。

```text
XYFlow UI → Domain Command → Project Store → Project Repository → API/Database
                         ↘ Canvas Adapter ↔ WorkflowDraft
```

Repository 只接受领域对象，不接受 DOM、React Node、文件路径、Shell 命令或模型密钥。

## 2. 最小接口

```ts
interface ProjectRepository {
  listProjects(): Promise<ProjectSummary[]>;
  getProject(projectId: string): Promise<ProjectRecord>;
  createProject(input: CreateProjectInput): Promise<ProjectRecord>;
  saveDraft(projectId: string, draft: WorkflowDraft, options: {
    expectedRevision: number;
  }): Promise<ProjectRecord>;
  publishVersion(projectId: string, draft: WorkflowDraft, options: {
    expectedRevision: number;
  }): Promise<{ project: ProjectRecord; version: WorkflowVersion }>;
  restoreVersion(projectId: string, versionId: string, options: {
    expectedRevision: number;
  }): Promise<ProjectRecord>;
}
```

参考实现位于 `spikes/xyflow-canvas/src/project-repository.js`，仅用于契约测试。

## 3. 乐观并发

每个 Project 保存整数 `revision`。读取工程得到 revision 12 后，保存必须提交 `expectedRevision: 12`；服务端只有当前仍为 12 才接受，并返回 revision 13。

不允许“最后写入者直接覆盖”。revision 不一致时返回：

```json
{
  "code": "PROJECT_REVISION_CONFLICT",
  "projectId": "project-ep01",
  "expectedRevision": 12,
  "actualRevision": 13
}
```

## 4. 冲突交互

冲突后前端暂停自动保存，并提供三种明确动作：

1. **重新载入服务器版本**：放弃未同步草稿前，先允许下载本地备份。
2. **另存为新工程**：保留本地草稿，不覆盖原工程。
3. **进入差异合并**：只对 Node/Edge/Group/Config 做结构化比较；禁止静默合并同一字段。

第一阶段不实现多人实时协作、CRDT 或 OT。当前需求是防覆盖与可恢复，不应过早引入协作系统复杂度。

## 5. 离线与重试

- 本地 Store 持续保存草稿并标记 `syncState: pending`。
- 网络恢复后按 Project 顺序提交最新草稿，而不是重放全部拖动事件。
- `saveDraft` 使用 `projectId + expectedRevision + draftHash` 作为幂等依据。
- 发布版本和恢复版本不可在离线状态伪装成功。
- 401/403、revision 冲突和 Schema 校验失败不自动重试。

## 6. 后端接入前门槛

- Repository 契约测试在本地与真实实现上共用。
- WorkflowDraft 入库前必须通过 GraphCore。
- 版本发布冻结插件依赖与 Executor Ref。
- 资产仅保存 `AssetRef`，二进制走独立资产服务。
- 审计日志记录 actor、project、revision、command type 和时间，不存完整 Prompt 密钥或原始凭证。
