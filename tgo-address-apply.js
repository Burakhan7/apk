function tgoCleanUrl(url) {
    const clean = String(url || '').replace(/\u0000/g, '').trim();
    // Orion, eklenti dosyasındaki sabit adrese %00%00 ekliyor.
    // Çalışma anında birleştirilen metinde eklemiyor.
    return (' ' + clean).slice(1);
}

async function installTgoApiHeaderRules() {
    if (typeof RequestHeaderManager === 'undefined' || !RequestHeaderManager.updateDynamicRules) return;
    await RequestHeaderManager.updateDynamicRules({
        removeRuleIds: [7011, 7012, 7013, 7014, 7015]
    });
}

async function tgoFetch(url, options) {
    const cleanUrl = tgoCleanUrl(url);
    if (typeof globalThis.tgoPageFetch === 'function') {
        const result = await globalThis.tgoPageFetch(cleanUrl, options || {});
        const text = String(result && result.text || '');
        return {
            ok: !!(result && result.ok),
            status: (result && result.status) || 0,
            text: async () => text,
            json: async () => JSON.parse(text)
        };
    }
    return fetch(cleanUrl, options);
}

const TGO_WEB_ADDRESSES = 'https://api.tgoapis.com/web-user-apimemberaddress-santral/addresses';

function tgoWebHeaders(token) {
    const raw = String(token || '').trim();
    const auth = /^bearer\s+/i.test(raw) ? raw : 'bearer ' + raw;
    return {
        Authorization: auth,
        Accept: 'application/json, text/plain, */*',
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36 Edg/138.0.0.0',
        'sec-ch-ua-platform': '"Windows"',
        'sec-ch-ua': '"Not)A;Brand";v="8", "Chromium";v="138", "Microsoft Edge";v="138"',
        'sec-ch-ua-mobile': '?0',
        Origin: 'https://tgoyemek.com',
        Referer: 'https://tgoyemek.com/'
    };
}

function tgoAddressId(item) {
    return item && (item.id || item.addressId) ? String(item.id || item.addressId) : '';
}

function tgoCleanLabel(value) {
    return String(value || '').replace(/[()[\]{}]/g, ' ').replace(/\s+/g, ' ').trim();
}

function tgoSimplify(text) {
    return tgoCleanLabel(text)
        .replace(/İ/g, 'i')
        .replace(/I/g, 'ı')
        .toLowerCase()
        .replace(/ı/g, 'i')
        .replace(/ş/g, 's')
        .replace(/ğ/g, 'g')
        .replace(/ü/g, 'u')
        .replace(/ö/g, 'o')
        .replace(/ç/g, 'c')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s*(mah|mahallesi|mahalle|mh|koy|koyu)$/g, '')
        .replace(/[^a-z0-9]/g, '');
}

function tgoNamedList(list) {
    return (Array.isArray(list) ? list : [])
        .map((item) => ({ item, key: tgoSimplify(item && (item.name || item.title)) }))
        .filter((entry) => entry.key);
}

function tgoFindByName(list, name) {
    const target = tgoSimplify(name);
    if (!target || target.length < 2) return null;
    const named = tgoNamedList(list);
    return (
        named.find((entry) => entry.key === target) ||
        named.find((entry) => entry.key.startsWith(target) || (target.startsWith(entry.key) && entry.key.length >= 4)) ||
        named.find((entry) => target.length >= 5 && (entry.key.includes(target) || target.includes(entry.key)))
    )?.item || null;
}

function tgoFindDistrict(list, districtName, cityName) {
    const named = tgoNamedList(list);
    const cityKey = tgoSimplify(cityName);
    const full = tgoSimplify(districtName);
    const withoutCity = cityKey && full.startsWith(cityKey) ? full.slice(cityKey.length) : '';
    const lastWord = tgoSimplify(tgoCleanLabel(districtName).split(/\s+/).pop());
    const candidates = [full, withoutCity, lastWord].filter((item, index, all) => item && item.length >= 3 && all.indexOf(item) === index);
    for (const candidate of candidates) {
        const exact = named.find((entry) => entry.key === candidate);
        if (exact) return exact.item;
    }
    for (const candidate of candidates) {
        if (candidate === 'merkez') continue;
        const partial = named.find((entry) => entry.key.startsWith(candidate) || candidate.startsWith(entry.key));
        if (partial) return partial.item;
    }
    return null;
}

