import { mkdirSync } from "node:fs";
import path from "node:path";

export function ensureDirectory(directoryPath: string): string {
  mkdirSync(directoryPath, { recursive: true });
  return directoryPath;
}

export function resolveReportDirectory(root: string, taskId: string): string {
  return ensureDirectory(path.join(root, taskId));
}
