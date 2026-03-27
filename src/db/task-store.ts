import { randomUUID } from "node:crypto";

import { and, asc, eq, inArray, isNull, lt, sql } from "drizzle-orm";

import { buildBranchName, buildSchedulerTaskId, isTerminalState, type RunEventRecord, type TaskAttemptRecord, type TaskContract, type TaskRecord, type TaskSource, type TaskState, type TaskView } from "../domain/task.js";
import type { SchedulerDb } from "./client.js";
import { runEvents, taskAttempts, tasks, type TaskAttemptRow, type TaskRow } from "./schema.js";

const ACTIVE_STATES: TaskState[] = [
  "normalizing",
  "planned",
  "preparing_workspace",
  "coding",
  "verifying",
  "repairing",
  "delivering"
] as const;

type CreateTaskInput = {
  repositoryId: string;
  source: TaskSource;
  externalRef?: string;
  title: string;
  rawInput?: string;
  contract?: TaskContract | null;
  conversationId?: string | null;
  maxRepairLoops: number;
  externalMetadata?: Record<string, string> | null;
};

export class TaskStore {
  constructor(private readonly db: SchedulerDb) {}

  async createTask(input: CreateTaskInput): Promise<TaskRecord> {
    const now = Date.now();
    const taskId = input.contract?.task_id ?? buildSchedulerTaskId(new Date(now));
    const row = {
      id: taskId,
      source: input.source,
      externalRef: input.externalRef ?? null,
      repositoryId: input.repositoryId,
      state: "queued" as const,
      title: input.title,
      rawInput: input.rawInput ?? null,
      contract: input.contract ?? null,
      executionBrief: null,
      completionSummary: null,
      conversationId: input.conversationId ?? null,
      branchName: input.contract?.branch_strategy ?? buildBranchName(taskId),
      maxRepairLoops: input.maxRepairLoops,
      repairCount: 0,
      workerId: null,
      leaseExpiresAt: null,
      lastError: null,
      latestAttemptId: null,
      latestThreadId: null,
      externalMetadata: input.externalMetadata ?? null,
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      completedAt: null
    };

    await this.db.insert(tasks).values(row);
    return toTaskRecord(row);
  }

  async getTask(id: string): Promise<TaskView | null> {
    const [task] = await this.db.select().from(tasks).where(eq(tasks.id, id)).limit(1);

    if (!task) {
      return null;
    }

    const attempt = task.latestAttemptId ? await this.getAttempt(task.latestAttemptId) : null;

    return {
      ...toTaskRecord(task),
      attempt
    };
  }

  async findByExternalRef(source: TaskSource, externalRef: string): Promise<TaskRecord | null> {
    const [row] = await this.db
      .select()
      .from(tasks)
      .where(and(eq(tasks.source, source), eq(tasks.externalRef, externalRef)))
      .limit(1);

    return row ? toTaskRecord(row) : null;
  }

  async listEvents(taskId: string): Promise<RunEventRecord[]> {
    const rows = await this.db.select().from(runEvents).where(eq(runEvents.taskId, taskId)).orderBy(asc(runEvents.createdAt));
    return rows.map((row) => ({
      id: row.id,
      taskId: row.taskId,
      attemptId: row.attemptId,
      eventType: row.eventType,
      level: row.level,
      message: row.message,
      payload: row.payload,
      createdAt: row.createdAt
    }));
  }

  async createAttempt(taskId: string): Promise<TaskAttemptRecord> {
    const task = await this.getTaskOrThrow(taskId);
    const now = Date.now();
    const attemptId = randomUUID();
    const attemptNumber = await this.nextAttemptNumber(taskId);
    const row = {
      id: attemptId,
      taskId,
      attemptNumber,
      status: "running" as const,
      workspacePath: null,
      branchName: task.branchName,
      codexThreadId: task.latestThreadId,
      repairCount: task.repairCount,
      reportPath: null,
      diffPath: null,
      commitSha: null,
      prNumber: null,
      summary: null,
      startedAt: now,
      completedAt: null,
      updatedAt: now
    };

    await this.db.insert(taskAttempts).values(row);
    await this.db.update(tasks).set({ latestAttemptId: attemptId, updatedAt: now }).where(eq(tasks.id, taskId));
    return toTaskAttemptRecord(row);
  }

