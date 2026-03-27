import { readFileSync } from "node:fs";
import path from "node:path";

import { parse } from "@iarna/toml";

import { schedulerConfigSchema, type RepositoryProfile, type SchedulerConfig } from "./types.js";

export function resolveSchedulerPaths(config: SchedulerConfig, rootDir: string): SchedulerConfig {
  return {
    ...config,
    workspace_root: path.resolve(rootDir, config.workspace_root),
    report_root: path.resolve(rootDir, config.report_root),
    sqlite_path: path.resolve(rootDir, config.sqlite_path),
    repositories: config.repositories.map((repository) => resolveRepositoryPaths(rootDir, repository))
  };
}

function resolveRepositoryPaths(rootDir: string, repository: RepositoryProfile): RepositoryProfile {
  if (repository.mode === "local") {
    return {
      ...repository,
      local_path: path.resolve(rootDir, repository.local_path)
    };
  }

  return repository;
}

export function loadSchedulerConfig(configPath: string): SchedulerConfig {
  const contents = readFileSync(configPath, "utf8");
  const parsed = parse(contents);
  const validated = schedulerConfigSchema.parse(parsed);
  return resolveSchedulerPaths(validated, path.dirname(configPath));
}

export function findRepository(config: SchedulerConfig, repositoryId: string): RepositoryProfile {
  const repository = config.repositories.find((entry) => entry.id === repositoryId);

  if (!repository) {
    throw new Error(`Unknown repository profile: ${repositoryId}`);
  }

  return repository;
}
