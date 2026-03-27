import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { WorkspaceManager } from "../src/services/workspace-manager.js";
import { cleanupDir, createTempDir } from "./helpers.js";
import { runProcess } from "../src/lib/command-runner.js";

describe("WorkspaceManager", () => {
  it("creates a git worktree for local repositories", async () => {
    const rootDir = createTempDir("codex-scheduler-worktree-");
    const repoDir = path.join(rootDir, "repo");
    const workspacesDir = path.join(rootDir, "workspaces");

    try {
      mkdirSync(repoDir, { recursive: true });
      await runProcess("git", ["init", "-b", "main"], repoDir);
      writeFileSync(path.join(repoDir, "README.md"), "# test\n", "utf8");
      await runProcess("git", ["add", "README.md"], repoDir);
      await runProcess("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "init"], repoDir);

      const manager = new WorkspaceManager(workspacesDir);
      const workspace = await manager.prepareWorkspace(
        "task-1",
        {
          id: "repo",
          name: "repo",
          mode: "local",
          local_path: repoDir,
          default_branch: "main",
          install_command: 'node -e "process.exit(0)"',
          verify_commands: ['node -e "process.exit(0)"'],
          allow_network: false,
          linear_rules: {
            team_keys: [],
            project_names: [],
            labels: []
          }
        },
        "codex/task-1"
      );

      expect(workspace.workspacePath).toContain("task-1");
      expect(workspace.branchName).toBe("codex/task-1");
    } finally {
      cleanupDir(rootDir);
    }
  });

  it("rejects non-git local repositories", async () => {
    const rootDir = createTempDir("codex-scheduler-not-git-");
    const repoDir = path.join(rootDir, "repo");

    try {
      mkdirSync(repoDir, { recursive: true });
      const manager = new WorkspaceManager(path.join(rootDir, "workspaces"));

      await expect(
        manager.prepareWorkspace(
          "task-2",
          {
            id: "repo",
            name: "repo",
            mode: "local",
            local_path: repoDir,
            default_branch: "main",
            install_command: 'node -e "process.exit(0)"',
            verify_commands: ['node -e "process.exit(0)"'],
            allow_network: false,
            linear_rules: {
              team_keys: [],
              project_names: [],
              labels: []
            }
          },
          "codex/task-2"
        )
      ).rejects.toThrow("not a Git repository");
    } finally {
      cleanupDir(rootDir);
    }
  });
});
