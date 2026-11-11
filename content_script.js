// ====================================
// UBER / CDN-NET: Fingerprint seed + UA bridge — ISOLATED → MAIN world
// ====================================
(function () {
  var host = window.location.hostname;
  if (!host.includes('uber.com') && !host.includes('cdn-net.com') && !host.includes('cdn-path.com')) return;

  function writeSeedAttr(seed) {
    if (seed) document.documentElement.setAttribute('data-uber-seed', seed);
    if (!seed) return;
    try {
      document.cookie = 'ndv=' + encodeURIComponent(seed) + '; path=/; Secure; SameSite=None';
      document.cookie = 'nrg=TR; path=/; Secure; SameSite=None';
    } catch (_) {}
  }

  // Login'de background yeni uberFpSeed yazar; storage'daki taze seed korunmalı
  // (navigatorOverride.js kurulum başına profil havuzunu bu attribute'tan seçer).
  try {
    chrome.storage.local.get('uberFpSeed', function (result) {
      if (result.uberFpSeed) writeSeedAttr(result.uberFpSeed);
    });
  } catch (_) {}

  chrome.runtime.onMessage.addListener(function (request) {
    if (request.action === 'uberNewFpSeed' && request.seed) {
      writeSeedAttr(request.seed);
      try {
        chrome.storage.local.set({ uberFpSeed: request.seed });
      } catch (_) {}
    }
  });
})();

// ====================================
// UBER: Proxy bridge — MAIN world postMessage → background
// ====================================
(function () {
  var host = window.location.hostname;
  if (!host.includes('uber.com') && !host.includes('cdn-net.com') && !host.includes('cdn-path.com')) return;

  window.addEventListener('message', function (event) {
    if (!event.data || event.data.source !== 'YEMEKTIME_UBER_EXT') return;
    if (event.data.action !== 'uberProxyRequest') return;

    var requestId = event.data.requestId;
    chrome.runtime.sendMessage({
      action: 'uberProxyRequest',
      url: event.data.url,
      method: event.data.method,
      headers: event.data.headers,
      body: event.data.body
    }, function (response) {
      if (chrome.runtime.lastError) {
        response = { success: false, error: chrome.runtime.lastError.message, headers: {} };
      }
      if (!response) {
        response = { success: false, error: 'Background yanıt vermedi', headers: {} };
      }
      window.postMessage({
        source: 'YEMEKTIME_UBER_EXT_CONTENT',
        action: 'proxyResponse',
        requestId: requestId,
        response: response
      }, '*');
    });
  });
})();

// ====================================
// UBER: IDVP köprü + kimlik sayfası yedek tespit
// ====================================
(function () {
  var host = window.location.hostname;
  if (!host.includes('uber.com')) return;
  var sent = false;

  function forwardIdvp(currentUrl) {
    if (sent) return;
    sent = true;
    chrome.runtime.sendMessage({
      action: 'uberIdVerifyDetected',
      currentUrl: currentUrl || window.location.href
    }, function (response) {
      if (chrome.runtime.lastError) {
        response = { success: false, error: chrome.runtime.lastError.message };
      }
      window.postMessage({
        source: 'KM_UBER_IDVP_CONTENT',
        action: 'idvpResult',
        success: !!(response && response.success),
        error: response && response.error
      }, '*');
    });
  }

  window.addEventListener('message', function (event) {
    if (!event.data || event.data.source !== 'KM_UBER_IDVP') return;
    if (event.data.action !== 'uberIdVerifyDetected') return;
    forwardIdvp(event.data.currentUrl);
  });

  function pageLooksLikeIdvp() {
    var href = (window.location.href || '').toLowerCase();
    if (href.indexOf('identity-verification') !== -1 || href.indexOf('idvp') !== -1) return true;
    var t = ((document.body && document.body.innerText) || '').toLowerCase();
    if (!t) return false;
    if (t.indexOf('identity verification') !== -1) return true;
    if (t.indexOf('kimlik doğrulama') !== -1 || t.indexOf('kimlik dogrulama') !== -1) return true;
    if (t.indexOf('fotoğrafını çekin') !== -1 || t.indexOf('fotografini cekin') !== -1) return true;
    return false;
  }

  function checkPage() {
    if (sent) return;
    if (pageLooksLikeIdvp()) forwardIdvp(window.location.href);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', checkPage);
  } else {
    checkPage();
  }
  setInterval(checkPage, 1500);
})();

