/* ResuMate full-app OTA loader. Bundled once into the APK. */
(function () {
  'use strict';

  var BASE = 'https://gba45684-lab.github.io/ResuMate/';
  var INDEX_URL = BASE + 'index.html';
  var VERSION_URL = BASE + 'version.json';
  var POLL_MS = 3000;
  var startingBuild = null;
  var reloading = false;

  function mark(status, detail) {
    try {
      window.__RESUMATE_OTA__ = { status: status, detail: detail || '', checkedAt: new Date().toISOString(), pollMs: POLL_MS };
      window.dispatchEvent(new CustomEvent('resumate:ota-status', { detail: window.__RESUMATE_OTA__ }));
    } catch (_) {}
  }

  function loadRemoteApp(build) {
    if (reloading) return Promise.resolve();
    reloading = true;
    mark('loading', String(build));
    return fetch(INDEX_URL + '?v=' + encodeURIComponent(build || Date.now()), { cache: 'no-store', credentials: 'omit' })
      .then(function (r) {
        if (!r.ok) throw new Error('remote app HTTP ' + r.status);
        return r.text();
      })
      .then(function (html) {
        var remoteBase = '<base href="' + BASE + '">';
        if (!/<base\s/i.test(html)) html = html.replace(/<head([^>]*)>/i, '<head$1>' + remoteBase);
        html = html.replace(/<script[^>]+resumate-ota-loader\.js[^>]*><\/script>/gi, '');
        document.open();
        document.write(html);
        document.close();
        reloading = false;
        mark('updated', String(build));
      })
      .catch(function (error) {
        reloading = false;
        mark('fallback', String(error && error.message || error));
        throw error;
      });
  }

  function check(initial) {
    if (!navigator.onLine) { mark('offline', 'Using bundled application.'); return; }
    fetch(VERSION_URL + '?t=' + Date.now(), { cache: 'no-store', credentials: 'omit' })
      .then(function (r) {
        if (!r.ok) throw new Error('version manifest HTTP ' + r.status);
        return r.json();
      })
      .then(function (manifest) {
        if (!manifest || manifest.enabled === false) { mark('disabled'); return; }
        var build = String(manifest.build || manifest.version || Date.now());
        if (startingBuild === null) {
          startingBuild = build;
          if (initial) return loadRemoteApp(build).catch(function () {});
          return;
        }
        if (build !== startingBuild) {
          startingBuild = build;
          return loadRemoteApp(build).catch(function () {});
        }
        mark('current', build);
      })
      .catch(function (error) { mark('check-failed', String(error && error.message || error)); });
  }

  window.ResuMateOTA = {
    baseUrl: BASE,
    versionUrl: VERSION_URL,
    appUrl: INDEX_URL,
    pollMs: POLL_MS,
    check: function () { return check(false); },
    status: function () { return window.__RESUMATE_OTA__ || null; }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { check(true); }, { once: true });
  else check(true);

  setInterval(function () { check(false); }, POLL_MS);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) check(false); });
  window.addEventListener('online', function () { check(false); });
})();
