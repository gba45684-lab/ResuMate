/* ResuMate full-app OTA loader. Bundled once into the APK. */
(function () {
  'use strict';

  var RAW_ROOT = 'https://raw.githubusercontent.com/gba45684-lab/ResuMate/';
  var VERSION_URL = RAW_ROOT + 'main/ota/version.json';
  var POLL_MS = 3000;
  var startingBuild = window.__RESUMATE_BUNDLED_BUILD__ || null;
  var pendingBuild = null;
  var reloading = false;
  var restoring = false;
  var banner = null;
  var otaControl = null;
  var audioContext = null;
  var DB_NAME = 'resumate-ota';
  var DB_VERSION = 1;
  var STORE = 'app';
  var OTA_ENABLED_KEY = 'resumate.ota.enabled';

  function isEnabled() {
    try {
      var value = localStorage.getItem(OTA_ENABLED_KEY);
      return value === null ? true : value === 'true';
    } catch (_) { return true; }
  }

  function setEnabled(value) {
    value = !!value;
    try { localStorage.setItem(OTA_ENABLED_KEY, String(value)); } catch (_) {}
    if (!value) {
      pendingBuild = null;
      if (banner && banner.parentNode) banner.parentNode.removeChild(banner);
      banner = null;
      mark('disabled-by-user', 'OTA updates are disabled.');
    } else {
      mark('enabled', 'OTA updates are enabled.');
      check();
    }
    renderOtaControl();
    return value;
  }

  function buildBase(build) { return RAW_ROOT + encodeURIComponent(String(build)) + '/www/'; }
  function buildIndex(build) { return buildBase(build) + 'index.html'; }
  function buildLoader(build) { return buildBase(build) + 'resumate-ota-loader.js?v=' + encodeURIComponent(String(build)); }

  function applyUiChromeFix() {
    try {
      var old = document.getElementById('resumate-ui-chrome-fix');
      if (old) old.remove();
      var style = document.createElement('style');
      style.id = 'resumate-ui-chrome-fix';
      style.textContent = [
        'html, body { margin-top: 0 !important; padding-top: 0 !important; }',
        'html { scroll-padding-top: 0 !important; }',
        '[id="status-bar"], [id="statusBar"], [id="app-status-bar"], [id="top-status-bar"],',
        '[class~="status-bar"], [class~="statusBar"], [class~="app-status-bar"], [class~="top-status-bar"],',
        '[data-status-bar] { display: none !important; }',
        '[style*="safe-area-inset-top"] { padding-top: 0 !important; margin-top: 0 !important; }',
        'body > :first-child { margin-top: 0 !important; }'
      ].join('\\n');
      (document.head || document.documentElement).appendChild(style);
      document.querySelectorAll('meta[name="viewport"]').forEach(function (meta) {
        var content = meta.getAttribute('content') || '';
        if (/viewport-fit\\s*=\\s*cover/i.test(content)) meta.setAttribute('content', content.replace(/,?\\s*viewport-fit\\s*=\\s*cover/ig, ''));
      });
    } catch (_) {}
  }

  function openDb() {
    return new Promise(function (resolve, reject) {
      if (!('indexedDB' in window)) return reject(new Error('IndexedDB unavailable'));
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function () { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE); };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error('IndexedDB open failed')); };
    });
  }
  function dbGet(key) {
    return openDb().then(function (db) { return new Promise(function (resolve, reject) {
      var tx = db.transaction(STORE, 'readonly'), req = tx.objectStore(STORE).get(key);
      req.onsuccess = function () { resolve(req.result || null); };
      req.onerror = function () { reject(req.error || new Error('IndexedDB read failed')); };
      tx.oncomplete = function () { db.close(); };
    }); });
  }
  function dbPut(key, value) {
    return openDb().then(function (db) { return new Promise(function (resolve, reject) {
      var tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = function () { db.close(); resolve(); };
      tx.onerror = function () { reject(tx.error || new Error('IndexedDB write failed')); };
    }); });
  }

  function injectBuildMarker(html, build) {
    var marker = '<script>window.__RESUMATE_BUNDLED_BUILD__=' + JSON.stringify(String(build)) + ';</script>';
    html = html.replace(/<script[^>]*>\\s*window\\.__RESUMATE_BUNDLED_BUILD__\\s*=.*?<\\/script>/gis, '');
    return /<head[^>]*>/i.test(html) ? html.replace(/<head([^>]*)>/i, '<head$1>' + marker) : marker + html;
  }

  function prepareRemoteHtml(html, build) {
    html = String(html).replace(/<script\\b[^>]*src=["'][^"']*resumate-ota-loader\\.js(?:\\?[^"']*)?["'][^>]*>\\s*<\\/script>/gi, '');
    html = injectBuildMarker(html, build);
    var base = buildBase(build);
    if (!/<base\\s/i.test(html)) html = html.replace(/<head([^>]*)>/i, '<head$1><base href="' + base + '">');
    var tag = '<script src="' + buildLoader(build) + '" defer></script>';
    return /<\\/body>/i.test(html) ? html.replace(/<\\/body>/i, tag + '\\n</body>') : html + tag;
  }

  function restoreCachedApp() {
    if (restoring || !document.body) return Promise.resolve(false);
    restoring = true;
    return dbGet('active').then(function (record) {
      if (!record || !record.build || !record.html) return false;
      var current = String(window.__RESUMATE_BUNDLED_BUILD__ || '');
      if (current === String(record.build)) return false;
      startingBuild = String(record.build);
      document.open();
      document.write(prepareRemoteHtml(record.html, startingBuild));
      document.close();
      applyUiChromeFix();
      return true;
    }).catch(function () { return false; }).finally(function () { restoring = false; });
  }

  function mark(status, detail) {
    try {
      window.__RESUMATE_OTA__ = { status: status, detail: detail || '', enabled: isEnabled(), checkedAt: new Date().toISOString(), pollMs: POLL_MS, bundledBuild: startingBuild || null, pendingBuild: pendingBuild || null };
      window.dispatchEvent(new CustomEvent('resumate:ota-status', { detail: window.__RESUMATE_OTA__ }));
      renderOtaControl();
    } catch (_) {}
  }

  function ring() {
    try { if (navigator.vibrate) navigator.vibrate([120, 70, 120]); } catch (_) {}
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      audioContext = audioContext || new AC();
      if (audioContext.state === 'suspended') audioContext.resume().catch(function () {});
      var now = audioContext.currentTime;
      [0, 0.22].forEach(function (offset) {
        var osc = audioContext.createOscillator(), gain = audioContext.createGain();
        osc.type = 'sine'; osc.frequency.value = offset ? 880 : 660;
        gain.gain.setValueAtTime(0.0001, now + offset);
        gain.gain.exponentialRampToValueAtTime(0.16, now + offset + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.16);
        osc.connect(gain); gain.connect(audioContext.destination);
        osc.start(now + offset); osc.stop(now + offset + 0.18);
      });
    } catch (_) {}
  }

  function notifyNativeOrWeb() {
    try {
      if ('Notification' in window && Notification.permission === 'granted') new Notification('ResuMate update available', { body: 'A new ResuMate version is ready. Tap Update to apply it.' });
    } catch (_) {}
  }

  function renderOtaControl() {
    if (!document.body) return;
    try {
      if (otaControl && !otaControl.isConnected) otaControl = null;
      if (!otaControl) {
        otaControl = document.createElement('div');
        otaControl.id = 'resumate-ota-control';
        otaControl.setAttribute('role', 'group');
        otaControl.setAttribute('aria-label', 'OTA updates');
        otaControl.style.cssText = 'position:fixed;right:12px;bottom:calc(12px + env(safe-area-inset-bottom));z-index:2147483646;background:rgba(17,17,17,.94);color:#fff;padding:7px 9px 7px 11px;border-radius:999px;box-shadow:0 4px 18px rgba(0,0,0,.22);font:600 12px system-ui,-apple-system,Segoe UI,sans-serif;display:flex;align-items:center;gap:8px;backdrop-filter:blur(8px);';
        document.body.appendChild(otaControl);
      }
      otaControl.innerHTML = '<span>OTA</span><label style="display:flex;align-items:center;gap:5px;cursor:pointer"><input id="resumate-ota-enabled" type="checkbox" style="width:16px;height:16px;margin:0;accent-color:#fff" ' + (isEnabled() ? 'checked' : '') + '><span>' + (isEnabled() ? 'ON' : 'OFF') + '</span></label>';
      var toggle = otaControl.querySelector('#resumate-ota-enabled');
      if (toggle) toggle.addEventListener('change', function () { setEnabled(toggle.checked); });
    } catch (_) {}
  }

  function showUpdateBanner(build) {
    pendingBuild = String(build);
    mark('update-available', pendingBuild);
    if (banner || !document.body) return;
    banner = document.createElement('div');
    banner.id = 'resumate-ota-update-banner';
    banner.setAttribute('role', 'alert');
    banner.innerHTML = '<div style="font-weight:700;font-size:14px;margin-bottom:4px">New ResuMate update available</div>' +
      '<div style="font-size:12px;opacity:.82;margin-bottom:10px">Update now to get the latest improvements.</div>' +
      '<div style="display:flex;align-items:center;gap:10px">' +
      '<button id="resumate-ota-update-toggle" type="button" aria-pressed="false" style="appearance:none;border:0;border-radius:999px;padding:9px 15px;font-weight:700;cursor:pointer">Update now</button>' +
      '<button id="resumate-ota-dismiss" type="button" style="background:transparent;border:0;color:inherit;opacity:.75;padding:6px;cursor:pointer">Later</button></div>';
    banner.style.cssText = 'position:fixed;left:12px;right:12px;bottom:calc(56px + env(safe-area-inset-bottom));z-index:2147483647;background:#111;color:#fff;padding:14px 16px;border-radius:14px;box-shadow:0 8px 30px rgba(0,0,0,.28);font-family:system-ui,-apple-system,Segoe UI,sans-serif;box-sizing:border-box;';
    document.body.appendChild(banner);
    var updateButton = document.getElementById('resumate-ota-update-toggle'), laterButton = document.getElementById('resumate-ota-dismiss');
    if (updateButton) updateButton.addEventListener('click', function () {
      updateButton.setAttribute('aria-pressed', 'true'); updateButton.textContent = 'Updating…'; updateButton.disabled = true;
      loadRemoteApp(pendingBuild).catch(function () { updateButton.disabled = false; updateButton.textContent = 'Retry update'; });
    });
    if (laterButton) laterButton.addEventListener('click', function () { if (banner && banner.parentNode) banner.parentNode.removeChild(banner); banner = null; mark('update-pending', pendingBuild); });
    ring(); notifyNativeOrWeb();
  }

  function loadRemoteApp(build) {
    if (reloading) return Promise.resolve();
    reloading = true;
    var target = String(build);
    mark('loading', target);
    return fetch(buildIndex(target) + '?v=' + encodeURIComponent(target), { cache: 'no-store', credentials: 'omit' })
      .then(function (r) { if (!r.ok) throw new Error('remote app HTTP ' + r.status); return r.text(); })
      .then(function (html) {
        return dbPut('active', { build: target, html: html, savedAt: Date.now() }).then(function () {
          document.open(); document.write(prepareRemoteHtml(html, target)); document.close();
          reloading = false; startingBuild = target; pendingBuild = null; applyUiChromeFix(); mark('updated', target);
        });
      })
      .catch(function (error) { reloading = false; mark('fallback', String(error && error.message || error)); throw error; });
  }

  function check() {
    if (restoring) return;
    if (!isEnabled()) { applyUiChromeFix(); mark('disabled-by-user', 'OTA updates are disabled.'); return; }
    if (!navigator.onLine) { applyUiChromeFix(); mark('offline', 'Using bundled or cached application.'); return; }
    fetch(VERSION_URL + '?t=' + Date.now(), { cache: 'no-store', credentials: 'omit' })
      .then(function (r) { if (!r.ok) throw new Error('version manifest HTTP ' + r.status); return r.json(); })
      .then(function (manifest) {
        if (restoring) return;
        if (!manifest || manifest.enabled === false) { applyUiChromeFix(); mark('disabled'); return; }
        var build = String(manifest.build || manifest.version || '');
        if (!build) throw new Error('OTA manifest build missing');
        if (startingBuild === null) startingBuild = build;
        if (build !== startingBuild) { applyUiChromeFix(); showUpdateBanner(build); return; }
        applyUiChromeFix(); mark('current', build);
      })
      .catch(function (error) { applyUiChromeFix(); mark('check-failed', String(error && error.message || error)); });
  }

  window.ResuMateOTA = { baseUrl: RAW_ROOT, versionUrl: VERSION_URL, pollMs: POLL_MS, check: check, setEnabled: setEnabled, isEnabled: isEnabled, update: function () { return pendingBuild ? loadRemoteApp(pendingBuild) : Promise.resolve(); }, status: function () { return window.__RESUMATE_OTA__ || null; } };

  function start() {
    applyUiChromeFix();
    renderOtaControl();
    restoreCachedApp().then(function (restored) {
      renderOtaControl();
      if (!restored) check();
      setInterval(check, POLL_MS);
      document.addEventListener('visibilitychange', function () { if (!document.hidden) check(); });
      window.addEventListener('online', check);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