// Uber çıkış butonlarını kapat
(function () {
  var host = window.location.hostname;
  if (!host.includes('uber.com')) return;

  function disableLogoutNodes() {
    var nodes = document.querySelectorAll('a, button, [role="menuitem"], [data-baseweb="menu-item"]');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var href = (el.getAttribute('href') || '').toLowerCase();
      var txt = (el.textContent || '').trim().toLowerCase();
      var hit = href.indexOf('logout') !== -1 || href.indexOf('sign-out') !== -1 || href.indexOf('signout') !== -1 ||
        txt === 'sign out' || txt === 'log out' || txt === 'çıkış' || txt === 'cikis' || txt.indexOf('sign out') !== -1;
      if (!hit) continue;
      el.style.pointerEvents = 'none';
      el.style.opacity = '0.35';
      el.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
      }, true);
    }
  }

  function start() {
    disableLogoutNodes();
    try {
      new MutationObserver(disableLogoutNodes).observe(document.documentElement, { childList: true, subtree: true });
    } catch (_) {}
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();

// ====================================
// UBER: "Giriş Yapılıyor" overlay
// ====================================
(function () {
  var host = window.location.hostname;
  if (!host.includes('uber.com')) return;

  function uberOverlayShow() {
    if (document.getElementById('uber-login-overlay')) return;
    var overlay = document.createElement('div');
    overlay.id = 'uber-login-overlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;z-index:2147483647;' +
      'background:rgba(0,0,0,0.85);display:flex;align-items:center;justify-content:center;' +
      'padding:12px 20px;pointer-events:none;';
    overlay.innerHTML =
      '<div style="color:#fff;font-size:16px;font-weight:600;font-family:-apple-system,BlinkMacSystemFont,sans-serif;">' +
      'Uber Giriş — İsim güncelleniyor, lütfen bekleyin...</div>';
    document.documentElement.appendChild(overlay);
  }

  function uberOverlayRemove() {
    var el = document.getElementById('uber-login-overlay');
    if (el) el.remove();
  }

  function checkUberLoginOverlay() {
    var href = window.location.href;
    if (href.includes('account.uber.com') && href.includes('update-display-name')) {
      uberOverlayRemove();
      window.location.replace('https://m.uber.com/go/home');
      return;
    }
    if (href.includes('m.uber.com/home') || href.includes('m.uber.com/go/home') || href.includes('m.uber.com/looking')) {
      uberOverlayRemove();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', checkUberLoginOverlay);
  } else {
    checkUberLoginOverlay();
  }

  var _pushState = history.pushState;
  history.pushState = function () {
    _pushState.apply(this, arguments);
    checkUberLoginOverlay();
  };
  var _replaceState = history.replaceState;
  history.replaceState = function () {
    _replaceState.apply(this, arguments);
    checkUberLoginOverlay();
  };
  window.addEventListener('popstate', checkUberLoginOverlay);

  new MutationObserver(function () {
    checkUberLoginOverlay();
  }).observe(document.documentElement, { childList: true, subtree: false });
})();

// Canlı yolculuk: DODO ile aynı — başarıda anasayfa/etkinlik değil /go/trip-progress
(function () {
  var host = window.location.hostname;
  if (!host.includes('uber.com')) return;

  var sent = false;

  function isLiveTripPath() {
    var path = (window.location.pathname || '').toLowerCase();
    return path.indexOf('/go/trip-progress') !== -1 || path.indexOf('/on-trip') !== -1;
  }

  function tripProgressUrl(uuid) {
    var origin = (window.location.hostname || '').indexOf('m.uber.com') !== -1
      ? window.location.origin
      : 'https://m.uber.com';
    var url = origin + '/go/trip-progress';
    if (uuid) url += '?tripUuid=' + encodeURIComponent(uuid);
    return url;
  }

  function forceTripProgress(uuid) {
    if (sent || isLiveTripPath()) return;
    sent = true;
    var target = tripProgressUrl(uuid);
    try { location.replace(target); } catch (_) {}
    setTimeout(function () {
      var path = (window.location.pathname || '').toLowerCase();
      if (path.indexOf('/go/trip-progress') !== -1) return;
      try { location.href = target; } catch (_) {}
    }, 500);
  }

  try {
    chrome.runtime.onMessage.addListener(function (msg) {
      if (!msg || msg.action !== '_nFinal' || !msg.result || !msg.result.ok) return;
      forceTripProgress(msg.result.tripUuid || '');
    });
  } catch (_) {}
})();

// ====================================
// UBER: "Benim için" butonuna otomatik tıklama — yolcu seçim ekranını aç
// ====================================
(function () {
  var host = window.location.hostname;
  if (!host.includes('uber.com')) return;

  var clicked = false;

  function isLiveTripPage() {
    var href = (window.location.href || '').toLowerCase();
    return href.indexOf('trip-progress') !== -1 ||
      href.indexOf('/on-trip') !== -1 ||
      href.indexOf('/go/looking') !== -1 ||
      href.indexOf('m.uber.com/looking') !== -1;
  }

  function tryClickBenimIcin() {
    if (clicked) return;
    if (isLiveTripPage()) return;
    var buttons = document.querySelectorAll('button, [role="button"], [data-testid]');
    for (var i = 0; i < buttons.length; i++) {
      var txt = (buttons[i].textContent || '').trim().toLowerCase();
      if (txt.includes('benim için') || txt.includes('for me') || txt.includes('benim')) {
        clicked = true;
        buttons[i].click();
        return;
      }
    }
  }

  function startObserver() {
    if (clicked) return;
    var observer = new MutationObserver(function () {
      if (!window.location.href.includes('uber.com/go') && !window.location.href.includes('uber.com/home')) return;
      if (isLiveTripPage()) return;
      tryClickBenimIcin();
      if (clicked) observer.disconnect();
    });
    observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
    setTimeout(function () { observer.disconnect(); }, 15000);
  }

  function onPageReady() {
    if (!window.location.href.includes('uber.com/go') && !window.location.href.includes('uber.com/home')) return;
    if (isLiveTripPage()) return;
    setTimeout(function () {
      tryClickBenimIcin();
      if (!clicked) startObserver();
    }, 2000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onPageReady);
  } else {
    onPageReady();
  }

  var _ps = history.pushState;
  history.pushState = function () {
    _ps.apply(this, arguments);
    clicked = false;
    onPageReady();
  };
  window.addEventListener('popstate', function () {
    clicked = false;
    onPageReady();
  });
})();

// Yolculuk oluştur: tıklanınca 5 dk kilit — iptal / yeni yolcu kilidi açmaz
(function () {
  var host = window.location.hostname;
  if (!host.includes('uber.com')) return;

  var COOLDOWN_MS = 5 * 60 * 1000;
  var STORAGE_KEY = 'km_trip_cooldown_until';
  var until = 0;
  var tickTimer = null;
  var pollTimer = null;
  var STYLE_ID = 'km-trip-cooldown-css';
  var ctaSeq = 0;

  function remainingMs() {
    return Math.max(0, until - Date.now());
  }

  function formatRemain(ms) {
    var total = Math.max(0, Math.ceil(ms / 1000));
    var m = Math.floor(total / 60);
    var s = total % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  function norm(raw) {
    return String(raw || '').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function isExemptText(txt) {
    return /iptal|cancel|geri|back|yolcu ekle|add rider|add guest|yeni yolcu|düzenle|duzenle|edit|kaydet|save/.test(txt);
  }

  function isCreateTripText(raw) {
    var txt = norm(raw);
    if (!txt || txt.length > 220) return false;
    if (isExemptText(txt)) return false;
    if (txt.indexOf('yolculuk oluştur') !== -1 || txt.indexOf('yolculuk olustur') !== -1) return true;
    if (txt.indexOf('yolculuğu onayla') !== -1 || txt.indexOf('yolculugu onayla') !== -1) return true;
    if (txt.indexOf('yolculuk çağır') !== -1 || txt.indexOf('yolculuk cagir') !== -1) return true;
    if (txt.indexOf('request uber') !== -1 || txt.indexOf('confirm uber') !== -1) return true;
    if (txt.indexOf('confirm and request') !== -1 || txt.indexOf('request ride') !== -1) return true;
    if (txt.indexOf('request comfort') !== -1 || txt.indexOf('request black') !== -1) return true;
    if (txt.indexOf('isteği gönder') !== -1 || txt.indexOf('istegi gonder') !== -1) return true;
    if (/^(onayla|confirm|request|oluştur|olustur)$/.test(txt)) return true;
    return false;
  }

  function labelOf(el) {
    if (!el || el.nodeType !== 1) return '';
    return norm((el.getAttribute('aria-label') || '') + ' ' + (el.textContent || ''));
  }

  function isCreateTripButton(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.id === 'km-trip-cooldown-banner' || el.hasAttribute('data-km-trip-shield')) return false;
    var tag = (el.tagName || '').toLowerCase();
    var role = (el.getAttribute && el.getAttribute('role')) || '';
    var testid = String(el.getAttribute('data-testid') || '').toLowerCase();
    var clickable = tag === 'button' || tag === 'a' || role === 'button' || el.getAttribute('tabindex') === '0';
    if (/triprequest|request-trip|confirm-trip|request_ride|confirm_ride/.test(testid) && !isExemptText(labelOf(el))) {
      return true;
    }
    if (!clickable) return false;
    return isCreateTripText(labelOf(el));
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent =
      '[data-km-trip-locked="1"]{pointer-events:none!important;opacity:.45!important;filter:grayscale(.25);}' +
      '#km-trip-cooldown-banner{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:2147483646;' +
      'background:#111;color:#fff;font:600 13px/1.4 system-ui,-apple-system,sans-serif;padding:10px 16px;' +
      'border-radius:999px;box-shadow:0 8px 24px rgba(0,0,0,.28);pointer-events:none;white-space:nowrap;}' +
      '[data-km-trip-shield]{position:fixed;z-index:2147483645;background:transparent;touch-action:none;}';
    (document.head || document.documentElement).appendChild(style);
  }

  function bannerEl() {
    var el = document.getElementById('km-trip-cooldown-banner');
    if (el) return el;
    if (!document.body && !document.documentElement) return null;
    el = document.createElement('div');
    el.id = 'km-trip-cooldown-banner';
    (document.body || document.documentElement).appendChild(el);
    return el;
  }

  function syncDomFlag() {
    if (remainingMs() > 0) {
      document.documentElement.setAttribute('data-km-trip-lock-until', String(until));
    } else {
      document.documentElement.removeAttribute('data-km-trip-lock-until');
    }
  }

  function clearShields() {
    var shields = document.querySelectorAll('[data-km-trip-shield]');
    for (var i = 0; i < shields.length; i++) shields[i].remove();
  }

  function syncShields(ctas) {
    var used = {};
    var parent = document.body || document.documentElement;
    if (!parent) return;
    for (var i = 0; i < ctas.length; i++) {
      var btn = ctas[i];
      var id = btn.getAttribute('data-km-cta-id');
      if (!id) {
        id = 'kmcta-' + (++ctaSeq);
        btn.setAttribute('data-km-cta-id', id);
      }
      used[id] = true;
      var shield = document.querySelector('[data-km-trip-shield="' + id + '"]');
      if (!shield) {
        shield = document.createElement('div');
        shield.setAttribute('data-km-trip-shield', id);
        parent.appendChild(shield);
      }
      var r = btn.getBoundingClientRect();
      shield.style.left = Math.max(0, r.left - 6) + 'px';
      shield.style.top = Math.max(0, r.top - 6) + 'px';
      shield.style.width = Math.max(r.width + 12, 48) + 'px';
      shield.style.height = Math.max(r.height + 12, 40) + 'px';
    }
    var leftovers = document.querySelectorAll('[data-km-trip-shield]');
    for (var j = 0; j < leftovers.length; j++) {
      var sid = leftovers[j].getAttribute('data-km-trip-shield');
      if (!used[sid]) leftovers[j].remove();
    }
  }

  function lockButtons(active) {
    var nodes = document.querySelectorAll('button, [role="button"], a, [data-testid], [tabindex="0"]');
    var ctas = [];
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (!isCreateTripButton(el)) {
        if (el.getAttribute('data-km-trip-locked') === '1') el.removeAttribute('data-km-trip-locked');
        continue;
      }
      if (active) {
        el.setAttribute('data-km-trip-locked', '1');
        el.setAttribute('aria-disabled', 'true');
        el.setAttribute('disabled', 'disabled');
        ctas.push(el);
      } else {
        el.removeAttribute('data-km-trip-locked');
        el.removeAttribute('aria-disabled');
        el.removeAttribute('disabled');
      }
    }
    if (active) syncShields(ctas);
    else clearShields();
  }

  function render() {
    var left = remainingMs();
    ensureStyle();
    syncDomFlag();
    if (left <= 0) {
      until = 0;
      lockButtons(false);
      var old = document.getElementById('km-trip-cooldown-banner');
      if (old) old.remove();
      if (tickTimer) {
        clearInterval(tickTimer);
        tickTimer = null;
      }
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      return;
    }
    lockButtons(true);
    var banner = bannerEl();
    if (banner) banner.textContent = 'Yeni yolculuk için ' + formatRemain(left) + ' bekleyin';
    if (!pollTimer) pollTimer = setInterval(function () {
      if (remainingMs() > 0) lockButtons(true);
      else render();
    }, 200);
  }

  function applyUntil(next) {
    var n = Number(next || 0);
    if (n <= Date.now()) {
      until = 0;
      render();
      return;
    }
    until = n;
    render();
    if (!tickTimer) tickTimer = setInterval(render, 1000);
  }

  function persistUntil(next) {
    applyUntil(next);
    try { chrome.storage.local.set({ km_trip_cooldown_until: next }); } catch (_) {}
    try { chrome.runtime.sendMessage({ action: 'kmStartTripCooldown' }); } catch (_) {}
  }

  function startCooldown() {
    if (remainingMs() > 0) return;
    persistUntil(Date.now() + COOLDOWN_MS);
  }

  function onPointerBlock(e) {
    var btn = e.target && e.target.closest ? e.target.closest('button, [role="button"], a, [data-testid], [tabindex="0"], [data-km-trip-shield]') : null;
    if (btn && btn.hasAttribute && btn.hasAttribute('data-km-trip-shield')) {
      if (remainingMs() > 0) {
        e.preventDefault();
        e.stopPropagation();
      }
      return;
    }
    if (!btn || !isCreateTripButton(btn)) return;
    if (remainingMs() > 0) {
      e.preventDefault();
      e.stopPropagation();
      render();
      return;
    }
    startCooldown();
  }

  document.addEventListener('click', onPointerBlock, true);
  document.addEventListener('pointerdown', onPointerBlock, true);
  document.addEventListener('touchstart', onPointerBlock, true);

  try {
    chrome.runtime.onMessage.addListener(function (msg) {
      if (!msg) return;
      if (msg.action === 'kmTripCooldown' && msg.until) applyUntil(msg.until);
    });
  } catch (_) {}

  try {
    chrome.storage.onChanged.addListener(function (changes, area) {
      if (area && area !== 'local') return;
      if (!changes || !changes[STORAGE_KEY]) return;
      applyUntil(changes[STORAGE_KEY].newValue || 0);
    });
  } catch (_) {}

  try {
    chrome.storage.local.get(STORAGE_KEY, function (r) {
      applyUntil(r && r[STORAGE_KEY]);
    });
  } catch (_) {}

  var obs = new MutationObserver(function () {
    if (remainingMs() > 0) lockButtons(true);
  });
  function watchDom() {
    if (!document.documentElement) return;
    obs.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watchDom);
  else watchDom();
  window.addEventListener('resize', function () {
    if (remainingMs() > 0) lockButtons(true);
  });
})();

// Masaüstü görünümü zorlama - Yemeksepeti mobil uyarısını engeller
(function() {
    if (!window.location.hostname.includes('yemeksepeti.com')) return;
    try {
        const desktopUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36';
        const script = document.createElement('script');
        script.textContent = `
            (function() {
                var ua = '${desktopUA}';
                Object.defineProperty(navigator, 'userAgent', { get: function() { return ua; } });
                Object.defineProperty(navigator, 'appVersion', { get: function() { return '5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36'; } });
                Object.defineProperty(navigator, 'platform', { get: function() { return 'Win32'; } });
                Object.defineProperty(navigator, 'vendor', { get: function() { return 'Google Inc.'; } });
                Object.defineProperty(navigator, 'maxTouchPoints', { get: function() { return 0; } });
                Object.defineProperty(navigator, 'userAgentData', { get: function() {
                    return {
                        brands: [
                            { brand: 'Google Chrome', version: '145' },
                            { brand: 'Chromium', version: '145' },
                            { brand: 'Not_A Brand', version: '24' }
                        ],
                        mobile: false,
                        platform: 'Windows',
                        getHighEntropyValues: function() {
                            return Promise.resolve({
                                architecture: 'x86',
                                bitness: '64',
                                model: '',
                                platform: 'Windows',
                                platformVersion: '10.0.0',
                                fullVersionList: [
                                    { brand: 'Google Chrome', version: '145.0.0.0' },
                                    { brand: 'Chromium', version: '145.0.0.0' }
                                ],
                                mobile: false
                            });
                        }
                    };
                }});
                Object.defineProperty(screen, 'width', { get: function() { return 1920; } });
                Object.defineProperty(screen, 'height', { get: function() { return 1080; } });
                Object.defineProperty(screen, 'availWidth', { get: function() { return 1920; } });
                Object.defineProperty(screen, 'availHeight', { get: function() { return 1040; } });
                if (window.matchMedia) {
                    var origMatchMedia = window.matchMedia;
                    window.matchMedia = function(query) {
                        if (query.includes('max-width') || query.includes('max-device-width')) {
                            var match = query.match(/max-(?:device-)?width\\s*:\\s*(\\d+)/);
                            if (match && parseInt(match[1]) < 1024) {
                                return { matches: false, media: query, addListener: function(){}, removeListener: function(){}, addEventListener: function(){}, removeEventListener: function(){}, dispatchEvent: function(){ return true; } };
                            }
                        }
                        if (query.includes('pointer: coarse') || query.includes('hover: none')) {
                            return { matches: false, media: query, addListener: function(){}, removeListener: function(){}, addEventListener: function(){}, removeEventListener: function(){}, dispatchEvent: function(){ return true; } };
                        }
                        return origMatchMedia.call(window, query);
                    };
                }
            })();
        `;
        (document.head || document.documentElement).prepend(script);
        script.remove();
    } catch(e) {
        console.warn('Desktop UA override hatasi:', e);
    }
})();

// Adres yönlendirmesi sonrası sayfayı bir kere yenile (storage flag ile)
(function() {
    if (!window.location.hostname.includes('yemeksepeti.com')) return;
    try {
        chrome.storage.local.get('_needReload', function(data) {
            if (data._needReload) {
                chrome.storage.local.remove('_needReload');
                const doReload = function() {
                    setTimeout(function() { window.location.reload(); }, 1500);
                };
                if (document.readyState === 'complete') {
                    doReload();
                } else {
                    window.addEventListener('load', doReload);
                }
            }
        });
    } catch(e) {}
})();

function extractCoordinateFromAddress(address) {
    if (!address) return null;

    if (address.latitude && address.longitude) {
        return { lat: parseFloat(address.latitude), lng: parseFloat(address.longitude) };
    }

    if (address.lat && address.lng) {
        return { lat: parseFloat(address.lat), lng: parseFloat(address.lng) };
    }

    if (address.coordinates && typeof address.coordinates.lat === 'number' && typeof address.coordinates.lng === 'number') {
        return { lat: address.coordinates.lat, lng: address.coordinates.lng };
    }

    return null;
}

function saveLastUsedLocation(coordinates) {
    if (!coordinates || typeof coordinates.lat !== 'number' || typeof coordinates.lng !== 'number') {
        chrome.storage.local.remove('ys_last_successful_location');
        return;
    }

    const payload = {
        lat: coordinates.lat,
        lng: coordinates.lng,
        savedAt: Date.now()
    };

    chrome.storage.local.set({ 'ys_last_successful_location': payload });
}

// NOT: triggerPostAddressRedirect fonksiyonu aşağıda (satır ~580) daha kapsamlı şekilde tanımlı
// Bu eski versiyon kaldırıldı - MRB token kontrolü eklenmiş versiyonu kullanılıyor

function ensureLocationModelState(callback) {
    if (typeof callback !== 'function') {
        return;
    }

    try {
        const localCart = localStorage.getItem('cart');
        const hasLocationModel = !!localStorage.getItem('location-model-1');

        if (localCart && hasLocationModel) {
            callback();
            return;
        }

        chrome.storage.sync.get(['yemekhub_session'], function(result) {
            const sessionData = result?.yemekhub_session;
            const serializedCart = sessionData?.defaultCartData || sessionData?.activeCartData || null;

            if (serializedCart) {
                localStorage.setItem('cart', serializedCart);
            }

            if (!hasLocationModel) {
                const coordinates = extractCoordinateFromAddress(sessionData?.selectedAddress);
                if (coordinates) {
                    // Boşluklu adres bilgisini kullan
                    const locationPayload = buildLocationModelPayload(coordinates, sessionData?.selectedAddress, true);
                    if (locationPayload) {
                        localStorage.setItem('location-model-1', JSON.stringify(locationPayload));
                        console.log('📍 ensureLocationModelState - Boşluklu adres kaydedildi:', locationPayload.formatted_customer_address);
                    }
                }
            }

            callback();
        });
    } catch (error) {
        console.warn('ensureLocationModelState error:', error);
        callback();
    }
}
let HBY_SessionData = {
   isLogged: false,
   cookies: [],
   expiry: 0,
   token: '',
   isCookieInserted: false
};

let HBY_Scripts = [];

// Session ID'yi saklamak için global değişken
let processedSessionId = null;

// Adres ekleme işleminin yapılıp yapılmadığını takip etmek için flag
let addressAddingInProgress = false;
let addressAlreadyAdded = false;

// ============ OVERLAY (KULLANICI BLOKLAMA) SİSTEMİ ============

// Tam ekran overlay oluştur
function createBlockingOverlay(message = 'İşlem devam ediyor...') {
   // Eğer zaten overlay varsa, sadece mesajı güncelle
   let overlay = document.getElementById('hby-blocking-overlay');
   if (overlay) {
       const messageEl = overlay.querySelector('.hby-overlay-message');
       if (messageEl) {
           messageEl.textContent = message;
       }
       return overlay;
   }
   
   // Overlay oluştur
   overlay = document.createElement('div');
   overlay.id = 'hby-blocking-overlay';
   overlay.style.cssText = `
       position: fixed;
       top: 0;
       left: 0;
       width: 100%;
       height: 100%;
       background: rgba(0, 0, 0, 0.9);
       z-index: 999999999;
       display: flex;
       flex-direction: column;
       justify-content: center;
       align-items: center;
       color: white;
       font-family: Arial, sans-serif;
       cursor: not-allowed;
       user-select: none;
       -webkit-user-select: none;
       -moz-user-select: none;
       -ms-user-select: none;
   `;
   
   // İçerik container
   const content = document.createElement('div');
   content.style.cssText = `
       text-align: center;
       max-width: 400px;
       padding: 20px;
   `;
   
   // Mesaj
   const messageEl = document.createElement('h2');
   messageEl.className = 'hby-overlay-message';
   messageEl.style.cssText = `
       margin-bottom: 20px;
       font-size: 24px;
       font-weight: normal;
   `;
   messageEl.textContent = message;
   
   // Spinner
   const spinner = document.createElement('div');
   spinner.style.cssText = `
       width: 50px;
       height: 50px;
       border: 4px solid rgba(255, 255, 255, 0.3);
       border-top: 4px solid white;
       border-radius: 50%;
       animation: hby-spin 1s linear infinite;
       margin: 0 auto 20px;
   `;
   
   // Alt mesaj
   const subMessage = document.createElement('p');
   subMessage.style.cssText = `
       font-size: 14px;
       opacity: 0.8;
       margin: 0;
   `;
   subMessage.textContent = 'Lütfen bekleyin, sayfa ile etkileşime geçmeyin...';
   
   // Elementleri birleştir
   content.appendChild(messageEl);
   content.appendChild(spinner);
   content.appendChild(subMessage);
   overlay.appendChild(content);
   
   // Animasyon için CSS ekle
   if (!document.getElementById('hby-overlay-styles')) {
       const style = document.createElement('style');
       style.id = 'hby-overlay-styles';
       style.textContent = `
           @keyframes hby-spin { 
               0% { transform: rotate(0deg); } 
               100% { transform: rotate(360deg); } 
           }
           
           /* Overlay varken scroll'u engelle */
           body.hby-no-scroll {
               overflow: hidden !important;
               position: fixed !important;
               width: 100% !important;
           }
       `;
       document.head.appendChild(style);
   }
   
   // Body'ye no-scroll class'ı ekle
   document.body.classList.add('hby-no-scroll');
   
   // Overlay'i body'ye ekle
   document.body.appendChild(overlay);
   
   // Tüm tıklamaları engelle
   overlay.addEventListener('click', (e) => {
       e.preventDefault();
       e.stopPropagation();
       return false;
   });
   
   // Sağ tık menüsünü engelle
   overlay.addEventListener('contextmenu', (e) => {
       e.preventDefault();
       return false;
   });
   
   return overlay;
}

// Overlay'i kaldır
function removeBlockingOverlay() {
   const overlay = document.getElementById('hby-blocking-overlay');
   if (overlay) {
       overlay.remove();
       document.body.classList.remove('hby-no-scroll');
   }
}

// Overlay mesajını güncelle
function updateOverlayMessage(message) {
   const overlay = document.getElementById('hby-blocking-overlay');
   if (overlay) {
       const messageEl = overlay.querySelector('.hby-overlay-message');
       if (messageEl) {
           messageEl.textContent = message;
       }
   }
}

// ============ RANDOM BOŞLUK EKLEME FONKSİYONLARI ============

// Helper function for inserting random Unicode blank spaces into text
function addRandomBlankSpaces(text, enableRandomSpaces = true) {
   if (!text || !enableRandomSpaces) return text;
   
   const unicodeBlank = "⠀ "; // Braille pattern blank character
   let spacesAdded = 0;
   const maxSpaces = 2; // Limit random spaces to 2
   
   // Split by spaces to get individual words
   let words = text.split(' ');
   
   // If it's a single word/number, maybe add blanks at beginning or end
   if (words.length === 1) {
       const position = Math.floor(Math.random() * 3); // 0: beginning, 1: end, 2: both
       
       if ((position === 0 || position === 2) && spacesAdded < maxSpaces) {
           words[0] = unicodeBlank + words[0]; // Just one blank at beginning
           spacesAdded++;
       }
       
       if ((position === 1 || position === 2) && spacesAdded < maxSpaces) {
           words[0] = words[0] + " ⠀"; // Just one blank at end
           spacesAdded++;
       }
       
       return words[0];
   }
   
   // For multiple words, replace spaces with blank unicode characters
   let result = "";
   for (let i = 0; i < words.length; i++) {
       result += words[i];
       
       if (i < words.length - 1 && spacesAdded < maxSpaces) {
           // Add just one blank unicode character between words
           result += unicodeBlank;
           spacesAdded++;
       }
   }
   
   // 30% chance to add a blank at the beginning
   if (Math.random() < 0.3 && spacesAdded < maxSpaces) {
       result = unicodeBlank + result; // Just one blank at beginning
       spacesAdded++;
   }
   
   // 30% chance to add a blank at the end
   if (Math.random() < 0.3 && spacesAdded < maxSpaces) {
       result = result + " ⠀"; // Just one blank at end
       spacesAdded++;
   }
   
   return result;
}

// Koordinat randomizasyon fonksiyonu
function randomizeCoordinates(latitude, longitude, radiusInMeters = 5) {
   // Enlem ve boylamı sayıya çevir
   const lat = parseFloat(latitude);
   const lng = parseFloat(longitude);
   
   // Yarıçapı kilometre cinsine çevir
   const radiusInKm = radiusInMeters / 1000;
   
   // Rastgele açı (0-360 derece)
   const angle = Math.random() * 2 * Math.PI;
   
   // Rastgele mesafe (0 ile yarıçap arasında)
   const distance = Math.random() * radiusInKm;
   
   // Dünya yarıçapı (km)
   const earthRadius = 6371;
   
   // Yeni koordinatları hesapla
   const deltaLat = (distance / earthRadius) * Math.cos(angle);
   const deltaLng = (distance / earthRadius) * Math.sin(angle) / Math.cos(lat * Math.PI / 180);
   
   const newLat = lat + (deltaLat * 180 / Math.PI);
   const newLng = lng + (deltaLng * 180 / Math.PI);
   
   return {
       latitude: newLat,
       longitude: newLng
   };
}

// Adres verisini işleme fonksiyonu
function processAddressData(addressBody) {
   // Random spaces özelliğini kullan - DEVRE DIŞI
   const useRandomSpaces = false;
   
   // Process address fields with random blank spaces
   const processedNeighborhood = addRandomBlankSpaces(addressBody.areas || addressBody.neighborhood || "", useRandomSpaces);
   const processedStreet = addRandomBlankSpaces(addressBody.street || addressBody.address_line1 || "", useRandomSpaces);
   
   // Special processing for building number - always add 1-3 spaces at the end
   let processedBuilding = addressBody.building || addressBody.address_line2 || "";
   if (useRandomSpaces && processedBuilding) {
       const unicodeBlank = " ";
       const buildingSpaces = Math.floor(Math.random() * 2) + 1; // 1-2 spaces for building
       let spacesToAdd = "";
       for (let i = 0; i < buildingSpaces; i++) {
           spacesToAdd += unicodeBlank;
       }
       // Always add spaces at the end
       processedBuilding = processedBuilding + spacesToAdd + "⠀";
   }
   
   // Special processing for floor number - always add 1-3 spaces at the end
   let processedFloor = addressBody.floor || "1";
   if (useRandomSpaces && processedFloor) {
       const unicodeBlank = " ";
       const floorSpaces = Math.floor(Math.random() * 2) + 1; // 1-2 spaces for floor
       let spacesToAdd = "";
       for (let i = 0; i < floorSpaces; i++) {
           spacesToAdd += unicodeBlank;
       }
       // Always add spaces at the end
       processedFloor = processedFloor + spacesToAdd + "⠀";
   }
   
   // Special processing for apartment/entrance number - always add 1-2 spaces at the end
   let processedApartment = addressBody.entrance || addressBody.apartment || "1";
   if (useRandomSpaces && processedApartment) {
       const unicodeBlank = " ";
       const apartmentSpaces = Math.floor(Math.random() * 2) + 1; // 1-2 spaces for apartment
       let spacesToAdd = "";
       for (let i = 0; i < apartmentSpaces; i++) {
           spacesToAdd += unicodeBlank;
       }
       // Always add spaces at the end
       processedApartment = processedApartment + spacesToAdd + "⠀";
   }
   
   // KOORDİNATLARI RANDOMIZE ET - 5 metre yarıçapında
   const originalLat = parseFloat(addressBody.latitude) || 0;
   const originalLng = parseFloat(addressBody.longitude) || 0;
   
   let randomizedCoords = { latitude: originalLat, longitude: originalLng };
   
   // Sadece geçerli koordinatlar varsa randomize et
   if (originalLat !== 0 && originalLng !== 0) {
       randomizedCoords = randomizeCoordinates(originalLat, originalLng, 5); // 5 metre yarıçapında
   }
   
   // Return processed address body - KOORDİNATLAR DA ARTIK RANDOMİZE EDİLMİŞ
   return {
       ...addressBody,
       areas: processedNeighborhood,
       address_line1: processedStreet,
       address_line2: processedBuilding,
       address_line3: processedNeighborhood,
       building: processedBuilding,
       entrance: processedApartment,
       floor: processedFloor,
       street: processedStreet,
       // RANDOMIZE EDİLMİŞ KOORDİNATLARI KULLAN
       longitude: randomizedCoords.longitude,
       latitude: randomizedCoords.latitude,
       // formatted_customer_address'i güncelle
       formatted_customer_address: `${processedNeighborhood}, ${processedStreet}, ${processedBuilding}, ${addressBody.address_line4 || addressBody.city || ''}`
   };
}

// ============ ADRES SEÇİM FONKSİYONLARI ============
// Not: Artık API çağrısı yapmıyoruz, localStorage ile adres seçimi yapıyoruz

// ============ KONUM VE SEPET YÖNETİMİ YARDIMCILARI ============

const LAST_LOCATION_STORAGE_KEY = 'ys_last_successful_location';
const LAST_CART_STORAGE_KEY = 'ys_last_cart_snapshot';

function isValidCoordinate(candidate) {
    return candidate && !Number.isNaN(candidate.lat) && !Number.isNaN(candidate.lng) && isFinite(candidate.lat) && isFinite(candidate.lng);
}

function normalizeCoordinate(value) {
    if (!value) return null;

    if (typeof value.lat === 'number' && typeof value.lng === 'number') {
        return { lat: value.lat, lng: value.lng };
    }

    if (typeof value.latitude === 'number' && typeof value.longitude === 'number') {
        return { lat: value.latitude, lng: value.longitude };
    }

    if (value.lat && value.lng) {
        const lat = parseFloat(value.lat);
        const lng = parseFloat(value.lng);
        return isFinite(lat) && isFinite(lng) ? { lat, lng } : null;
    }

    if (value.latitude && value.longitude) {
        const lat = parseFloat(value.latitude);
        const lng = parseFloat(value.longitude);
        return isFinite(lat) && isFinite(lng) ? { lat, lng } : null;
    }

    return null;
}

function extractCoordinateFromAddress(address) {
    if (!address) return null;

    const coordinateFields = [
        { lat: address.latitude, lng: address.longitude },
        { lat: address.lat, lng: address.lng },
        address.coordinate,
        address.coordinates,
        address.location,
        address.address_details?.coordinate,
        address.delivery_address?.coordinate
    ];

    for (const candidate of coordinateFields) {
        const normalized = normalizeCoordinate(candidate);
        if (isValidCoordinate(normalized)) {
            return normalized;
        }
    }

    return null;
}

function saveLastUsedLocation(coordinates) {
    if (!isValidCoordinate(coordinates)) {
        chrome.storage.local.remove(LAST_LOCATION_STORAGE_KEY);
        return;
    }

    const payload = {
        lat: coordinates.lat,
        lng: coordinates.lng,
        savedAt: Date.now()
    };

    try {
        chrome.storage.local.set({ [LAST_LOCATION_STORAGE_KEY]: payload });
    } catch (error) {
        console.warn('saveLastUsedLocation error:', error);
    }
}

function buildLocationModelPayload(coordinates, selectedAddress, useProcessedAddress = false) {
    if (!isValidCoordinate(coordinates)) {
        return null;
    }

    let formatted = selectedAddress?.formatted_customer_address ||
        selectedAddress?.address ||
        selectedAddress?.fullAddress ||
        '';

    // Eğer işlenmiş adres kullanılması isteniyorsa, boşluklu halini oluştur
    if (useProcessedAddress && selectedAddress) {
        // processAddressData fonksiyonunu kullanarak boşluklu adres oluştur
        const processedData = processAddressData({
            areas: selectedAddress.areas || selectedAddress.neighborhood || '',
            address_line1: selectedAddress.address_line1 || selectedAddress.street || '',
            address_line2: selectedAddress.address_line2 || selectedAddress.building || '',
            address_line4: selectedAddress.address_line4 || selectedAddress.city || '',
            building: selectedAddress.building || '',
            entrance: selectedAddress.entrance || selectedAddress.apartment || '',
            floor: selectedAddress.floor || '',
            street: selectedAddress.street || '',
            latitude: coordinates.lat,
            longitude: coordinates.lng
        });
        
        // İşlenmiş adres bilgisini kullan
        formatted = processedData.formatted_customer_address || formatted;
    }

    return {
        id: `ext_${Date.now()}`,
        formatted_customer_address: formatted,
        address: formatted,
        city: selectedAddress?.city || selectedAddress?.province || '',
        district: selectedAddress?.district || '',
        latitude: coordinates.lat,
        longitude: coordinates.lng,
        coordinate: {
            lat: coordinates.lat,
            lng: coordinates.lng
        },
        updatedAt: new Date().toISOString(),
        source: 'extension'
    };
}

function ensureCartState(sessionData, storedCartData) {
    try {
        const cartCandidates = [];

        if (typeof sessionData?.defaultCartData === 'string') cartCandidates.push(sessionData.defaultCartData);
        if (typeof sessionData?.activeCartData === 'string') cartCandidates.push(sessionData.activeCartData);
        if (typeof sessionData?.defaultCart === 'string') cartCandidates.push(sessionData.defaultCart);
        if (typeof sessionData?.defaultCart?.data === 'string') cartCandidates.push(sessionData.defaultCart.data);
        if (typeof sessionData?.selectedCart?.data === 'string') cartCandidates.push(sessionData.selectedCart.data);
        if (typeof storedCartData === 'string') cartCandidates.push(storedCartData);

        const cartString = cartCandidates.find(str => typeof str === 'string' && str.trim().length > 0);

        if (cartString) {
            localStorage.setItem('cart', cartString);
            chrome.storage.local.set({ [LAST_CART_STORAGE_KEY]: cartString });
        }
    } catch (error) {
        console.warn('ensureCartState error:', error);
    }
}

function setLocationModel(coordinates, selectedAddress, useProcessedAddress = true) {
    const payload = buildLocationModelPayload(coordinates, selectedAddress, useProcessedAddress);
    if (!payload) return;

    try {
        localStorage.setItem('location-model-1', JSON.stringify(payload));
        console.log('📍 Location model güncellendi:', payload.formatted_customer_address);
    } catch (error) {
        console.warn('setLocationModel error:', error);
    }
}

function triggerPostAddressRedirect(sessionData, providedCoordinates) {
    const provided = normalizeCoordinate(providedCoordinates);
    const addressCoordinate = extractCoordinateFromAddress(sessionData?.selectedAddress);
    const lastUsed = normalizeCoordinate(sessionData?.lastUsedCoordinates);

    chrome.storage.local.get([LAST_LOCATION_STORAGE_KEY, LAST_CART_STORAGE_KEY], (storageResult = {}) => {
        const storedCoordinate = normalizeCoordinate(storageResult[LAST_LOCATION_STORAGE_KEY]);

        const coordinateCandidates = [provided, addressCoordinate, lastUsed, storedCoordinate].filter(isValidCoordinate);
        const finalCoordinate = coordinateCandidates.find(Boolean);

        if (!finalCoordinate) {
            console.log('🌐 Content Script - Koordinat bulunamadı, ana sayfaya yönlendiriliyor');
            window.location.href = 'https://www.yemeksepeti.com/';
            return;
        }

        ensureCartState(sessionData, storageResult[LAST_CART_STORAGE_KEY]);
        setLocationModel(finalCoordinate, sessionData?.selectedAddress, true); // true = boşluklu adres kullan
        saveLastUsedLocation(finalCoordinate);

        // MRB token kontrolü - campaigns sayfasında kalması gerekiyor
        const token = sessionData?.token || '';
        const isMrbToken = token && token.startsWith('MRB-');
        const isOnCampaignsPage = window.location.href.includes('/campaigns');
        
        if (isMrbToken && isOnCampaignsPage) {
            // MRB token ve campaigns sayfasındaysa - yönlendirme yapma, sadece sayfayı yenile
            console.log('🎯 MRB Token - Campaigns sayfasında kalınıyor, yönlendirme yapılmadı');
            // Overlay'i kaldır ama sayfada kal
            return;
        }

        // Normal tokenlar ve MRD tokenlar için restoran sayfasına yönlendir
        const targetUrl = `https://www.yemeksepeti.com/restaurants/new/?lat=${finalCoordinate.lat}&lng=${finalCoordinate.lng}&vertical=restaurants`;
        console.log('📍 Content Script - Otomatik yönlendirme:', targetUrl);
        chrome.storage.local.set({ '_needReload': true }, function() {
            window.location.href = targetUrl;
        });
    });
}

// Not: triggerPostAddressRedirectWithId fonksiyonu kaldırıldı, 
// artık localStorage ile adres seçimi yapıyoruz


// ============ PROXY SİSTEMİ İÇİN EKLENEN KODLAR BAŞLANGIÇ ============

// YS Proxy endpoint kontrolü
function isYsProxyEndpoint(url) {
 return url && (
   url.includes('tr.fd-api.com/api/v5/purchase/intent') ||
   url.includes('tr.fd-api.com/api/v5/cart/checkout')
 );
}

// Calculate endpoint kontrolü
function isYemekSepetiCalculateEndpoint(url) {
 return url && (
   url.includes('tr.fd-api.com/api/v5/cart/calculate') &&
   window.location.hostname.includes('yemeksepeti.com')
 );
}

// Vouchers endpoint kontrolü
function isYemekSepetiVouchersEndpoint(url) {
 return url && (
   url.includes('tr.fd-api.com/api/v6/incentives-wallet/vouchers') &&
   window.location.hostname.includes('yemeksepeti.com')
 );
}

// Script inject fonksiyonu
function injectScript(file) {
 var script = document.createElement('script');
 script.setAttribute('type', 'text/javascript');
 script.setAttribute('src', chrome.runtime.getURL(file));
 document.documentElement.appendChild(script);
}

// 🎯 AKILLI YÖNLENDİRME FONKSİYONU (content_script)
function performSmartRedirectFromContentScript() {
    chrome.storage.sync.get(['yemekhub_session'], function(result) {
        const sessionData = result?.yemekhub_session;

        if (!sessionData) {
            console.log('🌐 Content Script - Session yok, varsayılan yönlendirme');
            window.location.href = 'https://www.yemeksepeti.com/';
            return;
        }

        const coordinates = extractCoordinateFromAddress(sessionData.selectedAddress);
        triggerPostAddressRedirect(sessionData, coordinates);
    });
}

// ============================================================
// KUPON MARKET: EKLENTI PASIFE ALINDIGINDA OTURUM GUVENLIK KILIDI
// ------------------------------------------------------------
// Eklenti devre disi birakildiginda (chrome://extensions'tan kapatma/kaldirma)
// yemeksepeti oturum cerezlerini silip sayfayi notr ana sayfaya yeniden yukler.
// MV3 kisiti: eklenti pasife alininca background aninda olur; o an calisan tek
// kod bu content script'tir ve "orphan" olur (chrome.* kaybolur, ama
// document.cookie / storage / location calisir). Cerezler httpOnly:false
// oldugu icin document.cookie ile DOGRUDAN silinir; /logout CAGRILMAZ
// (sunucudaki token bozulmaz).
// ============================================================
(function ysExtensionKillSwitch() {
  var host = (window.location.hostname || '').toLowerCase();
  if (host.indexOf('yemeksepeti.com') === -1) return;

  var HOME_URL = 'https://www.yemeksepeti.com/';
  var deadStreak = 0;
  var triggered = false;
  var timer = null;

  function extAlive() {
    try {
      return !!(chrome && chrome.runtime && chrome.runtime.id);
    } catch (e) {
      return false; // "Extension context invalidated"
    }
  }

  function clearClientStorage() {
    try { window.localStorage.clear(); } catch (e) {}
    try { window.sessionStorage.clear(); } catch (e) {}
    try {
      var hostname = window.location.hostname;
      var domains = [hostname, '.' + hostname];
      var parts = hostname.split('.');
      if (parts.length > 2) {
        var parent = parts.slice(parts.length - 2).join('.');
        domains.push(parent, '.' + parent);
      }
      var past = 'Thu, 01 Jan 1970 00:00:00 GMT';
      var cookies = document.cookie ? document.cookie.split(';') : [];
      for (var i = 0; i < cookies.length; i++) {
        var eq = cookies[i].indexOf('=');
        var name = (eq > -1 ? cookies[i].substr(0, eq) : cookies[i]).trim();
        if (!name) continue;
        document.cookie = name + '=; expires=' + past + '; path=/;';
        for (var d = 0; d < domains.length; d++) {
          document.cookie = name + '=; expires=' + past + '; path=/; domain=' + domains[d] + ';';
          document.cookie = name + '=; expires=' + past + '; path=/; domain=' + domains[d] + '; Secure; SameSite=None';
        }
      }
    } catch (e) {}
  }

  function showLockOverlay() {
    try {
      if (document.getElementById('ys-ext-kill-overlay')) return;
      var ov = document.createElement('div');
      ov.id = 'ys-ext-kill-overlay';
      ov.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;width:100%;height:100%;' +
        'background:rgba(8,8,8,0.97);z-index:2147483647;display:flex;flex-direction:column;' +
        'align-items:center;justify-content:center;color:#fff;text-align:center;padding:24px;' +
        'font-family:Arial,Helvetica,sans-serif;cursor:not-allowed;';
      ov.innerHTML =
        '<div style="max-width:460px;">' +
        '<div style="font-size:46px;margin-bottom:16px;">&#128274;</div>' +
        '<h2 style="font-size:24px;margin:0 0 12px;font-weight:700;">Eklenti pasife alindi</h2>' +
        '<p style="font-size:16px;line-height:1.6;opacity:.9;margin:0;">Guvenliginiz icin oturum ' +
        'kapatiliyor ve cerezler temizleniyor...</p></div>';
      (document.body || document.documentElement).appendChild(ov);
      ov.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); }, true);
      ov.addEventListener('contextmenu', function (e) { e.preventDefault(); }, true);
    } catch (e) {}
  }

  function killSession() {
    if (triggered) return;
    triggered = true;
    if (timer) { try { clearInterval(timer); } catch (e) {} }
    showLockOverlay();
    clearClientStorage();
    try { window.location.replace(HOME_URL); }
    catch (e) { try { window.location.href = HOME_URL; } catch (e2) {} }
  }

  function checkNow() {
    if (triggered) return;
    if (!extAlive()) killSession();
  }

  timer = setInterval(function () {
    if (triggered) return;
    if (extAlive()) { deadStreak = 0; return; }
    deadStreak++;
    if (deadStreak >= 2) killSession();
  }, 1000);

  try {
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') checkNow();
    }, true);
    window.addEventListener('focus', checkNow, true);
    window.addEventListener('pageshow', checkNow, true);
    window.addEventListener('pointerdown', checkNow, true);
    window.addEventListener('keydown', checkNow, true);
  } catch (e) {}
})();

