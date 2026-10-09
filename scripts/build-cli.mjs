// Bundles the CLI scripts into plain JavaScript for the production image,
// which has no TypeScript tooling: dist/migrate.mjs, dist/import.mjs,
// dist/rotate-keys.mjs. Run by `npm run build:cli` (part of the Docker build).
import { build } from "esbuild";

await build({
  entryPoints: {
    migrate: "scripts/migrate.mts",
    import: "scripts/import.mts",
    "rotate-keys": "scripts/rotate-keys.mts",
  },
  outdir: "dist",
  outExtension: { ".js": ".mjs" },
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  // pg optionally loads a native binding we don't use.
  external: ["pg-native"],
  // Some bundled CommonJS deps call require(); give ESM output a require().
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: "warning",
});
console.log("CLI bundled into dist/");
