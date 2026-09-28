import { mock } from "bun:test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";

// Run in a subprocess so the platform and module mocks cannot leak into tests.
Object.defineProperty(process, "platform", { value: "darwin" });
const expectedService = process.env.EXPECTED_SERVICE!;
const calls: string[] = [];
const token = { claudeAiOauth: { accessToken: "fixture-token" } };
mock.module("../../src/core/keychain", () => ({
  keychainGet: async (service: string) => {
    calls.push(service);
    return JSON.stringify(token);
  },
  keychainSet: async (service: string, value: string) => {
    calls.push(service);
    assert.deepEqual(JSON.parse(value), token);
  },
}));
const { claudeConfigFile } = await import("../../src/core/paths");
const { claudeProvider } = await import("../../src/providers/claude");
await writeFile(claudeConfigFile(), JSON.stringify({ theme: "dark", oauthAccount: { emailAddress: "old@example.test" } }));
const active = await claudeProvider.readActive();
assert.deepEqual(active, { credentials: token, account: { emailAddress: "old@example.test" } });
await claudeProvider.writeActive({ credentials: token, account: { emailAddress: "new@example.test" } });
assert.deepEqual(JSON.parse(await readFile(claudeConfigFile(), "utf8")), { theme: "dark", oauthAccount: { emailAddress: "new@example.test" } });
assert.deepEqual(calls, [expectedService, expectedService]);
