import { createRequire } from "node:module";
import path from "node:path";

import { Codex, type ThreadEvent, type ThreadItem, type Usage } from "@openai/codex-sdk";

type RunCodexTurnArgs = {
  workspacePath: string;
  model: string;
  allowNetwork: boolean;
  prompt: string;
  threadId?: string | null;
  signal?: AbortSignal;
  onEvent?: (event: ThreadEvent) => Promise<void> | void;
};

type RunCodexTurnResult = {
  threadId: string;
  finalResponse: string;
  usage: Usage | null;
  items: ThreadItem[];
};

const codexStructuredResultSchema = {
  type: "object",
  properties: {
    summary: { type: "string" },
    key_files: {
      type: "array",
      items: { type: "string" }
    },
    next_action: { type: "string" }
  },
  required: ["summary", "key_files", "next_action"],
  additionalProperties: false
} as const;

export class CodexExecutionService {
  private readonly codex: Codex;

  constructor(projectRoot: string, apiKey: string | undefined, baseUrl?: string) {
    this.codex = new Codex({
      apiKey,
      baseUrl,
      codexPathOverride: resolveProjectCodexBinary(projectRoot)
    });
  }

  async runTurn(args: RunCodexTurnArgs): Promise<RunCodexTurnResult> {
    const thread = args.threadId
      ? this.codex.resumeThread(args.threadId, buildThreadOptions(args))
      : this.codex.startThread(buildThreadOptions(args));

    const streamed = await thread.runStreamed(args.prompt, {
      outputSchema: codexStructuredResultSchema,
      signal: args.signal
    });

    const items: ThreadItem[] = [];
    let finalResponse = "";
    let usage: Usage | null = null;
    let threadId = args.threadId ?? "";

    for await (const event of streamed.events) {
      if (event.type === "thread.started") {
        threadId = event.thread_id;
      }

      if (event.type === "item.completed") {
        items.push(event.item);
        if (event.item.type === "agent_message") {
          finalResponse = event.item.text;
        }
      }

      if (event.type === "turn.completed") {
        usage = event.usage;
      }

      await args.onEvent?.(event);
    }

    if (!threadId && thread.id) {
      threadId = thread.id;
    }

    if (!threadId) {
      throw new Error("Codex thread did not report an id");
    }

    return {
      threadId,
      finalResponse,
      usage,
      items
    };
  }
}

function buildThreadOptions(args: RunCodexTurnArgs) {
  return {
    model: args.model,
    workingDirectory: args.workspacePath,
    sandboxMode: "workspace-write" as const,
    approvalPolicy: "never" as const,
    networkAccessEnabled: args.allowNetwork,
    webSearchMode: "disabled" as const
  };
}

function resolveProjectCodexBinary(projectRoot: string): string {
  const projectRequire = createRequire(path.join(projectRoot, "package.json"));
  const codexPackageJsonPath = projectRequire.resolve("@openai/codex/package.json");
  const codexRequire = createRequire(codexPackageJsonPath);
  const platformPackage = getPlatformPackage();
  const platformPackageJsonPath = codexRequire.resolve(`${platformPackage.packageName}/package.json`);

  return path.join(
    path.dirname(platformPackageJsonPath),
    "vendor",
    platformPackage.targetTriple,
    "codex",
    process.platform === "win32" ? "codex.exe" : "codex"
  );
}

function getPlatformPackage(): { packageName: string; targetTriple: string } {
  if (process.platform === "win32" && process.arch === "x64") {
    return {
      packageName: "@openai/codex-win32-x64",
      targetTriple: "x86_64-pc-windows-msvc"
    };
  }

  if (process.platform === "win32" && process.arch === "arm64") {
    return {
      packageName: "@openai/codex-win32-arm64",
      targetTriple: "aarch64-pc-windows-msvc"
    };
  }

  if ((process.platform === "linux" || process.platform === "android") && process.arch === "x64") {
    return {
      packageName: "@openai/codex-linux-x64",
      targetTriple: "x86_64-unknown-linux-musl"
    };
  }

  if ((process.platform === "linux" || process.platform === "android") && process.arch === "arm64") {
    return {
      packageName: "@openai/codex-linux-arm64",
      targetTriple: "aarch64-unknown-linux-musl"
    };
  }

  if (process.platform === "darwin" && process.arch === "x64") {
    return {
      packageName: "@openai/codex-darwin-x64",
      targetTriple: "x86_64-apple-darwin"
    };
  }

  if (process.platform === "darwin" && process.arch === "arm64") {
    return {
      packageName: "@openai/codex-darwin-arm64",
      targetTriple: "aarch64-apple-darwin"
    };
  }

  throw new Error(`Unsupported platform for Codex binary resolution: ${process.platform} (${process.arch})`);
}
