// Bundles the spelling libraries (double-metaphone, jaro-winkler) into one ES module the page
// can import without a build step: assets/vendor/spelling.js. Run after changing their versions.
import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

await build({
  entryPoints: [path.join(root, "scripts/vendor/spelling-entry.js")],
  outfile: path.join(root, "assets/vendor/spelling.js"),
  bundle: true,
  minify: true,
  format: "esm",
  legalComments: "none",
  banner: { js: "/* double-metaphone and jaro-winkler (MIT): see licenses/spelling/ */" },
});
