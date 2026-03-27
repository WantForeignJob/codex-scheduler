import { spawn } from "node:child_process";

export type CommandResult = {
  command: string;
  cwd: string;
  stdout: string;
  stderr: string;
  combined: string;
  exitCode: number;
};

export async function runShellCommand(command: string, cwd: string, signal?: AbortSignal): Promise<CommandResult> {
  return new Promise<CommandResult>((resolve, reject) => {
    const child = spawn(command, {
      cwd,
      shell: true,
      env: process.env
    });

    let stdout = "";
    let stderr = "";

    const onAbort = () => {
      child.kill();
      reject(new Error(`Command aborted: ${command}`));
    };

    if (signal) {
      if (signal.aborted) {
        onAbort();
        return;
      }

      signal.addEventListener("abort", onAbort, { once: true });
    }

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      signal?.removeEventListener("abort", onAbort);
      reject(error);
    });

    child.on("close", (code) => {
      signal?.removeEventListener("abort", onAbort);
      resolve({
        command,
        cwd,
        stdout,
        stderr,
        combined: `${stdout}${stderr}`,
        exitCode: code ?? 1
      });
    });
  });
}

export async function runProcess(command: string, args: string[], cwd: string, signal?: AbortSignal): Promise<CommandResult> {
  return new Promise<CommandResult>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env
    });

    let stdout = "";
    let stderr = "";

    const onAbort = () => {
      child.kill();
      reject(new Error(`Command aborted: ${command} ${args.join(" ")}`));
    };

    if (signal) {
      if (signal.aborted) {
        onAbort();
        return;
      }

      signal.addEventListener("abort", onAbort, { once: true });
    }

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      signal?.removeEventListener("abort", onAbort);
      reject(error);
    });

    child.on("close", (code) => {
      signal?.removeEventListener("abort", onAbort);
      resolve({
        command: `${command} ${args.join(" ")}`.trim(),
        cwd,
        stdout,
        stderr,
        combined: `${stdout}${stderr}`,
        exitCode: code ?? 1
      });
    });
  });
}
