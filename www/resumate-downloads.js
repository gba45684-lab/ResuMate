/* ResuMate download manager: local persistence + native download notifications + haptics. */
(function () {
  'use strict';

  var DB_NAME = 'resumate-downloads';
  var DB_VERSION = 1;
  var STORE = 'files';
  var MAX_FILES = 50;
  var panel = null;

  function vibrate(pattern) {
    try { if (navigator.vibrate) navigator.vibrate(pattern || [35]); } catch (_) {}
  }

  function nativeNotifications() {
    try {
      return window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.ResuMateNotifications;
    } catch (_) { return null; }
  }

  function blobToBase64(blob) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        var value = String(reader.result || '');
        var comma = value.indexOf(',');
        resolve(comma >= 0 ? value.slice(comma + 1) : value);
      };
      reader.onerror = function () { reject(reader.error || new Error('Could not encode document')); };
      reader.readAsDataURL(blob);
    });
  }

  function notifyNative(blob, name) {
    var plugin = nativeNotifications();
    if (!plugin || !blob || !blob.size) return Promise.resolve(false);
    return blobToBase64(blob).then(function (dataBase64) {
      return plugin.saveAndNotify({ filename: name, mimeType: blob.type || 'application/octet-stream', dataBase64: dataBase64 })
        .then(function () { return true; });
    }).catch(function () { return false; });
  }

  function openDb() {
    return new Promise(function (resolve, reject) {
      if (!('indexedDB' in window)) return reject(new Error('IndexedDB unavailable'));
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          var store = db.createObjectStore(STORE, { keyPath: 'id' });
          store.createIndex('createdAt', 'createdAt');
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error('IndexedDB open failed')); };
    });
  }

  function putFile(record) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(record);
        tx.oncomplete = function () { db.close(); resolve(); };
        tx.onerror = function () { db.close(); reject(tx.error || new Error('save failed')); };
      });
    });
  }

  function listFiles() {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, 'readonly');
        var req = tx.objectStore(STORE).getAll();
        req.onsuccess = function () {
          var rows = (req.result || []).sort(function (a, b) { return b.createdAt - a.createdAt; });
          db.close(); resolve(rows);
        };
        req.onerror = function () { db.close(); reject(req.error); };
      });
    });
  }

  function deleteFile(id) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).delete(id);
        tx.oncomplete = function () { db.close(); resolve(); };
        tx.onerror = function () { db.close(); reject(tx.error); };
      });
    });
  }

  function prune() {
    return listFiles().then(function (rows) {
      if (rows.length <= MAX_FILES) return;
      return Promise.all(rows.slice(MAX_FILES).map(function (r) { return deleteFile(r.id); }));
    }).catch(function () {});
  }

  function formatBytes(n) {
    if (!n) return '0 B';
    var units = ['B', 'KB', 'MB', 'GB'];
    var i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
    return (n / Math.pow(1024, i)).toFixed(i ? 1 : 0) + ' ' + units[i];
  }

  function toast(title, body, success) {
    var old = document.getElementById('resumate-download-toast');
    if (old) old.remove();
    var el = document.createElement('div');
    el.id = 'resumate-download-toast';
    el.setAttribute('role', 'status');
    el.innerHTML = '<div style="font-weight:700">' + title + '</div><div style="font-size:12px;opacity:.82;margin-top:3px">' + body + '</div>';
    el.style.cssText = 'position:fixed;left:14px;right:14px;bottom:calc(18px + env(safe-area-inset-bottom));z-index:2147483646;background:#111;color:#fff;padding:12px 14px;border-radius:12px;box-shadow:0 7px 26px rgba(0,0,0,.28);font:14px system-ui,-apple-system,Segoe UI,sans-serif;box-sizing:border-box;transition:opacity .2s;';
    document.body.appendChild(el);
    setTimeout(function () { el.style.opacity = '0'; setTimeout(function () { if (el.parentNode) el.remove(); }, 250); }, success ? 2800 : 4000);
    vibrate(success ? [35, 45, 35] : [70]);
  }

  function ensurePanel() {
    if (panel) return panel;
    panel = document.createElement('div');
    panel.id = 'resumate-downloads-panel';
    panel.style.cssText = 'display:none;position:fixed;inset:0;z-index:2147483645;background:rgba(0,0,0,.42);font:14px system-ui,-apple-system,Segoe UI,sans-serif;';
    panel.innerHTML = '<div style="position:absolute;left:12px;right:12px;bottom:12px;max-height:78vh;overflow:auto;background:#fff;color:#111;border-radius:18px;padding:16px;box-shadow:0 14px 45px rgba(0,0,0,.35)">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px"><div><div style="font-size:17px;font-weight:800">Saved downloads</div><div style="font-size:12px;opacity:.62">Stored locally on this device</div></div><button id="resumate-downloads-close" type="button" style="border:0;background:#eee;border-radius:999px;padding:8px 12px;font-weight:700">Close</button></div>' +
      '<div id="resumate-downloads-list"></div></div>';
    document.body.appendChild(panel);
    panel.addEventListener('click', function (e) { if (e.target === panel) closePanel(); });
    document.getElementById('resumate-downloads-close').addEventListener('click', closePanel);
    return panel;
  }

  function openPanel() { ensurePanel().style.display = 'block'; renderList(); }
  function closePanel() { if (panel) panel.style.display = 'none'; }

  function renderList() {
    var list = document.getElementById('resumate-downloads-list');
    if (!list) return;
    list.innerHTML = '<div style="padding:18px;text-align:center;opacity:.6">Loading…</div>';
    listFiles().then(function (rows) {
      if (!rows.length) { list.innerHTML = '<div style="padding:22px;text-align:center;opacity:.58">No saved downloads yet.</div>'; return; }
      list.innerHTML = rows.map(function (r) {
        return '<div style="display:flex;align-items:center;gap:10px;padding:11px 0;border-top:1px solid #eee">' +
          '<div style="flex:1;min-width:0"><div style="font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escapeHtml(r.name) + '</div><div style="font-size:11px;opacity:.58">' + formatBytes(r.size) + ' • ' + new Date(r.createdAt).toLocaleString() + '</div></div>' +
          '<button data-open="' + escapeHtml(r.id) + '" type="button" style="border:0;border-radius:9px;padding:8px 10px;font-weight:700">Open</button>' +
          '<button data-delete="' + escapeHtml(r.id) + '" type="button" style="border:0;background:transparent;padding:8px;color:#a00">Delete</button></div>';
      }).join('');
      list.querySelectorAll('[data-open]').forEach(function (b) { b.addEventListener('click', function () { openSaved(b.getAttribute('data-open')); }); });
      list.querySelectorAll('[data-delete]').forEach(function (b) { b.addEventListener('click', function () { deleteFile(b.getAttribute('data-delete')).then(renderList); }); });
    }).catch(function () { list.innerHTML = '<div style="padding:18px;text-align:center">Local storage is unavailable on this device.</div>'; });
  }

  function openSaved(id) {
    openDb().then(function (db) { return new Promise(function (resolve, reject) {
      var req = db.transaction(STORE, 'readonly').objectStore(STORE).get(id);
      req.onsuccess = function () { db.close(); resolve(req.result); };
      req.onerror = function () { db.close(); reject(req.error); };
    }); }).then(function (r) {
      if (!r || !r.blob) return;
      var url = URL.createObjectURL(r.blob);
      var a = document.createElement('a'); a.href = url; a.download = r.name; a.target = '_blank';
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
      toast('Download ready', r.name, true);
    }).catch(function () { toast('Could not open file', 'The saved file is unavailable.', false); });
  }

  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, function (c) { return ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]; }); }

  function saveBlob(blob, name) {
    if (!blob || !blob.size) return Promise.resolve();
    var safeName = String(name || 'ResuMate-download').replace(/[\\/:*?"<>|]/g, '_');
    var record = { id: safeName + '-' + Date.now() + '-' + Math.random().toString(36).slice(2), name: safeName, size: blob.size, type: blob.type || 'application/octet-stream', createdAt: Date.now(), blob: blob };
    return putFile(record)
      .then(prune)
      .then(function () {
        toast('Download saved', safeName + ' is saved locally.', true);
        window.dispatchEvent(new CustomEvent('resumate:download-saved', { detail: { name: safeName, size: blob.size } }));
        return notifyNative(blob, safeName).then(function (nativeDone) {
          if (nativeDone) window.dispatchEvent(new CustomEvent('resumate:native-download-notified', { detail: { name: safeName, size: blob.size } }));
          return nativeDone;
        });
      })
      .catch(function () { toast('Download started', safeName, true); return false; });
  }

  function inspectAnchor(anchor) {
    var href = anchor && anchor.href;
    var name = anchor && anchor.download;
    if (!href || !/^blob:/i.test(href) || !name) return;
    setTimeout(function () {
      fetch(href).then(function (r) { return r.blob(); }).then(function (blob) { return saveBlob(blob, name); }).catch(function () {});
    }, 80);
  }

  function install() {
    if (window.__RESUMATE_DOWNLOADS_INSTALLED__) return;
    window.__RESUMATE_DOWNLOADS_INSTALLED__ = true;
    document.addEventListener('click', function (e) {
      var a = e.target && e.target.closest ? e.target.closest('a[download]') : null;
      if (a) inspectAnchor(a);
    }, true);
    if (window.HTMLAnchorElement && HTMLAnchorElement.prototype.click) {
      var originalClick = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () { inspectAnchor(this); return originalClick.apply(this, arguments); };
    }
    window.ResuMateDownloads = {
      open: openPanel,
      list: listFiles,
      saveBlob: saveBlob,
      requestNativePermission: function () {
        var plugin = nativeNotifications();
        return plugin && plugin.requestNotificationPermission ? plugin.requestNotificationPermission() : Promise.resolve({ granted: false, unsupported: true });
      },
      clear: function () { return listFiles().then(function (rows) { return Promise.all(rows.map(function (r) { return deleteFile(r.id); })); }); }
    };
    var ready = function () { ensurePanel(); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready, { once: true }); else ready();
  }

  install();
})();
