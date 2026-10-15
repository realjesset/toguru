import { afterEach, expect, test } from "bun:test";
import os from "node:os";
import path from "node:path";
import { claudeConfigFile, claudeCredentialsFile, claudeDir } from "../src/core/paths";

const original = process.env.CLAUDE_CONFIG_DIR;
afterEach(() => {
  if (original === undefined) delete process.env.CLAUDE_CONFIG_DIR;
  else process.env.CLAUDE_CONFIG_DIR = original;
});

for (const override of [undefined, "", path.join(os.tmpdir(), "claude custom"), "./claude-relative"]) {
  test(`Claude paths respect override ${JSON.stringify(override)}`, () => {
    if (override === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = override;
    const dir = override ? path.resolve(override) : path.join(os.homedir(), ".claude");
    expect(claudeDir()).toBe(dir);
    expect(claudeCredentialsFile()).toBe(path.join(dir, ".credentials.json"));
    expect(claudeConfigFile()).toBe(path.join(override ? dir : os.homedir(), ".claude.json"));
  });
}
