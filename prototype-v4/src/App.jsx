import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { agentWorkbenchApi } from './services/agentWorkbenchApi.js';
import { completedEvaluationResult } from './data/evaluationSuite.js';
import {
  Aperture,
  ArrowLeft,
  ArrowRight,
  ArrowsClockwise,
  CaretDown,
  Check,
  Checks,
  ClockCounterClockwise,
  Cube,
  FileCode,
  FilmStrip,
  FolderOpen,
  GearSix,
  GridFour,
  Image as ImageIcon,
  Info,
  Lightning,
  ListBullets,
  MagnifyingGlass,
  Package,
  Play,
  Plus,
  PuzzlePiece,
  Robot,
  ShieldCheck,
  SidebarSimple,
  SlidersHorizontal,
  Sparkle,
  Stack,
  TerminalWindow,
  UploadSimple,
  UsersThree,
  Warning,
  X,
} from '@phosphor-icons/react';

const media = [
  { id: 'A01', src: '/assets/xiao-ningmeng-kyoto.png', role: '角色参考', name: '小柠萌·雨衣' },
  { id: 'A02', src: '/assets/kyoto-street.png', role: '场景参考', name: '京都·八坂街' },
  { id: 'A03', src: '/assets/kyoto-interior.png', role: '场景参考', name: '町屋·室内' },
  { id: 'A04', src: '/assets/storyboard-s12.png', role: '构图参考', name: 'S12·构图草图' },
];

const expectedShots = Array.from({ length: 19 }, (_, index) => `S${String(index + 1).padStart(2, '0')}`);
const evaluationLockKey = 'agent.evaluationExecutionLock';

function getEvaluationTabId() {
  let id = sessionStorage.getItem('agent.evaluationTabId');
  if (!id) { id = crypto.randomUUID(); sessionStorage.setItem('agent.evaluationTabId', id); }
  return id;
}

function readEvaluationLock() {
  try { const lock=JSON.parse(localStorage.getItem(evaluationLockKey)||'null'); return lock?.expiresAt>Date.now()?lock:null; }
  catch { return null; }
}

function acquireEvaluationLock(ownerId, runId='PENDING') {
  const current=readEvaluationLock(); if(current&&current.ownerId!==ownerId)return false;
  localStorage.setItem(evaluationLockKey,JSON.stringify({ownerId,runId,expiresAt:Date.now()+30000}));
  return readEvaluationLock()?.ownerId===ownerId;
}

function renewEvaluationLock(ownerId,runId) { const current=readEvaluationLock(); if(current?.ownerId===ownerId)localStorage.setItem(evaluationLockKey,JSON.stringify({...current,runId,expiresAt:Date.now()+30000})); }
function releaseEvaluationLock(ownerId) { const current=readEvaluationLock(); if(current?.ownerId===ownerId)localStorage.removeItem(evaluationLockKey); }

function artifactToMedia(artifact) {
  return {
    id: artifact.id,
    src: artifact.mediaType?.startsWith('image/') ? artifact.uri : '/assets/storyboard-s12.png',
    role: artifact.role,
    name: artifact.filename,
    shot: artifact.shotId,
    artifact,
  };
}

function latestShotArtifacts(artifacts) {
  const byShot = new Map();
  [...artifacts]
    .filter((item) => item.isActive !== false && item.role === 'storyboard.draft' && item.shotId)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
    .forEach((item) => byShot.set(item.shotId, item));
  return byShot;
}

const nodeCatalog = {
  assets: { title: 'R0 多资产参考包', kind: 'ASSET_COLLECTION' },
  prompt: { title: '分镜生成提示词', kind: 'PROMPT' },
  plugin: { title: '分镜草图生成', kind: 'PLUGIN_RUN' },
  output: { title: 'S01–S19 分镜草图', kind: 'ARTIFACT_COLLECTION' },
  validator: { title: '镜号覆盖校验', kind: 'VALIDATOR' },
  video: { title: 'Seedance 镜头生成', kind: 'PLUGIN_RUN' },
};

function NodeShell({ id, title, kind, status, children, accent = 'blue', selected, onOpen }) {
  return (
    <div className={`flow-node flow-node--${accent} ${selected ? 'is-selected' : ''}`} onDoubleClick={onOpen}>
      <Handle type="target" position={Position.Left} className={`handle handle--${accent}`} />
      <header className="node-head">
        <div>
          <span className="node-kind">{kind}</span>
          <h3>{title}</h3>
        </div>
        <span className={`status status--${status.toLowerCase()}`}>{status}</span>
      </header>
      {children}
      <footer className="node-foot"><span>#{id}</span><button aria-label="更多操作">•••</button></footer>
      <Handle type="source" position={Position.Right} className={`handle handle--${accent}`} />
    </div>
  );
}

function AssetsNode({ id, data, selected }) {
  const liveAssets = data.artifacts.filter((item) => item.isActive !== false && item.role === 'image.reference');
  const visibleAssets = liveAssets.length ? liveAssets.slice(0, 4).map(artifactToMedia) : media;
  const summary = liveAssets.length ? `${liveAssets.length} 项已登记资产` : '12 项示例资产';
  return <NodeShell id={id} title="R0 多资产参考包" kind="ASSET COLLECTION" status="PASS" accent="green" selected={selected} onOpen={data.open}>
    <div className="node-copy"><b>{summary}</b><span>{liveAssets.length ? '数据源 · Artifact Store' : '角色 4 · 场景 5 · 服装 3'}</span></div>
    <div className="asset-mosaic">
      {visibleAssets.map((item) => <button key={item.id} onClick={(e) => {e.stopPropagation(); data.preview(item)}}><img src={item.src} alt={item.name}/><span>{item.role}</span></button>)}
    </div>
    <div className="node-actions"><button onClick={(e) => {e.stopPropagation(); data.addAssets()}}><Plus size={13}/>添加资产</button><button onClick={(e) => {e.stopPropagation(); data.open()}}>打开集合</button></div>
  </NodeShell>;
}

function PromptNode({ id, data, selected }) {
  return <NodeShell id={id} title="分镜生成提示词" kind="PROMPT" status="READY" accent="yellow" selected={selected} onOpen={data.open}>
    <div className="prompt-box">基于正式脚本与 R0 参考，按镜号生成静态分镜草图。保持角色外观、空间关系与镜头连续性。</div>
    <div className="prompt-meta"><span>@ 引用 12 项</span><span>2,164 / 5,000</span></div>
    <div className="node-actions"><button onClick={(e) => {e.stopPropagation(); data.open()}}>编辑提示词</button></div>
  </NodeShell>;
}

function PluginNode({ id, data, selected }) {
  return <NodeShell id={id} title={data.title || '分镜草图生成'} kind="PLUGIN RUN" status={data.running ? 'RUNNING' : 'READY'} accent="blue" selected={selected} onOpen={data.open}>
    <label className="field-label">插件版本<select defaultValue="storyboard-v1.4"><option value="storyboard-v1.4">Storyboard Draft v1.4</option><option>Storyboard Draft v1.3</option></select></label>
    <div className="plugin-inputs"><span><Checks size={14}/>参考图 12/12</span><span><Checks size={14}/>脚本 v1.2</span></div>
    <div className="field-row"><label>比例<select defaultValue="16:9"><option>16:9</option><option>9:16</option></select></label><label>输出<select defaultValue="2K"><option>2K</option><option>4K</option></select></label></div>
    <button className="run-button" onClick={(e) => {e.stopPropagation(); data.run()}}><Lightning weight="fill" size={14}/>{data.running ? '正在生成 3 / 6' : '预检并运行'}</button>
  </NodeShell>;
}

function OutputNode({ id, data, selected }) {
  const liveShots = latestShotArtifacts(data.artifacts);
  const hasLiveData = liveShots.size > 0;
  const completed = hasLiveData ? liveShots.size : 18;
  const missing = expectedShots.filter((shot) => hasLiveData ? !liveShots.has(shot) : shot === 'S13');
  const staleCount = [...liveShots.values()].filter((item)=>item.stale).length;
  const status = staleCount ? 'STALE' : missing.length ? 'PARTIAL' : 'PASS';
  return <NodeShell id={id} title="S01–S19 分镜草图" kind="ARTIFACT COLLECTION" status={status} accent="purple" selected={selected} onOpen={data.open}>
    <div className="coverage"><b>{completed} / 19</b><span>{staleCount?`${staleCount} 项因上游版本变化已失效`:missing.length ? `缺失 ${missing.slice(0, 3).join('、')}${missing.length > 3 ? ` 等 ${missing.length} 镜` : ''}` : '镜号覆盖完整'}</span></div>
    <div className="shot-grid">
      {expectedShots.map((shot, index) => {
        const artifact = liveShots.get(shot);
        if ((hasLiveData && !artifact) || (!hasLiveData && shot === 'S13')) return <button className="shot-missing" key={shot} onClick={(event)=>{event.stopPropagation();data.issue()}}><Warning size={14}/><span>{shot}</span></button>;
        const item = artifact ? artifactToMedia(artifact) : {...media[index % media.length], shot};
        return <button className={`${shot === 'S12' ? 'active' : ''} ${artifact?.stale?'is-stale':''}`} key={shot} onClick={(event)=>{event.stopPropagation();data.preview(item)}}><img src={item.src} alt={`${shot} 分镜`}/><span>{shot}{artifact?.stale?' · 失效':''}</span></button>;
      })}
    </div>
    <div className="node-actions"><button onClick={(e)=>{e.stopPropagation();data.open()}}><GridFour size={13}/>网格预览</button><button onClick={(e)=>{e.stopPropagation();data.issue()}}>仅看异常</button></div>
  </NodeShell>;
}

function ValidatorNode({ id, data, selected }) {
  const verdict=data.gateDecision?.verdict;
  return <NodeShell id={id} title="镜号覆盖校验" kind="VALIDATOR" status={verdict==='PASS'?'PASS':'FAIL'} accent={verdict==='PASS'?'green':'red'} selected={selected} onOpen={data.issue}>
    <div className="validator-score"><Warning size={22}/><div><b>18 / 19</b><span>缺失镜号 S13</span></div></div>
    <div className="node-actions"><button onClick={(e)=>{e.stopPropagation();data.issue()}}>查看问题</button><button disabled>{verdict?`Gate ${verdict}`:'Gate 未评估'}</button></div>
  </NodeShell>;
}

