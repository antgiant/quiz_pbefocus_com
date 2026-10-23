// Measures cold and warm page loads of a static site directory under throttled CPU and
// network, the way GitHub Pages would serve it (gzip, ETag, max-age=600).
//
//   node scripts/bench/run.mjs --site <dir> [--runs 7] [--label name] [--net fast4g|slow4g|none] [--cpu 4] [--sw] [--dwell 12]
//
// Scenarios: "cold" (empty profile), "warm" (second visit while the HTTP cache is
// fresh) and "return" (a later visit, after the HTTP cache lifetime has passed, so every
// file must be revalidated unless a service worker answers).
// --sw opens the page with ?sw=1 so the service worker registers.
//
// Needs Playwright (PLAYWRIGHT_PATH=<dir containing node_modules/playwright> if it is
// not installed here) and a Chromium (PW_CHROMIUM=<binary>).
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { gzipSync } from "node:zlib";

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

const site = path.resolve(arg("site", "."));
const runs = Number(arg("runs", 7));
const label = arg("label", path.basename(site));
const netName = arg("net", "fast4g");
const cpuRate = Number(arg("cpu", 4));
const useServiceWorker = process.argv.includes("--sw");
// GitHub Pages sends max-age=600; a short lifetime lets the "return" scenario wait it out
const HTTP_MAX_AGE_SECONDS = 30;
// Time spent on the first page before leaving, which background work (such as saving
// verse analysis for later visits) gets to use
const DWELL_SECONDS = Number(arg("dwell", 12));
const NETWORKS = {
  // Lighthouse-style presets, bytes per second
  fast4g: { latency: 40, downloadThroughput: (10 * 1024 * 1024) / 8, uploadThroughput: (5 * 1024 * 1024) / 8 },
  slow4g: { latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 },
};

function loadPlaywright() {
  const roots = [process.env.PLAYWRIGHT_PATH, process.cwd(), "/node-tools"].filter(Boolean);
  for (const root of roots) {
    try {
      return createRequire(path.join(path.resolve(root), "node_modules", "_"))("playwright");
    } catch {
      // try the next location
    }
  }
  throw new Error("Playwright not found; set PLAYWRIGHT_PATH");
}

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".css": "text/css", ".png": "image/png", ".ico": "image/x-icon" };
const gzipCache = new Map();
const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  let file = path.join(site, decodeURIComponent(url.pathname));
  if (file.endsWith(path.sep) || url.pathname === "/") file = path.join(file, "index.html");
  if (!existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404).end();
    return;
  }
  const type = TYPES[path.extname(file)] || "application/octet-stream";
  const compressible = /text|javascript|json|svg/.test(type);
  let entry = gzipCache.get(file);
  if (!entry) {
    const raw = readFileSync(file);
    const body = compressible ? gzipSync(raw) : raw;
    entry = { body, etag: `"${createHash("md5").update(body).digest("hex")}"` };
    gzipCache.set(file, entry);
  }
  const headers = { "content-type": type, "cache-control": `max-age=${HTTP_MAX_AGE_SECONDS}`, etag: entry.etag };
  if (compressible) headers["content-encoding"] = "gzip";
  if (req.headers["if-none-match"] === entry.etag) {
    res.writeHead(304, headers).end();
    return;
  }
  res.writeHead(200, { ...headers, "content-length": entry.body.length }).end(entry.body);
});
await new Promise((resolve) => server.listen(0, resolve));
const origin = `http://localhost:${server.address().port}`;

