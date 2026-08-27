import { createHash, randomUUID } from 'node:crypto';
import { chmod, copyFile, mkdir, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';

const safeName = (value) => String(value).replace(/[^a-zA-Z0-9._-]+/g, '-').slice(-140);
const writeJson = (path, value) => writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');

export async function prepareNodeRunWorkspace({ rootDir, run, contract, artifacts, artifactFilesDir }) {
  const runRoot = join(rootDir, safeName(run.id), `attempt-${run.attempt}`);
  const inputsDir = join(runRoot, 'inputs'); const stagingDir = join(runRoot, 'staging');
  await mkdir(inputsDir, { recursive: true }); await mkdir(stagingDir, { recursive: true });
  const inputManifest = [];
  for (const artifactId of run.inputArtifactIds) {
    const artifact = artifacts.get(artifactId); if (!artifact) throw new Error(`输入 Artifact 不存在: ${artifactId}`);
    const filename = `${safeName(artifact.id)}-${safeName(artifact.filename)}`; const destination = join(inputsDir, filename);
    await copyFile(join(artifactFilesDir, artifact.storedFilename), destination); await chmod(destination, 0o444);
    inputManifest.push({ artifactId: artifact.id, role: artifact.role, shotId: artifact.shotId, sha256: artifact.sha256, mediaType: artifact.mediaType, path: `inputs/${filename}` });
  }
  const envelope = { schemaVersion: 1, nodeRunId: run.id, attempt: run.attempt, projectId: run.projectId, plugin: { id: run.pluginId, version: run.pluginVersion, operation: run.operation }, skillRoute: run.skillRoute, mode: run.mode, shotId: run.shotId, inputArtifacts: inputManifest, allowedWriteRoot: 'staging', outputReceipt: 'staging/node-result.json', deadlineAt: run.deadlineAt };
  await writeJson(join(runRoot, 'execution-envelope.json'), envelope); await writeJson(join(runRoot, 'plugin-contract.json'), contract); await writeJson(join(runRoot, 'input-manifest.json'), inputManifest);
  await chmod(inputsDir, 0o555);
  return { runRoot, stagingDir, envelope, prompt: buildFixedPrompt(envelope) };
}

export function buildFixedPrompt(envelope) {
  const range = envelope.mode === 'repair' ? envelope.shotId : 'S01-S19';
  return `你正在执行柠萌旅行记工作台冻结的节点任务。不得改变 operation、镜号范围、输入集合或输出目录。\n\n固定入口 Skill：designing-travel-comedy-series\n固定 Operation：${envelope.plugin.operation}\n实际路由：${envelope.skillRoute}\n执行范围：${range}\n\n先读取 execution-envelope.json、plugin-contract.json 和 input-manifest.json。只允许在 staging/ 写入文件。执行完成后最后写 staging/node-result.json，格式：{"schemaVersion":1,"nodeRunId":"${envelope.nodeRunId}","status":"completed","summary":"...","outputs":[{"path":"S13-draft.png","role":"storyboard.draft","mediaType":"image/png","shotId":"S13","sourceArtifactIds":[]}],"warnings":[]}。outputs.path 必须是 staging/ 下的相对文件名。不要用自然语言代替文件产物；缺少真实产物时把 status 写为 failed 并说明错误。`;
}

export async function collectNodeRunOutputs({ workspace, run, contract, artifactFilesDir }) {
  const resultPath = join(workspace.stagingDir, 'node-result.json'); let result;
  try { result = JSON.parse(await readFile(resultPath, 'utf8')); } catch (error) { throw Object.assign(new Error(`node-result.json 缺失或无效: ${error.message}`), { code: 'NODE_RESULT_INVALID' }); }
  if (result.schemaVersion !== 1 || result.nodeRunId !== run.id || result.status !== 'completed' || !Array.isArray(result.outputs)) throw Object.assign(new Error('node-result.json 不符合运行契约'), { code: 'NODE_RESULT_SCHEMA_INVALID' });
  if (!result.outputs.length) throw Object.assign(new Error('Codex 未声明任何输出文件'), { code: 'NODE_OUTPUT_EMPTY' });
  const stagingReal = await realpath(workspace.stagingDir); const collected = [];
  for (const output of result.outputs) {
    if (!output.path || isAbsolute(output.path) || output.path.includes('..')) throw Object.assign(new Error(`输出路径越界: ${output.path}`), { code: 'NODE_OUTPUT_PATH_INVALID' });
    if (!contract.allowedWriteRoles.includes(output.role)) throw Object.assign(new Error(`输出 Artifact Role 不允许: ${output.role}`), { code: 'NODE_OUTPUT_ROLE_INVALID' });
    const source = resolve(workspace.stagingDir, output.path); const sourceReal = await realpath(source); if (sourceReal !== stagingReal && !sourceReal.startsWith(`${stagingReal}${sep}`)) throw Object.assign(new Error(`输出文件越过 staging: ${output.path}`), { code: 'NODE_OUTPUT_PATH_INVALID' });
    const info = await stat(sourceReal); if (!info.isFile()) throw new Error(`输出不是普通文件: ${output.path}`);
    const bytes = await readFile(sourceReal); const sha256 = createHash('sha256').update(bytes).digest('hex');
    collected.push({ ...output, sourcePath: sourceReal, byteSize: bytes.length, sha256 });
  }
  const storyboard = collected.filter((item) => item.role === 'storyboard.draft'); const shotIds = new Set(storyboard.map((item) => item.shotId));
  if (run.mode === 'repair' && (!shotIds.has(run.shotId) || [...shotIds].some((id) => id !== run.shotId))) throw Object.assign(new Error(`修复运行必须且只能输出 ${run.shotId}`), { code: 'SHOT_SCOPE_INVALID' });
  if (run.mode === 'full') { const missing = Array.from({ length: 19 }, (_, index) => `S${String(index + 1).padStart(2, '0')}`).filter((id) => !shotIds.has(id)); if (missing.length) throw Object.assign(new Error(`全量分镜缺少镜号: ${missing.join(', ')}`), { code: 'SHOT_COVERAGE_FAILED' }); }
  const pendingMarker = join(workspace.runRoot, `.complete-${randomUUID()}.tmp`); await writeFile(pendingMarker, `${run.id}\n`, 'utf8'); const committedDir = join(workspace.runRoot, 'committed-outputs'); await rename(workspace.stagingDir, committedDir); await rename(pendingMarker, join(workspace.runRoot, 'complete.marker'));
  const outputs = [];
  for (const item of collected) { const id = `artifact_${randomUUID()}`; const filename = basename(item.path); const storedFilename = `${id}-${safeName(filename)}`; const committedPath = join(committedDir, relative(stagingReal, item.sourcePath)); await copyFile(committedPath, join(artifactFilesDir, storedFilename)); outputs.push({ id, projectId: run.projectId, role: item.role, shotId: item.shotId || null, filename, mediaType: item.mediaType || 'application/octet-stream', byteSize: item.byteSize, sha256: item.sha256, uri: `/api/artifacts/${id}/content`, producerRunId: run.id, sourceArtifactIds: [...new Set(item.sourceArtifactIds || run.inputArtifactIds)], versionGroupId: id, isActive: true, createdAt: new Date().toISOString(), storedFilename }); }
  return { result, outputs, committedDir };
}
