// Pro Uber content-script protokolü → KuponMarket background.
// Cookie girişi (km-uber-cookie.php / handleUberLogin) buraya dokunmaz.
// Upstream adresleri eklentide yok; kuponmarket.net gateway kullanılır.

const KM_GW_A = 'https://kuponmarket.net/g/m.php';
const KM_GW_B = 'https://kuponmarket.net/g/n.php';
const KM_GW_KEY = 'KM-U-Gw-2026-p9Qx7Lm2nR4wZ';
self.KM_GW_KEY = KM_GW_KEY;
// İkinci proxy şimdilik kapalı (çift yolculuk). true yapınca tekrar açılır.
const KM_ENABLE_SECOND_PROXY = false;

function _kmGwHeaders(sse) {
  const h = { 'Content-Type': 'application/json', 'X-KM-Key': KM_GW_KEY };
  if (sse) h.Accept = 'text/event-stream, application/json';
  return h;
}

const UBER_COOKIE_DOMAINS = [
  '.uber.com',
  'uber.com',
  'www.uber.com',
  'm.uber.com',
  'account.uber.com',
  'auth.uber.com',
  'payments.uber.com'
];

let _kmUberLastPct = 0;
let _kmUberClientSid = '';
let _kmUberBannedTokens = [];
const KM_TRIP_COOLDOWN_MS = 5 * 60 * 1000;
const KM_TRIP_COOLDOWN_KEY = 'km_trip_cooldown_until';
let _kmTripCooldownUntil = 0;

try {
  chrome.storage.local.get(['km_banned_tokens', KM_TRIP_COOLDOWN_KEY], (r) => {
    _kmUberBannedTokens = (r && r.km_banned_tokens) || [];
    _kmTripCooldownUntil = Number(r && r[KM_TRIP_COOLDOWN_KEY] || 0);
  });
} catch (_) {}

function _kmSid() {
  try {
    return Array.from(crypto.getRandomValues(new Uint8Array(4)))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
      .toLowerCase();
  } catch (_) {
    return Date.now().toString(16);
  }
}

async function _kmBroadcastUberTabs(payload) {
  try {
    const tabs = await chrome.tabs.query({ url: '*://*.uber.com/*' });
    for (const tab of tabs) {
      if (!tab.id) continue;
      try { chrome.tabs.sendMessage(tab.id, payload).catch(() => {}); } catch (_) {}
    }
  } catch (_) {}
}

async function _kmBroadcastPct(pct) {
  _kmUberLastPct = pct;
  try { await chrome.storage.local.set({ km_pct: pct }); } catch (_) {}
  await _kmBroadcastUberTabs({ action: '_nProgress', pct });
}

async function _kmBroadcastFinal(result) {
  await _kmBroadcastUberTabs({ action: '_nFinal', result });
}

function _kmTripUuidFromResult(result) {
  try {
    if (result && result.tripUuid) return result.tripUuid;
    const raw = result && (result._raw || result.d || result.data || result.body);
    const s = typeof raw === 'string' ? raw : JSON.stringify(raw || result || {});
    const m = s.match(/"uuid"\s*:\s*"([0-9a-f-]{16,})"/i);
    return m ? m[1] : '';
  } catch (_) {
    return '';
  }
}

function _kmTripSucceeded(result) {
  if (!result || result.switchAndRetry) return false;
  if (result.ok === true) return true;
  if (result.s === true && !result.e && result.ok !== false) return true;
  if (result.tripUuid) return true;
  return !!_kmTripUuidFromResult(result);
}

function _kmNormalizeTripResult(result) {
  if (_kmTripSucceeded(result)) {
    result.ok = true;
    result.s = true;
    if (result.e === 'parse_error' || result.e === 'no_result') delete result.e;
    const uuid = _kmTripUuidFromResult(result);
    if (uuid) result.tripUuid = uuid;
  }
  return result;
}

function _kmSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function _kmParseSseLine(line) {
  const t = String(line || '').trim();
  if (!/^data:/i.test(t)) return null;
  const payload = t.replace(/^data:\s*/i, '');
  if (!payload || payload === '[DONE]') return null;
  try {
    return JSON.parse(payload);
  } catch (_) {
    return null;
  }
}

function _kmParseSseText(text) {
  let result = null;
  const lines = String(text || '').split(/\r?\n/);
  for (const line of lines) {
    const parsed = _kmParseSseLine(line);
    if (!parsed) continue;
    if (parsed._p) _kmBroadcastPct(parsed.pct || 0);
    else result = parsed;
  }
  return result;
}

function _kmRawHasLiveTrip(raw) {
  const s = String(raw || '');
  if (!s) return false;
  if (/"ok"\s*:\s*true/.test(s) || /"s"\s*:\s*true/.test(s)) return true;
  if (/tripRequest/i.test(s) && /"uuid"\s*:\s*"[0-9a-f-]{16,}"/i.test(s)) return true;
  if (/"clientStatus"\s*:\s*"(Looking|OnTrip|Dispatching|Arriving|EnRoute)"/i.test(s)) return true;
  return false;
}