const { chromium } = loadPlaywright();
const executablePath = process.env.PW_CHROMIUM || (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const browser = await chromium.launch({ executablePath, // Request interception would switch the HTTP cache off, so outside hosts are blocked at DNS instead
  args: ["--enable-precise-memory-info", "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost"] });


const BOLLS_LATENCY_MS = 150;

// Distinct, scripture-like verses per chapter (seeded by the URL) so verse analysis does
// real work, as it does with the live API
const VOCABULARY = (
  "Lord God Jesus Christ Spirit Father Moses Abraham David Israel Jerusalem Egypt people land king servant word " +
  "heaven earth spoke said saying unto them whom shall will have been called came went gave took kept loved heard " +
  "saw knew believed walked stood sat answered commanded written covenant righteousness mercy truth glory kingdom " +
  "temple altar offering sacrifice prophet priest disciples crowd mountain sea boat bread water wine vineyard field " +
  "seed harvest shepherd sheep flock lamb light darkness life death sin grace faith hope peace joy wisdom understanding " +
  "the and of to in that he his for with them was not they him you it be is on by all as but who which from their " +
  "were are have had said into upon every therefore because behold indeed however also again then thus now"
).split(" ");

function fakeChapterBody(url) {
  let seed = 0;
  for (const char of url) seed = (seed * 31 + char.charCodeAt(0)) >>> 0;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const verses = Array.from({ length: 30 }, (_, index) => ({
    verse: index + 1,
    text: `${Array.from({ length: 12 + Math.floor(random() * 24) }, () => VOCABULARY[Math.floor(random() * VOCABULARY.length)]).join(" ")}.`,
  }));
  return Buffer.from(JSON.stringify(verses)).toString("base64");
}

const READY = /Generated \d+ questions|No questions generated/;

async function measure(context, dwellSeconds = 0) {
  const page = await context.newPage();
  await page.addInitScript((pattern) => {
    window.__longTasks = 0;
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) window.__longTasks += entry.duration;
      }).observe({ type: "longtask", buffered: true });
    } catch {}
    // "Interactive": the controls are filled in with the season list
    new MutationObserver(() => {
      if (window.__interactive === undefined && document.querySelector("#yearSelect option")) {
        window.__interactive = performance.now();
      }
    }).observe(document, { childList: true, subtree: true });
    const regex = new RegExp(pattern);
    const watch = () => {
      const node = document.getElementById("statusMessage");
      if (!node) return false;
      const check = () => {
        if (window.__ready === undefined && regex.test(node.textContent)) window.__ready = performance.now();
      };
      new MutationObserver(check).observe(node, { childList: true, characterData: true, subtree: true });
      check();
      return true;
    };
    if (!watch()) document.addEventListener("DOMContentLoaded", watch);
  }, READY.source);
  const cdp = await context.newCDPSession(page);
  if (netName !== "none") await cdp.send("Network.emulateNetworkConditions", { offline: false, ...NETWORKS[netName] });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpuRate });
  // Verse text comes from a third-party API; answer it locally after a fixed delay so
  // runs measure the app rather than that service (and failures do not trigger retries)
  await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "https://bolls.life/*", requestStage: "Request" }] });
  cdp.on("Fetch.requestPaused", (event) => {
    setTimeout(() => {
      cdp
        .send("Fetch.fulfillRequest", {
          requestId: event.requestId,
          responseCode: 200,
          responseHeaders: [
            { name: "content-type", value: "application/json" },
            { name: "access-control-allow-origin", value: "*" },
          ],
          body: fakeChapterBody(event.request.url),
        })
        .catch(() => {});
    }, BOLLS_LATENCY_MS);
  });

  await page.goto(origin + "/index.html" + (useServiceWorker ? "?sw=1" : ""), { waitUntil: "commit" });
  await page.waitForFunction(() => window.__ready !== undefined, null, { timeout: 120000 });
  const result = await page.evaluate(() => {
    const resources = performance.getEntriesByType("resource").filter((r) => r.name.startsWith(location.origin));
    return {
      interactiveMs: window.__interactive ?? null,
      readyMs: window.__ready,
      fcpMs: performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? null,
      transferKB: resources.reduce((sum, r) => sum + r.transferSize, 0) / 1024,
      requests: resources.length,
      networkRequests: resources.filter((r) => r.transferSize > 0).length,
      heapMB: performance.memory ? performance.memory.usedJSHeapSize / 1048576 : null,
      longTaskMs: window.__longTasks,
    };
  });
  if (useServiceWorker) {
    // the next visit only benefits once the worker has installed
    await page.evaluate(() => navigator.serviceWorker?.ready).catch(() => {});
  }
  if (dwellSeconds) {
    await new Promise((resolve) => setTimeout(resolve, dwellSeconds * 1000));
  }
  await page.close();
  return result;
}

const rows = { cold: [], warm: [], return: [] };
for (let run = 0; run < runs; run += 1) {
  const context = await browser.newContext();
  rows.cold.push(await measure(context, DWELL_SECONDS));
  rows.warm.push(await measure(context));
  await new Promise((resolve) => setTimeout(resolve, (HTTP_MAX_AGE_SECONDS + 1) * 1000));
  rows.return.push(await measure(context));
  await context.close();
}
await browser.close();
server.close();

const pick = (list, key, q) => {
  const values = list.map((row) => row[key]).filter((v) => v !== null).sort((a, b) => a - b);
  return values.length ? values[Math.min(values.length - 1, Math.floor(q * values.length))] : null;
};
const summary = {};
for (const [scenario, list] of Object.entries(rows)) {
  summary[scenario] = {};
  for (const key of Object.keys(list[0])) {
    summary[scenario][key] = { median: pick(list, key, 0.5), p90: pick(list, key, 0.9) };
  }
}

console.log(`\n${label}  (net=${netName}, cpu=${cpuRate}x, runs=${runs})`);
console.log("scenario  controls ms   questions ms (med/p90)   FCP ms   transfer KB   requests (net)   heap MB   long-task ms");
for (const [scenario, s] of Object.entries(summary)) {
  const f = (v, d = 0) => (v === null ? "-" : v.toFixed(d));
  console.log(
    `${scenario.padEnd(8)}  ${f(s.interactiveMs.median).padStart(10)}   ${f(s.readyMs.median).padStart(10)} / ${f(s.readyMs.p90).padStart(6)}` +
      `   ${f(s.fcpMs.median).padStart(6)}   ${f(s.transferKB.median).padStart(11)}   ${f(s.requests.median).padStart(4)} (${f(s.networkRequests.median)})` +
      `   ${f(s.heapMB.median, 1).padStart(8)}   ${f(s.longTaskMs.median).padStart(8)}`
  );
}
if (arg("json")) {
  const { writeFileSync } = await import("node:fs");
  writeFileSync(arg("json"), JSON.stringify({ label, net: netName, cpu: cpuRate, runs, summary }, null, 2));
}
