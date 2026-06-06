import { readFile } from "node:fs/promises";
import { writeFile } from "node:fs/promises";
import { Command } from "commander";
import { Store, type StoreData, validateStoreData } from "../core/store";
import { getProvider } from "../providers/registry";
import type { ProviderId } from "../providers/types";
import { ToguruError } from "../utils/errors";
import { pathExists } from "../utils/fs";
import { logger } from "../utils/logger";

interface ExportOptions {
  out?: string;
}

interface ImportOptions {
  overwrite?: boolean;
}

/**
 * Export the vault (optionally one provider) as JSON to a file or stdout.
 * NOTE: the output contains live credentials — treat it as a secret.
 */
export async function runExport(providerId: ProviderId | undefined, options: ExportOptions = {}): Promise<void> {
  const store = await Store.load();
  const snapshot = store.snapshot();
  const data: StoreData = providerId
    ? {
        version: snapshot.version,
        providers: { [providerId]: snapshot.providers[providerId] ?? { accounts: {} } },
      }
    : snapshot;

  const json = `${JSON.stringify(data, null, 2)}\n`;
  if (options.out) {
    await writeFile(options.out, json, { mode: 0o600 });
    logger.success(`Exported accounts to ${options.out}.`);
    logger.warn("This file contains credentials — keep it private.");
    return;
  }
  process.stdout.write(json);
}

/** Import accounts from a previously exported file, merging into the vault. */
export async function runImport(file: string, options: ImportOptions = {}): Promise<void> {
  if (!(await pathExists(file))) {
    throw new ToguruError(`File not found: ${file}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(file, "utf8"));
  } catch {
    throw new ToguruError(`"${file}" is not valid JSON.`);
  }
  // Validates structure, drops unknown providers / credential-less entries.
  const data = validateStoreData(parsed);
  const store = await Store.load();
  const count = await store.merge(data, options.overwrite ?? false);
  logger.success(`Imported ${count} account${count === 1 ? "" : "s"} from ${file}.`);
}

export function exportCommand(): Command {
  return new Command("export")
    .description("Export saved accounts as JSON (contains credentials)")
    .argument("[provider]", "limit to claude or codex")
    .option("-o, --out <file>", "write to a file instead of stdout")
    .action(async (providerArg: string | undefined, opts: ExportOptions) => {
      const id = providerArg ? getProvider(providerArg).id : undefined;
      await runExport(id, opts);
    });
}

export function importCommand(): Command {
  return new Command("import")
    .description("Import saved accounts from a JSON export")
    .argument("<file>", "path to an exported JSON file")
    .option("--overwrite", "replace accounts that already exist", false)
    .action(async (file: string, opts: ImportOptions) => {
      await runImport(file, opts);
    });
}
