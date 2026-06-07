import { describe, expect, test } from "bun:test";
import { detectPackageManager, isNewer } from "../src/commands/update";

describe("isNewer", () => {
  test("compares semver numerically", () => {
    expect(isNewer("0.2.0", "0.1.9")).toBe(true);
    expect(isNewer("1.0.0", "0.9.9")).toBe(true);
    expect(isNewer("0.1.10", "0.1.9")).toBe(true);
    expect(isNewer("0.1.1", "0.1.1")).toBe(false);
    expect(isNewer("0.1.0", "0.1.1")).toBe(false);
  });

  test("ignores prerelease suffixes", () => {
    expect(isNewer("0.1.2-0", "0.1.1")).toBe(true);
    expect(isNewer("0.1.1-rc.1", "0.1.1")).toBe(false);
  });
});

describe("detectPackageManager", () => {
  test("identifies the manager from the install path", () => {
    expect(detectPackageManager("/Users/x/.bun/install/global/node_modules/toguru-cli/dist/cli.js")).toBe("bun");
    expect(detectPackageManager("/usr/local/lib/node_modules/toguru-cli/dist/cli.js")).toBe("npm");
    expect(detectPackageManager("/Users/x/Library/pnpm/global/5/node_modules/toguru-cli/dist/cli.js")).toBe("pnpm");
    expect(detectPackageManager("/Users/x/.config/yarn/global/node_modules/toguru-cli/dist/cli.js")).toBe("yarn");
  });

  test("returns null for source checkouts and npx runs", () => {
    expect(detectPackageManager("/Users/x/dev/toguru/src/commands/update.ts")).toBeNull();
    expect(detectPackageManager("/Users/x/.npm/_npx/abc123/node_modules/toguru-cli/dist/cli.js")).toBeNull();
  });

  test("normalizes Windows paths", () => {
    expect(detectPackageManager("C:\\Users\\x\\AppData\\Roaming\\npm\\node_modules\\toguru-cli\\dist\\cli.js")).toBe("npm");
  });
});