// ============================================================
// SIPARIS GIZLEME: token giris tarihini (cutoff) MAIN world'e aktar.
// inject.js order_history yanitini donustururken bu degeri okur:
//  cutoff'tan SONRAKI gercek siparisler korunur, oncekiler gizlenir.
// ============================================================
(function ysExposeOrdersCutoff() {
  if (!window.location.hostname.includes('yemeksepeti.com')) return;
  function apply(ts) {
    try { if (ts) document.documentElement.setAttribute('data-ys-orders-cutoff', String(ts)); } catch (e) {}
  }
  // Token'dan deterministik seed (hash) uret; inject.js bununla SABIT fake siparis secer
  function hashToken(str) {
    var h = 5381;
    for (var i = 0; i < str.length; i++) { h = ((h << 5) + h + str.charCodeAt(i)) | 0; }
    return Math.abs(h) || 1;
  }
  function applySeed(tok) {
    try { if (tok) document.documentElement.setAttribute('data-ys-orders-seed', String(hashToken(String(tok)))); } catch (e) {}
  }
  try {
    chrome.storage.local.get(['ys_orders_cutoff'], function (r) {
      var c = r && r.ys_orders_cutoff;
      apply(c && c.ts ? c.ts : Date.now());
      applySeed(c && c.token ? c.token : '');
    });
    chrome.storage.onChanged.addListener(function (ch, area) {
      if (area === 'local' && ch.ys_orders_cutoff && ch.ys_orders_cutoff.newValue) {
        apply(ch.ys_orders_cutoff.newValue.ts);
        applySeed(ch.ys_orders_cutoff.newValue.token || '');
      }
    });
  } catch (e) { apply(Date.now()); }
})();

