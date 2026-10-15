import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

/** `security -i` reads one command per line; longer lines fall back to argv. */
const STDIN_LINE_LIMIT = 4032;

/**
 * Read a generic password from the macOS login keychain. Returns `null` when
 * the item does not exist. macOS only — callers must guard with `isMac`.
 */
export async function keychainGet(service: string, account: string): Promise<string | null> {
  try {
    const { stdout } = await run("security", ["find-generic-password", "-s", service, "-a", account, "-w"]);
    const value = stdout.trim();
    return value.length > 0 ? value : null;
  } catch {
    // Non-zero exit means the item is absent.
    return null;
  }
}

/**
 * Create or update (`-U`) a generic password in the macOS login keychain, the
 * same way Claude Code does: hex-encoded (`-X`) and fed to `security -i` on
 * stdin so the secret never appears in the process list.
 */
export async function keychainSet(service: string, value: string, account: string): Promise<void> {
  const hex = Buffer.from(value, "utf8").toString("hex");
  const line = `add-generic-password -U -a "${account}" -s "${service}" -X "${hex}"\n`;
  if (line.length > STDIN_LINE_LIMIT) {
    await run("security", ["add-generic-password", "-U", "-a", account, "-s", service, "-X", hex]);
    return;
  }
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  const child = execFile("security", ["-i"], (error, _stdout, stderr) => {
    // A failed command inside `security -i` reports on stderr.
    if (error || stderr.trim()) {
      reject(error ?? new Error(`security: ${stderr.trim()}`));
      return;
    }
    resolve();
  });
  child.stdin?.end(line);
  await promise;
}

/** Delete a generic password; a missing item is not an error. */
export async function keychainDelete(service: string, account: string): Promise<void> {
  try {
    await run("security", ["delete-generic-password", "-s", service, "-a", account]);
  } catch {
    // Already gone.
  }
}
