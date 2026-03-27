import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { Octokit } from "@octokit/rest";

import type { RepositoryProfile } from "../config/types.js";
import { runProcess, runShellCommand } from "../lib/command-runner.js";
import { resolveReportDirectory } from "../lib/paths.js";

type DeliveryArgs = {
  taskId: string;
  title: string;
  workspacePath: string;
  repository: RepositoryProfile;
  branchName: string;
  reportRoot: string;
  commitMessage: string;
  prTitle: string;
  prBody: string;
  gitleaksCommand: string;
  signal?: AbortSignal;
};

export type DeliveryResult = {
  outcome: "completed" | "completed_without_changes" | "blocked_sensitive_review";
  reportPath: string;
  diffPath: string | null;
  commitSha: string | null;
  prNumber: number | null;
  prUrl: string | null;
  artifacts: string[];
};

export class DeliveryService {
  private readonly octokit: Octokit | null;

  constructor(githubToken: string | undefined) {
    this.octokit = githubToken ? new Octokit({ auth: githubToken }) : null;
  }

  async deliver(args: DeliveryArgs): Promise<DeliveryResult> {
    const reportDirectory = resolveReportDirectory(args.reportRoot, args.taskId);
    mkdirSync(reportDirectory, { recursive: true });
    const diffPath = path.join(reportDirectory, "changes.patch");
    const reportPath = path.join(reportDirectory, "delivery.md");

    const gitleaks = await runShellCommand(args.gitleaksCommand, args.workspacePath, args.signal);

    if (gitleaks.exitCode !== 0 && gitleaks.exitCode !== 1) {
      throw new Error(`Gitleaks failed: ${gitleaks.combined}`);
    }

    if (gitleaks.exitCode === 1) {
      writeFileSync(reportPath, `# Delivery blocked\n\nSensitive content detected.\n\n\`\`\`\n${gitleaks.combined}\n\`\`\`\n`, "utf8");
      return {
        outcome: "blocked_sensitive_review",
        reportPath,
        diffPath: null,
        commitSha: null,
        prNumber: null,
        prUrl: null,
        artifacts: [reportPath]
      };
    }

    const status = await runProcess("git", ["status", "--porcelain"], args.workspacePath, args.signal);
    const hasChanges = status.stdout.trim().length > 0;

    if (!hasChanges) {
      writeFileSync(reportPath, "# Delivery result\n\nNo file changes were produced.\n", "utf8");
      return {
        outcome: "completed_without_changes",
        reportPath,
        diffPath: null,
        commitSha: null,
        prNumber: null,
        prUrl: null,
        artifacts: [reportPath]
      };
    }

    const diffResult = await runProcess("git", ["diff", "--binary"], args.workspacePath, args.signal);
    writeFileSync(diffPath, diffResult.stdout, "utf8");

    await runProcess("git", ["add", "-A"], args.workspacePath, args.signal);
    await runProcess("git", ["commit", "-m", args.commitMessage], args.workspacePath, args.signal);
    const shaResult = await runProcess("git", ["rev-parse", "HEAD"], args.workspacePath, args.signal);
    const commitSha = shaResult.stdout.trim();

    let prNumber: number | null = null;
    let prUrl: string | null = null;

    if (args.repository.mode === "github") {
      await runProcess("git", ["push", "-u", "origin", args.branchName], args.workspacePath, args.signal);
      const parsedRepo = parseGitHubRepo(args.repository.clone_url);

      if (parsedRepo && this.octokit) {
        const response = await this.octokit.pulls.create({
          owner: parsedRepo.owner,
          repo: parsedRepo.repo,
          head: args.branchName,
          base: args.repository.default_branch,
          title: args.prTitle,
          body: args.prBody
        });
        prNumber = response.data.number;
        prUrl = response.data.html_url;
      }
    }

    writeFileSync(
      reportPath,
      [
        "# Delivery result",
        "",
        `Commit: ${commitSha}`,
        prUrl ? `PR: ${prUrl}` : "PR: not created",
        `Patch: ${diffPath}`
      ].join("\n"),
      "utf8"
    );

    const artifacts = [reportPath, diffPath];
    if (prUrl) {
      artifacts.push(prUrl);
    }

    return {
      outcome: "completed",
      reportPath,
      diffPath,
      commitSha,
      prNumber,
      prUrl,
      artifacts
    };
  }
}

function parseGitHubRepo(cloneUrl: string): { owner: string; repo: string } | null {
  const normalized = cloneUrl.replace(/\.git$/, "");
  const httpsMatch = normalized.match(/github\.com[:/](?<owner>[^/]+)\/(?<repo>[^/]+)$/i);

  if (!httpsMatch?.groups) {
    return null;
  }

  return {
    owner: httpsMatch.groups.owner,
    repo: httpsMatch.groups.repo
  };
}
