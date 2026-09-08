/* ResuMate full-app OTA loader. Bundled once into the APK. */
(function () {
  'use strict';

  var RAW_ROOT = 'https://raw.githubusercontent.com/gba45684-lab/ResuMate/';
  var VERSION_URL = RAW_ROOT + 'main/ota/version.json';
  var POLL_MS = 3000;
  var startingBuild = window.__RESUMATE_BUNDLED_BUILD__ || null;
  var pendingBuild = null;
  var pendingReleaseNotes = [];
  var reloading = false;
  var restoring = false;
  var banner = null;
  var otaControl = null;
  var controlObserver = null;
  var audioContext = null;
  var DB_NAME = 'resumate-ota';
  var DB_VERSION = 1;
  var STORE = 'app';
  var OTA_ENABLED_KEY = 'resumate.ota.enabled';
  var OTA_POS_KEY = 'resumate.ota.position';
  var OTA_MIN_KEY = 'resumate.ota.minimized';

  function isEnabled() {
    try { localStorage.setItem(OTA_ENABLED_KEY, 'true'); } catch (_) {}
    return true;
  }

  function setEnabled(value) {
    value = true;
    try { localStorage.setItem(OTA_ENABLED_KEY, 'true'); } catch (_) {}
    mark('enabled', 'OTA updates are always enabled.');
    ensureOtaControl(true);
    check();
    return value;
  }

  function buildBase(build) { return RAW_ROOT + encodeURIComponent(String(build)) + '/www/'; }
  function buildIndex(build) { return buildBase(build) + 'index.html'; }
  function buildLoader(build) { return buildBase(build) + 'resumate-ota-loader.js?v=' + encodeURIComponent(String(build)); }

  function applyPreviewUiFix() {
    try {
      if (!document.head) return;
      var old = document.getElementById('resumate-preview-ui-fix');
      if (old) old.remove();
      var style = document.createElement('style');
      style.id = 'resumate-preview-ui-fix';
      style.textContent = [
        '/* Preview control separation: ball -> rail -> flyout, never overlapping. */',
        '.preview-studio { position:relative !important; overflow:visible !important; }',
        '.preview-stage-wrap { padding-right:76px !important; box-sizing:border-box !important; }',
        '.ball-trigger { right:14px !important; width:52px !important; height:52px !important; z-index:30 !important; }',
        '.preview-rail { right:76px !important; width:56px !important; padding:10px 7px !important; gap:5px !important; z-index:29 !important; box-shadow:0 18px 44px rgba(0,0,0,.16) !important; backdrop-filter:blur(12px) !important; }',
        '.preview-rail .rail-btn { width:40px !important; height:40px !important; font-size:16px !important; border-radius:11px !important; }',
        '.preview-rail .sep { width:30px !important; margin:5px 0 !important; }',
        '.preview-rail .rail-btn .label { right:50px !important; z-index:32 !important; }',
        '.flyout { right:144px !important; z-index:31 !important; max-width:calc(100% - 156px) !important; box-sizing:border-box !important; }',
        '.flyout.open { z-index:35 !important; }',
        '.preview-rail.open { z-index:29 !important; }',
        '@media (max-width:600px) {',
        '  .preview-stage-wrap { padding-right:66px !important; }',
        '  .ball-trigger { right:8px !important; width:48px !important; height:48px !important; font-size:17px !important; z-index:30 !important; }',
        '  .preview-rail { right:64px !important; width:50px !important; padding:8px 6px !important; gap:4px !important; max-height:min(72vh,420px) !important; z-index:29 !important; }',
        '  .preview-rail .rail-btn { width:38px !important; height:38px !important; font-size:15px !important; border-radius:10px !important; }',
        '  .preview-rail .sep { width:26px !important; margin:5px 0 !important; }',
        '  .preview-rail .rail-btn .label { display:none !important; }',
        '  .flyout { right:116px !important; width:min(250px,calc(100vw - 128px)) !important; max-width:none !important; max-height:min(68vh,360px) !important; z-index:35 !important; }',
        '}',
        '@media (max-width:350px) {',
        '  .preview-stage-wrap { padding-right:60px !important; }',
        '  .ball-trigger { right:6px !important; width:44px !important; height:44px !important; }',
        '  .preview-rail { right:56px !important; width:46px !important; padding:7px 5px !important; }',
        '  .preview-rail .rail-btn { width:34px !important; height:34px !important; font-size:14px !important; }',
        '  .flyout { right:106px !important; width:calc(100vw - 116px) !important; }',
        '}',
        '@media (prefers-reduced-motion:reduce) {',
        '  .ball-trigger, .preview-rail, .flyout, .preview-rail .rail-btn { transition:none !important; }',
        '}'
      ].join('\n');
      document.head.appendChild(style);
    } catch (_) {}
  }

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
        '[style*="safe-area-inset-top"] { padding-top: 0 !important; margin-top: 0 !important; }'
      ].join('\n');
      (document.head || document.documentElement).appendChild(style);
      document.querySelectorAll('meta[name="viewport"]').forEach(function (meta) {
        var content = meta.getAttribute('content') || '';
        if (/viewport-fit\s*=\s*cover/i.test(content)) meta.setAttribute('content', content.replace(/,?\s*viewport-fit\s*=\s*cover/ig, ''));
      });
      applyPreviewUiFix();
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
    html = html.replace(/<script[^>]*>\s*window\.__RESUMATE_BUNDLED_BUILD__\s*=.*?<\/script>/gis, '');
    return /<head[^>]*>/i.test(html) ? html.replace(/<head([^>]*)>/i, '<head$1>' + marker) : marker + html;
  }

  function prepareRemoteHtml(html, build) {
    html = String(html).replace(/<script\b[^>]*src=["'][^"']*resumate-ota-loader\.js(?:\?[^"']*)?["'][^>]*>\s*<\/script>/gi, '');
    html = injectBuildMarker(html, build);
    var base = buildBase(build);
    if (!/<base\s/i.test(html)) html = html.replace(/<head([^>]*)>/i, '<head$1><base href="' + base + '">');
    var tag = '<script src="' + buildLoader(build) + '" defer></script>';
    return /<\/body>/i.test(html) ? html.replace(/<\/body>/i, tag + '\n</body>') : html + tag;
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
      window.__RESUMATE_OTA__ = { status: status, detail: detail || '', enabled: true, checkedAt: new Date().toISOString(), pollMs: POLL_MS, bundledBuild: startingBuild || null, pendingBuild: pendingBuild || null };
      window.dispatchEvent(new CustomEvent('resumate:ota-status', { detail: window.__RESUMATE_OTA__ }));
      ensureOtaControl();
    } catch (_) {}
  }

  function ring() {
    try { if (navigator.vibrate) navigator.vibrate([160, 80, 160, 80, 220]); } catch (_) {}
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      audioContext = audioContext || new AC();
      if (audioContext.state === 'suspended') audioContext.resume().catch(function () {});
      var now = audioContext.currentTime;
      [
        { offset: 0, freq: 660 },
        { offset: 0.22, freq: 880 },
        { offset: 0.44, freq: 1046 }
      ].forEach(function (tone) {
        var osc = audioContext.createOscillator(), gain = audioContext.createGain();
        osc.type = 'sine'; osc.frequency.value = tone.freq;
        gain.gain.setValueAtTime(0.0001, now + tone.offset);
        gain.gain.exponentialRampToValueAtTime(0.42, now + tone.offset + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + tone.offset + 0.20);
        osc.connect(gain); gain.connect(audioContext.destination);
        osc.start(now + tone.offset); osc.stop(now + tone.offset + 0.22);
      });
    } catch (_) {}
  }

  function notifyNativeOrWeb() {
    try {
      if ('Notification' in window && Notification.permission === 'granted') new Notification('ResuMate update available', { body: 'A new ResuMate version is ready. Tap Update to apply it.' });
    } catch (_) {}
  }

  function readOtaPosition() {
    try {
      var raw = localStorage.getItem(OTA_POS_KEY);
      if (!raw) return null;
      var pos = JSON.parse(raw);
      if (typeof pos.x !== 'number' || typeof pos.y !== 'number') return null;
      return pos;
    } catch (_) { return null; }
  }

  function saveOtaPosition(x, y) {
    try { localStorage.setItem(OTA_POS_KEY, JSON.stringify({ x: Math.round(x), y: Math.round(y) })); } catch (_) {}
  }

  function isMinimized() {
    try { return localStorage.getItem(OTA_MIN_KEY) === 'true'; } catch (_) { return false; }
  }

  function setMinimized(value) {
    try { localStorage.setItem(OTA_MIN_KEY, value ? 'true' : 'false'); } catch (_) {}
    ensureOtaControl(true);
  }

  function clampOtaPosition(x, y) {
    var w = otaControl ? otaControl.offsetWidth || 88 : 88;
    var h = otaControl ? otaControl.offsetHeight || 38 : 38;
    var maxX = Math.max(0, window.innerWidth - w - 6);
    var maxY = Math.max(0, window.innerHeight - h - 6);
    return { x: Math.min(Math.max(6, x), maxX), y: Math.min(Math.max(6, y), maxY) };
  }

  function applyOtaPosition() {
    if (!otaControl) return;
    var saved = readOtaPosition();
    if (saved) {
      var p = clampOtaPosition(saved.x, saved.y);
      otaControl.style.left = p.x + 'px';
      otaControl.style.top = p.y + 'px';
      otaControl.style.right = 'auto';
      otaControl.style.bottom = 'auto';
    } else {
      otaControl.style.left = 'auto';
      otaControl.style.top = 'auto';
      otaControl.style.right = '12px';
      otaControl.style.bottom = 'calc(12px + env(safe-area-inset-bottom))';
    }
  }

  function wireOtaDragging() {
    if (!otaControl || otaControl.__dragWired) return;
    otaControl.__dragWired = true;
    otaControl.style.touchAction = 'none';
    var dragging = false, moved = false, startX = 0, startY = 0, baseX = 0, baseY = 0;

    otaControl.addEventListener('pointerdown', function (event) {
      if (event.target && (event.target.closest('button') || event.target.closest('input'))) return;
      var rect = otaControl.getBoundingClientRect();
      dragging = true;
      moved = false;
      startX = event.clientX;
      startY = event.clientY;
      baseX = rect.left;
      baseY = rect.top;
      try { otaControl.setPointerCapture(event.pointerId); } catch (_) {}
      event.preventDefault();
    });

    otaControl.addEventListener('pointermove', function (event) {
      if (!dragging) return;
      var dx = event.clientX - startX;
      var dy = event.clientY - startY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
      var p = clampOtaPosition(baseX + dx, baseY + dy);
      otaControl.style.left = p.x + 'px';
      otaControl.style.top = p.y + 'px';
      otaControl.style.right = 'auto';
      otaControl.style.bottom = 'auto';
      event.preventDefault();
    });

    otaControl.addEventListener('pointerup', function (event) {
      if (!dragging) return;
      dragging = false;
      var rect = otaControl.getBoundingClientRect();
      saveOtaPosition(rect.left, rect.top);
      try { otaControl.releasePointerCapture(event.pointerId); } catch (_) {}
      if (moved) {
        try { event.stopPropagation(); } catch (_) {}
      }
    });

    otaControl.addEventListener('pointercancel', function () { dragging = false; });
  }

  function ensureOtaControl(force) {
    if (!document.body) return;
    try {
      var existing = document.getElementById('resumate-ota-control');
      if (existing && otaControl !== existing) otaControl = existing;
      if (!otaControl || !otaControl.isConnected) {
        otaControl = document.createElement('div');
        otaControl.id = 'resumate-ota-control';
        otaControl.setAttribute('role', 'group');
        otaControl.setAttribute('aria-label', 'OTA updates');
        otaControl.style.cssText = 'position:fixed;z-index:2147483647;background:rgba(17,17,17,.97);color:#fff;padding:7px 9px 7px 11px;border-radius:999px;box-shadow:0 4px 18px rgba(0,0,0,.30);font:600 12px system-ui,-apple-system,Segoe UI,sans-serif;display:flex;align-items:center;gap:7px;backdrop-filter:blur(8px);pointer-events:auto;visibility:visible;opacity:1;user-select:none;max-width:calc(100vw - 12px);box-sizing:border-box;';
        document.body.appendChild(otaControl);
      }
      if (force || !otaControl.querySelector('#resumate-ota-enabled')) {
        if (isMinimized()) {
          otaControl.innerHTML = '<span id="resumate-ota-restore" role="button" tabindex="0" aria-label="Restore OTA control" style="display:inline-flex;align-items:center;justify-content:center;min-width:36px;height:24px;padding:0 7px;border-radius:999px;cursor:pointer;background:#fff;color:#111;font-weight:800;">OTA</span>';
          var restore = otaControl.querySelector('#resumate-ota-restore');
          if (restore) {
            var restoreOta = function () { setMinimized(false); };
            restore.addEventListener('click', restoreOta);
            restore.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); restoreOta(); } });
          }
        } else {
          otaControl.innerHTML = '<span id="resumate-ota-drag" title="Drag anywhere" style="user-select:none;cursor:grab;">OTA</span><label style="display:flex;align-items:center;gap:5px;cursor:default"><input id="resumate-ota-enabled" type="checkbox" aria-label="OTA updates are always enabled" checked disabled style="width:16px;height:16px;margin:0;accent-color:#fff"><span id="resumate-ota-state">ON</span><span style="font-size:10px;opacity:.72;user-select:none">Always on</span></label><button id="resumate-ota-minimize" type="button" aria-label="Minimize OTA control" title="Minimize" style="appearance:none;border:0;background:transparent;color:#fff;font-size:15px;line-height:1;padding:1px 2px;cursor:pointer;">−</button>';
          var minimize = otaControl.querySelector('#resumate-ota-minimize');
          if (minimize) minimize.addEventListener('click', function (event) { event.stopPropagation(); setMinimized(true); });
        }
      }
      applyOtaPosition();
      wireOtaDragging();
      if (!controlObserver && window.MutationObserver) {
        controlObserver = new MutationObserver(function () {
          if (!document.getElementById('resumate-ota-control')) {
            otaControl = null;
            ensureOtaControl(true);
          }
        });
        controlObserver.observe(document.body, { childList: true });
      }
    } catch (_) {}
  }

  function normalizeReleaseNotes(notes) {
    if (!Array.isArray(notes)) return [];
    return notes.map(function (note) { return String(note || '').trim(); }).filter(Boolean).slice(0, 8);
  }

  function showUpdateBanner(build, releaseNotes) {
    pendingBuild = String(build);
    pendingReleaseNotes = normalizeReleaseNotes(releaseNotes);
    mark('update-available', pendingBuild);
    if (banner || !document.body) return;
    banner = document.createElement('div');
    banner.id = 'resumate-ota-update-banner';
    banner.setAttribute('role', 'alert');
    var notesHtml = pendingReleaseNotes.length
      ? pendingReleaseNotes.map(function (note) { return '<li style="margin:4px 0">' + note.replace(/[&<>]/g, function (ch) { return ({'&':'&amp;','<':'&lt;','>':'&gt;'}[ch]); }) + '</li>'; }).join('')
      : '<li style="margin:4px 0">Latest ResuMate improvements and fixes.</li>';
    banner.innerHTML = '<div style="font-weight:700;font-size:14px;margin-bottom:4px">New ResuMate update available</div>' +
      '<div style="font-size:12px;opacity:.82;margin-bottom:10px">Review what changed before installing.</div>' +
      '<div id="resumate-ota-details" style="display:none;background:#1b1b1b;border:1px solid rgba(255,255,255,.12);border-radius:10px;padding:10px 12px;margin:0 0 12px;font-size:11px;line-height:1.45"><div style="font-weight:700;margin-bottom:5px">What’s new</div><ul style="padding-left:18px;margin:0">' + notesHtml + '</ul></div>' +
      '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">' +
      '<button id="resumate-ota-update-toggle" type="button" aria-expanded="false" style="appearance:none;border:0;border-radius:999px;padding:9px 15px;font-weight:700;cursor:pointer;background:#fff;color:#111">See what’s new</button>' +
      '<button id="resumate-ota-dismiss" type="button" style="background:transparent;border:0;color:inherit;opacity:.75;padding:6px;cursor:pointer">Later</button></div>';
    banner.style.cssText = 'position:fixed;left:12px;right:12px;bottom:calc(56px + env(safe-area-inset-bottom));z-index:2147483647;background:#111;color:#fff;padding:14px 16px;border-radius:14px;box-shadow:0 8px 30px rgba(0,0,0,.28);font-family:system-ui,-apple-system,Segoe UI,sans-serif;box-sizing:border-box;';
    document.body.appendChild(banner);
    var updateButton = document.getElementById('resumate-ota-update-toggle'), laterButton = document.getElementById('resumate-ota-dismiss');
    if (updateButton) updateButton.addEventListener('click', function () {
      var details = document.getElementById('resumate-ota-details');
      var expanded = updateButton.getAttribute('aria-expanded') === 'true';
      if (!expanded) {
        if (details) details.style.display = 'block';
        updateButton.setAttribute('aria-expanded', 'true');
        updateButton.textContent = 'Update now';
        return;
      }
      updateButton.textContent = 'Updating…';
      updateButton.disabled = true;
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
          reloading = false; startingBuild = target; pendingBuild = null; applyUiChromeFix(); ensureOtaControl(true); mark('updated', target);
        });
      })
      .catch(function (error) { reloading = false; mark('fallback', String(error && error.message || error)); throw error; });
  }

  function check() {
    if (restoring) return;
    if (!isEnabled()) { applyUiChromeFix(); ensureOtaControl(); mark('disabled-by-user', 'OTA updates are disabled.'); return; }
    if (!navigator.onLine) { applyUiChromeFix(); ensureOtaControl(); mark('offline', 'Using bundled or cached application.'); return; }
    fetch(VERSION_URL + '?t=' + Date.now(), { cache: 'no-store', credentials: 'omit' })
      .then(function (r) { if (!r.ok) throw new Error('version manifest HTTP ' + r.status); return r.json(); })
      .then(function (manifest) {
        if (restoring) return;
        if (!manifest || manifest.enabled === false) { applyUiChromeFix(); ensureOtaControl(); mark('disabled'); return; }
        var build = String(manifest.build || manifest.version || '');
        if (!build) throw new Error('OTA manifest build missing');
        if (startingBuild === null) startingBuild = build;
        var releaseNotes = normalizeReleaseNotes(manifest.releaseNotes || manifest.notes);
        if (build !== startingBuild) { applyUiChromeFix(); ensureOtaControl(); showUpdateBanner(build, releaseNotes); return; }
        applyUiChromeFix(); ensureOtaControl(); mark('current', build);
      })
      .catch(function (error) { applyUiChromeFix(); ensureOtaControl(); mark('check-failed', String(error && error.message || error)); });
  }

  window.ResuMateOTA = {
    baseUrl: RAW_ROOT,
    versionUrl: VERSION_URL,
    pollMs: POLL_MS,
    check: check,
    setEnabled: setEnabled,
    isEnabled: isEnabled,
    update: function () { return pendingBuild ? loadRemoteApp(pendingBuild) : Promise.resolve(); },
    status: function () { return window.__RESUMATE_OTA__ || null; }
  };

  function start() {
    applyUiChromeFix();
    ensureOtaControl(true);
    restoreCachedApp().then(function (restored) {
      ensureOtaControl(true);
      if (!restored) check();
      setInterval(check, POLL_MS);
      document.addEventListener('visibilitychange', function () { if (!document.hidden) { ensureOtaControl(); check(); } });
      window.addEventListener('online', check);
      window.addEventListener('pageshow', function () { ensureOtaControl(true); });
      window.addEventListener('resize', function () { applyOtaPosition(); applyPreviewUiFix(); });
      // Keep the floating OTA control alive even if the SPA replaces/rebuilds body content.
      setInterval(function () { ensureOtaControl(); applyPreviewUiFix(); }, 1200);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
