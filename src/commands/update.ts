import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { ToguruError } from "../utils/errors";
import { logger } from "../utils/logger";
import { runInherit } from "../utils/proc";
import { PKG_NAME, VERSION } from "../version";

type PackageManager = "npm" | "bun" | "pnpm" | "yarn";

interface UpdateOptions {
  check?: boolean;
  pm?: string;
}

/** The global-install command for each supported package manager. */
const INSTALL_ARGS: Record<PackageManager, string[]> = {
  npm: ["install", "-g", `${PKG_NAME}@latest`],
  bun: ["add", "-g", `${PKG_NAME}@latest`],
  pnpm: ["add", "-g", `${PKG_NAME}@latest`],
  yarn: ["global", "add", `${PKG_NAME}@latest`],
};

/**
 * Guess how toguru was installed from the absolute path of the running module.
 * Returns `null` for source checkouts or `npx`-style runs, where a self-update
 * doesn't make sense.
 */
export function detectPackageManager(
  modulePath: string = fileURLToPath(import.meta.url),
): PackageManager | null {
  const p = modulePath.replace(/\\/g, "/");
  if (p.includes("/_npx/") || p.includes("/.npm/_npx/")) {
    return null;
  }
  if (/\/\.?bun\//.test(p)) {
    return "bun";
  }
  if (p.includes("/pnpm/") || p.includes("/.pnpm/")) {
    return "pnpm";
  }
  if (p.includes("/yarn/") || p.includes("/.config/yarn/")) {
    return "yarn";
  }
  if (p.includes("/node_modules/")) {
    return "npm";
  }
  return null;
}

/** True when `latest` is a strictly higher semver than `current`. */
export function isNewer(latest: string, current: string): boolean {
  const parse = (v: string) =>
    (v.split("-")[0] ?? "").split(".").map((n) => Number.parseInt(n, 10) || 0);
  const a = parse(latest);
  const b = parse(current);
  for (let i = 0; i < 3; i += 1) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) {
      return (a[i] ?? 0) > (b[i] ?? 0);
    }
  }
  return false;
}

/** Ask the npm registry for the latest published version. */
async function fetchLatestVersion(): Promise<string> {
  let response: Response;
  try {
    response = await fetch(`https://registry.npmjs.org/${PKG_NAME}/latest`, {
      headers: { accept: "application/json" },
    });
  } catch {
    throw new ToguruError(
      "Could not reach the npm registry.",
      "Check your internet connection and try again.",
    );
  }
  if (!response.ok) {
    throw new ToguruError(`The npm registry returned HTTP ${response.status}.`);
  }
  const data = (await response.json()) as { version?: string };
  if (!data.version) {
    throw new ToguruError("Could not read the latest version from the registry.");
  }
  return data.version;
}

/**
 * Check the registry and, when a newer version exists, update in place using the
 * package manager that installed toguru.
 */
export async function runUpdate(options: UpdateOptions = {}): Promise<void> {
  logger.info(`Installed: v${VERSION}`);
  const latest = await fetchLatestVersion();

  if (!isNewer(latest, VERSION)) {
    logger.success(`You're on the latest version (v${latest}).`);
    return;
  }
  logger.info(`Update available: v${VERSION} → v${latest}`);

  if (options.check) {
    logger.info('Run "tg update" to install it.');
    return;
  }

  const requested = options.pm;
  if (requested && !(requested in INSTALL_ARGS)) {
    throw new ToguruError(
      `Unknown package manager "${requested}".`,
      "Use one of: npm, bun, pnpm, yarn.",
    );
  }
  const pm = (requested as PackageManager | undefined) ?? detectPackageManager();
  if (!pm) {
    throw new ToguruError(
      "Couldn't determine how toguru was installed (a source checkout or npx run?).",
      `Update manually, e.g.: npm install -g ${PKG_NAME}@latest`,
    );
  }

  logger.info(`Updating with ${pm}…`);
  await runInherit(pm, INSTALL_ARGS[pm]);
  logger.success(`Updated to v${latest}. Run "tg --version" to confirm.`);
}

export function updateCommand(): Command {
  return new Command("update")
    .description("Update toguru to the latest published version")
    .option("--check", "only check whether a newer version exists", false)
    .option("--pm <manager>", "force the package manager: npm, bun, pnpm or yarn")
    .action(async (opts: UpdateOptions) => {
      await runUpdate(opts);
    });
}
