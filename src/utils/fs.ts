import fs from "node:fs/promises";
import path from "node:path";
import { isWindows } from "../core/paths";

const SECRET_MODE = 0o600;

/** Read and parse a JSON file. Returns `null` when the file does not exist. */
export async function readJson<T>(file: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(file, "utf8");
    return JSON.parse(raw) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

/**
 * Write JSON atomically (write to a temp file, then rename) so a crash mid-write
 * never corrupts the target. Files are created with `0600` permissions because
 * they hold credentials.
 */
export async function writeJson(file: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  const content = `${JSON.stringify(data, null, 2)}\n`;
  await fs.writeFile(tmp, content, { mode: SECRET_MODE });
  await fs.rename(tmp, file);
  if (!isWindows) {
    try {
      await fs.chmod(file, SECRET_MODE);
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