const nodeTypes = { assets: AssetsNode, prompt: PromptNode, plugin: PluginNode, output: OutputNode, validator: ValidatorNode };

function ProductionCanvas({ openInspector, addAssets, running, runPlugin, artifacts, gateDecision }) {
  const handlers = useMemo(() => ({
    open: (id) => openInspector(id, 'content'),
    previewOutput: (asset) => openInspector('output', 'content', asset),
    previewAsset: (asset) => openInspector('assets', 'content', asset),
    issue: () => openInspector('validator', 'issues'),
  }), [openInspector]);
  const nodes = useMemo(() => [
    { id: 'assets', type: 'assets', position: { x: 70, y: 105 }, data: { open:()=>handlers.open('assets'), preview:handlers.previewAsset, addAssets, artifacts }, style:{width:300} },
    { id: 'prompt', type: 'prompt', position: { x: 100, y: 480 }, data: { open:()=>handlers.open('prompt') }, style:{width:280} },
    { id: 'plugin', type: 'plugin', position: { x: 470, y: 225 }, data: { open:()=>handlers.open('plugin'), run:runPlugin, running }, style:{width:300} },
    { id: 'output', type: 'output', position: { x: 875, y: 130 }, data: { open:()=>handlers.open('output'), preview:handlers.previewOutput, issue:handlers.issue, artifacts }, style:{width:410} },
    { id: 'validator', type: 'validator', position: { x: 1390, y: 260 }, data: { issue:handlers.issue, gateDecision }, style:{width:245} },
    { id: 'video', type: 'plugin', position: { x: 925, y: 620 }, data: { title:'Seedance 镜头生成', open:()=>handlers.open('video'), run:runPlugin, running:false }, style:{width:300} },
  ], [handlers, addAssets, running, runPlugin, artifacts, gateDecision]);
  const edges = useMemo(() => [
    { id:'a-p', source:'assets', target:'plugin', animated:running, style:{stroke:'#4b7d67'} },
    { id:'pr-p', source:'prompt', target:'plugin', animated:running, style:{stroke:'#86754c'} },
    { id:'p-o', source:'plugin', target:'output', animated:running, style:{stroke:'#5778ca'} },
    { id:'o-v', source:'output', target:'validator', style:{stroke:'#8c5cc1'} },
    { id:'o-video', source:'output', target:'video', style:{stroke:'#665a80', strokeDasharray:'6 5'} },
  ], [running]);
  return <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView fitViewOptions={{padding:0.08}} minZoom={0.45} maxZoom={1.25} nodesDraggable>
    <Background color="#283141" gap={24} size={1.2}/><MiniMap pannable zoomable className="minimap" nodeColor={(node)=> node.id==='validator'?'#8d393c':node.id==='output'?'#69509d':'#334156'}/><Controls showInteractive={false}/>
  </ReactFlow>;
}

function TaskFocusBar({ openIssue, openEvidence, runRepair, running, gateDecision }) {
  return <section className="task-focus" aria-label="当前制作任务">
    <div className="task-focus__signal"><Warning weight="fill"/><div><span>当前目标</span><b>补齐 S13，解除“草图 QA”阻塞</b></div></div>
    <div className="task-focus__facts"><span><small>证据</small><b>S01–S19 · 18/19</b></span><span><small>执行范围</small><b>仅 S13</b></span><span><small>最新 Gate</small><b className={gateDecision?.verdict==='PASS'?'good':'bad'}>{gateDecision?.verdict||'尚未评估'}</b></span></div>
    <div className="task-focus__actions"><button onClick={openEvidence}><ImageIcon/>查看相邻镜</button><button onClick={openIssue}><FileCode/>问题证据</button><button className="task-repair" onClick={runRepair}><ArrowsClockwise/>{running?'修复执行中':'仅补齐 S13'}</button></div>
  </section>;
}

function TopBar({ workspace, setWorkspace, running, gateDecision }) {
  const [latestGate,setLatestGate]=useState(gateDecision);
  useEffect(()=>{agentWorkbenchApi.listGateDecisions('EP01').then((result)=>setLatestGate(result.items?.[0]||gateDecision)).catch(()=>{})},[workspace,gateDecision]);
  return <header className="topbar">
    <div className="brand"><Aperture size={22} weight="duotone"/><b>柠萌旅行记 Agent</b></div>
    <div className="workspace-switch"><button className={workspace==='production'?'active':''} onClick={()=>setWorkspace('production')}>制作工作区</button><button className={workspace==='evaluation'?'active':''} onClick={()=>setWorkspace('evaluation')}>评估工作区</button><button className={workspace==='admin'?'active':''} onClick={()=>setWorkspace('admin')}>管理控制台</button></div>
    <div className="project-crumb"><span>{workspace==='evaluation'?'EP01 评估套件':'EP01 京都篇'}</span><span>{workspace==='evaluation'?'Suite V1.0':'工作流 V1.3'}</span><span className="progress"><i></i></span><b>{workspace==='evaluation'?`${latestGate?.score??82} / 100`:'12 / 23'}</b></div>
    <div className="top-actions"><span className="runner"><i></i>{running?'Runner 执行中':'Runner 在线'}</span><button aria-label="搜索"><MagnifyingGlass/></button><button aria-label="设置"><GearSix/></button><button className="avatar">D</button></div>
  </header>;
}

function StageRail({onAssets,gateDecision}) {
  const gatePassed=gateDecision?.verdict==='PASS';
  const stages = gatePassed ? [['01','方向与脚本','pass'],['02','清单与 R0','pass'],['03','分镜准备','pass'],['04','分镜定稿','active'],['05','视频与交付','locked'],['06','归档与验收','locked']] : [['01','方向与脚本','pass'],['02','清单与 R0','pass'],['03','分镜准备','active'],['04','分镜定稿','locked'],['05','视频与交付','locked'],['06','归档与验收','locked']];
  return <aside className="stage-rail"><button className="collapse"><SidebarSimple/></button><p>生产阶段</p>{stages.map(([n,label,state])=><button key={n} className={`stage ${state}`}><span>{n}</span><div><b>{label}</b><small>{state==='pass'?'已完成':state==='active'?'进行中':'待解锁'}</small></div>{state==='pass'?<Check/>:state==='locked'?<ShieldCheck/>:null}</button>)}<div className="rail-bottom"><button><ClockCounterClockwise/>运行</button><button onClick={onAssets||(()=>window.dispatchEvent(new Event('agent:open-assets')))}><Package/>资产</button><button><FolderOpen/>交付</button></div></aside>;
}

function Inspector({ selection, tab, setTab, close, preview, runPlugin, addAssets, artifacts, activateArtifact }) {
  if (!selection) return null;
  const title = nodeCatalog[selection]?.title || '节点详情';
  const tabs = [['content','内容'],['run','执行'],['issues','问题'],['versions','版本与血缘']];
  return <aside className="inspector">
    <header><div><span>{nodeCatalog[selection]?.kind || 'NODE'}</span><h2>{title}</h2></div><button onClick={close}><X/></button></header>
    <nav>{tabs.map(([id,label])=><button className={tab===id?'active':''} onClick={()=>setTab(id)} key={id}>{label}{id==='issues'&&<em>1</em>}</button>)}</nav>
    <div className="inspector-body">
      {tab==='content' && <ContentPanel selection={selection} preview={preview} addAssets={addAssets} artifacts={artifacts}/>} 
      {tab==='run' && <RunPanel runPlugin={runPlugin}/>} 
      {tab==='issues' && <IssuePanel runPlugin={runPlugin}/>} 
      {tab==='versions' && <VersionPanel selected={preview} artifacts={artifacts} activateArtifact={activateArtifact}/>}
    </div>
  </aside>;
}

function ContentPanel({ selection, preview, addAssets, artifacts }) {
  const [viewMode,setViewMode]=useState('visual');
  const selected = preview || media[0];
  const liveMedia = artifacts.filter((item)=>item.mediaType?.startsWith('image/')).map(artifactToMedia);
  const visualItems = liveMedia.length ? liveMedia : media;
  const artifact = selected.artifact;
  if (selection==='prompt') return <><section className="detail-card"><label>提示词正文<textarea defaultValue="基于正式脚本与 R0 参考，按镜号生成静态分镜草图。保持角色外观、场景空间关系、动作连续性与镜头节奏。每张图必须输出镜号和结构化脚本。"/></label></section><section className="detail-card"><h3>引用素材</h3><div className="mini-assets">{visualItems.slice(0,8).map(x=><img key={x.id} src={x.src} alt={x.name}/>)}</div></section><button className="primary wide">保存为新版本</button></>;
  return <><div className="asset-view-switch"><button className={viewMode==='visual'?'active':''} onClick={()=>setViewMode('visual')}><ImageIcon/>图片资产</button><button className={viewMode==='script'?'active':''} onClick={()=>setViewMode('script')}><FileCode/>对应脚本</button><button className={viewMode==='continuity'?'active':''} onClick={()=>setViewMode('continuity')}><FilmStrip/>前后镜</button></div>{viewMode==='visual'?<><div className="hero-preview"><img src={selected.src} alt={selected.name}/><button className="nav-left" aria-label="上一项"><ArrowLeft/></button><button className="nav-right" aria-label="下一项"><ArrowRight/></button><span>{selected.shot || selected.id}</span></div><div className="filmstrip">{visualItems.slice(0,12).map(x=><button className={x.id===selected.id?'active':''} key={x.id}><img src={x.src} alt={x.name}/></button>)}</div></>:viewMode==='script'?<ScriptArtifactPanel artifacts={artifacts} shotId={selected.shot}/>:<ContinuityPanel artifacts={artifacts} selected={selected}/>}<section className="detail-card"><h3>{selected.name}</h3><dl><div><dt>资产角色</dt><dd>{artifact?.role || selected.role}</dd></div><div><dt>镜号</dt><dd>{artifact?.shotId || selected.shot || '—'}</dd></div><div><dt>来源 Run</dt><dd>{artifact?.producerRunId || '人工导入 / 示例'}</dd></div><div><dt>Hash</dt><dd>{artifact?.sha256?.slice(0,12) || '7e2d6f9a'}</dd></div></dl>{artifact?.sourceArtifactIds?.length>0&&<div className="lineage-chips">{artifact.sourceArtifactIds.map(id=><span key={id}>{id}</span>)}</div>}</section>{selection==='assets'&&<button className="primary wide" onClick={addAssets}><Plus/>继续添加资产</button>}</>;
}

