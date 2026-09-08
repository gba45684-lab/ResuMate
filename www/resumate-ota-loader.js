/* ResuMate stable OTA loader. This file is bundled once into the APK.
 * Future web/runtime changes are delivered from GitHub Pages without rebuilding the APK.
 * No API keys or resume data are sent by this loader.
 */
(function () {
  'use strict';

  var BASE = 'https://gba45684-lab.github.io/ResuMate/';
  var VERSION_URL = BASE + 'version.json';
  var RUNTIME_URL = BASE + 'resumate-runtime.js';
  var LOADER_VERSION = '1.0.0';

  function mark(status, detail) {
    try {
      window.__RESUMATE_OTA__ = {
        status: status,
        detail: detail || '',
        loaderVersion: LOADER_VERSION,
        checkedAt: new Date().toISOString()
      };
      window.dispatchEvent(new CustomEvent('resumate:ota-status', {
        detail: window.__RESUMATE_OTA__
      }));
    } catch (_) {}
  }

  function loadRuntime(version) {
    return new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.src = RUNTIME_URL + '?v=' + encodeURIComponent(version || Date.now());
      script.async = true;
      script.dataset.resumateOta = 'runtime';
      script.onload = function () {
        mark('loaded', version || 'latest');
        resolve();
      };
      script.onerror = function () {
        mark('fallback', 'Remote runtime unavailable; bundled app remains active.');
        reject(new Error('OTA runtime unavailable'));
      };
      document.head.appendChild(script);
    });
  }

  function check() {
    mark('checking');
    if (!navigator.onLine) {
      mark('offline', 'Offline; using bundled application.');
      return;
    }

    fetch(VERSION_URL + '?t=' + Date.now(), {
      cache: 'no-store',
      credentials: 'omit'
    })
      .then(function (response) {
        if (!response.ok) throw new Error('version manifest HTTP ' + response.status);
        return response.json();
      })
      .then(function (manifest) {
        if (!manifest || manifest.enabled === false) {
          mark('disabled');
          return;
        }
        return loadRuntime(manifest.build || manifest.version || Date.now());
      })
      .catch(function (error) {
        mark('fallback', String(error && error.message || error));
      });
  }

  window.ResuMateOTA = {
    baseUrl: BASE,
    versionUrl: VERSION_URL,
    runtimeUrl: RUNTIME_URL,
    check: check,
    status: function () { return window.__RESUMATE_OTA__ || null; }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', check, { once: true });
  } else {
    check();
  }
})();
