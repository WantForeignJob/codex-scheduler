import { z } from "zod";

export const repositoryModeSchema = z.enum(["local", "github"]);
export type RepositoryMode = z.infer<typeof repositoryModeSchema>;

export const linearRulesSchema = z.object({
  team_keys: z.array(z.string()).default([]),
  project_names: z.array(z.string()).default([]),
  labels: z.array(z.string()).default([])
});

export const linearStatusesSchema = z.object({
  in_progress: z.string().min(1).optional(),
  done: z.string().min(1).optional(),
  failed: z.string().min(1).optional()
});

const repositoryBaseSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  mode: repositoryModeSchema,
  default_branch: z.string().min(1),
  install_command: z.string().min(1),
  verify_commands: z.array(z.string().min(1)).min(1),
  allow_network: z.boolean().default(false),
  linear_rules: linearRulesSchema.default({
    team_keys: [],
    project_names: [],
    labels: []
  }),
  linear_statuses: linearStatusesSchema.optional()
});

const localRepositorySchema = repositoryBaseSchema.extend({
  mode: z.literal("local"),
  local_path: z.string().min(1),
  clone_url: z.undefined().optional()
});

const githubRepositorySchema = repositoryBaseSchema.extend({
  mode: z.literal("github"),
  clone_url: z.string().min(1),
  local_path: z.undefined().optional()
});

export const repositoryProfileSchema = z.union([localRepositorySchema, githubRepositorySchema]);
export type RepositoryProfile = z.infer<typeof repositoryProfileSchema>;

export const schedulerConfigSchema = z.object({
  host: z.string().default("127.0.0.1"),
  port: z.number().int().min(1).max(65535).default(4318),
  poll_interval_seconds: z.number().int().positive().default(60),
  worker_concurrency: z.number().int().positive().max(8).default(1),
  default_model: z.string().min(1).default("gpt-5.4"),
  default_repair_loops: z.number().int().positive().max(10).default(3),
  workspace_root: z.string().min(1).default("./workspaces"),
  report_root: z.string().min(1).default("./reports"),
  sqlite_path: z.string().min(1).default("./data/scheduler.db"),
  gitleaks_command: z.string().min(1).default("gitleaks detect --no-git --source . --report-format json --report-path gitleaks-report.json"),
  repositories: z.array(repositoryProfileSchema).min(1)
});

export type SchedulerConfig = z.infer<typeof schedulerConfigSchema>;
