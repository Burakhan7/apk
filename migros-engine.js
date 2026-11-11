const KM_MIGROS_DEVICES = [
  { manufacturer: 'samsung', model: 'SM-S928B', apiLevel: '34' },
  { manufacturer: 'samsung', model: 'SM-A556B', apiLevel: '34' },
  { manufacturer: 'xiaomi', model: 'Redmi Note 12', apiLevel: '33' },
  { manufacturer: 'Google', model: 'Pixel 8', apiLevel: '34' },
  { manufacturer: 'OPPO', model: 'CPH2469', apiLevel: '33' }
];

const KM_MIGROS_TOKEN_MAP = {
  'mg-': { service: 'hemen', url: 'https://www.migros.com.tr/hemen' },
  'mgy-': { service: 'yemek', url: 'https://www.migros.com.tr/yemek' },
  'mgm-': { service: 'sanal', url: 'https://www.migros.com.tr' }
};

function kmNormalizeMigrosToken(token) {
  return String(token || '').trim().toLowerCase();
}

function kmIsMigrosToken(token) {
  const t = kmNormalizeMigrosToken(token);
  return t.startsWith('mgy-') || t.startsWith('mgm-') || t.startsWith('mg-');
}

function kmMigrosPrefix(token) {
  const t = kmNormalizeMigrosToken(token);
  if (t.startsWith('mgy-')) return 'mgy-';
  if (t.startsWith('mgm-')) return 'mgm-';
  return 'mg-';
}

function kmGenerateMigrosDevice() {
  const template = KM_MIGROS_DEVICES[Math.floor(Math.random() * KM_MIGROS_DEVICES.length)];
  let deviceId = '';
  const hex = '0123456789abcdef';
  for (let i = 0; i < 16; i++) deviceId += hex[Math.floor(Math.random() * 16)];
  return {
    manufacturer: template.manufacturer,
    model: template.model,
    deviceId,
    apiLevel: template.apiLevel,
    appVersion: '26.8.10'
  };
}

function kmDeviceSign() {
  const n = new Date();
  const p = (v) => String(v).padStart(2, '0');
  return `${n.getFullYear()}${p(n.getMonth() + 1)}${p(n.getDate())}${p(n.getHours())}${p(n.getMinutes())}`;
}

function kmSimplify(text) {
  return String(text || '')
    .toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i').replace(/ğ/g, 'g').replace(/ü/g, 'u')
    .replace(/ş/g, 's').replace(/ö/g, 'o').replace(/ç/g, 'c')
    .replace(/[^a-z0-9]/g, '');
}

function kmFindMatch(list, name) {
  if (!Array.isArray(list) || !name) return null;
  const target = kmSimplify(name);
  return list.find((x) => kmSimplify(x.name) === target)
    || list.find((x) => kmSimplify(x.name).includes(target) || target.includes(kmSimplify(x.name)))
    || null;
}

async function kmClearMigrosCookies() {
  const cookies = await chrome.cookies.getAll({});
  const targets = cookies.filter((c) => String(c.domain || '').includes('migros.com.tr'));
  await Promise.all(targets.map((c) => {
    const host = c.domain.startsWith('.') ? c.domain.slice(1) : c.domain;
    const scheme = c.secure ? 'https' : 'http';
    return chrome.cookies.remove({ url: `${scheme}://${host}${c.path || '/'}`, name: c.name }).catch(() => {});
  }));
}

async function kmFetchMigrosCookies(token) {
  token = kmNormalizeMigrosToken(token);
  if (!token) {
    throw new Error('Token gerekli');
  }

  const url = `https://kuponmarket.net/api/migros/login-data.php?token=${encodeURIComponent(token)}`;
  const resp = await fetch(url, { method: 'GET', cache: 'no-store' });
  let data = {};
  try {
    data = await resp.json();
  } catch (e) {
    throw new Error(`Migros API yaniti okunamadi (HTTP ${resp.status})`);
  }

  if (!resp.ok || data.success === false) {
    throw new Error(data.error || data.message || `Token bulunamadi (HTTP ${resp.status})`);
  }

  const cookies = data.cookiesArray || data.cookies || data.data?.cookies || data.data || [];
  const list = Array.isArray(cookies) ? cookies : [];
  const remember = list.find((c) => c && c.name === 'remember-me' && c.value);
  if (!remember) {
    throw new Error(data.error || data.message || 'remember-me cookie bulunamadi');
  }
  return {
    cookies: list,
    rememberMe: decodeURIComponent(remember.value),
    service: data.service || null
  };
}

async function kmSetRememberMe(value) {
  const existing = await chrome.cookies.getAll({ name: 'remember-me' });
  for (const cookie of existing) {
    const host = cookie.domain.startsWith('.') ? cookie.domain.slice(1) : cookie.domain;
    await chrome.cookies.remove({ url: `https://${host}${cookie.path || '/'}`, name: 'remember-me' }).catch(() => {});
  }
  await chrome.cookies.set({
    url: 'https://www.migros.com.tr',
    name: 'remember-me',
    value,
    domain: '.migros.com.tr',
    path: '/',
    secure: true,
    httpOnly: true
  });
}

