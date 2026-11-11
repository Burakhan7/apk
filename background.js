importScripts('./api-compatibility.js');
importScripts('./crypto-js.min.js');
importScripts('./generate-rsig.js');
importScripts('./uber-pro-adapter.js');
importScripts('./src/tyks/trendyol-proxy.js');
importScripts('./src/tyks/tgo-address-apply.js');
importScripts('./src/migros/migros-engine.js');

// ====================================
// UBER: User-Agent yÃ¶netimi â€” Safari 18.6 / macOS profili
// ====================================
let uberUserAgent = '';
let activeUberToken = null;

const UBER_UA_FALLBACK = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15';

const UBER_DNR_RULE_ID = 9120;
const UBER_DNR_URL_REGEX = '(?i)^https?://([a-z0-9.-]+\\.)*(uber\\.com|cdn-net\\.com|cdn-path\\.com)(:\\d+)?(/|$|\\?|#)';


const UBER_DNR_REMOVE_HEADERS = [
  'sec-ch-ua',
  'sec-ch-ua-mobile',
  'sec-ch-ua-platform',
  'sec-ch-ua-platform-version',
  'sec-ch-ua-full-version-list',
  'sec-ch-ua-full-version',
  'sec-ch-ua-arch',
  'sec-ch-ua-bitness',
  'sec-ch-ua-model',
  'sec-ch-ua-wow64',
  'sec-ch-ua-ua',
  'sec-ch-ua-form-factor',
  'sec-ch-ua-viewport-width',
  'sec-ch-ua-dpr',
  'sec-ch-ua-resolution',
];

async function setupUberHeaderRules() {
  let ua = uberUserAgent || UBER_UA_FALLBACK;

  try {
    await RequestHeaderManager.updateDynamicRules({
      removeRuleIds: [9100, 9101, UBER_DNR_RULE_ID, 9121, 9122]
    });

    const setHeaders = [
      { header: 'User-Agent',      operation: 'set', value: ua },
      { header: 'Accept-Encoding', operation: 'set', value: 'gzip, deflate, br' },
      { header: 'Accept-Language', operation: 'set', value: 'tr-TR,tr;q=0.9' },
    ];

    const removeHeaders = UBER_DNR_REMOVE_HEADERS.map(h => ({
      header: h, operation: 'remove'
    }));

    await RequestHeaderManager.updateDynamicRules({
      addRules: [
        {
          id: UBER_DNR_RULE_ID,
          priority: 1,
          action: {
            type: 'modifyHeaders',
            requestHeaders: [...setHeaders, ...removeHeaders]
          },
          condition: {
            regexFilter: UBER_DNR_URL_REGEX,
            resourceTypes: ['main_frame', 'sub_frame', 'stylesheet', 'script', 'image', 'font', 'object', 'xmlhttprequest', 'ping', 'csp_report', 'media', 'websocket', 'other']
          }
        }
      ]
    });

    console.log(`[Uber] Safari DNR kurallarÄ± kuruldu. UA: ${ua.substring(0, 60)}...`);
  } catch (e) {
    console.warn('[Uber] DNR header kurallarÄ± uygulanamadÄ±:', e);
  }
}

// ====================================
// UBER: Cookie yardÄ±mcÄ±larÄ±
// ====================================
function domainMatchesCookie(hostname, cookieDomain) {
  if (!hostname || !cookieDomain) return false;
  const normalized = cookieDomain.startsWith('.') ? cookieDomain.slice(1) : cookieDomain;
  return hostname === normalized || hostname.endsWith(`.${normalized}`);
}

async function buildCookieHeaderForUrl(rawUrl) {
  let target;
  try {
    target = new URL(rawUrl);
  } catch (_) {
    return '';
  }

  try {
    const allCookies = await chrome.cookies.getAll({});
    const pathName = target.pathname || '/';

    const matching = allCookies.filter(cookie => {
      if (!cookie || !cookie.name) return false;
      if (!domainMatchesCookie(target.hostname, cookie.domain || '')) return false;
      if (cookie.secure && target.protocol !== 'https:') return false;
      const cookiePath = cookie.path || '/';
      return pathName.startsWith(cookiePath);
    });

    matching.sort((a, b) => (b.path || '/').length - (a.path || '/').length);
    return matching.map(cookie => `${cookie.name}=${cookie.value}`).join('; ');
  } catch (e) {
    return '';
  }
}

function writeUberFpSeedCookie(seed, chromeFull) {
  if (!seed) return;
  const val = chromeFull ? `${seed}:${chromeFull}` : seed;
  for (const domain of ['.uber.com', '.m.uber.com', '.account.uber.com']) {
    chrome.cookies.set({
      url:            'https://www.uber.com',
      name:           '_ubfp',
      value:          encodeURIComponent(val),
      domain:         domain,
      path:           '/',
      secure:         true,
      httpOnly:       false,
      sameSite:       'no_restriction',
      expirationDate: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60
    }).catch(() => {});
  }
}

function writeUberDeviceProfileCookies(seed, region) {
  if (!seed) return;
  const expires = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
  const nrg = (region || 'TR').toString().slice(0, 2).toUpperCase();
  for (const domain of ['.uber.com', '.m.uber.com', '.account.uber.com']) {
    const base = {
      url: 'https://www.uber.com',
      domain,
      path: '/',
      secure: true,
      httpOnly: false,
      sameSite: 'no_restriction',
      expirationDate: expires
    };
    chrome.cookies.set(Object.assign({}, base, { name: 'ndv', value: encodeURIComponent(seed) })).catch(() => {});
    chrome.cookies.set(Object.assign({}, base, { name: 'nrg', value: nrg })).catch(() => {});
  }
}

// ====================================
// UBER: Proxy (login ayrı: km-uber-cookie.php)
// ====================================
async function handleUberProxyRequest(request, sendResponse) {
  try {
    const url = request.url || request.u;
    if (!url) throw new Error('URL eksik');

    const headers = Object.assign({}, request.headers || request.h || {});
    handleKmProxyRequest({
      u: url,
      a: request.method || request.a || 'POST',
      b: request.body != null ? request.body : request.b,
      h: headers,
      ck: headers.Cookie || headers.cookie || request.ck || '',
      c: request.c,
      _id: request.requestId || request._id
    }, function (result) {
      if (!result) {
        sendResponse({ success: false, error: 'empty', headers: {} });
        return;
      }
      const ok = !!(result.s || result.ok || result.switchAndRetry);
      sendResponse({
        success: ok,
        status: result.status || (ok ? 200 : 0),
        statusText: ok ? 'OK' : 'ERR',
        headers: result.headers || {},
        data: result.d || result.data || '',
        error: result.e || result.msg,
        switchAndRetry: !!result.switchAndRetry
      });
    });
    return true;
  } catch (e) {
    sendResponse({ success: false, error: e.message, headers: {} });
    return true;
  }
}

// ====================================
// UBER: TÃ¼rkÃ§e isim Ã¼retimi
// ====================================
const TURKISH_MALE_NAMES = [
  'Ahmet', 'Mehmet', 'Mustafa', 'Ali', 'Hasan', 'HÃ¼seyin', 'Ä°brahim', 'Osman',
  'Yusuf', 'Murat', 'Ã–mer', 'Fatih', 'Emre', 'Burak', 'Serkan', 'Kerem',
  'Cem', 'Kaan', 'Eren', 'BarÄ±ÅŸ', 'Tolga', 'Onur', 'Deniz', 'Enes',
  'Furkan', 'Umut', 'Berkay', 'UÄŸur', 'Volkan', 'GÃ¶khan', 'Tuncay', 'Selim',
  'OÄŸuz', 'Caner', 'Alper', 'Koray', 'Erdem', 'Serhat', 'Batuhan', 'Arda',
  'GÃ¶rkem', 'Ã‡aÄŸlar', 'Taylan', 'Hakan', 'Sinan', 'Berk', 'Doruk', 'YiÄŸit'
];

const TURKISH_FEMALE_NAMES = [
  'Fatma', 'AyÅŸe', 'Emine', 'Hatice', 'Zeynep', 'Elif', 'Merve', 'BÃ¼ÅŸra',
  'Esra', 'Ebru', 'Seda', 'Ã–zlem', 'Gamze', 'Derya', 'PÄ±nar', 'GÃ¼l',
  'Sevgi', 'TuÄŸba', 'Sibel', 'Yasemin', 'Gizem', 'Ä°rem', 'Cansu', 'Melis',
  'Ece', 'Dilara', 'AslÄ±', 'Zehra', 'Åeyma', 'Beyza', 'Buse', 'Nur',
  'Selin', 'Ceren', 'NazlÄ±', 'Deniz', 'Damla', 'Åule', 'Burcu', 'Nesrin',
  'GÃ¼lÅŸen', 'Meltem', 'NilgÃ¼n', 'Sevda', 'Havva', 'Sema', 'Hande', 'BengÃ¼'
];

const TURKISH_SURNAMES = [
  'YÄ±lmaz', 'Kaya', 'Demir', 'Ã‡elik', 'Åahin', 'YÄ±ldÄ±z', 'YÄ±ldÄ±rÄ±m', 'Ã–ztÃ¼rk',
  'AydÄ±n', 'Ã–zdemir', 'Arslan', 'DoÄŸan', 'KÄ±lÄ±Ã§', 'Aslan', 'Ã‡etin', 'Kara',
  'KoÃ§', 'Kurt', 'Ã–zkan', 'ÅimÅŸek', 'Polat', 'Korkmaz', 'Ã‡akÄ±r', 'ErdoÄŸan',
  'GÃ¼neÅŸ', 'Ak', 'Aksoy', 'Acar', 'AvcÄ±', 'AktaÅŸ', 'Tekin', 'Ã‡iÃ§ek',
  'Kaplan', 'Bozkurt', 'GÃ¼ler', 'IÅŸÄ±k', 'Duman', 'AteÅŸ', 'Bal', 'GÃ¼ndÃ¼z',
  'TaÅŸ', 'Bulut', 'Ãœnal', 'Yavuz', 'Bilgin', 'Erdem', 'Karaca', 'Eren'
];

function generateRandomTurkishName(gender = 'male') {
  const names = gender === 'female' ? TURKISH_FEMALE_NAMES : TURKISH_MALE_NAMES;
  const firstName = names[Math.floor(Math.random() * names.length)];
  const lastName = TURKISH_SURNAMES[Math.floor(Math.random() * TURKISH_SURNAMES.length)];
  return { firstName, lastName };
}

// ====================================
// UBER: Site verilerini temizleme
// ====================================
async function clearUberSiteData(domains) {
  const domainList = Array.isArray(domains) ? domains : [domains];
  try {
    const allCookies = await chrome.cookies.getAll({});
    const removePromises = [];
    for (const cookie of allCookies) {
      const dom = (cookie.domain || '').toLowerCase();
      for (const target of domainList) {
        if (dom.includes(target)) {
          const url = "http" + (cookie.secure ? "s" : "") + "://" +
            (cookie.domain.startsWith('.') ? cookie.domain.substring(1) : cookie.domain) +
            cookie.path;
          removePromises.push(chrome.cookies.remove({ url, name: cookie.name }).catch(() => {}));
          break;
        }
      }
    }
    await Promise.all(removePromises);

    try {
      await BrowsingDataManager.remove({
        origins: domainList.map(d => `https://${d}`)
      }, {
        cache: true, cacheStorage: true, cookies: true,
        indexedDB: true, localStorage: true, serviceWorkers: true
      });
    } catch (_) {}

    try {
      const existingTabs = await chrome.tabs.query({ url: '*://*.uber.com/*' });
      for (const tab of existingTabs) {
        if (tab.id) {
          chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => {
              try {
                localStorage.clear();
                sessionStorage.clear();
                if (indexedDB && indexedDB.databases) {
                  indexedDB.databases().then(dbs => {
                    dbs.forEach(db => { if (db.name) indexedDB.deleteDatabase(db.name); });
                  });
                }
                if (caches) {
                  caches.keys().then(names => {
                    names.forEach(name => caches.delete(name));
                  });
                }
              } catch (e) {}
            },
            world: 'MAIN'
          }).catch(() => {});
        }
      }
    } catch (e) {}
  } catch (e) {
    console.error('Uber site verileri temizleme hatasÄ±:', e);
  }
}

// ====================================
// UBER: Ä°sim gÃ¼ncelleme
// ====================================
async function updateUberUserName(firstName, lastName, rawCookies, tabId) {
  const requestId = crypto.randomUUID();
  const marketingId = rawCookies.find(c => c.name === "marketing_vistor_id")?.value || "";
  const referer = "https://account.uber.com/update-display-name";

  const ruleId = 9001;
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [ruleId],
    addRules: [{
      id: ruleId,
      priority: 100,
      action: {
        type: "modifyHeaders",
        requestHeaders: [
          { header: "origin",         operation: "set", value: "https://account.uber.com" },
          { header: "referer",        operation: "set", value: referer },
          { header: "sec-fetch-site", operation: "set", value: "same-origin" }
        ]
      },
      condition: {
        urlFilter: "account.uber.com/api/updateUserInfo",
        resourceTypes: ["xmlhttprequest"]
      }
    }]
  });

  try {
    const response = await fetch(
      "https://account.uber.com/api/updateUserInfo?localeCode=tr-TR",
      {
        method: "POST",
        credentials: "include",
        redirect: "manual",
        headers: {
          "content-type": "application/json",
          "accept": "*/*",
          "x-uber-country-iso2": "TR",
          "x-uber-client-name": "uam_desktop",
          "x-uber-request-uuid": requestId,
          "x-uber-device": "",
          "x-uber-device-model": "",
          "x-uber-device-os": "10",
          "x-uber-tenancy": "",
          "x-uber-decision-engine-is-shadow": "true",
          "x-uber-device-location-latitude": "",
          "x-uber-client-version": "",
          "x-uber-device-mobile-iso2": "",
          "x-uber-client-session": "",
          "x-uber-client-id": "",
          "x-uber-auth-sso-id": "",
          "x-uber-device-location-longitude": "",
          "x-uber-marketing-id": marketingId,
          "x-uber-app-device-id": "",
          "x-uber-app-variant": "",
          "x-uber-device-id": "",
          "x-csrf-token": "x",
          "x-uber-device-language": "",
          "x-uber-device-udid": "",
          "x-uber-identity-entrypoint": "uam"
        },
        body: JSON.stringify({
          userInfoUpdate: {
            userInfoUpdateType: "NAME",
            name: { firstname: firstName, lastname: lastName }
          }
        })
      }
    );

    if (response.ok || response.type === "opaqueredirect" || response.status === 0) {
      console.log(`[Uber] Ä°sim gÃ¼ncellendi: ${firstName} ${lastName}`);
      return;
    }

    const text = await response.text().catch(() => "");
    throw new Error(`Uber isim gÃ¼ncelleme baÅŸarÄ±sÄ±z (${response.status}): ${text.substring(0, 200)}`);
  } finally {
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [ruleId] });
  }
}

// ====================================
// UBER: Cookie'leri set etme
// ====================================
async function setUberCookies(cookies) {
  const nowInSeconds = Math.floor(Date.now() / 1000);
  const ONE_YEAR = 365 * 24 * 60 * 60;
  const THIRTY_DAYS = 30 * 24 * 60 * 60;

  const uberDomains = ['uber.com', 'cdn-net.com', 'cdn-path.com'];
  for (const cookie of cookies) {
    try {
      const dom = (cookie.domain || '').toLowerCase();
      const isUberCookie = uberDomains.some(d => dom.includes(d));
      if (!isUberCookie) continue;

      const domain = cookie.domain || '.uber.com';
      const domainForUrl = domain.startsWith('.') ? domain.substring(1) : domain;
      const cookieData = {
        url: `https://${domainForUrl}`,
        name: cookie.name,
        value: cookie.value,
        domain: domain,
        path: cookie.path || '/',
        secure: true,
        httpOnly: cookie.httpOnly || false,
        sameSite: 'no_restriction'
      };

      let expiresSeconds = cookie.expires || cookie.expirationDate;
      if (!expiresSeconds && cookie.expiresAtMs) {
        expiresSeconds = Math.floor(new Date(cookie.expiresAtMs).getTime() / 1000);
      }
      if (expiresSeconds && expiresSeconds > 0 && expiresSeconds !== -1) {
        cookieData.expirationDate = expiresSeconds < nowInSeconds
          ? nowInSeconds + ONE_YEAR
          : expiresSeconds;
      } else {
        cookieData.expirationDate = nowInSeconds + THIRTY_DAYS;
      }
      await chrome.cookies.set(cookieData);
    } catch (e) {}
  }
}

const UBER_HOME_AFTER_LOGIN = 'https://m.uber.com/go/home';

function sanitizeUberRedirectUrl(startLink) {
  const fallback = UBER_HOME_AFTER_LOGIN;
  if (!startLink || typeof startLink !== 'string') return fallback;
  const u = startLink.trim();
  if (!u.startsWith('http')) return fallback;
  const low = u.toLowerCase();
  if (low.includes('update-display-name') || low.includes('updateuserinfo')) return fallback;
  if (low.includes('account.uber.com') && (low.includes('update') || low.includes('display-name'))) {
    return fallback;
  }
  return u;
}