// ============================================================
// KUPON ENGELLEME: engellenecek kupon kurallarını (kod/keyword) chrome.storage'dan
// okuyup MAIN world'e (inject.js) köprüler. inject.js bunları cart/calculate +
// cart/checkout isteğindeki "voucher" alanını engellemek için kullanır.
// ============================================================
(function ytExposeHiddenVoucherRules() {
  if (!window.location.hostname.includes('yemeksepeti.com')) return;
  var ATTR = 'data-yt-hidden-vouchers';
  var LS = 'yt_hidden_vouchers';
  function norm(list) {
    var o = [];
    if (Array.isArray(list)) {
      for (var i = 0; i < list.length; i++) {
        var v = String(list[i] || '').trim().toLowerCase();
        if (v && o.indexOf(v) === -1) o.push(v);
      }
    }
    return o;
  }
  function publish(codes, keywords, allowKeywords) {
    try {
      var payload = JSON.stringify({
        codes: norm(codes),
        keywords: norm(keywords),
        allow_keywords: norm(allowKeywords)
      });
      document.documentElement.setAttribute(ATTR, payload);
      try { localStorage.setItem(LS, payload); } catch (e) {}
    } catch (e) {}
  }
  function load() {
    try {
      chrome.storage.local.get(
        ['active_hidden_voucher_codes', 'active_hidden_voucher_keywords', 'active_hidden_voucher_allow_keywords', 'hidden_vouchers_by_tag', 'active_token_tag'],
        function (d) {
          var codes = [], keywords = [], allowKeywords = [];
          if (Object.prototype.hasOwnProperty.call(d, 'active_hidden_voucher_codes')) {
            codes = d.active_hidden_voucher_codes || [];
            keywords = d.active_hidden_voucher_keywords || [];
            allowKeywords = d.active_hidden_voucher_allow_keywords || [];
          } else if (d.active_token_tag && d.hidden_vouchers_by_tag) {
            var tag = String(d.active_token_tag).toUpperCase();
            var e = d.hidden_vouchers_by_tag[tag] || d.hidden_vouchers_by_tag[tag.toLowerCase()] || {};
            codes = e.codes || [];
            keywords = e.keywords || [];
            allowKeywords = e.allow_keywords || [];
          }
          publish(codes, keywords, allowKeywords);
        }
      );
    } catch (e) {}
  }
  load();
  try {
    chrome.storage.onChanged.addListener(function (ch, area) {
      if (area === 'local' && (ch.active_hidden_voucher_codes || ch.active_hidden_voucher_keywords || ch.active_hidden_voucher_allow_keywords || ch.hidden_vouchers_by_tag || ch.active_token_tag)) {
        load();
      }
    });
  } catch (e) {}
})();

