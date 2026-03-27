import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { detectRuntimeHealth } from "../src/services/runtime-diagnostics.js";
import { cleanupDir, createTempDir } from "./helpers.js";

describe("runtime diagnostics", () => {
  it("detects ChatGPT-backed Codex auth without an API key", () => {
    const rootDir = createTempDir("codex-scheduler-health-");
    const homeDir = path.join(rootDir, "home");
    const codexBinDir = path.join(rootDir, "node_modules", ".bin");
    const authDir = path.join(homeDir, ".codex");

    try {
      mkdirSync(codexBinDir, { recursive: true });
      mkdirSync(authDir, { recursive: true });
      writeFileSync(path.join(codexBinDir, process.platform === "win32" ? "codex.cmd" : "codex"), "echo codex", "utf8");
      writeFileSync(path.join(authDir, "auth.json"), "{\"provider\":\"chatgpt\"}", "utf8");

      const health = detectRuntimeHealth(rootDir, {
        env: {},
        homeDir
      });

      expect(health.auth.codex.available).toBe(true);
      expect(health.auth.codex.mode).toBe("chatgpt_login");
      expect(health.auth.responses.mode).toBe("local_fallback");
      expect(health.capabilities.code_execution).toBe("codex");
    } finally {
      cleanupDir(rootDir);
    }
  });

  it("prefers API-key mode when OPENAI_API_KEY is present", () => {
    const rootDir = createTempDir("codex-scheduler-health-key-");
    const codexBinDir = path.join(rootDir, "node_modules", ".bin");

    try {
      mkdirSync(codexBinDir, { recursive: true });
      writeFileSync(path.join(codexBinDir, process.platform === "win32" ? "codex.cmd" : "codex"), "echo codex", "utf8");

      const health = detectRuntimeHealth(rootDir, {
        env: {
          OPENAI_API_KEY: "test-key"
        }
      });

      expect(health.auth.codex.mode).toBe("api_key");
      expect(health.auth.responses.mode).toBe("api_key");
      expect(health.capabilities.workflow_orchestration).toBe("responses_api");
    } finally {
      cleanupDir(rootDir);
    }
  });
});
