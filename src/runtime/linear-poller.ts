import type { SchedulerConfig } from "../config/types.js";
import { TaskIntakeService } from "../services/task-intake.js";
import { LinearGateway } from "../services/linear-gateway.js";
import type { Logger } from "../lib/logger.js";

export class LinearPoller {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly config: SchedulerConfig,
    private readonly linearGateway: LinearGateway,
    private readonly intakeService: TaskIntakeService,
    private readonly logger: Logger
  ) {}

  start(): void {
    if (!this.linearGateway.isEnabled() || this.timer) {
      return;
    }

    this.timer = setInterval(() => {
      void this.pollOnce();
    }, this.config.poll_interval_seconds * 1000);

    void this.pollOnce();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async pollOnce(): Promise<void> {
    const candidates = await this.linearGateway.poll(this.config);

    for (const candidate of candidates) {
      const task = await this.intakeService.createTaskFromLinearCandidate(candidate);
      if (task) {
        this.logger.info({ taskId: task.id, issueId: candidate.issueId }, "Enqueued Linear issue");
      }
    }
  }
}
