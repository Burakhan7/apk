// Uber IDVP kaçışı + logout engeli + JA3 /_events drop (DODO paritesi).
// TripRequest yakalama KM interceptor'da kalır; bu dosya onun altında çalışır.
(function () {
  'use strict';

  if (window.__kmUberIdvpGuardLoaded) return;
  window.__kmUberIdvpGuardLoaded = true;

  function isEventsEndpoint(url) {
    try {
      var p = new URL(url, window.location.href).pathname.toLowerCase();
      return p === '/_events' || p === '/go/_events';
    } catch (_) { return false; }
  }

  function isUberLogoutEndpoint(url) {
    if (!url || typeof url !== 'string') return false;
    var u = url.toLowerCase();
    return u.includes('/logout') || u.includes('/sign-out') || u.includes('/signout') ||
      (u.includes('auth.uber.com') && (u.includes('/v2/logout') || u.includes('/oauth/revoke')));
  }

  function isIdvpEndpoint(url) {
    if (!url || typeof url !== 'string') return false;
    var u = url.toLowerCase();
    return u.indexOf('idvp_requestverification') !== -1 ||
      u.indexOf('idvp_needverification') !== -1 ||
      u.indexOf('identity-verification') !== -1 ||
      u.indexOf('identityverification') !== -1;
  }

  function isIdvpBody(bodyStr) {
    if (!bodyStr || typeof bodyStr !== 'string') return false;
    var s = bodyStr.toLowerCase();
    return s.indexOf('idvp_requestverification') !== -1 ||
      s.indexOf('idvp_needverification') !== -1 ||
      s.indexOf('identityverification') !== -1;
  }

  var _idvpTriggered = false;
  var _idvpOverlayEl = null;

  function handleIdvpDetected() {
    if (_idvpTriggered) return;
    _idvpTriggered = true;
    _showIdvpOverlay();
    window.postMessage({
      source: 'KM_UBER_IDVP',
      action: 'uberIdVerifyDetected',
      currentUrl: window.location.href
    }, '*');
    setTimeout(function () {
      if (_idvpOverlayEl) {
        _updateIdvpOverlay('Başarısız', 'Hesap değiştirilemedi, sayfayı yenileyin.', true);
        setTimeout(function () { _hideIdvpOverlay(); }, 5000);
      }
    }, 30000);
  }

  function _showIdvpOverlay() {
    if (_idvpOverlayEl) return;
    var css = document.createElement('style');
    css.id = 'km-idvp-overlay-css';
    css.textContent =
      '#km-idvp-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.85);' +
      'display:flex;align-items:center;justify-content:center;z-index:2147483647;' +
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;}' +
      '#km-idvp-overlay .div-box{background:#1a1a2e;border-radius:16px;padding:32px 48px;' +
      'text-align:center;box-shadow:0 20px 60px rgba(0,0,0,0.5);min-width:300px;border:2px solid #ff9800;}' +
      '#km-idvp-overlay .div-icon{font-size:48px;margin-bottom:16px;}' +
      '#km-idvp-overlay .div-title{font-size:20px;font-weight:700;color:#ff9800;margin-bottom:8px;}' +
      '#km-idvp-overlay .div-sub{font-size:14px;color:#ccc;}' +
      '#km-idvp-overlay .div-ring{width:32px;height:32px;border:3px solid #333;' +
      'border-top-color:#ff9800;border-radius:50%;animation:kmIdvpSpin 1s linear infinite;margin:12px auto 0;}' +
      '@keyframes kmIdvpSpin{to{transform:rotate(360deg);}}';
    (document.head || document.documentElement).appendChild(css);

    var el = document.createElement('div');
    el.id = 'km-idvp-overlay';
    el.innerHTML =
      '<div class="div-box">' +
      '<div class="div-icon">⚠️</div>' +
      '<div class="div-title">Hesap Değiştiriliyor</div>' +
      '<div class="div-sub">Kimlik doğrulama tespit edildi, yeni hesaba geçiliyor...</div>' +
      '<div class="div-ring"></div>' +
      '</div>';
    (document.body || document.documentElement).appendChild(el);
    _idvpOverlayEl = el;
  }

  function _updateIdvpOverlay(title, sub, isError) {
    if (!_idvpOverlayEl) return;
    try {
      var t = _idvpOverlayEl.querySelector('.div-title');
      var s = _idvpOverlayEl.querySelector('.div-sub');
      var ring = _idvpOverlayEl.querySelector('.div-ring');
      var icon = _idvpOverlayEl.querySelector('.div-icon');
      if (t && title) t.textContent = title;
      if (s && sub) s.textContent = sub;
      if (ring) ring.style.display = 'none';
      if (isError && t) t.style.color = '#f44336';
      if (isError && icon) icon.textContent = '✕';
    } catch (_) {}
  }

  function _hideIdvpOverlay() {
    if (!_idvpOverlayEl) return;
    try {
      _idvpOverlayEl.style.transition = 'opacity 0.3s ease';
      _idvpOverlayEl.style.opacity = '0';
      var el = _idvpOverlayEl;
      _idvpOverlayEl = null;
      _idvpTriggered = false;
      setTimeout(function () {
        try { el.remove(); } catch (_) {}
        try {
          var c = document.getElementById('km-idvp-overlay-css');
          if (c) c.remove();
        } catch (_) {}
      }, 350);
    } catch (_) {}
  }

  window.addEventListener('message', function (event) {
    if (!event.data || event.data.source !== 'KM_UBER_IDVP_CONTENT') return;
    if (event.data.action !== 'idvpResult') return;
    if (event.data.success) {
      _updateIdvpOverlay('Başarılı!', 'Yeni hesaba geçiliyor...', false);
    } else {
      _updateIdvpOverlay('Başarısız', event.data.error || 'Hesap değiştirilemedi', true);
      setTimeout(function () { _hideIdvpOverlay(); }, 5000);
    }
  });

  var EDGE_PATTERNS = [
    'edge_tls_ja3_fingerprint', 'tls_ja3', 'ja3_fingerprint', 'ja3_hash',
    '"browser":"edge"', '"browser":"chrome"', '"browser":"brave"',
    '"browser":"yandex"', '"browser":"opera"',
    '"browser": "edge"', '"browser": "chrome"', '"browser": "brave"'
  ];

  function hasEdgeJa3(bodyStr) {
    if (!bodyStr || typeof bodyStr !== 'string') return false;
    var lower = bodyStr.toLowerCase();
    for (var i = 0; i < EDGE_PATTERNS.length; i++) {
      if (lower.indexOf(EDGE_PATTERNS[i].toLowerCase()) !== -1) return true;
    }
    return false;
  }

  function makeFakeXhrOk(xhr) {
    Object.defineProperty(xhr, 'readyState', { configurable: true, get: function () { return 4; } });
    Object.defineProperty(xhr, 'status', { configurable: true, get: function () { return 200; } });
    Object.defineProperty(xhr, 'statusText', { configurable: true, get: function () { return 'OK'; } });
    Object.defineProperty(xhr, 'responseText', { configurable: true, get: function () { return '{}'; } });
    Object.defineProperty(xhr, 'response', { configurable: true, get: function () { return '{}'; } });
    setTimeout(function () {
      if (typeof xhr.onreadystatechange === 'function') xhr.onreadystatechange();
      if (typeof xhr.onload === 'function') xhr.onload();
      if (typeof xhr.onloadend === 'function') xhr.onloadend();
      try { xhr.dispatchEvent(new Event('readystatechange')); } catch (_) {}
      try { xhr.dispatchEvent(new Event('load')); } catch (_) {}
      try { xhr.dispatchEvent(new Event('loadend')); } catch (_) {}
    }, 0);
  }

  var _origOpen = XMLHttpRequest.prototype.open;
  var _origSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url) {
    this._kmIdvpUrl = url;
    this._kmIdvpMethod = method;
    return _origOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function (body) {
    var url = this._kmIdvpUrl || '';
    var method = (this._kmIdvpMethod || 'GET').toUpperCase();
    var xhr = this;

    if (isUberLogoutEndpoint(url)) {
      makeFakeXhrOk(xhr);
      return;
    }
    if (isIdvpEndpoint(url) || isIdvpBody(typeof body === 'string' ? body : '')) {
      handleIdvpDetected();
    }

    var isPost = method === 'POST' || method === 'PUT';
    var bodyStr = typeof body === 'string' ? body : null;
    if (isPost && isEventsEndpoint(url) && hasEdgeJa3(bodyStr)) {
      try { xhr.abort(); } catch (_) {}
      makeFakeXhrOk(xhr);
      return;
    }
    return _origSend.apply(this, arguments);
  };

  if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
    var _origSendBeacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = function (url, data) {
      try {
        if (isUberLogoutEndpoint(String(url))) return true;
        var bodyStr = typeof data === 'string' ? data : (data && typeof data.toString === 'function' ? data.toString() : null);
        if (isEventsEndpoint(url) && hasEdgeJa3(bodyStr)) return true;
      } catch (_) {}
      return _origSendBeacon(url, data);
    };
  }

  var _origFetch = window.fetch;
  window.fetch = function (resource, init) {
    init = init || {};
    var urlString = resource instanceof Request ? resource.url : String(resource);
    var method = init.method || (resource instanceof Request ? resource.method : 'GET');
    var bodyStr = typeof init.body === 'string' ? init.body : '';

    if (isUberLogoutEndpoint(urlString)) {
      return Promise.resolve(new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }));
    }
    if (isIdvpEndpoint(urlString) || isIdvpBody(bodyStr)) {
      handleIdvpDetected();
    }

    var isPost = String(method || 'GET').toUpperCase() === 'POST' || String(method || 'GET').toUpperCase() === 'PUT';
    if (isPost && isEventsEndpoint(urlString) && hasEdgeJa3(bodyStr)) {
      return Promise.resolve(new Response('{}', { status: 200, statusText: 'OK', headers: { 'Content-Type': 'application/json' } }));
    }
    return _origFetch.apply(window, arguments);
  };

  try {
    var proto = window.location.__proto__;
    var _assignDesc = Object.getOwnPropertyDescriptor(proto, 'assign');
    if (_assignDesc && _assignDesc.value) {
      var _origAssign = _assignDesc.value;
      proto.assign = function (url) {
        if (isUberLogoutEndpoint(String(url))) return;
        if (isIdvpEndpoint(String(url))) handleIdvpDetected();
        return _origAssign.call(this, url);
      };
    }
  } catch (_) {}

  try {
    var _hrefDesc = Object.getOwnPropertyDescriptor(window.location.__proto__, 'href');
    if (_hrefDesc && _hrefDesc.set) {
      var _origHrefSet = _hrefDesc.set;
      Object.defineProperty(window.location, 'href', {
        set: function (val) {
          if (isUberLogoutEndpoint(String(val))) return;
          if (isIdvpEndpoint(String(val))) handleIdvpDetected();
          _origHrefSet.call(this, val);
        },
        get: _hrefDesc.get ? _hrefDesc.get.bind(window.location) : undefined,
        configurable: true
      });
    }
  } catch (_) {}

  try {
    var _replaceDesc = Object.getOwnPropertyDescriptor(window.location.__proto__, 'replace');
    if (_replaceDesc && _replaceDesc.value) {
      var _origReplace = _replaceDesc.value;
      window.location.__proto__.replace = function (url) {
        if (isUberLogoutEndpoint(String(url))) return;
        if (isIdvpEndpoint(String(url))) handleIdvpDetected();
        return _origReplace.call(this, url);
      };
    }
  } catch (_) {}

  try {
    if (isIdvpEndpoint(window.location.href)) handleIdvpDetected();
  } catch (_) {}
})();