function tgoBuildingNo(address) {
    const raw = tgoCleanLabel(address.building || address.binaNo || address.address_line2 || '');
    if (raw && raw.length <= 10) return raw;
    const slash = raw.match(/(\d+\/\d+)\s*$/);
    if (slash && slash[1].length <= 10) return slash[1];
    const numbers = raw.match(/\d+[A-Za-z]?/g);
    if (numbers && numbers.length && numbers[numbers.length - 1].length <= 10) return numbers[numbers.length - 1];
    return '1';
}

function tgoPersonName(address) {
    const hasLetter = (value) => /[A-Za-zÇĞİÖŞÜçğıöşü]/.test(value || '');
    let name = tgoCleanLabel(address.first_name);
    let surname = tgoCleanLabel(address.last_name);
    const parts = tgoCleanLabel(address.fullname).split(/\s+/).filter(Boolean);
    if (!name) name = parts.length > 1 ? parts.slice(0, -1).join(' ') : (parts[0] || '');
    if (!surname) surname = parts.length > 1 ? parts[parts.length - 1] : '';
    if (!hasLetter(name) || name.length < 2) name = 'Kullanici';
    if (!hasLetter(surname) || surname.length < 2) surname = 'Adi';
    return { name: name.slice(0, 30), surname: surname.slice(0, 30) };
}

function tgoExtensionPhoneText(address) {
    let digits = String((address && (address.phone_number || address.telefon)) || '').replace(/\D/g, '');
    if (digits.startsWith('0090')) digits = digits.slice(4);
    else if (digits.startsWith('90') && digits.length >= 12) digits = digits.slice(2);
    else if (digits.startsWith('0') && digits.length === 11) digits = digits.slice(1);
    if (digits.length < 10) return '';
    digits = digits.slice(-10);
    return digits.slice(0, 3) + ' ' + digits.slice(3, 6) + ' ' + digits.slice(6, 8) + ' ' + digits.slice(8, 10);
}

function tgoDescriptionWithPhone(address, description) {
    const formatted = tgoExtensionPhoneText(address);
    const note = formatted ? ('bulamazsan veya bir sorun olursa bu numaradan ulaşım sağlayın ' + formatted) : '';
    const text = String(description || '').trim();
    const limit = 250;
    if (!note) return (text || 'Kapida teslim').slice(0, limit);
    if (text.toLowerCase().indexOf(note.toLowerCase()) !== -1) return text.slice(0, limit);
    const room = limit - note.length - (text ? 1 : 0);
    const base = room > 0 ? text.slice(0, room).trim() : '';
    return ((base ? base + ' ' : '') + note).slice(0, limit);
}

function tgoStoredField(address, keys, fallback) {
    for (const key of keys) {
        if (address[key] !== undefined && address[key] !== null && String(address[key]).trim() !== '') {
            return tgoCleanLabel(address[key]);
        }
    }
    return fallback;
}

function tgoPhoneFromRecord(record) {
    if (!record) return null;
    const rawPhone = record.phone || record.phoneNumber || record.national || '';
    if (!rawPhone || String(rawPhone).includes('*')) return null;
    let country = String(record.countryPhoneCode || record.dial || '').trim();
    if (/^tr$/i.test(country)) country = '';
    if (country && !country.startsWith('+')) {
        const codeDigits = country.replace(/\D/g, '');
        country = codeDigits ? '+' + codeDigits : '';
    }
    let digits = String(rawPhone).replace(/\D/g, '');
    if (!country) {
        if (digits.startsWith('0090')) {
            country = '+90';
            digits = digits.slice(4);
        } else if (digits.startsWith('90') && digits.length >= 12) {
            country = '+90';
            digits = digits.slice(2);
        } else if (digits.startsWith('0') && digits.length === 11) {
            country = '+90';
            digits = digits.slice(1);
        } else if (digits.length === 10 && digits.startsWith('5')) {
            country = '+90';
        }
    } else {
        const codeDigits = country.replace(/\D/g, '');
        if (codeDigits && digits.startsWith(codeDigits) && digits.length > codeDigits.length + 5) {
            digits = digits.slice(codeDigits.length);
        }
        if (country === '+90' && digits.startsWith('0')) digits = digits.slice(1);
    }
    if (digits.length < 6 || digits.length > 15) return null;
    return { phone: digits, countryPhoneCode: country || '+90' };
}

