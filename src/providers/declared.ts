import { readdirSync, readFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { expandHome } from "../core/paths";
import { ToguruError } from "../utils/errors";
import { writeJson } from "../utils/fs";
import { decodeJwt } from "../utils/jwt";
import { runInherit } from "../utils/proc";
import { envForSlot } from "./slot";
import type { AccountDescriptor, Credential, HomeSupport, LoginOptions, Provider, Slot } from "./types";

/** Where a descriptor field lives inside the captured files. */
interface FieldRef {
  /** One of the definition's `files`. */
  file: string;
  /** Dot path into the file's JSON (`tokens.id_token`). */
  path: string;
  /** Treat the value as a JWT and read this claim from it. */
  jwt?: string;
  /** For `expiresAt`: how the value is encoded (default `ms`). */
  unit?: "ms" | "s" | "iso";
}

/**
 * A user-declared provider: `~/.toguru/providers/<id>.json`. Its credential is
 * the set of `files` inside `dir`, captured and restored verbatim.
 */
export interface ProviderDefinition {
  id: string;
  name: string;
  aliases?: string[];
  /** Config dir holding the credential files (`~` allowed). */
  dir: string;
  /** Env var the CLI reads to relocate `dir`; enables account homes. */
  dirEnv?: string;
  /** Credential files, relative to `dir`. The first one must exist to count as signed in. */
  files: string[];
  /** CLI binary (for `tg run`). */
  command?: string;
  /** Login argv, e.g. `["gemini", "auth", "login"]`. */
  login?: string[];
  /** Entries of `dir` shared into account homes. */
  shared?: string[];
  fields?: {
    email?: FieldRef;
    identity?: FieldRef;
    plan?: FieldRef;
    expiresAt?: FieldRef;
    refreshToken?: FieldRef;
  };
}

/** A captured file: parsed JSON when it parsed, raw text otherwise. */
type Snapshot = { json: unknown } | { text: string };

/** Credential shape for declared providers: `{ files: { <relative path>: Snapshot } }`. */
interface FileSetCredential {
  files: Record<string, Snapshot>;
}

const ID = /^[a-z][a-z0-9-]{1,31}$/;

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string" && item.length > 0);
}

/** A relative path that stays inside its dir. */
function isContained(file: string): boolean {
  return !path.isAbsolute(file) && !file.split(/[\\/]/).includes("..");
}

/** Validate an untrusted definition, returning it or a list of problems. */
export function parseDefinition(raw: unknown, taken: ReadonlySet<string>): ProviderDefinition | string[] {
  const problems: string[] = [];
  if (!isObject(raw)) {
    return ["must be a JSON object"];
  }
  const id = raw.id;
  if (typeof id !== "string" || !ID.test(id)) {
    problems.push(`"id" must match ${ID}`);
  } else if (taken.has(id)) {
    problems.push(`"id" ${id} is already used by another provider`);
  }
  if (typeof raw.name !== "string" || !raw.name.trim()) {
    problems.push(`"name" is required`);
  }
  if (typeof raw.dir !== "string" || !raw.dir.trim()) {
    problems.push(`"dir" is required`);
  }
  if (!isStringArray(raw.files) || raw.files.length === 0 || !raw.files.every(isContained)) {
    problems.push(`"files" must be a non-empty list of paths relative to "dir"`);
  }
  for (const key of ["aliases", "login", "shared"] as const) {
    if (raw[key] !== undefined && !isStringArray(raw[key])) {
      problems.push(`"${key}" must be a list of strings`);
    }
  }
  if (isStringArray(raw.aliases)) {
    for (const alias of raw.aliases) {
      if (taken.has(alias.toLowerCase())) {
        problems.push(`alias "${alias}" is already used by another provider`);
      }
    }
  }
  if (isStringArray(raw.shared) && !raw.shared.every(isContained)) {
    problems.push(`"shared" entries must be relative to "dir"`);
  }
  for (const key of ["dirEnv", "command"] as const) {
    if (raw[key] !== undefined && typeof raw[key] !== "string") {
      problems.push(`"${key}" must be a string`);
    }
  }
  if (raw.fields !== undefined) {
    if (!isObject(raw.fields)) {
      problems.push(`"fields" must be an object`);
    } else {
      const files = isStringArray(raw.files) ? raw.files : [];
      for (const [name, ref] of Object.entries(raw.fields)) {
        if (!["email", "identity", "plan", "expiresAt", "refreshToken"].includes(name)) {
          problems.push(`unknown field "${name}"`);
        } else if (!isObject(ref) || typeof ref.file !== "string" || typeof ref.path !== "string") {
          problems.push(`field "${name}" needs "file" and "path"`);
        } else if (!files.includes(ref.file)) {
          problems.push(`field "${name}" points at "${ref.file}", which isn't in "files"`);
        }
      }
    }
  }
  return problems.length > 0 ? problems : (raw as unknown as ProviderDefinition);
}

/** Read a dot path out of parsed JSON. */
function dig(value: unknown, dotted: string): unknown {
  let current = value;
  for (const key of dotted.split(".")) {
    if (!isObject(current)) {
      return undefined;
    }
    current = current[key];
  }
  return current;
}

function resolveField(credential: FileSetCredential, ref: FieldRef | undefined): unknown {
  if (!ref) {
    return undefined;
  }
  const snapshot = credential.files?.[ref.file];
  if (!snapshot || !("json" in snapshot)) {
    return undefined;
  }
  const value = dig(snapshot.json, ref.path);
  if (ref.jwt === undefined) {
    return value;
  }
  return typeof value === "string" ? decodeJwt(value)?.[ref.jwt] : undefined;
}

