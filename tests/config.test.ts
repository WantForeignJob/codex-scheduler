import { writeFileSync } from "node:fs";
import path from "node:path";

import { loadSchedulerConfig } from "../src/config/load-config.js";
import { cleanupDir, createTempDir } from "./helpers.js";

describe("loadSchedulerConfig", () => {
  it("parses toml and resolves relative paths", () => {
    const rootDir = createTempDir("codex-scheduler-config-");

    try {
      const configPath = path.join(rootDir, "scheduler.config.toml");
      writeFileSync(
        configPath,
        [
          'workspace_root = "./workspaces"',
          'report_root = "./reports"',
          'sqlite_path = "./data/scheduler.db"',
          "",
          "[[repositories]]",
          'id = "local"',
          'name = "Local"',
          'mode = "local"',
          'local_path = "./target-repo"',
          'default_branch = "main"',
          'install_command = "pnpm install"',
          'verify_commands = ["pnpm test"]',
          "allow_network = true"
        ].join("\n"),
        "utf8"
      );

      const config = loadSchedulerConfig(configPath);

      expect(config.workspace_root).toBe(path.join(rootDir, "workspaces"));
      expect(config.report_root).toBe(path.join(rootDir, "reports"));
      expect(config.sqlite_path).toBe(path.join(rootDir, "data", "scheduler.db"));
      expect(config.repositories[0]).toMatchObject({
        id: "local",
        mode: "local",
        local_path: path.join(rootDir, "target-repo")
      });
    } finally {
      cleanupDir(rootDir);
    }
  });
});
