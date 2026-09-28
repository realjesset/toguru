import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

for (const scenario of ["default", "empty", "custom", "unicode", "secure", "secure-empty"] as const) {
  test(`Claude Keychain reads and writes use the ${scenario} namespace`, async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "toguru-keychain-"));
    try {
      const config = scenario === "default" ? undefined : scenario === "empty" ? "" : path.join(dir, scenario === "unicode" ? "cafe\u0301" : "custom");
      const secure = scenario === "secure" ? path.join(dir, "secure") : scenario === "secure-empty" ? "" : undefined;
      if (config) await mkdir(config, { recursive: true });
      const namespace = secure ?? config;
      const suffix = namespace ? `-${createHash("sha256").update(namespace.normalize("NFC")).digest("hex").substring(0, 8)}` : "";
      const child = Bun.spawn([process.execPath, path.join(import.meta.dir, "fixtures/claude-keychain.ts")], {
        env: { ...process.env, HOME: dir, CLAUDE_CONFIG_DIR: config, CLAUDE_SECURESTORAGE_CONFIG_DIR: secure, EXPECTED_SERVICE: `Claude Code-credentials${suffix}` },
        stdout: "pipe", stderr: "pipe",
      });
      const stderr = await new Response(child.stderr).text();
      expect(stderr).toBe("");
      expect(await child.exited).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
}
