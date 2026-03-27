import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { TaskStore } from "../src/db/task-store.js";
import { createLogger } from "../src/lib/logger.js";
import { runProcess } from "../src/lib/command-runner.js";
import { TaskRunner } from "../src/runtime/task-runner.js";
import { OpenAIWorkflowService } from "../src/services/openai-workflow.js";
import { WorkspaceManager } from "../src/services/workspace-manager.js";
import { cleanupDir, createTempDir, createTestConfig, createTestDatabase } from "./helpers.js";

class FakeCodexExecutionService {
  public turns = 0;

  async runTurn(args: { workspacePath: string }) {
    this.turns += 1;
    if (this.turns > 1) {
      writeFileSync(path.join(args.workspacePath, "flag.txt"), "pass", "utf8");
    }
    return {
      threadId: `thread-${this.turns}`,
      finalResponse: JSON.stringify({
        summary: "updated files",
        key_files: ["flag.txt"],
        next_action: "verify"
      }),
      usage: null,
      items: []
    };
  }
}

class FakeDeliveryService {
  constructor(private readonly outcome: "completed" | "blocked_sensitive_review" = "completed") {}

  async deliver(args: { taskId: string; reportRoot: string }) {
    const reportPath = path.join(args.reportRoot, args.taskId, "delivery.md");
    mkdirSync(path.dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, `outcome: ${this.outcome}`, "utf8");

    return {
      outcome: this.outcome,
      reportPath,
      diffPath: null,
      commitSha: this.outcome === "completed" ? "abc123" : null,
      prNumber: null,
      prUrl: null,
      artifacts: [reportPath]
    };
  }
}

class FakeLinearGateway {
  async addComment() {}
  async syncMappedState() {}
}

describe("TaskRunner", () => {
  it("repairs failing verification and completes the task", async () => {
    const rootDir = createTempDir("codex-scheduler-runner-");
    const repoDir = path.join(rootDir, "repo");

    try {
      mkdirSync(repoDir, { recursive: true });
      await runProcess("git", ["init", "-b", "main"], repoDir);
      writeFileSync(path.join(repoDir, "flag.txt"), "fail", "utf8");
      await runProcess("git", ["add", "flag.txt"], repoDir);
      await runProcess("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "init"], repoDir);

      const config = createTestConfig(rootDir);
      config.default_repair_loops = 2;
      config.repositories.push({
        id: "repo-1",
        name: "Repo",
        mode: "local",
        local_path: repoDir,
        default_branch: "main",
        install_command: 'node -e "process.exit(0)"',
        verify_commands: ['node -e "const fs=require(\'fs\'); process.exit(fs.readFileSync(\'flag.txt\',\'utf8\').trim()===\'pass\'?0:1)"'],
        allow_network: false,
        linear_rules: {
          team_keys: [],
          project_names: [],
          labels: []
        }
      });

      const { sqlite, db } = createTestDatabase(rootDir);
      const store = new TaskStore(db);
      const workflow = new OpenAIWorkflowService(null, config.default_model);
      const task = await store.createTask({
        repositoryId: "repo-1",
        source: "api",
        title: "Repair task",
        rawInput: "Make verification pass",
        maxRepairLoops: 2,
        conversationId: "local-conv-test"
      });

      const runner = new TaskRunner({
        config,
        taskStore: store,
        openaiWorkflow: workflow,
        codexExecution: new FakeCodexExecutionService() as any,
        workspaceManager: new WorkspaceManager(config.workspace_root),
        deliveryService: new FakeDeliveryService() as any,
        linearGateway: new FakeLinearGateway() as any,
        logger: createLogger(),
        workerId: "worker-test",
        leaseMs: 30_000
      });

      await runner.run(task.id, new AbortController().signal);

      const updated = await store.getTask(task.id);
      expect(updated?.state).toBe("completed");
      expect(updated?.repairCount).toBe(1);
      expect(readFileSync(path.join(config.report_root, task.id, "delivery.md"), "utf8")).toContain("completed");
      if (updated?.attempt?.workspacePath) {
        await runProcess("git", ["worktree", "remove", "--force", updated.attempt.workspacePath], repoDir);
      }
      sqlite.close();
    } finally {
      cleanupDir(rootDir);
    }
  });

  it("blocks delivery when sensitive scan reports a problem", async () => {
    const rootDir = createTempDir("codex-scheduler-blocked-");
    const repoDir = path.join(rootDir, "repo");

    try {
      mkdirSync(repoDir, { recursive: true });
      await runProcess("git", ["init", "-b", "main"], repoDir);
      writeFileSync(path.join(repoDir, "flag.txt"), "pass", "utf8");
      await runProcess("git", ["add", "flag.txt"], repoDir);
      await runProcess("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "init"], repoDir);

      const config = createTestConfig(rootDir);
      config.repositories.push({
        id: "repo-1",
        name: "Repo",
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
      });

      const { sqlite, db } = createTestDatabase(rootDir);
      const store = new TaskStore(db);
      const task = await store.createTask({
        repositoryId: "repo-1",
        source: "api",
        title: "Blocked task",
        rawInput: "Do work",
        maxRepairLoops: 1,
        conversationId: "local-conv-test"
      });

      const runner = new TaskRunner({
        config,
        taskStore: store,
        openaiWorkflow: new OpenAIWorkflowService(null, config.default_model),
        codexExecution: new FakeCodexExecutionService() as any,
        workspaceManager: new WorkspaceManager(config.workspace_root),
        deliveryService: new FakeDeliveryService("blocked_sensitive_review") as any,
        linearGateway: new FakeLinearGateway() as any,
        logger: createLogger(),
        workerId: "worker-test",
        leaseMs: 30_000
      });

      await runner.run(task.id, new AbortController().signal);

      const updated = await store.getTask(task.id);
      expect(updated?.state).toBe("blocked_sensitive_review");
      if (updated?.attempt?.workspacePath) {
        await runProcess("git", ["worktree", "remove", "--force", updated.attempt.workspacePath], repoDir);
      }
      sqlite.close();
    } finally {
      cleanupDir(rootDir);
    }
  });
});