function ScriptArtifactPanel({ artifacts, shotId }) {
  const script = [...artifacts].reverse().find((item)=>item.role==='script.final');
  const [content,setContent] = useState('');
  const [contentError,setContentError] = useState('');
  useEffect(()=>{let active=true;if(!script?.uri){setContent('');return()=>{active=false}}fetch(script.uri).then((response)=>{if(!response.ok)throw new Error(`HTTP ${response.status}`);return response.text()}).then((text)=>{if(active){setContent(text.slice(0,12000));setContentError('')}}).catch((error)=>{if(active)setContentError(error.message)});return()=>{active=false}},[script?.id,script?.uri]);
  return <section className="script-preview"><span>{shotId || 'EP01'} · SCRIPT ARTIFACT</span><h3>{script?.filename || '正式脚本尚未登记'}</h3>{script?<><dl><div><dt>Artifact ID</dt><dd>{script.id}</dd></div><div><dt>版本 Hash</dt><dd>{script.sha256?.slice(0,12)}</dd></div><div><dt>文件大小</dt><dd>{formatBytes(script.byteSize || 0)}</dd></div><div><dt>来源</dt><dd>{script.producerRunId || '人工导入'}</dd></div></dl><pre className="script-artifact-content">{contentError?`读取失败：${contentError}`:content||'正在读取脚本内容…'}</pre></>:<p>请在资产管理中上传并登记为 <code>script.final</code>，节点随后会引用真实脚本版本。</p>}<button>打开完整脚本定位</button></section>;
}

function ContinuityPanel({ artifacts, selected }) {
  const shotMap = latestShotArtifacts(artifacts);
  const currentNumber = Number((selected.shot || 'S12').slice(1)) || 12;
  const ids = [currentNumber - 1, currentNumber, currentNumber + 1].filter((value)=>value>0&&value<=19).map((value)=>`S${String(value).padStart(2,'0')}`);
  return <section className="continuity-strip continuity-strip--live">{ids.map((shot)=>{const item=shotMap.get(shot);const fallback=shot===selected.shot?selected:null;return item||fallback?<div className={shot===selected.shot?'current':''} key={shot}><span>{shot}</span><img src={item?.uri||fallback.src} alt={`${shot} 分镜`}/><small>{item?'Artifact Store':'当前预览'}</small></div>:<div className="missing" key={shot}><span>{shot}</span><Warning/><small>缺失 · 待补齐</small></div>})}</section>;
}

function RunPanel({ runPlugin }) {
  return <><section className="detail-card checklist"><h3>执行预检</h3>{['NodeDefinition v1.4','实际 Skill 路由','输入资产 12/12','允许写入目录','预期输出 19 项','Validator 2 项'].map(x=><div key={x}><Check/><span>{x}</span><b>PASS</b></div>)}</section><section className="detail-card"><h3>运行策略</h3><dl><div><dt>Plugin</dt><dd>storyboard-draft@1.4</dd></div><div><dt>Skill</dt><dd>storyboard.generate</dd></div><div><dt>超时</dt><dd>30 分钟</dd></div><div><dt>重试</dt><dd>仅失败项 × 1</dd></div></dl></section><button className="primary wide" onClick={runPlugin}><Play weight="fill"/>创建并运行 NodeRun</button></>;
}

function IssuePanel({ runPlugin }) {
  return <><div className="issue-banner"><Warning/><div><b>P0 · 缺失镜号 S13</b><span>Validator：镜号覆盖校验</span></div></div><section className="detail-card"><h3>问题证据</h3><dl><div><dt>Problem ID</dt><dd>PRB-0013</dd></div><div><dt>来源 Run</dt><dd>run_01J2Z7</dd></div><div><dt>覆盖率</dt><dd>18 / 19</dd></div><div><dt>影响 Gate</dt><dd>草图 QA</dd></div></dl></section><section className="detail-card repair-scope"><h3>建议修复范围</h3><div><b>输入沿用</b><span>R0 资产包、正式脚本 v1.2、S12/S14 连续性</span></div><div><b>仅重跑</b><span>S13 草图 + 镜号覆盖 Validator</span></div></section><section className="detail-card"><h3>合法修复动作</h3><button className="repair primary-repair" onClick={()=>runPlugin('repair')}><ArrowsClockwise/>仅补齐 S13 并新建 NodeRun</button><button className="repair"><UsersThree/>创建人工任务</button></section><p className="safety-note"><Info/>不能手动将问题改为 PASS，必须重新校验。</p></>;
}

function VersionPanel({ selected, artifacts, activateArtifact }) {
  const current = selected?.artifact;
  const [switching,setSwitching] = useState('');
  const versions = current ? artifacts.filter((item)=>(item.versionGroupId||item.id)===(current.versionGroupId||current.id)).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)) : [];
  const activate = async(item)=>{setSwitching(item.id);try{await activateArtifact(item)}finally{setSwitching('')}};
  return <><section className="detail-card"><h3>真实版本时间线</h3>{versions.length?versions.map((item)=><div className="version-row" key={item.id}><i className={item.isActive!==false?'current':''}></i><span>{item.isActive!==false?'当前 · ':''}{item.sha256?.slice(0,10)}<small>{new Date(item.createdAt).toLocaleString('zh-CN')}</small></span><button disabled={item.isActive!==false||switching===item.id} onClick={()=>activate(item)}>{switching===item.id?'切换中':'设为当前'}</button></div>):<div className="version-empty">选择已登记的 Artifact 后查看版本</div>}</section>{current&&<LineageGraph current={current} artifacts={artifacts}/>}<section className="detail-card"><h3>下游影响</h3><div className="impact-row"><span>必须重跑</span><b>{current?3:0}</b></div><div className="impact-row"><span>仅需重校验</span><b>{current?4:0}</b></div></section></>;
}

function LineageGraph({ current, artifacts }) {
  const [focused,setFocused] = useState(current.id);
  const upstream = (current.sourceArtifactIds||[]).map((id)=>artifacts.find((item)=>item.id===id)).filter(Boolean);
  const downstream = artifacts.filter((item)=>item.sourceArtifactIds?.includes(current.id));
  const focus = artifacts.find((item)=>item.id===focused)||current;
  const column = (title,items,kind)=><div><span>{title}</span>{items.length?items.map((item)=><button className={`${kind} ${focused===item.id?'active':''}`} key={item.id} onClick={()=>setFocused(item.id)}><b>{item.shotId||item.role}</b><small>{item.filename}</small></button>):<em>无</em>}</div>;
  return <section className="detail-card lineage-graph"><h3>可交互来源关系图</h3><div className="lineage-flow">{column('上游来源',upstream,'source')}<i>→</i>{column('当前资产',[current],'current')}<i>→</i>{column('下游产物',downstream,'target')}</div><dl><div><dt>当前查看</dt><dd>{focus.filename}</dd></div><div><dt>Artifact ID</dt><dd>{focus.id}</dd></div><div><dt>生产 Run</dt><dd>{focus.producerRunId||'人工导入'}</dd></div></dl></section>;
}

