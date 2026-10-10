const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

function initDb(dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);

  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('cache_size = -20000');

  db.exec(`
    CREATE TABLE IF NOT EXISTS object_metadata (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id INTEGER NOT NULL,
      object_name TEXT NOT NULL,
      data_type TEXT NOT NULL,
      business_rule TEXT,
      is_trend INTEGER DEFAULT 0,
      UNIQUE(source_id, object_name)
    );

    CREATE TABLE IF NOT EXISTS archive (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      source_id INTEGER NOT NULL,
      object_name TEXT NOT NULL,
      value_text TEXT NOT NULL,
      value_type TEXT NOT NULL,
      is_trend INTEGER DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_archive_ts ON archive(ts);
    CREATE INDEX IF NOT EXISTS idx_archive_trend ON archive(is_trend, ts DESC);

    CREATE TABLE IF NOT EXISTS trend_window (
      trend_name TEXT NOT NULL,
      slot INTEGER NOT NULL,
      value_text TEXT NOT NULL,
      ts INTEGER NOT NULL,
      PRIMARY KEY (trend_name, slot)
    );

    CREATE TABLE IF NOT EXISTS invalid_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      source_id INTEGER NOT NULL,
      object_name TEXT NOT NULL,
      raw_value TEXT,
      reason TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pending_writes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      payload TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      created_at INTEGER NOT NULL
    );
  `);

  return db;
}

module.exports = { initDb };
