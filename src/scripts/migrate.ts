import path from "node:path";

import { bootstrapDatabase } from "../db/bootstrap.js";
import { createDatabase } from "../db/client.js";

const databasePath = path.resolve(process.cwd(), process.env.SCHEDULER_SQLITE_PATH ?? "./data/scheduler.db");
const { sqlite } = createDatabase(databasePath);

bootstrapDatabase(sqlite);

console.log(`Database bootstrapped at ${databasePath}`);
