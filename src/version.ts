import { createRequire } from "node:module";

// Resolves to the package root in both dev (src/version.ts) and the bundled
// build (dist chunk) — both are one level below package.json.
const require = createRequire(import.meta.url);
const pkg = require("../package.json") as {
  name: string;
  version: string;
  description: string;
};

export const PKG_NAME = pkg.name;
export const VERSION = pkg.version;
export const DESCRIPTION = pkg.description;
