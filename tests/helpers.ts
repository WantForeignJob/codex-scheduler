import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { createDatabase } from "../src/db/client.js";
import { bootstrapDatabase } from "../src/db/bootstrap.js";
import type { SchedulerConfig } from "../src/config/types.js";

export function createTempDir(prefix: string): string {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function cleanupDir(directoryPath: string): void {
  rmSync(directoryPath, { recursive: true, force: true });
}

export function createTestConfig(rootDir: string): SchedulerConfig {
  mkdirSync(path.join(rootDir, "workspaces"), { recursive: true });
  mkdirSync(path.join(rootDir, "reports"), { recursive: true });
  mkdirSync(path.join(rootDir, "data"), { recursive: true });

  return {
    host: "127.0.0.1",
    port: 4318,
    poll_interval_seconds: 60,
    worker_concurrency: 1,
    default_model: "gpt-5.4",
    default_repair_loops: 1,
    workspace_root: path.join(rootDir, "workspaces"),
    report_root: path.join(rootDir, "reports"),
    sqlite_path: path.join(rootDir, "data", "scheduler.db"),
    gitleaks_command: 'node -e "process.exit(0)"',
    repositories: []
  };
}

export function createTestDatabase(rootDir: string) {
  const sqlitePath = path.join(rootDir, "data", "scheduler.db");
  const { sqlite, db } = createDatabase(sqlitePath);
  bootstrapDatabase(sqlite);
  return { sqlite, db };
}

export function writeJson(filePath: string, value: unknown): void {
  writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}