  async getAttempt(id: string): Promise<TaskAttemptRecord | null> {
    const [row] = await this.db.select().from(taskAttempts).where(eq(taskAttempts.id, id)).limit(1);
    return row ? toTaskAttemptRecord(row) : null;
  }

  async logEvent(taskId: string, event: Omit<RunEventRecord, "id" | "taskId" | "createdAt">): Promise<RunEventRecord> {
    const row = {
      id: randomUUID(),
      taskId,
      attemptId: event.attemptId,
      eventType: event.eventType,
      level: event.level,
      message: event.message,
      payload: event.payload,
      createdAt: Date.now()
    };
    await this.db.insert(runEvents).values(row);
    return {
      id: row.id,
      taskId: row.taskId,
      attemptId: row.attemptId,
      eventType: row.eventType,
      level: row.level,
      message: row.message,
      payload: row.payload,
      createdAt: row.createdAt
    };
  }

  async claimNextQueuedTask(workerId: string, leaseMs: number): Promise<TaskRecord | null> {
    const now = Date.now();
    const [candidate] = await this.db
      .select()
      .from(tasks)
      .where(and(eq(tasks.state, "queued"), isNull(tasks.workerId)))
      .orderBy(asc(tasks.createdAt))
      .limit(1);

    if (!candidate) {
      return null;
    }

    await this.db
      .update(tasks)
      .set({
        workerId,
        leaseExpiresAt: now + leaseMs,
        updatedAt: now
      })
      .where(eq(tasks.id, candidate.id));

    return {
      ...toTaskRecord(candidate),
      workerId,
      leaseExpiresAt: now + leaseMs,
      updatedAt: now
    };
  }

  async touchLease(taskId: string, workerId: string, leaseMs: number): Promise<void> {
    await this.db
      .update(tasks)
      .set({
        workerId,
        leaseExpiresAt: Date.now() + leaseMs,
        updatedAt: Date.now()
      })
      .where(eq(tasks.id, taskId));
  }

  async releaseLease(taskId: string): Promise<void> {
    await this.db
      .update(tasks)
      .set({
        workerId: null,
        leaseExpiresAt: null,
        updatedAt: Date.now()
      })
      .where(eq(tasks.id, taskId));
  }

  async requeueExpiredTasks(now = Date.now()): Promise<number> {
    const rows = await this.db
      .select()
      .from(tasks)
      .where(and(inArray(tasks.state, [...ACTIVE_STATES]), lt(tasks.leaseExpiresAt, now)));

    for (const row of rows) {
      await this.db
        .update(tasks)
        .set({
          state: "queued",
          workerId: null,
          leaseExpiresAt: null,
          lastError: "Recovered task after expired lease",
          updatedAt: now
        })
        .where(eq(tasks.id, row.id));
    }

    return rows.length;
  }

  async cancelTask(taskId: string): Promise<TaskRecord> {
    const task = await this.getTaskOrThrow(taskId);

    if (isTerminalState(task.state)) {
      return task;
    }

    const now = Date.now();
    await this.db
      .update(tasks)
      .set({
        state: "cancelled",
        workerId: null,
        leaseExpiresAt: null,
        completedAt: now,
        updatedAt: now
      })
      .where(eq(tasks.id, taskId));

    return this.getTaskOrThrow(taskId);
  }

  async retryTask(taskId: string): Promise<TaskRecord> {
    const task = await this.getTaskOrThrow(taskId);

    if (!["failed", "blocked_sensitive_review", "cancelled"].includes(task.state)) {
      throw new Error(`Task ${taskId} is not retryable from state ${task.state}`);
    }

    await this.db
      .update(tasks)
      .set({
        state: "queued",
        repairCount: 0,
        workerId: null,
        leaseExpiresAt: null,
        lastError: null,
        latestAttemptId: null,
        latestThreadId: null,
        completedAt: null,
        updatedAt: Date.now()
      })
      .where(eq(tasks.id, taskId));

    return this.getTaskOrThrow(taskId);
  }

