import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
  minify: false,
  splitting: false,
  target: "es2022",
  // libsignal is a transitive dep of @whiskeysockets/baileys; keep it external
  // so it is not bundled (consumers already have it on disk).
  external: ["libsignal"],
  outExtension({ format }) {
    return {
      js: format === "esm" ? ".js" : ".cjs",
    };
  },
});
