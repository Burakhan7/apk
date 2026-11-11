(function () {
    if (window.__ytTgoAddressBridge) return;
    window.__ytTgoAddressBridge = true;

    function pageFetch(url, options) {
        const id = String(Date.now()) + Math.random().toString(36).slice(2);
        return new Promise((resolve) => {
            const timer = setTimeout(() => {
                window.removeEventListener('message', onMsg);
                resolve({ ok: false, status: 0, text: 'sayfa istegi zaman asimi' });
            }, 20000);
            function onMsg(event) {
                if (event.source !== window || !event.data || event.data.source !== 'YT_TGO_FETCH_RESULT' || event.data.id !== id) return;
                clearTimeout(timer);
                window.removeEventListener('message', onMsg);
                resolve(event.data);
            }
            window.addEventListener('message', onMsg);
            const headers = Object.assign({}, (options && options.headers) || {});
            ['User-Agent', 'sec-ch-ua', 'sec-ch-ua-platform', 'sec-ch-ua-mobile', 'Origin', 'Referer', 'origin', 'referer'].forEach(function (key) {
                delete headers[key];
            });
            window.postMessage({
                source: 'YT_TGO_FETCH',
                id: id,
                url: url,
                method: (options && options.method) || 'GET',
                headers: headers,
                body: options && options.body ? options.body : null
            }, '*');
        });
    }

    function holdAddressSheet() {
        if (window.__ytTgoSheetHold) return window.__ytTgoSheetHold;
        const style = document.createElement('style');
        style.id = 'yt-tgo-sheet-hold';
        style.textContent = '[data-yt-held-sheet]{display:none !important;}';
        (document.head || document.documentElement).appendChild(style);
        function looksLikeAddressSheet(node) {
            if (!node || node.nodeType !== 1 || node.id === 'yt-tgo-sheet-hold') return false;
            if (node.getAttribute('data-yt-held-sheet') === '1') return false;
            const text = (node.innerText || '').replace(/\s+/g, ' ').trim();
            if (!text || text.length > 1600) return false;
            return /adresini seç|adresini sec|kayıtlı adres|kayitli adres|adres seç|adres sec/i.test(text);
        }
        function scan() {
            const nodes = document.querySelectorAll('div,section,dialog');
            for (let i = 0; i < nodes.length; i++) {
                const node = nodes[i];
                if (!looksLikeAddressSheet(node)) continue;
                let target = node;
                let parent = node.parentElement;
                for (let depth = 0; depth < 5 && parent && parent !== document.body; depth++) {
                    const pos = window.getComputedStyle(parent).position;
                    if (pos === 'fixed' || pos === 'absolute') target = parent;
                    parent = parent.parentElement;
                }
                target.setAttribute('data-yt-held-sheet', '1');
            }
        }
        const observer = new MutationObserver(scan);
        observer.observe(document.documentElement, { childList: true, subtree: true });
        scan();
        window.__ytTgoSheetHold = function () {
            observer.disconnect();
            const held = document.querySelectorAll('[data-yt-held-sheet]');
            for (let i = 0; i < held.length; i++) held[i].removeAttribute('data-yt-held-sheet');
            if (style.parentNode) style.remove();
            window.__ytTgoSheetHold = null;
        };
        return window.__ytTgoSheetHold;
    }

    async function run() {
        try {
            if (sessionStorage.getItem('ytTgoAddressRefresh') === '1') {
                sessionStorage.removeItem('ytTgoAddressRefresh');
            }
        } catch (_) {}
        const stored = await chrome.storage.local.get(['tgoPendingAddress', 'tgoPendingAddressLock']);
        const job = stored && stored.tgoPendingAddress;
        if (!job || !job.address || !job.webToken) return;
        if (stored.tgoPendingAddressLock && Date.now() - stored.tgoPendingAddressLock < 60000) return;
        if (Date.now() - (job.createdAt || 0) > 3 * 60 * 1000) {
            await chrome.storage.local.remove(['tgoPendingAddress', 'tgoPendingAddressLock']);
            return;
        }
        const releaseSheet = holdAddressSheet();
        await chrome.storage.local.set({ tgoPendingAddressLock: Date.now() });
        await chrome.storage.local.remove('tgoPendingAddress');
        globalThis.tgoPageFetch = pageFetch;
        let added = false;
        try {
            const result = await tgoApplyStoredAddress(job.address, job.webToken, job.accountPhone || null);
            added = !!(result && result.success);
            if (added && typeof tgoPersonName === 'function') {
                const person = tgoPersonName(job.address);
                if (person && person.name && person.surname && person.name !== 'Kullanici' && person.surname !== 'Adi') {
                    await new Promise((resolve) => {
                        chrome.runtime.sendMessage({
                            action: 'tgoUpdatePersonName',
                            firstName: person.name,
                            lastName: person.surname,
                            webToken: job.webToken
                        }, resolve);
                    });
                }
            }
        } catch (error) {
            console.warn('TGO iOS adres eklenemedi', error);
        } finally {
            await chrome.storage.local.remove('tgoPendingAddressLock');
        }
        if (!added) {
            if (typeof releaseSheet === 'function') releaseSheet();
            return;
        }
        try {
            if (sessionStorage.getItem('ytTgoAddressRefresh') === '1') return;
            sessionStorage.setItem('ytTgoAddressRefresh', '1');
        } catch (_) {
            if (typeof releaseSheet === 'function') releaseSheet();
            return;
        }
        location.reload();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { run(); }, { once: true });
    } else {
        run();
    }
})();
