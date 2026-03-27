import { LinearClient } from "@linear/sdk";

import type { RepositoryProfile, SchedulerConfig } from "../config/types.js";

export type LinearTaskCandidate = {
  issueId: string;
  identifier: string;
  title: string;
  rawInput: string;
  repositoryId: string;
  metadata: Record<string, string>;
};

export class LinearGateway {
  private readonly client: LinearClient | null;

  constructor(apiKey: string | undefined) {
    this.client = apiKey ? new LinearClient({ apiKey }) : null;
  }

  isEnabled(): boolean {
    return this.client !== null;
  }

  async poll(config: SchedulerConfig): Promise<LinearTaskCandidate[]> {
    if (!this.client) {
      return [];
    }

    const connection = await this.client.issues({ first: 100 });
    const issues = (connection?.nodes ?? []) as unknown[];
    const candidates: LinearTaskCandidate[] = [];

    for (const rawIssue of issues) {
      const issue = rawIssue as Record<string, any>;
      if (issue.archivedAt || issue.completedAt || issue.canceledAt) {
        continue;
      }

      for (const repository of config.repositories) {
        if (await matchesRepositoryRules(repository, issue)) {
          candidates.push({
            issueId: issue.id,
            identifier: issue.identifier,
            title: `${issue.identifier} ${issue.title}`,
            rawInput: renderIssuePrompt(issue),
            repositoryId: repository.id,
            metadata: {
              linearIssueId: issue.id,
              linearIdentifier: issue.identifier,
              linearUrl: issue.url
            }
          });
        }
      }
    }

    return candidates;
  }

  async addComment(issueId: string, body: string): Promise<void> {
    if (!this.client) {
      return;
    }

    await this.client.createComment({ issueId, body } as any);
  }

  async syncMappedState(issueId: string, repository: RepositoryProfile, target: "in_progress" | "done" | "failed"): Promise<void> {
    if (!this.client || !repository.linear_statuses?.[target]) {
      return;
    }

    const issue = await this.client.issue(issueId);
    const team = issue?.team ? await issue.team : null;
    const statesConnection = team?.states ? await team.states() : null;
    const states = (statesConnection?.nodes ?? []) as Array<Record<string, any>>;
    const desiredName = repository.linear_statuses[target];
    const desired = states.find((state) => state.name === desiredName);

    if (!desired?.id) {
      return;
    }

    await this.client.updateIssue(issueId, { stateId: desired.id } as any);
  }
}

function renderIssuePrompt(issue: Record<string, any>): string {
  return [
    `Linear issue: ${issue.identifier}`,
    `Title: ${issue.title}`,
    `URL: ${issue.url}`,
    "",
    issue.description ?? ""
  ].join("\n");
}

async function matchesRepositoryRules(repository: RepositoryProfile, issue: Record<string, any>): Promise<boolean> {
  const rules = repository.linear_rules;
  const team = issue.team ? await issue.team : null;
  const project = issue.project ? await issue.project : null;
  const labelsConnection = issue.labels ? await issue.labels() : null;
  const labels = (labelsConnection?.nodes ?? []) as Array<Record<string, any>>;
  const labelNames = new Set(labels.map((label) => label.name));

  if (rules.team_keys.length > 0 && !rules.team_keys.includes(team?.key)) {
    return false;
  }

  if (rules.project_names.length > 0 && !rules.project_names.includes(project?.name)) {
    return false;
  }

  if (rules.labels.length > 0 && !rules.labels.some((label) => labelNames.has(label))) {
    return false;
  }

  return true;
}