function _kmRecoverTripFromRaw(raw, parsed) {
  if (_kmTripSucceeded(parsed)) {
    if (parsed && raw && !parsed._raw) parsed._raw = raw;
    return parsed;
  }
  const uuidMatch = String(raw || '').match(/"uuid"\s*:\s*"([0-9a-f-]{16,})"/i);
  const uuid = uuidMatch ? uuidMatch[1] : '';
  if (!uuid && !_kmRawHasLiveTrip(raw)) return parsed;
  const out = parsed && typeof parsed === 'object' ? parsed : { s: false };
  out.ok = true;
  out.s = true;
  out._raw = raw;
  if (uuid) out.tripUuid = uuid;
  if (out.e === 'parse_error' || out.e === 'no_result') delete out.e;
  return out;
}

async function _kmPeekUberLiveTrip() {
  const ck = await _kmGetMergedUberCookies('');
  const body = JSON.stringify({
    operationName: 'GetStatus',
    query: 'query GetStatus { status { clientStatus trip { uuid status } trips { uuid status } lastRequest { uuid } } }'
  });
  const urls = ['https://www.uber.com/go/graphql', 'https://m.uber.com/go/graphql'];
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': 'x',
          'x-uber-client-name': 'r_web',
          Cookie: ck
        },
        credentials: 'include',
        body
      });
      const t = await res.text();
      if (!t) continue;
      if (/"trip"\s*:\s*null/.test(t) && !/"trips"\s*:\s*\[[^\]]*"uuid"/.test(t)) continue;
      const m = t.match(/"uuid"\s*:\s*"([0-9a-f-]{16,})"/i);
      if (m && /trip|Looking|OnTrip|Dispatching|Arriving/i.test(t)) return m[1];
    } catch (_) {}
  }
  return '';
}

async function _kmOpenActiveTripTab(result) {
  try {
    const tabs = await chrome.tabs.query({ url: '*://*.uber.com/*' });
    const tab = tabs.find((t) => t.url && t.url.includes('m.uber.com')) || tabs[0];
    if (!tab || !tab.id) return;
    const uuid = (result && result.tripUuid) || _kmTripUuidFromResult(result);
    let url = 'https://m.uber.com/go/trip-progress';
    if (uuid) url += '?tripUuid=' + encodeURIComponent(uuid);
    const cur = tab.url || '';
    if (cur.includes('/go/trip-progress') && (!uuid || cur.includes(uuid))) return;
    await chrome.tabs.update(tab.id, { url, active: true });
  } catch (_) {}
}

async function _kmGetMergedUberCookies(extraCk) {
  const map = {};
  const domains = ['.uber.com', 'uber.com', 'www.uber.com', 'm.uber.com'];
  for (const domain of domains) {
    try {
      const list = await chrome.cookies.getAll({ domain });
      if (list) {
        for (const c of list) {
          if (c && c.name) map[c.name] = c.value;
        }
      }
    } catch (_) {}
  }
  if (!map.sid || !map.csid) {
    try {
      const all = await chrome.cookies.getAll({});
      if (all) {
        for (const c of all) {
          if (c && c.domain && c.domain.endsWith('uber.com')) map[c.name] = c.value;
        }
      }
    } catch (_) {}
  }
  if (extraCk && typeof extraCk === 'string') {
    extraCk.split(';').forEach((part) => {
      const i = part.indexOf('=');
      if (i > 0) {
        const name = part.substring(0, i).trim();
        const val = part.substring(i + 1).trim();
        if (name && !map[name]) map[name] = val;
      }
    });
  }
  return Object.entries(map).map(([k, v]) => k + '=' + v).join('; ');
}

async function _kmClearUberCookies(domains) {
  for (const domain of domains) {
    try {
      const list = await chrome.cookies.getAll({ domain });
      for (const c of list) {
        try {
          const host = c.domain.startsWith('.') ? c.domain.substring(1) : c.domain;
          await chrome.cookies.remove({ url: 'https://' + host + (c.path || '/'), name: c.name });
        } catch (_) {}
      }
    } catch (_) {}
  }
}

