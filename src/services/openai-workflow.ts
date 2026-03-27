import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";

import type { RepositoryProfile } from "../config/types.js";
import { completionSummarySchema, executionBriefSchema, taskContractSchema, type CompletionSummary, type ExecutionBrief, type TaskContract, type TaskSource } from "../domain/task.js";

type NormalizeArgs = {
  conversationId: string;
  rawInput: string;
  repository: RepositoryProfile;
  source: TaskSource;
};

type PlanArgs = {
  conversationId: string;
  contract: TaskContract;
  repository: RepositoryProfile;
  branchName: string;
};

type SummaryArgs = {
  conversationId: string;
  contract: TaskContract;
  repository: RepositoryProfile;
  verificationResults: string[];
  deliveryArtifacts: string[];
  outcome: CompletionSummary["outcome"];
  fallbackSummary: string;
};

export class OpenAIWorkflowService {
  constructor(
    private readonly client: OpenAI | null,
    private readonly defaultModel: string
  ) {}

  async ensureConversation(existingId: string | null, metadata: Record<string, string>): Promise<string> {
    if (existingId) {
      return existingId;
    }

    if (!this.client) {
      return `local-conv-${Date.now()}`;
    }

    const conversation = await this.client.conversations.create({
      metadata
    });

    return conversation.id;
  }

  async normalizeTask(args: NormalizeArgs): Promise<TaskContract> {
    if (!this.client) {
      return taskContractSchema.parse({
        source: args.source,
        goal: args.rawInput.split("\n")[0] ?? args.rawInput,
        business_context: "",
        scope_in: [],
        scope_out: [],
        constraints: [
          `Target repository profile: ${args.repository.id}`
        ],
        files_hint: [],
        acceptance_tests: [],
        delivery: ["pull_request"]
      });
    }

    const response = await this.client.responses.parse({
      model: this.defaultModel,
      conversation: args.conversationId,
      store: true,
      instructions: "You normalize incoming software requests into a strict task contract for an automated coding scheduler.",
      input: buildNormalizationPrompt(args.rawInput, args.repository, args.source),
      text: {
        format: zodTextFormat(taskContractSchema, "task_contract")
      }
    });

    return taskContractSchema.parse(response.output_parsed);
  }

  async createExecutionBrief(args: PlanArgs): Promise<ExecutionBrief> {
    if (!this.client) {
      return executionBriefSchema.parse({
        title: args.contract.goal,
        summary: args.contract.goal,
        branch_name: args.branchName,
        implementation_notes: args.contract.scope_in,
        verification_commands: args.repository.verify_commands,
        delivery_targets: args.contract.delivery,
        risk_checks: args.contract.constraints
      });
    }

    const response = await this.client.responses.parse({
      model: this.defaultModel,
      conversation: args.conversationId,
      store: true,
      instructions: "You prepare execution briefs for an automated coding agent. Keep the plan short, precise, and directly actionable.",
      input: buildPlanningPrompt(args.contract, args.repository, args.branchName),
      text: {
        format: zodTextFormat(executionBriefSchema, "execution_brief")
      }
    });

    return executionBriefSchema.parse(response.output_parsed);
  }

  async summarizeCompletion(args: SummaryArgs): Promise<CompletionSummary> {
    if (!this.client) {
      return completionSummarySchema.parse({
        outcome: args.outcome,
        summary: args.fallbackSummary,
        key_changes: args.contract.scope_in,
        verification_results: args.verificationResults,
        delivery_artifacts: args.deliveryArtifacts
      });
    }

    const response = await this.client.responses.parse({
      model: this.defaultModel,
      conversation: args.conversationId,
      store: true,
      instructions: "You summarize the outcome of an automated coding task for operators and product teams.",
      input: buildSummaryPrompt(args),
      text: {
        format: zodTextFormat(completionSummarySchema, "completion_summary")
      }
    });

    return completionSummarySchema.parse(response.output_parsed);
  }
}

function buildNormalizationPrompt(rawInput: string, repository: RepositoryProfile, source: TaskSource): string {
  return [
    `Source: ${source}`,
    `Repository profile id: ${repository.id}`,
    `Repository mode: ${repository.mode}`,
    `Default branch: ${repository.default_branch}`,
    "Normalize the request below into a strict JSON task contract for automated implementation.",
    "Do not invent unavailable business facts. Use empty arrays or empty strings when needed.",
    "",
    rawInput
  ].join("\n");
}

function buildPlanningPrompt(contract: TaskContract, repository: RepositoryProfile, branchName: string): string {
  return [
    `Repository profile id: ${repository.id}`,
    `Repository mode: ${repository.mode}`,
    `Default branch: ${repository.default_branch}`,
    `Install command: ${repository.install_command}`,
    `Verification commands: ${repository.verify_commands.join(" | ")}`,
    `Delivery targets: ${contract.delivery.join(", ")}`,
    `Branch name: ${branchName}`,
    "",
    "Create a concise execution brief for Codex and the scheduler.",
    JSON.stringify(contract, null, 2)
  ].join("\n");
}

function buildSummaryPrompt(args: SummaryArgs): string {
  return [
    `Outcome: ${args.outcome}`,
    `Repository profile id: ${args.repository.id}`,
    `Fallback summary: ${args.fallbackSummary}`,
    `Verification results: ${args.verificationResults.join(" | ")}`,
    `Delivery artifacts: ${args.deliveryArtifacts.join(" | ")}`,
    "",
    JSON.stringify(args.contract, null, 2)
  ].join("\n");
}
