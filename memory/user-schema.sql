-- keka user-scope schema. One database per machine at ~/.keka/keka.db, holding what
-- belongs to the person rather than to any one project. Idempotent: exec on every open.

-- Trust is PRIVATE and per-person, not per-project: you rate a teammate once and that
-- judgment applies in every project you share with them. It never leaves this machine,
-- never appears in .keka/team.md, never travels in a seed.
CREATE TABLE IF NOT EXISTS trust (
  email   TEXT PRIMARY KEY,
  level   TEXT NOT NULL DEFAULT 'full',  -- full | workspace
  note    TEXT,
  updated TEXT DEFAULT (datetime('now'))
);

-- Every project keka has seen, and which directory holds its database. This is what
-- makes cross-project search possible at all once storage is per-tenant.
CREATE TABLE IF NOT EXISTS projects (
  key     TEXT PRIMARY KEY,             -- the project identity (see .keka/project.md)
  dir     TEXT NOT NULL,                -- <root>/projects/<slug>
  created TEXT DEFAULT (datetime('now'))
);

-- Global memories: knowledge that belongs to you rather than to a product. An
-- environment quirk or a tool trap is worth carrying into every project you open.
CREATE TABLE IF NOT EXISTS memories (
  id         INTEGER PRIMARY KEY,
  type       TEXT NOT NULL,
  text       TEXT NOT NULL,
  text_key   TEXT NOT NULL,
  confidence REAL DEFAULT 0.7,
  project    TEXT,                      -- always NULL here; kept so rows are shape-identical
  repo       TEXT,
  source     TEXT,
  author     TEXT,
  username   TEXT,
  role       TEXT,
  task       TEXT,
  workspace  INTEGER DEFAULT 0,
  created    TEXT DEFAULT (datetime('now')),
  uses       INTEGER DEFAULT 0
);

CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
  text, content='memories', content_rowid='id'
);
CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
  INSERT INTO memories_fts(rowid, text) VALUES (new.id, new.text);
END;
CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, text) VALUES ('delete', old.id, old.text);
END;
CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE OF text ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, text) VALUES ('delete', old.id, old.text);
  INSERT INTO memories_fts(rowid, text) VALUES (new.id, new.text);
END;

CREATE INDEX IF NOT EXISTS idx_memories_text_key ON memories(text_key);
CREATE INDEX IF NOT EXISTS idx_memories_created ON memories(created);
