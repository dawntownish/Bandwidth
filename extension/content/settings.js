// Remembers your reading settings between pages and visits.
(function () {
  const B = (window.Bandwidth = window.Bandwidth || {});
  const KEY = "bandwidthSettings2";

  B.defaultSettings = function () {
    return {
      fontStep: 0,        // A- / A+
      focus: true,        // dim everything except the paragraph in view
      highlights: true,
      roomy: false,       // roomy spacing
      night: false,
      autoplay: true,     // on: Listen keeps going paragraph to paragraph. Off: it stops after the current one
      speed: 1,
      voice: "",
    };
  };

  B.loadSettings = function () {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get(KEY, (res) => {
          void chrome.runtime.lastError;
          resolve(Object.assign(B.defaultSettings(), (res && res[KEY]) || {}));
        });
      } catch (err) {
        resolve(B.defaultSettings());
      }
    });
  };

  B.saveSettings = function (s) {
    try { chrome.storage.local.set({ [KEY]: s }); } catch (err) { /* ignore */ }
  };
})();