function AssetModal({ close, confirm }) {
  const picker = useRef(null);
  const replacementPicker = useRef(null);
  const [files,setFiles] = useState([]);
  const [artifacts,setArtifacts] = useState([]);
  const [role,setRole] = useState('image.reference');
  const [activeTab,setActiveTab] = useState('upload');
  const [roleFilter,setRoleFilter] = useState('all');
  const [query,setQuery] = useState('');
  const [loading,setLoading] = useState(true);
  const [uploading,setUploading] = useState(false);
  const [replacementTarget,setReplacementTarget] = useState(null);
  const [error,setError] = useState('');
  const loadArtifacts = useCallback(async()=>{setLoading(true);try{const result=await agentWorkbenchApi.listArtifacts({projectId:'EP01'});setArtifacts(result.items||[]);setError('')}catch(nextError){setError(nextError.message)}finally{setLoading(false)}},[]);
  useEffect(()=>{loadArtifacts()},[loadArtifacts]);
  const filtered = artifacts.filter((item)=>(roleFilter==='all'||item.role===roleFilter)&&(!query||`${item.filename} ${item.shotId||''} ${item.sha256||''}`.toLowerCase().includes(query.toLowerCase()))&&(activeTab!=='node'||item.producerRunId));
  const selectFiles = (event)=>{const next=[...event.target.files].slice(0,100).map(file=>({file,preview:file.type.startsWith('image/')?URL.createObjectURL(file):null}));setFiles(next);setError('')};
  const upload = async()=>{if(!files.length)return;setUploading(true);setError('');try{for(const item of files){const contentBase64=await fileToBase64(item.file);await agentWorkbenchApi.createArtifact({projectId:'EP01',role,shotId:role.startsWith('storyboard.')?guessShotId(item.file.name):undefined,filename:item.file.name,mediaType:item.file.type||'application/octet-stream',contentBase64,producerRunId:role==='image.reference'||role==='script.final'?undefined:'run_manual_import',sourceArtifactIds:[]})}await loadArtifacts();confirm(files.length)}catch(nextError){setError(nextError.message);setUploading(false)}};
  const beginReplace = (artifact)=>{setReplacementTarget(artifact);setError('');replacementPicker.current?.click()};
  const replaceFile = async(event)=>{const file=event.target.files?.[0];if(!file||!replacementTarget)return;setUploading(true);try{const contentBase64=await fileToBase64(file);await agentWorkbenchApi.createArtifact({projectId:replacementTarget.projectId,role:replacementTarget.role,shotId:replacementTarget.shotId||undefined,filename:file.name,mediaType:file.type||replacementTarget.mediaType,contentBase64,producerRunId:'run_manual_replace',sourceArtifactIds:[replacementTarget.id],versionGroupId:replacementTarget.versionGroupId||replacementTarget.id});await loadArtifacts();setReplacementTarget(null);setError('')}catch(nextError){setError(nextError.message)}finally{setUploading(false);event.target.value=''}};
  return <div className="modal-backdrop"><div className="asset-modal asset-modal--live">
    <header><div><span>ARTIFACT STORE · EP01</span><h2>多资产管理</h2></div><button onClick={close}><X/></button></header>
    <div className="asset-source-tabs"><button className={activeTab==='upload'?'active':''} onClick={()=>setActiveTab('upload')}><UploadSimple/>本机上传</button><button className={activeTab==='project'?'active':''} onClick={()=>setActiveTab('project')}><Package/>工程资产 <em>{artifacts.length}</em></button><button className={activeTab==='node'?'active':''} onClick={()=>setActiveTab('node')}><Stack/>节点产物</button></div>
    <input ref={replacementPicker} className="file-picker" type="file" accept="image/png,image/jpeg,image/webp,application/json,text/plain" onChange={replaceFile}/>{error&&<div className="asset-error"><Warning/>{error}</div>}
    {activeTab==='upload'?<><input ref={picker} className="file-picker" type="file" multiple accept="image/png,image/jpeg,image/webp,application/json,text/plain" onChange={selectFiles}/><button className="dropzone" onClick={()=>picker.current?.click()}><UploadSimple size={28}/><b>选择多个图片、脚本或 JSON 文件</b><span>文件将写入 Artifact Store，并自动计算 SHA-256</span></button><div className="queue-head"><b>待上传</b><span>{files.length} 项</span></div>{files.length?<div className="live-upload-grid">{files.map(({file,preview})=><article key={`${file.name}-${file.size}`}>{preview?<img src={preview} alt={file.name}/>:<FileCode/>}<div><b>{file.name}</b><span>{formatBytes(file.size)} · 待计算 Hash</span></div><button onClick={()=>setFiles(current=>current.filter(item=>item.file!==file))}><X/></button></article>)}</div>:<div className="asset-empty">尚未选择文件</div>}<div className="batch-settings"><label>Artifact Role<select value={role} onChange={event=>setRole(event.target.value)}><option value="image.reference">image.reference · 参考图片</option><option value="storyboard.draft">storyboard.draft · 分镜草图</option><option value="script.final">script.final · 正式脚本</option><option value="evaluation.evidence">evaluation.evidence · 评估证据</option></select></label><label>重复处理<select><option>引用相同 Hash 的既有资产</option><option>跳过</option><option>作为新版本</option></select></label></div></>:<><div className="artifact-tools"><label><MagnifyingGlass/><input value={query} onChange={(event)=>setQuery(event.target.value)} placeholder="搜索文件名、镜号或 Hash"/></label><select value={roleFilter} onChange={(event)=>setRoleFilter(event.target.value)}><option value="all">全部 Artifact Role</option><option value="image.reference">image.reference</option><option value="storyboard.draft">storyboard.draft</option><option value="script.final">script.final</option><option value="evaluation.evidence">evaluation.evidence</option></select><button onClick={loadArtifacts}><ArrowsClockwise/>刷新</button></div><ArtifactGrid artifacts={filtered} loading={loading} onReplace={beginReplace} replacing={uploading}/></>}
    {activeTab==='upload'&&<section className="artifact-register"><header><b>最近登记 Artifact</b><button onClick={()=>setActiveTab('project')}>查看全部</button></header><ArtifactRows artifacts={artifacts.slice(0,6)} loading={loading}/></section>}
    <footer><button onClick={close}>关闭</button>{activeTab==='upload'&&<button className="primary" disabled={!files.length||uploading} onClick={upload}>{uploading?'正在写入 Artifact Store…':`上传并登记 ${files.length} 项`}</button>}</footer>
  </div></div>;
}

function ArtifactRows({ artifacts, loading }) {
  if (loading) return <div className="asset-empty">正在读取 Artifact Store…</div>;
  if (!artifacts.length) return <div className="asset-empty">Artifact Store 中还没有 EP01 资产</div>;
  return <div>{artifacts.map(item=><article key={item.id}><span className="artifact-type">{item.mediaType?.startsWith('image/')?<ImageIcon/>:<FileCode/>}</span><div><b>{item.filename}</b><small>{item.role}{item.shotId?` · ${item.shotId}`:''}</small></div><code>{item.sha256?.slice(0,10)}</code><span>{item.producerRunId||'人工导入'}</span></article>)}</div>;
}

function ArtifactGrid({ artifacts, loading, onReplace, replacing }) {
  if (loading) return <div className="asset-empty asset-empty--large">正在读取 Artifact Store…</div>;
  if (!artifacts.length) return <div className="asset-empty asset-empty--large">当前筛选条件下没有资产</div>;
  return <div className="artifact-grid">{artifacts.map((item)=><article className={item.isActive===false?'is-inactive':''} key={item.id}>{item.mediaType?.startsWith('image/')?<img src={item.uri} alt={item.filename}/>:<div className="artifact-file"><FileCode/></div>}<div><b>{item.filename}{item.isActive!==false&&<em>当前</em>}</b><span>{item.role}{item.shotId?` · ${item.shotId}`:''}</span><code>{item.sha256?.slice(0,12)}</code><small>{item.producerRunId||'人工导入'} · {formatBytes(item.byteSize||0)}</small><button disabled={replacing} onClick={()=>onReplace(item)}><ArrowsClockwise/>上传替换版本</button></div></article>)}</div>;
}

function fileToBase64(file){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]||'');reader.onerror=()=>reject(new Error(`无法读取文件：${file.name}`));reader.readAsDataURL(file)})}
function guessShotId(filename){return filename.match(/S\d{2}/i)?.[0]?.toUpperCase()}
function formatBytes(size){return size<1024?`${size} B`:size<1024*1024?`${(size/1024).toFixed(1)} KB`:`${(size/1024/1024).toFixed(1)} MB`}

function PreflightModal({ close, start, cancel, retry, running, mode='full', nodeRun, events=[], artifacts=[] }) {
  const repair=mode==='repair';
  const progress=nodeRun?.progress||{current:0,total:6,step:'等待 Runner 领取'};const terminal=['COMPLETED','FAILED','CANCELLED'].includes(nodeRun?.status);const canRetry=['FAILED','CANCELLED'].includes(nodeRun?.status);
  const active=artifacts.filter(item=>item.isActive!==false&&item.stale!==true);const has=(role,shotId)=>active.some(item=>item.role===role&&(!shotId||item.shotId===shotId));
  const checks=(repair?[[`正式脚本`,has('script.final')],[`视觉参考`,has('image.reference')],[`相邻镜 S12`,has('storyboard.draft','S12')],[`相邻镜 S14`,has('storyboard.draft','S14')]]:[[`正式脚本`,has('script.final')],[`视觉参考`,has('image.reference')]]).concat([['Plugin storyboard-draft@1.4',true],['入口 Skill designing-travel-comedy-series',true],[repair?'镜号范围 · 仅 S13':'镜号范围 · S01–S19',true],['输出须经 Collector 与 Validator',true]]);const missing=checks.filter(([,pass])=>!pass).map(([label])=>label);
  const eventLine=(event)=>event.type==='CODEX_EVENT'?`${new Date(event.occurredAt).toLocaleTimeString('zh-CN')} [CODEX] ${event.payload?.type||'event'}`:`${new Date(event.occurredAt).toLocaleTimeString('zh-CN')} [${event.type.replace('NODE_RUN_','')}] ${event.payload?.progress?.step||''}`;
  return <div className="modal-backdrop"><div className="preflight-modal"><header><div><span>{repair?'ISSUE REPAIR':'PLUGIN RUN'}</span><h2>{nodeRun?`NodeRun ${nodeRun.status}`:repair?'修复预检 · 仅补齐 S13':'执行预检 · 分镜草图生成'}</h2></div><button onClick={close}><X/></button></header>{nodeRun?<div className="run-progress"><Robot size={42}/><b>{progress.step}</b><span>{nodeRun.runnerId||'等待 Runner'} · 已完成 {progress.current} / {progress.total} 个执行步骤</span><div><i style={{width:`${Math.round(progress.current/progress.total*100)}%`}}></i></div><pre>{events.length?events.slice(-6).map(eventLine).join('\n'):'等待队列事件…'}</pre>{nodeRun.status==='COMPLETED'&&<div className="preflight-warning"><Info/>{nodeRun.executionAdapter==='contract-dry-run'?'控制面与执行收据已完成；当前为 dry-run，未产生图片。':`Codex 输出已通过 Collector 校验并登记 ${nodeRun.output?.outputArtifactIds?.length||0} 个 Artifact。`}</div>}{nodeRun.status==='FAILED'&&<div className="preflight-warning"><Warning/>{nodeRun.errorCode} · {nodeRun.error}</div>}<footer><button onClick={close}>{terminal?'关闭':'隐藏'}</button>{running&&<button onClick={cancel}>取消运行</button>}{canRetry&&<button className="primary" onClick={retry}>重试 NodeRun</button>}</footer></div>:<><div className="repair-summary"><span>执行范围</span><b>{repair?'S13 单镜修复':'S01–S19 全量生成'}</b><small>{repair?'复用原输入快照，不改动已通过的 18 项':'创建新的完整输出集合'}</small></div><div className="preflight-list">{checks.map(([label,pass])=><div key={label}>{pass?<Check/>:<Warning/>}<span>{label}</span><b className={pass?'':'bad'}>{pass?'PASS':'缺失'}</b></div>)}</div><div className="preflight-warning"><Warning/>{missing.length?`输入未冻结：${missing.join('、')}。请先从资产入口补齐，当前不会创建 Codex Turn。`:'运行时只提交冻结的 Plugin Contract；Codex 完成后仍须通过文件、路径、Hash 与镜号校验。'}</div><footer><button onClick={close}>取消</button><button className="primary" disabled={missing.length>0} onClick={start}><Play weight="fill"/>{repair?'创建 S13 修复 NodeRun':'创建并运行 NodeRun'}</button></footer></>}</div></div>;
}