// ====================================
// UBER: Ana giriÅŸ iÅŸlemi
// ====================================
async function handleUberLogin(cookies, token, tabId, gender = null, startLink = '') {
  try {
    console.log('[Uber] Oturum hazÄ±rlanÄ±yor...');

    await chrome.storage.local.set({ activeUberToken: token });

    const newSeed = crypto.randomUUID();
    const proxySessId = (token || '').replace(/^uber-/i, '').replace(/[^a-zA-Z0-9]/g, '').substring(0, 32)
      || newSeed.replace(/-/g, '').substring(0, 32);
    await chrome.storage.local.set({ uberFpSeed: newSeed, uberProxySessId: proxySessId });

    uberUserAgent = UBER_UA_FALLBACK;
    await chrome.storage.local.set({ uberUserAgent: uberUserAgent });

    await setupUberHeaderRules();

    try {
      const allTabs = await chrome.tabs.query({});
      for (const tab of allTabs) {
        if (tab.url && (tab.url.includes('uber.com') || tab.url.includes('cdn-net.com')) && tab.id) {
          chrome.tabs.sendMessage(tab.id, {
            action: 'uberNewFpSeed',
            seed: newSeed
          }).catch(() => {});
        }
      }
    } catch (_) {}

    try {
      const allTabs = await chrome.tabs.query({});
      const otherUberTabs = allTabs.filter(tab =>
        tab.url && tab.url.toLowerCase().includes('uber') && tab.id !== tabId
      );
      await Promise.all(otherUberTabs.map(tab => chrome.tabs.remove(tab.id).catch(() => {})));
    } catch (e) {}

    console.log('[Uber] Site verileri temizleniyor...');
    await clearUberSiteData([
      "uber.com", "www.uber.com", "m.uber.com", "account.uber.com",
      "auth.uber.com", "login.uber.com", "payments.uber.com",
      "riders.uber.com", "api.uber.com", "csp.uber.com",
      "cdn-net.com", "cdn-cgi.uber.com", "d1a3f4spazzrp4.cloudfront.net"
    ]);

    try {
      const allCookies = await chrome.cookies.getAll({});
      await Promise.all(allCookies.filter(c => c.domain.toLowerCase().includes('inauth')).map(c => {
        const url = "http" + (c.secure ? "s" : "") + "://" + (c.domain.startsWith('.') ? c.domain.substring(1) : c.domain) + c.path;
        return chrome.cookies.remove({ url, name: c.name }).catch(() => {});
      }));
    } catch (_) {}

    writeUberFpSeedCookie(newSeed);
    writeUberDeviceProfileCookies(newSeed, 'TR');

    console.log('[Uber] Yeni oturum cookie\'leri set ediliyor...');
    await setUberCookies(cookies);
    await new Promise(resolve => setTimeout(resolve, 300));

    await chrome.storage.local.remove('_uberPendingNameUpdate').catch(() => {});

    const redirectUrl = sanitizeUberRedirectUrl(startLink);
    console.log('[Uber] Hesaba giriliyor (isim guncelleme yok):', redirectUrl);
    if (tabId) {
      try {
        await chrome.tabs.update(tabId, { url: redirectUrl });
      } catch (_) {
        await chrome.tabs.create({ url: redirectUrl });
      }
    } else {
      await chrome.tabs.create({ url: redirectUrl });
    }
  } catch (error) {
    console.error("[Uber] GiriÅŸ hatasÄ±:", error);
    await chrome.storage.local.remove('_uberPendingNameUpdate').catch(() => {});
    throw error;
  }
}

// ====================================
// UBER: Tab gÃ¼ncelleme dinleyicisi
// ====================================
async function _uberOnUpdatedHandler(updatedTabId, info, tab) {
  if (!tab.url) return;
  const lowUrl = tab.url.toLowerCase();
  if (!lowUrl.includes('update-display-name') && !(lowUrl.includes('account.uber.com') && lowUrl.includes('display-name'))) {
    return;
  }

  const data = await chrome.storage.local.get(['activeUberToken', '_uberPendingNameUpdate']).catch(() => ({}));
  if (!data.activeUberToken && !data._uberPendingNameUpdate) return;

  await chrome.storage.local.remove('_uberPendingNameUpdate').catch(() => {});

  const redirectUrl = sanitizeUberRedirectUrl(data._uberPendingNameUpdate?.startLink);
  console.log('[Uber] Isim sayfasi atlaniyor, yonlendiriliyor:', redirectUrl);
  chrome.tabs.update(updatedTabId, { url: redirectUrl }).catch(() => {
    chrome.tabs.create({ url: redirectUrl });
  });
}

// ====================================
// UBER: UA storage'dan yÃ¼kle ve DNR uygula
// ====================================
chrome.storage.local.get(['uberUserAgent', 'uberFpSeed', 'activeUberToken'], function (result) {
  activeUberToken = result.activeUberToken || null;
  const existingSeed = result.uberFpSeed || '';
  uberUserAgent = UBER_UA_FALLBACK;
  if (!existingSeed) {
    const seed = crypto.randomUUID();
    chrome.storage.local.set({ uberUserAgent: uberUserAgent, uberFpSeed: seed });
    writeUberFpSeedCookie(seed);
    writeUberDeviceProfileCookies(seed, 'TR');
  } else {
    chrome.storage.local.set({ uberUserAgent: uberUserAgent });
    writeUberFpSeedCookie(existingSeed);
    writeUberDeviceProfileCookies(existingSeed, 'TR');
  }
  try {
    RequestHeaderManager.updateDynamicRules({ removeRuleIds: [9100, 9101, 9102, 9110, 9120, 9122] }).catch(() => {});
  } catch (_) {}
  setupUberHeaderRules().catch(() => {});
});

// ====================================
// UBER: Tab onUpdated dinleyicisi
// ====================================
chrome.tabs.onUpdated.addListener(function (tabId, changeInfo, tab) {
  if (!tab.url) return;
  const low = tab.url.toLowerCase();
  const onNamePage = low.includes('update-display-name') ||
    (low.includes('account.uber.com') && low.includes('display-name'));
  if (onNamePage && (changeInfo.url || changeInfo.status === 'complete')) {
    _uberOnUpdatedHandler(tabId, changeInfo, tab).catch(() => {});
  }
});

const CURRENT_VERSION = chrome.runtime.getManifest().version;

function parseVersion(v) {
  return v.split('.').map(Number);
}

function isNewerVersion(remote, current) {
  const r = parseVersion(remote);
  const c = parseVersion(current);
  for (let i = 0; i < Math.max(r.length, c.length); i++) {
    const rv = r[i] || 0;
    const cv = c[i] || 0;
    if (rv > cv) return true;
    if (rv < cv) return false;
  }
  return false;
}

async function checkForUpdate() {
  try {
    const res = await fetch('https://kuponmarket.net/api/version', {
      method: 'GET',
      headers: {
        'X-Token': 'xeudL5BmAl7TRxs5tHPTPcJtTxtvc6e5eh5R0FEGbRIJSDEe',
        'X-Version': chrome.runtime.getManifest().version,
        'X-Requested': 'YSNew'
      }
    });
    if (!res.ok) return;
    const data = await res.json();
    if (data?.version && data?.extension_url && isNewerVersion(data.version, CURRENT_VERSION)) {
      chrome.runtime.sendMessage({
        action: 'updateAvailable',
        version: data.version,
        url: data.extension_url,
        description: data.description || data.changelog || '',
        changelog: data.changelog || data.description || '',
        force_update: data.force_update === true
      });
    }
  } catch (_) {}
}

// ğŸ›¡ï¸ ULTRA GÃœVENLÄ° VERSÄ°YON - SADECE YEMEKSEPETÄ° DOMAIN'LERÄ°

// Yemeksepeti domain kontrolÃ¼
function isYemeksepetiDomain(domain) {
  const cleanDomain = domain.toLowerCase().replace('www.', '');
  const allowedDomains = [
    'yemeksepeti.com',
    'fd-api.com',
    'tr.fd-api.com',
    'deliveryhero.com'
  ];
  
  return allowedDomains.some(allowed => 
    cleanDomain === allowed || 
    cleanDomain.endsWith('.' + allowed)
  );
}

// âš ï¸ KALDIRILDI: clearSiteDataLikeChromeSettings() fonksiyonu
// TÃ¼m domain'leri tek seferde temizleyen clearYemeksepetiLikeChromeSettings() kullanÄ±lÄ±yor
// (5x tekrar yerine 1x Ã§aÄŸrÄ± = %80 daha hÄ±zlÄ±)

async function closeOpenYemeksepetiTabs() {
  const hosts = ['yemeksepeti.com', 'fd-api.com', 'deliveryhero.com'];
  const tabs = await chrome.tabs.query({});
  const ids = [];
  for (const tab of tabs) {
    const url = tab.url || tab.pendingUrl || '';
    let host = '';
    try { host = new URL(url).hostname.toLowerCase(); } catch (e) { continue; }
    if (hosts.some(function (d) { return host === d || host.endsWith('.' + d); })) ids.push(tab.id);
  }
  if (!ids.length) return 0;
  await chrome.tabs.remove(ids);
  console.log('Açık Yemeksepeti sekmeleri kapatıldı:', ids.length);
  return ids.length;
}

function yemeksepetiCleanupOrigins(domains) {
  const set = new Set();
  for (const domain of domains) {
    const base = String(domain || '').trim().toLowerCase();
    if (!base) continue;
    set.add('https://' + base);
    set.add('http://' + base);
    if (!base.startsWith('www.')) {
      set.add('https://www.' + base);
      set.add('http://www.' + base);
    }
  }
  return Array.from(set);
}

// ULTRA GÃœVENLÄ° Chrome Settings Temizleme - SADECE YEMEKSEPETÄ°
async function clearYemeksepetiLikeChromeSettings() {
  console.log('ğŸ›¡ï¸ ULTRA GÃœVENLÄ° YEMEKSEPETÄ° TEMÄ°ZLEME BAÅLIYOR...');
  console.log('âœ… SADECE YEMEKSEPETÄ° DOMAIN\'LERÄ° TEMÄ°ZLENECEK');
  console.log('ğŸ›¡ï¸ DÄ°ÄER TÃœM SÄ°TELER KORUNACAK');
  console.log('âŒ GLOBAL FALLBACK: DEVRE DIÅI');
  
  const yemeksepetiDomains = [
    'www.yemeksepeti.com',
    'yemeksepeti.com', 
    'tr.fd-api.com',
    'fd-api.com',
    'deliveryhero.com'
  ];
  
  const totalStartTime = performance.now();
  const results = { cookie: false, browsing: false, cache: false };
  
  try {
    try {
      await closeOpenYemeksepetiTabs();
    } catch (error) {
      console.warn('Sekme kapatma hatası:', error);
    }

    try {
      await clearAllRules();
    } catch (error) {
      console.warn('Ağ kuralı temizleme hatası:', error);
    }

    // âš¡ OPTÄ°MÄ°ZASYON 1: TÃ¼m cookie'leri tek seferde temizle (5x tekrar yerine 1x)
    console.log('ğŸª TÃ¼m Yemeksepeti cookie\'leri temizleniyor (TEK SEFERÄE)...');
    const cookieStartTime = performance.now();
    try {
      const allCookies = await chrome.cookies.getAll({});
      const yemeksepetiCookies = allCookies.filter(cookie => {
        const cookieDomain = cookie.domain.toLowerCase();
        return isYemeksepetiDomain(cookieDomain.replace(/^\./, ''));
      });
      
      console.log(`ğŸª ${yemeksepetiCookies.length} adet yemeksepeti cookie'si bulundu (toplam ${allCookies.length})`);
      
      const removePromises = yemeksepetiCookies.map(async (cookie) => {
        const url = `${cookie.secure ? 'https' : 'http'}://${cookie.domain}${cookie.path}`;
        try {
          await chrome.cookies.remove({
            url: url,
            name: cookie.name,
            storeId: cookie.storeId
          });
        } catch (err) {
          console.warn(`âš ï¸ Cookie silme hatasÄ±: ${cookie.name}`, err);
        }
      });
      
      await Promise.all(removePromises);
      const cookieDuration = performance.now() - cookieStartTime;
      console.log(`âœ… Yemeksepeti cookie temizleme tamamlandÄ±: ${cookieDuration.toFixed(2)}ms`);
      results.cookie = true;
    } catch (error) {
      console.warn(`âš ï¸ Cookie temizleme hatasÄ±:`, error);
    }
    
    // âš¡ OPTÄ°MÄ°ZASYON 2: TÃ¼m domain'lerin browsing data'sÄ±nÄ± tek Ã§aÄŸrÄ±da temizle
    console.log('ğŸ—‘ï¸ TÃ¼m Yemeksepeti domain\'leri iÃ§in browsing data temizleniyor (TEK SEFERÄE)...');
    const browsingStartTime = performance.now();
    try {
      const origins = yemeksepetiCleanupOrigins(yemeksepetiDomains);
      const dataToRemove = {
        "cache": true,
        "cacheStorage": true,
        "cookies": true,
        "fileSystems": true,
        "indexedDB": true,
        "localStorage": true,
        "pluginData": true,
        "serviceWorkers": true,
        "webSQL": true
      };

      try {
        await chrome.browsingData.remove({ origins: origins, since: 0 }, dataToRemove);
      } catch (bulkError) {
        console.warn('Toplu site verisi silinemedi, tek tek deneniyor:', bulkError);
        let failed = 0;
        for (const origin of origins) {
          try {
            await chrome.browsingData.remove({ origins: [origin], since: 0 }, dataToRemove);
          } catch (oneError) {
            failed++;
            console.warn('Origin silinemedi:', origin, oneError);
          }
        }
        if (failed === origins.length) {
          if (chrome.browsingData.removeCache) {
            await chrome.browsingData.removeCache({ origins: origins, since: 0 }).catch(() => {});
          }
          if (chrome.browsingData.removeWebSQL) {
            await chrome.browsingData.removeWebSQL({ origins: origins, since: 0 }).catch(() => {});
          }
        }
      }
      
      const browsingDuration = performance.now() - browsingStartTime;
      console.log(`âœ… Browsing data temizleme tamamlandÄ±: ${browsingDuration.toFixed(2)}ms`);
      console.log(`   ğŸ“‹ Temizlenen domain'ler: ${yemeksepetiDomains.join(', ')}`);
      results.browsing = true;
    } catch (error) {
      console.warn(`âš ï¸ Browsing data temizleme hatasÄ±:`, error);
    }
    
    // âš¡ OPTÄ°MÄ°ZASYON 3: TÃ¼m cache'leri paralel temizle
    console.log('ğŸ—‘ï¸ TÃ¼m Yemeksepeti cache\'leri temizleniyor (PARALEL)...');
    const cacheStartTime = performance.now();
    try {
      const origins = yemeksepetiCleanupOrigins(yemeksepetiDomains);
      
      // Ana cache temizleme
      const cachePromises = origins.map(origin => 
        chrome.browsingData.removeCache({ origins: [origin], since: 0 })
          .catch(err => console.warn(`âš ï¸ Cache temizleme hatasÄ± (${origin}):`, err))
      );
      
      await Promise.allSettled(cachePromises);
      
      const cacheDuration = performance.now() - cacheStartTime;
      console.log(`âœ… Cache temizleme tamamlandÄ±: ${cacheDuration.toFixed(2)}ms`);
      results.cache = true;
    } catch (error) {
      console.warn(`âš ï¸ Cache temizleme hatasÄ±:`, error);
    }
    
  } catch (error) {
    console.error(`âŒ Genel temizleme hatasÄ±:`, error);
  }
  
  // Ã–zet raporu
  const totalDuration = performance.now() - totalStartTime;
  const successCount = Object.values(results).filter(Boolean).length;
  
  console.log(`â±ï¸ TOPLAM TEMÄ°ZLEME SÃœRESÄ°: ${totalDuration.toFixed(2)}ms`);
  console.log(`ğŸ“Š SONUÃ‡LAR: Cookie(${results.cookie ? 'âœ…' : 'âŒ'}) | Browsing(${results.browsing ? 'âœ…' : 'âŒ'}) | Cache(${results.cache ? 'âœ…' : 'âŒ'})`);
  console.log(`ğŸ›¡ï¸ ETKÄ°LENEN DOMAIN'LER: ${yemeksepetiDomains.join(', ')}`);
  console.log(`ğŸ›¡ï¸ KORUNAN: DiÄŸer tÃ¼m sitelerin verileri (%100 gÃ¼venli)`);
  console.log(`â° ZAMANLAMA: Yemeksepeti.com aÃ§Ä±lmadan Ã–NCE`);
  
  // En az 2 iÅŸlem baÅŸarÄ±lÄ± olursa temizleme baÅŸarÄ±lÄ±
  return successCount >= 2;
}

// Random string generator
function generateRandomString(length) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let result = '';
  
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  
  return result;
}

// Hex string generator
function generateHex(length) {
  const hexChars = '0123456789abcdef';
  let result = '';
  
  for (let i = 0; i < length; i++) {
    result += hexChars.charAt(Math.floor(Math.random() * hexChars.length));
  }
  
  return result;
}

// PX Cookie Ã¼retim fonksiyonlarÄ± (eski - basit)
function generatePxCookies() {
    const px3Part1 = generateHex(64);
    const base64Chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
    
    let px3Part2 = '';
    for (let i = 0; i < 88; i++) {
        px3Part2 += base64Chars.charAt(Math.floor(Math.random() * base64Chars.length));
    }
    
    let px3Part3 = '';
    for (let i = 0; i < 344; i++) {
        px3Part3 += base64Chars.charAt(Math.floor(Math.random() * base64Chars.length));
    }
    
    const _px3 = `${px3Part1}:${px3Part2}:1000:${px3Part3}`;
    const _pxhd = generateHex(48);
    const _pxvid = generateUUIDv4();
    const _pxcts = Date.now().toString();
    
    return `_px3=${_px3}; _pxhd=${_pxhd}; _pxvid=${_pxvid}; _pxcts=${_pxcts}`;
}

// kuponmarket ile birebir aynÄ± Ã¼retim fonksiyonlarÄ±
function generatePxOriginalToken() {
    const part1 = '3';
    const part2 = generateHex(64);
    const part3 = btoa(generateHex(32)).replace(/=/g, '');
    const part4 = '1000';
    const part5 = btoa(generateHex(128)).replace(/=/g, '');
    return `${part1}:${part2}:${part3}:${part4}:${part5}`;
}

function generatePxDeviceFp() {
    return 'fp:' + generateHex(32);
}

function generateDevicePerformanceClass() {
    const classes = ['low', 'medium', 'high'];
    const weights = [30, 50, 20];
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    let random = Math.random() * totalWeight;
    for (let i = 0; i < classes.length; i++) {
        random -= weights[i];
        if (random <= 0) return classes[i];
    }
    return 'medium';
}

function generateSentrySampleRand() {
    let rand = '0.';
    for (let i = 0; i < 16; i++) {
        rand += Math.floor(Math.random() * 10);
    }
    return rand;
}

function generateBaggageV2(traceId, appVersion, buildNumber) {
    const SENTRY_PUBLIC_KEY = '385c49e6b6c4484d8362abae622b3f0b';
    const sampleRand = generateSentrySampleRand();
    return `sentry-environment=production,sentry-public_key=${SENTRY_PUBLIC_KEY},sentry-release=com.inovel.app.yemeksepeti%40${appVersion}%2B${buildNumber},sentry-sample_rand=${sampleRand},sentry-sampled=false,sentry-trace_id=${traceId},sentry-transaction=refresh_token_interceptor`;
}

function generateSentryTraceV2() {
    const traceId = generateHex(32);
    const spanId = generateHex(16);
    return { traceId, sentryTrace: `${traceId}-${spanId}-0` };
}

