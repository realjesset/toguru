import { spawn } from "node:child_process";
import { isWindows } from "../core/paths";
import { ToguruError } from "./errors";

/**
 * Run a child process with inherited stdio so the user interacts with it
 * directly, resolving with its exit code. A missing binary becomes a friendly
 * {@link ToguruError}.
 */
export function runAttached(command: string, args: string[], env?: NodeJS.ProcessEnv): Promise<number> {
  const { promise, resolve, reject } = Promise.withResolvers<number>();
  const child = spawn(command, args, {
    stdio: "inherit",
    env: env ?? process.env,
    // On Windows, CLIs are usually `.cmd` shims that require a shell.
    shell: isWindows,
  });
  child.on("error", (error) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      reject(new ToguruError(`Could not find "${command}" on your PATH.`, `Install the ${command} CLI and try again.`));
      return;
    }
    reject(error);
  });
  child.on("exit", (code, signal) => {
    resolve(code ?? (signal ? 128 : 1));
  });
  return promise;
}

/**
 * Like {@link runAttached}, but a non-zero exit is an error (used for
 * delegating to a provider's own `login` flow).
 */
export async function runInherit(command: string, args: string[], env?: NodeJS.ProcessEnv): Promise<void> {
  const code = await runAttached(command, args, env);
  if (code !== 0) {
    throw new ToguruError(`"${command} ${args.join(" ")}" exited with code ${code}.`);
  }
}
