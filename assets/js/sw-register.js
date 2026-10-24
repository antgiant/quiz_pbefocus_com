// Registers the service worker (sw.js) that keeps the app and the season data on the
// device. It only runs over https, or when the URL has ?sw=1 for testing, so local
// development over http never serves stale files.
//
// A new version takes over as soon as it has downloaded (phones rarely close a tab all the
// way, so waiting for that never ends). The page that is already open still runs the old
// files, so it reloads itself when that is safe (`canReload()`) or shows a Reload button.
const CHECK_EVERY_MS = 30 * 60 * 1000;

function showUpdateBanner() {
  if (document.getElementById("updateBanner")) {
    return;
  }
  const banner = document.createElement("div");
  banner.id = "updateBanner";
  banner.className = "update-banner";
  banner.setAttribute("role", "status");
  const message = document.createElement("span");
  message.textContent = "A new version is ready. Reload to update.";
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "Reload";
  button.addEventListener("click", () => window.location.reload());
  banner.append(message, button);
  document.body.append(banner);
}

export function registerServiceWorker({ canReload = () => true } = {}) {
  if (!("serviceWorker" in navigator)) {
    return;
  }
  const allowed = location.protocol === "https:" || new URLSearchParams(location.search).has("sw");
  if (!allowed) {
    return;
  }

  // The first install also "changes" the controller; only a change from an older version matters
  const hadController = Boolean(navigator.serviceWorker.controller);
  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController || reloading) {
      return;
    }
    if (canReload()) {
      reloading = true;
      window.location.reload();
    } else {
      showUpdateBanner();
    }
  });

  const register = () =>
    navigator.serviceWorker
      .register("sw.js", { updateViaCache: "none" })
      .then((registration) => {
        // iOS brings a tab back from the background without reloading it, so look then too
        const check = () => registration.update().catch(() => {});
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "visible") check();
        });
        window.addEventListener("pageshow", (event) => {
          if (event.persisted) check();
        });
        window.setInterval(check, CHECK_EVERY_MS);
        // Look for a new version right away, not only after the timer
        check();
      })
      .catch(() => {});
  if (document.readyState === "complete") {
    register();
  } else {
    window.addEventListener("load", register, { once: true });
  }
}

// The version of the files this page is running (they come from the active worker's cache)
export function getAppVersion() {
  const worker = navigator.serviceWorker?.controller;
  if (!worker) {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = window.setTimeout(() => resolve(null), 1500);
    channel.port1.onmessage = (event) => {
      window.clearTimeout(timer);
      resolve(String(event.data));
    };
    worker.postMessage("version", [channel.port2]);
  });
}

// Drops the service worker and every cache it made, then loads the site fresh from the
// network. Profiles, settings and saved verses live in other storage and are kept.
export async function resetAppCache() {
  try {
    const registrations = await navigator.serviceWorker?.getRegistrations?.();
    await Promise.all((registrations || []).map((registration) => registration.unregister()));
  } catch {
    // keep going: clearing the caches still helps
  }
  try {
    const names = await caches.keys();
    await Promise.all(names.map((name) => caches.delete(name)));
  } catch {
    // no Cache API: the reload below is all that can be done
  }
  window.location.reload();
}
