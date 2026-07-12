(function () {
  let installPrompt = null;
  let installButton = null;
  let updateRequested = false;

  function showUpdatePrompt(worker) {
    if (!worker || document.querySelector("#appUpdatePrompt")) return;
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
      updateRequested = true;
      refreshButton.disabled = true;
      refreshButton.textContent = "正在刷新";
      worker.postMessage({ type: "SKIP_WAITING" });
    });

    prompt.append(message, refreshButton);
    document.body.append(prompt);
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
      if (document.visibilityState === "visible") registration.update().catch(() => null);
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
