import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/cli.ts", "src/index.ts"],
  format: ["esm"],
  target: "node22",
  platform: "node",
  outDir: "dist",
  splitting: true,
  treeshake: true,
  clean: true,
  dts: true,
  sourcemap: true,
  shims: true,
});
