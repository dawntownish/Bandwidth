(function () {
  const B = (window.Bandwidth = window.Bandwidth || {});

  B.askAI = function (task, payload) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "BANDWIDTH_AI", task, payload }, (res) => {
        if (chrome.runtime.lastError || !res) {
          resolve({ ok: false, error: "no_response" });
          return;
        }
        resolve(res);
      });
    });
  };
})();