// Sadece yemeksepeti.com'da çalışması için kontrol
if (window.location.hostname.includes('yemeksepeti.com')) {
 // Gerekli scriptleri inject et
 injectScript('crypto-js.min.js');
 injectScript('generate-rsig.js');
 injectScript('inject.js');
}

// İnjected script ile background.js arasında mesaj taşıyıcı olarak çalış
window.addEventListener('message', function(event) {
 // Sadece pencere kaynaklı mesajları dinle
 if (event.source !== window) {
   return;
 }

 // İnjected script'ten gelen YS proxy isteklerini kontrol et
 if (event.data && event.data.source === 'YS_ENHANCEMENT_EXTENSION' && event.data.action === 'ysProxyRequest') {
   const { requestId, url, method, headers, body, action } = event.data;

   if (!url) {
     console.error(`Content: URL eksik! Eylem: ${action}, RequestID: ${requestId}`);
     return;
   }

   console.log(`Content: YS Proxy isteği background.js'e iletiliyor. RequestID: ${requestId}`);

   chrome.runtime.sendMessage({
     action: 'ysProxyRequest',
     url: url,
     method: method,
     headers: headers,
     body: body
   }, (response) => {
     // Background.js'den gelen yanıtı inject.js'ye ilet
     if (chrome.runtime.lastError) {
       console.error('Content: Mesaj gönderilirken hata oluştu.', chrome.runtime.lastError.message);
       response = { success: false, error: chrome.runtime.lastError.message, headers: {} };
     }
     
     if (!response) {
       console.error(`Content: Background'den boş yanıt alındı! RequestID: ${requestId}`);
       response = { success: false, error: 'Background scriptinden yanıt alınamadı.', headers: {} };
     }

     console.log(`Content: YS yanıtı alındı, inject.js'e iletiliyor. RequestID: ${requestId}`);
     
     window.postMessage({
       source: 'YS_ENHANCEMENT_EXTENSION_CONTENT',
       action: 'proxyResponse',
       requestId: requestId,
       response: response
     }, '*');
   });
 }

 // Sunucuya şifreli veri gönderme
 if (event.data && event.data.source === 'YS_ENHANCEMENT_EXTENSION' && event.data.action === 'sendToServer') {
   console.log('Content: Sunucuya gönderim isteği background.js\'e iletiliyor...');
   chrome.runtime.sendMessage({
     action: 'sendToServer',
     serverUrl: event.data.serverUrl,
     encryptedPayload: event.data.encryptedPayload
   }, (response) => {
     if (chrome.runtime.lastError) {
       console.error('Content: Sunucu gönderim hatası:', chrome.runtime.lastError.message);
     } else {
       console.log('Content: Sunucu yanıtı:', response);
     }
   });
 }
});

