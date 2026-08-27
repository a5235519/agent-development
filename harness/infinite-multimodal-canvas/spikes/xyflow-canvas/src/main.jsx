import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  addEdge, applyEdgeChanges, applyNodeChanges, Background, Controls, Handle, MiniMap, Position, ReactFlow,
  ReactFlowProvider, reconnectEdge, useReactFlow
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './styles.css';
import './overrides.css';
import catalog from '../../../catalog/node-definitions.json';
import examples from '../../../examples/workflows.json';
import '../../../prototype/graph-core.js';
import previewCharacter from '../../../prototype/assets/xiao-ningmeng-kyoto.png';
import previewStreet from '../../../prototype/assets/kyoto-street.png';
import previewInterior from '../../../prototype/assets/kyoto-interior.png';
import previewStoryboard from '../../../prototype/assets/storyboard-s12.png';
import { createCanvasAdapter } from './canvas-adapter.js';
import { createCommandHistory } from './command-history.js';
import { createProjectStore } from './project-store.js';
import { createRunEngine } from './run-engine.js';

const previews=[previewCharacter,previewStreet,previewInterior,previewStoryboard];
const catalogMap=new Map(catalog.definitions.map(definition=>[definition.id,definition]));
const canvasAdapter=createCanvasAdapter({catalog,graphCore:globalThis.GraphCore});
const runEngine=createRunEngine({catalog,graphCore:globalThis.GraphCore});
const paletteIds=['content.prompt','content.image-collection','content.script','generate.text-to-image','generate.image-to-image','plugin.storyboard-draft','validate.image','gate.quality','output.image-gallery'];
const initialWorkflow=examples.workflows.find(item=>item.kind==='image-text-plugin');
const requestedNodeCount=Math.max(0,Math.min(2000,Number(new URLSearchParams(location.search).get('nodes'))||0));
const projectStore=requestedNodeCount?null:createProjectStore({storage:localStorage,seedDraft:initialWorkflow});
const initialProjectState=projectStore?.load()||{activeProjectId:null,projects:[]};
const storedWorkflow=projectStore?.current()?.draft||initialWorkflow;

const toFlowNode=canvasAdapter.toCanvasNode;
const toFlowEdge=canvasAdapter.toCanvasEdge;
function createInitialGraph(){
  if(!requestedNodeCount)return canvasAdapter.fromWorkflow(storedWorkflow);
  return{
    metadata:{id:'performance-fixture',title:`${requestedNodeCount} 节点性能夹具`,kind:'performance'},
    nodes:Array.from({length:requestedNodeCount},(_,index)=>{
      const definitionId=paletteIds[index%paletteIds.length],definition=catalogMap.get(definitionId);
      return{id:`perf-${index+1}`,type:'multimodal',position:{x:(index%30)*350,y:Math.floor(index/30)*290},data:{definitionId,definition,config:{}},dragHandle:'.spike-node-head'};
    }),
    edges:[]
  };
}
const initialGraph=createInitialGraph();

const MultimodalNode=memo(function MultimodalNode({data,selected}){const d=data.definition,media=['content.image-collection','generate.text-to-image','generate.image-to-image','plugin.storyboard-draft','output.image-gallery'].includes(d.id),runtime=data.runtimeStatus;return <article className={`spike-node ${selected?'selected':''} ${runtime?`runtime-${runtime}`:''}`}>
  <header className="spike-node-head"><span>{d.category.toUpperCase()} · {d.version}</span><b>{d.title}</b></header>
  <section>{d.inputs.map((port,index)=><div className="port-row" key={`in-${port.id}`}><Handle type="target" position={Position.Left} id={port.id} style={{top:72+index*30}}/><span>{port.id}{port.required?' *':''}</span><small>{port.type}</small></div>)}
    {media&&<div className="preview-grid">{previews.slice(0,d.category==='output'?4:3).map(src=><img src={src} key={src}/>)}</div>}
    <p>{d.description}</p>
    {d.outputs.map((port,index)=><div className="port-row output" key={`out-${port.id}`}><span>{port.id}</span><small>{port.type}</small><Handle type="source" position={Position.Right} id={port.id} style={{top:`calc(100% - ${24+(d.outputs.length-index-1)*30}px)`}}/></div>)}</section>
  <footer><span>{d.source==='plugin'?'PLUGIN':'NODE'}</span><em>{runtime?.toUpperCase()||`${data.config?.assetRefs?.length||0} 资产`}</em></footer>
  </article>});

