-- keka project (tenant) schema. One database per project at
-- ~/.keka/projects/<slug>/keka.db. A project may span several repositories — the
-- `repos` table below lists them, and every row records which repo it came from.
-- Idempotent: safe to exec on every open.

-- The repositories that make up this project. Seeded from the committed
-- .keka/project.md, and auto-registered when a session runs in a repo not yet listed.
CREATE TABLE IF NOT EXISTS repos (
  repo  TEXT PRIMARY KEY,              -- normalized git remote, else repo-root path
  name  TEXT,                          -- friendly label, when .keka/project.md gives one
  added TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS memories (
  id         INTEGER PRIMARY KEY,
  type       TEXT NOT NULL,              -- learning | note | reference | pattern (coerced in engine)
  text       TEXT NOT NULL,
  text_key   TEXT NOT NULL,              -- lower(collapsed-whitespace(text)) — indexed dedup key
  confidence REAL DEFAULT 0.7,
  project    TEXT,                       -- the tenant this database belongs to
  repo       TEXT,                       -- which repository of that project it came from
  source     TEXT,                       -- url | session id | manual
  author     TEXT,                       -- git user.email of whoever wrote it
  username   TEXT,                       -- git user.name — display identity
  role       TEXT,                       -- snapshot of the author's roster role when written
  task       TEXT,                       -- branch name or explicit --task tag
  workspace  INTEGER DEFAULT 0,          -- 1 = private workspace only; findable, but never enters the brief
  created    TEXT DEFAULT (datetime('now')),
  uses       INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sessions (
  id           TEXT PRIMARY KEY,
  project      TEXT,
  repo         TEXT,
  author       TEXT,
  username     TEXT,
  role         TEXT,
  name         TEXT,                     -- human label; unique per (project, author), disambiguated on display
  task         TEXT,
  first_prompt TEXT,
  summary      TEXT,
  created      TEXT DEFAULT (datetime('now')),
  ended        TEXT
);

CREATE TABLE IF NOT EXISTS observations (
  id         INTEGER PRIMARY KEY,
  session_id TEXT,
  tool       TEXT,
  target     TEXT,
  digest     TEXT,
  created    TEXT DEFAULT (datetime('now'))
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
CREATE INDEX IF NOT EXISTS idx_obs_session ON observations(session_id);
CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project, created);
CREATE INDEX IF NOT EXISTS idx_sessions_branch ON sessions(project, task, created);
CREATE INDEX IF NOT EXISTS idx_memories_repo ON memories(repo, created);
