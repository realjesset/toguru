import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { definedProvider, parseDefinition, type ProviderDefinition } from "../src/providers/declared";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "toguru-declared-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function jwt(claims: Record<string, unknown>): string {
  return `e30.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.sig`;
}

const base: ProviderDefinition = {
  id: "gem",
  name: "Gem CLI",
  dir: "~/.gem",
  files: ["oauth.json", "accounts.json"],
  fields: {
    email: { file: "accounts.json", path: "active" },
    identity: { file: "oauth.json", path: "id_token", jwt: "sub" },
    expiresAt: { file: "oauth.json", path: "expiry", unit: "iso" },
    refreshToken: { file: "oauth.json", path: "refresh_token" },
  },
};

describe("parseDefinition", () => {
  test("accepts a well-formed definition", () => {
    expect(parseDefinition(base, new Set(["claude", "codex"]))).toEqual(base);
  });

  test("rejects ids/aliases taken by other providers and paths escaping the dir", () => {
    const problems = parseDefinition(
      { ...base, id: "codex", aliases: ["GPT"], files: ["../secrets.json"], shared: ["/etc"] },
      new Set(["codex", "gpt"]),
    );
    expect(problems).toBeArray();
    const text = (problems as string[]).join("\n");
    expect(text).toContain('"id" codex');
    expect(text).toContain('alias "GPT"');
    expect(text).toContain('"files"');
    expect(text).toContain('"shared"');
  });

  test("rejects fields that point outside the captured files", () => {
    const problems = parseDefinition({ ...base, fields: { email: { file: "nope.json", path: "x" } } }, new Set());
    expect((problems as string[]).join()).toContain("nope.json");
  });
});

describe("file-set adapter", () => {
  test("captures every file, describes it through the field pointers, and restores into another dir", async () => {
    const live = join(dir, "live");
    await mkdir(live, { recursive: true });
    await writeFile(
      join(live, "oauth.json"),
      JSON.stringify({ id_token: jwt({ sub: "user-42" }), refresh_token: "r", expiry: "2030-01-01T00:00:00Z" }),
    );
    await writeFile(join(live, "accounts.json"), JSON.stringify({ active: "me@x.com" }));
    const provider = definedProvider({ ...base, dir: live }, "test.json");

    const credential = await provider.readActive();
    expect(credential).not.toBeNull();
    expect(provider.describe(credential!)).toMatchObject({
      email: "me@x.com",
      identity: "user-42",
      expiresAt: Date.parse("2030-01-01T00:00:00Z"),
      canRefresh: true,
    });

    const home = join(dir, "home");
    await provider.writeActive(credential!, { dir: home });
    expect(JSON.parse(await readFile(join(home, "accounts.json"), "utf8"))).toEqual({ active: "me@x.com" });
    expect(await provider.readActive({ dir: home })).toEqual(credential);
  });

  test("without its first file nobody is signed in", async () => {
    const provider = definedProvider({ ...base, dir: join(dir, "empty") }, "test.json");
    expect(await provider.readActive()).toBeNull();
  });
});
