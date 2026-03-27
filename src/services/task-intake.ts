import type { SchedulerConfig } from "../config/types.js";
import { findRepository } from "../config/load-config.js";
import { createTaskRequestSchema, taskContractSchema, type CreateTaskRequest, type TaskRecord } from "../domain/task.js";
import { ConflictError } from "../lib/errors.js";
import { TaskStore } from "../db/task-store.js";
import { OpenAIWorkflowService } from "./openai-workflow.js";

export class TaskIntakeService {
  constructor(
    private readonly config: SchedulerConfig,
    private readonly taskStore: TaskStore,
    private readonly openaiWorkflow: OpenAIWorkflowService
  ) {}

  async createTask(input: unknown): Promise<TaskRecord> {
    const request = createTaskRequestSchema.parse(input);
    findRepository(this.config, request.repositoryId);

    if (request.externalRef) {
      const existing = await this.taskStore.findByExternalRef(request.source, request.externalRef);

      if (existing) {
        throw new ConflictError(`Task already exists for external reference ${request.externalRef}`);
      }
    }

    const conversationId = await this.openaiWorkflow.ensureConversation(null, {
      repositoryId: request.repositoryId,
      source: request.source
    });

    if ("contract" in request) {
      const contract = taskContractSchema.parse(request.contract);
      return this.taskStore.createTask({
        repositoryId: request.repositoryId,
        source: request.source,
        externalRef: request.externalRef,
        title: contract.goal,
        contract,
        conversationId,
        maxRepairLoops: contract.max_repair_loops ?? this.config.default_repair_loops
      });
    }

    return this.taskStore.createTask({
      repositoryId: request.repositoryId,
      source: request.source,
      externalRef: request.externalRef,
      title: request.rawInput.slice(0, 80),
      rawInput: request.rawInput,
      conversationId,
      maxRepairLoops: this.config.default_repair_loops
    });
  }

  async createTaskFromLinearCandidate(candidate: {
    issueId: string;
    identifier: string;
    title: string;
    rawInput: string;
    repositoryId: string;
    metadata: Record<string, string>;
  }): Promise<TaskRecord | null> {
    const existing = await this.taskStore.findByExternalRef("linear", candidate.issueId);

    if (existing) {
      return null;
    }

    const conversationId = await this.openaiWorkflow.ensureConversation(null, {
      repositoryId: candidate.repositoryId,
      source: "linear",
      issueId: candidate.issueId
    });

    return this.taskStore.createTask({
      repositoryId: candidate.repositoryId,
      source: "linear",
      externalRef: candidate.issueId,
      title: candidate.title,
      rawInput: candidate.rawInput,
      conversationId,
      maxRepairLoops: this.config.default_repair_loops,
      externalMetadata: candidate.metadata
    });
  }
}
