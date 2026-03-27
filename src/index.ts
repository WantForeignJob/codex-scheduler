import path from "node:path";

import OpenAI from "openai";

import { createApp } from "./app.js";
import { loadSchedulerConfig } from "./config/load-config.js";
import { bootstrapDatabase } from "./db/bootstrap.js";
import { createDatabase } from "./db/client.js";
import { TaskStore } from "./db/task-store.js";
import { createLogger } from "./lib/logger.js";
import { LinearPoller } from "./runtime/linear-poller.js";
import { TaskQueue } from "./runtime/task-queue.js";
import { TaskRunner } from "./runtime/task-runner.js";
import { CodexExecutionService } from "./services/codex-execution.js";
import { DeliveryService } from "./services/delivery-service.js";
import { LinearGateway } from "./services/linear-gateway.js";
import { OpenAIWorkflowService } from "./services/openai-workflow.js";
import { detectRuntimeHealth } from "./services/runtime-diagnostics.js";
import { TaskIntakeService } from "./services/task-intake.js";
import { WorkspaceManager } from "./services/workspace-manager.js";

const rootDir = process.cwd();
const logger = createLogger();
const config = loadSchedulerConfig(path.join(rootDir, "config", "scheduler.config.toml"));
const { sqlite, db } = createDatabase(config.sqlite_path);
bootstrapDatabase(sqlite);

const openaiClient = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
const taskStore = new TaskStore(db);
const openaiWorkflow = new OpenAIWorkflowService(openaiClient, config.default_model);
const codexExecution = new CodexExecutionService(rootDir, process.env.OPENAI_API_KEY, process.env.OPENAI_BASE_URL);
const workspaceManager = new WorkspaceManager(config.workspace_root);
const deliveryService = new DeliveryService(process.env.GITHUB_TOKEN);
const linearGateway = new LinearGateway(process.env.LINEAR_API_KEY);
const intakeService = new TaskIntakeService(config, taskStore, openaiWorkflow);

const queue = new TaskQueue(
  taskStore,
  (workerId) =>
    new TaskRunner({
      config,
      taskStore,
      openaiWorkflow,
      codexExecution,
      workspaceManager,
      deliveryService,
      linearGateway,
      logger,
      workerId,
      leaseMs: 5 * 60 * 1000
    }),
  config.worker_concurrency,
  1_000,
  5 * 60 * 1000,
  logger
);

const poller = new LinearPoller(config, linearGateway, intakeService, logger);
const app = createApp({
  intakeService,
  taskStore,
  taskQueue: queue,
  getHealthStatus: () => detectRuntimeHealth(rootDir)
});

const server = app.listen(config.port, config.host, () => {
  logger.info({ health: detectRuntimeHealth(rootDir) }, "Runtime auth status");
  logger.info({ host: config.host, port: config.port }, "Codex scheduler listening");
  queue.start();
  poller.start();
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    logger.info({ signal }, "Shutting down");
    poller.stop();
    queue.stop();
    server.close(() => {
      sqlite.close();
      process.exit(0);
    });
  });
}
