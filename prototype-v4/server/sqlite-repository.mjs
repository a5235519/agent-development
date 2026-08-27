import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

export class SQLiteRepository {
  constructor(databasePath) {
    this.driver = 'sqlite';
    this.eventTransport = 'cursor-polling';
    this.databasePath = databasePath;
    this.database = new DatabaseSync(databasePath);
    this.subscriptionTimers = new Set();
    this.database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS entities (
        kind TEXT NOT NULL,
        id TEXT NOT NULL,
        data_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (kind, id)
      );
      CREATE INDEX IF NOT EXISTS idx_entities_kind_updated
        ON entities(kind, updated_at DESC);
      CREATE TABLE IF NOT EXISTS set_members (
        kind TEXT NOT NULL,
        value TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (kind, value)
      );
      CREATE TABLE IF NOT EXISTS run_events (
        run_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        event_id TEXT NOT NULL UNIQUE,
        type TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        PRIMARY KEY (run_id, sequence)
      );
      CREATE INDEX IF NOT EXISTS idx_run_events_run_sequence
        ON run_events(run_id, sequence);
      CREATE TABLE IF NOT EXISTS leases (
        lease_key TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        token TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    this.database.prepare('INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (?, ?)').run(1, new Date().toISOString());
    this.database.prepare('INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (?, ?)').run(2, new Date().toISOString());
  }

  async initialize() {}

  async loadMap(kind) {
    const rows = this.database.prepare('SELECT id, data_json FROM entities WHERE kind = ?').all(kind);
    return new Map(rows.map((row) => [row.id, JSON.parse(row.data_json)]));
  }

  async replaceMap(kind, values) {
    const remove = this.database.prepare('DELETE FROM entities WHERE kind = ?');
    const insert = this.database.prepare('INSERT INTO entities(kind, id, data_json, updated_at) VALUES (?, ?, ?, ?)');
    this.database.exec('BEGIN IMMEDIATE');
    try {
      remove.run(kind);
      const now = new Date().toISOString();
      for (const [id, value] of values) insert.run(kind, id, JSON.stringify(value), now);
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  async putEntity(kind, id, value) {
    this.database.prepare(`INSERT INTO entities(kind, id, data_json, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(kind, id) DO UPDATE SET data_json=excluded.data_json, updated_at=excluded.updated_at`).run(kind, id, JSON.stringify(value), new Date().toISOString());
  }

  async putEntities(kind, values) {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const upsert = this.database.prepare(`INSERT INTO entities(kind, id, data_json, updated_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(kind, id) DO UPDATE SET data_json=excluded.data_json, updated_at=excluded.updated_at`);
      const now = new Date().toISOString();
      for (const [id, value] of values) upsert.run(kind, id, JSON.stringify(value), now);
      this.database.exec('COMMIT');
    } catch (error) { this.database.exec('ROLLBACK'); throw error; }
  }

  async loadSet(kind) {
    return new Set(this.database.prepare('SELECT value FROM set_members WHERE kind = ?').all(kind).map((row) => row.value));
  }

  async replaceSet(kind, values) {
    const remove = this.database.prepare('DELETE FROM set_members WHERE kind = ?');
    const insert = this.database.prepare('INSERT INTO set_members(kind, value, created_at) VALUES (?, ?, ?)');
    this.database.exec('BEGIN IMMEDIATE');
    try {
      remove.run(kind);
      const now = new Date().toISOString();
      for (const value of values) insert.run(kind, value, now);
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  async addSetMember(kind, value) {
    this.database.prepare('INSERT OR IGNORE INTO set_members(kind, value, created_at) VALUES (?, ?, ?)').run(kind, value, new Date().toISOString());
  }

  async count(kind) {
    return Number(this.database.prepare('SELECT COUNT(*) AS count FROM entities WHERE kind = ?').get(kind).count);
  }

  async countSet(kind) {
    return Number(this.database.prepare('SELECT COUNT(*) AS count FROM set_members WHERE kind = ?').get(kind).count);
  }

  async appendEvent(runId, event) {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const row = this.database.prepare('SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence FROM run_events WHERE run_id = ?').get(runId);
      const stored = { ...event, eventId: event.eventId || `evt_${randomUUID()}`, runId, sequence: Number(row.sequence), occurredAt: event.occurredAt || new Date().toISOString(), payload: event.payload || {} };
      this.database.prepare('INSERT INTO run_events(run_id, sequence, event_id, type, occurred_at, payload_json) VALUES (?, ?, ?, ?, ?, ?)').run(runId, stored.sequence, stored.eventId, stored.type, stored.occurredAt, JSON.stringify(stored.payload));
      this.database.exec('COMMIT');
      return stored;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  async loadEvents(runId) {
    return this.database.prepare('SELECT event_id, run_id, sequence, type, occurred_at, payload_json FROM run_events WHERE run_id = ? ORDER BY sequence').all(runId).map((row) => ({ eventId: row.event_id, runId: row.run_id, sequence: Number(row.sequence), type: row.type, occurredAt: row.occurred_at, payload: JSON.parse(row.payload_json) }));
  }

  async countEvents(runId) {
    return Number(this.database.prepare('SELECT COUNT(*) AS count FROM run_events WHERE run_id = ?').get(runId).count);
  }

  async subscribeEvents(runId, afterSequence, listener, { pollIntervalMs = 250 } = {}) {
    let cursor = Number(afterSequence || 0); let reading = false;
    const poll = async () => {
      if (reading) return;
      reading = true;
      try {
        const events = (await this.loadEvents(runId)).filter((event) => event.sequence > cursor);
        for (const event of events) { cursor = event.sequence; listener(event); }
      } finally { reading = false; }
    };
    const timer = setInterval(() => { void poll(); }, pollIntervalMs);
    this.subscriptionTimers.add(timer);
    void poll();
    return async () => { clearInterval(timer); this.subscriptionTimers.delete(timer); };
  }

  async acquireLease(leaseKey, ownerId, ttlMs) {
    const now = new Date(); const expiresAt = new Date(now.getTime() + ttlMs).toISOString(); const token = randomUUID();
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const existing = this.database.prepare('SELECT * FROM leases WHERE lease_key = ?').get(leaseKey);
      if (existing && existing.expires_at > now.toISOString()) { this.database.exec('COMMIT'); return null; }
      this.database.prepare(`INSERT INTO leases(lease_key, owner_id, token, expires_at, updated_at) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(lease_key) DO UPDATE SET owner_id=excluded.owner_id, token=excluded.token, expires_at=excluded.expires_at, updated_at=excluded.updated_at`).run(leaseKey, ownerId, token, expiresAt, now.toISOString());
      this.database.exec('COMMIT');
      return { leaseKey, ownerId, token, expiresAt };
    } catch (error) { this.database.exec('ROLLBACK'); throw error; }
  }

  async renewLease(leaseKey, ownerId, token, ttlMs) {
    const now = new Date(); const expiresAt = new Date(now.getTime() + ttlMs).toISOString();
    const result = this.database.prepare('UPDATE leases SET expires_at = ?, updated_at = ? WHERE lease_key = ? AND owner_id = ? AND token = ?').run(expiresAt, now.toISOString(), leaseKey, ownerId, token);
    return result.changes ? { leaseKey, ownerId, token, expiresAt } : null;
  }

  async releaseLease(leaseKey, ownerId, token) {
    return this.database.prepare('DELETE FROM leases WHERE lease_key = ? AND owner_id = ? AND token = ?').run(leaseKey, ownerId, token).changes > 0;
  }

  async getLease(leaseKey) {
    const row = this.database.prepare('SELECT lease_key, owner_id, token, expires_at FROM leases WHERE lease_key = ?').get(leaseKey);
    return row ? { leaseKey: row.lease_key, ownerId: row.owner_id, token: row.token, expiresAt: row.expires_at } : null;
  }

  async close() {
    for (const timer of this.subscriptionTimers) clearInterval(timer);
    this.subscriptionTimers.clear();
    this.database.close();
  }
}

export function createSQLiteRepository({ databasePath }) {
  return new SQLiteRepository(databasePath);
}
