import { randomUUID } from "node:crypto";

import { TaskStore } from "../db/task-store.js";
import type { Logger } from "../lib/logger.js";
import { TaskRunner } from "./task-runner.js";

export class TaskQueue {
  private readonly workerId = `worker-${randomUUID()}`;
  private readonly active = new Map<string, AbortController>();
  private timer: NodeJS.Timeout | null = null;
  private draining = false;

  constructor(
    private readonly taskStore: TaskStore,
    private readonly taskRunnerFactory: (workerId: string) => TaskRunner,
    private readonly concurrency: number,
    private readonly pollIntervalMs: number,
    private readonly leaseMs: number,
    private readonly logger: Logger
  ) {}

  start(): void {
    if (this.timer) {
      return;
    }

    this.timer = setInterval(() => {
      void this.tick();
    }, this.pollIntervalMs);

    void this.tick();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    for (const controller of this.active.values()) {
      controller.abort();
    }
  }

  async tick(): Promise<void> {
    if (this.draining) {
      return;
    }

    this.draining = true;

    try {
      await this.taskStore.requeueExpiredTasks();

      while (this.active.size < this.concurrency) {
        const task = await this.taskStore.claimNextQueuedTask(this.workerId, this.leaseMs);

        if (!task) {
          break;
        }

        const controller = new AbortController();
        this.active.set(task.id, controller);
        const runner = this.taskRunnerFactory(this.workerId);

        void runner.run(task.id, controller.signal)
          .catch((error) => {
            this.logger.error({ taskId: task.id, err: error }, "Task runner crashed");
          })
          .finally(() => {
            this.active.delete(task.id);
            void this.tick();
          });
      }
    } finally {
      this.draining = false;
    }
  }

  cancel(taskId: string): void {
    this.active.get(taskId)?.abort();
  }
}
