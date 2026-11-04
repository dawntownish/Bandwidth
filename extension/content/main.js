console.log("[Bandwidth] content script loaded");
window.Bandwidth.ui.init();

chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === "BANDWIDTH_TOGGLE") {
    window.Bandwidth.ui.toggle();
  }
});
