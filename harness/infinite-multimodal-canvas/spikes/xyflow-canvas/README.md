# XYFlow Canvas Spike

这是 P0-3 的隔离迁移验证，不是正式画布入口。

## 启动

```bash
npm install
npm run dev
```

默认打开 `http://127.0.0.1:5173/`。性能夹具：

- `?nodes=300`
- `?nodes=1000`

## 已覆盖

- NodeDefinition 驱动的自定义节点和 Typed Handle；
- 节点拖拽、框选、多选、删除、重连；
- 节点库拖入与画布右键添加；
- 多资产缩略图和 Inspector；
- GraphCore 统一校验；
- 基础分组、MiniMap、Controls；
- `onlyRenderVisibleElements` 大图可见区域渲染；
- Canvas Adapter 的 WorkflowDraft 双向映射边界。
- 独立领域命令历史：新增、移动、删除、连线、重连和分组可撤销/重做；
- 删除节点及关联连线作为单一命令提交；
- 工具栏与快捷键撤销/重做，`Shift+F10` 打开键盘等价画布菜单。
- 显式多选模式，可在无修饰键和触控场景中追加选择并创建分组；
- Typed Port 合法连接、非法类型拒绝、连线重接与非法重连保留原边。
- Project Store 自动保存、刷新恢复、多工程切换和发布版本恢复；
- 分组及组内节点绝对坐标可完整保存和恢复；
- 最近 100 条草稿事件用于审计，撤销栈仅属于当前工程会话。
- 分组整体拖动、组内移动、折叠、展开、取消分组和刷新恢复；
- 单层分组规则，防止嵌套导致执行范围与坐标语义失控；
- Project Repository 内存契约实现与 revision 冲突测试，不连接真实后端。
- 插件节点显示实际 `executorRef`，模拟 WorkflowRun/NodeRun 按拓扑推进；
- queued、running、succeeded、failed、blocked 运行状态覆盖到画布节点；
- 运行准备及执行期间冻结画布改图，避免执行快照与草稿漂移；
- 可指定节点注入故障、阻塞下游并从失败节点重试；
- 运行事件时间线、最终收据和当前工程最近 50 次成功运行归档；
- Artifact Viewer 支持 4 张图片候选网格和脚本文本查看。

迁移结论和未覆盖项见根目录 `XYFLOW-迁移评估与Canvas-Adapter.md`。