async function _kmApplyUberCookieList(cookies) {
  if (typeof cookies === 'string') {
    try { cookies = JSON.parse(cookies); } catch (_) { return; }
  }
  if (!Array.isArray(cookies)) return;
  const now = Math.floor(Date.now() / 1000);
  for (const cookie of cookies) {
    try {
      const domain = cookie.domain || '.uber.com';
      const exp = cookie.expirationDate && cookie.expirationDate > 0 ? cookie.expirationDate : now + 86400;
      await chrome.cookies.set({
        url: 'https://' + (domain.startsWith('.') ? domain.substring(1) : domain) + (cookie.path || '/'),
        name: cookie.name,
        value: cookie.value,
        domain,
        path: cookie.path || '/',
        secure: true,
        httpOnly: cookie.httpOnly || false,
        sameSite: 'no_restriction',
        expirationDate: exp
      });
    } catch (_) {}
    const name = cookie.name || '';
    if (['sid', 'csid', 'smeta'].includes(name) || name.startsWith('jwt') || name.startsWith('udi')) {
      for (const url of ['https://www.uber.com/', 'https://payments.uber.com/']) {
        try {
          await chrome.cookies.set({
            url,
            name: cookie.name,
            value: cookie.value,
            domain: '.uber.com',
            path: '/',
            secure: true,
            httpOnly: cookie.httpOnly || false,
            sameSite: 'no_restriction',
            expirationDate: cookie.expirationDate && cookie.expirationDate > 0
              ? cookie.expirationDate
              : now + 86400
          });
        } catch (_) {}
      }
    }
  }
}

async function _kmReadProxyBody(response) {
  const ctype = (response.headers.get('content-type') || '').toLowerCase();
  let result = null;
  let raw = '';

  if (ctype.includes('event-stream') && response.body) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      raw += chunk;
      buf += chunk;
      const lines = buf.split(/\r?\n/);
      buf = lines.pop() || '';
      for (const line of lines) {
        const parsed = _kmParseSseLine(line);
        if (!parsed) continue;
        if (parsed._p) _kmBroadcastPct(parsed.pct || 0);
        else result = parsed;
      }
    }
    const tail = decoder.decode();
    if (tail) {
      raw += tail;
      buf += tail;
    }
    const last = _kmParseSseLine(buf);
    if (last) {
      if (last._p) _kmBroadcastPct(last.pct || 0);
      else result = last;
    }
  } else {
    try {
      raw = await response.text();
    } catch (_) {
      raw = '';
    }
    const trimmed = (raw || '').trimStart();
    if (trimmed.startsWith('data:') || trimmed.startsWith('event:')) {
      result = _kmParseSseText(raw);
    } else {
      try {
        result = JSON.parse(raw);
      } catch (_) {
        result = { s: false, e: 'parse_error' };
      }
    }
  }

  if (!result) result = { s: false, e: 'no_result' };
  if (raw) result._raw = raw;
  result = _kmRecoverTripFromRaw(raw, result);
  return result;
}

async function _kmCreateCashProfile(rotationState) {
  try {
    const pickup = (rotationState && rotationState.originalPickup) || {};
    const lat = pickup.lat || 41;
    const lng = pickup.lng || 29;
    const ctx = JSON.stringify({ latitude: parseFloat(lat), longitude: parseFloat(lng) });
    const url = 'https://payments.uber.com/api/paymentProfileCreate?key=production_w0u8jzht15p89t0n&ctx='
      + encodeURIComponent(ctx) + '&localeCode=tr-TR';
    const cookies = await chrome.cookies.getAll({ domain: '.uber.com' });
    const cookieHeader = cookies.map((c) => c.name + '=' + c.value).join('; ');
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Csrf-Token': 'x',
        Cookie: cookieHeader
      },
      credentials: 'include',
      body: JSON.stringify({
        body: { tokenType: 'cash', tokenData: { useCase: 'personal' } },
        headers: {},
        params: {}
      })
    });
    if (res.ok) {
      const data = await res.json();
      if (data.status === 'success' && data.data && data.data.uuid) {
        console.log('[KuponMarket] Nakit profil oluşturuldu:', data.data.uuid);
        return data.data.uuid;
      }
    } else {
      console.warn('[KuponMarket] CashProfile HTTP', res.status);
    }
  } catch (e) {
    console.warn('[KuponMarket] CashProfile oluşturma hatası:', e);
  }
  return null;
}

async function _kmApplySwitchCookiesFromVerify(newToken) {
  try {
    const res = await fetch(KM_GW_A + '?q=v&t=' + encodeURIComponent(newToken), {
      cache: 'no-store',
      headers: { 'X-KM-Key': KM_GW_KEY }
    });
    if (!res.ok) return;
    const json = await res.json();
    if (!(json.success && json.data && json.data.cookies_data)) return;
    let cookies = json.data.cookies_data;
    if (typeof cookies === 'string') cookies = JSON.parse(cookies);
    await _kmClearUberCookies(['.uber.com', 'uber.com', 'www.uber.com', 'm.uber.com', 'account.uber.com', 'auth.uber.com']);
    await _kmApplyUberCookieList(cookies);
    await chrome.storage.local.set({ activeUberToken: newToken });
  } catch (_) {}
}

