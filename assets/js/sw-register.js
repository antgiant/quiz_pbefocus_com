// Registers the service worker (sw.js) that keeps the app and the season data on the
// device. It only runs over https, or when the URL has ?sw=1 for testing, so local
// development over http never serves stale files.
export function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }
  const allowed = location.protocol === "https:" || new URLSearchParams(location.search).has("sw");
  if (!allowed) {
    return;
  }

  const register = () => navigator.serviceWorker.register("sw.js").catch(() => {});
  if (document.readyState === "complete") {
    register();
  } else {
    window.addEventListener("load", register, { once: true });
  }
}