function toEpochMs(value: unknown, unit: FieldRef["unit"]): number | undefined {
  if (unit === "iso") {
    const parsed = typeof value === "string" ? Date.parse(value) : Number.NaN;
    return Number.isNaN(parsed) ? undefined : parsed;
  }
  if (typeof value !== "number") {
    return undefined;
  }
  return unit === "s" ? value * 1000 : value;
}

/** Build a {@link Provider} from a validated definition (the file-set adapter). */
export function definedProvider(definition: ProviderDefinition, source: string): Provider {
  const fields = definition.fields ?? {};
  const homes: HomeSupport | undefined = definition.dirEnv
    ? {
        env: definition.dirEnv,
        command: definition.command ?? definition.login?.[0] ?? definition.id,
        baseDir: () => dirFor(),
        shared: definition.shared ?? [],
      }
    : undefined;

  function dirFor(slot?: Slot): string {
    if (slot?.dir !== undefined) {
      return slot.dir;
    }
    const override = definition.dirEnv ? process.env[definition.dirEnv]?.trim() : undefined;
    return path.resolve(override || expandHome(definition.dir));
  }

  const provider: Provider = {
    id: definition.id,
    displayName: definition.name,
    aliases: (definition.aliases ?? []).map((alias) => alias.toLowerCase()),
    source,
    ...(homes ? { homes } : {}),

    async readActive(slot?: Slot): Promise<Credential | null> {
      const dir = dirFor(slot);
      const files: Record<string, Snapshot> = {};
      for (const [index, file] of definition.files.entries()) {
        let text: string;
        try {
          text = await fs.readFile(path.join(dir, file), "utf8");
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
            throw error;
          }
          // The first file is the login itself; without it nobody is signed in.
          if (index === 0) {
            return null;
          }
          continue;
        }
        try {
          files[file] = { json: JSON.parse(text) };
        } catch {
          files[file] = { text };
        }
      }
      return { files };
    },

    async writeActive(credential: Credential, slot?: Slot): Promise<void> {
      const dir = dirFor(slot);
      const { files } = credential as unknown as FileSetCredential;
      if (!isObject(files) || Object.keys(files).length === 0) {
        throw new ToguruError(`This saved ${definition.name} account has no files to restore.`);
      }
      for (const file of definition.files) {
        const snapshot = files[file];
        if (!snapshot) {
          continue;
        }
        const target = path.join(dir, file);
        if ("json" in snapshot) {
          await writeJson(target, snapshot.json);
        } else {
          await fs.mkdir(path.dirname(target), { recursive: true });
          await fs.writeFile(target, snapshot.text, { mode: 0o600 });
        }
      }
    },

    describe(credential: Credential): AccountDescriptor {
      const fileSet = credential as unknown as FileSetCredential;
      const descriptor: AccountDescriptor = { authKind: "oauth" };
      const email = resolveField(fileSet, fields.email);
      if (typeof email === "string") {
        descriptor.email = email;
        descriptor.label = email;
      }
      const identity = resolveField(fileSet, fields.identity);
      if (typeof identity === "string" || typeof identity === "number") {
        descriptor.identity = String(identity);
      } else if (descriptor.email) {
        descriptor.identity = descriptor.email;
      }
      const plan = resolveField(fileSet, fields.plan);
      if (typeof plan === "string") {
        descriptor.plan = plan;
      }
      const expiresAt = toEpochMs(resolveField(fileSet, fields.expiresAt), fields.expiresAt?.unit);
      if (expiresAt !== undefined) {
        descriptor.expiresAt = expiresAt;
      }
      if (fields.refreshToken) {
        descriptor.canRefresh = Boolean(resolveField(fileSet, fields.refreshToken));
      }
      return descriptor;
    },
  };

  const login = definition.login;
  if (login && login.length > 0) {
    const [command, ...args] = login as [string, ...string[]];
    provider.login = async (options?: LoginOptions) => {
      await runInherit(command, args, envForSlot(homes, options?.slot));
    };
  }
  return provider;
}

/** Result of scanning the providers directory. */
export interface DeclaredProviders {
  providers: Provider[];
  /** Human-readable reasons definitions were skipped, `file: problem`. */
  problems: string[];
}

/**
 * Load every `*.json` definition in `dir`. Broken definitions are reported,
 * not fatal: one typo shouldn't lock you out of your other accounts.
 */
export function loadDeclaredProviders(dir: string, taken: ReadonlySet<string>): DeclaredProviders {
  let names: string[];
  try {
    names = readdirSync(dir).filter((name) => name.endsWith(".json")).sort();
  } catch {
    return { providers: [], problems: [] };
  }
  const used = new Set(taken);
  const providers: Provider[] = [];
  const problems: string[] = [];
  for (const name of names) {
    const file = path.join(dir, name);
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      problems.push(`${file}: not valid JSON`);
      continue;
    }
    const parsed = parseDefinition(raw, used);
    if (Array.isArray(parsed)) {
      problems.push(...parsed.map((problem) => `${file}: ${problem}`));
      continue;
    }
    const provider = definedProvider(parsed, file);
    used.add(provider.id);
    for (const alias of provider.aliases) {
      used.add(alias);
    }
    providers.push(provider);
  }
  return { providers, problems };
}

/** Starter definition written by `tg providers init`. */
export function exampleDefinition(id: string): ProviderDefinition {
  return {
    id,
    name: `${id} CLI`,
    dir: `~/.${id}`,
    files: ["credentials.json"],
    login: [id, "login"],
    fields: {
      email: { file: "credentials.json", path: "email" },
      expiresAt: { file: "credentials.json", path: "expires_at", unit: "ms" },
      refreshToken: { file: "credentials.json", path: "refresh_token" },
    },
  };
}
