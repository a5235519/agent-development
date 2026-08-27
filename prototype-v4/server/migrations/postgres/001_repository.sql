CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS entities (
  kind TEXT NOT NULL,
  id TEXT NOT NULL,
  data_json JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (kind, id)
);

CREATE INDEX IF NOT EXISTS idx_entities_kind_updated
  ON entities(kind, updated_at DESC);

CREATE TABLE IF NOT EXISTS set_members (
  kind TEXT NOT NULL,
  value TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (kind, value)
);

INSERT INTO schema_migrations(version, applied_at)
  VALUES (1, NOW()) ON CONFLICT (version) DO NOTHING;