function AdminConsole() {
  const [section,setSection]=useState('plugins');
  const [editorTab,setEditorTab]=useState('input');
  const [skillOpen,setSkillOpen]=useState(false);
  const [analysisStep,setAnalysisStep]=useState(1);
  const [runners,setRunners]=useState([]);
  const [auditEvents,setAuditEvents]=useState([]);
  useEffect(()=>{if(section==='runners')agentWorkbenchApi.listRunners().then(result=>setRunners(result.items||[])).catch(()=>setRunners([]));if(section==='audit')agentWorkbenchApi.listAuditEvents({entityType:'NodeRun'}).then(result=>setAuditEvents(result.items||[])).catch(()=>setAuditEvents([]))},[section]);
  const sections=[['overview','管理总览',GridFour],['projects','工程治理',FolderOpen],['workflows','工作流模板',Stack],['plugins','插件管理',PuzzlePiece],['skills','Skill 分析',Sparkle],['runners','Runner 集群',Robot],['policies','权限与审批',ShieldCheck],['audit','审计与收据',FileCode]];
  return <div className="admin-shell"><aside className="admin-nav"><p>管理模块</p>{sections.map(([id,label,Icon])=><button key={id} className={section===id?'active':''} onClick={()=>{setSection(id); if(id==='skills')setSkillOpen(true)}}><Icon/><span>{label}</span>{id==='plugins'&&<em>8</em>}</button>)}</aside><main className="admin-main">{section==='plugins'?<><header className="admin-title"><div><span>PLUGIN REGISTRY</span><h1>插件配置管理</h1><p>配置可执行节点的输入、输出、界面与运行契约。</p></div><div><button onClick={()=>setSkillOpen(true)}><Sparkle/>从 Skill 转换</button><button className="primary"><Plus/>新建原生插件</button></div></header><div className="plugin-layout"><section className="plugin-list"><div className="list-tools"><div><MagnifyingGlass/><input placeholder="搜索插件"/></div><button aria-label="筛选插件"><SlidersHorizontal/></button></div>{[['Storyboard Draft','storyboard-draft','1.4','ENABLED'],['Seedance Video','seedance-video','2.1','ENABLED'],['Script Architect','script-architect','1.3','TESTING'],['Asset Analyzer','asset-analyzer','0.9','DRAFT']].map((p,i)=><button key={p[1]} className={i===0?'active':''}><span className="plugin-icon"><PuzzlePiece/></span><div><b>{p[0]}</b><small>{p[1]} · v{p[2]}</small></div><em className={p[3].toLowerCase()}>{p[3]}</em></button>)}</section><section className="plugin-editor"><header><div><span>storyboard-draft</span><h2>Storyboard Draft v1.4</h2></div><span className="enabled-dot">ENABLED</span></header><nav>{[['basic','基础'],['input','输入'],['output','输出'],['ui','节点 UI'],['runtime','执行适配'],['security','权限安全'],['test','测试发布']].map(([id,label])=><button className={editorTab===id?'active':''} onClick={()=>setEditorTab(id)} key={id}>{label}</button>)}</nav>{editorTab==='input'?<SchemaEditor/>:editorTab==='output'?<OutputEditor/>:editorTab==='ui'?<NodePreview/>:<GenericEditor tab={editorTab}/>}</section></div></>:<AdminSection section={section} openSkills={()=>setSkillOpen(true)} runners={runners} auditEvents={auditEvents}/>}</main>{skillOpen&&<SkillWizard step={analysisStep} setStep={setAnalysisStep} close={()=>{setSkillOpen(false);setAnalysisStep(1)}}/>}</div>;
}

function AdminSection({section,openSkills,runners=[],auditEvents=[]}){
  const views={
    overview:['ADMIN OVERVIEW','管理总览','先处理影响制作的阻塞，再查看平台运行健康度。',['进行中工程','3'],['阻塞问题','1'],['可用插件','6']],
    projects:['PROJECT GOVERNANCE','工程治理','查看每个 EP 的阶段、阻塞和最近一次可复现执行。',['活跃工程','3'],['待审批','2'],['异常工程','1']],
    workflows:['WORKFLOW TEMPLATES','工作流模板','管理柠萌旅行记各生产阶段的节点图与 Gate 规则。',['已发布模板','4'],['草稿版本','2'],['待升级节点','3']],
    skills:['SKILL ANALYSIS','Skill 分析','先静态分析，再将明确能力转换为可执行插件契约。',['已分析 Skill','12'],['需人工确认','2'],['已转插件','7']],
    runners:['RUNNER CLUSTER','Runner 集群','确认 Codex 执行通道、队列与资源占用。',['在线 Runner','3'],['队列任务','2'],['失败率','1.8%']],
    policies:['POLICY & APPROVAL','权限与审批','控制插件可读写目录、工具调用和发布权限。',['待审批','2'],['高风险能力','1'],['策略版本','v1.6']],
    audit:['AUDIT RECEIPTS','审计与收据','按 NodeRun 追溯输入快照、实际 Skill 路由和产物 Hash。',['今日 Run','18'],['可复现','17'],['异常收据','1']],
  };
  const data=views[section]||views.overview;
  const liveRows=section==='runners'?runners.map(item=>[new Date(item.lastHeartbeatAt).toLocaleTimeString('zh-CN'),item.name,item.adapter,item.status]):section==='audit'?auditEvents.slice(0,8).map(item=>[new Date(item.occurredAt).toLocaleTimeString('zh-CN'),item.action,item.actorId,item.entityId]):null;
  return <div className="admin-dashboard"><header className="admin-title"><div><span>{data[0]}</span><h1>{data[1]}</h1><p>{data[2]}</p></div>{section==='skills'&&<button className="primary" onClick={openSkills}><Sparkle/>分析一个 Skill</button>}</header><div className="admin-stats">{data.slice(3).map(([label,value])=><section key={label}><span>{label}</span><b>{section==='runners'&&label==='在线 Runner'?runners.filter(item=>item.status==='ONLINE').length:section==='audit'&&label==='今日 Run'?auditEvents.length:value}</b><small>{label==='阻塞问题'||label==='异常工程'||label==='异常收据'?'需要处理':'当前状态'}</small></section>)}</div><section className="admin-priority"><div><span>最高优先级</span><h2>{section==='overview'||section==='projects'?'EP01 · 分镜准备被 S13 缺漏阻塞':section==='runners'?(runners[0]?`${runners[0].name} · ${runners[0].status} · ${runners[0].adapter}`:'暂无已注册 Runner'):section==='policies'?'storyboard-draft 请求图像生成权限':section==='audit'?(auditEvents[0]?`${auditEvents[0].action} · ${auditEvents[0].entityId}`:'暂无 NodeRun 审计事件'):'designing-travel-comedy-series · 2 项输出待确认'}</h2><p>所有管理事件都回链到工程、节点、NodeRun 与产物，不允许只保留孤立日志。</p></div><button>{section==='skills'?'继续分析':'查看详情'}<ArrowRight/></button></section><section className="admin-table"><header><b>{liveRows?'真实服务数据':'最近活动'}</b><button>查看全部</button></header>{(liveRows||[['10:25','EP01 / S13 修复','Runner-02','RUNNING'],['10:18','Storyboard Draft v1.4','dandan','PUBLISHED'],['09:42','Skill 静态分析','system','NEEDS REVIEW']]).map((row,rowIndex)=><div key={`${row[0]}-${rowIndex}`}>{row.map((cell,i)=><span className={i===3?String(cell).toLowerCase().replace(' ','-'):''} key={`${cell}-${i}`}>{cell}</span>)}</div>)}</section></div>;
}

function SchemaEditor(){const [field,setField]=useState('reference_images');return <div className="schema-editor"><aside><b>输入字段</b>{['reference_images','script','shot_range','style_config'].map(x=><button className={field===x?'active':''} onClick={()=>setField(x)} key={x}>{x}<span>≡</span></button>)}<button className="add-field"><Plus/>添加字段</button></aside><div className="schema-form"><div className="form-row"><label>字段名称<input value={field} readOnly/></label><label>显示名称<input defaultValue={field==='reference_images'?'参考图片集合':'正式脚本'}/></label></div><div className="form-row"><label>类型<select><option>images / AssetCollection</option><option>document</option><option>string</option></select></label><label>端口类型<select><option>artifact.image_collection</option></select></label></div><div className="form-row"><label>最少数量<input type="number" defaultValue="1"/></label><label>最多数量<input type="number" defaultValue="20"/></label></div><label>允许角色<div className="tag-input"><span>character ×</span><span>location ×</span><span>costume ×</span></div></label><div className="switch-row"><div><b>必填字段</b><span>运行前必须完成绑定</span></div><input type="checkbox" defaultChecked/></div><div className="switch-row"><div><b>显示为节点端口</b><span>允许连接 AssetCollection</span></div><input type="checkbox" defaultChecked/></div></div><NodePreview/></div>}

function OutputEditor(){return <div className="output-editor"><section><h3>输出契约</h3><label>输出类型<select><option>AssetCollection</option></select></label><label>Artifact Role<select><option>storyboard.draft</option></select></label><div className="form-row"><label>最少数量<input defaultValue="19"/></label><label>允许部分成功<select><option>是，Gate 决定是否阻塞</option></select></label></div><label>文件命名<input defaultValue="{shot_id}-draft-{run_id}.png"/></label><label>输出目录<input defaultValue="/artifacts/storyboard/drafts/{run_id}"/></label><label>必需 Validator<div className="tag-input"><span>shot-coverage ×</span><span>composition-minimum ×</span></div></label></section><NodePreview/></div>}

function NodePreview(){return <aside className="node-preview"><span>节点实时预览</span><div className="preview-card"><header><div><small>PLUGIN RUN</small><b>分镜草图生成</b></div><em>READY</em></header><label>参考图片集合<div className="preview-thumbs">{media.slice(0,4).map(x=><img key={x.id} src={x.src} alt=""/>)}</div></label><div className="preview-fields"><span>比例　16:9</span><span>输出　2K</span></div><button><Lightning weight="fill"/>预检并运行</button></div></aside>}

function GenericEditor({tab}){return <div className="generic-editor"><div className="empty-illustration"><GearSix size={38}/></div><h3>{tab==='basic'?'基础信息':tab==='runtime'?'执行适配':tab==='security'?'权限与安全':tab==='test'?'测试与发布':'节点界面配置'}</h3><p>该区域已纳入交互结构；当前原型重点验证输入、输出、节点预览和 Skill 转换路径。</p><button className="primary">保存为新草稿版本</button></div>}

