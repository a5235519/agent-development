import pg from 'pg';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

const { Pool } = pg;
const decodeJson = (value) => typeof value === 'string' ? JSON.parse(value) : value;

export class PostgresRepository {
  constructor({ connectionString, pool } = {}) {
    if (!pool && !connectionString) throw new Error('PostgreSQL Repository 需要 DATABASE_URL');
    this.pool = pool || new Pool({ connectionString });
    this.ownsPool = !pool;
    this.driver = 'postgres';
    this.eventTransport = 'listen-notify-with-polling-fallback';
  }

  async initialize() {
    for (const filename of ['001_repository.sql', '002_events_leases.sql']) {
      const migration = await readFile(new URL(`./migrations/postgres/${filename}`, import.meta.url), 'utf8');
      await this.pool.query(migration);
    }
  }

  async loadMap(kind) {
    const { rows } = await this.pool.query('SELECT id, data_json FROM entities WHERE kind = $1', [kind]);
    return new Map(rows.map((row) => [row.id, decodeJson(row.data_json)]));
  }

  async replaceMap(kind, values) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM entities WHERE kind = $1', [kind]);
      for (const [id, value] of values) {
        await client.query('INSERT INTO entities(kind, id, data_json, updated_at) VALUES ($1, $2, $3::jsonb, NOW())', [kind, id, JSON.stringify(value)]);
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async putEntity(kind, id, value) {
    await this.pool.query(`INSERT INTO entities(kind, id, data_json, updated_at) VALUES ($1, $2, $3::jsonb, NOW())
      ON CONFLICT(kind, id) DO UPDATE SET data_json=EXCLUDED.data_json, updated_at=NOW()`, [kind, id, JSON.stringify(value)]);
  }

  async putEntities(kind, values) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      for (const [id, value] of values) await client.query(`INSERT INTO entities(kind, id, data_json, updated_at) VALUES ($1, $2, $3::jsonb, NOW())
        ON CONFLICT(kind, id) DO UPDATE SET data_json=EXCLUDED.data_json, updated_at=NOW()`, [kind, id, JSON.stringify(value)]);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }

  async loadSet(kind) {
    const { rows } = await this.pool.query('SELECT value FROM set_members WHERE kind = $1', [kind]);
    return new Set(rows.map((row) => row.value));
  }

