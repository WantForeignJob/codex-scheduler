import request from "supertest";

import { createApp } from "../src/app.js";
import { TaskStore } from "../src/db/task-store.js";
import { TaskQueue } from "../src/runtime/task-queue.js";
import type { RuntimeHealth } from "../src/services/runtime-diagnostics.js";
import { OpenAIWorkflowService } from "../src/services/openai-workflow.js";
import { TaskIntakeService } from "../src/services/task-intake.js";
import { cleanupDir, createTempDir, createTestConfig, createTestDatabase } from "./helpers.js";

describe("HTTP API", () => {
  it("creates and fetches tasks", async () => {
    const rootDir = createTempDir("codex-scheduler-app-");

    try {
      const config = createTestConfig(rootDir);
      config.repositories.push({
        id: "repo-1",
        name: "Repo",
        mode: "local",
        local_path: rootDir,
        default_branch: "main",
        install_command: 'node -e "process.exit(0)"',
        verify_commands: ['node -e "process.exit(0)"'],
        allow_network: false,
        linear_rules: {
          team_keys: [],
          project_names: [],
          labels: []
        }
      });

      const { sqlite, db } = createTestDatabase(rootDir);
      const store = new TaskStore(db);
      const intake = new TaskIntakeService(config, store, new OpenAIWorkflowService(null, config.default_model));
      const queue = {
        tick: async () => {},
        cancel: () => {}
      } as unknown as TaskQueue;

      const app = createApp({
        intakeService: intake,
        taskStore: store,
        taskQueue: queue,
        getHealthStatus: (): RuntimeHealth => ({
          ok: true,
          auth: {
            codex: {
              available: true,
              mode: "chatgpt_login",
              binaryPresent: true,
              authFileDetected: true
            },
            responses: {
              available: false,
              mode: "local_fallback"
            }
          },
          capabilities: {
            code_execution: "codex",
            workflow_orchestration: "local_fallback"
          }
        })
      });

      const health = await request(app)
        .get("/healthz")
        .expect(200);

      expect(health.body.auth.codex.mode).toBe("chatgpt_login");
      expect(health.body.auth.responses.mode).toBe("local_fallback");

      const created = await request(app)
        .post("/api/tasks")
        .send({
          repositoryId: "repo-1",
          source: "api",
          rawInput: "Implement a feature"
        })
        .expect(201);

      expect(created.body.state).toBe("queued");

      const fetched = await request(app)
        .get(`/api/tasks/${created.body.id}`)
        .expect(200);

      expect(fetched.body.id).toBe(created.body.id);
      sqlite.close();
    } finally {
      cleanupDir(rootDir);
    }
  });
});
