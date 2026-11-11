/**
 * KuponMarket Extension - Migros Content Handler
 * Handles Migros Sanal Market, Yemek, and Hemen
 */

// Browser polyfill
(function() {
  const api = typeof chrome !== 'undefined' ? chrome : (typeof browser !== 'undefined' ? browser : null);
  if (api && !window.chrome) window.chrome = api;
})();

(function() {
  'use strict';
  
  console.log('[KuponMarket] Migros handler loaded');

  try {
    chrome.runtime.sendMessage({
      action: 'KS_PAGE_VISIT',
      data: { platform: 'migros', url: window.location.href }
    }).catch(() => {});
  } catch (_) {}
  
  // NOT: Hesap koruma uyarı bandı artık token girilince çıkan loginProgressOverlay'in
  // içinde gösteriliyor (ui/fullscreen.js içindeki .lp-mg-warning). /giris sayfasında
  // ayrı popup yok — kullanıcı zaten eklenti UI'ında uyarıyı görüyor.

  // URL Engelleme - SPA navigasyonlarını da yakala
  initUrlBlocking();

  // NOT: migros-interceptor.js artık manifest'ten MAIN world olarak yüklenir
  // (manuel injectScript yapmıyoruz — çift yükleme olmaması için)

  // Proxy bridge: inject script (MAIN world) ↔ content script ↔ background
  setupProxyBridge();
  
  // Detect Migros service type
  const serviceType = detectServiceType();
  
  // Initialize handler
  if (serviceType) {
    initializeMigrosHandler(serviceType);
  }
  
  /**
   * Inject script into page (MAIN world)
   */
  function injectScript(scriptPath) {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL(scriptPath);
    script.type = 'text/javascript';
    (document.head || document.documentElement).appendChild(script);
    script.onload = () => script.remove();
  }

  /**
   * Detect Migros service type from URL
   */
  function detectServiceType() {
    const url = window.location.href;
    
    if (url.includes('/yemek')) {
      return 'yemek';
    } else if (url.includes('/hemen')) {
      return 'hemen';
    } else if (url.includes('migros.com.tr')) {
      return 'sanal';
    }
    
    return null;
  }
  
  /**
   * Proxy bridge: MAIN world inject script ↔ content script ↔ background service worker
   * inject script postMessage ile istek gönderir, content script background'a iletir, yanıtı geri döner
   * Callback style kullanılır (Orion Browser await desteklemez)
   */
  function setupProxyBridge() {
    window.addEventListener('message', function(event) {
      if (event.source !== window || !event.data) return;
      if (event.data.source !== 'KUPONMARKET_INJECT') return;
      
      if (event.data.action === 'proxyRequest') {
        const { requestId, url, method, headers, body } = event.data;

        if (!url) {
          console.error('[KuponMarket] Proxy bridge: URL eksik, requestId:', requestId);
          return;
        }

        chrome.runtime.sendMessage({
          action: 'PROXY_REQUEST',
          data: { url, method, headers, body }
        }, function(response) {
          if (chrome.runtime.lastError) {
            console.error('[KuponMarket] Proxy bridge error:', chrome.runtime.lastError.message);
            response = { success: false, error: chrome.runtime.lastError.message, headers: {} };
            try { chrome.runtime.sendMessage({ action: 'KS_PROXY_ERROR', data: { platform: 'migros', error_message: chrome.runtime.lastError.message, url } }).catch(() => {}); } catch (_) {}
          }
          
          if (!response) {
            console.error('[KuponMarket] Proxy bridge: boş yanıt, requestId:', requestId);
            response = { success: false, error: 'Background scriptinden yanıt alınamadı.', headers: {} };
            try { chrome.runtime.sendMessage({ action: 'KS_PROXY_ERROR', data: { platform: 'migros', error_message: 'Boş yanıt', url } }).catch(() => {}); } catch (_) {}
          }
          
          window.postMessage({
            source: 'KUPONMARKET_CONTENT',
            action: 'proxyResponse',
            requestId: requestId,
            response: response
          }, '*');
        });
      }
    });
    console.log('[KuponMarket] Proxy bridge aktif');
  }

  /**
   * Initialize Migros handler
   */
  function initializeMigrosHandler(serviceType) {
    console.log(`[KuponMarket] Initializing Migros ${serviceType} handler`);
    
    // Listen for login events from background
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.action === 'MIGROS_LOGIN_COMPLETE') {
        handleLoginComplete(request.data);
        sendResponse({ success: true });
      }
      return true;
    });
  }
  
  /**
   * Handle login complete
   */
  function handleLoginComplete(data) {
    console.log('[KuponMarket] Login complete:', data);
    setTimeout(() => { window.location.reload(); }, 500);
  }
  
  /**
   * URL Engelleme - Token prefix'ine göre SPA navigasyonlarını engelle
   */
  async function initUrlBlocking() {
    try {
      // Background'dan engellenen path listesini al
      const response = await chrome.runtime.sendMessage({ action: 'GET_BLOCKED_PATHS' });
      if (!response || (!response.blockedPaths?.length && !response.blockHomepage)) {
        return;
      }
      
      const blockedPaths = response.blockedPaths || [];
      const redirectUrl = response.redirectUrl;
      const blockHomepage = response.blockHomepage || false;
      
      console.log('[KuponMarket] URL engelleme aktif:', blockedPaths, 'homepage:', blockHomepage, '→', redirectUrl);
      
      // 1. Mevcut URL kontrol et
      checkCurrentUrl();
      
      // 2. Link tıklamalarını yakala
      document.addEventListener('click', function(e) {
        const link = e.target.closest('a[href]');
        if (!link) return;
        
        const href = link.getAttribute('href') || '';
        if (isBlockedUrl(href)) {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          console.log('[KuponMarket] Engellenen URL tıklaması:', href);
          window.location.href = redirectUrl;
          return false;
        }
      }, true);
      
      // 3. history.pushState/replaceState override — DIŞ DOSYA ile
      // (Migros'un CSP'si inline script'e izin vermiyor; konfig DOM attribute'lardan okunur)
      try {
        const root = document.documentElement;
        root.setAttribute('data-km-blocked-paths', JSON.stringify(blockedPaths));
        root.setAttribute('data-km-redirect-url',  redirectUrl);
        root.setAttribute('data-km-block-homepage', blockHomepage ? '1' : '0');

        const script = document.createElement('script');
        script.src = chrome.runtime.getURL('inject/migros-url-blocker.js');
        script.onload = () => script.remove();
        (document.head || document.documentElement).appendChild(script);
      } catch (e) {
        console.warn('[KuponMarket] migros-url-blocker yüklenemedi:', e);
      }
      
      // 4. URL değişikliklerini izle (yedek)
      let lastUrl = window.location.href;
      const urlObserver = new MutationObserver(() => {
        if (window.location.href !== lastUrl) {
          lastUrl = window.location.href;
          checkCurrentUrl();
        }
      });
      
      // Observer'ı DOM hazır olduğunda başlat
      const startUrlObserver = () => {
        const target = document.body || document.documentElement;
        if (target) {
          urlObserver.observe(target, { childList: true, subtree: true });
        }
      };
      
      if (document.body) {
        startUrlObserver();
      } else {
        document.addEventListener('DOMContentLoaded', startUrlObserver);
      }
      
      function isPathBlocked(path) {
        // Ana sayfa kontrolü
        if (blockHomepage && (path === '/' || path === '')) return true;
        return blockedPaths.some(p => path === '/' + p || path.startsWith('/' + p + '/') || path.startsWith('/' + p + '?'));
      }
      
      function checkCurrentUrl() {
        const path = window.location.pathname;
        if (isPathBlocked(path)) {
          console.log('[KuponMarket] Engellenen sayfa tespit edildi:', path);
          window.location.href = redirectUrl;
        }
      }
      
      function isBlockedUrl(href) {
        if (!href) return false;
        try {
          const url = new URL(href, window.location.origin);
          if (!url.hostname.includes('migros.com.tr')) return false;
          return isPathBlocked(url.pathname);
        } catch(e) {
          return isPathBlocked(href);
        }
      }
      
    } catch (error) {
      console.error('[KuponMarket] URL engelleme hatası:', error);
    }
  }
  
  /**
   * Block PWA manifest (prevents app install prompts)
   */
  function blockPWAManifest() {
    const manifestLinks = document.querySelectorAll('link[rel="manifest"]');
    manifestLinks.forEach(link => {
      link.remove();
      console.log('[KuponMarket] PWA manifest blocked');
    });
  }
  
  // Block PWA on load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', blockPWAManifest);
  } else {
    blockPWAManifest();
  }
  
  // Also watch for dynamically added manifests
  const manifestObserver = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (node.tagName === 'LINK' && node.rel === 'manifest') {
          node.remove();
          console.log('[KuponMarket] PWA manifest blocked (dynamic)');
        }
      });
    });
  });
  
  // Observer'ı document.head hazır olduğunda başlat
  const startManifestObserver = () => {
    if (document.head) {
      manifestObserver.observe(document.head, {
        childList: true,
        subtree: true
      });
    }
  };
  
  if (document.head) {
    startManifestObserver();
  } else {
    document.addEventListener('DOMContentLoaded', startManifestObserver);
  }
  
})();