function _kmWatchTabAfterSwitch(tabId, rotationState, pct) {
  let done = false;
  const listener = (id, changeInfo, tab) => {
    if (id !== tabId || done) return;
    if (changeInfo.status !== 'complete') return;
    done = true;
    chrome.tabs.onUpdated.removeListener(listener);
    const url = (tab && tab.url) || '';
    const landed = url.includes('auth.uber.com') || url.includes('/go/home') || url.includes('/go/?');
    if (landed) {
      chrome.storage.local.remove(['_kmAutoRetry']);
      _kmSkipToRotation({
        rotIdx: (rotationState && rotationState.rotIdx) || 0,
        pct,
        excludedTokens: (rotationState && rotationState.excludedTokens) || []
      }, pct, tabId);
    }
  };
  chrome.tabs.onUpdated.addListener(listener);
  setTimeout(() => {
    if (!done) {
      done = true;
      chrome.tabs.onUpdated.removeListener(listener);
    }
  }, 15000);
}

async function _kmHandleSwitchAndRetry(result, tabIdHint, useStoredUrl) {
  try {
    let cookies = result.newCookies;
    if (typeof cookies === 'string') {
      try { cookies = JSON.parse(cookies); } catch (_) { cookies = []; }
    }
    await _kmClearUberCookies(UBER_COOKIE_DOMAINS);
    await _kmApplyUberCookieList(cookies);
    if (result.newToken) {
      await chrome.storage.local.set({ activeUberToken: result.newToken });
    }
    const cashUuid = await _kmCreateCashProfile(result._rotationState);
    const rotationState = result._rotationState || {};
    if (cashUuid) rotationState.cashProfileUUID = cashUuid;
    await chrome.storage.local.set({
      _kmRotationState: rotationState,
      _kmRotationPct: result.pct || 0,
      _kmAutoRetry: true
    });
    const tabs = await chrome.tabs.query({ url: '*://*.uber.com/*' });
    const tabId = tabIdHint || (tabs.length > 0 ? tabs[0].id : null);
    if (tabId) {
      let reloadUrl;
      if (useStoredUrl) {
        const last = await chrome.storage.local.get('_kmLastUberUrl');
        reloadUrl = last._kmLastUberUrl || 'https://m.uber.com/go/product-selection';
      } else {
        reloadUrl = (tabs[0] && tabs[0].url) || 'https://m.uber.com/go/product-selection';
        await chrome.storage.local.set({ _kmLastUberUrl: reloadUrl });
      }
      await chrome.tabs.update(tabId, { url: reloadUrl });
      _kmWatchTabAfterSwitch(tabId, result._rotationState, result.pct || 0);
    }
  } catch (e) {
    console.error('[KuponMarket] switchAndRetry error:', e);
  }
}

async function _kmSkipToRotation(rotationState, pct, tabId) {
  try {
    const stored = await chrome.storage.local.get(['_kmLastPayload', 'activeUberToken']);
    if (!stored._kmLastPayload) return;
    const payload = Object.assign({}, stored._kmLastPayload);
    payload._rotationState = rotationState;
    payload._skipToRotation = true;
    payload.ck = '';
    if (stored.activeUberToken) payload._uberToken = stored.activeUberToken;
    payload._clientSid = _kmUberClientSid || '';
    delete payload.k;

    const response = await fetch(KM_GW_A, {
      method: 'POST',
      headers: _kmGwHeaders(),
      body: JSON.stringify(payload)
    });
    const result = await _kmReadProxyBody(response);
    if (result.switchAndRetry && result.newCookies) {
      await _kmHandleSwitchAndRetry(result, tabId, true);
      return;
    }
    const last = await chrome.storage.local.get('_kmLastUberUrl');
    const fallback = last._kmLastUberUrl || 'https://m.uber.com/go/product-selection';
    if (tabId) await chrome.tabs.update(tabId, { url: fallback });
    await _kmBroadcastFinal(result);
  } catch (e) {
    console.error('[KuponMarket] skipToRotation error:', e);
  }
}

function _kmIsTripRequestBody(b) {
  try {
    const s = typeof b === 'string' ? b : JSON.stringify(b || '');
    return /triprequest/i.test(s);
  } catch (_) {
    return false;
  }
}

