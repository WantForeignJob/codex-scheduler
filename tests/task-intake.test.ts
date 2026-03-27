import { TaskStore } from "../src/db/task-store.js";
import { OpenAIWorkflowService } from "../src/services/openai-workflow.js";
import { TaskIntakeService } from "../src/services/task-intake.js";
import { cleanupDir, createTempDir, createTestConfig, createTestDatabase } from "./helpers.js";

describe("TaskIntakeService", () => {
  it("deduplicates linear issues by external ref", async () => {
    const rootDir = createTempDir("codex-scheduler-intake-");

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
      const workflow = new OpenAIWorkflowService(null, "gpt-5.4");
      const intake = new TaskIntakeService(config, store, workflow);

      const created = await intake.createTaskFromLinearCandidate({
        issueId: "issue-1",
        identifier: "ENG-1",
        title: "ENG-1 Test",
        rawInput: "Hello",
        repositoryId: "repo-1",
        metadata: {}
      });
      const duplicate = await intake.createTaskFromLinearCandidate({
        issueId: "issue-1",
        identifier: "ENG-1",
        title: "ENG-1 Test",
        rawInput: "Hello",
        repositoryId: "repo-1",
        metadata: {}
      });

      expect(created).not.toBeNull();
      expect(duplicate).toBeNull();
      sqlite.close();
    } finally {
      cleanupDir(rootDir);
    }
  });
});
