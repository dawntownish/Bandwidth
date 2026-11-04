const BACKEND_URL = "http://localhost:3000";

chrome.action.onClicked.addListener((tab) => {
  chrome.tabs.sendMessage(tab.id, { type: "BANDWIDTH_TOGGLE" }).catch(() => {

  });
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg) return;
  if (msg.type === "BANDWIDTH_AI") {
    callBackend(msg.task, msg.payload).then(sendResponse);
    return true;
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
