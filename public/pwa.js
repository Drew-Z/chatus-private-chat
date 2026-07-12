(function () {
  let installPrompt = null;
  let installButton = null;

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
    window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => null));
  }
})();
