import { writeFileSync } from "node:fs";

import type { SchedulerConfig } from "../config/types.js";
import { findRepository } from "../config/load-config.js";
import { buildBranchName, taskContractSchema, type TaskAttemptRecord, type TaskContract, type TaskRecord, type TaskState } from "../domain/task.js";
import { TaskStore } from "../db/task-store.js";
import type { Logger } from "../lib/logger.js";
import { runShellCommand } from "../lib/command-runner.js";
import { CodexExecutionService } from "../services/codex-execution.js";
import { DeliveryService } from "../services/delivery-service.js";
import { LinearGateway } from "../services/linear-gateway.js";
import { OpenAIWorkflowService } from "../services/openai-workflow.js";
import { WorkspaceManager } from "../services/workspace-manager.js";

type TaskRunnerDeps = {
  config: SchedulerConfig;
  taskStore: TaskStore;
  openaiWorkflow: OpenAIWorkflowService;
  codexExecution: CodexExecutionService;
  workspaceManager: WorkspaceManager;
  deliveryService: DeliveryService;
  linearGateway: LinearGateway;
  logger: Logger;
  workerId: string;
  leaseMs: number;
};

type VerificationResult = {
  ok: boolean;
  messages: string[];
  failureSummary: string | null;
};

export class TaskRunner {
  constructor(private readonly deps: TaskRunnerDeps) {}

