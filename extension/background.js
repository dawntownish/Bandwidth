// Background service worker.
// 1) Toggles the panel when the toolbar icon is clicked.
// 2) Relays AI requests from the page to your local backend.
//    (The API keys are NEVER here. They live only in the backend's .env file.)
// 3) Hands the panel's stylesheet to the page (works even on sites with strict security rules).

const BACKEND_URL = "http://localhost:3000";

chrome.action.onClicked.addListener((tab) => {
  chrome.tabs.sendMessage(tab.id, { type: "BANDWIDTH_TOGGLE" }).catch(() => {
    // Happens on pages where extensions can't run (e.g. chrome:// pages).
  });
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg) return;
  if (msg.type === "BANDWIDTH_AI") {
    callBackend(msg.task, msg.payload).then(sendResponse);
    return true; // keeps the channel open for the async reply
  }
  if (msg.type === "BANDWIDTH_CSS") {
    fetch(chrome.runtime.getURL("panel.css"))
      .then((r) => r.text())
      .then((css) => sendResponse({ css }))
      .catch(() => sendResponse({}));
    return true;
  }
});

async function callBackend(task, payload) {
  try {
    const res = await fetch(`${BACKEND_URL}/api/${task}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return await res.json();
  } catch (err) {
    return { ok: false, error: "backend_unreachable" };
  }
}
