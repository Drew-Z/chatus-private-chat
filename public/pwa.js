(function () {
  let installPrompt = null;
  let installButton = null;
  let updateRequested = false;
  let pendingUpdateWorker = null;
  let currentReleaseCommit = "";
  let releaseCheckInFlight = false;

  function showUpdatePrompt(worker) {
    if (worker) pendingUpdateWorker = worker;
    if (document.querySelector("#appUpdatePrompt")) return;
    const prompt = document.createElement("div");
    prompt.id = "appUpdatePrompt";
    prompt.className = "app-update-prompt";
    prompt.setAttribute("role", "status");

    const message = document.createElement("span");
    message.textContent = "Chatus 已更新，新版本可以使用了";
    const refreshButton = document.createElement("button");
    refreshButton.type = "button";
    refreshButton.textContent = "立即刷新";
    refreshButton.addEventListener("click", () => {
      refreshButton.disabled = true;
      refreshButton.textContent = "正在刷新";
      if (pendingUpdateWorker) {
        updateRequested = true;
        pendingUpdateWorker.postMessage({ type: "SKIP_WAITING" });
      } else {
        location.reload();
      }
    });

    prompt.append(message, refreshButton);
    document.body.append(prompt);
  }

  async function fetchReleaseCommit() {
    const response = await fetch(`/release.json?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) return "";
    const release = await response.json();
    return typeof release.commit === "string" ? release.commit : "";
  }

  async function checkRelease() {
    if (releaseCheckInFlight) return;
    releaseCheckInFlight = true;
    try {
      const commit = await fetchReleaseCommit();
      if (!commit) return;
      if (!currentReleaseCommit) {
        currentReleaseCommit = commit;
        return;
      }
      if (commit === currentReleaseCommit) return;
      await new Promise((resolve) => setTimeout(resolve, 3000));
      if ((await fetchReleaseCommit()) === commit) showUpdatePrompt();
    } catch {
      // Version checks are best-effort and must not affect normal chat use.
    } finally {
      releaseCheckInFlight = false;
    }
  }

  function watchRegistration(registration) {
    if (registration.waiting && navigator.serviceWorker.controller) showUpdatePrompt(registration.waiting);
    registration.addEventListener("updatefound", () => {
      const worker = registration.installing;
      worker?.addEventListener("statechange", () => {
        if (worker.state === "installed" && navigator.serviceWorker.controller) showUpdatePrompt(worker);
      });
    });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        registration.update().catch(() => null);
        checkRelease();
      }
    });
  }

  function updateInstallButton() {
    if (!installButton) installButton = document.querySelector("#installAppButton");
    if (installButton) installButton.hidden = !installPrompt;
  }

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installPrompt = event;
    updateInstallButton();
  });

  window.addEventListener("appinstalled", () => {
    installPrompt = null;
    updateInstallButton();
  });

  document.addEventListener("DOMContentLoaded", () => {
    installButton = document.querySelector("#installAppButton");
    installButton?.addEventListener("click", async () => {
      if (!installPrompt) return;
      await installPrompt.prompt();
      await installPrompt.userChoice;
      installPrompt = null;
      updateInstallButton();
    });
    updateInstallButton();
    checkRelease();
    setInterval(() => {
      if (document.visibilityState === "visible") checkRelease();
    }, 5 * 60_000);
  });

  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!updateRequested) return;
      updateRequested = false;
      location.reload();
    });
    window.addEventListener("load", async () => {
      const registration = await navigator.serviceWorker.register("/sw.js").catch(() => null);
      if (registration) watchRegistration(registration);
    });
  }
})();