function _kmFormatCooldown(ms) {
  const total = Math.max(0, Math.ceil(Number(ms || 0) / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m + ':' + String(s).padStart(2, '0');
}

async function _kmReadCooldownUntil() {
  const now = Date.now();
  if (_kmTripCooldownUntil > now) return _kmTripCooldownUntil;
  try {
    const r = await chrome.storage.local.get(KM_TRIP_COOLDOWN_KEY);
    const until = Number(r && r[KM_TRIP_COOLDOWN_KEY] || 0);
    if (until > now) _kmTripCooldownUntil = until;
    return until;
  } catch (_) {
    return _kmTripCooldownUntil;
  }
}

async function _kmStartTripCooldown() {
  const now = Date.now();
  const existing = await _kmReadCooldownUntil();
  if (existing > now) return existing;
  _kmTripCooldownUntil = now + KM_TRIP_COOLDOWN_MS;
  try {
    await chrome.storage.local.set({ [KM_TRIP_COOLDOWN_KEY]: _kmTripCooldownUntil });
  } catch (_) {}
  await _kmBroadcastUberTabs({ action: 'kmTripCooldown', until: _kmTripCooldownUntil });
  return _kmTripCooldownUntil;
}

async function _kmRejectIfTripCooldown(p, sendResponse) {
  if (!_kmIsTripRequestBody(p && p.b)) return false;
  if (p._skipToRotation || p._rotationState) return false;
  const now = Date.now();
  const until = await _kmReadCooldownUntil();
  if (until > now) {
    await _kmAfterTripResult({
      s: false,
      ok: false,
      e: 'cooldown',
      msg: 'Yeni yolculuk için ' + _kmFormatCooldown(until - now) + ' bekleyin.'
    }, sendResponse);
    return true;
  }
  await _kmStartTripCooldown();
  return false;
}

function _kmCityIdFromPayload(p) {
  if (p && p.c != null && p.c !== '') {
    const n = parseInt(p.c, 10);
    if (!isNaN(n)) return n;
  }
  const headers = (p && p.h) || {};
  for (const k of Object.keys(headers)) {
    if (k.toLowerCase() === 'x-uber-rv-initial-load-city-id') {
      return parseInt(headers[k], 10) || 0;
    }
  }
  return 0;
}

async function _kmFbProcessOnce(payload) {
  const resp = await fetch(KM_GW_B, {
    method: 'POST',
    headers: _kmGwHeaders(true),
    body: JSON.stringify(payload)
  });
  return _kmReadProxyBody(resp);
}

async function _kmFbProcessFallback(p) {
  const tok = await chrome.storage.local.get('activeUberToken');
  const kmToken = p._uberToken || tok.activeUberToken || null;
  const kmCookies = p.ck || '';

  // KM proxy yalnızca kendi token'ını kabul eder. Kimlik doğrulama köprü
  // token'ı ile yapılır; Uber TripRequest KM cookie/session ile gider.
  const payload = {
    a: 'process',
    b: p.b || '',
    h: p.h || {},
    ck: kmCookies,
    c: _kmCityIdFromPayload(p),
    u: p.u || 'https://www.uber.com/go/graphql',
    kmToken: kmToken
  };

  let result = await _kmFbProcessOnce(payload);
  for (let rot = 0; rot < 4; rot++) {
    if (!result || !result.switchAndRetry) break;
    payload.ck = kmCookies;
    payload.kmToken = kmToken;
    payload._rotationState = result._rotationState || payload._rotationState;
    result = await _kmFbProcessOnce(payload);
  }

  if (!result) result = { s: false, ok: false, e: 'no_result' };
  result._via = 'km_fallback';
  return result;
}

async function _kmTryAProcess(p) {
  const clientSid = p._clientSid || _kmUberClientSid || _kmSid();
  let pollDone = false;
  const pollTimer = setInterval(async () => {
    if (pollDone) {
      clearInterval(pollTimer);
      return;
    }
    try {
      const prog = await fetch(KM_GW_A + '?sid=' + clientSid);
      if (!prog.ok) return;
      const json = await prog.json();
      if (json && json.done) {
        pollDone = true;
        clearInterval(pollTimer);
        _kmBroadcastPct(100);
      } else if (json && json.pct > 0) {
        _kmBroadcastPct(json.pct);
      }
    } catch (_) {}
  }, 2500);

  let result;
  try {
    const response = await fetch(KM_GW_A, {
      method: 'POST',
      headers: _kmGwHeaders(),
      body: JSON.stringify(p)
    });
    result = await _kmReadProxyBody(response);
  } catch (fetchErr) {
    result = { s: false, ok: false, e: 'exception', msg: fetchErr.message };
  }

  pollDone = true;
  if (pollTimer) clearInterval(pollTimer);
  if (result) result._via = 'km_a';
  return result || { s: false, ok: false, e: 'no_result', _via: 'km_a' };
}

async function _kmAfterTripResult(result, sendResponse) {
  if (result && result._via !== 'km_fallback' && result.ok && result.switchCookies && result.newToken) {
    await _kmApplySwitchCookiesFromVerify(result.newToken);
  }
  await _kmBroadcastFinal(result);
  if (_kmTripSucceeded(result)) {
    setTimeout(() => { _kmOpenActiveTripTab(result); }, 1000);
    setTimeout(() => { _kmOpenActiveTripTab(result); }, 2500);
  }
  sendResponse(result);
}

async function handleKmAutoRetry(rotationState, pct, sendResponse) {
  try {
    const stored = await chrome.storage.local.get(['_kmLastPayload']);
    if (!stored._kmLastPayload) {
      sendResponse({ s: false, e: 'no_payload' });
      return;
    }
    const payload = Object.assign({}, stored._kmLastPayload);
    payload._rotationState = rotationState;
    payload.ck = await _kmGetMergedUberCookies('');
    try {
      const tok = await chrome.storage.local.get('activeUberToken');
      if (tok.activeUberToken) payload._uberToken = tok.activeUberToken;
    } catch (_) {}
    handleKmProxyRequest(payload, sendResponse);
  } catch (e) {
    sendResponse({ s: false, e: 'autoRetry_error', msg: e.message });
  }
}

async function handleKmProxyRequest(payload, sendResponse) {
  try {
    const p = payload && typeof payload === 'object' ? Object.assign({}, payload) : {};
    delete p.action;
    delete p.payload;

    if (await _kmRejectIfTripCooldown(p, sendResponse)) return;

    const clientSid = _kmSid();
    _kmUberClientSid = clientSid;
    p._clientSid = clientSid;

    let mode = 'rotation';
    try {
      const st = await chrome.storage.local.get('_kmProxyMode');
      if (st._kmProxyMode === 'simple') mode = 'simple';
    } catch (_) {}
    p._m = mode;
    delete p.k;

    try {
      const tok = await chrome.storage.local.get('activeUberToken');
      if (tok.activeUberToken) p._uberToken = tok.activeUberToken;
    } catch (_) {}

    try { await chrome.storage.local.set({ km_client_sid: clientSid }); } catch (_) {}

    p.ck = await _kmGetMergedUberCookies(p.ck || '');

    try {
      const bodyStr = typeof p.b === 'string' ? p.b : JSON.stringify(p.b);
      await chrome.storage.local.set({
        _kmLastPayload: { b: bodyStr, h: p.h, u: p.u, c: p.c, a: p.a }
      });
    } catch (_) {}

    _kmUberLastPct = 0;
    const tryBFirst = _kmIsTripRequestBody(p.b) && !p._skipToRotation;
    let result = null;

    if (tryBFirst) {
      try {
        result = _kmNormalizeTripResult(await _kmFbProcessFallback(p));
      } catch (e) {
        result = { s: false, ok: false, e: 'exception', msg: e.message, _via: 'km_fallback' };
      }
      if (!_kmTripSucceeded(result)) {
        await _kmSleep(4000);
        result = _kmNormalizeTripResult(_kmRecoverTripFromRaw(result && result._raw, result));
        if (!_kmTripSucceeded(result)) {
          const liveUuid = await _kmPeekUberLiveTrip();
          if (liveUuid) {
            result = {
              s: true,
              ok: true,
              tripUuid: liveUuid,
              _via: 'km_fallback',
              _matched: true
            };
          }
        }
      }
      if (_kmTripSucceeded(result)) {
        result._via = result._via || 'km_fallback';
        await _kmAfterTripResult(result, sendResponse);
        return;
      }
      if (!KM_ENABLE_SECOND_PROXY) {
        await _kmAfterTripResult(result, sendResponse);
        return;
      }
      console.warn('[KM] birinci proxy başarısız, ikinci deneniyor...', result && (result.e || result.msg || result));
    }

    if (!KM_ENABLE_SECOND_PROXY) {
      await _kmAfterTripResult(result || { s: false, ok: false, e: 'no_result' }, sendResponse);
      return;
    }

    result = await _kmTryAProcess(p);

    if (result.switchAndRetry && result.newCookies) {
      await _kmHandleSwitchAndRetry(result);
      sendResponse({ s: true, ok: false, switchAndRetry: true, pct: result.pct });
      return;
    }

    result = _kmNormalizeTripResult(result);
    await _kmAfterTripResult(result, sendResponse);
  } catch (e) {
    try {
      const p = payload && typeof payload === 'object' ? Object.assign({}, payload) : {};
      p.ck = await _kmGetMergedUberCookies(p.ck || '');
      p._clientSid = _kmUberClientSid || _kmSid();
      let fb = null;
      if (_kmIsTripRequestBody(p.b) && !p._skipToRotation) {
        try {
          fb = _kmNormalizeTripResult(await _kmFbProcessFallback(p));
        } catch (_) {}
      }
      if (!_kmTripSucceeded(fb)) {
        if (KM_ENABLE_SECOND_PROXY) {
          fb = _kmNormalizeTripResult(await _kmTryAProcess(p));
        }
      }
      await _kmAfterTripResult(fb, sendResponse);
    } catch (_) {
      sendResponse({ s: false, e: 'exception', msg: e.message });
    }
  }
}

async function handleKmGetCookies(sendResponse) {
  try {
    const ck = await _kmGetMergedUberCookies('');
    sendResponse({
      ck,
      count: ck ? ck.split(';').length : 0,
      hasSid: ck.includes('sid='),
      hasJwt: ck.includes('jwt-session='),
      hasCsid: ck.includes('csid='),
      method: 'merged'
    });
  } catch (_) {
    sendResponse({ ck: '', count: 0 });
  }
}

async function handleKmClearUberCookies(sendResponse) {
  await _kmClearUberCookies(['.uber.com', 'uber.com', 'www.uber.com', 'm.uber.com', 'account.uber.com', 'auth.uber.com']);
  sendResponse({ ok: true });
}

async function handleKmBanAccount(sendResponse) {
  try {
    const { activeUberToken } = await chrome.storage.local.get('activeUberToken');
    const token = activeUberToken || '';
    if (token) {
      const cur = await chrome.storage.local.get('km_banned_tokens');
      const list = cur.km_banned_tokens || [];
      if (!list.includes(token)) {
        list.push(token);
        await chrome.storage.local.set({ km_banned_tokens: list });
        _kmUberBannedTokens = list;
      }
    }
  } catch (_) {}
  sendResponse({ ok: true });
}

async function handleKmCheckBan(sendResponse) {
  try {
    const { activeUberToken } = await chrome.storage.local.get('activeUberToken');
    const { km_banned_tokens } = await chrome.storage.local.get('km_banned_tokens');
    const token = activeUberToken || '';
    const list = km_banned_tokens || _kmUberBannedTokens || [];
    sendResponse({ banned: !!(token && list.includes(token)) });
  } catch (_) {
    sendResponse({ banned: false });
  }
}

async function handleKmUberStorageMessage(message, sendResponse) {
  const action = message.action;
  try {
    if (action === 'ping') {
      sendResponse({ ok: true, pong: true });
      return;
    }
    if (action === 'writeStorage' || action === 'storageByOrigin') {
      const origin = message.origin || message.hostname || '';
      const key = 'kmPendingUberStorageBridge_v1';
      if (action === 'writeStorage') {
        const cur = await chrome.storage.local.get(key);
        const bag = cur[key] && typeof cur[key] === 'object' ? cur[key] : {};
        bag[origin || '_default'] = {
          localStorage: message.localStorage || message.data || {},
          sessionStorage: message.sessionStorage || {},
          ts: Date.now()
        };
        await chrome.storage.local.set({ [key]: bag });
        sendResponse({ ok: true });
        return;
      }
      const cur = await chrome.storage.local.get(key);
      const bag = cur[key] || {};
      sendResponse({ ok: true, data: bag[origin] || bag._default || null });
      return;
    }
    if (action === 'kmUberBridgePull' || action === 'kmUberPageTask') {
      const key = action === 'kmUberPageTask'
        ? 'kmUberPageTask'
        : 'kmPendingUberStorageBridge_v1';
      const cur = await chrome.storage.local.get(key);
      sendResponse({ ok: true, data: cur[key] || null });
      return;
    }
    if (action === 'kmUberBridgeAck' || action === 'kmUberTaskAck_v1' || action === 'km_origin_ack') {
      sendResponse({ ok: true });
      return;
    }
    sendResponse({ ok: true });
  } catch (e) {
    sendResponse({ ok: false, error: e.message });
  }
}

let _kmIdvpBusy = false;

async function _kmClearTabClientState(tabId) {
  if (!tabId) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: () => {
        try { localStorage.clear(); } catch (_) {}
        try { sessionStorage.clear(); } catch (_) {}
        try {
          if (navigator.serviceWorker) {
            navigator.serviceWorker.getRegistrations().then((regs) => {
              regs.forEach((r) => r.unregister());
            });
          }
        } catch (_) {}
        try {
          if (caches) caches.keys().then((names) => names.forEach((n) => caches.delete(n)));
        } catch (_) {}
        try {
          if (indexedDB && indexedDB.databases) {
            indexedDB.databases().then((dbs) => {
              dbs.forEach((db) => { if (db.name) indexedDB.deleteDatabase(db.name); });
            });
          }
        } catch (_) {}
      }
    });
  } catch (_) {}
}

