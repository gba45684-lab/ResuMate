/* ResuMate full-app OTA loader. Bundled once into the APK. */
(function () {
  'use strict';

  var BASE = 'https://raw.githubusercontent.com/gba45684-lab/ResuMate/main/www/';
  var INDEX_URL = BASE + 'index.html';
  var VERSION_URL = 'https://raw.githubusercontent.com/gba45684-lab/ResuMate/main/ota/version.json';
  var POLL_MS = 3000;
  var startingBuild = null;
  var pendingBuild = null;
  var reloading = false;
  var banner = null;
  var audioContext = null;

  function mark(status, detail) {
    try {
      window.__RESUMATE_OTA__ = { status: status, detail: detail || '', checkedAt: new Date().toISOString(), pollMs: POLL_MS, pendingBuild: pendingBuild || null };
      window.dispatchEvent(new CustomEvent('resumate:ota-status', { detail: window.__RESUMATE_OTA__ }));
    } catch (_) {}
  }

  function ring() {
    try {
      if (navigator.vibrate) navigator.vibrate([120, 70, 120]);
    } catch (_) {}
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      audioContext = audioContext || new AC();
      if (audioContext.state === 'suspended') audioContext.resume().catch(function () {});
      var now = audioContext.currentTime;
      [0, 0.22].forEach(function (offset) {
        var osc = audioContext.createOscillator();
        var gain = audioContext.createGain();
        osc.type = 'sine';
        osc.frequency.value = offset ? 880 : 660;
        gain.gain.setValueAtTime(0.0001, now + offset);
        gain.gain.exponentialRampToValueAtTime(0.16, now + offset + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.16);
        osc.connect(gain);
        gain.connect(audioContext.destination);
        osc.start(now + offset);
        osc.stop(now + offset + 0.18);
      });
    } catch (_) {}
  }

  function notifyNativeOrWeb() {
    try {
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification('ResuMate update available', { body: 'A new ResuMate version is ready. Tap Update to apply it.' });
      } else if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission().then(function (p) {
          if (p === 'granted') {
            try { new Notification('ResuMate update available', { body: 'A new version is ready.' }); } catch (_) {}
          }
        }).catch(function () {});
      }
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
      '<button id="resumate-ota-dismiss" type="button" style="background:transparent;border:0;color:inherit;opacity:.75;padding:6px;cursor:pointer">Later</button>' +
      '</div>';
    banner.style.cssText = 'position:fixed;left:12px;right:12px;bottom:calc(12px + env(safe-area-inset-bottom));z-index:2147483647;background:#111;color:#fff;padding:14px 16px;border-radius:14px;box-shadow:0 8px 30px rgba(0,0,0,.28);font-family:system-ui,-apple-system,Segoe UI,sans-serif;box-sizing:border-box;';
    document.body.appendChild(banner);

    var updateButton = document.getElementById('resumate-ota-update-toggle');
    var laterButton = document.getElementById('resumate-ota-dismiss');
    if (updateButton) updateButton.addEventListener('click', function () {
      updateButton.setAttribute('aria-pressed', 'true');
      updateButton.textContent = 'Updating…';
      updateButton.disabled = true;
      loadRemoteApp(pendingBuild).catch(function () {
        updateButton.disabled = false;
        updateButton.textContent = 'Retry update';
      });
    });
    if (laterButton) laterButton.addEventListener('click', function () {
      if (banner && banner.parentNode) banner.parentNode.removeChild(banner);
      banner = null;
      mark('update-pending', pendingBuild);
    });

    ring();
    notifyNativeOrWeb();
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
        html = html.replace(/<script[^>]+resumate-ota-loader\\.js[^>]*><\\/script>/gi, '');
        var remoteBase = '<base href="' + BASE + '">';
        if (!/<base\s/i.test(html)) html = html.replace(/<head([^>]*)>/i, '<head$1>' + remoteBase);
        document.open();
        document.write(html);
        document.close();
        reloading = false;
        pendingBuild = null;
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
          showUpdateBanner(build);
          return;
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
    update: function () { return pendingBuild ? loadRemoteApp(pendingBuild) : Promise.resolve(); },
    status: function () { return window.__RESUMATE_OTA__ || null; }
  };

  function start() {
    check(true);
    setInterval(function () { check(false); }, POLL_MS);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) check(false); });
    window.addEventListener('online', function () { check(false); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
