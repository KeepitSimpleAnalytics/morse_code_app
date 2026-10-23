-- Schema version 1 (SPEC §9.2). All timestamps are Unix epoch milliseconds, UTC.
-- The TypeScript test driver runs this same file through better-sqlite3.

CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE profiles (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL,
  created_at INTEGER NOT NULL, last_used_at INTEGER NOT NULL
);

CREATE TABLE settings (
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  key TEXT NOT NULL, value TEXT NOT NULL, updated_at INTEGER NOT NULL,
  PRIMARY KEY (profile_id, key)
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY, profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  mode TEXT NOT NULL,
  started_at INTEGER NOT NULL, ended_at INTEGER, active_ms INTEGER NOT NULL DEFAULT 0,
  seed INTEGER NOT NULL,
  settings_snapshot TEXT NOT NULL,
  sent_chars INTEGER NOT NULL DEFAULT 0, correct_chars INTEGER NOT NULL DEFAULT 0,
  errors INTEGER NOT NULL DEFAULT 0, accuracy REAL,
  completed INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_sessions_profile_time ON sessions(profile_id, started_at);

CREATE TABLE trials (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL, prompt TEXT NOT NULL, response TEXT NOT NULL,
  revealed INTEGER NOT NULL DEFAULT 0, repeats INTEGER NOT NULL DEFAULT 0,
  response_ms INTEGER, accuracy REAL NOT NULL, alignment TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_trials_session ON trials(session_id, idx);

CREATE TABLE char_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  ts INTEGER NOT NULL, ch TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('correct','substituted','missed')),
  typed TEXT, response_ms INTEGER, char_wpm INTEGER NOT NULL, mode TEXT NOT NULL
);
CREATE INDEX idx_char_events_profile_ch ON char_events(profile_id, ch, ts);
CREATE INDEX idx_char_events_session ON char_events(session_id);

CREATE TABLE char_stats (
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE, ch TEXT NOT NULL,
  ewma_acc REAL NOT NULL, ewma_rt REAL, attempts INTEGER NOT NULL, correct INTEGER NOT NULL,
  last_seen INTEGER NOT NULL, PRIMARY KEY (profile_id, ch)
);

CREATE TABLE koch_progress (
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  order_id TEXT NOT NULL, level INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  PRIMARY KEY (profile_id, order_id)
);
CREATE TABLE koch_level_history (
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  order_id TEXT NOT NULL, level INTEGER NOT NULL, reached_at INTEGER NOT NULL,
  reason TEXT NOT NULL
);

CREATE TABLE snippets (
  id TEXT PRIMARY KEY, profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);

CREATE TABLE word_lists (
  id TEXT PRIMARY KEY, profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL, items TEXT NOT NULL,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);

CREATE TABLE achievements (
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  achievement_id TEXT NOT NULL, earned_at INTEGER NOT NULL,
  PRIMARY KEY (profile_id, achievement_id)
);
