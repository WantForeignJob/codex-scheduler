import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export type CodexAuthMode = "api_key" | "chatgpt_login" | "missing";
export type ResponsesAuthMode = "api_key" | "local_fallback";

export type RuntimeHealth = {
  ok: true;
  auth: {
    codex: {
      available: boolean;
      mode: CodexAuthMode;
      binaryPresent: boolean;
      authFileDetected: boolean;
    };
    responses: {
      available: boolean;
      mode: ResponsesAuthMode;
    };
  };
  capabilities: {
    code_execution: "codex" | "unavailable";
    workflow_orchestration: "responses_api" | "local_fallback";
  };
};

type RuntimeHealthOptions = {
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
};

export function detectRuntimeHealth(projectRoot: string, options: RuntimeHealthOptions = {}): RuntimeHealth {
  const env = options.env ?? process.env;
  const homeDir = options.homeDir ?? os.homedir();
  const codexBinaryPath = path.join(projectRoot, "node_modules", ".bin", process.platform === "win32" ? "codex.cmd" : "codex");
  const authFilePath = path.join(homeDir, ".codex", "auth.json");
  const binaryPresent = existsSync(codexBinaryPath);
  const authFileDetected = existsSync(authFilePath);
  const hasApiKey = Boolean(env.OPENAI_API_KEY);

  const codexMode: CodexAuthMode = hasApiKey
    ? "api_key"
    : authFileDetected
      ? "chatgpt_login"
      : "missing";

  const codexAvailable = binaryPresent && codexMode !== "missing";
  const responsesAvailable = hasApiKey;

  return {
    ok: true,
    auth: {
      codex: {
        available: codexAvailable,
        mode: codexMode,
        binaryPresent,
        authFileDetected
      },
      responses: {
        available: responsesAvailable,
        mode: responsesAvailable ? "api_key" : "local_fallback"
      }
    },
    capabilities: {
      code_execution: codexAvailable ? "codex" : "unavailable",
      workflow_orchestration: responsesAvailable ? "responses_api" : "local_fallback"
    }
  };
}
