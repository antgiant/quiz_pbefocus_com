// Loads big third-party files on demand instead of blocking the first paint.
// Each entry is skipped when its global already exists (tests, other pages) and
// loads at most once; optional files (the PowerPoint template bundle is only
// built locally) resolve even if they are missing.
const VENDORS = {
  compromise: {
    ready: () => typeof globalThis.nlp === "function",
    files: [{ src: "assets/vendor/compromise.min.js" }],
  },
  // Just the zip reader, for the "my own questions" spreadsheet
  jszip: {
    ready: () => typeof globalThis.JSZip === "function",
    files: [{ src: "assets/vendor/jszip.min.js" }],
  },
  pptx: {
    ready: () => typeof globalThis.JSZip === "function",
    files: [
      { src: "assets/vendor/jszip.min.js" },
      { src: "assets/vendor/pptx-template.bundle.js", optional: true },
    ],
  },
};

const requests = new Map();

function injectScript(src, optional) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = new URL(src, document.baseURI).href;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => (optional ? resolve() : reject(new Error(`Failed to load ${src}`)));
    document.head.append(script);
  });
}

export function loadVendor(name) {
  const vendor = VENDORS[name];
  if (!vendor) {
    return Promise.reject(new Error(`Unknown vendor bundle: ${name}`));
  }
  if (vendor.ready()) {
    return Promise.resolve();
  }
  if (!requests.has(name)) {
    const request = Promise.all(vendor.files.map((file) => injectScript(file.src, file.optional))).then(
      () => undefined,
      (error) => {
        requests.delete(name);
        throw error;
      }
    );
    requests.set(name, request);
  }
  return requests.get(name);
}
