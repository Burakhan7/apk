/**
 * KuponMarket Extension - Migros Kupon Sistemi
 * Migros kupon UI + API sistemi + ban ?nleme
 * MAIN world'da ?al???r
 *
 * Hesaplar?n ban yememesi i?in kapsaml? koruma:
 * - Tracking/analytics endpoint'leri engellenir (px-cloud, sentry, hotjar, datadog vs.)
 * - PWA service worker (ngsw-worker.js) engellenir
 * - Logout endpoint'leri sahte 500 d?ner (auth/exit, registration-blocks)
 * - users/tokens her seferinde yeni UUID d?ner (cihaz parmak izi s?rekli yenilenir)
 * - screen-views, profile icon, cookie-settings engellenir
 */

(function() {
  'use strict';

  // \u00c7ift y\u00fckleme korumas\u0131 (manifest MAIN world + olas\u0131 content inject)
  if (window.__kmMigrosInterceptorActive) return;
  window.__kmMigrosInterceptorActive = true;

  // Global de?i?ken
  if (!window.migrosKupon) {
    window.migrosKupon = {
      appliedCouponData: null,
      currentService: null,
      validDiscountId: null,
      originalCouponId: null,
      couponUIContainer: null,
      originalPrice: null
    };
  }

  // ==================== BAN ?NLEME HELPERS ====================
  // Service Worker dosyas?n? engellemek i?in kontrol fonksiyonu
  function isServiceWorkerFile(url) {
    return url && (
      url.includes('ngsw-worker.js') ||
      url.includes('/ngsw-worker.js') ||
      url.endsWith('ngsw-worker.js')
    );
  }

  // PWA manifest dosyalar?n? engellemek i?in kontrol fonksiyonu
  function isPWAManifestFile(url) {
    return url && (
      url.includes('manifest.json') ||
      url.endsWith('manifest.json') ||
      url.includes('ngsw.json') ||
      url.endsWith('ngsw.json') ||
      url.includes('ngsw.json?ngsw-cache-bust=') ||
      url.includes('cookie-settings')
    );
  }

  // Profil ikonu dosyas?n? engellemek i?in kontrol fonksiyonu
  function isProfileIconFile(url) {
    return url && (
      url.includes('profilim_icon_s.webp') ||
      url.endsWith('profilim_icon_s.webp')
    );
  }

  // Screen-views endpoint (sayfa izleme telemetrisi)
  function isScreenViewsEndpoint(url) {
    return url && url.includes('screen-views');
  }

  // Token endpoint (her istekte yeni cihaz token'? i?in)
  function isTokenEndpoint(url) {
    return url && url.includes('users/tokens');
  }

  // Logout/exit endpoint (auth/exit, closed-accounts, registration-blocks)
  function isLogoutEndpoint(url) {
    return url && (
      url.includes('auth/exit') ||
      url.includes('users/closed-accounts') ||
      url.includes('users/registration-blocks')
    );
  }

  // Perseus Analytics endpoint
  function isPerseusAnalyticsEndpoint(url) {
    return url && (
      url.includes('perseus-productanalytics.deliveryhero.net') ||
      url.includes('/v1/insert/pandora/hit')
    );
  }

  // Analytics ve tracking URL'lerini engellemek i?in kontrol fonksiyonu
  function isAnalyticsOrTrackingEndpoint(url) {
    if (!url) return false;
    const blockedPatterns = [
      'px-cloud.net', 'sentry.io', 'usercentrics.eu', 'tvsquared.com',
      'icg-in.com', 'icg-in.info', 'braze.com', 'api/v2/collector',
      'trackjs.com', 'xhr/b/s', 'cdn-cgi/rum', 'px-cdn.net',
      'perseus-productanalytics', '/v5/action-log', 'pxchk.net',
      'hotjar.io', 'hotjar.com', 'datadoghq.eu', 'hexagon-analytics',
      'qualtrics.com', 'datadog', 'browser-intake-datadoghq.eu',
      'browser-http-intake', 'pagespeed.deliveryhero.net',
      'conn-check.icg-in.info'
    ];
    return blockedPatterns.some(pattern => url.includes(pattern));
  }

  // UUID v4 olu?tur (her cihaz token'? iste?i i?in)
  function generateUUIDv4() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      var r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  // Mevcut Service Worker kay?tlar?n? kald?r (banned cache temizli?i)
  if ('serviceWorker' in navigator) {
    try {
      navigator.serviceWorker.getRegistrations().then(function(registrations) {
        registrations.forEach(function(registration) {
          try { registration.unregister(); } catch (_) {}
        });
        if (registrations.length > 0) {
          console.log('[KuponMarket] ' + registrations.length + ' service worker kayd\u0131 silindi');
        }
      }).catch(function() {});
    } catch (_) {}
  }

  // sessionStorage'dan kupon verisini geri y?kle
  function loadCouponFromStorage() {
    try {
      const saved = sessionStorage.getItem('migros_coupon_data');
      if (saved) {
        const data = JSON.parse(saved);
        window.migrosKupon.appliedCouponData = data.appliedCouponData;
        window.migrosKupon.validDiscountId = data.validDiscountId;
        console.log('[KuponMarket] Kupon sessionStorage\'dan yuklendi:', data);
        return data;
      }
    } catch (e) {
      console.error('[KuponMarket] sessionStorage okuma hatasi:', e);
    }
    return null;
  }

  // sessionStorage'a kupon verisini kaydet
  function saveCouponToStorage(couponData, discountId) {
    try {
      const data = {
        appliedCouponData: couponData,
        validDiscountId: discountId,
        timestamp: Date.now()
      };
      sessionStorage.setItem('migros_coupon_data', JSON.stringify(data));
      console.log('[KuponMarket] Kupon sessionStorage\'a kaydedildi:', data);
    } catch (e) {
      console.error('[KuponMarket] sessionStorage yazma hatasi:', e);
    }
  }

  // sessionStorage'dan kupon verisini temizle
  function clearCouponFromStorage() {
    try {
      sessionStorage.removeItem('migros_coupon_data');
      console.log('[KuponMarket] sessionStorage temizlendi');
    } catch (e) {}
  }

  // ==================== CSS ====================
  // document_start a?amas?nda document.head hen?z yok ? bu y?zden
  // hem head/documentElement fallback hem de DOM haz?r olmas?n? bekleme
  // mant??? eklendi. ?nceden head bulunmad??? i?in CSS hi? enjekte
  // olmuyordu ve UI Migros'un global CSS'iyle tasar?ms?z kal?yordu.
  function GM_addStyle(css) {
    const inject = () => {
      try {
        // Zaten enjekte edildiyse tekrar etme
        if (document.getElementById('ks-migros-coupon-style')) return;
        const style = document.createElement('style');
        style.id = 'ks-migros-coupon-style';
        style.textContent = css;
        const target = document.head || document.documentElement;
        if (target) {
          target.appendChild(style);
        }
      } catch (error) {
        console.error('[KuponMarket] CSS ekleme hatas?:', error);
      }
    };

    // 1) E?er head varsa hemen enjekte et
    if (document.head) {
      inject();
    } else {
      // 2) head hen?z yoksa DOMContentLoaded'? bekle
      document.addEventListener('DOMContentLoaded', inject, { once: true });
      // 3) Ek g?venlik: documentElement'a hemen mount et (baz? durumlarda
      //    head sonra yarat?l?r ama sayfa style'? zaten g?r?r)
      if (document.documentElement) inject();
    }

    // 4) Migros SPA route de?i?imlerinde Angular bazen head'i yeniden yazar.
    //    Style silinmi?se tekrar ekle (her 2 saniyede kontrol).
    setInterval(() => {
      if (!document.getElementById('ks-migros-coupon-style')) inject();
    }, 2000);
  }

  const couponUIStyles = `
    .top-slot, .allow-new-wallet-content, fe-masterpass-link-user, .activate-wallet-wrapper, fe-card-provision-info, sm-mobile-app-popup, .popover.ng-star-inserted, #ai-wrapper, sm-money-discount-banner, .smart-life-wrapper, sm-download-hemen-app, sm-download-yemek-app, sm-download-app, sm-business-request-section, sm-download-application, .quick-filters {
      display:none !important;
    }

    #migros-coupon-container {
      position: relative;
      background: linear-gradient(135deg, #ffffff 0%, #fafbfc 100%);
      border-radius: 16px;
      border: 1px solid rgba(0, 0, 0, 0.06);
      box-shadow: 0 4px 24px rgba(0, 0, 0, 0.06), 0 1px 2px rgba(0, 0, 0, 0.04);
      margin: 16px 0;
      padding: 20px;
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      color: #1a1a2e;
      overflow: hidden;
    }
    #migros-coupon-container::before {
      content: '';
      position: absolute;
      top: 0; left: 0; right: 0;
      height: 3px;
      background: linear-gradient(90deg, #e32828 0%, #ff6b6b 50%, #e32828 100%);
      border-radius: 16px 16px 0 0;
    }
    @media (min-width: 992px) {
      #migros-coupon-container { margin-left: auto; width: calc(100% - 3rem); }
    }

    #migros-coupon-container .coupon-title {
      font-size: 1rem; font-weight: 700; line-height: 1.5; margin-bottom: 16px;
      color: #1a1a2e; display: flex; align-items: center; gap: 10px; letter-spacing: -0.01em;
    }
    #migros-coupon-container .coupon-title .coupon-title-icon {
      display: flex; align-items: center; justify-content: center;
      width: 36px; height: 36px; border-radius: 10px;
      background: linear-gradient(135deg, #e32828 0%, #ff4757 100%);
      color: #fff; flex-shrink: 0;
    }
    #migros-coupon-container .coupon-title .coupon-title-icon svg { width: 18px; height: 18px; }

    #migros-coupon-container .coupon-form {
      display: flex; gap: 10px; margin-bottom: 20px; align-items: stretch;
    }
    #migros-coupon-container #migros-coupon-input {
      flex-grow: 1; padding: 0 16px; border: 2px solid #e8ecf1; border-radius: 12px;
      font-size: 0.875rem; height: 46px; box-sizing: border-box; line-height: 1.5;
      background: #fff; color: #1a1a2e; transition: border-color 0.2s ease, box-shadow 0.2s ease;
      font-family: inherit;
    }
    #migros-coupon-container #migros-coupon-input::placeholder { color: #a0aec0; }
    #migros-coupon-container #migros-coupon-input:focus {
      border-color: #e32828; outline: none; box-shadow: 0 0 0 3px rgba(227, 40, 40, 0.1);
    }

    #migros-coupon-container .apply-coupon-button {
      background: linear-gradient(135deg, #e32828 0%, #d42020 100%); color: #fff;
      border: none; border-radius: 12px; padding: 0 24px; font-weight: 600;
      font-size: 0.875rem; cursor: pointer; height: 46px; line-height: 46px;
      transition: all 0.2s ease; box-shadow: 0 2px 8px rgba(227, 40, 40, 0.25);
      white-space: nowrap; font-family: inherit; letter-spacing: 0.01em;
    }
    #migros-coupon-container .apply-coupon-button:hover {
      background: linear-gradient(135deg, #d42020 0%, #b91c1c 100%);
      box-shadow: 0 4px 12px rgba(227, 40, 40, 0.35); transform: translateY(-1px);
    }
    #migros-coupon-container .apply-coupon-button:active { transform: translateY(0); box-shadow: 0 1px 4px rgba(227, 40, 40, 0.2); }
    #migros-coupon-container .apply-coupon-button:disabled {
      background: #e8ecf1; color: #a0aec0; cursor: not-allowed; box-shadow: none; transform: none;
    }

    #migros-coupon-container #migros-applied-coupon {
      display: none;
      background: linear-gradient(135deg, #f0fdf4 0%, #ecfdf5 100%);
      border: 1px solid #bbf7d0; border-radius: 12px; padding: 14px 16px;
      margin-bottom: 20px; animation: ks-slideDown 0.3s ease;
    }
    @keyframes ks-slideDown { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: translateY(0); } }
    #migros-coupon-container #migros-applied-coupon .applied-coupon-content {
      display: flex; justify-content: space-between; align-items: center; gap: 12px;
    }
    #migros-coupon-container #migros-applied-coupon .applied-coupon-info .applied-coupon-name {
      font-weight: 600; color: #16a34a; font-size: 0.875rem; display: flex; align-items: center; gap: 6px;
    }
    #migros-coupon-container #migros-applied-coupon .applied-coupon-info .applied-coupon-name::before {
      content: '?'; display: inline-flex; align-items: center; justify-content: center;
      width: 18px; height: 18px; border-radius: 50%; background: #16a34a; color: #fff;
      font-size: 11px; font-weight: 700; flex-shrink: 0;
    }
    #migros-coupon-container #migros-applied-coupon .applied-coupon-info .applied-coupon-code {
      font-size: 0.75rem; margin-top: 4px; color: #6b7280; padding-left: 24px;
    }
    #migros-coupon-container #migros-applied-coupon .applied-coupon-value {
      font-weight: 700; color: #16a34a; font-size: 1.05rem; white-space: nowrap;
    }
    #migros-coupon-container .remove-coupon-button {
      background: none; border: none; color: #ef4444; cursor: pointer;
      font-size: 1.1rem; padding: 4px 6px; line-height: 1; border-radius: 6px;
      transition: background 0.15s ease; margin-left: 4px;
    }
    #migros-coupon-container .remove-coupon-button:hover { background: rgba(239, 68, 68, 0.1); }

    #migros-coupon-container .available-coupons-title {
      font-size: 0.8rem; font-weight: 600; margin-bottom: 10px; color: #6b7280;
      text-transform: uppercase; letter-spacing: 0.05em;
    }

    #migros-coupon-container .coupon-list {
      border: 1px solid #e8ecf1; border-radius: 12px; padding: 4px;
      background: #fff; max-height: 280px; overflow-y: auto;
    }
    #migros-coupon-container .coupon-list::-webkit-scrollbar { width: 5px; }
    #migros-coupon-container .coupon-list::-webkit-scrollbar-track { background: transparent; }
    #migros-coupon-container .coupon-list::-webkit-scrollbar-thumb { background: #d1d5db; border-radius: 10px; }

    #migros-coupon-container .coupon-list-item {
      padding: 12px 14px; border-radius: 10px; cursor: pointer;
      display: flex; justify-content: space-between; align-items: center;
      transition: all 0.2s ease; margin-bottom: 2px; border: 1px solid transparent;
    }
    #migros-coupon-container .coupon-list-item:last-child { margin-bottom: 0; }
    #migros-coupon-container .coupon-list-item:hover {
      background: linear-gradient(135deg, #fef2f2 0%, #fff5f5 100%); border-color: rgba(227, 40, 40, 0.1);
    }
    #migros-coupon-container .coupon-list-item:active { transform: scale(0.99); }
    #migros-coupon-container .coupon-list-item .coupon-item-info { flex-grow: 1; margin-right: 12px; min-width: 0; }
    #migros-coupon-container .coupon-list-item .coupon-item-name {
      font-weight: 600; font-size: 0.85rem; color: #1a1a2e; margin-bottom: 3px; line-height: 1.35;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    #migros-coupon-container .coupon-list-item .coupon-item-desc {
      font-size: 0.75rem; color: #9ca3af; line-height: 1.4; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    #migros-coupon-container .coupon-list-item .coupon-item-min {
      font-size: 0.7rem; color: #f59e0b; font-weight: 600; margin-top: 4px;
      display: inline-flex; align-items: center; gap: 3px; background: #fffbeb;
      border: 1px solid #fde68a; padding: 2px 7px; border-radius: 6px; line-height: 1.3;
    }
    #migros-coupon-container .coupon-list-item .coupon-item-value {
      font-weight: 700; color: #e32828; font-size: 0.875rem; white-space: nowrap;
      background: linear-gradient(135deg, #fef2f2 0%, #fee2e2 100%); padding: 4px 10px; border-radius: 8px;
    }

    #migros-coupon-container #migros-card-warning {
      display: flex; align-items: center; gap: 10px;
      background: linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%);
      border: 1px solid #fde68a; border-radius: 12px; padding: 12px 16px;
      margin-bottom: 16px; color: #92400e; font-size: 0.82rem; font-weight: 500; line-height: 1.45;
      animation: ks-slideDown 0.3s ease;
    }
    #migros-coupon-container #migros-card-warning svg { flex-shrink: 0; color: #f59e0b; }
    #migros-coupon-container .coupon-form.coupon-form-disabled { opacity: 0.5; pointer-events: none; user-select: none; }
    #migros-coupon-container .coupon-list.coupon-list-disabled { opacity: 0.5; pointer-events: none; user-select: none; }

    #migros-coupon-container .no-coupons-message {
      padding: 24px 16px; text-align: center; color: #9ca3af; font-size: 0.85rem;
    }
    #migros-coupon-container .no-coupons-message::before { content: '??'; display: block; font-size: 1.5rem; margin-bottom: 8px; }

    #migros-summary-coupon-discount p { margin: 0; font-size: 0.875rem; line-height: 1.5; }
    #migros-summary-coupon-discount p:first-child { color: #16a34a; }
    #migros-summary-coupon-discount p:last-child { color: #16a34a; font-weight: 600; text-align: right; }
    #migros-summary-coupon-discount {
      grid-column: 1 / 3; display: grid; grid-template-columns: 1fr auto;
      row-gap: 0.75rem; justify-content: space-between; margin-top: 0.75rem;
    }

    #migros-popup-container {
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      background-color: rgba(0, 0, 0, 0.5); backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px);
      display: flex; justify-content: center; align-items: center; z-index: 9999;
      opacity: 0; visibility: hidden; transition: opacity 0.25s ease, visibility 0.25s ease;
    }
    #migros-popup-container.visible { opacity: 1; visibility: visible; }
    #migros-popup {
      background-color: #fff; border-radius: 20px;
      box-shadow: 0 25px 60px rgba(0, 0, 0, 0.15), 0 4px 12px rgba(0, 0, 0, 0.08);
      width: 90%; max-width: 440px; padding: 0; overflow: hidden;
      transform: translateY(24px) scale(0.96); transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
    }
    #migros-popup-container.visible #migros-popup { transform: translateY(0) scale(1); }
    #migros-popup-header {
      background: linear-gradient(135deg, #e32828 0%, #dc2626 100%); color: white;
      padding: 20px 24px; display: flex; justify-content: space-between; align-items: center;
    }
    #migros-popup-header.success { background: linear-gradient(135deg, #16a34a 0%, #15803d 100%); }
    #migros-popup-header.warning { background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); }
    #migros-popup-header h3 { margin: 0; font-size: 17px; font-weight: 700; letter-spacing: -0.01em; }
    #migros-popup-close {
      background: rgba(255, 255, 255, 0.2); border: none; color: white; font-size: 18px;
      cursor: pointer; padding: 0; line-height: 1; width: 32px; height: 32px;
      border-radius: 50%; display: flex; align-items: center; justify-content: center;
      transition: background 0.15s ease;
    }
    #migros-popup-close:hover { background: rgba(255, 255, 255, 0.35); }
    #migros-popup-content {
      padding: 24px; font-size: 14px; line-height: 1.6; color: #374151;
      max-height: 55vh; overflow-y: auto;
    }
    #migros-popup-content:not(:has(p, ul, ol, h1, h2, h3, h4, h5, h6)) { white-space: pre-line; }
    #migros-popup-content p { margin: 0 0 10px 0; }
    #migros-popup-content b { color: #1a1a2e; }
    #migros-popup-buttons {
      padding: 0 24px 24px; display: flex; justify-content: flex-end; gap: 10px;
    }
    #migros-popup-buttons button {
      padding: 10px 20px; border-radius: 10px; font-size: 14px; font-weight: 600;
      cursor: pointer; border: none; transition: all 0.2s ease; font-family: inherit;
    }
    #migros-popup-buttons .primary {
      background: linear-gradient(135deg, #e32828 0%, #dc2626 100%); color: white;
      box-shadow: 0 2px 8px rgba(227, 40, 40, 0.25);
    }
    #migros-popup-buttons .primary:hover { box-shadow: 0 4px 12px rgba(227, 40, 40, 0.35); transform: translateY(-1px); }
    #migros-popup-buttons .secondary { background: #f3f4f6; color: #374151; }
    #migros-popup-buttons .secondary:hover { background: #e5e7eb; }

    @media (max-width: 576px) {
      #migros-coupon-container { padding: 16px; border-radius: 14px; }
      #migros-coupon-container .coupon-form { flex-wrap: wrap; }
      #migros-coupon-container #migros-coupon-input { flex: 1 1 100%; margin-bottom: 8px; }
      #migros-coupon-container .apply-coupon-button { flex: 1 1 100%; padding: 0 12px; width: 100%; }
    }
    @media (max-width: 480px) {
      #migros-coupon-container .coupon-form { flex-wrap: nowrap; }
      #migros-coupon-container #migros-coupon-input { flex: 1; margin-bottom: 0; }
      #migros-coupon-container .apply-coupon-button { flex: 0 0 auto; width: auto; padding: 0 14px; font-size: 0.8rem; }
    }
  `;

  GM_addStyle(couponUIStyles);
  console.log('[KuponMarket] Migros kupon UI CSS enjekte edildi');

  // ==================== HELPERS ====================
  function detectService() {
    const mainElement = document.querySelector('main');
    if (!mainElement) {
      // main element yoksa URL'den tespit et
      const url = window.location.href;
      if (url.includes('/yemek')) return 'yemek';
      if (url.includes('/hemen')) return 'hemen';
      console.log('[KuponMarket] main element yok, URL\'den tespit edildi: sanalmarket');
      return 'sanalmarket';
    }
    const classList = mainElement.classList;
    if (classList.contains('yemek')) return 'yemek';
    if (classList.contains('hemen')) return 'hemen';
    return 'sanalmarket';
  }

  function getApiBaseUrl(service) {
    switch(service) {
      case 'yemek': return '/rest/yemek';
      case 'hemen': return '/rest/hemen';
      default: return '/rest';
    }
  }

  // ==================== PROXY COMMUNICATION ====================
  if (!window._kuponMarketProxyListenerActive) {
    window._kuponMarketProxyListenerActive = true;
    window.addEventListener('message', function(event) {
      if (event.source !== window || !event.data || event.data.source !== 'KUPONMARKET_CONTENT') return;
      if (event.data.action !== 'proxyResponse') return;
      const { requestId, response } = event.data;
      if (response && !response.headers) response.headers = {};
      if (window.migrosKupon && window.migrosKupon.fetchCallbacks && window.migrosKupon.fetchCallbacks[requestId]) {
        window.migrosKupon.fetchCallbacks[requestId](response);
      }
    });
  }

  function sendProxyRequest(requestDetails, timeoutMs) {
    const _timeout = timeoutMs != null ? timeoutMs : 15000;
    return new Promise((resolve, reject) => {
      const requestId = Date.now() + Math.random().toString().substring(2, 8);
      let _settled = false;
      window.migrosKupon.fetchCallbacks = window.migrosKupon.fetchCallbacks || {};
      const _timer = setTimeout(() => {
        if (_settled) return;
        _settled = true;
        delete window.migrosKupon.fetchCallbacks[requestId];
        reject(new Error('Proxy timeout'));
      }, _timeout);

      window.migrosKupon.fetchCallbacks[requestId] = (response) => {
        if (_settled) return;
        _settled = true;
        clearTimeout(_timer);
        delete window.migrosKupon.fetchCallbacks[requestId];
        if (response && response.success) {
          resolve(response);
        } else {
          reject(new Error(response ? response.error : 'Proxy request failed'));
        }
      };

      window.postMessage({
        source: 'KUPONMARKET_INJECT',
        ...requestDetails,
        requestId: requestId,
      }, '*');
    });
  }

  // ==================== POPUP ====================
  function createPopup() {
    try {
      const existingPopup = document.getElementById('migros-popup-container');
      if (existingPopup) return existingPopup;
      if (!document || !document.body) return null;

      const popupContainer = document.createElement('div');
      popupContainer.id = 'migros-popup-container';
      popupContainer.innerHTML = `
        <div id="migros-popup">
          <div id="migros-popup-header">
            <h3 id="migros-popup-title">Bilgi</h3>
            <button id="migros-popup-close">&times;</button>
          </div>
          <div id="migros-popup-content"></div>
          <div id="migros-popup-buttons">
            <button class="primary" id="migros-popup-ok">Tamam</button>
          </div>
        </div>
      `;

      const closePopup = () => {
        popupContainer.classList.remove('visible');
        setTimeout(() => { if (popupContainer.parentNode) popupContainer.parentNode.removeChild(popupContainer); }, 300);
      };
      const closeButton = popupContainer.querySelector('#migros-popup-close');
      const okButton = popupContainer.querySelector('#migros-popup-ok');
      if (closeButton) closeButton.addEventListener('click', closePopup);
      if (okButton) okButton.addEventListener('click', closePopup);
      popupContainer.addEventListener('click', function(e) { if (e.target === popupContainer) closePopup(); });

      document.body.appendChild(popupContainer);
      setTimeout(() => { popupContainer.classList.add('visible'); }, 10);
      return popupContainer;
    } catch (error) {
      console.error('[KuponMarket] Popup olu?turma hatas?:', error);
      return null;
    }
  }

  function showMessage(message, title, type) {
    title = title || 'Bilgi';
    type = type || 'info';
    try {
      const popupContainer = createPopup();
      if (!popupContainer) return null;
      const popupTitle = popupContainer.querySelector('#migros-popup-title');
      const popupContent = popupContainer.querySelector('#migros-popup-content');
      if (!popupTitle || !popupContent) return null;
      popupTitle.textContent = title;
      if (message.includes('<') && message.includes('>')) {
        try { const parser = new DOMParser(); const doc = parser.parseFromString(message, 'text/html'); popupContent.innerHTML = ''; Array.from(doc.body.childNodes).forEach(node => popupContent.appendChild(node.cloneNode(true))); }
        catch (e) { popupContent.textContent = message; }
      } else { popupContent.textContent = message; }
      const header = popupContainer.querySelector('#migros-popup-header');
      if (header) { header.className = ''; header.id = 'migros-popup-header'; if (type === 'success') header.classList.add('success'); else if (type === 'warning' || type === 'error') header.classList.add('warning'); }
      return popupContainer;
    } catch (error) { console.error('[KuponMarket] showMessage hatas?:', error); return null; }
  }

  // ==================== CARD CHECK ====================
  function isCardInfoFilled() {
    try {
      const cardNumberInput = document.querySelector('input[name="cardNumber"], input[data-testid="card-number"], input[placeholder*="Kart Numaras"], input[formcontrolname="cardNumber"], input[autocomplete="cc-number"]');
      const expiryInput = document.querySelector('input[name="expiry"], input[name="expiryDate"], input[data-testid="expiry-date"], input[placeholder*="AA/YY"], input[formcontrolname="expiryDate"], input[autocomplete="cc-exp"]');
      const cvvInput = document.querySelector('input[name="cvv"], input[name="cvc"], input[data-testid="cvv"], input[placeholder*="CVV"], input[formcontrolname="cvv"], input[autocomplete="cc-csc"]');
      const allInputs = document.querySelectorAll('fe-line-checkout-payment input, sm-delivery-payment input, .payment-method input, .credit-card-form input');
      let cardFilled = false, expiryFilled = false, cvvFilled = false;
      if (cardNumberInput && cardNumberInput.value && cardNumberInput.value.replace(/\s/g, '').length >= 15) cardFilled = true;
      if (expiryInput && expiryInput.value && expiryInput.value.length >= 4) expiryFilled = true;
      if (cvvInput && cvvInput.value && cvvInput.value.length >= 3) cvvFilled = true;
      if (!cardFilled || !expiryFilled || !cvvFilled) {
        allInputs.forEach(input => {
          const val = input.value || '', placeholder = (input.placeholder || '').toLowerCase(), name = (input.name || '').toLowerCase(), id = (input.id || '').toLowerCase(), autocomplete = (input.autocomplete || '').toLowerCase();
          if (!cardFilled && (name.includes('card') || id.includes('card') || placeholder.includes('kart') || autocomplete.includes('cc-number'))) { if (val.replace(/\s/g, '').length >= 15) cardFilled = true; }
          if (!expiryFilled && (name.includes('expir') || id.includes('expir') || placeholder.includes('aa') || autocomplete.includes('cc-exp'))) { if (val.length >= 4) expiryFilled = true; }
          if (!cvvFilled && (name.includes('cvv') || name.includes('cvc') || id.includes('cvv') || autocomplete.includes('cc-csc'))) { if (val.length >= 3) cvvFilled = true; }
        });
      }
      return cardFilled && expiryFilled && cvvFilled;
    } catch (error) { return false; }
  }

  function updateCouponUICardState() {
    const cardWarning = document.getElementById('migros-card-warning');
    const couponForm = document.querySelector('#migros-coupon-container .coupon-form');
    const couponList = document.querySelector('#migros-coupon-container .coupon-list');
    const applyButton = document.querySelector('#migros-coupon-container .apply-coupon-button');
    const couponInput = document.getElementById('migros-coupon-input');
    const filled = isCardInfoFilled();
    if (cardWarning) cardWarning.style.display = filled ? 'none' : 'flex';
    if (couponForm) couponForm.classList.toggle('coupon-form-disabled', !filled);
    if (couponList) couponList.classList.toggle('coupon-list-disabled', !filled);
    if (applyButton) applyButton.disabled = !filled;
    if (couponInput) couponInput.disabled = !filled;
  }

  function startCardFieldObserver() {
    const paymentSection = document.querySelector('fe-line-checkout-payment, sm-delivery-payment, .payment-method, .credit-card-form');
    const observeTarget = paymentSection || document.body;
    observeTarget.addEventListener('input', function(e) {
      if (e.target.tagName === 'INPUT') { clearTimeout(window.migrosKupon._cardCheckTimeout); window.migrosKupon._cardCheckTimeout = setTimeout(updateCouponUICardState, 300); }
    }, true);
    observeTarget.addEventListener('change', function(e) {
      if (e.target.tagName === 'INPUT') { clearTimeout(window.migrosKupon._cardCheckTimeout); window.migrosKupon._cardCheckTimeout = setTimeout(updateCouponUICardState, 300); }
    }, true);
    const observer = new MutationObserver(function(mutations) {
      let shouldCheck = false;
      for (const mutation of mutations) { if (mutation.type === 'childList' && mutation.addedNodes.length > 0) { for (const node of mutation.addedNodes) { if (node.nodeType === 1 && (node.tagName === 'INPUT' || node.querySelector && node.querySelector('input'))) { shouldCheck = true; break; } } } if (shouldCheck) break; }
      if (shouldCheck) { clearTimeout(window.migrosKupon._cardCheckTimeout); window.migrosKupon._cardCheckTimeout = setTimeout(updateCouponUICardState, 500); }
    });
    observer.observe(observeTarget, { childList: true, subtree: true });
    window.migrosKupon._cardCheckInterval = setInterval(updateCouponUICardState, 2000);
  }

  // ==================== API ====================
  async function fetchCoupons(service) {
    try {
      const pathMatch = window.location.pathname.match(/(?:\/(yemek|hemen))?\/siparis\/odeme\/(\d+)/);
      if (!pathMatch || !pathMatch[2]) { console.error('[KuponMarket] Siparis ID bulunamadi:', window.location.pathname); return []; }
      const checkoutId = pathMatch[2];
      const timestamp = Date.now().toString() + Math.floor(Math.random() * 1000000).toString().padStart(6, '0');
      let endpoint;
      switch (service) {
        case 'yemek': endpoint = `/yemek/checkouts/${checkoutId}/discounts/applicable?reid=${timestamp}`; break;
        case 'hemen': endpoint = `/hemen/checkouts/${checkoutId}/discounts/applicable?reid=${timestamp}`; break;
        default: endpoint = `/checkouts/${checkoutId}/discounts/applicable?reid=${timestamp}`; break;
      }
      console.log('[KuponMarket] Kuponlar aliniyor:', endpoint);

      const response = await sendProxyRequest({
        action: 'proxyRequest',
        url: `https://www.migros.com.tr/rest${endpoint}`,
        method: 'POST',
        headers: { 'accept': 'application/json', 'content-type': 'application/json', 'x-forwarded-rest': 'true' },
        body: JSON.stringify({ "bagSelected": true })
      });

      const data = JSON.parse(response.data);
      let coupons = [];
      if (data && data.successful && Array.isArray(data.data)) coupons = data.data;
      else if (data && Array.isArray(data.discounts)) coupons = data.discounts;
      else if (data && typeof data === 'object') {
        if (Array.isArray(data.availableDiscounts)) coupons = data.availableDiscounts;
        else if (Array.isArray(data.discountResults)) coupons = data.discountResults;
        else if (Array.isArray(data.data && data.data.availableDiscounts)) coupons = data.data.availableDiscounts;
      }
      if (!Array.isArray(coupons)) coupons = [];
      const now = Date.now();
      return coupons.filter(coupon => {
        const startDate = coupon.startDate ? new Date(coupon.startDate).getTime() : 0;
        const finishDate = coupon.finishDate ? new Date(coupon.finishDate).getTime() : Infinity;
        const discountValue = coupon.discountValue || coupon.discountAmount;
        return (startDate <= now && finishDate >= now) && coupon.id && coupon.name && discountValue;
      });
    } catch (error) { console.error('[KuponMarket] Kupon listesi alinamadi:', error); return []; }
  }

  async function validateCoupon(service, couponCode, checkoutId, couponId) {
    try {
      const endpoint = `${getApiBaseUrl(service)}/checkouts/${checkoutId}/discounts/checks`;
      const body = couponId
        ? { "campaignType": "COUPON", "bagSelected": true, "deliveryProvider": "NONE", "paymentType": "CREDIT_CARD", "discountId": couponId }
        : { "campaignType": "COUPON", "bagSelected": true, "deliveryProvider": "NONE", "paymentType": "CREDIT_CARD", "couponCode": couponCode };

      const response = await sendProxyRequest({
        action: 'proxyRequest',
        url: `https://www.migros.com.tr/rest${endpoint}`,
        method: 'POST',
        headers: { 'accept': 'application/json', 'content-type': 'application/json', 'x-forwarded-rest': 'true' },
        body: JSON.stringify(body)
      });

      const data = JSON.parse(response.data);
      if (!data.successful) {
        // Detayl\u0131 hata mesaj\u0131 \u00e7\u0131kar (string/object/detailMessage/message fallback'leri)
        let detailedMsg = '';
        if (typeof data.errorDetail === 'string') {
          detailedMsg = data.errorDetail;
        } else if (data.errorDetail && data.errorDetail.detailMessage) {
          detailedMsg = data.errorDetail.detailMessage;
        } else if (data.errorDetail && data.errorDetail.message) {
          detailedMsg = data.errorDetail.message;
        } else if (data.message) {
          detailedMsg = data.message;
        } else {
          detailedMsg = 'Bilinmeyen dogrulama hatasi';
        }

        // Hata kodu / ba\u015fl\u0131k bilgilerini ekle
        if (data.errorCode || data.errorTitle) {
          detailedMsg += '\n\nDetayli Hata:';
          if (data.errorCode)  detailedMsg += '\nHata Kodu: ' + data.errorCode;
          if (data.errorTitle) detailedMsg += '\nHata Basligi: ' + data.errorTitle;
        }

        // Kupon detaylar\u0131n\u0131 (HTML) plain text'e \u00e7evir
        if (data.data && data.data.details) {
          try {
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = data.data.details;
            const plainText = tempDiv.textContent || tempDiv.innerText || '';
            if (plainText.trim()) detailedMsg += '\n\nKupon Detaylari:\n' + plainText.trim();
          } catch (_) {}
        }

        console.error('[KuponMarket] Kupon dogrulama basarisiz:', detailedMsg);
        showMessage(detailedMsg, 'Kupon Dogrulanamadi', 'error');
        return null;
      }
      const resultData = data.data;
      if (resultData && resultData.hasConflict === true) {
        return await handleCouponConflict(resultData, service, checkoutId);
      }
      if (!resultData || !resultData.discountResult) { showMessage('Kupon dogrulandi ancak beklenen veri yapisi alinamadi.', 'Veri Hatasi', 'warning'); return null; }
      if (resultData.discountResult.actionDetails && resultData.discountResult.actionDetails.actionTitle === "Kupon Uygulanamadi") {
        let errorMessage = "Kupon uygulanamadi: ";
        if (resultData.discountResult.actionDetails.actionMessages && resultData.discountResult.actionDetails.actionMessages.length > 0) {
          errorMessage += resultData.discountResult.actionDetails.actionMessages.join("\n\u2022 ");
        } else if (resultData.discountResult.actionDetails.actionDescription) {
          errorMessage += resultData.discountResult.actionDetails.actionDescription;
        }

        // discountResult.details HTML'ini de plain text'e ekle
        if (resultData.discountResult.details) {
          try {
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = resultData.discountResult.details;
            const plainText = tempDiv.textContent || tempDiv.innerText || '';
            if (plainText.trim()) errorMessage += '\n\nKupon Detaylari:\n' + plainText.trim();
          } catch (_) {}
        }

        showMessage(errorMessage, 'Kupon Gecersiz', 'warning');
        return { hasConflict: true, message: errorMessage };
      }
      const resolvedDiscountId = resultData.discountResult.id || resultData.discountResult.discountId || resultData.discountId || couponId;
      if (resolvedDiscountId) window.migrosKupon.validDiscountId = resolvedDiscountId;
      if (couponId && resultData.discountResult) { resultData.discountResult.originalCouponId = couponId; window.migrosKupon.originalCouponId = couponId; }
      return resultData;
    } catch (error) { console.error('[KuponMarket] Kupon dogrulanamadi:', error); showMessage('Bir hata olustu: ' + error.message, 'Hata', 'error'); return null; }
  }

  async function handleCouponConflict(resultData, service, checkoutId) {
    const popupContainer = createPopup();
    const popupTitle = popupContainer.querySelector('#migros-popup-title');
    const popupContent = popupContainer.querySelector('#migros-popup-content');
    const popupButtons = popupContainer.querySelector('#migros-popup-buttons');
    popupTitle.textContent = 'Kupon Cakismasi';
    const newVal = resultData.discountAmountLabel || '?? TL indirim';
    const oldVal = resultData.removableDiscountAmountLabel || '?? TL indirim';
    const oldType = resultData.removableDiscountType || 'indirim';
    popupContent.innerHTML = `
      <p style="margin: 0 0 14px 0; color: #6b7280;">Yeni kupon uygulamak icin mevcut indirimi kaldirmaniz gerekiyor.</p>
      <div style="display: flex; flex-direction: column; gap: 10px; margin-bottom: 14px;">
        <div style="background: linear-gradient(135deg, #f0fdf4 0%, #ecfdf5 100%); border: 1px solid #bbf7d0; border-radius: 10px; padding: 12px 14px; display: flex; justify-content: space-between; align-items: center;">
          <span style="font-weight: 600; color: #16a34a; font-size: 13px;">Yeni Kupon</span>
          <span style="font-weight: 700; color: #16a34a; font-size: 14px;">${newVal}</span>
        </div>
        <div style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 10px; padding: 12px 14px; display: flex; justify-content: space-between; align-items: center;">
          <span style="font-weight: 600; color: #6b7280; font-size: 13px;">Mevcut ${oldType}</span>
          <span style="font-weight: 700; color: #374151; font-size: 14px;">${oldVal}</span>
        </div>
      </div>
      <p style="margin: 0; color: #374151; font-weight: 500; font-size: 13px;">Hangi indirimi uygulamak istersiniz?</p>
    `;
    popupButtons.innerHTML = '';

    let resolvePromise;
    let _resolved = false;
    const conflictPromise = new Promise(resolve => { resolvePromise = resolve; });

    // Tek seferlik resolve helper (\u00e7ift \u00e7\u00f6z\u00fcm\u00fc engeller)
    const resolveOnce = (value) => {
      if (_resolved) return;
      _resolved = true;
      resolvePromise(value);
    };

    // Popup kapatma + Promise iptal helper'\u0131
    const closeAndCancel = () => {
      popupContainer.classList.remove('visible');
      setTimeout(() => { if (popupContainer.parentNode) popupContainer.parentNode.removeChild(popupContainer); }, 300);
      resolveOnce({ hasConflict: true, cancelled: true });
    };

    // X kapat butonu ve backdrop click \u2192 Promise hang fix
    const closeBtn = popupContainer.querySelector('#migros-popup-close');
    if (closeBtn) closeBtn.addEventListener('click', closeAndCancel);
    popupContainer.addEventListener('click', (e) => {
      if (e.target === popupContainer) closeAndCancel();
    });

    const keepOldButton = document.createElement('button');
    keepOldButton.className = 'secondary';
    keepOldButton.textContent = 'Mevcut Indirimi Koru';
    keepOldButton.onclick = closeAndCancel;

    const applyNewButton = document.createElement('button');
    applyNewButton.className = 'primary';
    applyNewButton.textContent = 'Yeni Kuponu Uygula';
    applyNewButton.onclick = async () => {
      popupContainer.classList.remove('visible');
      setTimeout(() => { if (popupContainer.parentNode) popupContainer.parentNode.removeChild(popupContainer); }, 300);

      // Kald\u0131r\u0131lacak indirim tutar\u0131n\u0131 kuru\u015f olarak hesapla ve global state'e yaz
      if (resultData.removableDiscountAmountLabel) {
        try {
          const priceStr = resultData.removableDiscountAmountLabel.replace(/[^0-9,]+/g, '').replace(',', '.');
          const removableAmount = parseFloat(priceStr) * 100; // TL \u2192 kuru\u015f
          if (!isNaN(removableAmount)) {
            window.migrosKupon.conflictResolution = true;
            window.migrosKupon.removableDiscountAmount = removableAmount;
            console.log('[KuponMarket] removableDiscountAmount kayit edildi (kurus):', removableAmount);
          }
        } catch (e) { console.error('[KuponMarket] removableDiscountAmount hesap hatasi:', e); }
      }

      try {
        const timestamp = Date.now().toString() + Math.floor(Math.random() * 1000000).toString().padStart(6, '0');
        let endpoint;
        switch (service) {
          case 'yemek': endpoint = `/yemek/checkouts/${checkoutId}/discounts/resolve-conflict?reid=${timestamp}`; break;
          case 'hemen': endpoint = `/hemen/checkouts/${checkoutId}/discounts/resolve-conflict?reid=${timestamp}`; break;
          default: endpoint = `/checkouts/${checkoutId}/discounts/resolve-conflict?reid=${timestamp}`; break;
        }
        const resp = await sendProxyRequest({
          action: 'proxyRequest', url: `https://www.migros.com.tr/rest${endpoint}`, method: 'POST',
          headers: { 'accept': 'application/json', 'content-type': 'application/json', 'x-forwarded-rest': 'true' },
          body: JSON.stringify({ "campaignType": "COUPON", "bagSelected": true, "deliveryProvider": "NONE", "paymentType": "CREDIT_CARD", "discountId": resultData.discountId })
        });
        const resolveData = JSON.parse(resp.data);

        if (resolveData.successful) {
          // \u00dcst seviyede discountId varsa global state'e yaz
          if (resolveData.data && resolveData.data.discountId) {
            window.migrosKupon.validDiscountId = resolveData.data.discountId;
          }

          if (resolveData.data && resolveData.data.discountResult) {
            // discountResult'a id/discountId patch
            if (resolveData.data.discountId) {
              resolveData.data.discountResult.id = resolveData.data.discountId;
              resolveData.data.discountResult.discountId = resolveData.data.discountId;
            }
            resolveOnce(resolveData.data);
          } else {
            // discountResult yoksa orijinal resultData ile fallback
            console.warn('[KuponMarket] resolve-conflict ba\u015far\u0131l\u0131 ama discountResult yok, orijinal data ile devam');
            resolveOnce(resultData);
          }
        } else {
          showMessage('Kupon cakismasi cozulemedi: ' + (resolveData.errorDetail && resolveData.errorDetail.message || resolveData.message || 'Bilinmeyen hata'), 'Hata', 'error');
          resolveOnce({ hasConflict: true, cancelled: true });
        }
      } catch (error) {
        showMessage('Cakisma cozme hatasi: ' + error.message, 'Hata', 'error');
        resolveOnce({ hasConflict: true, cancelled: true });
      }
    };

    popupButtons.appendChild(keepOldButton);
    popupButtons.appendChild(applyNewButton);
    popupContainer.classList.add('visible');
    return conflictPromise;
  }

  async function applyCouponAction(couponCode, couponId) {
    const checkoutIdMatch = window.location.pathname.match(/\/odeme(?:\/[\w-]+)*\/(\d+)/);
    if (!checkoutIdMatch || !checkoutIdMatch[1]) { showMessage('Siparis ID bulunamadi.', 'Hata', 'error'); return false; }
    const checkoutId = checkoutIdMatch[1];
    const currentService = detectService();
    window.migrosKupon.currentService = currentService;
    if (!currentService) { showMessage('Servis tipi tespit edilemedi', 'Hata', 'error'); return false; }
    const applyButton = document.querySelector('#migros-coupon-container .apply-coupon-button');
    if (applyButton) applyButton.disabled = true;
    try {
      const validationResult = await validateCoupon(currentService, couponCode, checkoutId, couponId);
      if (!validationResult) { clearAppliedCouponUI(); return false; }
      if (validationResult.hasConflict) {
        if (validationResult.cancelled) { clearAppliedCouponUI(); return false; }
        if (validationResult.discountResult) { handleSuccessfulCouponApplication(validationResult.discountResult); showMessage('Kupon basariyla uygulandi!', 'Basarili', 'success'); return true; }
        else { showMessage(validationResult.message || 'Kupon uygulanamadi.', 'Kupon Uygulanamadi', 'warning'); clearAppliedCouponUI(); return false; }
      } else if (validationResult.discountResult) {
        handleSuccessfulCouponApplication(validationResult.discountResult);
        showMessage('Kupon basariyla uygulandi!', 'Basarili', 'success');
        return true;
      } else { showMessage('Kupon dogrulandi ancak uygulanamadi.', 'Hata', 'warning'); clearAppliedCouponUI(); return false; }
    } catch (mainError) { showMessage('Kupon uygulanirken bir hata olustu.', 'Hata', 'error'); return false; }
    finally { if (applyButton) applyButton.disabled = false; }
  }

  // ==================== UI ====================
  function createCouponUI(coupons) {
    if (window.migrosKupon.couponUIContainer) { window.migrosKupon.couponUIContainer.remove(); window.migrosKupon.couponUIContainer = null; }
    const couponContainer = document.createElement('div');
    couponContainer.id = 'migros-coupon-container';
    window.migrosKupon.couponUIContainer = couponContainer;

    const title = document.createElement('div');
    title.className = 'coupon-title';
    title.innerHTML = '<span class="coupon-title-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M21.41 11.58L12.41 2.58C12.05 2.22 11.55 2 11 2H4C2.9 2 2 2.9 2 4V11C2 11.55 2.22 12.05 2.59 12.41L11.59 21.41C11.95 21.77 12.45 22 13 22C13.55 22 14.05 21.77 14.41 21.41L21.41 14.41C21.78 14.05 22 13.55 22 13C22 12.45 21.77 11.95 21.41 11.58ZM5.5 7C4.67 7 4 6.33 4 5.5C4 4.67 4.67 4 5.5 4C6.33 4 7 4.67 7 5.5C7 6.33 6.33 7 5.5 7Z" fill="currentColor"/></svg></span><span>Kupon Uygulama</span>';
    couponContainer.appendChild(title);

    const couponForm = document.createElement('div');
    couponForm.className = 'coupon-form';
    const couponInput = document.createElement('input');
    couponInput.type = 'text'; couponInput.id = 'migros-coupon-input'; couponInput.placeholder = 'Kupon kodunu girin';
    const applyButton = document.createElement('button');
    applyButton.textContent = 'Uygula'; applyButton.className = 'apply-coupon-button';
    couponInput.addEventListener('keypress', function(e) { if (e.key === 'Enter') applyButton.click(); });
    couponForm.appendChild(couponInput); couponForm.appendChild(applyButton);
    couponContainer.appendChild(couponForm);

    const cardWarning = document.createElement('div');
    cardWarning.id = 'migros-card-warning';
    cardWarning.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z" fill="currentColor"/></svg><span>Kupon uygulayabilmek icin once kart bilgilerinizi eksiksiz girin.</span>';
    couponContainer.appendChild(cardWarning);

    const appliedCouponInfo = document.createElement('div');
    appliedCouponInfo.id = 'migros-applied-coupon';
    couponContainer.appendChild(appliedCouponInfo);

    const availableCouponsTitle = document.createElement('div');
    availableCouponsTitle.className = 'available-coupons-title';
    availableCouponsTitle.textContent = 'Kullanilabilir Kuponlar';
    couponContainer.appendChild(availableCouponsTitle);

    const couponList = document.createElement('div');
    couponList.className = 'coupon-list';
    if (coupons && coupons.length > 0) {
      coupons.forEach(coupon => {
        const couponItem = document.createElement('div');
        couponItem.className = 'coupon-list-item';
        const couponInfo = document.createElement('div'); couponInfo.className = 'coupon-item-info';
        const couponName = document.createElement('div'); couponName.className = 'coupon-item-name'; couponName.textContent = coupon.name;
        const couponDescription = document.createElement('div'); couponDescription.className = 'coupon-item-desc'; couponDescription.textContent = coupon.shortDescription || coupon.userDescription || coupon.description || '';
        couponInfo.appendChild(couponName); couponInfo.appendChild(couponDescription);
        if (coupon.cartMinimumRevenue) { const couponMin = document.createElement('div'); couponMin.className = 'coupon-item-min'; couponMin.textContent = 'Min: ' + coupon.cartMinimumRevenue; couponInfo.appendChild(couponMin); }
        couponItem.appendChild(couponInfo);
        const discountVal = coupon.discountValue || coupon.discountAmount;
        if (discountVal) { const couponValue = document.createElement('div'); couponValue.className = 'coupon-item-value'; couponValue.textContent = (discountVal / 100).toFixed(2) + ' TL'; couponItem.appendChild(couponValue); }
        couponItem.setAttribute('data-coupon-id', coupon.id);
        const code = coupon.code || coupon.couponCode;
        if (code) couponItem.setAttribute('data-coupon-code', code);
        couponItem.addEventListener('click', async function() {
          if (!isCardInfoFilled()) { showMessage('Kupon uygulayabilmek icin once kart bilgilerinizi eksiksiz girin.', 'Kart Bilgisi Gerekli', 'warning'); return; }
          const clickedCouponId = this.getAttribute('data-coupon-id');
          const clickedCouponCode = this.getAttribute('data-coupon-code');
          couponInput.value = clickedCouponCode || '';
          await applyCouponAction(clickedCouponCode, clickedCouponId);
        });
        couponList.appendChild(couponItem);
      });
    } else {
      const noCoupons = document.createElement('div');
      noCoupons.className = 'no-coupons-message'; noCoupons.textContent = 'Kullanilabilir kupon bulunamadi.';
      couponList.appendChild(noCoupons);
    }
    couponContainer.appendChild(couponList);

    applyButton.addEventListener('click', async function() {
      if (!isCardInfoFilled()) { showMessage('Kupon uygulayabilmek icin once kart bilgilerinizi eksiksiz girin.', 'Kart Bilgisi Gerekli', 'warning'); return; }
      const couponCode = couponInput.value.trim();
      if (!couponCode) { showMessage('Lutfen bir kupon kodu girin', 'Hata', 'error'); return; }
      await applyCouponAction(couponCode, null);
    });

    setTimeout(() => { updateCouponUICardState(); startCardFieldObserver(); }, 500);
    return couponContainer;
  }

  function handleSuccessfulCouponApplication(couponData) {
    if (!couponData) return;
    window.migrosKupon.appliedCouponData = couponData;
    const finalDiscountId = couponData.id || couponData.discountId || window.migrosKupon.validDiscountId || window.migrosKupon.originalCouponId;
    if (finalDiscountId) window.migrosKupon.validDiscountId = finalDiscountId;

    // sessionStorage'a kaydet
    saveCouponToStorage(couponData, finalDiscountId);

    const appliedCouponInfo = document.getElementById('migros-applied-coupon');
    if (appliedCouponInfo) {
      appliedCouponInfo.style.display = 'block';
      const removeButton = document.createElement('button');
      removeButton.innerHTML = '&times;'; removeButton.title = 'Kuponu Kaldir'; removeButton.className = 'remove-coupon-button';
      removeButton.onclick = () => { clearAppliedCouponUI(true); };
      appliedCouponInfo.innerHTML = '<div class="applied-coupon-content"><div class="applied-coupon-info"><div class="applied-coupon-name">Kupon Uygulandi: ' + (couponData.name || 'Isimsiz Kupon') + '</div><div class="applied-coupon-code">' + (couponData.code || 'ID: ' + (finalDiscountId || 'Yok')) + '</div></div><div class="applied-coupon-value">-' + ((couponData.discountValue || 0) / 100).toFixed(2) + ' TL</div></div>';
      appliedCouponInfo.querySelector('.applied-coupon-content').appendChild(removeButton);
    }
    updatePriceSummaryUI(couponData.discountValue);
  }

  function updatePriceSummaryUI(discountValue) {
    const priceSummaryContent = document.querySelector('fe-line-checkout-price-summary .summary-content');
    const mobileSummaryContent = document.querySelector('.checkout-summary-mobile__content');
    const totalPriceElements = document.querySelectorAll('fe-line-checkout-price-summary .summary > .subtitle-1.text-align-right, .checkout-summary-mobile__content .revenue');
    if (!priceSummaryContent && !mobileSummaryContent) return;
    document.querySelectorAll('#migros-summary-coupon-discount, #migros-summary-coupon-discount-direct, #migros-mobile-coupon-discount, #migros-custom-discounts').forEach(el => el.remove());

    if (priceSummaryContent) {
      const discountRow = document.createElement('div'); discountRow.id = 'migros-summary-coupon-discount';
      discountRow.innerHTML = '<p>Kupon Indirimi</p><p>-' + (discountValue / 100).toFixed(2) + ' TL</p>';
      priceSummaryContent.appendChild(discountRow);
    }
    if (mobileSummaryContent) {
      const mobileRow = document.createElement('div'); mobileRow.id = 'migros-mobile-coupon-discount';
      mobileRow.className = 'revenue-container coupon-discount'; mobileRow.style.marginBottom = '0.5rem'; mobileRow.style.color = '#228B22';
      mobileRow.innerHTML = '<div class="mat-caption-normal">Kupon Indirimi</div><h3 class="revenue">-' + (discountValue / 100).toFixed(2) + ' TL</h3>';
      const rc = mobileSummaryContent.querySelector('.revenue-container');
      if (rc) mobileSummaryContent.insertBefore(mobileRow, rc); else mobileSummaryContent.insertBefore(mobileRow, mobileSummaryContent.firstChild);
    }
    try {
      let currentTotal = 0;
      if (window.migrosKupon.originalPrice === null) {
        if (totalPriceElements && totalPriceElements.length > 0) {
          window.migrosKupon.originalPrice = parseFloat(totalPriceElements[0].textContent.trim().replace(/[^0-9,-]+/g, "").replace(",", "."));
          currentTotal = window.migrosKupon.originalPrice;
        }
      } else { currentTotal = window.migrosKupon.originalPrice; }
      if (!isNaN(currentTotal) && currentTotal > 0) {
        const newTotal = (currentTotal - (discountValue / 100)).toFixed(2).replace('.', ',');
        totalPriceElements.forEach(el => { el.textContent = newTotal + ' TL'; });
      }
    } catch(e) { console.error('[KuponMarket] Odenecek tutar guncellenemedi:', e); }
  }

  function clearAppliedCouponUI(resetGlobals) {
    const appliedCouponInfo = document.getElementById('migros-applied-coupon');
    if (appliedCouponInfo) { appliedCouponInfo.style.display = 'none'; appliedCouponInfo.innerHTML = ''; }
    document.querySelectorAll('#migros-summary-coupon-discount, #migros-summary-coupon-discount-direct, #migros-mobile-coupon-discount, #migros-custom-discounts').forEach(el => el.remove());
    try {
      if (window.migrosKupon.originalPrice !== null) {
        const totalPriceElements = document.querySelectorAll('fe-line-checkout-price-summary .summary > .subtitle-1.text-align-right, .checkout-summary-mobile__content .revenue');
        const originalPriceFormatted = window.migrosKupon.originalPrice.toFixed(2).replace('.', ',');
        totalPriceElements.forEach(element => { element.textContent = originalPriceFormatted + ' TL'; });
      }
    } catch(e) {}
    if (resetGlobals) {
      window.migrosKupon.appliedCouponData = null; window.migrosKupon.validDiscountId = null;
      window.migrosKupon.originalCouponId = null; window.migrosKupon.originalPrice = null;
      clearCouponFromStorage(); // sessionStorage'? temizle
      const couponInput = document.getElementById('migros-coupon-input');
      if (couponInput) couponInput.value = '';
    }
  }

  // ==================== ADD UI ====================
  function addCouponUI() {
    // Basit selector - fe-line-checkout elementlerini bul
    const desktopTarget = document.querySelector('fe-line-checkout-summary-desktop');
    const mobileTarget = document.querySelector('fe-line-checkout-price-summary.mobile-only');
    const paymentSummaryContainer = mobileTarget || desktopTarget;

    if (!paymentSummaryContainer) {
      console.log('[KuponMarket] Odeme ozeti bolumu bulunamadi, UI eklenmiyor');
      return;
    }

    if (document.getElementById('migros-coupon-container')) {
      console.log('[KuponMarket] Kupon UI zaten ekli');
      return;
    }

    window.migrosKupon.currentService = detectService();
    if (!window.migrosKupon.currentService) {
      console.log('[KuponMarket] Servis tipi tespit edilemedi');
      return;
    }

    console.log('[KuponMarket] Migros servis tipi:', window.migrosKupon.currentService);

    // sessionStorage'dan kupon verisini geri y?kle
    const savedCoupon = loadCouponFromStorage();

    fetchCoupons(window.migrosKupon.currentService).then(coupons => {
      console.log('[KuponMarket] Kuponlar alindi:', coupons.length);
      const couponUI = createCouponUI(coupons);
      
      // UI'yi fiyat ?zetinin ?st?ne ekle
      paymentSummaryContainer.parentNode.insertBefore(couponUI, paymentSummaryContainer);
      console.log('[KuponMarket] Kupon UI eklendi, target:', paymentSummaryContainer.tagName);
      
      // Kaydedilmi? kupon varsa g?ster
      if (savedCoupon && savedCoupon.appliedCouponData) {
        console.log('[KuponMarket] Kaydedilmis kupon geri yukleniyor...');
        handleSuccessfulCouponApplication(savedCoupon.appliedCouponData);
      } else if (window.migrosKupon.appliedCouponData) {
        handleSuccessfulCouponApplication(window.migrosKupon.appliedCouponData);
      }
    }).catch(error => { 
      console.error('[KuponMarket] UI eklenirken kuponlar getirilemedi:', error); 
    });
  }

  // ==================== MONITOR ====================
  function monitorPageChanges() {
    let lastUrl = location.href;
    let uiAddAttempted = false;

    console.log('[KuponMarket] Sayfa izleme basladi, URL:', location.href);

    const observer = new MutationObserver((mutations) => {
      let paymentSummaryAppeared = false;
      for (const mutation of mutations) {
        if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
          for (const node of mutation.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              // Daha esnek selector kontrol?
              if (node.matches && (
                node.matches('fe-line-checkout-price-summary') || 
                node.querySelector('fe-line-checkout-price-summary') || 
                node.matches('fe-line-checkout-summary-desktop') || 
                node.querySelector('fe-line-checkout-summary-desktop') ||
                node.matches('sm-delivery-payment') ||
                node.querySelector('sm-delivery-payment') ||
                node.matches('[class*="summary"]') ||
                node.querySelector('[class*="summary"]')
              )) {
                paymentSummaryAppeared = true;
                console.log('[KuponMarket] Fiyat ozeti DOM\'a eklendi');
                break;
              }
            }
          }
        }
        if (paymentSummaryAppeared) break;
      }

      if (lastUrl !== location.href || paymentSummaryAppeared) {
        if (lastUrl !== location.href) {
          console.log('[KuponMarket] URL degisti:', lastUrl, '->', location.href);
        }
        lastUrl = location.href; 
        uiAddAttempted = false;
        
        if (!location.href.includes('/odeme/')) {
          console.log('[KuponMarket] Odeme sayfasindan cikis yapildi, UI temizleniyor');
          clearAppliedCouponUI(true);
          if (window.migrosKupon.couponUIContainer) { 
            window.migrosKupon.couponUIContainer.remove(); 
            window.migrosKupon.couponUIContainer = null; 
          }
        }
      }

      if (!uiAddAttempted && location.href.includes('/odeme/')) {
        const paymentSummaryAvailable = document.querySelector('fe-line-checkout-price-summary') ||
                                         document.querySelector('fe-line-checkout-summary-desktop') ||
                                         document.querySelector('sm-delivery-payment') ||
                                         document.querySelector('[class*="summary"]');
        
        if (paymentSummaryAvailable && !document.getElementById('migros-coupon-container')) { 
          console.log('[KuponMarket] Odeme sayfasinda, kupon UI ekleniyor...');
          addCouponUI(); 
          uiAddAttempted = true; 
        } else if (!paymentSummaryAvailable) {
          console.log('[KuponMarket] Odeme sayfasinda ama fiyat ozeti henuz hazir degil');
        }
      }
    });

    if (document.body) {
      observer.observe(document.body, { childList: true, subtree: true });
      console.log('[KuponMarket] MutationObserver aktif');
    } else {
      console.warn('[KuponMarket] document.body bulunamadi, observer baslatilmadi');
    }

    // ?lk y?kleme kontrol?
    if (location.href.includes('/odeme/')) {
      console.log('[KuponMarket] Odeme sayfasinda, 2 saniye sonra UI eklenecek');
      setTimeout(() => { 
        if (!document.getElementById('migros-coupon-container')) {
          console.log('[KuponMarket] Timeout sonrasi kupon UI ekleniyor');
          addCouponUI(); 
        } else {
          console.log('[KuponMarket] Kupon UI zaten var');
        }
      }, 2000);
    }
  }

  // ==================== HISTORY OVERRIDE ====================
  if (!window._kuponMarketHistoryOverrideActive) {
    window._kuponMarketHistoryOverrideActive = true;
    const _origPush = history.pushState;
    const _origReplace = history.replaceState;
    history.pushState = function() { _origPush.apply(history, arguments); window.postMessage({ source: 'KUPONMARKET_INJECT', action: 'spaNavigate', url: location.href }, '*'); };
    history.replaceState = function() { _origReplace.apply(history, arguments); window.postMessage({ source: 'KUPONMARKET_INJECT', action: 'spaNavigate', url: location.href }, '*'); };
    window.addEventListener('popstate', function() { window.postMessage({ source: 'KUPONMARKET_INJECT', action: 'spaNavigate', url: location.href }, '*'); });
  }

  // ==================== PWA BLOCK ====================
  function removePWAManifestLinks() {
    document.querySelectorAll('link[rel="manifest"], link[href*="manifest.json"], link[href*="ngsw.json"]').forEach(link => link.remove());
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            if (node.tagName === 'LINK' && (node.rel === 'manifest' || (node.href && (node.href.includes('manifest.json') || node.href.includes('ngsw.json'))))) node.remove();
            const links = node.querySelectorAll && node.querySelectorAll('link[rel="manifest"], link[href*="manifest.json"], link[href*="ngsw.json"]');
            if (links) links.forEach(link => link.remove());
          }
        });
      });
    });
    if (document.head) observer.observe(document.head, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', removePWAManifestLinks);
  } else {
    removePWAManifestLinks();
  }

  // ==================== XHR INTERCEPT (BAN \u00d6NLEME + KUPON) ====================
  const originalXHROpen = XMLHttpRequest.prototype.open;
  const originalXHRSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function(method, url, ...args) {
    this._kmRequestUrl = url;
    this._kmRequestMethod = method;

    // Ban-detection flag'lerini i\u015faretle
    if (typeof url === 'string') {
      if (isServiceWorkerFile(url))            this._kmIsServiceWorker = true;
      if (isPWAManifestFile(url))              this._kmIsPWAManifest = true;
      if (isProfileIconFile(url))              this._kmIsProfileIcon = true;
      if (isAnalyticsOrTrackingEndpoint(url))  this._kmIsAnalyticsBlocked = true;
    }

    return originalXHROpen.apply(this, [method, url, ...args]);
  };

  // XHR'\u0131 sahte yan\u0131tla doldurma yard\u0131mc\u0131s\u0131
  function _kmMockXhrEmpty(xhr, status) {
    status = status || 404;
    xhr.abort();
    Object.defineProperty(xhr, 'readyState',   { configurable: true, get: function() { return 4; } });
    Object.defineProperty(xhr, 'status',       { configurable: true, get: function() { return status; } });
    Object.defineProperty(xhr, 'statusText',   { configurable: true, get: function() { return status === 404 ? 'Not Found' : ''; } });
    Object.defineProperty(xhr, 'responseText', { configurable: true, get: function() { return ''; } });
    Object.defineProperty(xhr, 'response',     { configurable: true, get: function() { return ''; } });
    setTimeout(function() {
      try { if (typeof xhr.onerror === 'function')            xhr.onerror(); } catch(_) {}
      try { if (typeof xhr.onreadystatechange === 'function') xhr.onreadystatechange(); } catch(_) {}
      try { if (typeof xhr.onloadend === 'function')          xhr.onloadend(); } catch(_) {}
      try { xhr.dispatchEvent(new Event('error')); } catch(_) {}
      try { xhr.dispatchEvent(new Event('readystatechange')); } catch(_) {}
      try { xhr.dispatchEvent(new Event('loadend')); } catch(_) {}
    }, 0);
  }

  // XHR'\u0131 sahte 200 JSON yan\u0131tla doldurma
  function _kmMockXhrJson(xhr, jsonString) {
    xhr.abort();
    Object.defineProperty(xhr, 'readyState',   { configurable: true, get: function() { return 4; } });
    Object.defineProperty(xhr, 'status',       { configurable: true, get: function() { return 200; } });
    Object.defineProperty(xhr, 'statusText',   { configurable: true, get: function() { return 'OK'; } });
    Object.defineProperty(xhr, 'responseText', { configurable: true, get: function() { return jsonString; } });
    Object.defineProperty(xhr, 'response',     { configurable: true, get: function() { return jsonString; } });
    setTimeout(function() {
      try { if (typeof xhr.onreadystatechange === 'function') xhr.onreadystatechange(); } catch(_) {}
      try { if (typeof xhr.onload === 'function')             xhr.onload(); } catch(_) {}
      try { if (typeof xhr.onloadend === 'function')          xhr.onloadend(); } catch(_) {}
      try { xhr.dispatchEvent(new Event('readystatechange')); } catch(_) {}
      try { xhr.dispatchEvent(new Event('load')); } catch(_) {}
      try { xhr.dispatchEvent(new Event('loadend')); } catch(_) {}
    }, 0);
  }

  XMLHttpRequest.prototype.send = function(body) {
    // 1) Service Worker dosyas\u0131n\u0131 engelle
    if (this._kmIsServiceWorker) {
      _kmMockXhrEmpty(this, 404);
      return;
    }

    // 2) PWA manifest / cookie-settings engelle
    if (this._kmIsPWAManifest) {
      _kmMockXhrEmpty(this, 404);
      return;
    }

    // 3) Profil ikonu engelle
    if (this._kmIsProfileIcon) {
      _kmMockXhrEmpty(this, 404);
      return;
    }

    // 4) Analytics/tracking endpoint'lerini engelle
    if (this._kmIsAnalyticsBlocked) {
      _kmMockXhrEmpty(this, 0);
      return;
    }

    // 5) Screen-views \u2192 sahte 200 {} yan\u0131t
    if (isScreenViewsEndpoint(this._kmRequestUrl)) {
      _kmMockXhrJson(this, '{}');
      return;
    }

    // 6) Perseus analytics \u2192 sahte 200 {} yan\u0131t
    if (isPerseusAnalyticsEndpoint(this._kmRequestUrl)) {
      _kmMockXhrJson(this, '{}');
      return;
    }

    // 7) users/tokens \u2192 her seferinde yeni UUID (cihaz parmak izi yenile)
    if (isTokenEndpoint(this._kmRequestUrl)) {
      _kmMockXhrJson(this, JSON.stringify({ token: generateUUIDv4() }));
      return;
    }

    // 8) Logout endpoint'i \u2192 sahte 500 yan\u0131t (ban-detection'a kar\u015f\u0131)
    if (this._kmRequestMethod === 'POST' && isLogoutEndpoint(this._kmRequestUrl)) {
      this.abort();
      const xhr = this;
      Object.defineProperty(xhr, 'readyState',   { configurable: true, get: function() { return 4; } });
      Object.defineProperty(xhr, 'status',       { configurable: true, get: function() { return 500; } });
      Object.defineProperty(xhr, 'statusText',   { configurable: true, get: function() { return 'Internal Server Error'; } });
      Object.defineProperty(xhr, 'responseText', { configurable: true, get: function() { return ''; } });
      Object.defineProperty(xhr, 'response',     { configurable: true, get: function() { return ''; } });
      setTimeout(function() {
        try { if (typeof xhr.onreadystatechange === 'function') xhr.onreadystatechange(); } catch(_) {}
        try { if (typeof xhr.onload === 'function')             xhr.onload(); } catch(_) {}
        try { if (typeof xhr.onloadend === 'function')          xhr.onloadend(); } catch(_) {}
        try { xhr.dispatchEvent(new Event('readystatechange')); } catch(_) {}
        try { xhr.dispatchEvent(new Event('load')); } catch(_) {}
        try { xhr.dispatchEvent(new Event('loadend')); } catch(_) {}
      }, 50);
      return;
    }

    // 9) Migros kupon \u00f6deme iste\u011fini manip\u00fcle et (XHR)
    if (this._kmRequestMethod === 'POST' &&
        this._kmRequestUrl && this._kmRequestUrl.includes('/purchase/online/credit-card') &&
        window.migrosKupon && window.migrosKupon.appliedCouponData) {
      try {
        const discountId = window.migrosKupon.validDiscountId || window.migrosKupon.originalCouponId;
        if (discountId && typeof body === 'string') {
          const requestBody = JSON.parse(body);
          requestBody.balanceType = 'COUPON';
          requestBody.balanceValue = String(discountId);
          requestBody.discount = window.migrosKupon.appliedCouponData.discountValue;
          console.log('[KuponMarket] XHR purchase body enjekte edildi:', { balanceType: 'COUPON', balanceValue: String(discountId), discount: requestBody.discount });
          return originalXHRSend.call(this, JSON.stringify(requestBody));
        } else if (!discountId) {
          console.error('[KuponMarket] XHR - Kupon ID bulunamadi!');
        }
      } catch (error) {
        console.error('[KuponMarket] XHR purchase intercept hatasi:', error);
      }
    }
    return originalXHRSend.call(this, body);
  };

  // ==================== FETCH INTERCEPT (BAN \u00d6NLEME + KUPON) ====================
  const originalFetch = window.fetch;
  window.fetch = async function(resource, init) {
    const url = typeof resource === 'string' ? resource : (resource && resource.url) || '';

    // 1) Service Worker dosyas\u0131 \u2192 404
    if (isServiceWorkerFile(url)) {
      return new Response('', { status: 404, statusText: 'Not Found', headers: { 'Content-Type': 'text/plain' } });
    }

    // 2) PWA manifest / cookie-settings \u2192 404
    if (isPWAManifestFile(url)) {
      return new Response('', { status: 404, statusText: 'Not Found', headers: { 'Content-Type': 'application/json' } });
    }

    // 3) Profil ikonu \u2192 404
    if (isProfileIconFile(url)) {
      return new Response('', { status: 404, statusText: 'Not Found', headers: { 'Content-Type': 'image/webp' } });
    }

    // 4) Analytics/tracking \u2192 reject (network error)
    if (isAnalyticsOrTrackingEndpoint(url)) {
      return Promise.reject(new TypeError('Failed to fetch'));
    }

    // 5) Screen-views \u2192 sahte 200 {}
    if (isScreenViewsEndpoint(url)) {
      return new Response('{}', { status: 200, statusText: 'OK', headers: { 'Content-Type': 'application/json' } });
    }

    // 6) Perseus analytics \u2192 sahte 200 {}
    if (isPerseusAnalyticsEndpoint(url)) {
      return new Response('{}', { status: 200, statusText: 'OK', headers: { 'Content-Type': 'application/json' } });
    }

    // 7) users/tokens \u2192 sahte UUID
    if (isTokenEndpoint(url)) {
      return new Response(
        JSON.stringify({ token: generateUUIDv4() }),
        { status: 200, statusText: 'OK', headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 8) Logout endpoint'i \u2192 sahte 500
    if (init && init.method === 'POST' && isLogoutEndpoint(url)) {
      return new Response('', { status: 500, statusText: 'Internal Server Error' });
    }

    // 9) Purchase endpoint'i yakala (\u00f6deme iste\u011fi)
    if (init && init.method === 'POST' && url.includes('/purchase/online/credit-card')) {
      console.log('[KuponMarket] Purchase istegi yakalandi:', url);

      try {
        // XHR ile ayn\u0131 fallback zinciri (\u00f6nceden sadece validDiscountId kullan\u0131l\u0131yordu)
        const discountId = window.migrosKupon.validDiscountId || window.migrosKupon.originalCouponId;

        if (discountId && window.migrosKupon.appliedCouponData) {
          console.log('[KuponMarket] Kupon mevcut, discountId:', discountId);

          const discountValue = window.migrosKupon.appliedCouponData.discountValue
                              || window.migrosKupon.appliedCouponData.discountAmount
                              || 0;

          // Purchase request body'ye kupon bilgisini enjekte et (XHR ile ayn\u0131 davran\u0131\u015f).
          // /discounts/checks zaten validateCoupon i\u00e7inde \u00e7a\u011fr\u0131l\u0131yor; burada tekrar etmeye gerek yok.
          const modifiedInit = { ...init };
          if (typeof modifiedInit.body === 'string') {
            try {
              const requestBody = JSON.parse(modifiedInit.body);
              requestBody.balanceType = 'COUPON';
              requestBody.balanceValue = String(discountId);
              requestBody.discount = discountValue;
              modifiedInit.body = JSON.stringify(requestBody);
              console.log('[KuponMarket] Fetch purchase body enjekte edildi:', {
                balanceType: 'COUPON',
                balanceValue: String(discountId),
                discount: discountValue
              });
            } catch (parseErr) {
              console.error('[KuponMarket] Purchase body parse hatasi:', parseErr);
            }
          }

          return originalFetch.call(this, resource, modifiedInit).then(async response => {
            try {
              const cloned = response.clone();
              const responseData = await cloned.json();
              if (responseData && !responseData.successful) {
                console.error('[KuponMarket] PURCHASE BA\u015eARISIZ:', {
                  errorCode: responseData.errorCode,
                  errorDetail: responseData.errorDetail
                });
              } else {
                console.log('[KuponMarket] PURCHASE BA\u015eARILI');
              }
            } catch (_) {}
            return response;
          });
        }

        console.log('[KuponMarket] Kupon yok veya discountId bulunamadi, normal odeme istegi');
      } catch (error) {
        console.error('[KuponMarket] Purchase intercept hatasi:', error);
      }
    }
    
    // Normal request
    return originalFetch.apply(this, arguments);
  };

  // ==================== START ====================
  // sessionStorage'dan kupon y?kle
  loadCouponFromStorage();
  
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    monitorPageChanges();
  } else {
    window.addEventListener('load', function() { monitorPageChanges(); });
  }

  console.log('[KuponMarket] Migros kupon sistemi yuklendi');
})();
