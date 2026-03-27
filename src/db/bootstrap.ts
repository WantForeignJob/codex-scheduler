import type Database from "better-sqlite3";

export function bootstrapDatabase(sqlite: Database.Database): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      external_ref TEXT,
      repository_id TEXT NOT NULL,
      state TEXT NOT NULL,
      title TEXT NOT NULL,
      raw_input TEXT,
      contract TEXT,
      execution_brief TEXT,
      completion_summary TEXT,
      conversation_id TEXT,
      branch_name TEXT,
      max_repair_loops INTEGER NOT NULL,
      repair_count INTEGER NOT NULL DEFAULT 0,
      worker_id TEXT,
      lease_expires_at INTEGER,
      last_error TEXT,
      latest_attempt_id TEXT,
      latest_thread_id TEXT,
      external_metadata TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      started_at INTEGER,
      completed_at INTEGER
    );

    CREATE UNIQUE INDEX IF NOT EXISTS tasks_source_external_ref_unique
      ON tasks(source, external_ref);
    CREATE INDEX IF NOT EXISTS tasks_state_idx ON tasks(state, updated_at);
    CREATE INDEX IF NOT EXISTS tasks_lease_idx ON tasks(lease_expires_at);

    CREATE TABLE IF NOT EXISTS task_attempts (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      attempt_number INTEGER NOT NULL,
      status TEXT NOT NULL,
      workspace_path TEXT,
      branch_name TEXT,
      codex_thread_id TEXT,
      repair_count INTEGER NOT NULL DEFAULT 0,
      report_path TEXT,
      diff_path TEXT,
      commit_sha TEXT,
      pr_number INTEGER,
      summary TEXT,
      started_at INTEGER NOT NULL,
      completed_at INTEGER,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS task_attempts_task_idx ON task_attempts(task_id, attempt_number);

    CREATE TABLE IF NOT EXISTS run_events (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      attempt_id TEXT REFERENCES task_attempts(id) ON DELETE SET NULL,
      event_type TEXT NOT NULL,
      level TEXT NOT NULL,
      message TEXT NOT NULL,
      payload TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS run_events_task_idx ON run_events(task_id, created_at);
  `);
}