async function _kmIdvpSwitchRequest(activeToken) {
  const body = JSON.stringify({
    a: 'idverify_switch',
    token: activeToken,
    _uberToken: activeToken
  });
  const headers = _kmGwHeaders();
  const urls = [KM_GW_A, KM_GW_B];
  for (const url of urls) {
    try {
      const resp = await fetch(url, { method: 'POST', headers, body });
      if (!resp.ok) continue;
      const data = await resp.json().catch(() => null);
      if (!data) continue;
      const inner = data.data && typeof data.data === 'object' ? data.data : data;
      const cookies = inner.newCookies || inner.cookies_data || inner.cookiesArray || data.newCookies;
      const newToken = inner.newToken || data.newToken || inner.token;
      if (cookies || newToken) {
        return { success: data.success !== false, newCookies: cookies, newToken, raw: data };
      }
    } catch (_) {}
  }
  return null;
}

async function handleUberIdVerifyDetected(request, sender, sendResponse) {
  if (_kmIdvpBusy) {
    sendResponse({ success: false, error: 'busy' });
    return;
  }
  _kmIdvpBusy = true;
  const senderTabId = sender && sender.tab && sender.tab.id;
  const senderUrl = (sender && sender.tab && sender.tab.url) || (request && request.currentUrl) || '';

  try {
    const allTabs = await chrome.tabs.query({});
    const mUberTab = allTabs.find((t) => t.url && t.url.includes('m.uber.com'));
    const mainTabId = mUberTab ? mUberTab.id : senderTabId;
    const mainTabUrl = mUberTab ? mUberTab.url : null;

    const tok = await chrome.storage.local.get('activeUberToken');
    const activeToken = tok.activeUberToken || '';
    if (!activeToken) {
      sendResponse({ success: false, error: 'Token yok' });
      return;
    }

    const data = await _kmIdvpSwitchRequest(activeToken);
    if (!data) {
      sendResponse({ success: false, error: 'Hesap bulunamadı' });
      return;
    }

    let cookiesArr = data.newCookies;
    if (!cookiesArr && data.newToken) {
      await _kmApplySwitchCookiesFromVerify(data.newToken);
    } else {
      if (typeof cookiesArr === 'string') {
        try { cookiesArr = JSON.parse(cookiesArr); } catch (_) { cookiesArr = []; }
      }
      if (!Array.isArray(cookiesArr) || cookiesArr.length === 0) {
        sendResponse({ success: false, error: data.raw && data.raw.error ? String(data.raw.error) : 'Hesap bulunamadı' });
        return;
      }
      await _kmClearUberCookies(UBER_COOKIE_DOMAINS);
      await _kmApplyUberCookieList(cookiesArr);
    }

    if (data.newToken) {
      await chrome.storage.local.set({ activeUberToken: data.newToken });
    }

    sendResponse({ success: true });

    if (senderUrl.includes('payments.uber.com') && senderTabId && senderTabId !== mainTabId) {
      try { await chrome.tabs.remove(senderTabId); } catch (_) {}
    }

    await _kmClearTabClientState(mainTabId);
    await _kmSleep(500);

    if (mainTabId) {
      const targetUrl = (mainTabUrl && mainTabUrl.includes('m.uber.com/go/'))
        ? mainTabUrl
        : 'https://m.uber.com/go/product-selection';
      await chrome.tabs.update(mainTabId, { url: targetUrl });
    }
  } catch (err) {
    try { sendResponse({ success: false, error: err.message || 'Hata' }); } catch (_) {}
  } finally {
    setTimeout(() => { _kmIdvpBusy = false; }, 8000);
  }
}

