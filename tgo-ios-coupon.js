(function () {
  if (window.top !== window) return;
  const host = String(location.hostname || '').toLowerCase();
  if (host !== 'tgoyemek.com' && host.slice(-13) !== '.tgoyemek.com') return;

  window.addEventListener('message', function (event) {
    if (event.source !== window) return;
    const msg = event.data;
    if (!msg || msg.source !== 'MIGROS_KUPON_EXTENSION') return;
    if (msg.action !== 'tyIosPrepareCart' && msg.action !== 'tyIosAdaptCart') return;

    const requestId = msg.requestId;
    const replyAction = msg.action === 'tyIosPrepareCart' ? 'iosPrepareResponse' : 'iosAdaptResponse';
    const bgAction = msg.action === 'tyIosPrepareCart' ? 'tgoPrepareIosCart' : 'tgoAdaptIosCart';

    function reply(response) {
      window.postMessage({
        source: 'MIGROS_KUPON_EXTENSION_CONTENT',
        action: replyAction,
        requestId: requestId,
        response: response || { ok: false }
      }, '*');
    }

    try {
      chrome.runtime.sendMessage({
        action: bgAction,
        url: msg.url || '',
        method: msg.method || 'GET',
        headers: msg.headers || {},
        body: msg.body || null,
        data: msg.data || '',
        adapt: msg.adapt === true
      }, function (resp) {
        if (chrome.runtime && chrome.runtime.lastError) {
          reply({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        reply(resp);
      });
    } catch (error) {
      reply({ ok: false, error: error && error.message ? error.message : 'bridge failed' });
    }
  });
})();