function SkillWizard({step,setStep,close}){const [confirmed,setConfirmed]=useState([]);const canNext=step!==2||confirmed.length===2;return <div className="modal-backdrop"><div className="skill-wizard"><header><div><span>SKILL → PLUGIN</span><h2>将 Skill 转换为插件</h2></div><button onClick={close}><X/></button></header><div className="wizard-steps">{['选择来源','分析报告','定义 Operations','映射输入输出','配置节点 UI','测试与发布'].map((x,i)=><div className={step===i+1?'active':step>i+1?'done':''} key={x}><i>{step>i+1?<Check/>:i+1}</i><span>{x}</span></div>)}</div><div className="wizard-content">{step===1?<><label>Skill 来源<select><option>已安装 Skill 注册表</option><option>本地 Skill 目录</option><option>Git 仓库</option></select></label><label>选择 Skill<div className="skill-select"><Sparkle/><div><b>designing-travel-comedy-series</b><span>柠萌旅行记脚本与视觉生产入口</span></div><Check/></div></label><div className="notice"><Info/>只读取 SKILL.md 与直接引用资源，不会执行 Skill。</div></>:step===2?<AnalysisReport confirmed={confirmed} setConfirmed={setConfirmed}/>:<ConversionStep step={step}/>}</div><footer><button onClick={step===1?close:()=>setStep(step-1)}>{step===1?'取消':'上一步'}</button><button className="primary" disabled={!canNext} onClick={()=>step<6?setStep(step+1):close()}>{step===1?'开始分析':step===2&&!canNext?`确认推断项 ${confirmed.length}/2`:step===6?'完成并保存草稿':'下一步'}</button></footer></div></div>}

function AnalysisReport({confirmed,setConfirmed}){const toggle=(id)=>setConfirmed(s=>s.includes(id)?s.filter(x=>x!==id):[...s,id]);return <div className="analysis-report"><div className="score"><b>B</b><div><strong>需要人工映射</strong><span>8 项明确声明 · 2 项 AI 推断待确认</span></div></div><div className="analysis-columns"><section><header><b>明确声明</b><span>可直接转换</span></header>{['generate_script','generate_storyboard','generate_video','文件读写与图像生成'].map(x=><p key={x}><Check/>{x}<small>来自 SKILL.md</small></p>)}</section><section className="inference-list"><header><b>AI 推断 · 必须确认</b><span>{confirmed.length}/2</span></header>{[['role','输出资产角色：storyboard.draft'],['validator','每次输出必须运行镜号覆盖 Validator']].map(([id,label])=><label className={confirmed.includes(id)?'confirmed':''} key={id}><input type="checkbox" checked={confirmed.includes(id)} onChange={()=>toggle(id)}/><span><b>{label}</b><small>依据：输出目录、镜号命名与流程 Gate 规则</small></span></label>)}</section></div><p className="notice"><Warning/>未确认的推断不会写入插件契约，也不能进入输入输出映射。</p></div>}

function ConversionStep({step}){const content={3:['定义 Operations','将一个 Skill 拆分为稳定、可独立执行的插件操作。'],4:['映射输入输出','确认 JSON Schema、资产角色、集合数量和 Validator。'],5:['配置节点 UI','选择节点内字段、缩略图数量、端口和主操作。'],6:['沙盒测试与发布','使用测试夹具创建 NodeRun，发布前完成权限与影响检查。']}[step];return <div className="conversion-step"><PuzzlePiece size={48}/><h3>{content[0]}</h3><p>{content[1]}</p><div className="conversion-cards"><div><Check/><span>来源版本已冻结</span></div><div><Check/><span>生成适配器草稿</span></div><div><ClockCounterClockwise/><span>{step===6?'等待测试':'后续步骤自动继承'}</span></div></div></div>}

function EvaluationNode({id,data,selected}){
  return <div className={`eval-node eval-node--${data.tone||'blue'} ${selected?'is-selected':''}`}>
    <Handle type="target" position={Position.Left} className="handle handle--blue"/>
    <header><div><span>{data.kind}</span><h3>{data.title}</h3></div><em>{data.status}</em></header>
    {data.images&&<div className="eval-thumbs">{media.map(x=><img src={x.src} alt={x.name} key={x.id}/>)}</div>}
    {data.metrics&&<div className="eval-metrics">{data.metrics.map(([label,value,state])=><div key={label}><span>{label}</span><b className={state||''}>{value}</b></div>)}</div>}
    {data.copy&&<p>{data.copy}</p>}
    <footer><span>#{id}</span><button onClick={(e)=>{e.stopPropagation();data.open?.()}}>查看详情</button></footer>
    <Handle type="source" position={Position.Right} className="handle handle--blue"/>
  </div>
}

const evaluationNodeTypes={evaluation:EvaluationNode};
const evaluationNodeHeights={dataset:181,baseline:167,candidate:167,evaluators:195,aggregate:195,human:115,gate:172};

function FitEvaluationCanvasOnResize(){
  const {fitView}=useReactFlow();
  useEffect(()=>{const container=document.querySelector('.evaluation-canvas');if(!container)return;let frame;const observer=new ResizeObserver(()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>fitView({padding:.04,duration:180}))});observer.observe(container);return()=>{observer.disconnect();cancelAnimationFrame(frame)}},[fitView]);
  return null;
}

function EvaluationCanvas({running,openResult,openReview,result,reviewTasks=[]}){
  const metrics=result?.metrics;const summary=result?.summary;const gate=result?.gate;
  const nodes=useMemo(()=>[
    {id:'dataset',type:'evaluation',position:{x:30,y:210},style:{width:240},data:{kind:'TEST DATASET',title:'EP01 黄金测试集',status:'24 CASES',tone:'green',images:true,copy:'正常 16 · 边界 5 · 历史失败 3',open:openResult}},
    {id:'baseline',type:'evaluation',position:{x:320,y:90},style:{width:220},data:{kind:'WORKFLOW VERSION',title:'Baseline · V1.2',status:'FROZEN',metrics:[['通过率','79%'],['成本','¥42.6'],['P95','94s']],open:openResult}},
    {id:'candidate',type:'evaluation',position:{x:320,y:390},style:{width:220},data:{kind:'WORKFLOW VERSION',title:'Candidate · V1.3',status:running?'RUNNING':'TESTING',tone:'purple',metrics:[['通过率','88%','good'],['成本','¥31.8','good'],['P95','71s','good']],open:openResult}},
    {id:'evaluators',type:'evaluation',position:{x:610,y:205},style:{width:250},data:{kind:'EVALUATOR PACK',title:'脚本与分镜质量包',status:'6 RULES',tone:'yellow',metrics:[['镜号覆盖','deterministic'],['角色连续性','vision judge'],['脚本一致性','model judge'],['来源完整性','schema']],open:openResult}},
    {id:'aggregate',type:'evaluation',position:{x:920,y:205},style:{width:230},data:{kind:'METRIC AGGREGATOR',title:'版本对比与阈值',status:`${summary?.score??82} / 100`,metrics:[['镜号完整性',String(metrics?.coverage?.score??96),(metrics?.coverage?.score??96)>=100?'good':'warn'],['连续性',String(metrics?.compositionContinuity?.score??84)],['可追溯',String(metrics?.provenance?.score??100),'good'],['成本效率',String(metrics?.costEfficiency?.score??76),'warn']],open:openResult}},
    {id:'human',type:'evaluation',position:{x:920,y:480},style:{width:230},data:{kind:'HUMAN REVIEW',title:'人工复核队列',status:`${reviewTasks.filter(task=>task.status!=='SUBMITTED').length||(result?.pendingReviews??2)} PENDING`,tone:'yellow',copy:reviewTasks.length?reviewTasks.map(task=>`${task.shotId||task.caseId} · ${task.status}`).join(' · '):'S13 构图偏差 · S17 台词节奏',open:openReview}},
    {id:'gate',type:'evaluation',position:{x:1210,y:205},style:{width:220},data:{kind:'RELEASE GATE',title:'分镜定稿发布门',status:gate?.verdict||'BLOCKED',tone:gate?.verdict==='PASS'?'green':'red',metrics:[['失败规则',String(gate?.failedRules?.length??1),(gate?.failedRules?.length??1)?'warn':'good'],['待复核',String(gate?.pendingReviews??2),'warn'],['回归变化',`${summary?.baselineDelta??9}%`,'good']],open:openResult}},
  ].map(node=>({...node,initialWidth:node.style.width,initialHeight:evaluationNodeHeights[node.id]})),[running,openResult,openReview,result,reviewTasks,metrics,summary,gate]);
  const edges=useMemo(()=>[
    {id:'d-b',source:'dataset',target:'baseline',animated:running,style:{stroke:'#4f6d5a'}},{id:'d-c',source:'dataset',target:'candidate',animated:running,style:{stroke:'#765bb2'}},{id:'b-e',source:'baseline',target:'evaluators',style:{stroke:'#54657f'}},{id:'c-e',source:'candidate',target:'evaluators',animated:running,style:{stroke:'#6c79c9'}},{id:'e-a',source:'evaluators',target:'aggregate',animated:running,style:{stroke:'#8b764d'}},{id:'a-g',source:'aggregate',target:'gate',style:{stroke:'#7a527c'}},{id:'a-h',source:'aggregate',target:'human',style:{stroke:'#876e48',strokeDasharray:'6 5'}},{id:'h-g',source:'human',target:'gate',style:{stroke:'#8f6651',strokeDasharray:'6 5'}},
  ],[running]);
  return <ReactFlow nodes={nodes} edges={edges} nodeTypes={evaluationNodeTypes} fitView fitViewOptions={{padding:.04}} minZoom={.45} maxZoom={1.25}><FitEvaluationCanvasOnResize/><Background color="#283141" gap={24} size={1.2}/><MiniMap nodeColor={n=>n.id==='gate'?'#913e42':n.id==='candidate'?'#765bb2':'#344154'}/><Controls showInteractive={false}/></ReactFlow>;
}

function EvaluationInspector({close,addRegression}){
  return <aside className="eval-inspector"><header><div><span>FAILED SAMPLE</span><h2>CASE-013 · S13 构图偏差</h2></div><button onClick={close}><X/></button></header><div className="eval-score"><b>68</b><div><strong>未达到发布阈值 80</strong><span>角色连续性 PASS · 构图一致性 FAIL</span></div></div><div className="eval-compare"><figure><img src={media[3].src} alt="期望构图"/><figcaption>期望 · S12/S14 连续性</figcaption></figure><figure><img src={media[1].src} alt="候选结果"/><figcaption>候选 · 人物位置偏左</figcaption></figure></div><section className="detail-card"><h3>Evaluator 证据</h3><dl><div><dt>镜号覆盖</dt><dd className="good">PASS</dd></div><div><dt>角色外观</dt><dd className="good">PASS · 0.91</dd></div><div><dt>构图连续性</dt><dd className="bad">FAIL · 0.63</dd></div><div><dt>脚本一致性</dt><dd>PASS · 0.88</dd></div></dl></section><section className="detail-card"><h3>失败原因</h3><p>S13 应承接 S12 中央停步并过渡到 S14 进入町屋；候选结果将人物移动到左侧，破坏视线和移动方向。</p></section><button className="primary wide" onClick={addRegression}><Plus/>加入历史失败回归集</button></aside>;
}

