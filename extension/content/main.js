// Runs when a page loads: shows the small launcher, and listens for the toolbar icon click.
console.log("[Bandwidth] content script loaded");
window.Bandwidth.ui.init();

chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === "BANDWIDTH_TOGGLE") {
    window.Bandwidth.ui.toggle();
  }
});
