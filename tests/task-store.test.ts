import { TaskStore } from "../src/db/task-store.js";
import { cleanupDir, createTempDir, createTestDatabase } from "./helpers.js";

describe("TaskStore", () => {
  it("creates tasks, attempts, and requeues expired work", async () => {
    const rootDir = createTempDir("codex-scheduler-store-");

    try {
      const { sqlite, db } = createTestDatabase(rootDir);
      const store = new TaskStore(db);

      const task = await store.createTask({
        repositoryId: "repo-1",
        source: "api",
        title: "Test task",
        rawInput: "Do something",
        maxRepairLoops: 3
      });

      const attempt = await store.createAttempt(task.id);
      expect(attempt.attemptNumber).toBe(1);

      await store.patchTask(task.id, {
        state: "coding",
        leaseExpiresAt: Date.now() - 1
      });

      const recovered = await store.requeueExpiredTasks(Date.now());
      expect(recovered).toBe(1);

      const reloaded = await store.getTask(task.id);
      expect(reloaded?.state).toBe("queued");
      sqlite.close();
    } finally {
      cleanupDir(rootDir);
    }
  });

  it("retries failed tasks", async () => {
    const rootDir = createTempDir("codex-scheduler-retry-");

    try {
      const { sqlite, db } = createTestDatabase(rootDir);
      const store = new TaskStore(db);

      const task = await store.createTask({
        repositoryId: "repo-1",
        source: "api",
        title: "Retry me",
        maxRepairLoops: 1
      });

      await store.patchTask(task.id, {
        state: "failed",
        lastError: "boom",
        repairCount: 1
      });

      const retried = await store.retryTask(task.id);
      expect(retried.state).toBe("queued");
      expect(retried.repairCount).toBe(0);
      sqlite.close();
    } finally {
      cleanupDir(rootDir);
    }
  });

  it("does not claim the same queued task twice while leased", async () => {
    const rootDir = createTempDir("codex-scheduler-claim-");

    try {
      const { sqlite, db } = createTestDatabase(rootDir);
      const store = new TaskStore(db);

      const task = await store.createTask({
        repositoryId: "repo-1",
        source: "api",
        title: "Lease me once",
        maxRepairLoops: 1
      });

      const firstClaim = await store.claimNextQueuedTask("worker-a", 30_000);
      const secondClaim = await store.claimNextQueuedTask("worker-b", 30_000);

      expect(firstClaim?.id).toBe(task.id);
      expect(secondClaim).toBeNull();
      sqlite.close();
    } finally {
      cleanupDir(rootDir);
    }
  });
});
