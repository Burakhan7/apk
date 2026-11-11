/**
 * Migros URL Blocker — MAIN world inject
 *
 * Sayfanın history.pushState/replaceState/popstate metodlarını override edip
 * engellenmesi gereken URL'lere navigasyonu durdurur.
 *
 * Konfigürasyon document.documentElement üzerine attribute olarak verilir
 * (CSP inline script bloğu olmasın diye):
 *   data-km-blocked-paths    — JSON array
 *   data-km-redirect-url     — string
 *   data-km-block-homepage   — '1' veya '0'
 *
 * content/migros-handler.js bu dosyayı `chrome.runtime.getURL()` ile yükler.
 */
(function () {
  'use strict';

  if (window.__kmMigrosUrlBlockerActive) return;
  window.__kmMigrosUrlBlockerActive = true;

  var root = document.documentElement;

  function readConfig() {
    var blockedPaths = [];
    try { blockedPaths = JSON.parse(root.getAttribute('data-km-blocked-paths') || '[]'); } catch (_) {}
    var redirectUrl   = root.getAttribute('data-km-redirect-url')  || '/';
    var blockHomepage = root.getAttribute('data-km-block-homepage') === '1';
    return { blockedPaths: blockedPaths, redirectUrl: redirectUrl, blockHomepage: blockHomepage };
  }

  function isBlocked(url, cfg) {
    if (!url) return false;
    var path = url;
    try { path = new URL(url, location.origin).pathname; } catch (_) {}
    if (cfg.blockHomepage && (path === '/' || path === '')) return true;
    return (cfg.blockedPaths || []).some(function (p) {
      return path === '/' + p || path.startsWith('/' + p + '/') || path.startsWith('/' + p + '?');
    });
  }

  var origPush    = history.pushState;
  var origReplace = history.replaceState;

  history.pushState = function (state, title, url) {
    var cfg = readConfig();
    if (isBlocked(url, cfg)) {
      console.log('[KuponMarket] pushState engellendi:', url);
      window.location.href = cfg.redirectUrl;
      return;
    }
    return origPush.apply(this, arguments);
  };

  history.replaceState = function (state, title, url) {
    var cfg = readConfig();
    if (isBlocked(url, cfg)) {
      console.log('[KuponMarket] replaceState engellendi:', url);
      window.location.href = cfg.redirectUrl;
      return;
    }
    return origReplace.apply(this, arguments);
  };

  window.addEventListener('popstate', function () {
    var cfg = readConfig();
    if (isBlocked(location.pathname, cfg)) {
      console.log('[KuponMarket] popstate engellendi:', location.pathname);
      window.location.href = cfg.redirectUrl;
    }
  });
})();
