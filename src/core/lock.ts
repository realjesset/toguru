import { AsyncLocalStorage } from "node:async_hooks";
import type { Stats } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { ToguruError } from "../utils/errors";

/** A lock older than this is assumed abandoned, even if its pid is reused. */
const STALE_MS = 30_000;
const TIMEOUT_MS = 10_000;
const RETRY_MS = 25;

/** Lock files this async call chain already holds (makes the lock reentrant). */
const held = new AsyncLocalStorage<ReadonlySet<string>>();

/** The inode of an abandoned lock (dead pid or too old), or `undefined` if it's live or gone. */
async function staleInode(file: string): Promise<number | undefined> {
  let raw: string;
  let stat: Stats;
  try {
    [raw, stat] = await Promise.all([fs.readFile(file, "utf8"), fs.stat(file)]);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
  if (Date.now() - stat.mtimeMs > STALE_MS) {
    return stat.ino;
  }
  const pid = Number.parseInt(raw, 10);
  if (!(pid > 0)) {
    // Owner hasn't written its pid yet; give it a moment.
    return undefined;
  }
  try {
    process.kill(pid, 0);
    return undefined;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ESRCH" ? stat.ino : undefined;
  }
}

/**
 * Remove an abandoned lock — but only the one judged stale. Waiters serialize
 * on a second guard file and re-check the inode, so one waiter can't delete
 * the fresh lock another waiter just created in its place.
 */
async function reclaim(file: string, inode: number): Promise<void> {
  const guard = `${file}.reclaim`;
  try {
    await fs.writeFile(guard, String(process.pid), { flag: "wx", mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
      throw error;
    }
    const stat = await fs.stat(guard).catch(() => undefined);
    if (stat && Date.now() - stat.mtimeMs > STALE_MS) {
      await fs.rm(guard, { force: true });
    }
    return;
  }
  try {
    if ((await staleInode(file)) === inode) {
      await fs.rm(file, { force: true });
    }
  } finally {
    await fs.rm(guard, { force: true });
  }
}

/**
 * Run `fn` while holding an exclusive, cross-process lock file. Concurrent `tg`
 * processes (two terminals, the hub, the keeper) would otherwise
 * read-modify-write the vault over each other and silently drop a captured
 * token. Reentrant within one async call chain; locks left by crashed
 * processes are reclaimed.
 */
export async function withFileLock<T>(file: string, fn: () => Promise<T>): Promise<T> {
  const holding = held.getStore();
  if (holding?.has(file)) {
    return fn();
  }
  await fs.mkdir(path.dirname(file), { recursive: true });
  const deadline = Date.now() + TIMEOUT_MS;
  for (;;) {
    try {
      await fs.writeFile(file, String(process.pid), { flag: "wx", mode: 0o600 });
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }
    }
    const inode = await staleInode(file);
    if (inode !== undefined) {
      await reclaim(file, inode);
      continue;
    }
    if (Date.now() > deadline) {
      throw new ToguruError(
        "The account vault is busy (another tg is writing to it).",
        `If no other tg is running, delete ${file} and try again.`,
      );
    }
    await sleep(RETRY_MS);
  }
  try {
    return await held.run(new Set([...(holding ?? []), file]), fn);
  } finally {
    await fs.rm(file, { force: true });
  }
}
