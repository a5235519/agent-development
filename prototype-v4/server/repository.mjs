import { createSQLiteRepository } from './sqlite-repository.mjs';
import { createPostgresRepository } from './postgres-repository.mjs';

export const repositoryMethods = [
  'initialize',
  'loadMap',
  'replaceMap',
  'putEntity',
  'putEntities',
  'loadSet',
  'replaceSet',
  'addSetMember',
  'count',
  'countSet',
  'appendEvent',
  'loadEvents',
  'countEvents',
  'subscribeEvents',
  'acquireLease',
  'renewLease',
  'releaseLease',
  'getLease',
  'close',
];

export function assertRepository(repository) {
  for (const method of repositoryMethods) {
    if (typeof repository?.[method] !== 'function') throw new TypeError(`Repository 缺少 ${method}() 方法`);
  }
  return repository;
}

export async function createRepository({ driver, databasePath, connectionString, pool } = {}) {
  const selectedDriver = driver || (connectionString || process.env.DATABASE_URL ? 'postgres' : 'sqlite');
  let repository;
  if (selectedDriver === 'sqlite') repository = createSQLiteRepository({ databasePath });
  else if (selectedDriver === 'postgres') repository = createPostgresRepository({ connectionString: connectionString || process.env.DATABASE_URL, pool });
  else throw new Error(`不支持的 Repository 驱动：${selectedDriver}`);
  assertRepository(repository);
  await repository.initialize();
  return repository;
}