async function kmSetupMigrosHeaders(rememberMe, device) {
  const existing = await chrome.declarativeNetRequest.getSessionRules();
  const removeIds = existing.filter((r) => r.id >= 9877 && r.id <= 9999).map((r) => r.id);
  if (removeIds.length) {
    await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: removeIds });
  }
  const sign = kmDeviceSign();
  await chrome.declarativeNetRequest.updateSessionRules({
    addRules: [
      {
        id: 9877,
        priority: 2,
        action: {
          type: 'modifyHeaders',
          requestHeaders: [{ header: 'Cookie', operation: 'set', value: `remember-me=${rememberMe}` }]
        },
        condition: { requestDomains: ['rest.migros.com.tr'], resourceTypes: ['xmlhttprequest'] }
      },
      {
        id: 9890,
        priority: 5,
        action: {
          type: 'modifyHeaders',
          requestHeaders: [
            { header: 'Cookie', operation: 'set', value: `remember-me=${rememberMe}` },
            { header: 'x-forwarded-rest', operation: 'set', value: 'true' },
            { header: 'x-device-pwa', operation: 'set', value: 'true' },
            { header: 'x-pwa', operation: 'set', value: 'true' },
            { header: 'accept-language', operation: 'set', value: 'tr' }
          ]
        },
        condition: {
          requestDomains: ['www.migros.com.tr'],
          resourceTypes: ['xmlhttprequest', 'main_frame', 'sub_frame']
        }
      },
      {
        id: 9878,
        priority: 10,
        action: {
          type: 'modifyHeaders',
          requestHeaders: [
            { header: 'X-Device-Platform', operation: 'set', value: 'ANDROID' },
            { header: 'X-Device-Platform-Version', operation: 'set', value: device.apiLevel },
            { header: 'X-Device-Type', operation: 'set', value: 'MOBILE' },
            { header: 'X-Device-App-Version', operation: 'set', value: device.appVersion },
            { header: 'X-Device-Identifier', operation: 'set', value: device.deviceId },
            { header: 'X-Device-Model', operation: 'set', value: device.model },
            { header: 'X-Device-Sign', operation: 'set', value: sign },
            { header: 'User-Agent', operation: 'set', value: 'okhttp/5.3.2' }
          ]
        },
        condition: {
          requestDomains: ['rest.migros.com.tr'],
          resourceTypes: ['xmlhttprequest']
        }
      }
    ]
  });
}

async function kmSetupMigrosUrlBlocking(service) {
  await chrome.storage.local.set({
    migros_blocked_paths: [],
    migros_redirect_url: 'https://www.migros.com.tr/',
    migros_block_homepage: false
  });
}

async function kmGetBlockedPathsForContent() {
  return {
    blockedPaths: [],
    redirectUrl: 'https://www.migros.com.tr/',
    blockHomepage: false
  };
}

async function kmHandleProxyRequest(data) {
  const { url, method = 'GET', headers = {}, body } = data || {};
  try {
    const options = { method, headers };
    if (body) options.body = typeof body === 'string' ? body : JSON.stringify(body);
    const response = await fetch(url, options);
    return {
      success: true,
      status: response.status,
      statusText: response.statusText,
      headers: {},
      data: await response.text()
    };
  } catch (error) {
    return { success: false, error: error.message, headers: {} };
  }
}

async function kmFetchLocationIds(address) {
  const reid = Date.now().toString() + Math.floor(Math.random() * 1000);
  const headers = { accept: 'application/json' };
  const cities = await (await fetch(`https://www.migros.com.tr/rest/delivery-bff/locations/cities/deliverable?reid=${reid}`, { headers })).json();
  const city = kmFindMatch(cities, address.province || address.city || address.city_name);
  if (!city) return null;
  const towns = await (await fetch(`https://www.migros.com.tr/rest/delivery-bff/locations/towns/${city.id}/deliverable?reid=${reid}`, { headers })).json();
  const town = kmFindMatch(towns, address.district);
  if (!town) return { cityId: city.id, townId: 0, districtId: 0, cityName: city.name };
  const districts = await (await fetch(`https://www.migros.com.tr/rest/delivery-bff/locations/districts/${town.id}/deliverable?reid=${reid}`, { headers })).json();
  const district = kmFindMatch(districts, address.neighborhood || address.areas);
  return {
    cityId: city.id,
    townId: town.id,
    districtId: district ? district.id : 0,
    cityName: city.name,
    townName: town.name,
    districtName: district ? district.name : ''
  };
}

