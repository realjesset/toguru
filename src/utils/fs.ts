import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { isWindows } from "../core/paths";
import { ToguruError } from "./errors";

const SECRET_MODE = 0o600;

/**
 * Read and parse a JSON file. Returns `null` when the file does not exist and
 * throws a {@link ToguruError} naming the file when it is not valid JSON.
 */
export async function readJson<T>(file: string): Promise<T | null> {
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new ToguruError(
      `${file} is not valid JSON.`,
      "Fix or move the file aside, then try again.",
    );
  }
}

/**
 * Resolve the file a write should land on. A symlinked target (dotfile
 * managers do this) is written through, so the link itself survives.
 */
async function writeTarget(file: string): Promise<string> {
  try {
    return await fs.realpath(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return file;
    }
    throw error;
  }
}

/**
 * Write JSON atomically (write to a temp file, then rename) so a crash mid-write
 * never corrupts the target. Files are created with `0600` permissions because
 * they hold credentials. Symlinks are written through, not replaced.
 */
export async function writeJson(file: string, data: unknown): Promise<void> {
  const target = await writeTarget(file);
  await fs.mkdir(path.dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  const content = `${JSON.stringify(data, null, 2)}\n`;
  try {
    await fs.writeFile(tmp, content, { mode: SECRET_MODE });
    await fs.rename(tmp, target);
  } catch (error) {
    await fs.rm(tmp, { force: true });
    throw error;
  }
  if (!isWindows) {
    try {
      await fs.chmod(target, SECRET_MODE);
    } catch {
      // best effort: some filesystems (e.g. mounted shares) reject chmod
    }
  }
}

/** True when a path exists and is accessible. */
export async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}
