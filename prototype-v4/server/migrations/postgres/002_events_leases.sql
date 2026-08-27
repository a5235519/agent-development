CREATE TABLE IF NOT EXISTS run_events (
  run_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  event_id TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  payload_json JSONB NOT NULL,
  PRIMARY KEY (run_id, sequence)
);

CREATE INDEX IF NOT EXISTS idx_run_events_run_sequence
  ON run_events(run_id, sequence);

CREATE TABLE IF NOT EXISTS leases (
  lease_key TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  token TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

INSERT INTO schema_migrations(version, applied_at)
  VALUES (2, NOW()) ON CONFLICT (version) DO NOTHING;
