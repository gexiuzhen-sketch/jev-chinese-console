import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { config } from "./config.js";

export function createDatabase(filename) {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const database = new Database(filename);
  database.pragma("journal_mode = WAL");
  database.pragma("foreign_keys = ON");
  database.pragma("busy_timeout = 5000");
  database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_user_id
      ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_expires_at
      ON sessions(expires_at);

    CREATE TABLE IF NOT EXISTS daily_usage (
      subject_type TEXT NOT NULL CHECK(subject_type IN ('ip', 'user', 'registration')),
      subject_id TEXT NOT NULL,
      usage_date TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 0 CHECK(count >= 0),
      updated_at INTEGER NOT NULL,
      PRIMARY KEY(subject_type, subject_id, usage_date)
    );

    CREATE INDEX IF NOT EXISTS idx_daily_usage_date
      ON daily_usage(usage_date);

    CREATE TABLE IF NOT EXISTS analytics_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      visitor_hash TEXT NOT NULL,
      user_id TEXT,
      dimension TEXT,
      value INTEGER,
      event_date TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_analytics_events_date_type
      ON analytics_events(event_date, event_type);
    CREATE INDEX IF NOT EXISTS idx_analytics_events_visitor_date
      ON analytics_events(visitor_hash, event_date);
    CREATE INDEX IF NOT EXISTS idx_analytics_events_created_at
      ON analytics_events(created_at);
  `);
  return database;
}

export const db = createDatabase(config.dbPath);
