import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";

import type { RepositoryProfile } from "../config/types.js";
import { runProcess } from "../lib/command-runner.js";

export type PreparedWorkspace = {
  workspacePath: string;
  branchName: string;
  baseBranch: string;
  fresh: boolean;
};

export class WorkspaceManager {
  constructor(private readonly workspaceRoot: string) {}

  async prepareWorkspace(taskId: string, repository: RepositoryProfile, branchName: string, signal?: AbortSignal): Promise<PreparedWorkspace> {
    mkdirSync(this.workspaceRoot, { recursive: true });
    const workspacePath = path.join(this.workspaceRoot, taskId);
    const fresh = !existsSync(workspacePath);

    if (repository.mode === "local") {
      await ensureGitRepository(repository.local_path, signal);

      if (!existsSync(workspacePath)) {
        await runProcess("git", ["worktree", "add", workspacePath, "-b", branchName, repository.default_branch], repository.local_path, signal);
      }
    } else {
      if (!existsSync(workspacePath)) {
        await runProcess("git", ["clone", "--branch", repository.default_branch, "--single-branch", repository.clone_url, workspacePath], process.cwd(), signal);
        await runProcess("git", ["switch", "-c", branchName], workspacePath, signal);
      }
    }

    return {
      workspacePath,
      branchName,
      baseBranch: repository.default_branch,
      fresh
    };
  }
}

async function ensureGitRepository(repositoryPath: string, signal?: AbortSignal): Promise<void> {
  const result = await runProcess("git", ["rev-parse", "--is-inside-work-tree"], repositoryPath, signal);

  if (result.exitCode !== 0 || !result.stdout.includes("true")) {
    throw new Error(`Target local path is not a Git repository: ${repositoryPath}`);
  }
}