function kmResolvePersonName(address) {
  const first = String(
    address.first_name || address.firstname || address.firstName || address.musteriAdi || ''
  ).trim();
  const last = String(
    address.last_name || address.lastname || address.lastName || address.musteriSoyadi || ''
  ).trim();
  if (first && last) return { firstName: first, lastName: last };

  const full = String(address.fullname || address.adSoyad || address.customerName || '').trim();
  if (full && !/^kullan[iı]c[iı]/i.test(full)) {
    const parts = full.split(/\s+/);
    return {
      firstName: parts[0] || first || 'Musteri',
      lastName: parts.slice(1).join(' ') || last || parts[0] || 'Musteri'
    };
  }
  if (first) return { firstName: first, lastName: last || first };
  if (last) return { firstName: first || last, lastName: last };
  return { firstName: 'Musteri', lastName: 'Musteri' };
}

async function kmSyncMigrosAddress(address, token) {
  const lat = parseFloat(address.lat || address.latitude) || 0;
  const lng = parseFloat(address.lng || address.longitude) || 0;
  if (!lat || !lng) return { success: false, reason: 'missing_coords' };

  const loc = await kmFetchLocationIds(address).catch(() => null);
  const cityId = loc?.cityId || 34;
  const townId = loc?.townId || 0;
  const districtId = loc?.districtId || 0;
  const streetName = address.street || address.streetName || '';
  const cityName = loc?.cityName || address.city || address.province || '';
  const townName = loc?.townName || address.district || '';
  const districtName = loc?.districtName || address.neighborhood || address.areas || '';
  const names = kmResolvePersonName(address);
  const firstName = names.firstName;
  const lastName = names.lastName;
  const phone = String(
    address.telefon || address.phone || address.phone_number || address.phoneNumber || ''
  ).trim();
  let direction = address.tarifi || address.delivery_instructions || address.description || address.direction || streetName || '';
  direction = String(direction).trim();
  if (phone) {
    const alreadyHas = direction.replace(/\s/g, '').includes(phone.replace(/\s/g, ''));
    if (!alreadyHas) {
      direction = direction ? `${direction} ${phone}` : phone;
    }
  }
  if (!direction) direction = 'Adres tarifi';

  const getResp = await fetch('https://www.migros.com.tr/rest/delivery-bff/delivery-addresses', { credentials: 'include' });
  if (getResp.ok) {
    const getData = await getResp.json().catch(() => []);
    const existing = Array.isArray(getData) ? getData : (getData?.data || []);
    for (const addr of existing) {
      const addrId = addr.addressInfo?.id || addr.id;
      if (!addrId) continue;
      await fetch(`https://www.migros.com.tr/rest/delivery-bff/v2/addresses/${addrId}`, {
        method: 'DELETE',
        credentials: 'include'
      }).catch(() => {});
      await new Promise((r) => setTimeout(r, 800));
    }
  }

  const reid = Date.now().toString() + Math.floor(Math.random() * 1000000);
  const payload = {
    name: address.addressLabel || address.name || address.title || 'Ev',
    districtId,
    firstName,
    lastName,
    townId,
    cityId,
    streetName,
    floorNumber: address.floor || 'yok',
    doorNumber: address.apartment || address.doorNumber || 'yok',
    buildingNumber: address.building || 'yok',
    direction,
    latitude: lat,
    longitude: lng,
    detail: `${districtName}, ${streetName} ${address.building || 'yok'}, ${townName}/${cityName}`,
    townName,
    districtName
  };
  const post = await fetch(`https://www.migros.com.tr/rest/delivery-bff/delivery-addresses?reid=${reid}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
    credentials: 'include',
    body: JSON.stringify(payload)
  });
  if (!post.ok) {
    return { success: false, reason: 'api_error', status: post.status, body: await post.text() };
  }
  return { success: true, reason: 'ok' };
}

async function kmStartMigrosLogin(token, address) {
  token = kmNormalizeMigrosToken(token);
  if (!kmIsMigrosToken(token)) throw new Error('Gecersiz Migros token');
  let info = KM_MIGROS_TOKEN_MAP[kmMigrosPrefix(token)];
  await kmClearMigrosCookies();
  const { rememberMe, service } = await kmFetchMigrosCookies(token);
  if (service === 'hemen') info = KM_MIGROS_TOKEN_MAP['mg-'];
  if (service === 'yemek') info = KM_MIGROS_TOKEN_MAP['mgy-'];
  if (service === 'sanal') info = KM_MIGROS_TOKEN_MAP['mgm-'];
  await kmSetRememberMe(rememberMe);
  const device = kmGenerateMigrosDevice();
  await chrome.storage.local.set({ migros_device_info: device, km_migros_token: token });
  await kmSetupMigrosHeaders(rememberMe, device);
  await kmSetupMigrosUrlBlocking(info.service);

  let addressSync = { success: false, reason: 'skipped' };
  if (address) {
    addressSync = await kmSyncMigrosAddress(address, token);
  }

  chrome.tabs.create({ url: info.url, active: true });
  return { success: true, addressSync };
}
