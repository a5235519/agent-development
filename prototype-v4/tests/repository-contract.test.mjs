import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newDb } from 'pg-mem';
import { createRepository } from '../server/repository.mjs';

async function verifyRepository(repository) {
  await repository.replaceMap('runs', new Map([
    ['run-1', { id: 'run-1', status: 'RUNNING' }],
    ['run-2', { id: 'run-2', status: 'COMPLETED' }],
  ]));
  assert.equal(await repository.count('runs'), 2);
  assert.deepEqual((await repository.loadMap('runs')).get('run-2'), { id: 'run-2', status: 'COMPLETED' });

  await repository.replaceMap('runs', new Map([['run-2', { id: 'run-2', status: 'BLOCKED' }]]));
  const replaced = await repository.loadMap('runs');
  assert.equal(replaced.has('run-1'), false);
  assert.equal(replaced.get('run-2').status, 'BLOCKED');
  await repository.putEntity('runs', 'run-3', { id: 'run-3', status: 'QUEUED' });
  await repository.putEntities('runs', new Map([['run-2', { id: 'run-2', status: 'COMPLETED' }]]));
  const upserted = await repository.loadMap('runs');
  assert.equal(upserted.get('run-2').status, 'COMPLETED');
  assert.equal(upserted.get('run-3').status, 'QUEUED');

  await repository.replaceSet('regressions', new Set(['CASE-001', 'CASE-002']));
  assert.equal(await repository.countSet('regressions'), 2);
  assert.deepEqual([...await repository.loadSet('regressions')].sort(), ['CASE-001', 'CASE-002']);
  await repository.addSetMember('regressions', 'CASE-003');
  await repository.addSetMember('regressions', 'CASE-003');
  assert.equal(await repository.countSet('regressions'), 3);

  const firstEvent = await repository.appendEvent('run-2', { type: 'STARTED', payload: { total: 2 } });
  const secondEvent = await repository.appendEvent('run-2', { type: 'COMPLETED', payload: { passed: 2 } });
  assert.equal(firstEvent.sequence, 1);
  assert.equal(secondEvent.sequence, 2);
  assert.equal(await repository.countEvents('run-2'), 2);
  assert.deepEqual((await repository.loadEvents('run-2')).map((event) => event.type), ['STARTED', 'COMPLETED']);
  const subscribed = [];
  const unsubscribe = await repository.subscribeEvents('run-live', 0, (event) => subscribed.push(event), { pollIntervalMs: 2 });
  await repository.appendEvent('run-live', { type: 'LIVE', payload: {} });
  await new Promise((resolve) => setTimeout(resolve, 12));
  await unsubscribe();
  assert.deepEqual(subscribed.map((event) => event.type), ['LIVE']);

  const firstLease = await repository.acquireLease('evaluation:EP01', 'worker-a', 10000);
  assert.equal(firstLease.ownerId, 'worker-a');
  assert.equal(await repository.acquireLease('evaluation:EP01', 'worker-b', 10000), null);
  assert.equal(await repository.renewLease('evaluation:EP01', 'worker-b', firstLease.token, 10000), null);
  assert.equal((await repository.renewLease('evaluation:EP01', 'worker-a', firstLease.token, 10000)).ownerId, 'worker-a');
  assert.equal(await repository.releaseLease('evaluation:EP01', 'worker-b', firstLease.token), false);
  assert.equal(await repository.releaseLease('evaluation:EP01', 'worker-a', firstLease.token), true);
  assert.equal((await repository.acquireLease('evaluation:EP01', 'worker-b', 10000)).ownerId, 'worker-b');
}

test('SQLite implements the shared Repository contract', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'agent-workbench-repository-'));
  const repository = await createRepository({ driver: 'sqlite', databasePath: join(dataDir, 'contract.sqlite') });
  try { await verifyRepository(repository); }
  finally { await repository.close(); }
});

test('PostgreSQL implements the shared Repository contract', async () => {
  const memoryDatabase = newDb();
  const { Pool } = memoryDatabase.adapters.createPg();
  const pool = new Pool();
  const repository = await createRepository({ driver: 'postgres', pool });
  try { await verifyRepository(repository); }
  finally { await pool.end(); }
});

test('Repository factory rejects unknown drivers and incomplete PostgreSQL config', async () => {
  await assert.rejects(() => createRepository({ driver: 'unknown' }), /不支持的 Repository 驱动/);
  await assert.rejects(() => createRepository({ driver: 'postgres', connectionString: '' }), /需要 DATABASE_URL/);
});