function HumanReviewInspector({tasks,artifacts,close,onTaskUpdated,onDecision}){
  const [selectedId,setSelectedId]=useState(tasks[0]?.id||null);const [claimToken,setClaimToken]=useState('');const [comment,setComment]=useState('');const [busy,setBusy]=useState(false);const [message,setMessage]=useState('');
  useEffect(()=>{if(!tasks.some(task=>task.id===selectedId))setSelectedId(tasks[0]?.id||null)},[tasks,selectedId]);
  const task=tasks.find(item=>item.id===selectedId)||tasks[0];const evidence=task?(artifacts||[]).filter(item=>task.evidenceArtifactIds?.includes(item.id)):[];
  const claim=async()=>{if(!task)return;setBusy(true);setMessage('');try{const result=await agentWorkbenchApi.claimReviewTask(task.id);setClaimToken(result.claimToken);onTaskUpdated(result.task);setMessage(`已领取，锁定至 ${new Date(result.task.claimExpiresAt).toLocaleTimeString('zh-CN')}`)}catch(error){setMessage(error.message)}finally{setBusy(false)}};
  const submit=async(verdict)=>{if(!task||!claimToken)return;setBusy(true);setMessage('');try{const result=await agentWorkbenchApi.submitReviewDecision(task.id,claimToken,{verdict,comment,evidenceArtifactIds:task.evidenceArtifactIds||[]});setClaimToken('');onTaskUpdated(result.task);onDecision(result);setMessage(`已提交 ${verdict} · Gate ${result.gateDecision?.verdict||'待计算'}`)}catch(error){setMessage(error.message)}finally{setBusy(false)}};
  return <aside className="eval-inspector review-inspector"><header><div><span>HUMAN REVIEW</span><h2>人工复核队列</h2></div><button onClick={close}><X/></button></header>{tasks.length?<><div className="review-task-tabs">{tasks.map(item=><button key={item.id} className={item.id===task?.id?'active':''} onClick={()=>{setSelectedId(item.id);setClaimToken('');setComment('')}}><b>{item.shotId||item.caseId}</b><span>{item.status}</span></button>)}</div><section className="detail-card"><h3>{task.title}</h3><dl><div><dt>任务状态</dt><dd>{task.status}</dd></div><div><dt>领取人</dt><dd>{task.assigneeId||'未领取'}</dd></div><div><dt>来源 Run</dt><dd>{task.runId}</dd></div></dl></section><section className="detail-card"><h3>关联证据</h3>{evidence.length?<div className="review-evidence">{evidence.map(item=><figure key={item.id}>{item.mediaType?.startsWith('image/')?<img src={item.uri} alt={item.filename}/>:<FileCode/>}<figcaption>{item.filename}</figcaption></figure>)}</div>:<div className="review-evidence"><figure><img src={media[3].src} alt="评估快照"/><figcaption>评估快照 · {task.shotId||task.caseId}</figcaption></figure></div>}<small className="review-proof">{task.evidenceArtifactIds?.length||0} 个真实 Artifact 证据</small></section>{task.status!=='SUBMITTED'?<section className="detail-card"><h3>审核意见</h3><textarea value={comment} onChange={event=>setComment(event.target.value)} placeholder="说明判断依据、需要修改的范围与证据…"/><div className="review-actions">{!claimToken?<button className="primary" disabled={busy||task.status==='CLAIMED'} onClick={claim}><UsersThree/>领取任务</button>:<><button disabled={busy||!comment.trim()} onClick={()=>submit('NEEDS_CHANGES')}><Warning/>需修改</button><button className="primary" disabled={busy||!comment.trim()} onClick={()=>submit('PASS')}><Check/>通过</button></>}</div></section>:<section className="detail-card review-decision"><h3>已提交结论</h3><b className={task.verdict==='PASS'?'good':'warn'}>{task.verdict}</b><p>{task.comment}</p></section>}{message&&<p className="review-message">{message}</p>}</>:<div className="review-empty"><UsersThree size={34}/><b>暂无复核任务</b><span>运行评估后，失败样本会自动进入队列。</span></div>}</aside>;
}

function EvaluationSection({section}){
  const content={datasets:['测试数据集','24 个代表性用例，覆盖正常路径、边界条件和历史失败。'],evaluators:['Evaluator 注册表','确定性规则、视觉 Judge、模型 Judge 与人工复核统一管理。'],experiments:['实验与版本对比','比较 Baseline V1.2 与 Candidate V1.3 的质量、延迟和成本。'],failures:['失败样本库','将生产问题转为可重复执行的回归测试。'],gates:['发布 Gate','只有必需规则通过且人工复核完成后才允许发布。']}[section];
  return <div className="eval-section"><header><span>EVALUATION MANAGEMENT</span><h1>{content[0]}</h1><p>{content[1]}</p></header><div className="eval-section-grid">{[['EP01-golden-v3','24 cases','READY'],['S13 continuity failures','6 cases','NEEDS REVIEW'],['Storyboard coverage suite','19 rules','ENABLED']].map(x=><section key={x[0]}><PuzzlePiece/><div><b>{x[0]}</b><span>{x[1]}</span></div><em>{x[2]}</em><button>打开</button></section>)}</div></div>;
}

function EvaluationWorkspace({onGateUpdated}){
  const [section,setSection]=useState('canvas');const [running,setRunning]=useState(false);const [inspector,setInspector]=useState(false);const [inspectorMode,setInspectorMode]=useState('failure');const [notice,setNotice]=useState('');const [eventLog,setEventLog]=useState([]);const [evaluationResult,setEvaluationResult]=useState(null);const [foreignLock,setForeignLock]=useState(null);const [reviewTasks,setReviewTasks]=useState([]);const [reviewArtifacts,setReviewArtifacts]=useState([]);const tabId=useRef(null);if(!tabId.current)tabId.current=getEvaluationTabId();
  const loadReviews=useCallback(async(runId)=>{const [taskResult,artifactResult]=await Promise.all([agentWorkbenchApi.listReviewTasks({runId}),agentWorkbenchApi.listArtifacts({projectId:'EP01'})]);setReviewTasks(taskResult.items||[]);setReviewArtifacts(artifactResult.items||[]);return taskResult.items||[]},[]);
  const followRun=useCallback(async(run,{recovered=false}={})=>{if(!acquireEvaluationLock(tabId.current,run.id)){const lock=readEvaluationLock();setForeignLock(lock);setNotice(`另一标签页正在执行 ${lock?.runId||'评估任务'}，当前页面保持只读`);return null}setForeignLock(null);setRunning(true);localStorage.setItem('agent.activeEvaluationRunId',run.id);setNotice(`${run.id} · ${recovered?'已恢复运行':'正在连接事件流'}`);try{const completed=await agentWorkbenchApi.waitForEvaluationEvents(run.id,(event)=>{setEventLog((current)=>[...current,event].slice(-4));if(event.type==='EVALUATION_STARTED')setNotice(`${run.id} · SSE 已连接 · 正在执行 ${event.payload?.totalCases||24} 个样本`);if(event.type==='HEARTBEAT')renewEvaluationLock(tabId.current,run.id);if(event.type==='EVALUATION_COMPLETED')setNotice(`${run.id} · 已收到完成事件`) });localStorage.removeItem('agent.activeEvaluationRunId');setEvaluationResult(completed.result);onGateUpdated?.(completed.result.gateDecision);await loadReviews(completed.id);setInspectorMode('review');setInspector(true);setNotice(`评估完成 · ${completed.result.summary.passed} 通过，${completed.result.pendingReviews} 项需要人工复核 · Gate ${completed.result.gate.verdict}`);return completed}catch(error){setNotice(`评估失败 · ${error.message}`);throw error}finally{releaseEvaluationLock(tabId.current);setRunning(false)}},[onGateUpdated,loadReviews]);
  useEffect(()=>{const sync=()=>{const lock=readEvaluationLock();setForeignLock(lock&&lock.ownerId!==tabId.current?lock:null)};sync();window.addEventListener('storage',sync);const timer=setInterval(sync,2000);return()=>{window.removeEventListener('storage',sync);clearInterval(timer)}},[]);
  useEffect(()=>{if(!running)return;const timer=setInterval(()=>renewEvaluationLock(tabId.current,localStorage.getItem('agent.activeEvaluationRunId')||'PENDING'),8000);return()=>clearInterval(timer)},[running]);
  useEffect(()=>{let active=true;(async()=>{try{const storedId=localStorage.getItem('agent.activeEvaluationRunId');let run=storedId?await agentWorkbenchApi.getEvaluationRun(storedId):null;if(!run){const result=await agentWorkbenchApi.listEvaluationRuns({projectId:'EP01',status:'RUNNING'});run=result.items?.[0]}if(!active||!run)return;if(run.status==='RUNNING')await followRun(run,{recovered:true});else if(run.status==='COMPLETED'){localStorage.removeItem('agent.activeEvaluationRunId');setEvaluationResult(run.result);onGateUpdated?.(run.result?.gateDecision);await loadReviews(run.id);setNotice(`已恢复最近评估 · Gate ${run.result?.gate?.verdict}`)}}catch(error){if(active){localStorage.removeItem('agent.activeEvaluationRunId');setNotice(`运行恢复失败 · ${error.message}`)}}})();return()=>{active=false}},[followRun,onGateUpdated,loadReviews]);
  const runEval=async()=>{setEventLog([]);if(!acquireEvaluationLock(tabId.current)){const lock=readEvaluationLock();setForeignLock(lock);setNotice(`另一标签页正在执行 ${lock?.runId||'评估任务'}，不能重复创建`);return}try{const run=await agentWorkbenchApi.createEvaluationRun();renewEvaluationLock(tabId.current,run.id);await followRun(run)}catch{releaseEvaluationLock(tabId.current)}};
  const items=[['canvas','评估画布',GridFour],['datasets','测试集',Stack],['evaluators','Evaluators',Checks],['experiments','实验对比',ArrowsClockwise],['failures','失败样本',Warning],['gates','发布 Gate',ShieldCheck]];
  const summary=evaluationResult?.summary||completedEvaluationResult.summary;const gate=evaluationResult?.gate||{verdict:'BLOCKED'};
  const updateReviewTask=(task)=>setReviewTasks(current=>current.some(item=>item.id===task.id)?current.map(item=>item.id===task.id?task:item):[...current,task]);const handleReviewDecision=(result)=>{setEvaluationResult(current=>current?{...current,pendingReviews:result.pendingReviews,gate:result.gateDecision,gateDecision:result.gateDecision}:current);onGateUpdated?.(result.gateDecision)};
  return <div className={`evaluation-shell ${inspector&&section==='canvas'?'has-inspector':''}`}><aside className="evaluation-nav"><p>评估中心</p>{items.map(([id,label,Icon])=><button className={section===id?'active':''} key={id} onClick={()=>setSection(id)}><Icon/><span>{label}</span>{id==='failures'&&<em>2</em>}</button>)}<div className="evaluation-nav__foot"><span>当前 Suite</span><b>EP01-quality-v1</b><small>24 cases · 6 evaluators</small></div></aside><main className="evaluation-main">{section==='canvas'?<><div className="evaluation-toolbar"><div><span>EVALUATION CANVAS</span><h1>EP01 · 分镜质量评估</h1></div><div><button>基线 V1.2 <CaretDown/></button><button>候选 V1.3 <CaretDown/></button><button className="primary" onClick={runEval}><Play weight="fill"/>{running?'评估运行中':'运行评估'}</button></div></div><div className="evaluation-summary"><span><small>当前得分</small><b>{summary.score} / 100</b></span><span><small>测试结果</small><b>{summary.passed} / {summary.total} 通过</b></span><span><small>相对基线</small><b className="good">+{summary.baselineDelta}%</b></span><span><small>发布状态</small><b className={gate.verdict==='PASS'?'good':'bad'}>{gate.verdict}</b></span><button onClick={()=>{setInspectorMode('failure');setInspector(true)}}>查看 {evaluationResult?.failedCaseIds?.length||2} 个失败样本</button></div><div className="evaluation-canvas"><EvaluationCanvas running={running} result={evaluationResult} reviewTasks={reviewTasks} openResult={()=>{setInspectorMode('failure');setInspector(true)}} openReview={()=>{setInspectorMode('review');setInspector(true)}}/></div>{eventLog.length>0&&<div className="eval-event-stream"><b><i></i>实时事件</b>{eventLog.map((event,index)=><span key={`${event.type}-${index}`}><time>{new Date(event.occurredAt).toLocaleTimeString('zh-CN')}</time>{event.type}</span>)}</div>}{notice&&<div className="eval-notice"><i className={running?'running':''}></i>{notice}<button onClick={()=>setNotice('')}><X/></button></div>}</>:<EvaluationSection section={section}/>}</main>{inspector&&section==='canvas'&&(inspectorMode==='review'?<HumanReviewInspector tasks={reviewTasks} artifacts={reviewArtifacts} close={()=>setInspector(false)} onTaskUpdated={updateReviewTask} onDecision={handleReviewDecision}/>:<EvaluationInspector close={()=>setInspector(false)} addRegression={()=>setNotice('CASE-013 已加入历史失败回归集')}/>)}</div>;
}

