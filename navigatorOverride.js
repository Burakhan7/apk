(function () {
  'use strict';

  if (window.__uberNavOverrideLoaded) return;
  window.__uberNavOverrideLoaded = true;
  window.__uberMainWorldActive = true;

  // ─── Safari 18.6 / macOS 14.7.6 Sonoma / Apple M2 fingerprint ───────────────
  var FP = {
    userAgent:           'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15',
    appVersion:          '5.0 (Macintosh; Intel Mac OS X 14_7_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15',
    platform:            'MacIntel',
    language:            'tr-TR',
    languages:           Object.freeze(['tr-TR', 'tr', 'en-US', 'en']),
    hardwareConcurrency: 8,
    product:             'Gecko',
    productSub:          '20030107',
    vendor:              'Apple Computer, Inc.',
    vendorSub:           '',
    doNotTrack:          null,
    maxTouchPoints:      0,
  };

  var SCR = {
    width:       1496,
    height:       967,
    colorDepth:    24,
    pixelDepth:    24,
    availTop:       0,
    availLeft:      0,
    availHeight:  927,
    availWidth:  1496,
  };

  var WEBGL = {
    vendor:   'Apple Inc.',
    renderer: 'Apple M2',
  };

  function def(obj, prop, value) {
    try {
      Object.defineProperty(obj, prop, {
        get: function () { return value; },
        configurable: true,
        enumerable: true,
      });
    } catch (_) {}
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // UDI / InAuth _cc — cfp yükünü XOR ile decode edip Safari/macOS profiline yama
  // ═══════════════════════════════════════════════════════════════════════════════
  (function () {
    var XOR_KEY = [89, 231, 225, 55];

    function _decodeMeta(encoded) {
      var binary = atob(encoded);
      var bytes  = new Uint8Array(binary.length);
      for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      var xorStr = new TextDecoder('utf-8').decode(bytes);
      var json   = '';
      for (var j = 0; j < xorStr.length; j++)
        json += String.fromCharCode(xorStr.charCodeAt(j) ^ XOR_KEY[j % 4]);
      return JSON.parse(json);
    }

    function _encodeMeta(data) {
      var json   = JSON.stringify(data);
      var xorStr = '';
      for (var i = 0; i < json.length; i++)
        xorStr += String.fromCharCode(json.charCodeAt(i) ^ XOR_KEY[i % 4]);
      var utf8   = new TextEncoder().encode(xorStr);
      var bin    = '';
      for (var i = 0; i < utf8.length; i++) bin += String.fromCharCode(utf8[i]);
      return btoa(bin);
    }

    function _set(d, changes, key, val) {
      var oldStr = JSON.stringify(d[key]);
      var newStr = JSON.stringify(val);
      if (oldStr !== newStr) {
        changes.push({ key: key, from: d[key], to: val });
        d[key] = val;
      }
    }
    function _del(d, changes, key) {
      if (key in d) {
        changes.push({ key: key, from: d[key], to: '(silindi)' });
        delete d[key];
      }
    }

    function _patchMeta(encoded) {
      try {
        var d       = _decodeMeta(encoded);
        var changes = [];
        var s = function (k, v) { _set(d, changes, k, v); };
        var r = function (k)    { _del(d, changes, k);    };

        r('fresh-cookie');
        s('canvas_spoofing', 0);
        s('navigator.automationEnabled', false);

        s('navigator.userAgent',           FP.userAgent);
        s('navigator.appVersion',          FP.appVersion);
        s('navigator.platform',            'MacIntel');
        s('navigator.hardwareConcurrency', '8');
        s('navigator.deviceMemory',        '8');
        s('navigator.vendor',              'Apple Computer, Inc.');
        s('navigator.doNotTrack',          null);

        s('ex_browser_type', 'Safari');

        // Safari'de userAgentData yok
        r('navigator.userAgentData.brands');
        r('navigator.userAgentData.mobile');
        r('navigator.userAgentData.platform');
        if (d.hasOwnProperty('navigator.userAgentData.highEntropyValues.platform'))
          r('navigator.userAgentData.highEntropyValues.platform');
        if (d.hasOwnProperty('navigator.userAgentData.highEntropyValues.platformVersion'))
          r('navigator.userAgentData.highEntropyValues.platformVersion');
        if (d.hasOwnProperty('navigator.userAgentData.highEntropyValues.architecture'))
          r('navigator.userAgentData.highEntropyValues.architecture');
        if (d.hasOwnProperty('navigator.userAgentData.highEntropyValues.model'))
          r('navigator.userAgentData.highEntropyValues.model');

        s('window.screen.width',             '1496'); s('window.screen.height',      '967');
        s('window.screen.availWidth',        '1496'); s('window.screen.availHeight', '927');
        s('screen.availWidth',               '1496'); s('screen.availHeight',        '927');
        s('window.outerWidth',               '1496'); s('window.outerHeight',        '967');
        s('window.innerWidth',               '1496'); s('window.innerHeight',        '887');
        s('window.devicePixelRatio',         '2');
        s('window.screen.colorDepth',        '24');   s('window.screen.pixelDepth',  '24');
        s('window.screen.orientation.type',  'landscape-primary');
        s('window.screen.orientation.angle', '90');

        s('webgl-vendor-real',   'Apple Inc.');
        s('webgl-renderer-real', 'Apple M2');

        s('navigator.plugins.count', 1);
        r('plugin-PDF Viewer-filename');            r('plugin-PDF Viewer-desc');
        r('plugin-Chrome PDF Viewer-filename');     r('plugin-Chrome PDF Viewer-desc');
        r('plugin-Chromium PDF Viewer-filename');   r('plugin-Chromium PDF Viewer-desc');
        r('plugin-Microsoft Edge PDF Viewer-filename');
        r('plugin-Microsoft Edge PDF Viewer-desc');
        s('plugin-WebKit built-in PDF-filename', 'internal-pdf-viewer');
        s('plugin-WebKit built-in PDF-desc',     'Portable Document Format');

        // Safari'de NetworkInformation API yok
        r('navigator.connection.effectiveType');
        r('navigator.connection.rtt');
        r('navigator.connection.saveData');
        r('navigator.connection.downlink');

        if (d.hasOwnProperty('js-errors')) s('js-errors', []);

        s('webgl-version',      'WebGL 1.0');
        s('webgl-glsl-version', 'WebGL GLSL ES 1.00');
        s('webgl-vendor',       'Apple Inc.');
        s('webgl-renderer',     'Apple M2');
        s('webgl2-supported',   true);
        s('webgl-max-aa',       '4');

        s('webgl-extensions', [
          'ANGLE_instanced_arrays',
          'EXT_blend_minmax',
          'EXT_color_buffer_half_float',
          'EXT_frag_depth',
          'EXT_sRGB',
          'EXT_shader_texture_lod',
          'EXT_texture_compression_bptc',
          'EXT_texture_compression_rgtc',
          'EXT_texture_filter_anisotropic',
          'EXT_color_buffer_float',
          'KHR_parallel_shader_compile',
          'OES_element_index_uint',
          'OES_fbo_render_mipmap',
          'OES_standard_derivatives',
          'OES_texture_float',
          'OES_texture_float_linear',
          'OES_texture_half_float',
          'OES_texture_half_float_linear',
          'OES_vertex_array_object',
          'WEBGL_color_buffer_float',
          'WEBGL_compressed_texture_astc',
          'WEBGL_compressed_texture_etc',
          'WEBGL_compressed_texture_etc1',
          'WEBGL_compressed_texture_s3tc',
          'WEBGL_compressed_texture_s3tc_srgb',
          'WEBGL_depth_texture',
          'WEBGL_draw_buffers',
          'WEBGL_lose_context',
          'WEBGL_debug_renderer_info',
        ]);

        if (d.hasOwnProperty('browser-features')) {
          var bf = d['browser-features'];
          bf.vibrate_support                = false;
          bf.web_sql_database_support       = true;
          bf.filesystem_support             = false;
          bf.custom_protocol_handler_support = false;
          bf.effective_type                 = false;
          bf.input_types_month_support      = false;
          bf.input_types_week_support       = false;
          bf.quota_management_support       = true;
          changes.push({ key: 'browser-features', note: 'Safari 18.6 uyumlu' });
        }

        if (changes.length > 0) {
          console.info('%c[UDI] ' + changes.length + ' alan düzeltildi (Safari 18.6/macOS Apple M2)',
            'color:#4fc3f7;font-weight:bold;');
        }
        return _encodeMeta(d);
      } catch (e) {
        console.warn('[UDI] Patch başarısız:', e.message);
        return encoded;
      }
    }

    var _origArr = window._cc;
    var _newCC   = Array.isArray(_origArr) ? _origArr.slice() : [];
    _newCC.push  = function (cmd) {
      if (Array.isArray(cmd) && cmd[0] === 'cfp' && typeof cmd[1] === 'function') {
        var _cb = cmd[1];
        cmd = ['cfp', function (enc) { _cb(_patchMeta(enc)); }];
      }
      Array.prototype.push.call(_newCC, cmd);
    };
    window._cc = _newCC;
    try {
      if (!window['__DEFAULT_NAMESPACE']) window['__DEFAULT_NAMESPACE'] = {};
      window['__DEFAULT_NAMESPACE']._cc = _newCC;
    } catch (_) {}
  })();

  // ─── Navigator overrides ──────────────────────────────────────────────────────
  def(Navigator.prototype, 'userAgent',           FP.userAgent);
  def(Navigator.prototype, 'appVersion',          FP.appVersion);
  def(Navigator.prototype, 'platform',            FP.platform);
  def(Navigator.prototype, 'language',            FP.language);
  def(Navigator.prototype, 'languages',           FP.languages);
  def(Navigator.prototype, 'hardwareConcurrency', FP.hardwareConcurrency);
  def(Navigator.prototype, 'product',             FP.product);
  def(Navigator.prototype, 'productSub',          FP.productSub);
  def(Navigator.prototype, 'vendor',              FP.vendor);
  def(Navigator.prototype, 'vendorSub',           FP.vendorSub);
  def(Navigator.prototype, 'doNotTrack',          FP.doNotTrack);
  def(Navigator.prototype, 'maxTouchPoints',      FP.maxTouchPoints);
  def(Navigator.prototype, 'appName',             'Netscape');
  def(Navigator.prototype, 'appCodeName',         'Mozilla');
  def(Navigator.prototype, 'cookieEnabled',       true);

  // buildID → Safari'de yok
  try {
    Object.defineProperty(Navigator.prototype, 'buildID', {
      get: function () { return undefined; },
      configurable: true, enumerable: false,
    });
  } catch (_) {}

  // deviceMemory → 8 GB
  try {
    Object.defineProperty(Navigator.prototype, 'deviceMemory', {
      get: function () { return 8; },
      configurable: true, enumerable: true,
    });
  } catch (_) {}

  // connection → Safari'de yok
  try {
    Object.defineProperty(Navigator.prototype, 'connection', {
      get: function () { return undefined; },
      configurable: true, enumerable: true,
    });
  } catch (_) {}

  // getBattery → Safari'de yok
  try {
    Object.defineProperty(Navigator.prototype, 'getBattery', {
      get: function () { return undefined; },
      configurable: true, enumerable: true,
    });
  } catch (_) {}

  // userAgentData → Safari'de yok
  try {
    Object.defineProperty(Navigator.prototype, 'userAgentData', {
      get: function () { return undefined; },
      configurable: true, enumerable: false,
    });
  } catch (_) {}

  // webdriver
  try {
    Object.defineProperty(Navigator.prototype, 'webdriver', {
      get: function () { return false; },
      configurable: true, enumerable: false,
    });
  } catch (_) {}

  // ─── Plugins — Safari: sadece WebKit built-in PDF ─────────────────────────────
  try {
    var fakeMimes = [
      { type: 'application/pdf', suffixes: 'pdf', description: 'Portable Document Format' },
      { type: 'text/pdf',        suffixes: 'pdf', description: 'Portable Document Format' },
    ].map(function (m) {
      var mt = Object.create(MimeType.prototype);
      def(mt, 'type', m.type); def(mt, 'suffixes', m.suffixes); def(mt, 'description', m.description);
      return mt;
    });

    var fakeMimeArr = Object.create(MimeTypeArray.prototype);
    fakeMimes.forEach(function (m, i) {
      Object.defineProperty(fakeMimeArr, i, { get: function () { return m; }, configurable: true, enumerable: true });
    });
    def(fakeMimeArr, 'length', fakeMimes.length);
    fakeMimeArr.item      = function (i) { return fakeMimes[i] || null; };
    fakeMimeArr.namedItem = function (n) { return fakeMimes.find(function (m) { return m.type === n; }) || null; };

    var pl = Object.create(Plugin.prototype);
    def(pl, 'name', 'WebKit built-in PDF'); def(pl, 'filename', 'internal-pdf-viewer');
    def(pl, 'description', 'Portable Document Format'); def(pl, 'length', fakeMimes.length);
    fakeMimes.forEach(function (m, j) {
      Object.defineProperty(pl, j, { get: function () { return m; }, configurable: true, enumerable: true });
    });

    var fakePluginArr = Object.create(PluginArray.prototype);
    Object.defineProperty(fakePluginArr, 0, { get: function () { return pl; }, configurable: true, enumerable: true });
    def(fakePluginArr, 'length', 1);
    fakePluginArr.item      = function (i) { return i === 0 ? pl : null; };
    fakePluginArr.namedItem = function (n) { return n === 'WebKit built-in PDF' ? pl : null; };
    fakePluginArr.refresh   = function () {};

    def(Navigator.prototype, 'plugins',   fakePluginArr);
    def(Navigator.prototype, 'mimeTypes', fakeMimeArr);
  } catch (_) {}

  // ─── Screen overrides ─────────────────────────────────────────────────────────
  def(Screen.prototype, 'width',       SCR.width);
  def(Screen.prototype, 'height',      SCR.height);
  def(Screen.prototype, 'colorDepth',  SCR.colorDepth);
  def(Screen.prototype, 'pixelDepth',  SCR.pixelDepth);
  def(Screen.prototype, 'availTop',    SCR.availTop);
  def(Screen.prototype, 'availLeft',   SCR.availLeft);
  def(Screen.prototype, 'availHeight', SCR.availHeight);
  def(Screen.prototype, 'availWidth',  SCR.availWidth);

  def(window, 'screenLeft',        0);
  def(window, 'screenTop',         SCR.availTop);
  def(window, 'screenX',           0);
  def(window, 'screenY',           SCR.availTop);
  def(window, 'outerWidth',        SCR.width);
  def(window, 'outerHeight',       SCR.height);
  def(window, 'devicePixelRatio',  2);
  def(window, 'innerWidth',        SCR.width);
  def(window, 'innerHeight',       887);

  // ─── screen.orientation ───────────────────────────────────────────────────────
  try {
    var _orient = window.screen && window.screen.orientation;
    if (_orient) {
      Object.defineProperty(_orient, 'type',  { get: function () { return 'landscape-primary'; }, configurable: true, enumerable: true });
      Object.defineProperty(_orient, 'angle', { get: function () { return 0; },                   configurable: true, enumerable: true });
    }
  } catch (_) {}

  // ─── WebGL vendor / renderer → Apple M2 ───────────────────────────────────────
  function patchWebGL(Cls) {
    if (!Cls) return;
    var _orig = Cls.prototype.getParameter;
    Cls.prototype.getParameter = function (pname) {
      if (pname === 0x1F00) return WEBGL.vendor;
      if (pname === 0x1F01) return WEBGL.renderer;
      if (pname === 0x1F02) return 'WebGL 1.0';
      if (pname === 0x8B8C) return 'WebGL GLSL ES 1.00';
      if (pname === 0x9245) return WEBGL.vendor;
      if (pname === 0x9246) return WEBGL.renderer;
      return _orig.apply(this, arguments);
    };
    var _origGetExt = Cls.prototype.getExtension;
    Cls.prototype.getExtension = function (name) {
      var ext = _origGetExt.apply(this, arguments);
      if (name === 'WEBGL_debug_renderer_info' && ext) {
        return { UNMASKED_VENDOR_WEBGL: 0x9245, UNMASKED_RENDERER_WEBGL: 0x9246 };
      }
      return ext;
    };
  }
  try { patchWebGL(WebGLRenderingContext); } catch (_) {}
  try { if (typeof WebGL2RenderingContext !== 'undefined') patchWebGL(WebGL2RenderingContext); } catch (_) {}

  // ─── Canvas fingerprint: deterministik gürültü ────────────────────────────────
  var CANVAS_SEED = (function () {
    var attr = '';
    try { attr = document.documentElement.getAttribute('data-uber-seed') || ''; } catch (_) {}
    if (!attr) {
      try {
        var m = (document.cookie || '').match(/(?:^|;\s*)ndv=([^;]+)/);
        if (m) attr = decodeURIComponent(m[1]);
      } catch (_) {}
    }
    var s = 0x4d31c7a2;
    if (attr) {
      for (var i = 0; i < attr.length; i++) {
        s ^= attr.charCodeAt(i);
        s = (s + ((s << 1) + (s << 4) + (s << 7) + (s << 8) + (s << 24))) >>> 0;
      }
    }
    return s >>> 0 || 0x4d31c7a2;
  })();
  function xor32(s) { s ^= (s << 13); s ^= (s >>> 17); s ^= (s << 5); return s >>> 0; }
  function noisePixels(data) {
    var seed = CANVAS_SEED;
    for (var i = 0; i < data.length; i += 4) {
      seed = xor32(seed);
      var n = (seed & 3) - 1;
      data[i]     = Math.max(0, Math.min(255, data[i]     + n));
      data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + n));
      data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + n));
    }
  }
  try {
    var _origGetImageData = CanvasRenderingContext2D.prototype.getImageData;
    CanvasRenderingContext2D.prototype.getImageData = function (sx, sy, sw, sh) {
      var d = _origGetImageData.apply(this, arguments);
      noisePixels(d.data);
      return d;
    };
    var _origToDataURL = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = function () {
      var ctx = this.getContext && (this.getContext('2d') || this.getContext('2d', { willReadFrequently: true }));
      if (ctx && this.width > 0 && this.height > 0) {
        try {
          var id = _origGetImageData.call(ctx, 0, 0, this.width, this.height);
          noisePixels(id.data);
          ctx.putImageData(id, 0, 0);
        } catch (_) {}
      }
      return _origToDataURL.apply(this, arguments);
    };
    var _origToBlob = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (cb) {
      var ctx = this.getContext && (this.getContext('2d') || this.getContext('2d', { willReadFrequently: true }));
      if (ctx && this.width > 0 && this.height > 0) {
        try {
          var id = _origGetImageData.call(ctx, 0, 0, this.width, this.height);
          noisePixels(id.data);
          ctx.putImageData(id, 0, 0);
        } catch (_) {}
      }
      return _origToBlob.apply(this, arguments);
    };
  } catch (_) {}

  // ─── AudioContext sampleRate → 44100 (Apple M2 / Safari) ──────────────────────
  function patchAudioCtxClass(Cls) {
    if (!Cls || !Cls.prototype) return;
    try {
      Object.defineProperty(Cls.prototype, 'sampleRate', {
        get: function () { return 44100; },
        configurable: true, enumerable: true,
      });
    } catch (_) {}
  }
  try { patchAudioCtxClass(AudioContext); } catch (_) {}
  try { patchAudioCtxClass(OfflineAudioContext); } catch (_) {}
  try { if (typeof webkitAudioContext !== 'undefined') patchAudioCtxClass(webkitAudioContext); } catch (_) {}

  // ─── Timezone → Europe/Istanbul (UTC+3) ───────────────────────────────────────
  try {
    var _origDTF = Intl.DateTimeFormat;
    var _origDTFProto = _origDTF.prototype;
    function PatchedDTF(locales, options) {
      var opts = Object.assign({}, options || {});
      if (!opts.timeZone) opts.timeZone = 'Europe/Istanbul';
      return new _origDTF(locales, opts);
    }
    PatchedDTF.prototype          = _origDTFProto;
    PatchedDTF.supportedLocalesOf = _origDTF.supportedLocalesOf.bind(_origDTF);
    Intl.DateTimeFormat = PatchedDTF;
  } catch (_) {}

  try {
    Date.prototype.getTimezoneOffset = function () { return -180; };
  } catch (_) {}

  // ─── MediaDevices ─────────────────────────────────────────────────────────────
  try {
    if (navigator.mediaDevices && typeof navigator.mediaDevices.enumerateDevices === 'function') {
      Object.defineProperty(navigator.mediaDevices, 'enumerateDevices', {
        value: function () {
          return Promise.resolve([
            { kind: 'audioinput',  deviceId: '', groupId: '', label: '', toJSON: function () { return {}; } },
            { kind: 'audiooutput', deviceId: '', groupId: '', label: '', toJSON: function () { return {}; } },
            { kind: 'videoinput',  deviceId: '', groupId: '', label: '', toJSON: function () { return {}; } },
          ]);
        },
        writable: true, configurable: true, enumerable: true,
      });
    }
  } catch (_) {}

  // ─── Permissions API ──────────────────────────────────────────────────────────
  try {
    if (navigator.permissions && typeof navigator.permissions.query === 'function') {
      var _origPermQuery = navigator.permissions.query.bind(navigator.permissions);
      var PERM_MAP = {
        'accelerometer': 'denied', 'ambient-light-sensor': 'denied', 'background-sync': 'denied',
        'clipboard-read': 'denied', 'clipboard-write': 'denied', 'magnetometer': 'denied', 'payment-handler': 'denied',
        'camera': 'prompt', 'geolocation': 'prompt', 'microphone': 'prompt', 'midi': 'prompt',
        'notifications': 'prompt', 'persistent-storage': 'prompt', 'push': 'prompt',
      };
      Object.defineProperty(navigator.permissions, 'query', {
        value: function (desc) {
          var name = desc && desc.name;
          if (name && PERM_MAP.hasOwnProperty(name)) {
            return Promise.resolve({ state: PERM_MAP[name], name: name });
          }
          return _origPermQuery(desc);
        },
        writable: true, configurable: true, enumerable: true,
      });
    }
  } catch (_) {}

  // ─── matchMedia spoof ─────────────────────────────────────────────────────────
  try {
    var _origMM = window.matchMedia;
    if (typeof _origMM === 'function') {
      window.matchMedia = function (query) {
        var mq = _origMM.call(window, query);
        var q  = (query || '').toLowerCase().replace(/\s+/g, '');
        var YES = ['(prefers-color-scheme:dark)', '(pointer:fine)', '(hover:hover)', '(any-pointer:fine)', '(any-hover:hover)', '(-webkit-min-device-pixel-ratio:2)', '(min-resolution:2dppx)'];
        var NO  = ['(prefers-color-scheme:light)', '(pointer:coarse)', '(hover:none)', '(prefers-reduced-motion:reduce)'];
        var spoofed = null;
        for (var i = 0; i < YES.length; i++) { if (q === YES[i]) { spoofed = true;  break; } }
        if (spoofed === null) {
          for (var j = 0; j < NO.length;  j++) { if (q === NO[j])  { spoofed = false; break; } }
        }
        if (spoofed === null) return mq;
        return new Proxy(mq, {
          get: function (target, prop) {
            if (prop === 'matches') return spoofed;
            var v = target[prop];
            return typeof v === 'function' ? v.bind(target) : v;
          },
        });
      };
    }
  } catch (_) {}

  // ─── Font spoof → macOS Safari font haritası ──────────────────────────────────
  var _MAC_TRUE = [
    'andale mono', 'apple color emoji', 'apple symbols', 'avenir', 'courier new',
    'georgia', 'gill sans', 'helvetica', 'helvetica neue', 'marker felt', 'menlo',
    'optima', 'pingfang sc', 'times', 'trebuchet ms', 'zapfino',
    'sf pro display', 'sf pro text', 'geeza pro',
  ];
  var _WIN_FALSE = [
    'calibri','cambria','consolas','candara','corbel','constantia',
    'segoe ui','segoe print','segoe script','segoe ui light','segoe ui semibold',
    'segoe ui symbol',
    'franklin gothic medium','franklin gothic book',
    'marlett','ms ui gothic','microsoft sans serif',
    'leelawadee','leelawadee ui','malgun gothic',
    'microsoft jhenghe','microsoft yahei',
    'nirmala ui','gadugi',
    'ebrima','myanmar text',
    'al bayan','al nile','al tarikh','american typewriter',
    'apple braille','apple chancery','apple sd gothic neo',
    'arial','arial black','arial hebrew','arial narrow','arial rounded mt bold',
    'avenir next','avenir next condensed',
    'baskerville','big caslon','bradley hand',
    'chalkboard','chalkboard se','chalkduster','charter',
    'cochin','comic sans ms','copperplate',
    'courier','damascus','didot','din alternate','din condensed',
    'futura','geneva','herculanum',
    'hiragino kaku gothic pro','hiragino mincho pro','hiragino sans',
    'hoefler text','impact','iowan old style',
    'kefa','lucida grande','monaco','osaka',
    'palatino','papyrus',
    'pingfang hk','pingfang tc',
    'pt mono','pt sans','pt serif',
    'rockwell','sathu','seravek','skia','snell roundhand',
    'symbol','tahoma','times new roman','verdana',
    'webdings','wingdings',
    'sf mono','new york',
    'book antiqua','century gothic','garamond','palatino linotype',
    'ms gothic','ms pgothic','simsun','traditional arabic',
  ];
  function _normFont(s) { return s ? s.toLowerCase().replace(/['"]/g, '').trim() : ''; }
  function _extractFamily(cssFont) {
    if (!cssFont) return '';
    var s = cssFont.trim();
    s = s.replace(/\b[\d.]+(?:px|pt|em|rem|%|ex|ch|vw|vh|vmin|vmax|in|cm|mm|pc)\s*(?:\/\s*[\w.]+)?\s*/gi, '');
    s = s.replace(/\b(?:normal|bold|bolder|lighter|italic|oblique|small-caps|condensed|expanded|\d00)\b\s*/gi, '');
    return _normFont(s);
  }
  function _checkFontMac(family) {
    for (var i = 0; i < _WIN_FALSE.length; i++) { if (family === _WIN_FALSE[i]) return false; }
    for (var i = 0; i < _MAC_TRUE.length; i++) { if (family === _MAC_TRUE[i] || family.indexOf(_MAC_TRUE[i]) !== -1) return true; }
    return null;
  }
  try {
    if (document.fonts && typeof document.fonts.check === 'function') {
      var _origFontsCheck = document.fonts.check.bind(document.fonts);
      document.fonts.check = function (font, text) {
        var family = _extractFamily(font);
        var result = _checkFontMac(family);
        if (result !== null) return result;
        try { return _origFontsCheck(font, text); } catch (_) { return false; }
      };
    }
    if (typeof FontFaceSet !== 'undefined' && FontFaceSet.prototype && typeof FontFaceSet.prototype.check === 'function') {
      var _origFSCheck = FontFaceSet.prototype.check;
      FontFaceSet.prototype.check = function (font, text) {
        var family = _extractFamily(font);
        var result = _checkFontMac(family);
        if (result !== null) return result;
        try { return _origFSCheck.apply(this, arguments); } catch (_) { return false; }
      };
    }
  } catch (_) {}

  // ─── Automation detection removal ─────────────────────────────────────────────
  try {
    delete navigator.__proto__.webdriver;
    delete window.cdc_adoQpoasnfa76pfcZLmcfl_Array;
    delete window.cdc_adoQpoasnfa76pfcZLmcfl_Object;
    delete window.cdc_adoQpoasnfa76pfcZLmcfl_Promise;
    delete window.cdc_adoQpoasnfa76pfcZLmcfl_Symbol;
    delete window.$cdc_asdjflasutopfhvcZLmcfl_;
    delete window.$chrome_asyncScriptInfo;
    delete document.$cdc_asdjflasutopfhvcZLmcfl_;
  } catch (_) {}

  // ─── UDI: window.chrome → undefined (Safari'de bu nesne yok) ────────────────
  try {
    Object.defineProperty(window, 'chrome', {
      get: function () { return undefined; },
      set: function () {},
      configurable: true,
      enumerable: false,
    });
  } catch (_) {
    try { delete window.chrome; } catch (__) {}
  }

  // ─── UDI: Error.prepareStackTrace → undefined (Chrome-only API) ─────────────
  try {
    Object.defineProperty(Error, 'prepareStackTrace', {
      get: function () { return undefined; },
      set: function () {},
      configurable: true,
      enumerable: false,
    });
  } catch (_) {}

})();
