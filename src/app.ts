import express from "express";

import { ConflictError } from "./lib/errors.js";
import { TaskStore } from "./db/task-store.js";
import { TaskIntakeService } from "./services/task-intake.js";
import { TaskQueue } from "./runtime/task-queue.js";
import type { RuntimeHealth } from "./services/runtime-diagnostics.js";

type AppDeps = {
  intakeService: TaskIntakeService;
  taskStore: TaskStore;
  taskQueue: TaskQueue;
  getHealthStatus?: () => RuntimeHealth;
};

export function createApp(deps: AppDeps) {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  app.get("/healthz", (_req, res) => {
    res.json(deps.getHealthStatus?.() ?? { ok: true });
  });

  app.post("/api/tasks", async (req, res, next) => {
    try {
      const task = await deps.intakeService.createTask(req.body);
      await deps.taskStore.logEvent(task.id, {
        attemptId: null,
        eventType: "task.created",
        level: "info",
        message: "Task created",
        payload: req.body
      });
      await deps.taskQueue.tick();
      res.status(201).json(task);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/tasks/:id", async (req, res) => {
    const task = await deps.taskStore.getTask(req.params.id);

    if (!task) {
      res.status(404).json({ error: "Task not found" });
      return;
    }

    res.json(task);
  });

  app.get("/api/tasks/:id/events", async (req, res) => {
    const task = await deps.taskStore.getTask(req.params.id);
    if (!task) {
      res.status(404).json({ error: "Task not found" });
      return;
    }

    const events = await deps.taskStore.listEvents(req.params.id);
    res.json(events);
  });

  app.post("/api/tasks/:id/cancel", async (req, res) => {
    const task = await deps.taskStore.cancelTask(req.params.id);
    deps.taskQueue.cancel(req.params.id);
    res.json(task);
  });

  app.post("/api/tasks/:id/retry", async (req, res) => {
    const task = await deps.taskStore.retryTask(req.params.id);
    await deps.taskQueue.tick();
    res.json(task);
  });

  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (error instanceof ConflictError) {
      res.status(409).json({ error: error.message });
      return;
    }

    if (error instanceof Error) {
      res.status(400).json({ error: error.message });
      return;
    }

    res.status(500).json({ error: "Unexpected error" });
  });

  return app;
}