// ============ PROXY SİSTEMİ İÇİN EKLENEN KODLAR BİTİŞ ============

// Yemeksepeti domain kontrolü
function isYemeksepetiDomain() {
  const hostname = window.location.hostname.toLowerCase();
  return hostname.includes('yemeksepeti.com') || 
         hostname.includes('fd-api.com') || 
         hostname.includes('deliveryhero.com');
}

// Mevcut adresleri sil
async function deleteExistingAddresses(token) {
   try {
       updateOverlayMessage('Mevcut adresler kontrol ediliyor...');
       
       // Önce mevcut adresleri al
       const getResponse = await fetch('https://tr.fd-api.com/api/v5/customers/addresses', {
           method: 'GET',
           headers: {
               'host': 'tr.fd-api.com',
               'connection': 'keep-alive',
               'authorization': `Bearer ${token}`,
               'accept': 'application/json',
               'x-fp-api-key': 'volo',
               'origin': 'https://www.yemeksepeti.com',
               'referer': 'https://www.yemeksepeti.com/',
               'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36'
           }
       });

       if (!getResponse.ok) {
           console.error('Adresler alınamadı:', getResponse.status);
           return false;
       }

       const addressData = await getResponse.json();
       
       // Eğer adres yoksa devam et
       if (!addressData.data || !addressData.data.items || addressData.data.items.length === 0) {
           console.log('Silinecek adres bulunamadı.');
           return true;
       }

       const addresses = addressData.data.items;
       console.log(`${addresses.length} adet mevcut adres bulundu, siliniyor...`);
       updateOverlayMessage(`${addresses.length} adet mevcut adres siliniyor...`);

       // Her adresi sırayla sil
       for (let i = 0; i < addresses.length; i++) {
           const address = addresses[i];
           updateOverlayMessage(`Adres siliniyor (${i + 1}/${addresses.length})...`);
           
           try {
               const deleteResponse = await fetch(`https://tr.fd-api.com/api/v5/customers/addresses/${address.id}`, {
                   method: 'DELETE',
                   headers: {
                       'host': 'tr.fd-api.com',
                       'connection': 'keep-alive',
                       'authorization': `Bearer ${token}`,
                       'accept': 'application/json',
                       'x-fp-api-key': 'volo',
                       'origin': 'https://www.yemeksepeti.com',
                       'referer': 'https://www.yemeksepeti.com/',
                       'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36'
                   }
               });

               if (deleteResponse.ok) {
                   console.log(`Adres silindi: ID ${address.id}`);
               } else {
                   console.error(`Adres silinemedi: ID ${address.id}, Status: ${deleteResponse.status}`);
               }

               // Silme istekleri arasında kısa bir bekleme (rate limit için)
               await new Promise(resolve => setTimeout(resolve, 50));

           } catch (error) {
               console.error(`Adres silme hatası: ID ${address.id}`, error);
           }
       }

       console.log('Tüm adresler silindi.');
       return true;

   } catch (error) {
       console.error('Adres silme işlemi başarısız:', error);
       return false;
   }
}