function tgoUniqueAddressName(desired, existing) {
    const base = String(desired || 'Ev').trim() || 'Ev';
    const names = (existing || []).map((item) => String(item.addressName || '').trim().toLowerCase()).filter(Boolean);
    if (!names.includes(base.toLowerCase())) return base;
    for (let i = 2; i <= 20; i++) {
        const candidate = base + ' ' + i;
        if (!names.includes(candidate.toLowerCase())) return candidate;
    }
    return base + ' ' + String(Date.now()).slice(-4);
}

async function tgoReadJson(response) {
    const text = await response.text();
    try {
        return { text, data: JSON.parse(text) };
    } catch (error) {
        return { text, data: null };
    }
}

async function tgoFetchAddresses(token) {
    const response = await tgoFetch(TGO_WEB_ADDRESSES, { method: 'GET', headers: tgoWebHeaders(token) });
    const parsed = await tgoReadJson(response);
    if (!response.ok) return { ok: false, addresses: [], status: response.status };
    const data = parsed.data || {};
    const list = data.addresses || data.items || (Array.isArray(data) ? data : []);
    return { ok: true, addresses: Array.isArray(list) ? list : [] };
}

async function tgoListNeighborhoodHits(token, cityId, districts, wantedName) {
    const headers = tgoWebHeaders(token);
    const hits = [];
    for (const district of (Array.isArray(districts) ? districts : [])) {
        if (!district || !district.id) continue;
        const response = await tgoFetch(
            'https://api.tgoapis.com/web-user-apimemberaddress-santral/districts/' + district.id + '/neighborhoods',
            { headers }
        );
        if (!response.ok) continue;
        const data = await response.json().catch(() => null);
        const list = (data && (data.neighborhoods || data)) || [];
        const matched = tgoFindByName(list, wantedName);
        if (!matched || !(matched.id || matched.neighborhoodId)) continue;
        hits.push({
            cityId: cityId,
            districtId: district.id,
            neighborhoodId: matched.id || matched.neighborhoodId,
            districtName: district.name || '',
            neighborhoodName: matched.name || matched.title || ''
        });
    }
    return hits;
}

