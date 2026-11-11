// MAIN world: yolculuk oluştur kilidi. Yeni yolcu / React yeniden çizimi kilidi açamaz.
(function () {
  'use strict';
  if (window.__kmTripCooldownMain) return;
  window.__kmTripCooldownMain = true;

  function lockUntil() {
    return Number(document.documentElement.getAttribute('data-km-trip-lock-until') || 0);
  }

  function locked() {
    return lockUntil() > Date.now();
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

  function isCreateTripEl(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.id === 'km-trip-cooldown-banner' || el.hasAttribute('data-km-trip-shield')) return false;
    var tag = (el.tagName || '').toLowerCase();
    var role = el.getAttribute('role') || '';
    var testid = String(el.getAttribute('data-testid') || '').toLowerCase();
    var clickable = tag === 'button' || tag === 'a' || role === 'button' || el.getAttribute('tabindex') === '0';
    if (/triprequest|request-trip|confirm-trip|request_ride|confirm_ride/.test(testid) && !isExemptText(labelOf(el))) {
      return true;
    }
    if (!clickable) return false;
    return isCreateTripText(labelOf(el));
  }

  function findCtaFromEvent(target) {
    if (!target || !target.closest) return null;
    var el = target.closest('button, [role="button"], a, [data-testid], [tabindex="0"]');
    if (el && isCreateTripEl(el)) return el;
    var n = target;
    for (var i = 0; i < 6 && n && n.nodeType === 1; i++) {
      if (isCreateTripEl(n) || isCreateTripText(labelOf(n))) return n;
      n = n.parentElement;
    }
    return null;
  }

  function isTripRequest(url, body) {
    var s = '';
    try {
      s = typeof body === 'string' ? body : (body ? JSON.stringify(body) : '');
    } catch (_) {
      s = String(body || '');
    }
    if (/triprequest/i.test(s)) return true;
    return /triprequest/i.test(String(url || ''));
  }

  function blockEvt(e) {
    if (!locked()) return;
    if (findCtaFromEvent(e.target)) {
      e.preventDefault();
      e.stopPropagation();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    }
  }

  ['click', 'pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'keydown'].forEach(function (type) {
    document.addEventListener(type, function (e) {
      if (type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
      blockEvt(e);
    }, true);
  });

  var origFetch = window.fetch;
  if (typeof origFetch === 'function') {
    window.fetch = function (input, init) {
      var url = '';
      var body = init && init.body;
      try {
        if (typeof input === 'string') url = input;
        else if (input) {
          url = input.url || '';
          if (body == null && typeof input.clone === 'function') {
            /* Request body already consumed later; url/body from init is enough */
          }
        }
      } catch (_) {}
      if (locked() && isTripRequest(url, body)) {
        return Promise.resolve(new Response(JSON.stringify({
          errors: [{ message: 'Yeni yolculuk için bekleyin.' }]
        }), { status: 429, headers: { 'content-type': 'application/json' } }));
      }
      return origFetch.apply(this, arguments);
    };
  }

  var XHR = window.XMLHttpRequest;
  if (XHR && XHR.prototype) {
    var open = XHR.prototype.open;
    var send = XHR.prototype.send;
    XHR.prototype.open = function (method, url) {
      this.__kmTripUrl = url;
      return open.apply(this, arguments);
    };
    XHR.prototype.send = function (body) {
      if (locked() && isTripRequest(this.__kmTripUrl, body)) {
        try {
          Object.defineProperty(this, 'status', { configurable: true, get: function () { return 429; } });
          Object.defineProperty(this, 'readyState', { configurable: true, get: function () { return 4; } });
          Object.defineProperty(this, 'responseText', {
            configurable: true,
            get: function () { return '{"errors":[{"message":"Yeni yolculuk için bekleyin."}]}'; }
          });
        } catch (_) {}
        if (typeof this.onerror === 'function') {
          try { this.onerror(new Event('error')); } catch (_) {}
        }
        return;
      }
      return send.apply(this, arguments);
    };
  }
})();
