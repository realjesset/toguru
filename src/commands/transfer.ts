import { Command } from "commander";
import { Store, type StoreData, validateStoreData } from "../core/store";
import { getProvider } from "../providers/registry";
import type { ProviderId } from "../providers/types";
import { ToguruError } from "../utils/errors";
import { readJson, writeJson } from "../utils/fs";
import { logger } from "../utils/logger";
import { PROVIDER_ARG } from "./shared";

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

  if (options.out) {
    await writeJson(options.out, data);
    logger.success(`Exported accounts to ${options.out}.`);
    logger.warn("This file contains credentials — keep it private.");
    return;
  }
  logger.json(data);
}

/**
 * Import accounts from a previously exported file, merging into the vault.
 * Nothing becomes active: importing doesn't change what's signed in.
 */
export async function runImport(file: string, options: ImportOptions = {}): Promise<void> {
  const parsed = await readJson<unknown>(file);
  if (parsed === null) {
    throw new ToguruError(`File not found: ${file}`);
  }
  // Validates structure, drops unknown providers / credential-less entries.
  const data = validateStoreData(parsed);
  const store = await Store.load();
  const count = await store.merge(data, options.overwrite ?? false);
  logger.success(`Imported ${count} account${count === 1 ? "" : "s"} from ${file}.`);
  if (count > 0) {
    logger.hint("Activate one with: tg switch");
  }
}

export function exportCommand(): Command {
  return new Command("export")
    .description("Export saved accounts as JSON (contains credentials)")
    .argument("[provider]", `limit to one ${PROVIDER_ARG}`)
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