async function tgoResolveLocation(token, address, lat, lng) {
    const headers = tgoWebHeaders(token);
    const wantedName = address.neighborhood || address.areas || address.address_line3 || address.mahalle || '';
    try {
        const response = await tgoFetch('https://api.tgoapis.com/web-location-santral/reverse-geocode?lat=' + lat + '&lng=' + lng, {
            method: 'GET',
            headers
        });
        if (response.ok) {
            const data = await response.json();
            const cityId = data.cityId || data.city?.id;
            const districtId = data.districtId || data.district?.id;
            let neighborhoodId = data.neighborhoodId || data.neighborhood?.id || null;
            if (cityId && districtId) {
                if (!neighborhoodId) neighborhoodId = await tgoMatchNeighborhood(token, districtId, address, !tgoCleanLabel(wantedName));
                if (neighborhoodId) return { cityId, districtId, neighborhoodId, alternates: [] };
            }
        }
    } catch (error) {
        console.warn('TGO reverse geocode:', error.message);
    }

    const cityName = address.city || address.city_name || address.il || address.province || '';
    const districtName = address.district || address.ilce || '';
    const citiesResponse = await tgoFetch('https://api.tgoapis.com/web-user-apimemberaddress-santral/cities', { headers });
    if (!citiesResponse.ok) throw new Error('Trendyol sehir listesi alinamadi');
    const citiesData = await citiesResponse.json();
    const city = tgoFindByName(citiesData.cities || citiesData, cityName);
    if (!city) throw new Error('Trendyol sehri eslesmedi');
    const districtsResponse = await tgoFetch('https://api.tgoapis.com/web-user-apimemberaddress-santral/cities/' + city.id + '/districts', { headers });
    if (!districtsResponse.ok) throw new Error('Trendyol ilce listesi alinamadi');
    const districtsData = await districtsResponse.json();
    const districts = districtsData.districts || districtsData;
    const district = tgoFindDistrict(districts, districtName, cityName);
    if (district) {
        const neighborhoodId = await tgoMatchNeighborhood(token, district.id, address, !tgoCleanLabel(wantedName));
        if (neighborhoodId) {
            return { cityId: city.id, districtId: district.id, neighborhoodId, alternates: [] };
        }
    }
    if (!tgoCleanLabel(wantedName)) throw new Error('Trendyol mahallesi eslesmedi');
    const hits = await tgoListNeighborhoodHits(token, city.id, districts, wantedName);
    if (!hits.length) throw new Error('Trendyol mahallesi eslesmedi');
    return Object.assign({}, hits[0], { alternates: hits.slice(1) });
}

async function tgoMatchNeighborhood(token, districtId, address, allowFirst) {
    const response = await tgoFetch('https://api.tgoapis.com/web-user-apimemberaddress-santral/districts/' + districtId + '/neighborhoods', {
        headers: tgoWebHeaders(token)
    });
    if (!response.ok) return null;
    const data = await response.json();
    const list = data.neighborhoods || data || [];
    const wanted = address.neighborhood || address.areas || address.address_line3 || address.mahalle || '';
    const matched = tgoFindByName(list, wanted) || ((allowFirst || !tgoCleanLabel(wanted)) && list[0]) || null;
    return matched ? (matched.id || matched.neighborhoodId || null) : null;
}

function tgoShiftCoordinates(lat, lng, radiusMeters) {
    const metersPerDegreeLat = 111320;
    const metersPerDegreeLng = 111320 * Math.cos(lat * Math.PI / 180);
    const angle = Math.random() * 2 * Math.PI;
    const distance = Math.sqrt(Math.random()) * radiusMeters;
    return {
        lat: lat + (distance * Math.cos(angle)) / metersPerDegreeLat,
        lng: lng + (distance * Math.sin(angle)) / metersPerDegreeLng
    };
}