export function App() {
  const [workspace,setWorkspace]=useState('production');
  const [selection,setSelection]=useState('output');
  const [tab,setTab]=useState('content');
  const [preview,setPreview]=useState({...media[3],shot:'S12'});
  const [assetModal,setAssetModal]=useState(false);
  const [preflight,setPreflight]=useState(false);
  const [runMode,setRunMode]=useState('full');
  const [running,setRunning]=useState(false);
  const [nodeRun,setNodeRun]=useState(null);
  const [nodeRunEvents,setNodeRunEvents]=useState([]);
  const [toast,setToast]=useState('');
  const [artifacts,setArtifacts]=useState([]);
  const [gateDecision,setGateDecision]=useState(null);
  const loadArtifacts=useCallback(async()=>{try{const result=await agentWorkbenchApi.listArtifacts({projectId:'EP01'});setArtifacts(result.items||[])}catch(error){setToast(`资产读取失败 · ${error.message}`)}},[]);
  useEffect(()=>{loadArtifacts()},[loadArtifacts]);
  useEffect(()=>{agentWorkbenchApi.listGateDecisions('EP01').then((result)=>setGateDecision(result.items?.[0]||null)).catch(()=>{})},[]);
  const openInspector=useCallback((id,nextTab='content',asset)=>{setSelection(id);setTab(nextTab);if(asset)setPreview(asset)},[]);
  const runPlugin=useCallback((mode='full')=>{setRunMode(mode);setNodeRun(null);setNodeRunEvents([]);setPreflight(true)},[]);
  const followNodeRun=async(run)=>{setNodeRun(run);setRunning(true);try{const completed=await agentWorkbenchApi.waitForNodeRunEvents(run.id,(event)=>{setNodeRunEvents(current=>[...current,event].slice(-20));if(event.payload?.progress)setNodeRun(current=>({...current,...event.payload,status:['NODE_RUN_STARTED','NODE_RUN_PROGRESS'].includes(event.type)?'RUNNING':event.type.replace('NODE_RUN_','')}))});setNodeRun(completed);if(completed.status==='COMPLETED'){const receipt=await agentWorkbenchApi.getNodeRunReceipt(completed.id);await loadArtifacts();setToast(completed.executionAdapter==='contract-dry-run'?`控制面执行完成 · 收据 ${receipt.id} · 未产生图片`:`Codex 执行完成 · ${receipt.outputArtifactIds.length} 个 Artifact · 收据 ${receipt.id}`)}else setToast(`NodeRun ${completed.status} · 可在运行弹窗重试`)}catch(error){setToast(`NodeRun 失败 · ${error.message}`)}finally{setRunning(false)}};
  const startRun=async()=>{try{const relevant=artifacts.filter(item=>['image.reference','script.final','storyboard.draft'].includes(item.role)&&item.isActive!==false).map(item=>item.id);const run=await agentWorkbenchApi.createNodeRun({mode:runMode,shotId:runMode==='repair'?'S13':undefined,inputArtifactIds:relevant});setToast(`NodeRun 已排队 · ${run.id}`);await followNodeRun(run)}catch(error){setToast(`无法创建 NodeRun · ${error.message}`)}};
  const cancelRun=async()=>{if(!nodeRun)return;try{setNodeRun(await agentWorkbenchApi.cancelNodeRun(nodeRun.id));setToast('已请求取消 NodeRun')}catch(error){setToast(`取消失败 · ${error.message}`)}};
  const retryRun=async()=>{if(!nodeRun)return;try{setNodeRunEvents([]);const run=await agentWorkbenchApi.retryNodeRun(nodeRun.id);await followNodeRun(run)}catch(error){setToast(`重试失败 · ${error.message}`)}};
  const activateArtifact=async(item)=>{try{const activated=await agentWorkbenchApi.activateArtifact(item.id);await loadArtifacts();setPreview(artifactToMedia(activated));const count=activated.invalidatedArtifactIds?.length||0;setToast(`${activated.filename} 已设为当前版本${count?` · ${count} 个下游产物已标记失效`:''}`)}catch(error){setToast(`版本切换失败 · ${error.message}`)}};
  const confirmAssets=(count)=>{setAssetModal(false);loadArtifacts();setToast(`已将 ${count} 项资产加入 R0 参考包`)};
  return <div className="app-shell"><TopBar workspace={workspace} setWorkspace={setWorkspace} running={running}/>{workspace==='production'?<div className={`production-shell ${selection?'has-inspector':'no-inspector'}`}><StageRail onAssets={()=>setAssetModal(true)} gateDecision={gateDecision}/><main className="canvas-wrap"><div className="canvas-toolbar"><div><button aria-label="返回工程"><ArrowLeft/></button><span>EP01 / 分镜准备</span></div><div><button><MagnifyingGlass/>搜索节点</button><button><GridFour/>自动布局</button><button onClick={()=>setSelection(null)}><SidebarSimple/>纯画布</button></div></div><TaskFocusBar running={running} gateDecision={gateDecision} openEvidence={()=>openInspector('output','content',{...media[3],shot:'S12'})} openIssue={()=>openInspector('validator','issues')} runRepair={()=>runPlugin('repair')}/><ProductionCanvas openInspector={openInspector} addAssets={()=>setAssetModal(true)} running={running} runPlugin={runPlugin} artifacts={artifacts} gateDecision={gateDecision}/><div className={`run-strip ${running?'active':''}`}><span><i></i>{nodeRun?`NodeRun ${nodeRun.status} · ${nodeRun.progress?.current||0} / ${nodeRun.progress?.total||6}`:gateDecision?`最近 Gate · ${gateDecision.verdict} · ${gateDecision.runId}`:'最近运行 · Validator FAIL · 缺失 S13'}</span><button onClick={()=>nodeRun?setPreflight(true):openInspector('validator','issues')}>{nodeRun?'查看运行与收据':'查看问题'}</button></div></main>{selection&&<Inspector selection={selection} tab={tab} setTab={setTab} close={()=>setSelection(null)} preview={preview} runPlugin={runPlugin} addAssets={()=>setAssetModal(true)} artifacts={artifacts} activateArtifact={activateArtifact}/>}</div>:workspace==='evaluation'?<EvaluationWorkspace onGateUpdated={setGateDecision}/>:<AdminConsole/>}{assetModal&&<AssetModal close={()=>setAssetModal(false)} confirm={confirmAssets}/>} {preflight&&<PreflightModal close={()=>setPreflight(false)} start={startRun} cancel={cancelRun} retry={retryRun} running={running} mode={runMode} nodeRun={nodeRun} events={nodeRunEvents} artifacts={artifacts}/>} {toast&&<div className="toast"><Check/>{toast}<button onClick={()=>setToast('')}><X/></button></div>}</div>;
}