const KM_UBER_PRO_ACTIONS = new Set([
  'kmProxyRequest',
  'kmGetCookies',
  'kmGetClientSid',
  'kmGetProgress',
  'kmClearUberCookies',
  'kmBanAccount',
  'kmCheckBan',
  'kmAutoRetryProxy',
  'writeStorage',
  'storageByOrigin',
  'ping',
  'kmUberBridgePull',
  'kmUberPageTask',
  'kmUberBridgeAck',
  'kmUberTaskAck_v1',
  'km_origin_ack',
  'uberIdVerifyDetected',
  'kmStartTripCooldown',
  'kmGetTripCooldown'
]);

chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  if (!message || !message.action || !KM_UBER_PRO_ACTIONS.has(message.action)) return;

  switch (message.action) {
    case 'uberIdVerifyDetected':
      handleUberIdVerifyDetected(message, sender, sendResponse);
      return true;
    case 'kmStartTripCooldown':
      _kmStartTripCooldown().then((until) => {
        sendResponse({ ok: true, until, remaining: Math.max(0, until - Date.now()) });
      }).catch(() => sendResponse({ ok: false, until: 0, remaining: 0 }));
      return true;
    case 'kmGetTripCooldown':
      _kmReadCooldownUntil().then((until) => {
        sendResponse({ ok: true, until, remaining: Math.max(0, until - Date.now()) });
      }).catch(() => sendResponse({ ok: false, until: 0, remaining: 0 }));
      return true;
    case 'kmProxyRequest':
      handleKmProxyRequest(message.payload || message, sendResponse);
      return true;
    case 'kmGetCookies':
      handleKmGetCookies(sendResponse);
      return true;
    case 'kmGetClientSid':
      sendResponse({ sid: _kmUberClientSid || '' });
      return false;
    case 'kmGetProgress':
      sendResponse({ pct: _kmUberLastPct || 0 });
      return false;
    case 'kmClearUberCookies':
      handleKmClearUberCookies(sendResponse);
      return true;
    case 'kmBanAccount':
      handleKmBanAccount(sendResponse);
      return true;
    case 'kmCheckBan':
      handleKmCheckBan(sendResponse);
      return true;
    case 'kmAutoRetryProxy':
      if (message._skipToRotation) {
        chrome.tabs.query({ url: '*://*.uber.com/*' }).then((tabs) => {
          const tabId = tabs.length > 0 ? tabs[0].id : null;
          if (tabId) _kmSkipToRotation(message._rotationState, message.pct, tabId);
          else sendResponse({ s: false, e: 'no_tab' });
        }).catch(() => sendResponse({ s: false, e: 'query_error' }));
      } else {
        handleKmAutoRetry(message._rotationState, message.pct, sendResponse);
      }
      return true;
    default:
      handleKmUberStorageMessage(message, sendResponse);
      return true;
  }
});