async function tgoApplyStoredAddress(address, webToken, accountPhone) {
    try { await installTgoApiHeaderRules(); } catch (error) {}
    const token = String(webToken || '').trim();
    if (!token) return { success: false, error: 'web token yok' };
    const sourceLat = parseFloat(address.latitude || address.lat || 0);
    const sourceLng = parseFloat(address.longitude || address.lng || 0);
    if (!sourceLat || !sourceLng) return { success: false, error: 'koordinat yok' };
    const shifted = tgoShiftCoordinates(sourceLat, sourceLng, 5);
    const lat = shifted.lat;
    const lng = shifted.lng;

    const listed = await tgoFetchAddresses(token);
    const existing = listed.ok ? listed.addresses : [];
    const verified = existing.find((item) => item && item.isVerifiedPhone === true) || existing[0] || null;
    const phone = tgoPhoneFromRecord(verified)
        || tgoPhoneFromRecord(accountPhone)
        || tgoPhoneFromRecord({ phone: address.phone_number || address.telefon || address.phone, countryPhoneCode: '+90' });
    if (!phone) return { success: false, error: 'hesap telefonu yok' };

    let location;
    try {
        location = await tgoResolveLocation(token, address, lat, lng);
    } catch (error) {
        return { success: false, error: error.message };
    }

    const person = tgoPersonName(address);
    const building = tgoBuildingNo(address);
    const street = tgoCleanLabel(address.street || address.sokak || address.address_line1 || '');
    const neighborhood = tgoCleanLabel(address.neighborhood || address.areas || address.address_line3 || address.mahalle || '');
    const rawBuilding = tgoCleanLabel(address.building || address.binaNo || address.address_line2 || '');
    let description = tgoCleanLabel(address.delivery_instructions || address.tarifi || '');
    if (rawBuilding && rawBuilding !== building && description.toLowerCase().indexOf(rawBuilding.toLowerCase()) === -1) {
        description = (description ? description + ' ' : '') + rawBuilding;
    }
    const candidates = [location].concat(location.alternates || []);
    let response = null;
    let created = null;
    let body = null;
    for (let attempt = 0; attempt < candidates.length; attempt++) {
        const candidate = candidates[attempt];
        body = {
            name: person.name,
            surname: person.surname,
            phone: phone.phone,
            apartmentNumber: building,
            floor: tgoStoredField(address, ['floor', 'katNo'], '1').slice(0, 10),
            doorNumber: tgoStoredField(address, ['apartment', 'entrance', 'daireNo'], '1').slice(0, 20),
            addressName: tgoUniqueAddressName(address.addressLabel || address.etiket || 'Ev', existing),
            addressDescription: tgoDescriptionWithPhone(address, description),
            addressLine: [neighborhood, street].filter(Boolean).join(', ') + ' No:' + building,
            cityId: candidate.cityId,
            districtId: candidate.districtId,
            neighborhoodId: candidate.neighborhoodId,
            latitude: String(lat),
            longitude: String(lng),
            countryCode: 'TR',
            elevatorAvailable: false
        };
        if (phone.countryPhoneCode && phone.countryPhoneCode !== '+90') {
            body.countryPhoneCode = phone.countryPhoneCode;
        }
        response = await tgoFetch(TGO_WEB_ADDRESSES, {
            method: 'POST',
            headers: tgoWebHeaders(token),
            body: JSON.stringify(body)
        });
        created = await tgoReadJson(response);
        if (response.ok) {
            location = candidate;
            break;
        }
        const sms = Array.isArray(created.data) && created.data.find((item) => item && item.field === 'sms_verification');
        if (sms) return { success: false, error: 'Trendyol SMS dogrulama istedi' };
        const reason = String(created.text || '');
        const wrongPlace = /ilçe|ilce|konuma uygun|mahalle/i.test(reason);
        if (!wrongPlace || attempt === candidates.length - 1) {
            return { success: false, error: reason.slice(0, 300) };
        }
    }
    if (!response || !response.ok) {
        return { success: false, error: 'Trendyol adresi eklenemedi' };
    }

    let freshId = '';
    if (listed.ok && existing.length) {
        const again = await tgoFetchAddresses(token);
        const oldIds = existing.map(tgoAddressId).filter(Boolean);
        const fresh = (again.addresses || []).find((item) => {
            const id = tgoAddressId(item);
            return id && !oldIds.includes(id);
        });
        freshId = tgoAddressId(fresh);
        if (freshId) {
            for (const oldAddress of existing) {
                const oldId = tgoAddressId(oldAddress);
                const keepVerified = oldAddress && oldAddress.isVerifiedPhone === true && fresh && fresh.isVerifiedPhone !== true;
                if (oldId && oldId !== freshId && !keepVerified) {
                    await tgoFetch(TGO_WEB_ADDRESSES + '/' + oldId, { method: 'DELETE', headers: tgoWebHeaders(token) });
                }
            }
        }
    } else if (listed.ok) {
        const again = await tgoFetchAddresses(token);
        freshId = tgoAddressId((again.addresses || [])[0]);
    }

    if (freshId) {
        await chrome.storage.local.set({
            tyAddressPayload: {
                newAddressId: freshId,
                latitude: body.latitude,
                longitude: body.longitude,
                cityId: location.cityId,
                districtId: location.districtId,
                neighborhoodId: location.neighborhoodId,
                tyCityId: location.cityId,
                tyDistrictId: location.districtId
            }
        });
    }
    return { success: true, addressId: freshId || null, replaced: Boolean(freshId && existing.length) };
}