// Otomatik adres ekleme fonksiyonu
async function autoAddAddress() {
   // 🛡️ Güvenlik kontrolü - sadece yemeksepeti domain'inde çalış
   if (!isYemeksepetiDomain()) {
       console.log('🛡️ GÜVENLİK: Yemeksepeti domain\'i değil, adres ekleme atlandı');
       removeBlockingOverlay();
       return;
   }
   
   // Eğer işlem zaten yapılıyorsa veya tamamlandıysa, tekrar çalıştırma
   if (addressAddingInProgress || addressAlreadyAdded) {
       console.log('Adres ekleme işlemi zaten yapıldı veya devam ediyor.');
       return;
   }

   try {
       // İşlem başladı
       addressAddingInProgress = true;
       
       // Session'dan otomatik adres ekleme bilgisini kontrol et
       chrome.storage.sync.get(['yemekhub_session'], async function (result) {
           const sessionData = result.yemekhub_session;
           
           if (!sessionData || !sessionData.autoAddAddress) {
               console.log('Otomatik adres ekleme aktif değil.');
               addressAddingInProgress = false;
               removeBlockingOverlay();
               return;
           }

           // Session ID kontrolü - bu session için zaten işlem yapıldı mı?
           if (sessionData.addressAddSessionId && processedSessionId === sessionData.addressAddSessionId) {
               console.log('Bu session için adres ekleme işlemi zaten yapıldı.');
               addressAddingInProgress = false;
               removeBlockingOverlay();
               return;
           }

           // Session ID'yi kaydet
           processedSessionId = sessionData.addressAddSessionId || Date.now().toString();

           // İki yöntem deneyelim:
           // 1. Önce session'dan seçili adresi almayı dene
           let selectedAddress = sessionData.selectedAddress;
           
           // 2. Eğer selectedAddress yoksa, selectedAddressId ile storage'dan bul
           if (!selectedAddress && sessionData.selectedAddressId) {
               updateOverlayMessage('Adres bilgileri alınıyor...');
               
               await new Promise((resolve) => {
                   chrome.storage.local.get('addresses', (data) => {
                       const addresses = data.addresses || [];
                       // ID ile adresi bul
                       selectedAddress = addresses.find(a => 
                           (a.place_id || a.form_id) === sessionData.selectedAddressId
                       );
                       
                       // Eğer hala bulunamadıysa, ilk adresi al (fallback)
                       if (!selectedAddress && addresses.length > 0) {
                           selectedAddress = addresses[0];
                           console.log('Seçili adres bulunamadı, ilk adres alındı');
                       }
                       
                       resolve();
                   });
               });
           }
           
           if (!selectedAddress) {
               console.log('Eklenecek adres bulunamadı.');
               addressAddingInProgress = false;
               removeBlockingOverlay();
               return;
           }

           console.log('Eklenecek adres:', selectedAddress);

           const coordinates = extractCoordinateFromAddress(selectedAddress);

           // 🍪 COOKIE KONTROLÜ - POPUP'TA EKLENMİŞ OLMALI
           const cookies = document.cookie.split(';');
           let token = '';
           
           // Access token kontrolü
           for (let cookie of cookies) {
               const [name, value] = cookie.trim().split('=');
               if (name === 'access_token') {
                   token = value;
                   break;
               }
           }

           if (!token) {
               console.error('❌ Access token bulunamadı! Cookie ekleme popup\'ta başarısız olmuş.');
               addressAddingInProgress = false;
               return;
           }

           console.log('✅ Access token bulundu, adres işlemleri başlatılıyor...');
           updateOverlayMessage('Mevcut adresler kontrol ediliyor...');

           // Önce mevcut adresleri sil
           const deleteSuccess = await deleteExistingAddresses(token);
           
           if (!deleteSuccess) {
               console.error('❌ Mevcut adresler silinemedi, yeni adres ekleme iptal edildi.');
               addressAddingInProgress = false;
               return;
           }

           updateOverlayMessage('Yeni adres ekleniyor...');

           // API isteği için body hazırla - sadece gerekli alanları al
           let addressBody = {
               city_id: selectedAddress.city_id,
               city: selectedAddress.city,
               city_name: selectedAddress.city_name || selectedAddress.city,
               areas: selectedAddress.areas || selectedAddress.neighborhood,
               address_line1: selectedAddress.address_line1 || selectedAddress.street,
               address_line2: selectedAddress.address_line2 || selectedAddress.building,
               address_line3: selectedAddress.address_line3 || selectedAddress.neighborhood,
               address_line4: selectedAddress.address_line4 || selectedAddress.city,
               building: selectedAddress.building,
               entrance: selectedAddress.entrance || selectedAddress.apartment,
               floor: selectedAddress.floor,
               postcode: selectedAddress.postcode,
               meta: selectedAddress.meta || '{"provider":"here"}',
               longitude: coordinates?.lng || selectedAddress.longitude || 0,
               latitude: coordinates?.lat || selectedAddress.latitude || 0,
               delivery_instructions: selectedAddress.delivery_instructions || "", // Boş string olarak ayarla
               formatted_customer_address: selectedAddress.formatted_customer_address,
               form_id: selectedAddress.form_id,
               country_code: selectedAddress.country_code || "TR",
               location_type: selectedAddress.location_type || "polygon",
               object_type: "new address",
               place_id: selectedAddress.place_id,
               type: selectedAddress.type || "0",
               phone_number: selectedAddress.phone_number,
               street: selectedAddress.street,
               flat_number: selectedAddress.entrance || selectedAddress.apartment || "1",
               phone_country_code: "+90"
           };

           // ====== BOŞLUK EKLEME VE KOORDİNAT RANDOMIZASYON İŞLEMİ ======
           addressBody = processAddressData(addressBody);
           const finalCoordinates = {
               lat: addressBody.latitude,
               lng: addressBody.longitude
           };
           console.log('İşlenmiş adres verisi:', addressBody);

           // API'ye istek at
           try {
               const response = await fetch('https://tr.fd-api.com/api/v5/customers/addresses?locale=tr_TR', {
                   method: 'POST',
                   headers: {
                       'authorization': `Bearer ${token}`,
                       'accept': 'application/json',
                       'content-type': 'application/json;charset=UTF-8',
   					'x-pd-language-id': '2',
   					'x-fp-api-key': 'volo',
                   },
                   body: JSON.stringify(addressBody)
               });

               const result = await response.json();
               
               if (response.ok) {
                   console.log('✅ Adres başarıyla eklendi:', result);
                   
                   // API'den dönen GERÇEK adres verisini al
                   const addedAddressData = result?.data || result;
                   const addedAddressId = addedAddressData?.id;
                   console.log('📍 Eklenen adres ID:', addedAddressId);
                   console.log('📍 API\'den dönen gerçek adres verisi:', addedAddressData);
                   
                   saveLastUsedLocation(finalCoordinates);
                   
                   // 👤 AD/SOYAD GÜNCELLEMESİ - Adres eklendikten sonra
                   const selectedAddress = sessionData.selectedAddress;
                   if (selectedAddress && selectedAddress.first_name && selectedAddress.last_name) {
                       console.log('👤 Content Script - Ad/Soyad güncelleniyor:', {
                           first_name: selectedAddress.first_name,
                           last_name: selectedAddress.last_name
                       });
                       
                       try {
                           const customerResponse = await fetch('https://www.yemeksepeti.com/api/v5/customers', {
                               method: 'PUT',
                               headers: {
                                   'authorization': `Bearer ${token}`,
                                   'accept': 'application/json',
                                   'content-type': 'application/json;charset=UTF-8',
                                   'x-fp-api-key': 'volo',
                                   'origin': 'https://www.yemeksepeti.com',
                                   'referer': 'https://www.yemeksepeti.com/',
                                   'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36'
                               },
                               body: JSON.stringify({
                                   first_name: selectedAddress.first_name,
                                   last_name: selectedAddress.last_name
                               })
                           });
                           
                           if (customerResponse.ok) {
                               const customerResult = await customerResponse.json();
                               console.log('✅ Content Script - Ad/Soyad başarıyla güncellendi:', customerResult);
                           } else {
                               console.error('❌ Content Script - Ad/Soyad güncellenemedi:', customerResponse.status);
                           }
                       } catch (customerError) {
                           console.error('❌ Content Script - Ad/Soyad güncelleme hatası:', customerError);
                       }
                   }
                   
                   // İşlem tamamlandı, flag'i güncelle
                   addressAlreadyAdded = true;
                   addressAddingInProgress = false;
                   
                   // MRB token kontrolü - campaigns sayfasında kalması gerekiyor
                   const currentToken = sessionData?.token || '';
                   const isMrbToken = currentToken && currentToken.startsWith('MRB-');
                   const isOnCampaignsPage = window.location.href.includes('/campaigns');
                   
                   if (isMrbToken && isOnCampaignsPage) {
                       updateOverlayMessage('Adres başarıyla eklendi! Sayfa güncelleniyor...');
                   } else {
                       updateOverlayMessage('Adres başarıyla eklendi! Yemeksepeti ana sayfasına yönlendiriliyor...');
                   }
                   
                   // Otomatik adres ekleme flag'ini kaldır
                   sessionData.autoAddAddress = false;
                   sessionData.lastUsedCoordinates = finalCoordinates;
                   chrome.storage.sync.set({ 'yemekhub_session': sessionData });
                   chrome.storage.local.set({ 'ys_last_successful_location': finalCoordinates });
                   
                   // Yemeksepeti'nin ORİJİNAL localStorage formatlarını kullan
                   if (addedAddressData) {
                       // location-model-1: API response + ek alanlar (Yemeksepeti'nin orijinal formatı)
                       const locationModel1 = {
                           ...addedAddressData, // API'den gelen TÜM alanlar
                           // Yemeksepeti'nin eklediği ek alanlar
                           address: addedAddressData.formatted_customer_address,
                           addressId: addedAddressData.id,
                           formattedAddress: addedAddressData.formatted_customer_address,
                           street: addedAddressData.address_line1,
                           countryCode: addedAddressData.country_code
                       };
                       
                       // location-model-v2: Sadece API response (daha kompakt)
                       const locationModelV2 = { ...addedAddressData };
                       
                       // Her ikisini de localStorage'a kaydet (Yemeksepeti'nin yaptığı gibi)
                       localStorage.setItem('location-model-1', JSON.stringify(locationModel1));
                       localStorage.setItem('location-model-v2', JSON.stringify(locationModelV2));
                       
                       console.log('📍 YEMEKSEPETİ ORİJİNAL FORMAT - Her iki model de kaydedildi');
                       console.log('📍 location-model-1:', locationModel1.formatted_customer_address);
                       console.log('📍 location-model-v2:', locationModelV2.formatted_customer_address);
                       console.log('📍 Adres ID:', addedAddressData.id);
                       console.log('📍 Koordinatlar:', addedAddressData.latitude, addedAddressData.longitude);
                   } else {
                       console.warn('⚠️ API\'den adres verisi alınamadı, fallback kullanılıyor');
                       // Fallback - sadece location-model-1
                       const fallbackPayload = {
                           id: addedAddressId || `ext_${Date.now()}`,
                           formatted_customer_address: addressBody.formatted_customer_address,
                           address: addressBody.formatted_customer_address,
                           latitude: addressBody.latitude,
                           longitude: addressBody.longitude,
                           source: 'extension_fallback'
                       };
                       localStorage.setItem('location-model-1', JSON.stringify(fallbackPayload));
                   }
                   
                   // Session'a eklenen adres ID'sini kaydet
                   if (addedAddressId) {
                       sessionData.addedAddressId = addedAddressId;
                       chrome.storage.sync.set({ 'yemekhub_session': sessionData });
                       console.log('📍 Eklenen adres ID session\'a kaydedildi:', addedAddressId);
                   }
                   
                   console.log('✅ localStorage location-model-1 güncellendi, Yemeksepeti otomatik olarak bu adresi seçecek');
                   
                    // MRB token kontrolü - campaigns sayfasında kalması gerekiyor
                    const tokenForRedirect = sessionData?.token || '';
                    const isMrbTokenForRedirect = tokenForRedirect && tokenForRedirect.startsWith('MRB-');
                    const isOnCampaignsPageForRedirect = window.location.href.includes('/campaigns');
                    
                    if (isMrbTokenForRedirect && isOnCampaignsPageForRedirect) {
                        // MRB token ve campaigns sayfasındaysa - yönlendirme yapma, sadece overlay'i kaldır
                        console.log('🎯 MRB Token - Campaigns sayfasında kalınıyor, yönlendirme yapılmadı');
                        setTimeout(() => {
                            removeBlockingOverlay();
                            // Sayfayı yenileme - kullanıcı campaigns sayfasında kalsın
                        }, 1000);
                    } else {
                        // Normal tokenlar için restoran sayfasına yönlendir
                        setTimeout(() => {
                            removeBlockingOverlay();
                            triggerPostAddressRedirect(sessionData, finalCoordinates);
                        }, 1000);
                    }
                   
               } else {
                   console.error('❌ Adres eklenirken hata:', result);
                   addressAddingInProgress = false;
                   
                   // Hata durumunda da akıllı yönlendirme yap
                   updateOverlayMessage('Adres eklenemedi, ana sayfaya yönlendiriliyor...');
                   chrome.storage.local.remove('ys_last_successful_location');
                   setTimeout(() => {
                       removeBlockingOverlay();
                       triggerPostAddressRedirect(sessionData, coordinates);
                   }, 1500);
               }
           } catch (error) {
               console.error('❌ API isteği başarısız:', error);
               addressAddingInProgress = false;
               
               // Hata durumunda da akıllı yönlendirme yap
               updateOverlayMessage('Bağlantı hatası, ana sayfaya yönlendiriliyor...');
               chrome.storage.local.remove('ys_last_successful_location');
               setTimeout(() => {
                   removeBlockingOverlay();
                   triggerPostAddressRedirect(sessionData, coordinates);
               }, 1500);
           }
       });
   } catch (error) {
       console.error('❌ Otomatik adres ekleme hatası:', error);
       addressAddingInProgress = false;
       removeBlockingOverlay();
       // Hata durumunda da akıllı yönlendirme yap
       chrome.storage.local.remove('ys_last_successful_location');
       chrome.storage.sync.get(['yemekhub_session'], function(result) {
           triggerPostAddressRedirect(result?.yemekhub_session, null);
       });
   }
}

// ============ ANA İŞLEM MANTIGI - YENİLENMİŞ VERSİYON (Cookie kontrol odaklı) ============

