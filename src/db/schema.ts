import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import type { CompletionSummary, ExecutionBrief, TaskContract, TaskSource, TaskState } from "../domain/task.js";

export const tasks = sqliteTable(
  "tasks",
  {
    id: text("id").primaryKey(),
    source: text("source").$type<TaskSource>().notNull(),
    externalRef: text("external_ref"),
    repositoryId: text("repository_id").notNull(),
    state: text("state").$type<TaskState>().notNull(),
    title: text("title").notNull(),
    rawInput: text("raw_input"),
    contract: text("contract", { mode: "json" }).$type<TaskContract | null>().default(null),
    executionBrief: text("execution_brief", { mode: "json" }).$type<ExecutionBrief | null>().default(null),
    completionSummary: text("completion_summary", { mode: "json" }).$type<CompletionSummary | null>().default(null),
    conversationId: text("conversation_id"),
    branchName: text("branch_name"),
    maxRepairLoops: integer("max_repair_loops").notNull(),
    repairCount: integer("repair_count").notNull().default(0),
    workerId: text("worker_id"),
    leaseExpiresAt: integer("lease_expires_at", { mode: "number" }),
    lastError: text("last_error"),
    latestAttemptId: text("latest_attempt_id"),
    latestThreadId: text("latest_thread_id"),
    externalMetadata: text("external_metadata", { mode: "json" }).$type<Record<string, string> | null>().default(null),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
    updatedAt: integer("updated_at", { mode: "number" }).notNull(),
    startedAt: integer("started_at", { mode: "number" }),
    completedAt: integer("completed_at", { mode: "number" })
  },
  (table) => ({
    byState: index("tasks_state_idx").on(table.state, table.updatedAt),
    byLease: index("tasks_lease_idx").on(table.leaseExpiresAt),
    uniqueExternalRef: uniqueIndex("tasks_source_external_ref_unique").on(table.source, table.externalRef)
  })
);

export const taskAttempts = sqliteTable(
  "task_attempts",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
    attemptNumber: integer("attempt_number").notNull(),
    status: text("status").$type<"running" | "completed" | "failed" | "cancelled">().notNull(),
    workspacePath: text("workspace_path"),
    branchName: text("branch_name"),
    codexThreadId: text("codex_thread_id"),
    repairCount: integer("repair_count").notNull().default(0),
    reportPath: text("report_path"),
    diffPath: text("diff_path"),
    commitSha: text("commit_sha"),
    prNumber: integer("pr_number"),
    summary: text("summary"),
    startedAt: integer("started_at", { mode: "number" }).notNull(),
    completedAt: integer("completed_at", { mode: "number" }),
    updatedAt: integer("updated_at", { mode: "number" }).notNull()
  },
  (table) => ({
    byTask: index("task_attempts_task_idx").on(table.taskId, table.attemptNumber)
  })
);

export const runEvents = sqliteTable(
  "run_events",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
    attemptId: text("attempt_id").references(() => taskAttempts.id, { onDelete: "set null" }),
    eventType: text("event_type").notNull(),
    level: text("level").$type<"debug" | "info" | "warn" | "error">().notNull(),
    message: text("message").notNull(),
    payload: text("payload", { mode: "json" }).$type<unknown>().default(null),
    createdAt: integer("created_at", { mode: "number" }).notNull()
  },
  (table) => ({
    byTask: index("run_events_task_idx").on(table.taskId, table.createdAt)
  })
);

export type TaskRow = typeof tasks.$inferSelect;
export type TaskAttemptRow = typeof taskAttempts.$inferSelect;
