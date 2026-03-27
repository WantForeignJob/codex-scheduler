import { randomUUID } from "node:crypto";
import { z } from "zod";

export const taskStateValues = [
  "queued",
  "normalizing",
  "planned",
  "preparing_workspace",
  "coding",
  "verifying",
  "repairing",
  "delivering",
  "completed",
  "failed",
  "blocked_sensitive_review",
  "cancelled"
] as const;

export const taskStateSchema = z.enum(taskStateValues);
export type TaskState = z.infer<typeof taskStateSchema>;

export const taskSourceSchema = z.enum(["api", "linear", "manual", "notion", "slack"]);
export type TaskSource = z.infer<typeof taskSourceSchema>;

export const deliveryTargetSchema = z.enum(["pull_request", "artifact", "release_note", "patch", "report"]);
export type DeliveryTarget = z.infer<typeof deliveryTargetSchema>;

export const taskBudgetSchema = z.object({
  max_minutes: z.number().int().positive().max(24 * 60).default(30),
  max_model_calls: z.number().int().positive().max(100).default(12)
});

export const taskContractSchema = z.object({
  task_id: z.string().min(1).optional(),
  source: taskSourceSchema.default("api"),
  goal: z.string().min(1),
  business_context: z.string().default(""),
  repo: z.string().optional(),
  branch_strategy: z.string().optional(),
  scope_in: z.array(z.string()).default([]),
  scope_out: z.array(z.string()).default([]),
  constraints: z.array(z.string()).default([]),
  files_hint: z.array(z.string()).default([]),
  acceptance_tests: z.array(z.string()).default([]),
  delivery: z.array(deliveryTargetSchema).default(["pull_request"]),
  max_repair_loops: z.number().int().min(0).max(10).optional(),
  budget: taskBudgetSchema.optional(),
  metadata: z.record(z.string(), z.string()).optional()
});

export type TaskContract = z.infer<typeof taskContractSchema>;

export const executionBriefSchema = z.object({
  title: z.string().min(1),
  summary: z.string().min(1),
  branch_name: z.string().min(1),
  implementation_notes: z.array(z.string()).default([]),
  verification_commands: z.array(z.string()).default([]),
  delivery_targets: z.array(deliveryTargetSchema).default(["pull_request"]),
  risk_checks: z.array(z.string()).default([])
});

export type ExecutionBrief = z.infer<typeof executionBriefSchema>;

export const completionSummarySchema = z.object({
  outcome: z.enum(["completed", "completed_without_changes", "failed", "blocked_sensitive_review", "cancelled"]),
  summary: z.string().min(1),
  key_changes: z.array(z.string()).default([]),
  verification_results: z.array(z.string()).default([]),
  delivery_artifacts: z.array(z.string()).default([])
});

export type CompletionSummary = z.infer<typeof completionSummarySchema>;

export const createStructuredTaskRequestSchema = z.object({
  repositoryId: z.string().min(1),
  source: taskSourceSchema.default("api"),
  externalRef: z.string().min(1).optional(),
  contract: taskContractSchema
});

export const createRawTaskRequestSchema = z.object({
  repositoryId: z.string().min(1),
  source: taskSourceSchema.default("api"),
  externalRef: z.string().min(1).optional(),
  rawInput: z.string().min(1)
});

export const createTaskRequestSchema = z.union([createStructuredTaskRequestSchema, createRawTaskRequestSchema]);
export type CreateTaskRequest = z.infer<typeof createTaskRequestSchema>;

export type TaskRecordContract = TaskContract | null;

export type TaskRecord = {
  id: string;
  source: TaskSource;
  externalRef: string | null;
  repositoryId: string;
  state: TaskState;
  title: string;
  rawInput: string | null;
  contract: TaskRecordContract;
  executionBrief: ExecutionBrief | null;
  completionSummary: CompletionSummary | null;
  conversationId: string | null;
  branchName: string | null;
  maxRepairLoops: number;
  repairCount: number;
  workerId: string | null;
  leaseExpiresAt: number | null;
  lastError: string | null;
  latestAttemptId: string | null;
  latestThreadId: string | null;
  externalMetadata: Record<string, string> | null;
  createdAt: number;
  updatedAt: number;
  startedAt: number | null;
  completedAt: number | null;
};

export type TaskAttemptRecord = {
  id: string;
  taskId: string;
  attemptNumber: number;
  status: "running" | "completed" | "failed" | "cancelled";
  workspacePath: string | null;
  branchName: string | null;
  codexThreadId: string | null;
  repairCount: number;
  reportPath: string | null;
  diffPath: string | null;
  commitSha: string | null;
  prNumber: number | null;
  summary: string | null;
  startedAt: number;
  completedAt: number | null;
  updatedAt: number;
};

export type RunEventRecord = {
  id: string;
  taskId: string;
  attemptId: string | null;
  eventType: string;
  level: "debug" | "info" | "warn" | "error";
  message: string;
  payload: unknown;
  createdAt: number;
};

export type TaskView = TaskRecord & {
  attempt: TaskAttemptRecord | null;
};

export function buildSchedulerTaskId(now = new Date()): string {
  const stamp = now.toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  return `AUTO-${stamp}-${randomUUID().slice(0, 8)}`;
}

export function buildBranchName(taskId: string): string {
  const suffix = taskId.toLowerCase().replace(/[^a-z0-9-_./]+/g, "-");
  return `codex/${suffix}`;
}

export function isTerminalState(state: TaskState): boolean {
  return ["completed", "failed", "blocked_sensitive_review", "cancelled"].includes(state);
}
