-- Chorezilla SQLite schema. One file holds every household.
-- Points are not trusted from the browser. server/store.js writes them
-- with the same rules as site/scoring.js (done, half rounded half up, missed).
-- A household only sees its own rows because every query is scoped to the
-- signed-in member's family. There is no shared login across families.

CREATE TABLE IF NOT EXISTS families (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
  invite_code TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS members (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL REFERENCES families (id) ON DELETE CASCADE,
  display_name TEXT NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 40),
  role TEXT NOT NULL CHECK (role IN ('parent', 'kid')),
  emoji TEXT NOT NULL DEFAULT '🦖',
  color TEXT NOT NULL DEFAULT '#2f7d46',
  pin_hash TEXT,
  is_owner INTEGER NOT NULL DEFAULT 0 CHECK (is_owner IN (0, 1)),
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS members_family_idx ON members (family_id);

CREATE TABLE IF NOT EXISTS slots (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL REFERENCES families (id) ON DELETE CASCADE,
  member_id TEXT NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 60),
  days TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  points INTEGER NOT NULL CHECK (points BETWEEN 0 AND 100),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS slots_family_idx ON slots (family_id);

CREATE TABLE IF NOT EXISTS checkins (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL REFERENCES families (id) ON DELETE CASCADE,
  slot_id TEXT NOT NULL REFERENCES slots (id) ON DELETE CASCADE,
  member_id TEXT NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('done', 'partial', 'missed')),
  points_possible INTEGER NOT NULL CHECK (points_possible >= 0),
  points_awarded INTEGER NOT NULL CHECK (points_awarded >= 0),
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes >= 0),
  reported_role TEXT NOT NULL CHECK (reported_role IN ('parent', 'kid')),
  approved INTEGER NOT NULL DEFAULT 0 CHECK (approved IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (slot_id, day),
  CHECK (points_awarded <= points_possible)
);

CREATE INDEX IF NOT EXISTS checkins_family_day_idx ON checkins (family_id, day);

CREATE TABLE IF NOT EXISTS prizes (
  family_id TEXT NOT NULL REFERENCES families (id) ON DELETE CASCADE,
  week_start TEXT NOT NULL,
  prize TEXT NOT NULL CHECK (length(trim(prize)) BETWEEN 1 AND 140),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (family_id, week_start)
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS sessions_member_idx ON sessions (member_id);
