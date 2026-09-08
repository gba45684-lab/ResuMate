/* ResuMate full-app OTA loader. Bundled once into the APK. */
(function () {
  'use strict';

  var BASE = 'https://raw.githubusercontent.com/gba45684-lab/ResuMate/main/www/';
  var INDEX_URL = BASE + 'index.html';
  var VERSION_URL = 'https://raw.githubusercontent.com/gba45684-lab/ResuMate/main/ota/version.json';
  var POLL_MS = 3000;
  var startingBuild = window.__RESUMATE_BUNDLED_BUILD__ || null;
  var pendingBuild = null;
  var reloading = false;
  var banner = null;
  var audioContext = null;

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
      ].join('\n');
      (document.head || document.documentElement).appendChild(style);
      var metas = document.querySelectorAll('meta[name="viewport"]');
      metas.forEach(function (meta) {
        var content = meta.getAttribute('content') || '';
        if (/viewport-fit\s*=\s*cover/i.test(content)) {
          meta.setAttribute('content', content.replace(/,?\s*viewport-fit\s*=\s*cover/ig, ''));
        }
      });
    } catch (_) {}
  }

  function mark(status, detail) {
    try {
      window.__RESUMATE_OTA__ = { status: status, detail: detail || '', checkedAt: new Date().toISOString(), pollMs: POLL_MS, bundledBuild: startingBuild || null, pendingBuild: pendingBuild || null };
      window.dispatchEvent(new CustomEvent('resumate:ota-status', { detail: window.__RESUMATE_OTA__ }));
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

  function injectBuildMarker(html, build) {
    var marker = '<script>window.__RESUMATE_BUNDLED_BUILD__=' + JSON.stringify(String(build)) + ';</script>';
    html = html.replace(/<script[^>]*>\s*window\.__RESUMATE_BUNDLED_BUILD__\s*=.*?<\/script>/gis, '');
    if (/<head[^>]*>/i.test(html)) return html.replace(/<head([^>]*)>/i, '<head$1>' + marker);
    return marker + html;
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
        html = html.replace(/<script\b[^>]*src=["'][^"']*resumate-ota-loader\.js(?:\?[^"']*)?["'][^>]*>\s*<\/script>/gi, '');
        html = injectBuildMarker(html, build);
        var remoteBase = '<base href="' + BASE + '">';
        if (!/<base\s/i.test(html)) html = html.replace(/<head([^>]*)>/i, '<head$1>' + remoteBase);
        var loaderTag = '<script src="' + BASE + 'resumate-ota-loader.js?v=' + encodeURIComponent(build) + '" defer></script>';
        if (/<\/body>/i.test(html)) html = html.replace(/<\/body>/i, loaderTag + '\n</body>');
        else html += loaderTag;
        document.open();
        document.write(html);
        document.close();
        reloading = false;
        startingBuild = String(build);
        pendingBuild = null;
        applyUiChromeFix();
        mark('updated', String(build));
      })
      .catch(function (error) {
        reloading = false;
        mark('fallback', String(error && error.message || error));
        throw error;
      });
  }

  function check(initial) {
    if (!navigator.onLine) { applyUiChromeFix(); mark('offline', 'Using bundled application.'); return; }
    fetch(VERSION_URL + '?t=' + Date.now(), { cache: 'no-store', credentials: 'omit' })
      .then(function (r) {
        if (!r.ok) throw new Error('version manifest HTTP ' + r.status);
        return r.json();
      })
      .then(function (manifest) {
        if (!manifest || manifest.enabled === false) { applyUiChromeFix(); mark('disabled'); return; }
        var build = String(manifest.build || manifest.version || Date.now());
        if (startingBuild === null) {
          startingBuild = build;
          applyUiChromeFix();
          mark('current', build);
          return;
        }
        if (build !== startingBuild) {
          applyUiChromeFix();
          showUpdateBanner(build);
          return;
        }
        applyUiChromeFix();
        mark('current', build);
      })
      .catch(function (error) { applyUiChromeFix(); mark('check-failed', String(error && error.message || error)); });
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
    applyUiChromeFix();
    check(true);
    setInterval(function () { check(false); }, POLL_MS);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) check(false); });
    window.addEventListener('online', function () { check(false); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
