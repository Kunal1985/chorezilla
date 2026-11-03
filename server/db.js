const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const SCHEMA = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');

function openDatabase(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, 'chorezilla.sqlite');
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);
  const applied = db.prepare('SELECT id FROM schema_migrations WHERE id = ?').get('001_init');
  if (!applied) {
    db.exec('BEGIN');
    try {
      db.exec(SCHEMA);
      db.prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)').run('001_init', new Date().toISOString());
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
  return { db, file };
}

// Consistent copy. VACUUM INTO refuses to overwrite, so dest must be new.
function backupDatabase(db, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (fs.existsSync(dest)) throw new Error('backup file already exists');
  const escaped = dest.replace(/'/g, "''");
  db.exec(`VACUUM INTO '${escaped}'`);
  return dest;
}

module.exports = { openDatabase, backupDatabase };
