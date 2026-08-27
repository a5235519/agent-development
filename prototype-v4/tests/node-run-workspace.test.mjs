import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareNodeRunWorkspace, collectNodeRunOutputs } from '../server/node-run-workspace.mjs';
import { createNodeRun, storyboardDraftContract } from '../src/domain/nodeRun.js';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(),'node-workspace-')); const artifactFilesDir=join(root,'artifact-files');await mkdir(artifactFilesDir);
  await writeFile(join(artifactFilesDir,'source.png'),'source');
  const artifacts=new Map([['artifact_input',{id:'artifact_input',projectId:'EP01',role:'image.reference',filename:'reference.png',storedFilename:'source.png',sha256:'abc',mediaType:'image/png'}]]);
  const run={...createNodeRun({projectId:'EP01',pluginId:storyboardDraftContract.id,pluginVersion:storyboardDraftContract.version,operation:storyboardDraftContract.operation,mode:'repair',shotId:'S13',inputArtifactIds:['artifact_input']},'node_run_workspace'),deadlineAt:'2026-08-13T00:00:00.000Z'};
  const workspace=await prepareNodeRunWorkspace({rootDir:join(root,'runs'),run,contract:storyboardDraftContract,artifacts,artifactFilesDir});return {root,artifactFilesDir,artifacts,run,workspace};
}

test('prepares an isolated immutable input snapshot and fixed Codex prompt',async()=>{const value=await fixture();const manifest=JSON.parse(await readFile(join(value.workspace.runRoot,'input-manifest.json'),'utf8'));assert.equal(manifest[0].artifactId,'artifact_input');assert.match(value.workspace.prompt,/designing-travel-comedy-series/);assert.match(value.workspace.prompt,/只允许在 staging\/ 写入/);const mode=(await stat(join(value.workspace.runRoot,manifest[0].path))).mode&0o777;assert.equal(mode,0o444)});

test('commits a valid S13 result and produces hashed Artifact descriptors',async()=>{const value=await fixture();await writeFile(join(value.workspace.stagingDir,'S13-draft.png'),'real-image-bytes');await writeFile(join(value.workspace.stagingDir,'node-result.json'),JSON.stringify({schemaVersion:1,nodeRunId:value.run.id,status:'completed',summary:'ok',outputs:[{path:'S13-draft.png',role:'storyboard.draft',mediaType:'image/png',shotId:'S13',sourceArtifactIds:['artifact_input']}],warnings:[]}));const result=await collectNodeRunOutputs({workspace:value.workspace,run:value.run,contract:storyboardDraftContract,artifactFilesDir:value.artifactFilesDir});assert.equal(result.outputs.length,1);assert.match(result.outputs[0].sha256,/^[a-f0-9]{64}$/);assert.equal(await readFile(join(value.workspace.runRoot,'complete.marker'),'utf8'),`${value.run.id}\n`)});

test('rejects symlink output that escapes staging',async()=>{const value=await fixture();const outside=join(value.root,'outside.png');await writeFile(outside,'outside');await symlink(outside,join(value.workspace.stagingDir,'S13-draft.png'));await writeFile(join(value.workspace.stagingDir,'node-result.json'),JSON.stringify({schemaVersion:1,nodeRunId:value.run.id,status:'completed',outputs:[{path:'S13-draft.png',role:'storyboard.draft',mediaType:'image/png',shotId:'S13'}]}));await assert.rejects(()=>collectNodeRunOutputs({workspace:value.workspace,run:value.run,contract:storyboardDraftContract,artifactFilesDir:value.artifactFilesDir}),/越过 staging/)});
