(function () {
  const B = (window.Bandwidth = window.Bandwidth || {});
  const KEY = "bandwidthSettings2";

  B.defaultSettings = function () {
    return {
      fontStep: 0,
      focus: true,
      highlights: true,
      roomy: false,
      night: false,
      bionic: false,
      pace: false,
      autoplay: true,
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
    try { chrome.storage.local.set({ [KEY]: s }); } catch (err) {  }
  };
})();
