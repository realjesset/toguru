import { execFile } from "node:child_process";
import os from "node:os";
import { promisify } from "node:util";

const run = promisify(execFile);

/** macOS keychain account name used by Claude Code (the OS short username). */
function defaultAccount(): string {
  return os.userInfo().username;
}

/**
 * Read a generic password from the macOS login keychain. Returns `null` when
 * the item does not exist. macOS only — callers must guard with `isMac`.
 */
export async function keychainGet(service: string, account = defaultAccount()): Promise<string | null> {
  try {
    const { stdout } = await run("security", [
      "find-generic-password",
      "-s",
      service,
      "-a",
      account,
      "-w",
    ]);
    const value = stdout.trim();
    return value.length > 0 ? value : null;
  } catch {
    // Non-zero exit means the item is absent.
    return null;
  }
}

/**
 * Create or update a generic password in the macOS login keychain. The `-U`
 * flag updates the entry in place when it already exists.
 */
export async function keychainSet(service: string, value: string, account = defaultAccount()): Promise<void> {
  await run("security", [
    "add-generic-password",
    "-U",
    "-s",
    service,
    "-a",
    account,
    "-w",
    value,
  ]);
}