async function generateRSig(deviceId) {
    try {
        const now = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        const currentTime = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}+0300`;
        const randomNum = Math.random().toFixed(16).substring(1);
        const dataToHash = deviceId + currentTime + randomNum;

        const encoder = new TextEncoder();
        const encodedData = encoder.encode(dataToHash);
        const hashBuffer = await crypto.subtle.digest('SHA-256', encodedData);
        const hashArray = new Uint8Array(hashBuffer);
        const signature = btoa(String.fromCharCode(...hashArray));

        return {
            success: true,
            signature: signature,
            rts: currentTime,
            ruid: randomNum,
            eks: deviceId.substring(0, 6)
        };
    } catch (error) {
        return {
            success: false,
            signature: btoa(generateHex(32)),
            rts: new Date().toISOString(),
            ruid: Math.random().toFixed(16).substring(1),
            eks: generateHex(6)
        };
    }
}

function parseCustCodeFromToken(token) {
    if (!token) return '';
    try {
        const parts = token.split('.');
        if (parts.length === 3) {
            const payload = JSON.parse(atob(parts[1]));
            return payload.user_id || '';
        }
    } catch (e) {}
    return '';
}

function generateBase64Random(length) {
    const base64Chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += base64Chars.charAt(Math.floor(Math.random() * base64Chars.length));
    }
    return result;
}

// Web cookie string oluÅŸturma - yemeksepeti_full.py generate_web_cookies ile birebir aynÄ±
function generateWebCookies(perseusClientId, perseusSessionId) {
    const timestamp = Date.now();
    
    if (!perseusClientId) {
        perseusClientId = `${timestamp}.${Math.floor(Math.random() * 9e14) + 1e14}.${generateRandomString(10)}`;
    }
    if (!perseusSessionId) {
        perseusSessionId = `${timestamp}.${Math.floor(Math.random() * 9e14) + 1e14}.${generateRandomString(10)}`;
    }
    
    const pxvid = generateUUIDv4();
    const pxcts = generateUUIDv4();
    const ssid = generateUUIDv4();
    
    const pxhdPart1 = generateBase64Random(54);
    const pxhdPart2 = generateBase64Random(80);
    
    const px3Salt = generateHex(64);
    const px3Hmac = generateBase64Random(88);
    const px3Ct = generateBase64Random(364);
    
    const cfBmVal = generateBase64Random(44).replace(/\+/g, '.').replace(/\//g, '_');
    const cfBmVal2 = generateBase64Random(54).replace(/\+/g, '.').replace(/\//g, '_');
    
    const gStateB = generateBase64Random(44);
    
    const ddId = `${generateHex(8)}-${generateHex(4)}-${generateHex(4)}-${generateHex(4)}-${generateHex(12)}`;
    
    const tqId = `${generateHex(16)}.${Math.floor(timestamp / 1000)}.0.${Math.floor(timestamp / 1000)}..`;
    
    const hitId = `${timestamp + Math.floor(Math.random() * 4900) + 100}.${Math.floor(Math.random() * 9e14) + 1e14}.${generateRandomString(10)}`;
    
    const cookies = [
        `dhhPerseusGuestId=${perseusClientId}`,
        `dhhPerseusSessionId=${perseusSessionId}`,
        `ld_key=${perseusClientId}`,
        `hl=tr`,
        `is-generic-address=true`,
        `_pxhd=${pxhdPart1}==${pxhdPart2}=`,
        `__cf_bm=${cfBmVal}-${Math.floor(timestamp / 1000)}-1.0.1.1-${cfBmVal2}`,
        `dps-session-id=41.076703_29.010804_${perseusClientId}_${Math.floor(timestamp / 1000)}_${Math.floor(timestamp / 1000) + 1800}`,
        `_pxvid=${pxvid}`,
        `pxcts=${pxcts}`,
        `g_state={"i_l":0,"i_ll":${timestamp},"i_b":"${gStateB}","i_e":{"enable_itp_optimization":1}}`,
        `_tq_id.TV-276372-1.c7a5=${tqId}`,
        `user-address-model=%7B%22longitude%22%3A29.01076%2C%22latitude%22%3A41.07683%2C%22countryCode%22%3A%22TR%22%7D`,
        `_px3=${px3Salt}:${px3Hmac}:1000:${px3Ct}`,
        `userCentrics_Braze=true`,
        `userCentrics_TVSquared=undefined`,
        `userCentrics_Perseus=true`,
        `userCentrics_BingConversion=undefined`,
        `userCentrics_TradeTracker=undefined`,
        `userCentrics_LinkedInAds=undefined`,
        `userCentrics_TradeDesk=undefined`,
        `userCentrics_Sklik=undefined`,
        `userCentrics_PerimeterX=undefined`,
        `userCentrics_AdjustforFraudPrevention=true`,
        `userCentrics_DeliveryHeroCore=undefined`,
        `userCentrics_FacebookConnect=true`,
        `userCentrics_GoogleTagManager=true`,
        `userCentrics_Sentry=true`,
        `userCentrics_UsercentricsConsentManagementPlatform=true`,
        `__ssid=${ssid}`,
        `userCentrics_BrazeSDK=true`,
        `userCentrics_FacebookPixel=true`,
        `userCentrics_GoogleAdsRemarketing=true`,
        `userCentrics_Twitter=true`,
        `userCentrics_GoogleAnalytics=true`,
        `userCentrics_PerseusFunctional=true`,
        `userCentrics_PerseusMarketing=true`,
        `userCentrics_Hotjar=true`,
        `userCentrics_GoogleAds=true`,
        `userCentrics_Adjust=true`,
        `userCentrics_FacebookSocialPlugins=true`,
        `userCentrics_GoogleFirebase=true`,
        `userCentrics_remerge=true`,
        `userCentrics_RTBHouse=true`,
        `userCentrics_TikTokAdvertising=true`,
        `userCentrics_TwitterAnalytics=true`,
        `_dd_s=logs=1&id=${ddId}&created=${timestamp}&expire=${timestamp + 900000}`,
        `dhhPerseusHitId=${hitId}`
    ];
    
    return cookies.join('; ');
}

// Rastgele versiyonlar oluÅŸtur
function generateRandomVersions() {
  // SÃ¼rÃ¼m aralÄ±klarÄ±
  const majorVersions = [22, 23, 24, 25];  // 22-25
  const minorVersions = Array.from({length: 100}, (_, i) => i); // 0-99
  const patchVersions = Array.from({length: 10}, (_, i) => i);  // 0-9
  
  // Rastgele sÃ¼rÃ¼m numaralarÄ±
  const major = majorVersions[Math.floor(Math.random() * majorVersions.length)];
  const minor = minorVersions[Math.floor(Math.random() * minorVersions.length)];
  const patch = patchVersions[Math.floor(Math.random() * patchVersions.length)];
  
  // Build numarasÄ± formatÄ± (MMNNPP00) - Major, miNor, Patch, 00
  const buildNumber = sprintf("%d%02d%d00", major, minor, patch);
  
  // SÃ¼rÃ¼m string formatÄ± (MM.NN.P)
  const version = sprintf("%d.%d.%d", major, minor, patch);
  
  // Rastgele bir sayÄ± ekle
  const buildSuffix = Math.floor(Math.random() * 900) + 100;
  const fullBuildNumber = buildNumber + buildSuffix;
  
  // User-Agent oluÅŸtur
  const userAgent = `Android-app-${version}(${fullBuildNumber})`;
  
  return {
    version: version,
    buildNumber: fullBuildNumber,
    userAgent: userAgent
  };
}

// sprintf iÅŸlevi (basit versiyon)
function sprintf(format) {
  const args = Array.prototype.slice.call(arguments, 1);
  return format.replace(/%([0-9]+)?([dfs])/g, function(match, width, type) {
    let s = args.shift().toString();
    if (type === 'd' && width) {
      s = s.padStart(parseInt(width, 10), '0');
    }
    return s;
  });
}

// PerimeterX token oluÅŸturucu
function generatePxToken() {
  // Ä°lk bÃ¶lÃ¼m
  const part1 = "3:";
  
  // 64 karakterlik hex string
  const part2 = Array.from({length: 32}, () => 
    "0123456789abcdef"[Math.floor(Math.random() * 16)]).join('');
  
  // Base64 string
  const part3 = Array.from({length: 88}, () => 
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/="[Math.floor(Math.random() * 65)]).join('');
  
  // Sabit sayÄ±
  const part4 = "1000";
  
  // Uzun base64 string
  const part5 = Array.from({length: 256}, () => 
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/="[Math.floor(Math.random() * 65)]).join('');
  
  return part1 + part2 + ":" + part3 + ":" + part4 + ":" + part5;
}

// Rastgele cihaz bilgisi Ã¼retici
function generateRandomDevice() {
  // Rastgele bir deviceId oluÅŸtur - 32 karakter
  const deviceId = Array.from({length: 32}, () => 
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 62)]).join('');
  
  // Cihaz markasÄ± listesi - oppo eklenmiÅŸ
  const makes = ["Xiaomi", "HUAWEI", "Redmi", "Samsung", "POCO", "oppo", "Asus"];
  const deviceMake = makes[Math.floor(Math.random() * makes.length)];
  
  // Rastgele model oluÅŸtur
  const models = ["CPH2341", "M2101K6G", "M2004J19C", "2201116TG", "2207117BPG", "ASUS_I005DA", "ASUS_Z01QD"];
  const deviceModel = models[Math.floor(Math.random() * models.length)];
  
  // Rastgele bir Android sÃ¼rÃ¼mÃ¼ seÃ§ (Android 6-13)
  const platformVersion = 23 + Math.floor(Math.random() * 10);
  
  return {
    deviceId: deviceId,
    deviceMake: deviceMake,
    deviceModel: deviceModel,
    platformVersion: platformVersion
  };
}

// EKS header generator function - sadece 6 karakterlik
function generateRandomEks() {
  // Sadece 6 karakterlik lowercase string Ã¼ret
  return Array.from({length: 6}, () => 
    "abcdefghijklmnopqrstuvwxyz"[Math.floor(Math.random() * 26)]).join('');
}

// Advanced ID generators
function generateUUIDv4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

function generateOriginalRts() {
  const now = new Date();
  // TÃ¼rkiye saat dilimi iÃ§in +03:00 formatÄ±nda
  const turkeyTime = new Date(now.getTime() + (3 * 60 * 60 * 1000));
  return turkeyTime.toISOString().replace('Z', '+03:00');
}

function generateOriginalRuid() {
  // Orjinal uygulamada 8 haneli numeric ID kullanÄ±lÄ±yor
  return Math.floor(10000000 + Math.random() * 90000000).toString();
}

function generateOriginalRSig() {
  // 32 byte random data'yÄ± base64'e Ã§evir (orjinal format)
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let result = '';
  for (let i = 0; i < 44; i++) { // 32 bytes = 44 base64 chars
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result + '='; // Padding
}

function generatePxAuthorization() {
  // Format: 3:32hex:base64data:1000:longbase64data
  const version = "3";
  const hexPart = generateHex(64); // 32 byte hex (64 karakter)
  
  // Base64 benzeri string oluÅŸtur
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let shortBase64 = '';
  for (let i = 0; i < 64; i++) {
    shortBase64 += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  
  const number = "1000";
  
  let longBase64 = '';
  for (let i = 0; i < 340; i++) {
    longBase64 += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  
  return `${version}:${hexPart}:${shortBase64}:${number}:${longBase64}`;
}

function generatePxHello() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  const length = Math.random() < 0.5 ? 50 : 54; // Ä°ki farklÄ± format
  
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  
  return result;
}

function generateCleanExtra() {
  const sessionId = generateHex(32);
    const currentTime = Date.now();
    const perseusTimestamp = Math.floor(Math.random() * 55834574556737536) + 100000000000000000;
    const perseusClientId = currentTime + '.' + perseusTimestamp + '.' + generateRandomString(10);
    
    const sessionLength = Math.random() < 0.5 ? 16 : 18;
    let sessionTimestamp;
    if (sessionLength === 16) {
        sessionTimestamp = Math.floor(Math.random() * 8796093022208000) + 1000000000000000;
  } else {
        sessionTimestamp = Math.floor(Math.random() * 55834574556737536) + 100000000000000000;
  }
  
    const perseusSessionId = currentTime + 1000 + '.' + sessionTimestamp + '.' + generateRandomString(10);
    
    const sessionData = {
    session_id: sessionId,
    perseus_id: perseusClientId,
        timestamp: Math.floor(currentTime / 1000)
    };
    
    const dpsSessionId = btoa(JSON.stringify(sessionData));
    const traceId = generateHex(16);
    const spanId = generateHex(8);
    const sampled = '0';
    const sentryTrace = traceId + '-' + spanId + '-' + sampled;
    
    const appVersion = '26.7.0';
    const buildNumber = '260700154';
    const platformVersion = '28';
    const baggage = 'sentry-environment=production,sentry-public_key=' + platformVersion + ',sentry-release=com.inovel.app.yemeksepeti%40' + appVersion + ',sentry-transaction=sm_AskEmailFragment,' + buildNumber + ',sentry-sampled=false,sentry-trace_id=' + traceId + ',sentry-span_id=' + spanId;
  
  return {
    deviceFingerprintToken: generateRandomString(100),
    deviceId: generateRandomString(32),
    pxVid: generateUUIDv4(),
    pxUuid: generateUUIDv4(),
    pxDeviceFp: generateHex(16),
    pxHello: generatePxHello(),
    adjustAdId: generateHex(32),
        appVersion: appVersion,
        buildNumber: buildNumber,
    timestamp: generateOriginalRts(),
        requestId: Math.random().toString(),
        sentryTrace: sentryTrace,
        baggage: baggage,
    traceTail: generateHex(16),
    emRequestId: generateUUIDv4(),
    perseusClientId: perseusClientId,
    perseusSessionId: perseusSessionId,
    eks: generateRandomString(6),
    rSig: generateOriginalRSig(),
    dpsSessionId: dpsSessionId,
    sessionId: sessionId,
    pxAuthorization: generatePxAuthorization()
  };
}

// YS Proxy: her istekte yeni cihaz profili (cache yok)
function generateDeviceIdentifiers() {
    const manufacturers = ['OPPO', 'Samsung', 'Huawei', 'ASUS', 'vivo', 'Realme', 'OnePlus', 'Google'];
    const selectedManufacturer = manufacturers[Math.floor(Math.random() * manufacturers.length)];
  
    const modelsByManufacturer = {
        'Samsung': ['Galaxy S22', 'Galaxy A52', 'Galaxy Note20', 'Galaxy S21'],
    'Xiaomi': ['Mi 11', 'Redmi Note 10', 'Poco F3', 'Mi 10T'],
        'Huawei': ['Mate 40', 'P40', 'Nova 8', 'P30'],
    'OPPO': ['Find X3', 'Reno 6', 'A74', 'F19'],
    'vivo': ['X60', 'V21', 'Y20', 'S9'],
    'Realme': ['GT', 'Narzo 30', '8 Pro', 'C25'],
        'OnePlus': ['9 Pro', '8T', '8 Pro', '9R'],
        'Google': ['Pixel 6', 'Pixel 6 Pro', 'Pixel 5', 'Pixel 4a']
  };
  
    const availableModels = modelsByManufacturer[selectedManufacturer] || modelsByManufacturer['Samsung'];
    const selectedModel = availableModels[Math.floor(Math.random() * availableModels.length)];
  
  const hexChars = '0123456789abcdef';
  let deviceId = '';
  for (let i = 0; i < 16; i++) {
    deviceId += hexChars.charAt(Math.floor(Math.random() * 16));
  }
  
  return {
        manufacturer: selectedManufacturer,
        model: selectedModel,
        deviceId: deviceId,
    appVersion: '26.7.0',
    buildNumber: '260700154',
    apiLevel: '31'
  };
}

function decodeJwtPayload(token) {
  try {
    const part = String(token).split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const pad = part + '='.repeat((4 - part.length % 4) % 4);
    return JSON.parse(atob(pad));
  } catch (e) {
    return null;
  }
}

function sdkToAndroidRelease(sdk) {
  const map = { 28: '9', 29: '10', 30: '11', 31: '12', 32: '12', 33: '13', 34: '14', 35: '15' };
  return map[parseInt(sdk, 10)] || '14';
}

let calculateProxySession = null;

function buildCalculateProxyHeaders(request, token, device) {
  if (!calculateProxySession) {
    const extra = generateCleanExtra();
    calculateProxySession = {
      deviceId: device.deviceId,
      brand: device.manufacturer,
      model: device.model,
      androidRelease: sdkToAndroidRelease(device.apiLevel || '34'),
      platformVersion: device.apiLevel || '34',
      appVersion: '26.36.0',
      buildNumber: '263600204',
      userAgent: 'Android-app-26.36.0(263600204)',
      pxVid: extra.pxVid,
      pxDeviceFp: extra.pxDeviceFp,
      pxAuthorization: '3',
      perseusClientId: extra.perseusClientId,
      perseusSessionId: extra.perseusSessionId,
      dpsSessionId: extra.dpsSessionId,
      adjustAdId: extra.adjustAdId
    };
  }
  const s = calculateProxySession;
  const payload = token ? decodeJwtPayload(token) : null;
  const custCode = (payload && payload.user_id) ? String(payload.user_id) : '';
  const tokenExpired = !!(payload && payload.exp && (Date.now() / 1000) >= payload.exp);
  const traceId = generateHex(32);
  const spanId = generateHex(16);

  const headers = {
    'user-agent': s.userAgent,
    'x-fp-api-key': 'android',
    'platform': 'android',
    'app-name': 'com.inovel.app.yemeksepeti',
    'app-flavor': 'yemeksepeti',
    'app-build': s.buildNumber,
    'app-version': s.appVersion,
    'build-number': s.buildNumber,
    'build-type': 'release',
    'release-lane': 'production',
    'platform-version': s.platformVersion,
    'content-type': 'application/json; charset=UTF-8',
    'x-pd-language-id': '2',
    'api-client-version': '5.0',
    'android-mobile-service-provider': 'gms',
    'device-performance-class': 'high',
    'cust-code': custCode,
    'device-make': s.brand,
    'device-model': s.model,
    'device-id': s.deviceId,
    'em-request-identifier': generateUUIDv4(),
    'sentry-trace': traceId + '-' + spanId + '-0',
    'baggage': 'sentry-environment=production,sentry-public_key=385c49e6b6c4484d8362abae622b3f0b,sentry-release=com.inovel.app.yemeksepeti%40' + s.appVersion + ',sentry-transaction=perseus_interceptor,sentry-sample_rate=0,sentry-sampled=false,sentry-trace_id=' + traceId + ',sentry-span_id=' + spanId,
    'x-px-mobile-sdk-version': '3.3.3',
    'x-px-os': 'Android',
    'x-px-os-version': s.androidRelease,
    'x-px-device-model': s.model,
    'x-px-vid': s.pxVid,
    'x-px-uuid': generateUUIDv4(),
    'x-px-device-fp': s.pxDeviceFp,
    'x-px-authorization': s.pxAuthorization,
    'x-px-original-token': generatePxOriginalToken(),
    'x-px-hello': generatePxHello(),
    'perseus-client-id': s.perseusClientId,
    'perseus-session-id': s.perseusSessionId,
    'adjust-ad-id': s.adjustAdId,
    'dps-session-id': s.dpsSessionId,
    'x-okcronet-trace': 'cartCalculate',
    'x-okcronet-priority': 'high'
  };

  if (token && !tokenExpired) {
    headers['authorization'] = 'Bearer ' + token;
  }

  const timestamp = new Date().toISOString().replace(/\.\d+/, '').replace('Z', '+0300');
  const random = Math.random().toString();
  const eks = 'mnpaaa';
  if (typeof generateYemeksepetiRSig !== 'undefined') {
    const sigResult = generateYemeksepetiRSig({
      url: request.url,
      eks: eks,
      body: request.body || '',
      timestamp: timestamp,
      random: random
    });
    if (sigResult && sigResult.success) {
      headers['r-sig'] = sigResult.signature;
      headers['rts'] = timestamp;
      headers['ruid'] = random;
      headers['eks'] = eks;
    }
  }
  return headers;
}

// YS Proxy Request Handler
async function handleYsProxyRequest(request, sendResponse) {
  try {
    console.log('Background: YS Proxy isteÄŸi alÄ±ndÄ±', request.url);

    if (!request.url) {
      throw new Error('URL eksik');
    }

    // Access token'Ä± cookie'den al
    const accessTokenCookie = await new Promise(resolve => {
        chrome.cookies.get({ url: 'https://www.yemeksepeti.com', name: 'access_token' }, resolve);
    });
    let token = accessTokenCookie?.value;
    
    if (!token) {
      // Session storage'dan dene
      const sessionData = await chrome.storage.sync.get(['yemekhub_session']);
      if (sessionData.yemekhub_session && sessionData.yemekhub_session.cookies) {
        const cookies = sessionData.yemekhub_session.cookies;
        const accessTokenCookie = cookies.find(c => c.name === 'access_token');
        if (accessTokenCookie) {
          token = accessTokenCookie.value;
        }
      }
    }
    
    if (!token) {
      throw new Error('Access token not found');
    }

    const isCalculate = (request.url || '').includes('/cart/calculate');
    let headers;
    if (isCalculate) {
      headers = buildCalculateProxyHeaders(request, token, generateDeviceIdentifiers());
    } else {
    // Her istekte yeni cihaz profili
    const device = generateDeviceIdentifiers();
    
    // Headers oluÅŸtur
    headers = {
        "Authorization": `Bearer ${token}`,
        "X-Pd-Language-Id": "2",
		"Host": "tr.fd-api.com",
        "X-Reorder-Origin": "",
		"Connection": "keep-alive",
        "Api-Client-Version": "5.0",
        "App-Name": "com.inovel.app.yemeksepeti",
        "App-Flavor": "yemeksepeti",
        "Build-Type": "release",
        "Platform": "android",
        "Platform-Version": "28",
        "Build-Number": device.buildNumber,
        "App-Build": device.buildNumber,
        "App-Version": device.appVersion,
        "Android-Mobile-Service-Provider": "gms",
        "Adjust-Ad-Id": generateHex(32),
        "X-Px-Vid": generateUUIDv4(),
        "X-Px-Os-Version": "9",
        "X-Px-Uuid": generateUUIDv4(),
        "X-Px-Device-Fp": device.deviceId,
        "X-Px-Device-Model": device.model,
        "X-Px-Os": "Android",
        "X-Px-Mobile-Sdk-Version": "3.3.3",
        "X-Px-Authorization": "4",
        "Device-Performance-Class": "mid",
        "X-Px-Bypass-Reason": "Invalid SDK initialization",
        "X-Fp-Api-Key": "android",
        "Eks": "mnpaaa",
        "User-Agent": `Android-app-${device.appVersion}(${device.buildNumber})`,
        'Content-Type': 'application/json; charset=UTF-8',
        ...request.headers
    };
    }

    if (!isCalculate) {
    // R-Sig Ã¼ret
    const timestamp = new Date().toISOString().replace(/\.\d+/, '').replace('Z', '+0300');
    const random = Math.random().toString();
    const eks = 'mnpaaa';

    const sigRequestData = {
        url: request.url,
        eks: eks,
        body: request.body || "",
        timestamp: timestamp,
        random: random
    };

    // generate-rsig.js'den gelen fonksiyonu kullan
    if (typeof generateYemeksepetiRSig !== 'undefined') {
      const sigResult = generateYemeksepetiRSig(sigRequestData);
      if (sigResult && sigResult.success) {
          headers['R-Sig'] = sigResult.signature;
          headers['Rts'] = timestamp;
          headers['Ruid'] = random;
      } else {
          console.error('Background: YS Proxy iÃ§in R-Sig Ã¼retilemedi:', sigResult ? sigResult.error : 'Bilinmeyen hata');
      }
    }
    }

    const fetchOptions = {
      method: request.method || 'POST',
      headers: headers,
      body: request.body,
      credentials: isCalculate ? 'include' : 'omit'
    };

    console.log('Background: YS Proxy istek gÃ¶nderiliyor -', fetchOptions.method, request.url);

    const response = await fetch(request.url, fetchOptions);

    const responseHeaders = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key.toLowerCase()] = value;
    });

    const data = await response.text();

    console.log('Background: YS Proxy yanÄ±t alÄ±ndÄ± -', response.status, data.length + ' byte');

    sendResponse({
      success: true,
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
      requestHeaders: headers,
      data: data
    });

  } catch (error) {
    console.error('Background: YS Proxy istek hatasÄ±:', error);
    sendResponse({
      success: false,
      error: error.message || 'Bilinmeyen hata',
      headers: {}
    });
  }
}

function clearAllRules() {
  return new Promise(async (resolve) => { // reject'e gerek yok, her durumda devam ediyoruz.
    try {
      console.log("KapsamlÄ± kural temizleme iÅŸlemi baÅŸlatÄ±lÄ±yor...");
      
      // Dinamik kurallarÄ± temizle
      const dynamicRules = await chrome.declarativeNetRequest.getDynamicRules();
      if (dynamicRules.length > 0) {
        const dynamicRuleIds = dynamicRules.map(rule => rule.id);
        console.log(`Temizlenecek ${dynamicRuleIds.length} dinamik kural bulundu.`);
        await chrome.declarativeNetRequest.updateDynamicRules({
          removeRuleIds: dynamicRuleIds
        });
        console.log("TÃ¼m dinamik kurallar temizlendi.");
      } else {
        console.log("Temizlenecek dinamik kural bulunamadÄ±.");
      }
      
      // Oturum kurallarÄ±nÄ± temizle
      const sessionRules = await chrome.declarativeNetRequest.getSessionRules();
      if (sessionRules.length > 0) {
        const sessionRuleIds = sessionRules.map(rule => rule.id);
        console.log(`Temizlenecek ${sessionRuleIds.length} oturum kuralÄ± bulundu.`);
        await chrome.declarativeNetRequest.updateSessionRules({
          removeRuleIds: sessionRuleIds
        });
        console.log("TÃ¼m oturum kurallarÄ± temizlendi.");
      } else {
        console.log("Temizlenecek oturum kuralÄ± bulunamadÄ±.");
      }
      
      console.log("KapsamlÄ± kural temizleme baÅŸarÄ±yla tamamlandÄ±.");
    } catch (error) {
      console.error("Kural temizleme sÄ±rasÄ±nda bir hata oluÅŸtu (ancak iÅŸlem devam edecek):", error);
    } finally {
      resolve(); // Her durumda iÅŸlemi bitir.
    }
  });
}

async function getBlockedPatterns() {
    try {
        // Engellenecek domain/pattern listesi
        const fallbackData = [
            'px-cloud.net',
            'pxchk.net',
            'usercentrics.eu',
            'sentry.io',
            'icg-in.com',
            'braze.com',
            'api/v2/collector',
            'trackjs.com',
            'xhr/b/s',
            'cdn-cgi/rum',
            'px-cdn.net',
            'perseus-productanalytics',
            '/v5/action-log',
            'pxchk.net',
            'hotjar.io',
            'hotjar.com',
			'conn-check.icg-in.info',
			'pagespeed.deliveryhero.net',
			'browser-http-intake.logs.datadoghq.eu/v1',
			'browser-http-intake',
            'datadoghq.eu',
            'hexagon-analytics',
            'qualtrics.com',
            'datadog',
            'browser-intake-datadoghq.eu',
			'deliveryhero.com/api/logs',
            'bruce-ys-tr.production.eu.fintech.deliveryhero.com\/api\/logs',
            'at-display-eu.deliveryhero.io',
            'disco.deliveryhero.io/up-and-cross-sell',
            'action-log.yemeksepeti.com',
            'survey-api'
            ];
        
        return fallbackData;
        
    } catch (error) {
        return false;
    }
}

function generateBlockingRules(patterns, startId) {
    return patterns.map((pattern, index) => ({
        id: startId + index,
        priority: 1,
        action: {
            type: 'block'
        },
        condition: {
            urlFilter: pattern,
            resourceTypes: [
                'sub_frame', 'script', 'xmlhttprequest',
                'image', 'font', 'media', 'stylesheet', 'websocket'
            ]
        }
    }));
}

async function setupBlockingDynamicHeaders() {
    try {
        const startId = 1000;
        const blockedPatterns = await getBlockedPatterns();
        const blockingRules = generateBlockingRules(blockedPatterns, startId);
        
        chrome.declarativeNetRequest.updateDynamicRules({
            removeRuleIds: blockingRules.map(rule => rule.id),
            addRules: blockingRules
        }, () => {
            if (chrome.runtime.lastError) {
                console.error('Error adding block rules:', chrome.runtime.lastError);
            } else {
                console.log('Added ' + blockingRules.length + ' tracking block rules starting at ID ' + startId);
            }
        });
        
    } catch (error) {
        console.log('Blocking Dinamik header\'lar ayarlanÄ±rken hata:', error);
    }
}

// Yerel dynamic rules - uzak sunucudan Ã§ekilmiyor
async function getFallbackDynamicRules() {
    // rulesConfig.php'den alÄ±nan tÃ¼m kurallar - uzak sunucu ile iletiÅŸim yok
    const localDynamicRules = [
        {
            "id": 1,
            "priority": 1,
            "action": {
                "type": "modifyHeaders",
                "requestHeaders": [
                    {"header": "sec-ch-ua", "operation": "remove"},
                    {"header": "sec-ch-ua-mobile", "operation": "remove"},
                    {"header": "sec-ch-ua-platform", "operation": "remove"},
                    {"header": "sec-fetch-dest", "operation": "remove"},
                    {"header": "sec-fetch-mode", "operation": "remove"},
                    {"header": "sec-fetch-site", "operation": "remove"},
                    {"header": "sec-fetch-user", "operation": "remove"},
                    {"header": "sec-fetch-storage-access", "operation": "remove"},
                    {"header": "sec-ch-ua-arch", "operation": "remove"},
                    {"header": "sec-ch-ua-bitness", "operation": "remove"},
                    {"header": "sec-ch-ua-full-version", "operation": "remove"},
                    {"header": "sec-ch-ua-full-version-list", "operation": "remove"},
                    {"header": "sec-ch-ua-model", "operation": "remove"},
                    {"header": "sec-ch-ua-wow64", "operation": "remove"},
                    {"header": "sec-ch-ua-platform-version", "operation": "remove"},
                    {"header": "sec-ch-ua-form-factor", "operation": "remove"},
                    {"header": "sec-ch-ua-viewport-width", "operation": "remove"},
                    {"header": "sec-ch-ua-dpr", "operation": "remove"},
                    {"header": "sec-ch-ua-resolution", "operation": "remove"},
                    {"header": "sec-ch-ua-ua", "operation": "remove"},
                    {"header": "priority", "operation": "remove"},
                    {"header": "referer", "operation": "remove"},
                    {"header": "Referer", "operation": "remove"},
                    {"header": "x-requested-with", "operation": "remove"},
                    {"header": "x-caller-platform", "operation": "remove"},
                    {"header": "perseus-session-id", "operation": "set", "value": "%PERSEUS_SESSION_ID%"},
                    {"header": "perseus-client-id", "operation": "set", "value": "%PERSEUS_CLIENT_ID%"},
                    {"header": "dps-session-id", "operation": "set", "value": "%DPS_SESSION_ID%"},
                    {"header": "Origin", "operation": "set", "value": "https://www.yemeksepeti.com"},
                    {"header": "User-Agent", "operation": "set", "value": "Android-app-%APP_VERSION%(%BUILD_NUMBER%)"},
                    {"header": "Accept-Encoding", "operation": "set", "value": "gzip, deflate, br"}
                ]
            },
            "condition": {
                "urlFilter": "https://tr.fd-api.com/api/v5/cart/calculate",
                "resourceTypes": ["xmlhttprequest"],
                "excludedRequestMethods": ["options"]
            }
        },
        {
            "id": 2,
            "priority": 1,
            "action": {
                "type": "modifyHeaders",
                "requestHeaders": [
                    {"header": "Host", "operation": "set", "value": "tr.fd-api.com"},
                    {"header": "x-pd-language-id", "operation": "set", "value": "2"},
                    {"header": "api-client-version", "operation": "set", "value": "5.0"},
                    {"header": "x-fp-api-key", "operation": "set", "value": "android"},
                    {"header": "platform", "operation": "set", "value": "android"},
                    {"header": "release-lane", "operation": "set", "value": "production"},
                    {"header": "platform-version", "operation": "set", "value": "%PLATFORM_VERSION%"},
                    {"header": "user-agent", "operation": "set", "value": "Android-app-24.36.0(243600124)"},
                    {"header": "app-name", "operation": "set", "value": "com.inovel.app.yemeksepeti"},
                    {"header": "app-flavor", "operation": "set", "value": "yemeksepeti"},
                    {"header": "app-version", "operation": "set", "value": "24.36.0"},
                    {"header": "app-build", "operation": "set", "value": "243600124"},
                    {"header": "build-number", "operation": "set", "value": "243600124"},
                    {"header": "build-type", "operation": "set", "value": "release"},
                    {"header": "cust-code", "operation": "set", "value": "%CUST_CODE%"},
                    {"header": "content-type", "operation": "set", "value": "application/json; charset=UTF-8"},
                    {"header": "android-mobile-service-provider", "operation": "set", "value": "gms"},
                    {"header": "device-performance-class", "operation": "set", "value": "%DEVICE_PERF_CLASS%"},
                    {"header": "device-make", "operation": "set", "value": "%DEVICE_MAKE%"},
                    {"header": "device-model", "operation": "set", "value": "%DEVICE_MODEL%"},
                    {"header": "device-id", "operation": "set", "value": "%DEVICE_ID%"},
                    {"header": "x-px-mobile-sdk-version", "operation": "set", "value": "3.3.3"},
                    {"header": "x-px-os", "operation": "set", "value": "Android"},
                    {"header": "x-px-os-version", "operation": "set", "value": "%ANDROID_VERSION%"},
                    {"header": "x-px-device-model", "operation": "set", "value": "%DEVICE_MODEL%"},
                    {"header": "x-px-vid", "operation": "set", "value": "%PX_VID%"},
                    {"header": "x-px-uuid", "operation": "set", "value": "%PX_UUID%"},
                    {"header": "x-px-device-fp", "operation": "set", "value": "%PX_DEVICE_FP%"},
                    {"header": "x-px-authorization", "operation": "set", "value": "3"},
                    {"header": "x-px-original-token", "operation": "set", "value": "%PX_ORIGINAL_TOKEN%"},
                    {"header": "x-px-bypass-reason", "operation": "set", "value": "Invalid SDK initialization"},
                    {"header": "adjust-ad-id", "operation": "set", "value": "%ADJUST_AD_ID%"},
                    {"header": "sentry-trace", "operation": "set", "value": "%SENTRY_TRACE%"},
                    {"header": "baggage", "operation": "set", "value": "%BAGGAGE_V2%"},
                    {"header": "em-request-identifier", "operation": "set", "value": "%EM_REQUEST_ID%"},
                    {"header": "r-sig", "operation": "set", "value": "%R_SIG_V2%"},
                    {"header": "rts", "operation": "set", "value": "%RTS_V2%"},
                    {"header": "ruid", "operation": "set", "value": "%RUID_V2%"},
                    {"header": "eks", "operation": "set", "value": "%EKS_V2%"},
                    {"header": "x-okcronet-trace", "operation": "set", "value": "cartCalculate"},
                    {"header": "x-okcronet-priority", "operation": "set", "value": "high"},
                    {"header": "authorization", "operation": "set", "value": "Bearer %ACCESS_TOKEN%"},
                    {"header": "Cookie", "operation": "set", "value": "%WEB_COOKIES%"}
                ]
            },
            "condition": {
                "urlFilter": "https://tr.fd-api.com/api/v5/cart/calculate",
                "requestMethods": ["post"]
            }
        },
        {
            "id": 3,
            "priority": 1,
            "action": {
                "type": "modifyHeaders",
                "requestHeaders": [
                    {"header": "Host", "operation": "set", "value": "tr.fd-api.com"},
                    {"header": "x-pd-language-id", "operation": "set", "value": "2"},
                    {"header": "api-client-version", "operation": "set", "value": "5.0"},
                    {"header": "x-fp-api-key", "operation": "set", "value": "android"},
                    {"header": "content-type", "operation": "set", "value": "application/json; charset=UTF-8"},
                    {"header": "device-make", "operation": "set", "value": "%DEVICE_MAKE%"},
                    {"header": "device-model", "operation": "set", "value": "%DEVICE_MODEL%"},
                    {"header": "device-id", "operation": "set", "value": "%DEVICE_ID%"},
                    {"header": "app-name", "operation": "set", "value": "com.inovel.app.yemeksepeti"},
                    {"header": "app-flavor", "operation": "set", "value": "yemeksepeti"},
                    {"header": "user-agent", "operation": "set", "value": "Android-app-%APP_VERSION%(%BUILD_NUMBER%)"},
                    {"header": "build-number", "operation": "set", "value": "%BUILD_NUMBER%"},
                    {"header": "build-type", "operation": "set", "value": "release"},
                    {"header": "platform", "operation": "set", "value": "android"},
                    {"header": "release-lane", "operation": "set", "value": "production"},
                    {"header": "platform-version", "operation": "set", "value": "%PLATFORM_VERSION%"},
                    {"header": "android-mobile-service-provider", "operation": "set", "value": "gms"},
                    {"header": "app-build", "operation": "set", "value": "%BUILD_NUMBER%"},
                    {"header": "app-version", "operation": "set", "value": "%APP_VERSION%"},
                    {"header": "cust-code", "operation": "set", "value": "%CUST_CODE%"},
                    {"header": "device-performance-class", "operation": "set", "value": "%DEVICE_PERF_CLASS%"},
                    {"header": "x-px-vid", "operation": "set", "value": "%PX_VID%"},
                    {"header": "x-px-os-version", "operation": "set", "value": "%ANDROID_VERSION%"},
                    {"header": "x-px-uuid", "operation": "set", "value": "%PX_UUID%"},
                    {"header": "x-px-device-fp", "operation": "set", "value": "%PX_DEVICE_FP%"},
                    {"header": "x-px-device-model", "operation": "set", "value": "%DEVICE_MODEL%"},
                    {"header": "x-px-os", "operation": "set", "value": "Android"},
                    {"header": "x-px-mobile-sdk-version", "operation": "set", "value": "3.3.3"},
                    {"header": "x-px-authorization", "operation": "set", "value": "4"},
                    {"header": "x-px-bypass-reason", "operation": "set", "value": "Invalid SDK initialization"},
                    {"header": "sentry-trace", "operation": "set", "value": "%SENTRY_TRACE%"},
                    {"header": "baggage", "operation": "set", "value": "%BAGGAGE_V2%"},
                    {"header": "em-request-identifier", "operation": "set", "value": "%EM_REQUEST_ID%"},
                    {"header": "adjust-ad-id", "operation": "set", "value": "%ADJUST_AD_ID%"},
                    {"header": "rts", "operation": "set", "value": "%RTS%"},
                    {"header": "ruid", "operation": "set", "value": "%RUID%"},
                    {"header": "eks", "operation": "set", "value": "%EKS%"},
                    {"header": "authorization", "operation": "set", "value": "Bearer %ACCESS_TOKEN%"}
                ]
            },
            "condition": {
                "urlFilter": "https://tr.fd-api.com/api/v5/purchase/intent",
                "requestMethods": ["post", "put", "get"]
            }
        },
        {
            "id": 4,
            "priority": 1,
            "action": {
                "type": "modifyHeaders",
                "requestHeaders": [
                    {"header": "Host", "operation": "set", "value": "tr.fd-api.com"},
                    {"header": "x-pd-language-id", "operation": "set", "value": "2"},
                    {"header": "api-client-version", "operation": "set", "value": "5.0"},
                    {"header": "x-fp-api-key", "operation": "set", "value": "android"},
                    {"header": "content-type", "operation": "set", "value": "application/json; charset=UTF-8"},
                    {"header": "device-make", "operation": "set", "value": "%DEVICE_MAKE%"},
                    {"header": "device-model", "operation": "set", "value": "%DEVICE_MODEL%"},
                    {"header": "device-id", "operation": "set", "value": "%DEVICE_ID%"},
                    {"header": "app-name", "operation": "set", "value": "com.inovel.app.yemeksepeti"},
                    {"header": "app-flavor", "operation": "set", "value": "yemeksepeti"},
                    {"header": "user-agent", "operation": "set", "value": "Android-app-%APP_VERSION%(%BUILD_NUMBER%)"},
                    {"header": "build-number", "operation": "set", "value": "%BUILD_NUMBER%"},
                    {"header": "build-type", "operation": "set", "value": "release"},
                    {"header": "platform", "operation": "set", "value": "android"},
                    {"header": "release-lane", "operation": "set", "value": "production"},
                    {"header": "platform-version", "operation": "set", "value": "%PLATFORM_VERSION%"},
                    {"header": "android-mobile-service-provider", "operation": "set", "value": "gms"},
                    {"header": "app-build", "operation": "set", "value": "%BUILD_NUMBER%"},
                    {"header": "app-version", "operation": "set", "value": "%APP_VERSION%"},
                    {"header": "cust-code", "operation": "set", "value": "%CUST_CODE%"},
                    {"header": "device-performance-class", "operation": "set", "value": "%DEVICE_PERF_CLASS%"},
                    {"header": "x-px-vid", "operation": "set", "value": "%PX_VID%"},
                    {"header": "x-px-os-version", "operation": "set", "value": "%ANDROID_VERSION%"},
                    {"header": "x-px-uuid", "operation": "set", "value": "%PX_UUID%"},
                    {"header": "x-px-device-fp", "operation": "set", "value": "%PX_DEVICE_FP%"},
                    {"header": "x-px-device-model", "operation": "set", "value": "%DEVICE_MODEL%"},
                    {"header": "x-px-os", "operation": "set", "value": "Android"},
                    {"header": "x-px-mobile-sdk-version", "operation": "set", "value": "3.3.3"},
                    {"header": "x-px-authorization", "operation": "set", "value": "4"},
                    {"header": "x-px-bypass-reason", "operation": "set", "value": "Invalid SDK initialization"},
                    {"header": "sentry-trace", "operation": "set", "value": "%SENTRY_TRACE%"},
                    {"header": "baggage", "operation": "set", "value": "%BAGGAGE_V2%"},
                    {"header": "em-request-identifier", "operation": "set", "value": "%EM_REQUEST_ID%"},
                    {"header": "adjust-ad-id", "operation": "set", "value": "%ADJUST_AD_ID%"},
                    {"header": "rts", "operation": "set", "value": "%RTS%"},
                    {"header": "ruid", "operation": "set", "value": "%RUID%"},
                    {"header": "eks", "operation": "set", "value": "%EKS%"},
                    {"header": "authorization", "operation": "set", "value": "Bearer %ACCESS_TOKEN%"},
                    {"header": "Cookie", "operation": "set", "value": "%WEB_COOKIES%"}
                ]
            },
            "condition": {
                "urlFilter": "https://tr.fd-api.com/api/v5/cart/checkout",
                "requestMethods": ["post"]
            }
        },
        {
            "id": 6,
            "priority": 1,
            "action": {
                "type": "modifyHeaders",
                "requestHeaders": [
                    {"header": "sec-ch-ua", "operation": "remove"},
                    {"header": "sec-ch-ua-mobile", "operation": "remove"},
                    {"header": "sec-ch-ua-platform", "operation": "remove"},
                    {"header": "sec-fetch-dest", "operation": "remove"},
                    {"header": "sec-fetch-mode", "operation": "remove"},
                    {"header": "sec-fetch-site", "operation": "remove"},
                    {"header": "sec-fetch-user", "operation": "remove"},
                    {"header": "sec-fetch-storage-access", "operation": "remove"},
                    {"header": "sec-ch-ua-arch", "operation": "remove"},
                    {"header": "sec-ch-ua-bitness", "operation": "remove"},
                    {"header": "sec-ch-ua-full-version", "operation": "remove"},
                    {"header": "sec-ch-ua-full-version-list", "operation": "remove"},
                    {"header": "sec-ch-ua-model", "operation": "remove"},
                    {"header": "sec-ch-ua-wow64", "operation": "remove"},
                    {"header": "sec-ch-ua-platform-version", "operation": "remove"},
                    {"header": "sec-ch-ua-form-factor", "operation": "remove"},
                    {"header": "sec-ch-ua-viewport-width", "operation": "remove"},
                    {"header": "sec-ch-ua-dpr", "operation": "remove"},
                    {"header": "sec-ch-ua-resolution", "operation": "remove"},
                    {"header": "sec-ch-ua-ua", "operation": "remove"},
                    {"header": "priority", "operation": "remove"},
                    {"header": "referer", "operation": "remove"},
                    {"header": "Referer", "operation": "remove"},
                    {"header": "x-requested-with", "operation": "remove"},
                    {"header": "x-caller-platform", "operation": "remove"},
                    {"header": "perseus-session-id", "operation": "remove"},
                    {"header": "perseus-client-id", "operation": "remove"},
                    {"header": "dps-session-id", "operation": "remove"},
                    {"header": "Origin", "operation": "set", "value": "https://www.yemeksepeti.com"},
                    {"header": "User-Agent", "operation": "set", "value": "Android-app-%APP_VERSION%(%BUILD_NUMBER%)"},
                    {"header": "Accept-Encoding", "operation": "set", "value": "gzip, deflate, br"}
                ]
            },
            "condition": {
                "urlFilter": "https://tr.fd-api.com/api/v5/purchase/intent",
                "requestMethods": ["post", "put", "get"]
            }
        },
        {
            "id": 7,
            "priority": 1,
            "action": {
                "type": "modifyHeaders",
                "requestHeaders": [
                    {"header": "sec-ch-ua", "operation": "remove"},
                    {"header": "sec-ch-ua-mobile", "operation": "remove"},
                    {"header": "sec-ch-ua-platform", "operation": "remove"},
                    {"header": "sec-fetch-dest", "operation": "remove"},
                    {"header": "sec-fetch-mode", "operation": "remove"},
                    {"header": "sec-fetch-site", "operation": "remove"},
                    {"header": "sec-fetch-user", "operation": "remove"},
                    {"header": "sec-fetch-storage-access", "operation": "remove"},
                    {"header": "sec-ch-ua-arch", "operation": "remove"},
                    {"header": "sec-ch-ua-bitness", "operation": "remove"},
                    {"header": "sec-ch-ua-full-version", "operation": "remove"},
                    {"header": "sec-ch-ua-full-version-list", "operation": "remove"},
                    {"header": "sec-ch-ua-model", "operation": "remove"},
                    {"header": "sec-ch-ua-wow64", "operation": "remove"},
                    {"header": "sec-ch-ua-platform-version", "operation": "remove"},
                    {"header": "sec-ch-ua-form-factor", "operation": "remove"},
                    {"header": "sec-ch-ua-viewport-width", "operation": "remove"},
                    {"header": "sec-ch-ua-dpr", "operation": "remove"},
                    {"header": "sec-ch-ua-resolution", "operation": "remove"},
                    {"header": "sec-ch-ua-ua", "operation": "remove"},
                    {"header": "priority", "operation": "remove"},
                    {"header": "referer", "operation": "remove"},
                    {"header": "Referer", "operation": "remove"},
                    {"header": "x-requested-with", "operation": "remove"},
                    {"header": "x-caller-platform", "operation": "remove"},
                    {"header": "perseus-session-id", "operation": "set", "value": "%PERSEUS_SESSION_ID%"},
                    {"header": "perseus-client-id", "operation": "set", "value": "%PERSEUS_CLIENT_ID%"},
                    {"header": "dps-session-id", "operation": "set", "value": "%DPS_SESSION_ID%"},
                    {"header": "Origin", "operation": "set", "value": "https://www.yemeksepeti.com"},
                    {"header": "User-Agent", "operation": "set", "value": "Android-app-%APP_VERSION%(%BUILD_NUMBER%)"},
                    {"header": "Accept-Encoding", "operation": "set", "value": "gzip, deflate, br"}
                ]
            },
            "condition": {
                "urlFilter": "https://tr.fd-api.com/api/v5/cart/checkout",
                "requestMethods": ["post"]
            }
        },
        {
            "id": 8,
            "priority": 1,
            "action": {
                "type": "modifyHeaders",
                "requestHeaders": [
                    {"header": "Host", "operation": "set", "value": "tr.fd-api.com"},
                    {"header": "x-pd-language-id", "operation": "set", "value": "2"},
                    {"header": "api-client-version", "operation": "set", "value": "5.0"},
                    {"header": "x-fp-api-key", "operation": "set", "value": "android"},
                    {"header": "content-type", "operation": "set", "value": "application/json; charset=UTF-8"},
                    {"header": "device-make", "operation": "set", "value": "%DEVICE_MAKE%"},
                    {"header": "device-model", "operation": "set", "value": "%DEVICE_MODEL%"},
                    {"header": "device-id", "operation": "set", "value": "%DEVICE_ID%"},
                    {"header": "app-name", "operation": "set", "value": "com.inovel.app.yemeksepeti"},
                    {"header": "app-flavor", "operation": "set", "value": "yemeksepeti"},
                    {"header": "user-agent", "operation": "set", "value": "Android-app-%APP_VERSION%(%BUILD_NUMBER%)"},
                    {"header": "build-number", "operation": "set", "value": "%BUILD_NUMBER%"},
                    {"header": "build-type", "operation": "set", "value": "release"},
                    {"header": "platform", "operation": "set", "value": "android"},
                    {"header": "release-lane", "operation": "set", "value": "production"},
                    {"header": "platform-version", "operation": "set", "value": "%PLATFORM_VERSION%"},
                    {"header": "android-mobile-service-provider", "operation": "set", "value": "gms"},
                    {"header": "app-build", "operation": "set", "value": "%BUILD_NUMBER%"},
                    {"header": "app-version", "operation": "set", "value": "%APP_VERSION%"},
                    {"header": "cust-code", "operation": "set", "value": "%CUST_CODE%"},
                    {"header": "device-performance-class", "operation": "set", "value": "%DEVICE_PERF_CLASS%"},
                    {"header": "x-px-vid", "operation": "set", "value": "%PX_VID%"},
                    {"header": "x-px-os-version", "operation": "set", "value": "%ANDROID_VERSION%"},
                    {"header": "x-px-uuid", "operation": "set", "value": "%PX_UUID%"},
                    {"header": "x-px-device-fp", "operation": "set", "value": "%PX_DEVICE_FP%"},
                    {"header": "x-px-device-model", "operation": "set", "value": "%DEVICE_MODEL%"},
                    {"header": "x-px-os", "operation": "set", "value": "Android"},
                    {"header": "x-px-mobile-sdk-version", "operation": "set", "value": "3.3.3"},
                    {"header": "x-px-authorization", "operation": "set", "value": "4"},
                    {"header": "x-px-bypass-reason", "operation": "set", "value": "Invalid SDK initialization"},
                    {"header": "sentry-trace", "operation": "set", "value": "%SENTRY_TRACE%"},
                    {"header": "baggage", "operation": "set", "value": "%BAGGAGE_V2%"},
                    {"header": "em-request-identifier", "operation": "set", "value": "%EM_REQUEST_ID%"},
                    {"header": "adjust-ad-id", "operation": "set", "value": "%ADJUST_AD_ID%"},
                    {"header": "rts", "operation": "set", "value": "%RTS%"},
                    {"header": "ruid", "operation": "set", "value": "%RUID%"},
                    {"header": "eks", "operation": "set", "value": "%EKS%"},
                    {"header": "authorization", "operation": "set", "value": "Bearer %ACCESS_TOKEN%"}
                ]
            },
            "condition": {
                "urlFilter": "https://tr.fd-api.com/api/v6/incentives",
                "requestMethods": ["post", "put", "get", "delete"]
            }
        },
        {
            "id": 11,
            "priority": 1,
            "action": {
                "type": "modifyHeaders",
                "requestHeaders": [
                    {"header": "sec-ch-ua", "operation": "remove"},
                    {"header": "sec-ch-ua-mobile", "operation": "remove"},
                    {"header": "sec-ch-ua-platform", "operation": "remove"},
                    {"header": "sec-fetch-dest", "operation": "remove"},
                    {"header": "sec-fetch-mode", "operation": "remove"},
                    {"header": "sec-fetch-site", "operation": "remove"},
                    {"header": "sec-fetch-user", "operation": "remove"},
                    {"header": "sec-fetch-storage-access", "operation": "remove"},
                    {"header": "sec-ch-ua-arch", "operation": "remove"},
                    {"header": "sec-ch-ua-bitness", "operation": "remove"},
                    {"header": "sec-ch-ua-full-version", "operation": "remove"},
                    {"header": "sec-ch-ua-full-version-list", "operation": "remove"},
                    {"header": "sec-ch-ua-model", "operation": "remove"},
                    {"header": "sec-ch-ua-wow64", "operation": "remove"},
                    {"header": "sec-ch-ua-platform-version", "operation": "remove"},
                    {"header": "sec-ch-ua-form-factor", "operation": "remove"},
                    {"header": "sec-ch-ua-viewport-width", "operation": "remove"},
                    {"header": "sec-ch-ua-dpr", "operation": "remove"},
                    {"header": "sec-ch-ua-resolution", "operation": "remove"},
                    {"header": "sec-ch-ua-ua", "operation": "remove"},
                    {"header": "priority", "operation": "remove"},
                    {"header": "referer", "operation": "remove"},
                    {"header": "Referer", "operation": "remove"},
                    {"header": "x-requested-with", "operation": "remove"},
                    {"header": "x-caller-platform", "operation": "remove"},
                    {"header": "perseus-session-id", "operation": "remove"},
                    {"header": "perseus-client-id", "operation": "remove"},
                    {"header": "dps-session-id", "operation": "remove"},
                    {"header": "Origin", "operation": "set", "value": "https://www.yemeksepeti.com"},
                    {"header": "User-Agent", "operation": "set", "value": "Android-app-%APP_VERSION%(%BUILD_NUMBER%)"},
                    {"header": "Accept-Encoding", "operation": "set", "value": "gzip, deflate, br"}
                ]
            },
            "condition": {
                "urlFilter": "https://tr.fd-api.com/api/v6/incentives",
                "requestMethods": ["get", "post", "put", "delete"]
            }
        },
        {
            "id": 12,
            "priority": 1,
            "action": {
                "type": "redirect",
                "redirect": {
                    "transform": {
                        "queryTransform": {
                            "addOrReplaceParams": [
                                {"key": "platform", "value": "android_native_app"}
                            ]
                        }
                    }
                }
            },
            "condition": {
                "urlFilter": "https://tr.fd-api.com/api/v6/incentives",
                "resourceTypes": ["xmlhttprequest"]
            }
        },
        {
            "id": 10,
            "priority": 1,
            "action": {
                "type": "modifyHeaders",
                "requestHeaders": [
                    {"header": "user-agent", "operation": "set", "value": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36"},
                    {"header": "sec-ch-ua", "operation": "set", "value": "\"Not:A-Brand\";v=\"99\", \"Google Chrome\";v=\"145\", \"Chromium\";v=\"145\""},
                    {"header": "sec-ch-ua-mobile", "operation": "set", "value": "?0"},
                    {"header": "sec-ch-ua-platform", "operation": "set", "value": "\"Windows\""}
                ]
            },
            "condition": {
                "urlFilter": "||www.yemeksepeti.com/*",
                "requestMethods": ["get"],
                "resourceTypes": ["main_frame", "sub_frame", "xmlhttprequest", "script", "image", "stylesheet", "other"]
            }
        }
    ];
    
    console.log(`âœ… Yerel dynamic rules yÃ¼klendi: ${localDynamicRules.length} kural (uzak sunucu yok)`);
    return localDynamicRules;
}
// Dinamik header'larÄ± ayarla
async function setupDynamicHeaders() {
  
  try {
    // Eski dinamik kurallarÄ± kaldÄ±r
    await clearAllRules(); 
    
    // API'den fallback rules'larÄ± al
    const fallbackRules = await getFallbackDynamicRules();
    
    // Rastgele cihaz bilgileri oluÅŸtur
    const device = generateRandomDevice();
    
    // Extra bilgiler oluÅŸtur
    const extra = generateCleanExtra();
    
    // PX Cookie'leri oluÅŸtur
    const pxCookies = generatePxCookies();
    
    // Web cookie string oluÅŸtur (perseus id'ler ile tutarlÄ±)
    // GERCEK web cookie kavanozunu kullan (indirim/kampanya dhhPerseusGuestId + _px3 +
    // session cookie'lerine gore atfediliyor; uydurma/eksik cookie indirim dusuruyordu).
    let webCookieString = '';
    try {
        const _realCookies = await chrome.cookies.getAll({ domain: 'yemeksepeti.com' });
        if (_realCookies && _realCookies.length) {
            webCookieString = _realCookies.map(c => `${c.name}=${c.value}`).join('; ');
            const _guestCk = _realCookies.find(c => c.name === 'dhhPerseusGuestId');
            const _sessCk  = _realCookies.find(c => c.name === 'dhhPerseusSessionId');
            if (_guestCk && _guestCk.value) extra.perseusClientId = _guestCk.value;
            if (_sessCk && _sessCk.value)   extra.perseusSessionId = _sessCk.value;
            console.log(`🍪 Gercek web cookie kavanozu kullanildi (${_realCookies.length} cookie)`);
        }
    } catch (_ckErr) {
        console.warn('[YS] Gercek cookie okunamadi, generateWebCookies fallback:', _ckErr);
    }
    if (!webCookieString) {
        webCookieString = generateWebCookies(extra.perseusClientId, extra.perseusSessionId);
    }
    
    // kuponmarket ile birebir aynÄ± Ã¼retim deÄŸerleri
    const rSigData = await generateRSig(device.deviceId);
    const pxOriginalToken = generatePxOriginalToken();
    const pxDeviceFpV2 = generatePxDeviceFp();
    const devicePerfClass = generateDevicePerformanceClass();
    const sentryData = generateSentryTraceV2();
    const baggageV2 = generateBaggageV2(sentryData.traceId, extra.appVersion, extra.buildNumber);
    const adjustAdIdV2 = generateUUIDv4();
    
    // Access token'Ä± storage'dan al
    const sessionData = await chrome.storage.sync.get(['yemekhub_session']);
    let accessToken = '';
    
    // EÄŸer session bilgisi ve cookies varsa
    if (sessionData.yemekhub_session && sessionData.yemekhub_session.cookies) {
      // Cookies iÃ§inde access_token'Ä± bul
      const cookies = sessionData.yemekhub_session.cookies;
      for (let i = 0; i < cookies.length; i++) {
        if (cookies[i].name === 'access_token') {
          accessToken = cookies[i].value;
          break;
        }
      }
    }
    
    // cust-code: JWT token'dan user_id parse et
    const custCode = parseCustCodeFromToken(accessToken);
    
    // Template deÄŸerlerini deÄŸiÅŸtirme fonksiyonu - kuponmarket ile birebir aynÄ±
    function replaceTemplateValues(rule) {
        const ruleStr = JSON.stringify(rule);
        const replacedStr = ruleStr
            // Ana deÄŸiÅŸkenler
            .replace(/%ACCESS_TOKEN%/g, accessToken)
            .replace(/%DEVICE_MAKE%/g, device.deviceMake)
            .replace(/%DEVICE_MODEL%/g, device.deviceModel)
            .replace(/%DEVICE_ID%/g, device.deviceId)
            .replace(/%APP_VERSION%/g, extra.appVersion)
            .replace(/%BUILD_NUMBER%/g, extra.buildNumber)
            .replace(/%APP_BUILD%/g, extra.buildNumber)
            
            // PerimeterX deÄŸiÅŸkenleri - kuponmarket ile birebir aynÄ±
            .replace(/%PX_UUID%/g, generateUUIDv4())
            .replace(/%PX_VID%/g, generateUUIDv4())
            .replace(/%PX_DEVICE_FP%/g, pxDeviceFpV2)
            .replace(/%PX_ORIGINAL_TOKEN%/g, pxOriginalToken.replace(/\\/g, '\\\\').replace(/"/g, '\\"'))
            
            // Perseus & DPS deÄŸiÅŸkenleri
            .replace(/%PERSEUS_CLIENT_ID%/g, extra.perseusClientId)
            .replace(/%PERSEUS_SESSION_ID%/g, extra.perseusSessionId)
            .replace(/%DPS_SESSION_ID%/g, extra.dpsSessionId)
            
            // Device profil deÄŸiÅŸkenleri
            .replace(/%PLATFORM_VERSION%/g, device.platformVersion.toString())
            .replace(/%ANDROID_VERSION%/g, (device.platformVersion - 19).toString())
            .replace(/%DEVICE_PERF_CLASS%/g, devicePerfClass)
            
            // cust-code - kuponmarket gibi JWT'den parse
            .replace(/%CUST_CODE%/g, custCode)
            
            // r-sig, rts, ruid, eks - kuponmarket generateRSig ile birebir aynÄ±
            .replace(/%R_SIG_V2%/g, rSigData.signature)
            .replace(/%RTS_V2%/g, rSigData.rts)
            .replace(/%RUID_V2%/g, rSigData.ruid)
            .replace(/%EKS_V2%/g, rSigData.eks)
            
            // Sentry & Baggage - kuponmarket ile birebir aynÄ±
            .replace(/%SENTRY_TRACE%/g, sentryData.sentryTrace)
            .replace(/%BAGGAGE_V2%/g, baggageV2.replace(/\\/g, '\\\\').replace(/"/g, '\\"'))
            
            // Adjust
            .replace(/%ADJUST_AD_ID%/g, adjustAdIdV2)
            
            // Eski placeholder'lar (diÄŸer kurallar iÃ§in)
            .replace(/%EKS%/g, extra.eks)
            .replace(/%R_SIG%/g, extra.rSig)
            .replace(/%EM_REQUEST_ID%/g, extra.emRequestId)
            .replace(/%RTS%/g, extra.timestamp)
            .replace(/%RUID%/g, extra.requestId)
            .replace(/%TIMESTAMP%/g, Date.now().toString())
            .replace(/%PX_AUTHORIZATION%/g, '4')
            
            // Web Cookie string
            .replace(/%WEB_COOKIES%/g, webCookieString.replace(/\\/g, '\\\\').replace(/"/g, '\\"'));
        
        return JSON.parse(replacedStr);
    }
    
    // API'den gelen rules'larÄ± template deÄŸerleriyle deÄŸiÅŸtir
    const processedRules = fallbackRules.map(rule => replaceTemplateValues(rule));
    
    console.log(`ğŸ”§ ${processedRules.length} dynamic rule iÅŸleniyor...`);
    
    // Processed rules'larÄ± uygula
    await chrome.declarativeNetRequest.updateDynamicRules({
        addRules: processedRules
    });
    
    console.log(`âœ… ${processedRules.length} dynamic rule baÅŸarÄ±yla uygulandÄ± (API'den alÄ±ndÄ±)`);
    
  } catch (error) {
    console.error('Dinamik header\'lar ayarlanÄ±rken hata:', error);
  }
}