// Ana işlem kontrolü - Extension sayfası veya yemeksepeti.com için
function handleMainProcess() {
   // 🛡️ Güvenlik kontrolü - sadece extension sayfası veya yemeksepeti domain'inde çalış
   const isExtensionPage = window.location.href.includes('chrome-extension://');
   const isYemeksepetiPage = isYemeksepetiDomain();
   
   if (!isExtensionPage && !isYemeksepetiPage) {
       console.log('🛡️ GÜVENLİK: Extension veya yemeksepeti sayfası değil, işlem atlandı');
       return;
   }
   
   chrome.storage.sync.get(['yemekhub_session'], async function (result) {
       HBY_SessionData = result.yemekhub_session;

       // Session bilgisi varsa ve giriş yapılmışsa
       if (HBY_SessionData && HBY_SessionData.isLogged) {
           
           // Eğer hala extension sayfasındaysek (başarı sayfası) direkt yönlendir
           if (isExtensionPage) {
               console.log('🚀 Extension sayfasında, yemeksepeti.com\'a yönlendiriliyor...');
               
               // Overlay göster
               createBlockingOverlay('Yemeksepeti\'ne yönlendiriliyor...');
               
               // Kısa bir bekleme sonrası akıllı yönlendirme yap
               setTimeout(() => {
                   performSmartRedirectFromContentScript();
               }, 1500);
               return;
           }
           
           // ===== YEMEKSEPETİ.COM SAYFASINDAYIZ =====
           // Bu noktada temizlik işlemleri ZATEN popup.js'de yapıldı!
           // Cookie'ler de popup.js'de eklenmeye çalışıldı!
           
           console.log('✅ Yemeksepeti.com\'da, cookie kontrolü yapılıyor...');
           
           // 🍪 COOKIE KONTROLÜ
           const hasAccessToken = document.cookie.includes('access_token=');
           
           if (hasAccessToken) {
               console.log('✅ Cookie\'ler mevcut (popup\'ta eklendi)');
               
               // Cookie ekleme flag'ini güncelle
               if (!HBY_SessionData.isCookieInserted) {
                   HBY_SessionData.isCookieInserted = true;
                   chrome.storage.sync.set({ 'yemekhub_session': HBY_SessionData });
               }
               
               // Otomatik adres ekleme kontrolü
               if (HBY_SessionData.autoAddAddress && !addressAlreadyAdded && !addressAddingInProgress) {
                   console.log('📍 Adres ekleme başlatılıyor...');
                   createBlockingOverlay('Adres ekleniyor...');

                   setTimeout(() => {
                       autoAddAddress().catch((err) => {
                           console.error('📍 Adres ekleme beklenmedik hata:', err);
                           chrome.storage.local.remove('ys_last_successful_location');
                           triggerPostAddressRedirect(HBY_SessionData, extractCoordinateFromAddress(HBY_SessionData?.selectedAddress));
                       });
                   }, 300);
               } else if (!HBY_SessionData.autoAddAddress) {
                   console.log('✅ Adres ekleme yok, sayfa hazır');
                   removeBlockingOverlay();
               } else {
                   console.log('✅ Adres ekleme zaten tamamlandı');
                   removeBlockingOverlay();
               }
               
           } else if (!HBY_SessionData.isCookieInserted) {
               console.log('⚠️ Cookie\'ler eksik, popup\'ta ekleme başarısız olmuş. Content script\'te Background.js üzerinden deneniyor...');
               
               // Fallback: Background.js üzerinden cookie ekleme (CHROME 131+ UYUMLU)
               createBlockingOverlay('Oturum bilgileri yükleniyor...');
               
               // ⚡ Background.js'e cookie ekleme isteği gönder
               chrome.runtime.sendMessage({
                   action: 'addCookiesFromContentScript',
                   cookies: HBY_SessionData.cookies
               }, function(response) {
                   if (chrome.runtime.lastError) {
                       console.error('❌ Background ile iletişim hatası:', chrome.runtime.lastError);
                       removeBlockingOverlay();
                       return;
                   }
                   
                   if (response && response.success) {
                       console.log(`✅ Cookie\'ler background.js üzerinden eklendi: ${response.successCount}/${response.total}`);
                       
                       // Cookie ekleme flag'ini güncelle
                       HBY_SessionData.isCookieInserted = true;
                       chrome.storage.sync.set({ 'yemekhub_session': HBY_SessionData });
                       
                       // Cookie'lerin aktif olması için kısa bekleme
                       setTimeout(() => {
                           if (HBY_SessionData.autoAddAddress && !addressAlreadyAdded && !addressAddingInProgress) {
                               updateOverlayMessage('Adres ekleniyor...');
                               setTimeout(() => {
                                   autoAddAddress().catch((err) => {
                                       console.error('📍 Adres ekleme beklenmedik hata:', err);
                                       chrome.storage.local.remove('ys_last_successful_location');
                                       triggerPostAddressRedirect(HBY_SessionData, extractCoordinateFromAddress(HBY_SessionData?.selectedAddress));
                                   });
                               }, 300);
                           } else {
                               removeBlockingOverlay();
                           }
                       }, 1000); // Background'den cookie eklenince biraz daha bekle
                       
                   } else {
                       console.error('❌ Cookie\'ler background.js\'te eklenemedi:', response?.error || 'Bilinmeyen hata');
                       // Son çare: Sayfayı yenile
                       setTimeout(() => {
                           console.log('🔄 Cookie ekleme başarısız, sayfa yenileniyor...');
                           window.location.reload();
                       }, 1000);
                   }
               });
               
           } else {
               console.error('❌ Cookie\'ler eksik ve popup\'ta da ekleme yapılmış gösteriliyor.');
           }
       } else {
           console.log('🚫 Session bilgisi yok veya geçersiz');
           removeBlockingOverlay();
       }
   });
}

// Sayfa yüklendiğinde ana işlemi başlat
if (document.readyState === 'loading') {
   document.addEventListener('DOMContentLoaded', handleMainProcess);
} else {
   handleMainProcess();
}

// Sayfa yüklendikten sonra localStorage kontrolü (Her iki model)
setTimeout(() => {
    if (window.location.hostname.includes('yemeksepeti.com')) {
        const locationModel1 = localStorage.getItem('location-model-1');
        const locationModelV2 = localStorage.getItem('location-model-v2');
        
        console.log('📍 localStorage Kontrol:');
        console.log('📍 location-model-1:', locationModel1 ? '✅ Mevcut' : '❌ Yok');
        console.log('📍 location-model-v2:', locationModelV2 ? '✅ Mevcut' : '❌ Yok');
        
        if (locationModel1) {
            try {
                const parsedLocation1 = JSON.parse(locationModel1);
                console.log('📍 location-model-1 adres:', parsedLocation1.formatted_customer_address);
                console.log('📍 Adres ID:', parsedLocation1.id || parsedLocation1.addressId);
                
                if (parsedLocation1.source === 'extension_fallback') {
                    console.log('⚠️ Extension fallback verisi');
                } else if (parsedLocation1.addressId) {
                    console.log('✅ Yemeksepeti orijinal formatı tespit edildi');
                }
            } catch (e) {
                console.warn('⚠️ location-model-1 parse edilemedi:', e);
            }
        }
        
        if (locationModelV2) {
            try {
                const parsedLocationV2 = JSON.parse(locationModelV2);
                console.log('📍 location-model-v2 adres:', parsedLocationV2.formatted_customer_address);
                console.log('📍 V2 Adres ID:', parsedLocationV2.id);
            } catch (e) {
                console.warn('⚠️ location-model-v2 parse edilemedi:', e);
            }
        }
    }
}, 2000); // 2 saniye bekle

// ============ SAYFADA GİZLEME İŞLEMLERİ ============
var myintv_account = setInterval(() => {
 if (window.location.href === "https://www.yemeksepeti.com/account") {
   const input = document.querySelector('input[data-testid="contact-form-mobile-number-input"]');
   if (input) {
     const parent = input.closest('.input-box');
     if (parent) {
       parent.remove();
       clearInterval(myintv_account);
     }
   }
 }
}, 500);

if (window.location.href.includes("/checkout")) {
 var myintv_checkout = setInterval(() => {
   const input = document.querySelector('input#contact-information-phone');
   if (input) {
     const wrapper = input.closest('div.input-box.js-input-box');
     if (wrapper && wrapper.dataset.removed !== "true") {
       wrapper.remove();
       wrapper.dataset.removed = "true"; // tekrar silinmesin diye işaretle        
     }
   }
 }, 500);
}

if (window.location.href.includes("/checkout")) {
 var myintv_phoneTextCleaner = setInterval(() => {
   const telDivs = document.querySelectorAll('div.f-paragraph-small-font-size.fw-paragraph-small-font-weight.lh-paragraph-small-line-height.ff-paragraph-small-font-family');
   
   telDivs.forEach(div => {
     const text = div.textContent.trim();
     if (text.startsWith('+') && div.dataset.removed !== "true") {
       div.remove();
       div.dataset.removed = "true";
     }
   });
 }, 500);
}

if (window.location.href === "https://www.yemeksepeti.com/account") {
 var myintv_accountDeleteBlock = setInterval(() => {
   const deleteBlock = document.querySelector('div[data-testid="account-deletion"]');
   if (deleteBlock && deleteBlock.dataset.removed !== "true") {
     deleteBlock.remove();
     deleteBlock.dataset.removed = "true";
   }
 }, 500);
}

var myintv_logoutRemover = setInterval(() => {
const logoutLink = document.querySelector('a[href="/logout"]');

if (logoutLink && logoutLink.dataset.removed !== "true") {
  const wrapper = logoutLink.closest('li[role="presentation"]');
  if (wrapper) {
    wrapper.remove();
    logoutLink.dataset.removed = "true";
  }
}
}, 500);



// CSS animasyon ekle (null check ile)
if (document.head) {
    const style = document.createElement('style');
    style.textContent = `
       @keyframes slideIn {
           from {
               transform: translateX(100%);
               opacity: 0;
           }
           to {
               transform: translateX(0);
               opacity: 1;
           }
       }
   `;
    document.head.appendChild(style);
}

// ============ YEMEKTIME OTOMATİK GİRİŞ SİSTEMİ ( GİBİ) ============
console.log('🔧 YEMEKTIME Content Script yüklendi');
console.log('🌐 Current URL:', window.location.href);
console.log('🌐 Hostname:', window.location.hostname);
console.log('🆔 Extension ID:', chrome.runtime.id);

// Güvenilir domainler
const trustedDomains = ['troyagame.com', 'yemektime.com.tr', 'kuponmarket.net', 'localhost'];

// Web sayfasından gelen mesajları dinle
window.addEventListener('message', function(event) {
    if (event.source !== window) return;
    
    const data = event.data;
    
    try {
        const eventOrigin = new URL(event.origin);
        const isTrusted = trustedDomains.some(domain => eventOrigin.hostname.includes(domain));
        if (!isTrusted) return;
    } catch (e) {
        return;
    }
    
    // YEMEKTIME web sitesinden gelen otomatik giriş isteği
    if (data && data.source === 'YEMEKTIME_WEBSITE' && data.action === 'loginWithToken' && data.token) {
        console.log('🚀 Content Script: Token giriş isteği alındı!');
        console.log('📝 Content Script: Token:', data.token.substring(0, 10) + '...');
        
        // Background script'e token'ı gönder
        console.log('📤 Content Script: Background\'a mesaj gönderiliyor...');
        
        // Extension context kontrolü
        try {
            if (!chrome.runtime?.id) {
                throw new Error('Extension context geçersiz');
            }
            
            chrome.runtime.sendMessage({
                action: 'openLoginPageWithToken',
                token: data.token
            }, function(response) {
                if (chrome.runtime.lastError) {
                    console.error('❌ Content Script: Background ile iletişim hatası:', chrome.runtime.lastError);
                    
                    // Kullanıcıya sayfayı yenilemesini söyle
                    alert('⚠️ Eklenti güncellendi!\n\nLütfen bu sayfayı yenileyin (F5) ve tekrar deneyin.');
                    
                    // Web sayfasına hata bildir
                    window.postMessage({
                        source: 'YEMEKTIME_EXTENSION',
                        action: 'loginResponse',
                        success: false,
                        error: 'Extension ile iletişim kurulamadı - Sayfayı yenileyin'
                    }, '*');
                } else {
                    console.log('✅ Content Script: Background\'dan yanıt alındı:', response);
                    
                    // Web sayfasına başarı bildir
                    window.postMessage({
                        source: 'YEMEKTIME_EXTENSION',
                        action: 'loginResponse',
                        success: true
                    }, '*');
                }
            });
        } catch (e) {
            console.error('❌ Extension context hatası:', e);
            alert('⚠️ Eklenti güncellendi!\n\nLütfen bu sayfayı yenileyin (F5) ve tekrar deneyin.');
        }
    }
}, false);

console.log('✅ YEMEKTIME mesaj dinleyicisi aktif edildi');
console.log('🎯 Dinlenen domainler:', trustedDomains.join(', '));