  async replaceSet(kind, values) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM set_members WHERE kind = $1', [kind]);
      for (const value of values) await client.query('INSERT INTO set_members(kind, value, created_at) VALUES ($1, $2, NOW())', [kind, value]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async addSetMember(kind, value) {
    await this.pool.query('INSERT INTO set_members(kind, value, created_at) VALUES ($1, $2, NOW()) ON CONFLICT(kind, value) DO NOTHING', [kind, value]);
  }

  async count(kind) {
    const { rows } = await this.pool.query('SELECT COUNT(*) AS count FROM entities WHERE kind = $1', [kind]);
    return Number(rows[0].count);
  }

  async countSet(kind) {
    const { rows } = await this.pool.query('SELECT COUNT(*) AS count FROM set_members WHERE kind = $1', [kind]);
    return Number(rows[0].count);
  }

  async appendEvent(runId, event) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: sequenceRows } = await client.query('SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence FROM run_events WHERE run_id = $1', [runId]);
      const stored = { ...event, eventId: event.eventId || `evt_${randomUUID()}`, runId, sequence: Number(sequenceRows[0].sequence), occurredAt: event.occurredAt || new Date().toISOString(), payload: event.payload || {} };
      await client.query('INSERT INTO run_events(run_id, sequence, event_id, type, occurred_at, payload_json) VALUES ($1, $2, $3, $4, $5, $6::jsonb)', [runId, stored.sequence, stored.eventId, stored.type, stored.occurredAt, JSON.stringify(stored.payload)]);
      await client.query('COMMIT');
      try { await this.pool.query("SELECT pg_notify('agent_run_events', $1)", [JSON.stringify({ runId, sequence: stored.sequence })]); } catch {}
      return stored;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }

  async loadEvents(runId) {
    const { rows } = await this.pool.query('SELECT event_id, run_id, sequence, type, occurred_at, payload_json FROM run_events WHERE run_id = $1 ORDER BY sequence', [runId]);
    return rows.map((row) => ({ eventId: row.event_id, runId: row.run_id, sequence: Number(row.sequence), type: row.type, occurredAt: new Date(row.occurred_at).toISOString(), payload: decodeJson(row.payload_json) }));
  }

  async countEvents(runId) {
    const { rows } = await this.pool.query('SELECT COUNT(*) AS count FROM run_events WHERE run_id = $1', [runId]);
    return Number(rows[0].count);
  }

  async subscribeEvents(runId, afterSequence, listener, { pollIntervalMs = 1000 } = {}) {
    let cursor = Number(afterSequence || 0); let stopped = false; let reading = false; let notificationClient = null;
    const catchUp = async () => {
      if (stopped || reading) return;
      reading = true;
      try {
        const events = (await this.loadEvents(runId)).filter((event) => event.sequence > cursor);
        for (const event of events) { cursor = event.sequence; listener(event); }
      } finally { reading = false; }
    };
    try {
      notificationClient = await this.pool.connect();
      await notificationClient.query('LISTEN agent_run_events');
      notificationClient.on('notification', (message) => {
        try { if (JSON.parse(message.payload || '{}').runId === runId) void catchUp(); } catch {}
      });
    } catch {
      notificationClient?.release(); notificationClient = null;
    }
    const timer = setInterval(() => { void catchUp(); }, pollIntervalMs);
    void catchUp();
    return async () => {
      stopped = true; clearInterval(timer);
      if (notificationClient) { try { await notificationClient.query('UNLISTEN agent_run_events'); } finally { notificationClient.release(); } }
    };
  }

  async acquireLease(leaseKey, ownerId, ttlMs) {
    const token = randomUUID(); const expiresAt = new Date(Date.now() + ttlMs).toISOString();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: existingRows } = await client.query('SELECT lease_key, expires_at FROM leases WHERE lease_key = $1 FOR UPDATE', [leaseKey]);
      if (existingRows[0] && new Date(existingRows[0].expires_at).getTime() > Date.now()) { await client.query('COMMIT'); return null; }
      const { rows } = await client.query(`INSERT INTO leases(lease_key, owner_id, token, expires_at, updated_at)
        VALUES ($1, $2, $3, $4, NOW())
        ON CONFLICT (lease_key) DO UPDATE SET owner_id=EXCLUDED.owner_id, token=EXCLUDED.token, expires_at=EXCLUDED.expires_at, updated_at=NOW()
        RETURNING lease_key, owner_id, token, expires_at`, [leaseKey, ownerId, token, expiresAt]);
      await client.query('COMMIT');
      const row = rows[0];
      return { leaseKey: row.lease_key, ownerId: row.owner_id, token: row.token, expiresAt: new Date(row.expires_at).toISOString() };
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }

  async renewLease(leaseKey, ownerId, token, ttlMs) {
    const expiresAt = new Date(Date.now() + ttlMs).toISOString();
    const { rows } = await this.pool.query('UPDATE leases SET expires_at = $1, updated_at = NOW() WHERE lease_key = $2 AND owner_id = $3 AND token = $4 RETURNING lease_key, owner_id, token, expires_at', [expiresAt, leaseKey, ownerId, token]);
    const row = rows[0];
    return row ? { leaseKey: row.lease_key, ownerId: row.owner_id, token: row.token, expiresAt: new Date(row.expires_at).toISOString() } : null;
  }

  async releaseLease(leaseKey, ownerId, token) {
    const result = await this.pool.query('DELETE FROM leases WHERE lease_key = $1 AND owner_id = $2 AND token = $3', [leaseKey, ownerId, token]);
    return result.rowCount > 0;
  }

  async getLease(leaseKey) {
    const { rows } = await this.pool.query('SELECT lease_key, owner_id, token, expires_at FROM leases WHERE lease_key = $1', [leaseKey]);
    const row = rows[0];
    return row ? { leaseKey: row.lease_key, ownerId: row.owner_id, token: row.token, expiresAt: new Date(row.expires_at).toISOString() } : null;
  }

  async close() {
    if (this.ownsPool) await this.pool.end();
  }
}

export function createPostgresRepository(options) {
  return new PostgresRepository(options);
}