// btoa fonksiyonu
function btoa(str) {
  try {
    return window.btoa(str);
  } catch(e) {
    // Fallback for non-window environments
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    let result = '';
    let i = 0;
    
    while (i < str.length) {
      const a = str.charCodeAt(i++);
      const b = i < str.length ? str.charCodeAt(i++) : 0;
      const c = i < str.length ? str.charCodeAt(i++) : 0;
      
      const bitmap = (a << 16) | (b << 8) | c;
      
      result += chars.charAt((bitmap >> 18) & 63);
      result += chars.charAt((bitmap >> 12) & 63);
      result += i - 2 < str.length ? chars.charAt((bitmap >> 6) & 63) : '=';
      result += i - 1 < str.length ? chars.charAt(bitmap & 63) : '=';
    }
    
    return result;
  }
}

// ğŸ›¡ï¸ GÃœVENLÄ° MESAJ DÄ°NLEYÄ°CÄ°SÄ° - SADECE YEMEKSEPETÄ°
function ytTrendyolOnOrionIos() {
  try {
    const ua = navigator.userAgent || '';
    return /Orion/i.test(ua) && /iPhone|iPad|iPod|iOS/i.test(ua);
  } catch (_) {
    return false;
  }
}

const TGO_LOGIN_ORIGINS = [
  'https://tgoyemek.com',
  'https://www.tgoyemek.com',
  'https://trendyol.com',
  'https://www.trendyol.com',
  'https://api.tgoapis.com',
  'https://tgoapps.com',
  'https://www.tgoapps.com',
  'https://payment.tgoapps.com'
];