const MultimodalGroup=memo(function MultimodalGroup({data,selected}){return <article className={`spike-group ${selected?'selected':''} ${data.collapsed?'collapsed':''}`}><header><span>{data.collapsed?'▸':'▾'}</span><b>{data.label}</b><small>{data.memberCount||0} 节点</small></header>{!data.collapsed&&<p>拖动标题移动整组；在右侧面板折叠或取消分组。</p>}</article>});

const nodeTypes={multimodal:MultimodalNode,multimodalGroup:MultimodalGroup};

function CanvasSpike(){
  const [metadata,setMetadata]=useState(initialGraph.metadata);
  const [nodes,setNodes]=useState(initialGraph.nodes);
  const [edges,setEdges]=useState(initialGraph.edges);
  const [projectState,setProjectState]=useState(initialProjectState);
  const [menu,setMenu]=useState(null),[message,setMessage]=useState('XYFlow 隔离验证 · 未替换正式画布');
  const [selectionMode,setSelectionMode]=useState(false);
  const [panelMode,setPanelMode]=useState('inspect');
  const [runSession,setRunSession]=useState(null);
  const [autoRun,setAutoRun]=useState(false);
  const [failureNodeId,setFailureNodeId]=useState('');
  const [artifactView,setArtifactView]=useState(null);
  const [,setHistoryVersion]=useState(0);
  const historyRef=useRef(createCommandHistory(initialGraph));
  const graphRef=useRef(initialGraph);
  const dragBeforeRef=useRef(null);
  const runLockedRef=useRef(false);
  const archivedRunIdsRef=useRef(new Set());
  const {screenToFlowPosition,fitView}=useReactFlow();
  graphRef.current={metadata,nodes,edges};
  useEffect(()=>{requestAnimationFrame(()=>{document.body.dataset.spikeReady='true';document.body.dataset.stateNodes=String(nodes.length);document.body.dataset.renderMs=performance.now().toFixed(1)})},[]);
  const nodeMap=useMemo(()=>new Map(nodes.map(node=>[node.id,node])),[nodes]);
  const runtimeMap=useMemo(()=>new Map((runSession?.nodeRuns||[]).map(item=>[item.nodeId,item.status])),[runSession]);
  runLockedRef.current=Boolean(runSession&&['PREPARED','RUNNING'].includes(runSession.status));
  const displayNodes=useMemo(()=>nodes.map(node=>node.type==='multimodal'?{...node,data:{...node.data,runtimeStatus:runtimeMap.get(node.id)||null}}:node),[nodes,runtimeMap]);
  const graphToWorkflow=useCallback(graph=>{const map=new Map(graph.nodes.map(node=>[node.id,node]));const position=node=>{let x=node.position.x,y=node.position.y,parent=node.parentId&&map.get(node.parentId);while(parent){x+=parent.position.x;y+=parent.position.y;parent=parent.parentId&&map.get(parent.parentId)}return{x,y}};return canvasAdapter.toWorkflow({nodes:graph.nodes,edges:graph.edges,metadata:graph.metadata,absolutePosition:position})},[]);
  const persistGraph=useCallback((graph,command=null)=>{if(!projectStore)return;projectStore.saveDraft(graphToWorkflow(graph),{command});setProjectState(projectStore.snapshot())},[graphToWorkflow]);
  const applyGraph=useCallback(graph=>{graphRef.current=graph;setMetadata(graph.metadata);setNodes(graph.nodes);setEdges(graph.edges)},[]);
  const commitGraph=useCallback((type,after,meta={})=>{if(runLockedRef.current){setMessage('运行快照已冻结：请等待结束或重新准备运行');return false}const command=historyRef.current.record(type,graphRef.current,after,meta);if(!command)return false;applyGraph(after);persistGraph(after,command);setHistoryVersion(value=>value+1);setMessage(`已执行并自动保存：${type}`);return true},[applyGraph,persistGraph]);
  const onNodesChange=useCallback(changes=>{const next=applyNodeChanges(changes,nodes);if(changes.some(change=>['add','remove','replace'].includes(change.type)))commitGraph('更新节点',{...graphRef.current,nodes:next});else setNodes(next)},[nodes,commitGraph]);
  const onEdgesChange=useCallback(changes=>{const next=applyEdgeChanges(changes,edges);if(changes.some(change=>['add','remove','replace'].includes(change.type)))commitGraph('更新连线',{...graphRef.current,edges:next});else setEdges(next)},[edges,commitGraph]);
  const isValidConnection=useCallback(connection=>canvasAdapter.compatibleConnection(connection,nodes,edges),[nodes,edges]);
  const onConnect=useCallback(connection=>{if(isValidConnection(connection))commitGraph('创建连线',{...graphRef.current,edges:addEdge({...connection,id:`edge-${Date.now()}`,type:'smoothstep'},edges)})},[isValidConnection,edges,commitGraph]);
  const onReconnect=useCallback((oldEdge,newConnection)=>{if(!canvasAdapter.compatibleConnection(newConnection,nodes,edges,oldEdge.id)){setMessage('重连被拒绝：端口类型或基数不兼容，已保留原连线');return}commitGraph('重接连线',{...graphRef.current,edges:reconnectEdge(oldEdge,newConnection,edges)})},[nodes,edges,commitGraph]);
  const addNodeAt=useCallback((definitionId,position)=>{const definition=catalogMap.get(definitionId),node={id:`node-${Date.now()}`,type:'multimodal',position,data:{definitionId,definition,config:{}},dragHandle:'.spike-node-head'};commitGraph('添加节点',{...graphRef.current,nodes:nodes.concat(node)},{definitionId});setMenu(null)},[nodes,commitGraph]);
  const onPaneContextMenu=useCallback(event=>{event.preventDefault();setMenu({clientX:event.clientX,clientY:event.clientY,position:screenToFlowPosition({x:event.clientX,y:event.clientY})})},[screenToFlowPosition]);
  const onDrop=useCallback(event=>{event.preventDefault();const definitionId=event.dataTransfer.getData('definitionId');if(definitionId)addNodeAt(definitionId,screenToFlowPosition({x:event.clientX,y:event.clientY}))},[addNodeAt,screenToFlowPosition]);
  const absolutePosition=useCallback(node=>{let x=node.position.x,y=node.position.y,parent=node.parentId&&nodeMap.get(node.parentId);while(parent){x+=parent.position.x;y+=parent.position.y;parent=parent.parentId&&nodeMap.get(parent.parentId)}return{x,y}},[nodeMap]);
  const validate=useCallback(()=>{const workflow=canvasAdapter.toWorkflow({nodes,edges,metadata,absolutePosition});const issues=globalThis.GraphCore.validateWorkflow(catalog,workflow,{requirePluginDependencies:true});setMessage(issues.length?`${issues[0].code} · ${issues[0].message}`:'GraphCore 校验通过')},[nodes,edges,metadata,absolutePosition]);
  const createGroup=useCallback(()=>{const selectedAll=nodes.filter(node=>node.selected&&node.type==='multimodal');if(selectedAll.some(node=>node.parentId))return setMessage('暂不支持嵌套分组：请先取消原分组');if(selectedAll.length<2)return setMessage('至少选择两个未分组节点');const selected=selectedAll,minX=Math.min(...selected.map(n=>n.position.x))-32,minY=Math.min(...selected.map(n=>n.position.y))-58,maxX=Math.max(...selected.map(n=>n.position.x+300))+32,maxY=Math.max(...selected.map(n=>n.position.y+230))+32,width=maxX-minX,height=maxY-minY,id=`group-${Date.now()}`,nextNodes=[{id,type:'multimodalGroup',position:{x:minX,y:minY},data:{label:`节点组 · ${selected.length}`,collapsed:false,expandedSize:{width,height},memberCount:selected.length},style:{width,height,zIndex:-1},dragHandle:'.spike-group header',selected:true},...nodes.map(node=>selected.some(item=>item.id===node.id)?{...node,selected:false,parentId:id,extent:'parent',position:{x:node.position.x-minX,y:node.position.y-minY}}:node)];commitGraph('创建分组',{...graphRef.current,nodes:nextNodes},{nodeIds:selected.map(node=>node.id)})},[nodes,commitGraph]);
  const toggleGroup=useCallback(groupId=>{const group=nodes.find(node=>node.id===groupId&&node.type==='multimodalGroup');if(!group)return;const collapsed=!group.data.collapsed,expandedSize=group.data.expandedSize||{width:Number(group.style?.width)||360,height:Number(group.style?.height)||260},nextNodes=nodes.map(node=>node.id===groupId?{...node,data:{...node.data,collapsed,expandedSize},style:{...node.style,width:expandedSize.width,height:collapsed?58:expandedSize.height}}:node.parentId===groupId?{...node,hidden:collapsed}:node);commitGraph(collapsed?'折叠分组':'展开分组',{...graphRef.current,nodes:nextNodes},{groupId})},[nodes,commitGraph]);
  const ungroup=useCallback(groupId=>{const group=nodes.find(node=>node.id===groupId&&node.type==='multimodalGroup');if(!group)return;const nextNodes=nodes.filter(node=>node.id!==groupId).map(node=>node.parentId===groupId?{...node,parentId:undefined,extent:undefined,hidden:false,selected:true,position:{x:group.position.x+node.position.x,y:group.position.y+node.position.y}}:node);commitGraph('取消分组',{...graphRef.current,nodes:nextNodes},{groupId})},[nodes,commitGraph]);
  const deleteSelection=useCallback(()=>{const selectedIds=new Set(nodes.filter(node=>node.selected).map(node=>node.id)),selectedEdgeIds=new Set(edges.filter(edge=>edge.selected).map(edge=>edge.id));for(const node of nodes)if(node.parentId&&selectedIds.has(node.parentId))selectedIds.add(node.id);if(!selectedIds.size&&!selectedEdgeIds.size)return;const nextNodes=nodes.filter(node=>!selectedIds.has(node.id)),nextEdges=edges.filter(edge=>!selectedEdgeIds.has(edge.id)&&!selectedIds.has(edge.source)&&!selectedIds.has(edge.target));commitGraph('删除选择',{...graphRef.current,nodes:nextNodes,edges:nextEdges},{nodeIds:[...selectedIds],edgeIds:[...selectedEdgeIds]})},[nodes,edges,commitGraph]);
  const applyHistoryResult=useCallback((result,prefix)=>{if(!result)return;applyGraph(result.graph);persistGraph(result.graph,{id:`history-${Date.now()}`,type:`${prefix}：${result.command.type}`,meta:{commandId:result.command.id}});setHistoryVersion(value=>value+1);setMessage(`${prefix}并自动保存：${result.command.type}`)},[applyGraph,persistGraph]);
  const undo=useCallback(()=>applyHistoryResult(historyRef.current.undo(),'已撤销'),[applyHistoryResult]);
  const redo=useCallback(()=>applyHistoryResult(historyRef.current.redo(),'已重做'),[applyHistoryResult]);
  useEffect(()=>{const onKeyDown=event=>{const target=event.target;if(target?.matches?.('input, textarea, select, [contenteditable="true"]'))return;const modifier=event.metaKey||event.ctrlKey;if(modifier&&event.key.toLowerCase()==='z'){event.preventDefault();event.shiftKey?redo():undo();return}if(event.shiftKey&&event.key==='F10'){event.preventDefault();const clientX=Math.round(window.innerWidth/2),clientY=Math.round(window.innerHeight/2);setMenu({clientX,clientY,position:screenToFlowPosition({x:clientX,y:clientY})});return}if(['Backspace','Delete'].includes(event.key)){event.preventDefault();deleteSelection()}};window.addEventListener('keydown',onKeyDown);return()=>window.removeEventListener('keydown',onKeyDown)},[undo,redo,deleteSelection,screenToFlowPosition]);
  const onNodeDragStart=useCallback(()=>{dragBeforeRef.current=structuredClone(graphRef.current)},[]);
  const onNodeDragStop=useCallback((event,draggedNode)=>{const before=dragBeforeRef.current;dragBeforeRef.current=null;if(!before)return;let after=graphRef.current,type='移动节点';if(draggedNode.type==='multimodalGroup'){const beforeMap=new Map(before.nodes.map(node=>[node.id,node]));after={...after,nodes:after.nodes.map(node=>node.parentId===draggedNode.id?{...node,position:structuredClone(beforeMap.get(node.id)?.position||node.position)}:node)};applyGraph(after);type='移动分组'}const command=historyRef.current.record(type,before,after);if(command){persistGraph(after,command);setHistoryVersion(value=>value+1);setMessage(`已执行并自动保存：${type}`)}},[applyGraph,persistGraph]);
  const onNodeClick=useCallback((event,node)=>{if(!selectionMode)return;event.preventDefault();event.stopPropagation();const selectedIds=new Set(nodes.filter(item=>item.selected).map(item=>item.id));selectedIds.has(node.id)?selectedIds.delete(node.id):selectedIds.add(node.id);setNodes(items=>items.map(item=>({...item,selected:selectedIds.has(item.id)})));setMessage(`多选模式 · 已选择 ${selectedIds.size} 个节点`)},[selectionMode,nodes]);
  const hydrateProject=useCallback(project=>{const graph=canvasAdapter.fromWorkflow(project.draft);applyGraph(graph);historyRef.current=createCommandHistory(graph);setHistoryVersion(value=>value+1);setSelectionMode(false);setMenu(null);setRunSession(null);setAutoRun(false);setPanelMode('inspect');setArtifactView(null);setMessage(`已切换工程：${project.title}`)},[applyGraph]);
  const saveProject=useCallback(()=>{persistGraph(graphRef.current);setMessage('当前工程草稿已保存')},[persistGraph]);
  const createProject=useCallback(()=>{persistGraph(graphRef.current);const project=projectStore.createProject({draft:initialWorkflow});setProjectState(projectStore.snapshot());hydrateProject(project)},[persistGraph,hydrateProject]);
  const switchProject=useCallback(projectId=>{if(projectId===projectState.activeProjectId)return;persistGraph(graphRef.current);const project=projectStore.switchProject(projectId);setProjectState(projectStore.snapshot());hydrateProject(project)},[projectState.activeProjectId,persistGraph,hydrateProject]);
  const publishVersion=useCallback(()=>{const workflow=graphToWorkflow(graphRef.current),issues=globalThis.GraphCore.validateWorkflow(catalog,workflow,{requirePluginDependencies:true});if(issues.length){setMessage(`${issues[0].code} · ${issues[0].message}`);return}const version=projectStore.publishVersion(workflow);setProjectState(projectStore.snapshot());setMessage(`已发布工作流 v${version.number}`)},[graphToWorkflow]);
  const restoreLatestVersion=useCallback(()=>{const project=projectStore.current(),version=project?.versions?.[0];if(!version)return;const before=structuredClone(graphRef.current),draft=projectStore.restoreVersion(version.id),after=canvasAdapter.fromWorkflow(draft),command=historyRef.current.record('恢复版本',before,after,{versionId:version.id,number:version.number});applyGraph(after);setProjectState(projectStore.snapshot());setHistoryVersion(value=>value+1);setMessage(`已恢复 v${version.number} 为新草稿，可撤销`)},[applyGraph]);
  const prepareSimulation=useCallback(()=>{const workflow=graphToWorkflow(graphRef.current),run=runEngine.prepareRun(workflow);setRunSession(run);setPanelMode('run');setFailureNodeId('');setAutoRun(false);setMessage(run.status==='BLOCKED'?`${run.issues[0]?.code||'RUN_BLOCKED'} · ${run.issues[0]?.message||'本地预检未通过'}`:'模拟运行已准备，输入快照已冻结')},[graphToWorkflow]);
  const startSimulation=useCallback(()=>{if(runSession?.status!=='PREPARED')return;setAutoRun(true)},[runSession]);
  const retrySimulation=useCallback(nodeId=>{setFailureNodeId('');setRunSession(run=>runEngine.retryRun(run,nodeId));setAutoRun(true)},[]);
  useEffect(()=>{if(!autoRun||!runSession||!['PREPARED','RUNNING'].includes(runSession.status))return;const timer=setTimeout(()=>setRunSession(run=>runEngine.advanceRun(run,{failNodeId:failureNodeId||null})),180);return()=>clearTimeout(timer)},[autoRun,runSession,failureNodeId]);
  useEffect(()=>{if(autoRun&&runSession&&['SUCCEEDED','FAILED','BLOCKED'].includes(runSession.status)){setAutoRun(false);setMessage(runSession.status==='SUCCEEDED'?'模拟 WorkflowRun 已完成':runSession.status==='FAILED'?'模拟 WorkflowRun 失败，可从失败节点重试':'模拟 WorkflowRun 被预检阻止')}},[autoRun,runSession]);
  useEffect(()=>{if(!projectStore||runSession?.status!=='SUCCEEDED'||archivedRunIdsRef.current.has(runSession.id))return;projectStore.archiveRun(runSession);archivedRunIdsRef.current.add(runSession.id);setProjectState(projectStore.snapshot())},[runSession]);
  const openArtifacts=useCallback(nodeRun=>{if(!nodeRun.artifacts.length)return;setArtifactView({nodeRun,artifacts:nodeRun.artifacts});},[]);
  const selected=nodes.filter(node=>node.selected&&node.type==='multimodal');
  const selectedGroup=nodes.find(node=>node.selected&&node.type==='multimodalGroup');
  const historyState=historyRef.current.state();
  const activeProject=projectState.projects.find(project=>project.id===projectState.activeProjectId);
  return <div className="spike-app" onClick={()=>menu&&setMenu(null)}>
    <header><div><b>XYFlow Canvas Spike</b><span>React Flow 12 · Canvas Adapter 候选</span></div><div><button aria-pressed={selectionMode} onClick={()=>{setSelectionMode(value=>!value);setMessage(selectionMode?'已退出多选模式':'多选模式 · 点击节点追加选择')}}>多选</button><button disabled={!historyState.canUndo} onClick={undo}>撤销</button><button disabled={!historyState.canRedo} onClick={redo}>重做</button><button onClick={validate}>统一校验</button><button onClick={prepareSimulation}>模拟运行</button><button onClick={createGroup}>创建分组</button><button onClick={()=>fitView({padding:.15})}>适配全图</button></div></header>
    <aside>{projectStore&&<section className="project-panel"><h3>工程草稿</h3><select aria-label="当前工程" value={projectState.activeProjectId||''} onChange={event=>switchProject(event.target.value)}>{projectState.projects.map(project=><option value={project.id} key={project.id}>{project.title}</option>)}</select><small>{activeProject?.versions.length||0} 个版本 · {activeProject?.runs.length||0} 次运行 · {activeProject?.draftEvents.length||0} 条事件</small><div><button onClick={createProject}>新建</button><button onClick={saveProject}>保存</button><button onClick={publishVersion}>发布</button><button disabled={!activeProject?.versions.length} onClick={restoreLatestVersion}>恢复</button></div></section>}<h3>节点库</h3><p>拖入画布，或右键添加</p>{paletteIds.map(id=>{const d=catalogMap.get(id);return <button draggable onDragStart={event=>event.dataTransfer.setData('definitionId',id)} key={id}><b>{d.title}</b><small>{d.inputs.length} IN · {d.outputs.length} OUT</small></button>})}</aside>
    <main><ReactFlow nodes={displayNodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect} onReconnect={onReconnect} isValidConnection={isValidConnection} onNodeClick={onNodeClick} onNodeDragStart={onNodeDragStart} onNodeDragStop={onNodeDragStop} onPaneContextMenu={onPaneContextMenu} onDrop={onDrop} onDragOver={event=>{event.preventDefault();event.dataTransfer.dropEffect='move'}} selectionOnDrag multiSelectionKeyCode={['Shift','Meta','Control']} nodesDraggable={!runLockedRef.current} nodesConnectable={!runLockedRef.current} fitView={!requestedNodeCount} onlyRenderVisibleElements minZoom={.05} maxZoom={1.6} deleteKeyCode={null}>
      <Background gap={22} size={1}/><MiniMap pannable zoomable nodeColor={node=>node.type==='multimodalGroup'?'#2a3340':'#557ff1'}/><Controls showInteractive={false}/>
    </ReactFlow>{menu&&<div className="context" style={{left:menu.clientX,top:menu.clientY}} onClick={event=>event.stopPropagation()}><b>添加节点</b>{paletteIds.slice(0,6).map(id=><button key={id} onClick={()=>addNodeAt(id,menu.position)}>{catalogMap.get(id).title}</button>)}</div>}</main>
    <section className="inspector"><div className="inspector-head"><h3>{panelMode==='run'?'模拟运行':'Inspector'}</h3>{runSession&&<button onClick={()=>setPanelMode(panelMode==='run'?'inspect':'run')}>{panelMode==='run'?'返回配置':'运行详情'}</button>}</div>{panelMode==='run'&&runSession?<><div className={`run-summary status-${runSession.status.toLowerCase()}`}><b>{runSession.status}</b><small>{runSession.id}</small></div>{runSession.status==='PREPARED'&&<><label className="run-field">故障演练<select aria-label="故障演练" value={failureNodeId} onChange={event=>setFailureNodeId(event.target.value)}><option value="">不注入故障</option>{runSession.nodeRuns.map(item=><option value={item.nodeId} key={item.nodeId}>{item.title}</option>)}</select></label><button className="run-primary" onClick={startSimulation}>开始模拟执行</button></>} {runSession.issues.length>0&&<div className="run-issues">{runSession.issues.map((issue,index)=><p key={`${issue.code}-${index}`}>{issue.code} · {issue.message}</p>)}</div>}<div className="node-run-list">{runSession.nodeRuns.map(item=><article key={item.nodeId} className={`node-run-row status-${item.status}`}><i></i><div><b>{item.title}</b><small>{item.executorRef}</small></div><span>{item.status}</span>{item.error&&<p>{item.error}</p>}{item.artifacts.length>0&&<button onClick={()=>openArtifacts(item)}>查看 {item.artifacts.length} 个产物</button>}{item.status==='failed'&&<button onClick={()=>retrySimulation(item.nodeId)}>从此重试</button>}</article>)}</div><details className="run-events"><summary>事件 {runSession.events.length}</summary>{[...runSession.events].reverse().map((event,index)=><p key={`${event.at}-${index}`}><small>{event.type}</small>{event.nodeId&&<b>{event.nodeId}</b>}<span>{event.message}</span></p>)}</details>{runSession.receipt&&<pre className="run-receipt">{JSON.stringify(runSession.receipt,null,2)}</pre>}</>:selectedGroup?<><b>{selectedGroup.data.label}</b><p>{selectedGroup.data.memberCount} 个成员 · {selectedGroup.data.collapsed?'已折叠':'已展开'}</p><div className="group-actions"><button onClick={()=>toggleGroup(selectedGroup.id)}>{selectedGroup.data.collapsed?'展开分组':'折叠分组'}</button><button onClick={()=>ungroup(selectedGroup.id)}>取消分组</button></div><code>嵌套分组：禁用</code></>:selected.length===1?<><b>{selected[0].data.definition.title}</b><p>{selected[0].data.definition.description}</p><div className="asset-preview">{previews.map(src=><img src={src} key={src}/>)}</div><code>{selected[0].data.definition.executorRef||'local://content'}</code></>:selected.length>1?<><b>{selected.length} 个节点</b><p>可拖动、删除或创建分组。</p></>:<p>选择节点查看配置与多资产。</p>}</section>
    <footer><span>{activeProject?.title||'性能夹具'} · {nodes.filter(node=>node.type==='multimodal').length} 节点 · {edges.length} 连线 · {historyState.undoCount} 条可撤销命令</span><b>{message}</b></footer>{artifactView&&<div className="artifact-overlay" role="dialog" aria-label="Artifact Viewer"><div className="artifact-dialog"><header><div><b>Artifact Viewer</b><small>{artifactView.nodeRun.title} · {artifactView.nodeRun.nodeId}</small></div><button aria-label="关闭产物" onClick={()=>setArtifactView(null)}>×</button></header>{artifactView.artifacts.some(item=>item.type.startsWith('image'))?<div className="artifact-grid">{artifactView.artifacts.filter(item=>item.type.startsWith('image')).flatMap(item=>previews.slice(0,item.candidateCount).map((src,index)=><figure key={`${item.id}-${index}`}><img src={src}/><figcaption>{item.portId} · 候选 {index+1} · {item.type}</figcaption></figure>))}</div>:artifactView.artifacts.some(item=>item.content)?<pre className="artifact-text">{artifactView.artifacts.map(item=>item.content).filter(Boolean).join('\n\n')}</pre>:<pre className="artifact-text">{JSON.stringify(artifactView.artifacts,null,2)}</pre>}</div></div>}
  </div>;
}

createRoot(document.getElementById('root')).render(<ReactFlowProvider><CanvasSpike/></ReactFlowProvider>);