  async run(taskId: string, signal: AbortSignal): Promise<void> {
    const taskView = await this.deps.taskStore.getTask(taskId);

    if (!taskView) {
      return;
    }

    const repository = findRepository(this.deps.config, taskView.repositoryId);
    let attempt = await this.deps.taskStore.createAttempt(taskId);
    let task: TaskRecord = taskView;
    let verificationMessages: string[] = [];

    try {
      task = await this.setTaskState(taskId, "normalizing", {
        startedAt: task.startedAt ?? Date.now()
      });

      await this.log(taskId, attempt.id, "task.state", "info", `Task entered ${task.state}`);
      await this.touchLease(taskId);

      const conversationId = await this.deps.openaiWorkflow.ensureConversation(task.conversationId, {
        taskId,
        repositoryId: repository.id,
        source: task.source
      });

      let contract = task.contract;
      if (!contract) {
        if (!task.rawInput) {
          throw new Error("Task does not contain a contract or raw input");
        }

        contract = await this.deps.openaiWorkflow.normalizeTask({
          conversationId,
          rawInput: task.rawInput,
          repository,
          source: task.source
        });
      }

      contract = taskContractSchema.parse({
        ...contract,
        task_id: task.id,
        source: task.source
      });

      task = await this.deps.taskStore.patchTask(taskId, {
        title: contract.goal,
        contract,
        conversationId,
        branchName: contract.branch_strategy ?? task.branchName ?? buildBranchName(task.id),
        maxRepairLoops: contract.max_repair_loops ?? task.maxRepairLoops
      });

      task = await this.setTaskState(taskId, "planned");
      const brief = await this.deps.openaiWorkflow.createExecutionBrief({
        conversationId,
        contract,
        repository,
        branchName: task.branchName ?? buildBranchName(task.id)
      });

      task = await this.deps.taskStore.patchTask(taskId, {
        executionBrief: brief,
        branchName: brief.branch_name
      });
      attempt = await this.deps.taskStore.patchAttempt(attempt.id, {
        branchName: brief.branch_name
      });
      await this.log(taskId, attempt.id, "task.plan", "info", brief.summary, brief);

      task = await this.setTaskState(taskId, "preparing_workspace");
      const preparedWorkspace = await this.deps.workspaceManager.prepareWorkspace(taskId, repository, brief.branch_name, signal);
      attempt = await this.deps.taskStore.patchAttempt(attempt.id, {
        workspacePath: preparedWorkspace.workspacePath,
        branchName: preparedWorkspace.branchName
      });
      await this.log(taskId, attempt.id, "workspace.prepared", "info", `Workspace ready at ${preparedWorkspace.workspacePath}`, preparedWorkspace);

      const installResult = await runShellCommand(repository.install_command, preparedWorkspace.workspacePath, signal);
      await this.logCommandResult(taskId, attempt.id, "workspace.install", installResult);
      if (installResult.exitCode !== 0) {
        throw new Error(`Install command failed: ${installResult.combined}`);
      }

      let threadId = attempt.codexThreadId;

      task = await this.setTaskState(taskId, "coding");
      const initialTurn = await this.deps.codexExecution.runTurn({
        workspacePath: preparedWorkspace.workspacePath,
        model: this.deps.config.default_model,
        allowNetwork: repository.allow_network,
        prompt: buildImplementationPrompt(contract, brief, repository),
        threadId,
        signal,
        onEvent: async (event) => {
          await this.deps.taskStore.logEvent(taskId, {
            attemptId: attempt.id,
            eventType: event.type,
            level: event.type === "turn.failed" || event.type === "error" ? "error" : "info",
            message: summarizeCodexEvent(event),
            payload: event
          });
        }
      });

      threadId = initialTurn.threadId;
      task = await this.deps.taskStore.patchTask(taskId, { latestThreadId: threadId });
      attempt = await this.deps.taskStore.patchAttempt(attempt.id, { codexThreadId: threadId });

      let repairCount = task.repairCount;

      while (true) {
        task = await this.setTaskState(taskId, "verifying", { latestThreadId: threadId });
        const verification = await this.runVerificationCommands(taskId, attempt.id, repository.verify_commands, preparedWorkspace.workspacePath, signal);
        verificationMessages = verification.messages;

        if (verification.ok) {
          break;
        }

        if (repairCount >= task.maxRepairLoops) {
          throw new Error(`Verification failed after ${repairCount} repair loops: ${verification.failureSummary}`);
        }

        repairCount += 1;
        task = await this.setTaskState(taskId, "repairing", {
          repairCount,
          lastError: verification.failureSummary ?? "Verification failed",
          latestThreadId: threadId
        });
        attempt = await this.deps.taskStore.patchAttempt(attempt.id, {
          repairCount,
          codexThreadId: threadId
        });

        const repairTurn = await this.deps.codexExecution.runTurn({
          workspacePath: preparedWorkspace.workspacePath,
          model: this.deps.config.default_model,
          allowNetwork: repository.allow_network,
          prompt: buildRepairPrompt(contract, verification.failureSummary ?? "Verification failed"),
          threadId,
          signal,
          onEvent: async (event) => {
            await this.deps.taskStore.logEvent(taskId, {
              attemptId: attempt.id,
              eventType: event.type,
              level: event.type === "turn.failed" || event.type === "error" ? "error" : "info",
              message: summarizeCodexEvent(event),
              payload: event
            });
          }
        });
        threadId = repairTurn.threadId;
        task = await this.deps.taskStore.patchTask(taskId, { latestThreadId: threadId, repairCount });
        attempt = await this.deps.taskStore.patchAttempt(attempt.id, { codexThreadId: threadId, repairCount });
      }

      task = await this.setTaskState(taskId, "delivering");
      const delivery = await this.deps.deliveryService.deliver({
        taskId,
        title: task.title,
        workspacePath: preparedWorkspace.workspacePath,
        repository,
        branchName: preparedWorkspace.branchName,
        reportRoot: this.deps.config.report_root,
        commitMessage: `codex(${task.id}): apply automated changes`,
        prTitle: `[Codex] ${task.title}`,
        prBody: [
          `Automated task: ${task.id}`,
          "",
          contract.acceptance_tests.length > 0 ? `Acceptance tests:\n- ${contract.acceptance_tests.join("\n- ")}` : "Acceptance tests: not specified"
        ].join("\n"),
        gitleaksCommand: this.deps.config.gitleaks_command,
        signal
      });

      attempt = await this.deps.taskStore.patchAttempt(attempt.id, {
        reportPath: delivery.reportPath,
        diffPath: delivery.diffPath,
        commitSha: delivery.commitSha,
        prNumber: delivery.prNumber
      });

      const outcomeState: TaskState = delivery.outcome === "blocked_sensitive_review" ? "blocked_sensitive_review" : "completed";
      const completionSummary = await this.deps.openaiWorkflow.summarizeCompletion({
        conversationId,
        contract,
        repository,
        verificationResults: verificationMessages,
        deliveryArtifacts: delivery.artifacts,
        outcome: delivery.outcome,
        fallbackSummary: delivery.outcome === "blocked_sensitive_review"
          ? "Delivery blocked because Gitleaks detected sensitive content."
          : "Task completed successfully."
      });

      task = await this.deps.taskStore.patchTask(taskId, {
        state: outcomeState,
        completionSummary,
        lastError: outcomeState === "completed" ? null : completionSummary.summary,
        completedAt: Date.now()
      });
      attempt = await this.deps.taskStore.patchAttempt(attempt.id, {
        status: outcomeState === "completed" ? "completed" : "failed",
        summary: completionSummary.summary,
        completedAt: Date.now()
      });
      await this.log(taskId, attempt.id, "task.completed", "info", completionSummary.summary, completionSummary);

      if (task.source === "linear" && task.externalRef) {
        await this.deps.linearGateway.addComment(task.externalRef, completionSummary.summary);
        await this.deps.linearGateway.syncMappedState(task.externalRef, repository, outcomeState === "completed" ? "done" : "failed");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const cancelled = signal.aborted || message.toLowerCase().includes("abort");
      const state: TaskState = cancelled ? "cancelled" : "failed";

      await this.deps.taskStore.patchTask(taskId, {
        state,
        lastError: message,
        completedAt: Date.now()
      });
      attempt = await this.deps.taskStore.patchAttempt(attempt.id, {
        status: cancelled ? "cancelled" : "failed",
        summary: message,
        completedAt: Date.now()
      });
      await this.log(taskId, attempt.id, "task.failed", cancelled ? "warn" : "error", message);

      if (task.source === "linear" && task.externalRef) {
        await this.deps.linearGateway.addComment(task.externalRef, `Task ${taskId} ${cancelled ? "was cancelled" : "failed"}.\n\n${message}`);
        await this.deps.linearGateway.syncMappedState(task.externalRef, repository, "failed");
      }
    } finally {
      await this.deps.taskStore.releaseLease(taskId);
    }
  }

  private async setTaskState(taskId: string, state: TaskState, extra: Record<string, unknown> = {}) {
    return this.deps.taskStore.patchTask(taskId, {
      state,
      ...extra
    });
  }

  private async touchLease(taskId: string) {
    await this.deps.taskStore.touchLease(taskId, this.deps.workerId, this.deps.leaseMs);
  }

  private async log(taskId: string, attemptId: string, eventType: string, level: "debug" | "info" | "warn" | "error", message: string, payload?: unknown) {
    this.deps.logger[level]({ taskId, attemptId, payload }, message);
    await this.deps.taskStore.logEvent(taskId, {
      attemptId,
      eventType,
      level,
      message,
      payload: payload ?? null
    });
  }

  private async logCommandResult(taskId: string, attemptId: string, eventType: string, result: { command: string; exitCode: number; combined: string }) {
    await this.log(
      taskId,
      attemptId,
      eventType,
      result.exitCode === 0 ? "info" : "error",
      `${result.command} -> exit ${result.exitCode}`,
      result
    );
  }

  private async runVerificationCommands(taskId: string, attemptId: string, commands: string[], workspacePath: string, signal: AbortSignal): Promise<VerificationResult> {
    const messages: string[] = [];

    for (const command of commands) {
      await this.touchLease(taskId);
      const result = await runShellCommand(command, workspacePath, signal);
      const message = `${command} -> exit ${result.exitCode}`;
      messages.push(message);
      await this.logCommandResult(taskId, attemptId, "verification.command", result);

      if (result.exitCode !== 0) {
        const failureSummary = `${command} failed.\n${truncate(result.combined, 6000)}`;
        return {
          ok: false,
          messages,
          failureSummary
        };
      }
    }

    return {
      ok: true,
      messages,
      failureSummary: null
    };
  }
}

function buildImplementationPrompt(contract: TaskContract, brief: { summary: string; implementation_notes: string[]; verification_commands: string[]; risk_checks: string[] }, repository: { id: string; install_command: string }) {
  return [
    "Implement the requested repository change.",
    `Repository profile: ${repository.id}`,
    `Goal: ${contract.goal}`,
    contract.business_context ? `Business context: ${contract.business_context}` : "",
    contract.scope_in.length > 0 ? `In scope:\n- ${contract.scope_in.join("\n- ")}` : "",
    contract.scope_out.length > 0 ? `Out of scope:\n- ${contract.scope_out.join("\n- ")}` : "",
    contract.constraints.length > 0 ? `Constraints:\n- ${contract.constraints.join("\n- ")}` : "",
    contract.acceptance_tests.length > 0 ? `Acceptance tests:\n- ${contract.acceptance_tests.join("\n- ")}` : "",
    brief.implementation_notes.length > 0 ? `Implementation notes:\n- ${brief.implementation_notes.join("\n- ")}` : "",
    brief.risk_checks.length > 0 ? `Risk checks:\n- ${brief.risk_checks.join("\n- ")}` : "",
    `Scheduler already ran install command: ${repository.install_command}`,
    `Scheduler will run verification commands later: ${brief.verification_commands.join(" | ")}`,
    "Focus on code changes and repository-safe edits only."
  ].filter(Boolean).join("\n\n");
}

function buildRepairPrompt(contract: TaskContract, failureSummary: string) {
  return [
    `The previous implementation for task "${contract.goal}" failed verification.`,
    "Fix only the issues needed to make verification pass.",
    "",
    failureSummary
  ].join("\n");
}

function summarizeCodexEvent(event: Record<string, any>): string {
  if (event.type === "item.completed" && event.item?.type === "agent_message") {
    return "Codex produced a structured response";
  }

  if (event.type === "item.completed" && event.item?.type === "command_execution") {
    return `Codex command finished: ${event.item.command}`;
  }

  return `Codex event: ${event.type}`;
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength)}\n...[truncated]`;
}