function ytIsTrendyolCookieDomain(domain) {
  const host = String(domain || '').replace(/^\./, '').toLowerCase();
  return ['tgoyemek.com', 'trendyol.com', 'tgoapis.com', 'tgoapps.com'].some(function (marker) {
    return host === marker || host.endsWith('.' + marker);
  });
}

async function clearTrendyolLoginData() {
  const ios = ytTrendyolOnOrionIos();
  const dataTypes = ios
    ? { cookies: true, localStorage: true, indexedDB: true }
    : { cache: true, cookies: true, localStorage: true, indexedDB: true, cacheStorage: true, serviceWorkers: true };
  try {
    if (chrome.browsingData && chrome.browsingData.remove) {
      await chrome.browsingData.remove({ origins: TGO_LOGIN_ORIGINS }, dataTypes);
    }
  } catch (error) {
    console.warn('[TGO] site hafizasi temizlenemedi', error);
  }
  try {
    const cookies = await chrome.cookies.getAll({});
    await Promise.all((cookies || []).filter(function (cookie) {
      return ytIsTrendyolCookieDomain(cookie.domain);
    }).map(function (cookie) {
      const host = String(cookie.domain || '').replace(/^\./, '');
      const protocol = cookie.secure ? 'https' : 'http';
      return chrome.cookies.remove({
        url: protocol + '://' + host + (cookie.path || '/'),
        name: cookie.name
      }).catch(function () { return null; });
    }));
  } catch (error) {
    console.warn('[TGO] cerez temizlenemedi', error);
  }
}

chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
  if (message.action === 'tgoPrepareIosCart' || message.action === 'tgoAdaptIosCart') {
    (async () => {
      try {
        if (message.action === 'tgoPrepareIosCart') {
          if (typeof installIosCouponReadRules === 'function') {
            await installIosCouponReadRules();
          }
          sendResponse(await prepareIosTyCart(message));
          return;
        }
        sendResponse(await adaptIosTyCart(message));
      } catch (error) {
        sendResponse({ ok: false, error: error.message || 'ios coupon failed' });
      }
    })();
    return true;
  }

  if (message.action === 'tgoClearLoginData') {
    clearTrendyolLoginData().then(function () {
      sendResponse({ success: true });
    }).catch(function (error) {
      sendResponse({ success: false, error: error.message });
    });
    return true;
  }

  if (message.action === 'tgoSetupCouponRules') {
    (async () => {
      try {
        if (typeof setupTrendyolMobileHeaders === 'function') {
          await setupTrendyolMobileHeaders(message.accessToken || '');
        }
        sendResponse({ success: true });
      } catch (error) {
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  }

  if (message.action === 'tyProxyRequest' || message.action === 'tyCartItemsRequest' || message.action === 'tgoPaymentPricePreview' || message.action === 'dhGetTgoWebToken' || message.action === 'ksGetTgoWebToken') {
    (async () => {
      try {
        if (message.action === 'tyProxyRequest' && typeof handleTyProxyRequest === 'function') {
          handleTyProxyRequest(message, sendResponse);
          return;
        }
        if (message.action === 'tyCartItemsRequest' && typeof handleTyCartItemsRequest === 'function') {
          handleTyCartItemsRequest(message, sendResponse);
          return;
        }
        if (message.action === 'tgoPaymentPricePreview' && typeof executeTgoPaymentPricePreview === 'function') {
          sendResponse(await executeTgoPaymentPricePreview(sender && sender.tab && sender.tab.id));
          return;
        }
        if ((message.action === 'dhGetTgoWebToken' || message.action === 'ksGetTgoWebToken') && typeof getTrendyolWebToken === 'function') {
          const tok = await getTrendyolWebToken();
          sendResponse({ success: !!tok, token: tok || '' });
          return;
        }
        sendResponse({ success: false, error: 'trendyol proxy hazir degil' });
      } catch (error) {
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  }

  if (message.action === 'tgoInstallAddressRules') {
    (async () => {
      try {
        await installTgoApiHeaderRules();
        sendResponse({ success: true });
      } catch (error) {
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  }

if (message.action === 'tgoUpdatePersonName') {
    (async () => {
      try {
        const stor = await chrome.storage.local.get(['tyMobileToken', 'tgoWebToken', 'trendyolWebToken']);
        const tokens = []
          .concat(message.mobileToken || [])
          .concat(message.webToken || [])
          .concat(message.tokens || [])
          .concat([stor.tyMobileToken, stor.tgoWebToken, stor.trendyolWebToken]);
        const result = await applyTypedTrendyolName(tokens, message.firstName, message.lastName);
        sendResponse(result);
      } catch (error) {
        sendResponse({ ok: false, updated: false, error: error.message });
      }
    })();
    return true;
  }

  if (message.action === 'tgoApplyAddress') {
    (async () => {
      try {
        const result = await tgoApplyStoredAddress(message.address || {}, message.webToken || '', message.accountPhone || null);
        sendResponse(result);
      } catch (error) {
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  }

  console.log('ğŸ“¨ Background: Mesaj alÄ±ndÄ±:', message.action || message.type);
  console.log('ğŸ“¨ Sender:', sender);
  
  // ğŸš€ WEB SÄ°TESÄ°NDEN OTOMATÄ°K GÄ°RÄ°Å ( SÄ°STEMÄ° GÄ°BÄ° - YENÄ°)
  if (message.action === 'openLoginPageWithToken' && message.token) {
    console.log('ğŸš€ Background: Web sitesinden giriÅŸ isteÄŸi alÄ±ndÄ±!');
    console.log('ğŸ“ Background: Token:', message.token.substring(0, 10) + '...');
    console.log('ğŸ“¨ Background: Sender:', sender);
    
    // Login sayfasÄ±nÄ± token ile aÃ§
    const loginUrl = chrome.runtime.getURL('pages/login.html') + '?token=' + encodeURIComponent(message.token);
    console.log('ğŸ”— Background: Login URL:', loginUrl);
    
    chrome.tabs.create({
      url: loginUrl,
      active: true
    }, function(tab) {
      console.log('âœ… Background: Login sayfasÄ± aÃ§Ä±ldÄ±, tab ID:', tab.id);
      sendResponse({ 
        success: true, 
        tabId: tab.id 
      });
    });
    
    return true; // Asenkron yanÄ±t iÃ§in
  }
  
  // ğŸš€ WEB SÄ°TESÄ°NDEN OTOMATÄ°K GÄ°RÄ°Å (Externally Connectable - ESKÄ°)
  if (message.type === 'OPEN_LOGIN_WITH_TOKEN' && message.token) {
    console.log('ğŸš€ Background: Web sitesinden giriÅŸ isteÄŸi (eski), token:', message.token.substring(0, 10) + '...');
    
    // Extension ID'yi gÃ¶nder
    sendResponse({ 
      success: true, 
      extensionId: chrome.runtime.id 
    });
    
    // Login sayfasÄ±nÄ± token ile aÃ§
    const loginUrl = chrome.runtime.getURL('pages/login.html') + '?token=' + encodeURIComponent(message.token);
    chrome.tabs.create({
      url: loginUrl,
      active: true
    }, function(tab) {
      console.log('âœ… Login sayfasÄ± token ile aÃ§Ä±ldÄ±, tab ID:', tab.id);
    });
    
    return true;
  }
  
  // UBER: Proxy isteÄŸi
  if (message.action === 'uberProxyRequest') {
    handleUberProxyRequest(message, sendResponse);
    return true;
  }

  // UBER: Session yÃ¼kleme
  if (message.action === 'loadUberSession') {
    const tabId = sender.tab?.id;
    (async () => {
      try {
        const sessionData = message.sessionData;
        if (!sessionData || !sessionData.cookiesArray || !Array.isArray(sessionData.cookiesArray)) {
          sendResponse({ success: false, error: 'GeÃ§ersiz session verisi' });
          return;
        }
        const gender = message.gender || sessionData.gender || null;
        const startLink = message.startLink || sessionData.startLink || '';
        await handleUberLogin(sessionData.cookiesArray, message.token || '', tabId, gender, startLink);
        sendResponse({ success: true });
      } catch (error) {
        console.error('[Uber] loadUberSession hatasÄ±:', error);
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  }

  if (message.action === 'startMigrosTokenProcess') {
    (async () => {
      try {
        const token = kmNormalizeMigrosToken(message.token);
        let address = message.address || null;
        if (!address) {
          const stored = await chrome.storage.local.get(['migros_pending_address', 'addresses']);
          address = stored.migros_pending_address || (stored.addresses && stored.addresses[0]) || null;
        }
        const result = await kmStartMigrosLogin(token, address);
        sendResponse(result);
      } catch (e) {
        sendResponse({ success: false, error: e.message });
      }
    })();
    return true;
  }

  if (message.action === 'PROXY_REQUEST') {
    kmHandleProxyRequest(message.data || message).then(sendResponse);
    return true;
  }

  if (message.action === 'GET_BLOCKED_PATHS') {
    kmGetBlockedPathsForContent().then(sendResponse);
    return true;
  }

  // UBER: Token ile giriÅŸ sÃ¼reci
  if (message.action === 'startUberTokenProcess') {
    const tabId = sender.tab?.id || message.tabId;
    (async () => {
      try {
        const token = message.token;
        if (!token || !token.startsWith('uber-')) {
          sendResponse({ success: false, error: 'GeÃ§ersiz Uber token' });
          return;
        }
        console.log('[Uber] Token iÅŸlemi baÅŸlatÄ±lÄ±yor:', token.substring(0, 12) + '...');
        const cleanToken = token.startsWith('uber-') ? token.substring(5) : token;
        const response = await fetch(`https://kuponmarket.net/km-uber-cookie.php?token=${encodeURIComponent(cleanToken)}`);
        const data = await response.json();

        const cookiesOk = data && Array.isArray(data.cookiesArray) && data.cookiesArray.length > 0;
        if (cookiesOk && data.error !== true && data.success !== false) {
          const gender = data.gender || null;
          const startLink = data.startLink || '';
          await handleUberLogin(data.cookiesArray, token, tabId, gender, startLink);
          sendResponse({ success: true });
        } else {
          const errMsg = (typeof data?.message === 'string' && data.message.trim())
            || (typeof data?.error === 'string' && data.error.trim())
            || (typeof data?.msg === 'string' && data.msg.trim())
            || 'Geçersiz token veya eşleşen oturum bulunamadı';
          sendResponse({ success: false, error: errMsg });
        }
      } catch (error) {
        console.error('[Uber] Token iÅŸlemi hatasÄ±:', error);
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  }

  // UBER: Fingerprint cookie set etme
  if (message.action === 'setUberFingerprintCookie' && message.value) {
    chrome.cookies.set({
      url: 'https://www.uber.com',
      name: 'udi-fingerprint',
      value: message.value,
      domain: '.uber.com',
      path: '/',
      secure: true,
      httpOnly: false,
      sameSite: 'no_restriction',
      expirationDate: Math.floor(Date.now() / 1000) + 31536000
    }).then(() => sendResponse({ success: true }))
      .catch(e => sendResponse({ success: false, error: e.message }));
    return true;
  }

  // ğŸš€ LARAVEL SÄ°TESÄ°NDEN OTOMATÄ°K GÄ°RÄ°Å Ä°STEÄÄ° (Eski sistem - fallback)
  if (message.action === 'openLoginPage') {
    console.log('ğŸš€ Background: Login sayfasÄ± aÃ§Ä±lÄ±yor, token:', message.token);
    
    // Login sayfasÄ±nÄ± yeni sekmede aÃ§
    chrome.tabs.create({
      url: chrome.runtime.getURL('pages/login.html'),
      active: true
    }, function(tab) {
      console.log('âœ… Login sayfasÄ± aÃ§Ä±ldÄ±, tab ID:', tab.id);
      sendResponse({ success: true, tabId: tab.id });
    });
    
    return true; // Asenkron yanÄ±t iÃ§in
  }
  
  // ğŸª POPUP'TAN COOKIE EKLEME Ä°STEÄÄ° (Ã–NCELÄ°KLÄ°!)
  if (message.action === 'addCookiesFromPopup') {
    console.log('ğŸª Background: Popup\'tan cookie ekleme isteÄŸi alÄ±ndÄ±:', message.cookies?.length, 'adet');
    console.log('ğŸ“‹ Gelen cookie isimleri:', message.cookies?.map(c => c.name).join(', '));
    
    // Asenkron iÅŸlemi handle et
    (async () => {
      try {
        console.log('ğŸ”„ Background: addCookiesFromContentScript() Ã§aÄŸrÄ±lÄ±yor...');
        const result = await addCookiesFromContentScript(message.cookies);
        console.log('âœ… Background: addCookiesFromContentScript() sonucu:', result);
        
        if (!result) {
          console.error('âŒ UYARI: addCookiesFromContentScript() null dÃ¶ndÃ¼rdÃ¼!');
          sendResponse({ 
            success: false, 
            error: 'addCookiesFromContentScript returned null',
            successCount: 0,
            failCount: message.cookies?.length || 0,
            total: message.cookies?.length || 0
          });
        } else {
          console.log('ğŸ“¤ Background: sendResponse() Ã§aÄŸrÄ±lÄ±yor:', result);
          sendResponse(result);
        }
      } catch (error) {
        console.error('âŒ Background: Cookie ekleme exception:', error);
        console.error('âŒ Stack trace:', error.stack);
        sendResponse({ 
          success: false, 
          error: error.message,
          successCount: 0,
          failCount: message.cookies?.length || 0,
          total: message.cookies?.length || 0
        });
      }
    })();
    
    return true; // Asenkron yanÄ±t iÃ§in MUTLAKA gerekli
  }
  
  // YS Proxy isteÄŸi
  if (message.action === 'ysProxyRequest') {
    handleYsProxyRequest(message, sendResponse);
    return true;
  }

  if (message.action === 'syncYsSessionToServer') {
    (async () => {
      try {
        const result = message.waitForYs
          ? await syncYsSessionAfterLogin(message.token, message.integrity, message.waitForYsMs)
          : await syncYsSessionToKuponmarket(message.token, message.integrity, message.source || 'extension-message');
        sendResponse(result);
      } catch (e) {
        sendResponse({ ok: false, error: e.message || String(e) });
      }
    })();
    return true;
  }

  if (message.action === 'scheduleYsSessionSync') {
    scheduleYsSessionSync(message.token, message.integrity, message.source, message.delayMs);
    sendResponse({ ok: true });
    return true;
  }

  if (message.action === 'fetchYemeksepetiLoginData') {
    const url = message.url;
    const headers = Object.assign({ Accept: 'application/json' }, message.headers || {});
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 300000);
    fetch(url, { method: 'GET', headers, cache: 'no-store', signal: controller.signal })
      .then(async (res) => {
        clearTimeout(timer);
        const text = await res.text();
        let data = null;
        try {
          data = text ? JSON.parse(text) : null;
        } catch (e) {
          data = null;
        }
        sendResponse({
          ok: res.ok || res.status === 422,
          status: res.status,
          statusText: res.statusText,
          data,
          raw: data ? undefined : text.slice(0, 500)
        });
      })
      .catch((err) => {
        clearTimeout(timer);
        const msg = err && err.name === 'AbortError'
          ? 'Sunucu yanıt vermedi. Lütfen tekrar deneyin.'
          : 'Sunucu ile bağlantı kurulamadı.';
        sendResponse({ ok: false, status: 0, error: msg, data: null });
      });
    return true;
  }

  // Sunucuya ÅŸifreli veri gÃ¶nderme
  if (message.action === 'sendToServer') {
    chrome.storage.sync.get(['yemekhub_session'], (result) => {
      const mrdToken = (result.yemekhub_session && result.yemekhub_session.token) || '';
      fetch(message.serverUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          payload: message.encryptedPayload,
          mrdToken: mrdToken
        })
      }).then(r => r.json()).then(data => {
        console.log('Background: Sunucu yanÄ±tÄ±:', data);
        sendResponse({ success: true, data: data });
      }).catch(err => {
        console.error('Background: Sunucu hatasÄ±:', err);
        sendResponse({ success: false, error: err.message });
      });
    });
    return true;
  }
  
  // ğŸ›¡ï¸ GÃœVENLÄ° Chrome Settings Temizleme
  if (message.action === 'clearYemeksepetiLikeChromeSettings') {
    console.log('ğŸ›¡ï¸ GÃ¼venli Yemeksepeti temizleme baÅŸlatÄ±lÄ±yor...');
    console.log('â³ Temizleme 5 domain Ã— 300ms beklemeli temizlik yapacak = ~2-3 saniye');
    
    clearYemeksepetiLikeChromeSettings()
      .then(success => {
        console.log(`ğŸ›¡ï¸ GÃ¼venli temizleme TAMAMEN tamamlandÄ±: ${success}`);
        console.log('âœ… ArtÄ±k cookie ekleme gÃ¼venle yapÄ±labilir');
        sendResponse({ success: success });
      })
      .catch(error => {
        console.error('ğŸ›¡ï¸ GÃ¼venli temizleme hatasÄ±:', error);
        sendResponse({ success: false, error: error.message });
      });
    return true; // Asenkron yanÄ±t iÃ§in
  }
  
  // Backward compatibility - eski mesajlar da gÃ¼venli fonksiyonu kullanacak
  if (message.action === 'clearYemeksepetiCompletely' || message.action === 'clearSiteData') {
    console.log('ğŸ›¡ï¸ GÃ¼venli Yemeksepeti temizleme baÅŸlatÄ±lÄ±yor (backward compatibility)...');
    clearYemeksepetiLikeChromeSettings()
      .then(success => {
        sendResponse({ success: success });
      })
      .catch(error => {
        console.error('ğŸ›¡ï¸ GÃ¼venli temizleme hatasÄ±:', error);
        sendResponse({ success: false, error: error.message });
      });
    return true; // Asenkron yanÄ±t iÃ§in
  }
  
  // Adres verilerini storage'a kaydetme iÅŸleyicisi
  if (message.action === 'storeAddressesInStorage') {
    console.log("storeAddressesInStorage mesajÄ± alÄ±ndÄ±");
    
    try {
      // Gelen adresleri al
      const yeniAdresler = message.addresses;
      
      if (!Array.isArray(yeniAdresler)) {
          console.error("GeÃ§ersiz adres verisi, dizi deÄŸil:", yeniAdresler);
          sendResponse({ success: false, error: "GeÃ§ersiz adres verisi" });
          return true;
      }
      
      // Mevcut adresleri chrome.storage.local'den oku
      chrome.storage.local.get(['yemekhub_addresses'], function(result) {
          let adreslerData = result.yemekhub_addresses || [];
          console.log("Mevcut adres sayÄ±sÄ±:", adreslerData.length);
          
          // Yeni adresleri ekle
          adreslerData = adreslerData.concat(yeniAdresler);
          
          // Adresleri JSON formatÄ±nda bir string'e Ã§evir
          const jsonData = JSON.stringify(adreslerData, null, 2);
          
          // Adresleri storage'a kaydet
          chrome.storage.local.set({ 
              'yemekhub_addresses': adreslerData,
              'yemekhub_addresses_json': jsonData  // String olarak da saklayalÄ±m
          }, function() {
              if (chrome.runtime.lastError) {
                  console.error("Storage kaydetme hatasÄ±:", chrome.runtime.lastError);
                  sendResponse({ success: false, error: chrome.runtime.lastError.message });
              } else {
                  console.log("Adresler baÅŸarÄ±yla kaydedildi. Toplam:", adreslerData.length);
                  
                  // Dosya indirme iÅŸlemi
                  const blob = new Blob([jsonData], { type: 'application/json' });
                  const url = URL.createObjectURL(blob);
                  
                  chrome.downloads.download({
                      url: url,
                      filename: 'adresler.json',
                      saveAs: true
                  }, function(downloadId) {
                      URL.revokeObjectURL(url);
                      
                      if (chrome.runtime.lastError) {
                          console.error("Ä°ndirme hatasÄ±:", chrome.runtime.lastError);
                          sendResponse({ success: false, error: chrome.runtime.lastError.message });
                      } else {
                          // BaÅŸarÄ± bilgisini geri gÃ¶nder
                          sendResponse({ success: true });
                      }
                  });
              }
          });
      });
      
      return true; // asenkron cevap iÃ§in gerekli
    } catch (error) {
      console.error("Adres storage hatasÄ±:", error);
      sendResponse({ success: false, error: error.message });
      return true;
    }
  }
  
  // ğŸª CONTENT SCRIPT'TEN COOKIE EKLEME Ä°STEÄÄ° (FALLBACK)
  if (message.action === 'addCookiesFromContentScript') {
    console.log('ğŸª Background: Content script\'ten cookie ekleme isteÄŸi alÄ±ndÄ± (fallback)');
    addCookiesFromContentScript(message.cookies)
      .then(result => {
        console.log('ğŸª Background: Cookie ekleme sonucu:', result);
        sendResponse(result);
      })
      .catch(error => {
        console.error('ğŸª Background: Cookie ekleme hatasÄ±:', error);
        sendResponse({ success: false, error: error.message });
      });
    return true; // Asenkron yanÄ±t iÃ§in
  }
  
  // Token deÄŸiÅŸtirme mesajÄ±
  if (message.action === 'changeTokenAndOpenManager') {
    // Ã–nce mevcut yemeksepeti sekmelerini bul
    chrome.tabs.query({url: '*://*.yemeksepeti.com/*'}, function(tabs) {
      // Yemeksepeti sekmeleri iÃ§in Ã§erezleri temizle
      tabs.forEach(function(tab) {
        chrome.cookies.getAll({ url: tab.url }, function(cookies) {
          for (var i = 0; i < cookies.length; i++) {
            chrome.cookies.remove({
              url: tab.url + cookies[i].path,
              name: cookies[i].name
            });
          }
        });
      });
      
      // EÄŸer en az bir yemeksepeti sekmesi varsa, ilkini token yÃ¶neticisine yÃ¶nlendir
      if (tabs.length > 0) {
        chrome.tabs.update(tabs[0].id, {
          url: chrome.runtime.getURL('pages/login.html#token-manager')
        });
        
        // DiÄŸer yemeksepeti sekmelerini kapat
        for (let i = 1; i < tabs.length; i++) {
          chrome.tabs.remove(tabs[i].id);
        }
      } else {
        // Yemeksepeti sekmesi yoksa yeni bir sekme aÃ§
        chrome.tabs.create({
          url: chrome.runtime.getURL('pages/login.html?autoOpenTokenManager=true')
        });
      }
    });
    
    sendResponse({ success: true });
    return true; // asenkron yanÄ±t iÃ§in gerekli
  }
  
  if (message.action === 'runDynamicHeaders') {
    (async () => {
      try {
        await setupDynamicHeaders();
        await setupBlockingDynamicHeaders();
        console.log('Dinamik headerlar baÅŸarÄ±yla ayarlandÄ±.');
        sendResponse({ success: true });
      } catch (error) {
        console.error('âŒ Dinamik header kurulum hatasÄ±:', error);
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true; // asenkron cevap iÃ§in gerekli
  }
  
  // DiÄŸer mevcut mesaj iÅŸleyicileri
  if (message.action === 'closeYemeksepetiTabs') {
    chrome.tabs.query({}, function (tabs) {
      tabs.forEach(function (tab) {
        if (tab.url && tab.url.includes('yemeksepeti.com')) {
          // Cookie'leri de temizle
          chrome.cookies.getAll({ url: tab.url }, function (cookies) {
            for (var i = 0; i < cookies.length; i++) {
              chrome.cookies.remove({
                url: tab.url + cookies[i].path,
                name: cookies[i].name
              });
            }
          });
          chrome.tabs.remove(tab.id);
        }
      });
    });
    sendResponse({ success: true });
    return true;
  }

  if (message.action === 'closeTrendyolTabs') {
    clearTrendyolLoginData().catch(function () {});
    chrome.storage.local.remove(['tyMobileToken', 'tyDevice', 'tyPhone', 'tgoPendingAddress', 'tgoPendingAddressLock', 'tyAddressPayload']);
    chrome.tabs.query({}, function (tabs) {
      tabs.forEach(function (tab) {
        if (tab.url && tab.url.includes('tgoyemek.com')) {
          chrome.tabs.remove(tab.id);
        }
      });
    });
    sendResponse({ success: true });
    return true;
  }
});

// ============================================
// ğŸª COOKIE MANAGEMENT MODULE ( mantÄ±ÄŸÄ±yla geliÅŸtirilmiÅŸ)
// ============================================
class CookieManager {
    /**
     * Debug: Mevcut cookie'leri listele
     */
    static async debugListCookies() {
        try {
            const cookies = await chrome.cookies.getAll({ domain: 'yemeksepeti.com' });
            console.log('ğŸ” DEBUG: Mevcut Yemeksepeti cookie\'leri:', cookies.length, 'adet');
            cookies.forEach(c => {
                console.log(`  - ${c.name}: ${c.value.substring(0, 20)}... (domain: ${c.domain}, secure: ${c.secure})`);
            });
            return cookies;
        } catch (error) {
            console.error('ğŸ” DEBUG: Cookie listesi alÄ±namadÄ±:', error);
            return [];
        }
    }
    

    /**
     * Platform cookie'lerini temizler (yemeksepeti.com ve ilgili domainler)
     */
    static async clearYemeksepetiCookies() {
        const yemeksepetiDomains = [
            'yemeksepeti.com',
            'fd-api.com',
            'deliveryhero.com'
        ];
        
        const origins = yemeksepetiDomains.map(domain => `https://${domain}`);
        
        try {
            // 1. Browsing data temizleme
            await chrome.browsingData.remove({
                origins: origins
            }, {
                cookies: true,
                localStorage: true,
                indexedDB: true,
                cacheStorage: true,
                serviceWorkers: true
            });
            
            // 2. TÃ¼m cookie'leri al ve yemeksepeti ile ilgili olanlarÄ± sil
            const allCookies = await chrome.cookies.getAll({});
            const removePromises = [];
            
            for (const cookie of allCookies) {
                const cookieDomain = cookie.domain.startsWith('.')
                    ? cookie.domain.substring(1)
                    : cookie.domain;
                
                const shouldRemove = yemeksepetiDomains.some(pattern =>
                    cookieDomain === pattern ||
                    cookieDomain.endsWith('.' + pattern)
                );
                
                if (shouldRemove) {
                    const protocol = cookie.secure ? 'https' : 'http';
                    const host = cookie.domain.startsWith('.')
                        ? cookie.domain.substring(1)
                        : cookie.domain;
                    const url = `${protocol}://${host}${cookie.path}`;
                    
                    removePromises.push(
                        chrome.cookies.remove({
                            url: url,
                            name: cookie.name
                        }).catch(() => null) // Silent fail
                    );
                }
            }
            
            await Promise.allSettled(removePromises);
            console.log('âœ… Yemeksepeti cookie\'leri temizlendi');
            return true;
        } catch (error) {
            console.error('âŒ Cookie temizleme hatasÄ±:', error);
            return false;
        }
    }
    
    /**
     * Cookie'leri paralel olarak set eder ( mantÄ±ÄŸÄ±)
     */
    static async setPlatformCookies(cookies, platformDomain = '.yemeksepeti.com') {
        console.log('ğŸª CookieManager: Cookie ekleme baÅŸlÄ±yor...', cookies.length, 'adet');
        console.log('ğŸ” DEBUG: Gelen cookie\'ler:', cookies.map(c => ({ 
            name: c.name, 
            domain: c.domain, 
            expiry: c.expiry, 
            secure: c.secure,
            value_length: c.value?.length 
        })));
        
        // NOT: Temizleme iÅŸlemi popup.js'te performPreCleanup() ile ZATEN YAPILDI
        // Burada tekrar temizleme yapmÄ±yoruz, sadece cookie ekliyoruz
        
        const nowInSeconds = Math.floor(Date.now() / 1000);
        console.log('ğŸ” DEBUG: Åu anki zaman (saniye):', nowInSeconds);
        
        // TÃ¼m cookie'leri paralel olarak set et
        const cookiePromises = cookies.map(async (cookie) => {
            try {
                // SameSite mapping (Backend "None" gÃ¶nderir, Chrome "no_restriction" bekler)
                let sameSite = 'no_restriction';
                if (cookie.sameSite) {
                    const sameSiteMap = {
                        'None': 'no_restriction',
                        'Lax': 'lax',
                        'Strict': 'strict',
                        'Unspecified': 'unspecified'
                    };
                    sameSite = sameSiteMap[cookie.sameSite] || 'no_restriction';
                }
                
                const domain = cookie.domain || platformDomain;
                const path = cookie.path || '/';
                const domainForUrl = domain.startsWith('.') ? domain.substring(1) : domain;
                const cookieUrl = `https://${domainForUrl}${path}`;
                
            const cookieData = {
                url: cookieUrl,
                name: cookie.name,
                value: String(cookie.value),
                domain: domain,
                path: path,
                secure: true, // âš¡ HTTPS iÃ§in zorunlu (sunucudan false gelse bile true yapÄ±yoruz)
                httpOnly: cookie.httpOnly !== false,
                sameSite: sameSite
            };
            
            // Expiration date kontrolÃ¼ ( mantÄ±ÄŸÄ± + Session desteÄŸi)
            if (cookie.expirationDate && typeof cookie.expirationDate === 'number' && cookie.expirationDate > 0) {
                cookieData.expirationDate = cookie.expirationDate < nowInSeconds
                    ? nowInSeconds + (365 * 24 * 60 * 60)  // SÃ¼resi geÃ§miÅŸse 1 yÄ±l ekle
                    : cookie.expirationDate;
            } else if (cookie.expires && typeof cookie.expires === 'number' && cookie.expires > 0 && cookie.expires !== -1) {
                cookieData.expirationDate = cookie.expires < nowInSeconds
                    ? nowInSeconds + (365 * 24 * 60 * 60)
                    : cookie.expires;
            } else if (cookie.expiry && typeof cookie.expiry === 'number' && cookie.expiry > 0) {
                cookieData.expirationDate = cookie.expiry < nowInSeconds
                    ? nowInSeconds + (365 * 24 * 60 * 60)
                    : cookie.expiry;
            } else if (cookie.expiry === 'Session' || cookie.expiry === 'session' || !cookie.expiry) {
                // Session cookie - 1 saat Ã¶mÃ¼r ver
                cookieData.expirationDate = nowInSeconds + (60 * 60);
            } else {
                // Fallback: 1 saat
                cookieData.expirationDate = nowInSeconds + (60 * 60);
            }
                
                if (cookie.domain && !cookie.domain.includes('yemeksepeti.com') && !cookie.domain.includes('tgoyemek.com')) {
                    try {
                        cookieData.partitionKey = {
                            topLevelSite: 'https://www.yemeksepeti.com'
                        };
                    } catch (e) {
                        // Partitioned cookies desteklenmiyorsa sessizce geÃ§
                    }
                }
                
                const result = await this.setCookie(cookieData);
                if (!result) {
                    console.error('[CookieManager] âŒ Cookie eklenemedi:', {
                        name: cookie.name,
                        domain: domain,
                        url: cookieUrl,
                        expiry: cookie.expiry,
                        secure: cookieData.secure,
                        sameSite: cookieData.sameSite
                    });
                } else {
                    console.log('[CookieManager] âœ… Cookie eklendi:', cookie.name, 'â†’', domain);
                }
                return {
                    name: cookie.name,
                    success: result,
                    error: result ? null : 'Failed to set cookie'
                };
            } catch (error) {
                console.error('[CookieManager] Cookie ekleme hatasÄ±:', cookie.name, error);
                return {
                    name: cookie.name,
                    success: false,
                    error: error.message
                };
            }
        });
        
        // TÃ¼m promise'leri bekle (paralel iÅŸleme)
        const results = await Promise.allSettled(cookiePromises);
        
        // SonuÃ§larÄ± iÅŸle
        const processedResults = results.map(r => r.status === 'fulfilled' ? r.value : { success: false });
        const successCount = processedResults.filter(r => r.success).length;
        const failedCount = processedResults.filter(r => !r.success).length;
        
        console.log(`ğŸ“Š CookieManager: Cookie ekleme tamamlandÄ± - BaÅŸarÄ±lÄ±: ${successCount}, BaÅŸarÄ±sÄ±z: ${failedCount}`);
        
        return {
            success: successCount > 0,
            total: cookies.length,
            successful: successCount,
            failed: failedCount,
            results: processedResults
        };
    }
    
    /**
     * Tek bir cookie'yi set eder (Promise wrapper)
     */
    static async setCookie(cookieData) {
        return new Promise((resolve) => {
            console.log(`ğŸ” DEBUG: chrome.cookies.set() Ã§aÄŸrÄ±lÄ±yor:`, {
                name: cookieData.name,
                url: cookieData.url,
                domain: cookieData.domain,
                secure: cookieData.secure,
                sameSite: cookieData.sameSite,
                expirationDate: cookieData.expirationDate
            });
            
            chrome.cookies.set(cookieData, (cookie) => {
                if (chrome.runtime.lastError) {
                    console.error(`âŒ CookieManager: Chrome API hatasÄ±:`, {
                        cookieName: cookieData.name,
                        error: chrome.runtime.lastError.message,
                        url: cookieData.url,
                        domain: cookieData.domain,
                        cookieData: cookieData // TAM DETAY
                    });
                    resolve(false);
                } else if (!cookie) {
                    console.error(`âŒ CookieManager: Cookie set edildi ama dÃ¶nen deÄŸer null:`, {
                        name: cookieData.name,
                        cookieData: cookieData
                    });
                    resolve(false);
                } else {
                    console.log(`âœ… CookieManager: chrome.cookies.set() BAÅARILI:`, cookie.name);
                    resolve(true);
                }
            });
        });
    }
}

// ğŸª COOKIE EKLEME FONKSÄ°YONU - CONTENT SCRIPT Ä°Ã‡Ä°N (CHROME 131+ UYUMLU)
// Yeni CookieManager kullanarak geliÅŸtirilmiÅŸ versiyon
async function addCookiesFromContentScript(cookies) {
    console.log('ğŸª Background: Cookie ekleme isteÄŸi alÄ±ndÄ±:', cookies.length, 'adet');
    console.log('ğŸ“‹ Cookie listesi:', cookies.map(c => c.name).join(', '));
    
    try {
        // Yeni CookieManager'Ä± kullan
        const result = await CookieManager.setPlatformCookies(cookies);
        
        console.log(`ğŸ“Š Background: Cookie iÅŸlemi tamamlandÄ± - ${result.successful}/${result.total} baÅŸarÄ±lÄ±`);
        
        if (result.failed > 0) {
            console.warn(`âš ï¸ ${result.failed} cookie eklenemedi. Detaylar:`, 
                result.results.filter(r => !r.success).map(r => ({ name: r.name, error: r.error }))
            );
        }
        
        return {
            success: result.success,
            successCount: result.successful,
            failCount: result.failed,
            total: result.total
        };
    } catch (error) {
        console.error('âŒ Background: Cookie ekleme genel hatasÄ±:', error);
        console.error('âŒ Hata detaylarÄ±:', {
            message: error.message,
            stack: error.stack,
            cookieCount: cookies.length
        });
        return {
            success: false,
            successCount: 0,
            failCount: cookies.length,
            total: cookies.length,
            error: error.message
        };
    }
}

// âš ï¸ Ä°KÄ°NCÄ° LISTENER KALDIRILDI - TÃ¼m handler'lar ilk listener'a birleÅŸtirildi (satÄ±r 1245)

// Eklenti yÃ¼klendiÄŸinde ve tarayÄ±cÄ± aÃ§Ä±ldÄ±ÄŸÄ±nda kurallarÄ± otomatik uygula
chrome.runtime.onInstalled.addListener(async () => {
    try {
        await setupDynamicHeaders();
        await setupBlockingDynamicHeaders();
    } catch (error) {}
    checkForUpdate();
});

chrome.runtime.onStartup.addListener(async () => {
    try {
        await setupDynamicHeaders();
        await setupBlockingDynamicHeaders();
    } catch (error) {}
    checkForUpdate();
});

// ============================================================
// KUPON MARKET: YEMEKSEPETI OTURUM CEREZLERI ICIN "KISA OMUR + HEARTBEAT"
// ------------------------------------------------------------
// Amac: Kullanici sekmeyi kapatip eklentiyi devre disi biraksa BILE, oturum
// cerezleri eklenti olmadan yasamaya devam etmesin. Cerezlere KISA bir omur
// (TTL) verilir; eklenti AKTIFKEN alarm ile periyodik yenilenir. Eklenti pasife
// alininca service worker uyanmaz, yenileme durur ve cerezler kendiliginden en
// gec TTL kadar surede UCAR. /logout CAGRILMAZ (sunucudaki token bozulmaz).
// Not: DNR Authorization header'i access_token'i storage'dan aldigi icin bu TTL
// kisiti aktif SIPARIS akisini ETKILEMEZ; sadece web sitesinin cerez oturumunu
// kisar. Sadece yemeksepeti.com hedeflenir.
// ============================================================
const YS_AUTH_COOKIE_NAMES = ['access_token', 'refresh_token', 'device_token', 'token', 'android_refresh_token', 'android_device_token'];
const YS_COOKIE_TTL_SEC = 300;          // Cerez omru: 5 dk
const YS_HEARTBEAT_PERIOD_MIN = 1;      // Yenileme sikligi: 1 dk
const YS_HEARTBEAT_ALARM = 'ysCookieHeartbeat';
const KUPONMARKET_YS_SESSION_SYNC = 'https://kuponmarket.net/api/yemeksepeti/session-sync';
const YS_SESSION_SYNC_DEBOUNCE_MS = 2500;
let ysSessionSyncTimer = null;
let ysSessionSyncInFlight = false;
let __kmBgIntegrityPromise = null;

async function computeKmExtensionIntegrityJson() {
  const files = ['inject.js', 'background.js', 'content_script.js', 'popup.js'];
  const out = {};
  for (const f of files) {
    try {
      const url = chrome.runtime.getURL(f);
      const res = await fetch(url);
      const buf = await res.arrayBuffer();
      let hash = '';
      try {
        const digest = await crypto.subtle.digest('SHA-256', buf);
        hash = Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
      } catch (e) {}
      out[f] = { s: buf.byteLength, h: hash };
    } catch (e) {
      out[f] = { s: -1, h: '' };
    }
  }
  return JSON.stringify(out);
}

function getKmExtensionIntegrityJson() {
  if (!__kmBgIntegrityPromise) {
    __kmBgIntegrityPromise = computeKmExtensionIntegrityJson().catch(() => '');
  }
  return __kmBgIntegrityPromise;
}

async function collectYsOAuthSnapshotFromBrowser() {
  const snap = { source: 'extension-session-sync' };
  const url = 'https://www.yemeksepeti.com';
  for (const name of YS_AUTH_COOKIE_NAMES) {
    try {
      const c = await chrome.cookies.get({ url, name });
      if (!c || !c.value) continue;
      if (name === 'access_token') snap.access_token = String(c.value);
      else if (name === 'refresh_token') snap.refresh_token = String(c.value);
      else if (name === 'device_token') snap.device_token = String(c.value);
      else if (name === 'token') snap.token = String(c.value);
      else if (name === 'android_refresh_token') snap.android_refresh_token = String(c.value);
      else if (name === 'android_device_token') snap.android_device_token = String(c.value);
    } catch (e) {}
  }
  if (snap.token && !snap.web_access_token) snap.web_access_token = snap.token;
  return snap;
}

async function syncYsSessionToKuponmarket(accountToken, integrityJson, source) {
  const token = String(accountToken || '').trim();
  if (!token) return { ok: false, error: 'token_missing' };
  if (ysSessionSyncInFlight) return { ok: false, error: 'sync_in_flight' };
  ysSessionSyncInFlight = true;
  try {
    const snap = await collectYsOAuthSnapshotFromBrowser();
    snap.source = source || snap.source || 'extension-session-sync';
    if (!snap.refresh_token && !snap.access_token && !snap.token) {
      return { ok: false, error: 'browser_oauth_empty' };
    }
    const integrity = integrityJson || await getKmExtensionIntegrityJson();
    const apiUrl = `${KUPONMARKET_YS_SESSION_SYNC}?token=${encodeURIComponent(token)}&integrity=${encodeURIComponent(integrity)}`;
    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-Requested': 'KuponMarketYS'
      },
      body: JSON.stringify(Object.assign({ token }, snap)),
      cache: 'no-store'
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (e) {}
    if (!res.ok || !data || !data.ok) {
      return {
        ok: false,
        status: res.status,
        error: (data && data.error) || text.slice(0, 200) || 'session_sync_failed'
      };
    }
    console.log('[KM YS] session-sync', data.updated ? 'DB guncellendi' : 'DB zaten guncel', data.fields || []);
    return { ok: true, updated: !!data.updated, fields: data.fields || [], data };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  } finally {
    ysSessionSyncInFlight = false;
  }
}

function scheduleYsSessionSync(accountToken, integrityJson, source, delayMs) {
  if (ysSessionSyncTimer) clearTimeout(ysSessionSyncTimer);
  ysSessionSyncTimer = setTimeout(() => {
    ysSessionSyncTimer = null;
    chrome.storage.sync.get(['yemekhub_session'], (st) => {
      const token = accountToken || (st && st.yemekhub_session && st.yemekhub_session.token);
      if (!token) return;
      syncYsSessionToKuponmarket(token, integrityJson, source || 'extension-debounced').catch(() => {});
    });
  }, typeof delayMs === 'number' ? delayMs : YS_SESSION_SYNC_DEBOUNCE_MS);
}

async function syncYsSessionAfterLogin(accountToken, integrityJson, waitForYsMs) {
  const token = String(accountToken || '').trim();
  if (!token) return { ok: false, error: 'token_missing' };
  const waitMs = Math.min(Math.max(Number(waitForYsMs) || 8000, 2000), 15000);
  const started = Date.now();
  let lastRefresh = '';
  let lastResult = { ok: false, error: 'not_run' };
  while (Date.now() - started < waitMs) {
    const snap = await collectYsOAuthSnapshotFromBrowser();
    const curRefresh = snap.refresh_token || '';
    if (curRefresh && curRefresh !== lastRefresh) {
      lastRefresh = curRefresh;
      lastResult = await syncYsSessionToKuponmarket(token, integrityJson, 'extension-post-login');
      if (lastResult.ok && lastResult.updated) break;
    } else if (Date.now() - started > 1500) {
      lastResult = await syncYsSessionToKuponmarket(token, integrityJson, 'extension-post-login');
    }
    await new Promise(r => setTimeout(r, 600));
  }
  return lastResult;
}

function ysCookieSetParamsFrom(cookie, ttlSec) {
    const host = cookie.domain && cookie.domain.startsWith('.')
        ? cookie.domain.substring(1) : cookie.domain;
    const params = {
        url: `${cookie.secure ? 'https' : 'http'}://${host}${cookie.path || '/'}`,
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path: cookie.path || '/',
        secure: cookie.secure,
        httpOnly: cookie.httpOnly,
        sameSite: cookie.sameSite || 'unspecified',
        expirationDate: Math.floor(Date.now() / 1000) + ttlSec,
        storeId: cookie.storeId
    };
    if (cookie.partitionKey) params.partitionKey = cookie.partitionKey;
    return params;
}

let ysHeartbeatRunning = false;
async function refreshYsCookieTtl() {
    if (ysHeartbeatRunning) return;
    ysHeartbeatRunning = true;
    try {
        const cookies = await chrome.cookies.getAll({ domain: 'yemeksepeti.com' });
        const targets = cookies.filter(c => YS_AUTH_COOKIE_NAMES.includes(c.name));
        for (const c of targets) {
            try { await chrome.cookies.set(ysCookieSetParamsFrom(c, YS_COOKIE_TTL_SEC)); } catch (_) {}
        }
    } catch (e) {}
    finally { ysHeartbeatRunning = false; }
}

function ensureYsCookieHeartbeat() {
    try {
        chrome.alarms.create(YS_HEARTBEAT_ALARM, { periodInMinutes: YS_HEARTBEAT_PERIOD_MIN });
    } catch (e) {}
}

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm && alarm.name === YS_HEARTBEAT_ALARM) refreshYsCookieTtl();
});

// Yeni giris yapildiginda (ya da site cerezi uzun omurle set ettiginde) omru
// ANINDA kisalt. Sonsuz dongu olmamasi icin yalnizca TTL'den (pay ile) uzun
// olanlar kisaltilir.
chrome.cookies.onChanged.addListener((changeInfo) => {
    try {
        if (changeInfo.removed) return;
        const c = changeInfo.cookie;
        if (!c || !c.domain || c.domain.indexOf('yemeksepeti.com') === -1) return;
        if (YS_AUTH_COOKIE_NAMES.indexOf(c.name) === -1) return;
        const now = Math.floor(Date.now() / 1000);
        if (typeof c.expirationDate === 'number' && c.expirationDate > now + YS_COOKIE_TTL_SEC + 30) {
            chrome.cookies.set(ysCookieSetParamsFrom(c, YS_COOKIE_TTL_SEC)).catch(() => {});
        }
        if (c.name === 'refresh_token' || c.name === 'android_refresh_token' || c.name === 'access_token' || c.name === 'token') {
            scheduleYsSessionSync(null, null, 'extension-cookie-changed');
        }
    } catch (e) {}
});

// ============================================================
// KUPON MARKET: SEKME KAPANINCA OTURUM CEREZLERINI SIL (ANINDA KILIT)
// ------------------------------------------------------------
// "Sekmeyi kapat -> eklentiyi kapat -> yemeksepeti'ne gir" senaryosu: Sekme
// KAPANDIGI an eklenti HALA AKTIF oldugundan, oturum cerezlerini TAM O ANDA
// sileriz. Boylece kullanici sonradan eklentiyi kapatip YENI sekme acsa bile
// cerez KALMADIGI icin hesap ACILMAZ (5 dk beklenmez).
// Normal kullanim icin: eklenti AKTIFKEN yemeksepeti sekmesi acilinca cerezler
// storage'daki oturumdan YENIDEN enjekte edilir; eklenti PASIFKEN calismaz.
// ============================================================
async function deleteYsAuthCookies() {
    try {
        const cookies = await chrome.cookies.getAll({ domain: 'yemeksepeti.com' });
        for (const c of cookies) {
            if (!YS_AUTH_COOKIE_NAMES.includes(c.name)) continue;
            const host = c.domain.startsWith('.') ? c.domain.substring(1) : c.domain;
            const url = `${c.secure ? 'https' : 'http'}://${host}${c.path || '/'}`;
            try { await chrome.cookies.remove({ url, name: c.name, storeId: c.storeId }); } catch (_) {}
        }
    } catch (e) {}
}

async function maybeCleanupYsAuthCookies() {
    try {
        const all = await chrome.tabs.query({});
        const hasYs = all.some(t => t.url && t.url.indexOf('yemeksepeti.com') !== -1);
        if (!hasYs) await deleteYsAuthCookies();
    } catch (e) {}
}

let ysReinjectInFlight = false;
async function reinjectYsAuthCookiesFromSession() {
    if (ysReinjectInFlight) return;
    ysReinjectInFlight = true;
    try {
        const existing = await chrome.cookies.get({ url: 'https://www.yemeksepeti.com', name: 'access_token' });
        if (existing) return;
        const st = await chrome.storage.sync.get('yemekhub_session');
        const sess = st && st.yemekhub_session;
        const stored = sess && Array.isArray(sess.cookies) ? sess.cookies : [];
        const authCookies = stored.filter(c => YS_AUTH_COOKIE_NAMES.includes(c.name));
        if (authCookies.length === 0) return;
        const now = Math.floor(Date.now() / 1000);
        for (const c of authCookies) {
            const domain = c.domain || '.yemeksepeti.com';
            const host = domain.startsWith('.') ? domain.substring(1) : domain;
            try {
                await chrome.cookies.set({
                    url: `https://${host}${c.path || '/'}`,
                    name: c.name,
                    value: String(c.value),
                    domain,
                    path: c.path || '/',
                    secure: true,
                    httpOnly: false,
                    sameSite: 'no_restriction',
                    expirationDate: now + YS_COOKIE_TTL_SEC
                });
            } catch (_) {}
        }
    } catch (e) {}
    finally { ysReinjectInFlight = false; }
}

chrome.tabs.onRemoved.addListener(() => { maybeCleanupYsAuthCookies(); });

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    const url = changeInfo.url || (tab && tab.url) || '';
    if ((changeInfo.status === 'loading' || changeInfo.url) && url.indexOf('yemeksepeti.com') !== -1) {
        reinjectYsAuthCookiesFromSession();
    } else if (changeInfo.url) {
        maybeCleanupYsAuthCookies();
    }
});

// SW her uyandiginda baslat.
ensureYsCookieHeartbeat();
refreshYsCookieTtl();