  async patchTask(taskId: string, patch: Partial<Omit<TaskRecord, "id" | "source" | "repositoryId" | "createdAt">>): Promise<TaskRecord> {
    await this.db
      .update(tasks)
      .set({
        title: patch.title,
        state: patch.state,
        rawInput: patch.rawInput,
        contract: patch.contract,
        executionBrief: patch.executionBrief,
        completionSummary: patch.completionSummary,
        conversationId: patch.conversationId,
        branchName: patch.branchName,
        maxRepairLoops: patch.maxRepairLoops,
        repairCount: patch.repairCount,
        workerId: patch.workerId,
        leaseExpiresAt: patch.leaseExpiresAt,
        lastError: patch.lastError,
        latestAttemptId: patch.latestAttemptId,
        latestThreadId: patch.latestThreadId,
        externalMetadata: patch.externalMetadata,
        startedAt: patch.startedAt,
        completedAt: patch.completedAt,
        updatedAt: Date.now()
      })
      .where(eq(tasks.id, taskId));

    return this.getTaskOrThrow(taskId);
  }

  async patchAttempt(attemptId: string, patch: Partial<Omit<TaskAttemptRecord, "id" | "taskId" | "attemptNumber" | "startedAt">>): Promise<TaskAttemptRecord> {
    await this.db
      .update(taskAttempts)
      .set({
        status: patch.status,
        workspacePath: patch.workspacePath,
        branchName: patch.branchName,
        codexThreadId: patch.codexThreadId,
        repairCount: patch.repairCount,
        reportPath: patch.reportPath,
        diffPath: patch.diffPath,
        commitSha: patch.commitSha,
        prNumber: patch.prNumber,
        summary: patch.summary,
        completedAt: patch.completedAt,
        updatedAt: Date.now()
      })
      .where(eq(taskAttempts.id, attemptId));

    const attempt = await this.getAttempt(attemptId);

    if (!attempt) {
      throw new Error(`Attempt not found: ${attemptId}`);
    }

    return attempt;
  }

  private async nextAttemptNumber(taskId: string): Promise<number> {
    const [row] = await this.db
      .select({ value: sql<number>`coalesce(max(${taskAttempts.attemptNumber}), 0)` })
      .from(taskAttempts)
      .where(eq(taskAttempts.taskId, taskId));

    return (row?.value ?? 0) + 1;
  }

  private async getTaskOrThrow(taskId: string): Promise<TaskRecord> {
    const [row] = await this.db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);

    if (!row) {
      throw new Error(`Task not found: ${taskId}`);
    }

    return toTaskRecord(row);
  }
}

function toTaskRecord(row: TaskRow): TaskRecord {
  return {
    id: row.id,
    source: row.source,
    externalRef: row.externalRef,
    repositoryId: row.repositoryId,
    state: row.state,
    title: row.title,
    rawInput: row.rawInput,
    contract: row.contract,
    executionBrief: row.executionBrief,
    completionSummary: row.completionSummary,
    conversationId: row.conversationId,
    branchName: row.branchName,
    maxRepairLoops: row.maxRepairLoops,
    repairCount: row.repairCount,
    workerId: row.workerId,
    leaseExpiresAt: row.leaseExpiresAt,
    lastError: row.lastError,
    latestAttemptId: row.latestAttemptId,
    latestThreadId: row.latestThreadId,
    externalMetadata: row.externalMetadata,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    startedAt: row.startedAt,
    completedAt: row.completedAt
  };
}

function toTaskAttemptRecord(row: TaskAttemptRow): TaskAttemptRecord {
  return {
    id: row.id,
    taskId: row.taskId,
    attemptNumber: row.attemptNumber,
    status: row.status,
    workspacePath: row.workspacePath,
    branchName: row.branchName,
    codexThreadId: row.codexThreadId,
    repairCount: row.repairCount,
    reportPath: row.reportPath,
    diffPath: row.diffPath,
    commitSha: row.commitSha,
    prNumber: row.prNumber,
    summary: row.summary,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    updatedAt: row.updatedAt
  };
}
