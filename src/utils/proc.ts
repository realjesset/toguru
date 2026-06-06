import { spawn } from "node:child_process";
import { isWindows } from "../core/paths";
import { ToguruError } from "./errors";

/**
 * Run a child process with inherited stdio so the user interacts with it
 * directly (used for delegating to a provider's own `login` flow). Resolves on a
 * zero exit code, rejects otherwise.
 */
export function runInherit(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      // On Windows, CLIs are usually `.cmd` shims that require a shell.
      shell: isWindows,
    });
    child.on("error", (error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        reject(
          new ToguruError(
            `Could not find "${command}" on your PATH.`,
            `Install the ${command} CLI and try again.`,
          ),
        );
        return;
      }
      reject(error);
    });
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new ToguruError(`"${command} ${args.join(" ")}" exited with code ${code ?? "unknown"}.`));
    });
  });
}
