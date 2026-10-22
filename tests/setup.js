import { createRequire } from "node:module";
import "fake-indexeddb/auto";

// The app loads compromise with a <script> tag, which sets the global `nlp`.
// Evaluating the same vendored file here does the same thing.
const require = createRequire(import.meta.url);
require("../assets/vendor/compromise.min.js");

if (typeof globalThis.nlp !== "function") {
  throw new Error("compromise did not register a global nlp function");
}
