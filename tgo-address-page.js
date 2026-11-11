(function () {
    var nativeFetch = window.fetch.bind(window);
    function pageUrl(value) {
        var raw = String(value || '');
        var url = '';
        for (var i = 0; i < raw.length; i++) {
            var code = raw.charCodeAt(i);
            if (code !== 0) url += String.fromCharCode(code);
        }
        return url;
    }
    window.addEventListener('message', function (event) {
        if (event.source !== window || !event.data || event.data.source !== 'YT_TGO_FETCH') return;
        var msg = event.data;
        nativeFetch(pageUrl(msg.url), {
            method: pageUrl(msg.method || 'GET'),
            headers: msg.headers || {},
            body: msg.body || undefined,
            credentials: 'include'
        }).then(function (res) {
            return res.text().then(function (text) {
                window.postMessage({
                    source: 'YT_TGO_FETCH_RESULT',
                    id: msg.id,
                    ok: res.ok,
                    status: res.status,
                    text: text
                }, '*');
            });
        }).catch(function (err) {
            window.postMessage({
                source: 'YT_TGO_FETCH_RESULT',
                id: msg.id,
                ok: false,
                status: 0,
                text: String(err && err.message ? err.message : err)
            }, '*');
        });
    });
})();
