(function () {
  'use strict';
  var host = window.location.hostname;
  if (!host.includes('uber.com') && !host.includes('cdn-net.com') && !host.includes('cdn-path.com')) return;
  
  // ============================================
  // UBER YOLCULUK ARAMA OVERLAY + REFRESH KORUMA
  // ============================================
  let _tripSearchActive = false;
  let _tripSearchTimer = null;
  let _tripCountdownInterval = null;
  let _tripFoundObserver = null;
  let _tripFoundPoller = null;

  // Logo yüklenemezse (offline, ağ hatası vb.) metin marka geri döner. Inline
  // onerror HTML attribute'u YERİNE JS property ataması kullanılıyor çünkü
  // Uber'in sayfa CSP'si inline event handler attribute'larını engelleyebilir —
  // bir script'ten .onerror atamak CSP'nin inline-script kısıtlamasına takılmaz.
  function wireBrandLogoFallback(imgId) {
    const img = document.getElementById(imgId);
    if (!img) return;
    img.onerror = function () {
      const fallback = document.createElement('div');
      fallback.className = 'km-trip-brand';
      fallback.innerHTML = '<b>Kupon</b> Market';
      img.replaceWith(fallback);
    };
  }

  function showTripSearchOverlay() {
    if (document.getElementById('km-trip-overlay')) return;
    _tripSearchActive = true;

    const CIRC = 2 * Math.PI * 28; // r=28 SVG çemberi

    const style = document.createElement('style');
    style.id = 'km-trip-overlay-style';
    style.textContent = `
      #km-trip-overlay{position:fixed;inset:0;background:rgba(9,10,20,0.72);display:flex;flex-direction:column;justify-content:center;align-items:center;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);animation:ksTripFadeIn .25s ease;}
      @keyframes ksTripFadeIn{from{opacity:0;}to{opacity:1;}}

      .km-trip-card{position:relative;background:#fff;border-radius:22px;padding:34px 30px 26px;max-width:330px;width:90%;text-align:center;box-shadow:0 24px 70px rgba(0,0,0,0.35),0 2px 8px rgba(0,0,0,0.08);overflow:hidden;animation:ksTripCardIn .3s cubic-bezier(.2,.8,.3,1);}
      @keyframes ksTripCardIn{from{opacity:0;transform:translateY(10px) scale(.97);}to{opacity:1;transform:translateY(0) scale(1);}}
      .km-trip-card::before{content:"";position:absolute;top:0;left:0;right:0;height:4px;background:linear-gradient(90deg,#e94560,#ff6b81,#e94560);background-size:200% 100%;animation:ksTripBarShine 2.2s linear infinite;}
      @keyframes ksTripBarShine{to{background-position:-200% 0;}}

      .km-trip-radar{position:relative;width:104px;height:104px;margin:4px auto 18px;display:flex;align-items:center;justify-content:center;}
      .km-trip-radar-ring{position:absolute;width:64px;height:64px;border-radius:50%;background:radial-gradient(circle,rgba(233,69,96,0.35),rgba(233,69,96,0) 70%);animation:ksRadarPulse 2.4s ease-out infinite;}
      .km-trip-radar-ring.r2{animation-delay:.8s;}
      .km-trip-radar-ring.r3{animation-delay:1.6s;}
      @keyframes ksRadarPulse{0%{transform:scale(.6);opacity:.7;}100%{transform:scale(2.05);opacity:0;}}

      .km-trip-progress-wrap{position:relative;width:72px;height:72px;display:flex;align-items:center;justify-content:center;filter:drop-shadow(0 4px 10px rgba(233,69,96,0.25));}
      .km-trip-progress{position:absolute;inset:0;transform:rotate(-90deg);}
      .km-trip-progress-bg{fill:none;stroke:#f1f1f4;stroke-width:5;}
      .km-trip-progress-fg{fill:none;stroke:url(#ksTripGrad);stroke-width:5;stroke-linecap:round;stroke-dasharray:${CIRC};stroke-dashoffset:0;transition:stroke-dashoffset 1s linear;}
      .km-trip-core{position:relative;width:52px;height:52px;border-radius:50%;background:linear-gradient(135deg,#1a1a2e,#16213e);display:flex;align-items:center;justify-content:center;box-shadow:inset 0 0 0 1px rgba(255,255,255,0.06);}
      .km-trip-core svg.km-trip-car{width:24px;height:24px;}

      .km-trip-title{font-size:17px;font-weight:800;color:#15161f;margin-bottom:6px;letter-spacing:-.2px;}
      .km-trip-sub{font-size:13px;color:#6b7280;line-height:1.55;margin-bottom:14px;}
      .km-trip-status{display:inline-flex;align-items:center;gap:6px;font-size:11.5px;color:#e94560;font-weight:700;background:rgba(233,69,96,0.08);border:1px solid rgba(233,69,96,0.18);padding:5px 12px;border-radius:99px;margin-bottom:16px;min-height:15px;max-width:100%;}
      .km-trip-status:empty{display:none;}
      .km-trip-status .km-trip-dot{width:6px;height:6px;border-radius:50%;background:#e94560;flex-shrink:0;animation:ksDotBlink 1.2s ease-in-out infinite;}
      @keyframes ksDotBlink{0%,100%{opacity:1;}50%{opacity:.25;}}

      .km-trip-timer-row{display:flex;align-items:center;justify-content:center;gap:6px;margin-bottom:18px;}
      .km-trip-countdown{font-size:26px;font-weight:800;color:#15161f;font-variant-numeric:tabular-nums;letter-spacing:.5px;}
      .km-trip-timer-label{font-size:11px;color:#9ca3af;font-weight:600;text-transform:uppercase;letter-spacing:.4px;}

      .km-trip-warn{display:flex;align-items:flex-start;gap:8px;text-align:left;font-size:11.5px;line-height:1.5;color:#92400e;background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.22);padding:10px 12px;border-radius:12px;}
      .km-trip-warn-icon{flex-shrink:0;font-size:14px;line-height:1.5;}

      .km-trip-brand{margin-top:18px;font-size:10.5px;font-weight:700;color:#c7c9d1;letter-spacing:.3px;}
      .km-trip-brand b{color:#e94560;}
      .km-trip-brand-logo{display:block;height:18px;width:auto;margin:18px auto 0;opacity:.9;}

      .km-trip-result-icon{width:64px;height:64px;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 16px;animation:ksResultPop .35s cubic-bezier(.2,.8,.3,1);}
      .km-trip-result-ok{background:linear-gradient(135deg,#10b981,#34d399);box-shadow:0 10px 24px rgba(16,185,129,0.35);}
      .km-trip-result-warn{background:linear-gradient(135deg,#f59e0b,#f97316);box-shadow:0 10px 24px rgba(245,158,11,0.32);}
      @keyframes ksResultPop{from{transform:scale(.5);opacity:0;}to{transform:scale(1);opacity:1;}}
    `;
    const overlay = document.createElement('div');
    overlay.id = 'km-trip-overlay';
    overlay.innerHTML = `
      <div class="km-trip-card">
        <div class="km-trip-radar">
          <span class="km-trip-radar-ring r1"></span>
          <span class="km-trip-radar-ring r2"></span>
          <span class="km-trip-radar-ring r3"></span>
          <div class="km-trip-progress-wrap">
            <svg width="0" height="0" style="position:absolute;">
              <defs>
                <linearGradient id="ksTripGrad" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stop-color="#e94560"/>
                  <stop offset="100%" stop-color="#ff6b81"/>
                </linearGradient>
              </defs>
            </svg>
            <svg class="km-trip-progress" viewBox="0 0 64 64">
              <circle class="km-trip-progress-bg" cx="32" cy="32" r="28"></circle>
              <circle class="km-trip-progress-fg" id="km-trip-progress-fg" cx="32" cy="32" r="28"></circle>
            </svg>
            <div class="km-trip-core">
              <svg class="km-trip-car" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M5 11l1.6-4.8A2 2 0 0 1 8.5 5h7a2 2 0 0 1 1.9 1.2L19 11" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
                <rect x="3" y="11" width="18" height="6.5" rx="2" stroke="#fff" stroke-width="1.6"/>
                <circle cx="7.5" cy="17.5" r="1.6" fill="#fff"/>
                <circle cx="16.5" cy="17.5" r="1.6" fill="#fff"/>
              </svg>
            </div>
          </div>
        </div>
        <div class="km-trip-title" id="km-trip-title">Yolculuk Aranıyor</div>
        <div class="km-trip-sub" id="km-trip-sub">Proxy üzerinden istek gönderiliyor...</div>
        <div class="km-trip-status" id="km-trip-status"></div>
        <div class="km-trip-timer-row">
          <span class="km-trip-countdown" id="km-trip-countdown">2:00</span>
          <span class="km-trip-timer-label">kalan süre</span>
        </div>
        <div class="km-trip-warn">
          <span class="km-trip-warn-icon">⚠️</span>
          <span>Sayfayı yenilemeyin veya kapatmayın. Hesabınızın güvenliği için beklemeniz gerekiyor.</span>
        </div>
        <div class="km-trip-brand"><b>Kupon</b> Market</div>
      </div>
    `;
    document.documentElement.appendChild(style);
    document.documentElement.appendChild(overlay);
    

    const TOTAL = 120;
    let remaining = TOTAL;
    const countdownEl = document.getElementById('km-trip-countdown');
    const progressEl = document.getElementById('km-trip-progress-fg');
    const statusEl = document.getElementById('km-trip-status');

    function renderProgress() {
      if (!progressEl) return;
      const elapsed = TOTAL - remaining;
      const offset = CIRC * (elapsed / TOTAL);
      progressEl.style.strokeDashoffset = String(offset);
    }
    renderProgress();
    void statusEl; // updateOverlayStatus() metni + canlı noktayı birlikte yönetir

    _tripCountdownInterval = setInterval(() => {
      remaining--;
      if (remaining <= 0) {
        clearInterval(_tripCountdownInterval);
        _tripCountdownInterval = null;
        finishTripSearch(false, 'Süre doldu. Sayfayı yenileyerek tekrar deneyebilirsiniz.');
        return;
      }
      const m = Math.floor(remaining / 60);
      const s = remaining % 60;
      if (countdownEl) countdownEl.textContent = `${m}:${s.toString().padStart(2, '0')}`;
      renderProgress();
    }, 1000);

    _tripSearchTimer = setTimeout(() => {
      finishTripSearch(false, 'Süre doldu.');
    }, 120000);
  }

  function updateOverlayStatus(title, sub, status) {
    const titleEl = document.getElementById('km-trip-title');
    const subEl = document.getElementById('km-trip-sub');
    const statusEl = document.getElementById('km-trip-status');
    if (titleEl && title) titleEl.textContent = title;
    if (subEl && sub) subEl.textContent = sub;
    if (statusEl && status !== undefined) {
      if (status) {
        statusEl.innerHTML = '<span class="km-trip-dot"></span><span>' +
          String(status).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c])) +
          '</span>';
      } else {
        statusEl.innerHTML = '';
      }
    }
  }

  // NOT: Çift yolculuk isteği (2 taksi çağırma) artık uber-interceptor-ios.js'teki
  // ağ seviyesindeki kilit (_ksTripInFlight) tarafından mimari olarak engelleniyor —
  // yani bu fonksiyonun yanlışlıkla erken "bulundu" demesi artık bir güvenlik
  // sorunu değil, sadece UX detayı. Bu yüzden buradaki tespit, önceki sürümde
  // olduğu gibi GERÇEK eşleşmeleri kaçırmamaya öncelik veriyor; aşırı temkinli
  // davranıp kullanıcıyı "aranıyor" ekranında gereksiz yere bekletmiyor.
  // - "strong": URL değişimi veya net atama/takip metni — tek doğrulamada kabul edilir.
  // - "medium": sürücüye özgü yapısal DOM elemanları (arama ekranında bulunmaz) — küçük
  //   bir tampon için 2 ardışık kontrolde kabul edilir.
  function detectTripFound() {
    const url = window.location.href.toLowerCase();
    if (
      /\/(go\/)?trip\//.test(url) ||
      /\/orders\/[a-f0-9-]+/.test(url) ||
      /\/go\/(pickup|dropoff)\b/.test(url) ||
      /\/trip-request\//.test(url)
    ) {
      return { strength: 'strong', type: 'url' };
    }

    const body = document.body;
    if (!body) return null;
    const text = body.innerText || '';

    const strongPatterns = [
      /sürücü.{0,20}(bulundu|eşleşti|atandı|yolda)/i,
      /driver.{0,20}(found|matched|assigned|arriving|on the way)/i,
      /sipariş.{0,20}(onaylandı|kabul edildi|hazırlanıyor)/i,
      /order.{0,20}(confirmed|accepted|preparing|placed)/i,
      /delivering|teslim ediliyor/i,
      /arriving in \d+ min/i,
      /\d+ dakika.{0,10}(içinde|kaldı|sonra)/i,
      /tahmini varış|estimated arrival/i,
      /(aracınızı|sürücünüzü) takip|track (your )?(driver|trip|vehicle)/i,
      /sürücünüzle (mesajlaş|iletişim)|message (your )?driver/i,
      /yolculuğunuzu paylaş|share (your )?trip/i,
    ];
    if (strongPatterns.some((p) => p.test(text))) {
      return { strength: 'strong', type: 'dom-text' };
    }

    // Sürücüye özgü yapısal elemanlar (fotoğraf/plaka/arama-mesaj butonu vb.) —
    // arama ekranında bulunmaz, yalnızca bir sürücü atandığında render edilir.
    const driverElements = body.querySelectorAll(
      '[data-testid*="driver"], [data-testid*="trip"], [data-testid*="order-status"], ' +
      '[class*="DriverInfo"], [class*="TripStatus"], [class*="OrderStatus"], ' +
      'a[href^="tel:"], [aria-label*="ürücü" i], [aria-label*="driver" i]'
    );
    if (driverElements.length > 0) {
      return { strength: 'medium', type: 'dom-element' };
    }

    // Bilinen hiçbir metin/eleman kalıbı eşleşmese bile, sayfa arama başladığı
    // URL'den tamamen başka bir URL'ye geçtiyse (Uber genelde arama ekranından
    // yalnızca bir durum değişikliğinde — bulundu/iptal/hata — ayrılır) bunu da
    // orta güvenli bir sinyal say. Bilinmeyen/öngörülemeyen DOM yapıları için yedek.
    if (_tripSearchInitialUrl && window.location.href !== _tripSearchInitialUrl) {
      return { strength: 'medium', type: 'url-changed' };
    }

    return null;
  }

  // İlk saniyeler içindeki eşleşmeler eski/önceki sayfa durumundan kalma olabilir, sayılmaz.
  var TRIP_MIN_ELAPSED_MS = 3000;
  // "strong" sinyal kaç kontrolde doğrulanmalı — çift-rezervasyon riski artık ağ
  // katmanında engellendiği için burada gerçek eşleşmeyi kaçırmamak öncelikli.
  var TRIP_STRONG_CONFIRMS = 1;
  var TRIP_MEDIUM_CONFIRMS = 2;

  var _tripSearchStartedAt = 0;
  var _tripSearchInitialUrl = '';
  var _tripFoundConfirmCount = 0;
  var _tripFoundConfirmType = null;

  function evaluateTripFound(source) {
    const signal = detectTripFound();
    if (!signal) {
      _tripFoundConfirmCount = 0;
      _tripFoundConfirmType = null;
      return;
    }

    if (Date.now() - _tripSearchStartedAt < TRIP_MIN_ELAPSED_MS) {
      return; // çok erken — muhtemelen önceki sayfa durumundan kalma DOM
    }

    // Sinyal türü kontroller arası değişirse sayaç sıfırlanır (tutarlı tekrar isteniyor).
    if (_tripFoundConfirmType !== signal.type) {
      _tripFoundConfirmType = signal.type;
      _tripFoundConfirmCount = 0;
    }
    _tripFoundConfirmCount++;

    const required = signal.strength === 'strong' ? TRIP_STRONG_CONFIRMS : TRIP_MEDIUM_CONFIRMS;
    if (_tripFoundConfirmCount >= required) {
      console.log('[Kupon Market][Uber] Yolculuk bulundu (' + source + ', doğrulandı x' + _tripFoundConfirmCount + '):', signal.type);
      finishTripSearch(true);
    }
  }

  function startTripFoundMonitor() {
    stopTripFoundMonitor();
    _tripSearchStartedAt = Date.now();
    _tripSearchInitialUrl = window.location.href;
    _tripFoundConfirmCount = 0;
    _tripFoundConfirmType = null;

    _tripFoundPoller = setInterval(() => evaluateTripFound('poller'), 2000);

    if (typeof MutationObserver !== 'undefined' && document.body) {
      let checkDebounce = null;
      _tripFoundObserver = new MutationObserver(() => {
        clearTimeout(checkDebounce);
        checkDebounce = setTimeout(() => evaluateTripFound('observer'), 500);
      });
      _tripFoundObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
    }
  }

  function stopTripFoundMonitor() {
    if (_tripFoundPoller) { clearInterval(_tripFoundPoller); _tripFoundPoller = null; }
    if (_tripFoundObserver) { _tripFoundObserver.disconnect(); _tripFoundObserver = null; }
    _tripFoundConfirmCount = 0;
    _tripFoundConfirmType = null;
  }

  function finishTripSearch(success, errorMsg) {
    if (!_tripSearchActive) return;
    _tripSearchActive = false;

    if (_tripSearchTimer) { clearTimeout(_tripSearchTimer); _tripSearchTimer = null; }
    if (_tripCountdownInterval) { clearInterval(_tripCountdownInterval); _tripCountdownInterval = null; }
    stopTripFoundMonitor();

    // Interceptor'daki çift-istek kilidini serbest bırak: arama bitti (bulundu/başarısız/süre doldu),
    // artık yeni bir TripRequest'in proxy'lenmesine izin verilebilir.
    window.postMessage({ source: 'YEMEKTIME_UBER_INJECT', action: 'TRIP_SEARCH_RESOLVED' }, '*');

    const card = document.querySelector('#km-trip-overlay .km-trip-card');

    if (success) {
      if (card) {
        card.innerHTML = `
          <div class="km-trip-result-icon km-trip-result-ok">
            <svg viewBox="0 0 24 24" width="30" height="30" fill="none"><path d="M5 12.5l4.5 4.5L19 7" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </div>
          <div class="km-trip-title" style="color:#0f9d6b;">Yolculuk Bulundu!</div>
          <div class="km-trip-sub">Sürücünüz eşleştirildi. Sayfa güncelleniyor...</div>
          <div class="km-trip-brand"><b>Kupon</b> Market</div>
        `;
        
      }
      setTimeout(() => {
        removeOverlayElements();
        window.location.reload();
      }, 2500);
    } else {
      if (card && errorMsg) {
        card.innerHTML = `
          <div class="km-trip-result-icon km-trip-result-warn">
            <svg viewBox="0 0 24 24" width="28" height="28" fill="none"><circle cx="12" cy="12" r="9" stroke="#fff" stroke-width="2"/><path d="M12 7v6" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/><circle cx="12" cy="16.3" r="1.15" fill="#fff"/></svg>
          </div>
          <div class="km-trip-title">${errorMsg}</div>
          <div class="km-trip-sub">Sayfayı yenileyerek tekrar deneyebilirsiniz.</div>
          <div class="km-trip-brand"><b>Kupon</b> Market</div>
        `;
        
      }
      setTimeout(() => removeOverlayElements(), 4000);
    }
  }

  function removeOverlayElements() {
    const overlay = document.getElementById('km-trip-overlay');
    const style = document.getElementById('km-trip-overlay-style');
    if (overlay) overlay.remove();
    if (style) style.remove();
  }

  window.addEventListener('beforeunload', function(e) {
    if (_tripSearchActive) {
      e.preventDefault();
      e.returnValue = 'Yolculuk aranıyor! Sayfadan ayrılmak hesabınıza zarar verebilir.';
      return e.returnValue;
    }
  });

  window.addEventListener('message', function(event) {
    if (event.source !== window) return;
    const msg = event.data;
    if (!msg || msg.source !== 'YEMEKTIME_UBER_INJECT') return;

    if (msg.action === 'TRIP_SEARCH_START') {
      console.log('[Kupon Market][Uber] Yolculuk arama başladı');
      showTripSearchOverlay();
    }

    if (msg.action === 'TRIP_SEARCH_SUBMITTED') {
      console.log('[Kupon Market][Uber] TripRequest gönderildi, HTTP:', msg.status);
      if (msg.success) {
        updateOverlayStatus(
          'Yolculuk Aranıyor',
          'Sürücü eşleştirmesi yapılıyor, lütfen bekleyin...',
          'İstek başarıyla gönderildi, sürücü bekleniyor...'
        );
        startTripFoundMonitor();
      } else {
        updateOverlayStatus(
          'Yolculuk Aranıyor',
          'İstek gönderildi ancak yanıt beklenmiyor olabilir.',
          'HTTP ' + (msg.status || '?') + ' — izleme devam ediyor...'
        );
        startTripFoundMonitor();
      }
    }

    if (msg.action === 'TRIP_SEARCH_FAILED') {
      // ÖNEMLİ: Bu, yalnızca Kupon Market'un kendi proxy röle isteğinin (bu cihaz →
      // Kupon Market.com → Uber) yanıt alma aşamasında bir aksaklık yaşandığı anlamına
      // gelir — Uber'e giden istek çoğu zaman sunucu tarafında zaten iletilmiş
      // olabilir. Yani yolculuk gerçekte başlamış olabilir; bu yüzden kullanıcıya
      // "Bağlantı Hatası" gibi kesin/alarm verici bir mesaj göstermek yanıltıcı —
      // kullanıcı yolculuğun iptal olduğunu sanabiliyor. Bunun yerine nötr bir
      // "aranıyor" mesajı gösterip hemen (gecikmeden) bulundu-izlemesini başlatıyoruz;
      // gerçekten bulunduysa overlay birkaç saniye içinde kendini düzeltip
      // "Sürücü Bulundu" ekranına geçecek.
      console.warn('[Kupon Market][Uber] Proxy röle gecikmesi (istek Uber tarafına ulaşmış olabilir):', msg.error);
      updateOverlayStatus(
        'Yolculuk Aranıyor',
        'Bağlantıda kısa bir gecikme oldu, sürücü aranmaya devam ediyor...',
        'Arama sürüyor — bu birkaç saniye sürebilir'
      );
      if (_tripSearchActive && !_tripFoundPoller) {
        startTripFoundMonitor();
      }
    }

    if (msg.action === 'TRIP_SEARCH_DUPLICATE_BLOCKED') {
      console.warn('[Kupon Market][Uber] Mükerrer yolculuk isteği engellendi.');
      if (_tripSearchActive) {
        updateOverlayStatus(
          'Yolculuk Aranıyor',
          'Mevcut arama devam ediyor, ikinci istek gönderilmedi.',
          'Zaten aktif bir arama var — lütfen bekleyin, tekrar tıklamanıza gerek yok.'
        );
      }
    }

    // Geriye dönük uyumluluk
    if (msg.action === 'TRIP_SEARCH_END') {
      if (msg.success) {
        finishTripSearch(true);
      } else {
        finishTripSearch(false, 'Yolculuk bulunamadı.');
      }
    }
  });

  // ============================================
  // UBER OTURUM KAPATMA ENGELLEME
  // ============================================
  function disableLogoutButtons() {
    const allButtons = document.querySelectorAll('button, a, [role="button"], [role="menuitem"]');
    allButtons.forEach(el => {
      const text = (el.textContent || '').trim().toLowerCase();
      if (text === 'oturumu kapatın' || text === 'sign out' || text === 'log out' || text === 'çıkış yap') {
        el.style.pointerEvents = 'none';
        el.style.opacity = '0.3';
        el.style.cursor = 'not-allowed';
        el.setAttribute('disabled', 'true');
        el.setAttribute('aria-disabled', 'true');
        el.addEventListener('click', function(e) {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
        }, true);
        el.addEventListener('touchend', function(e) {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
        }, true);
        console.log('[Kupon Market] Uber logout butonu deaktif edildi');
      }
    });
  }

  // İlk çalıştır + MutationObserver ile dinamik DOM değişikliklerini yakala
  function initLogoutBlocker() {
    disableLogoutButtons();
    if (typeof MutationObserver !== 'undefined') {
      let debounceLogout = null;
      const logoutObs = new MutationObserver(() => {
        clearTimeout(debounceLogout);
        debounceLogout = setTimeout(disableLogoutButtons, 200);
      });
      const target = document.body || document.documentElement;
      if (target) logoutObs.observe(target, { childList: true, subtree: true });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initLogoutBlocker, { once: true });
  } else {
    initLogoutBlocker();
  }

  // ============================================
  // UBER PROMOSYON ENGELİ TESPİTİ (hesap risk sinyali)
  // ============================================
  // Uber bazı yolculuklarda "Try another payment method / Promotion codes are
  // not available for this account" diyaloğunu gösteriyor. Bu, Uber'in kendi
  // sunucu tarafı risk/fraud motorunun o hesabı/oturumu promosyona kapatma
  // kararıdır — eklenti tarafında üretilen bir hata değildir ve istemci
  // tarafından güvenilir biçimde önlenemez. Burada yapılan iki şey:
  //   1) Olayı telemetriye kaydet (backend hangi hesapların sık engellendiğini
  //      görüp o hesabı daha hızlı rotasyona alabilsin).
  //   2) Kullanıcıya Uber'in ham diyaloğunun yanında Kupon Market kaynaklı net
  //      bir açıklama göster — "bu bir eklenti hatası değil" ve ne yapması
  //      gerektiği bilgisiyle, sessizce tam fiyat ödemesin.
  let _promoBlockReported = false;
  // Uber bu diyaloğu gösterdikten kısa süre sonra genelde otomatik olarak bir
  // sonraki ekrana (checkout/tam fiyat onayı) geçiyor — sayfa/SPA görünümü
  // değiştiği anda bizim banner'ımız da (o sayfaya bağlı olduğu için) kayboluyor.
  // Kullanıcı "uyarı gelip hemen geçiyor" diyor — çünkü okumaya fırsat kalmadan
  // Uber kendi ekranını değiştiriyor. Çözüm: tespit anını bir süreliğine
  // storage'a yazıp, sonraki Uber sayfalarında da (diyalog metni ekranda
  // olmasa bile) aynı pencere içinde banner'ı göstermeye devam etmek.
  const PROMO_BLOCK_PERSIST_MS = 90 * 1000;

  function detectPromoBlockedDialog() {
    const body = document.body;
    if (!body) return false;
    const text = body.innerText || '';
    const patterns = [
      /promotion codes are not available for this account/i,
      /try another payment method/i,
      /kupon kodlar[ıi] bu hesap i[cç]in kullan[ıi]lam[ıi]yor/i,
      /promosyon kodlar[ıi] bu hesap i[cç]in kullan[ıi]lam[ıi]yor/i,
    ];
    return patterns.some((p) => p.test(text));
  }

  function injectPromoBlockedNotice() {
    if (document.getElementById('km-promo-blocked-banner')) return;
    const banner = document.createElement('div');
    banner.id = 'km-promo-blocked-banner';
    banner.innerHTML = `
      <div style="position:fixed;bottom:0;left:0;right:0;z-index:2147483647;background:linear-gradient(135deg,#1a1a2e,#16213e);color:#fff;padding:16px 20px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;box-shadow:0 -4px 20px rgba(0,0,0,0.3);border-top:3px solid #e94560;">
        <div style="display:flex;align-items:flex-start;gap:12px;max-width:480px;margin:0 auto;">
          <div style="background:#e94560;border-radius:50%;width:32px;height:32px;display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0;">K</div>
          <div style="flex:1;">
            <div style="font-weight:600;font-size:14px;margin-bottom:4px;">Kupon Market Bilgilendirme</div>
            <div style="opacity:0.9;font-size:12.5px;line-height:1.5;">
              Uber bu hesaptaki promosyonu geçici olarak devre dışı bıraktı. Bu, eklentiden kaynaklanan bir hata değildir.
              Devam ederseniz yolculuk tam fiyattan ücretlendirilir. Kapatıp birkaç dakika sonra tekrar deneyebilir veya
              destekten yeni bir token isteyebilirsiniz.
            </div>
          </div>
          <button id="km-promo-blocked-close" style="background:transparent;border:1px solid rgba(255,255,255,0.3);color:#fff;padding:6px 12px;border-radius:6px;cursor:pointer;font-size:12px;flex-shrink:0;">Tamam</button>
        </div>
      </div>
    `;
    document.body.appendChild(banner);
    const closeBtn = document.getElementById('km-promo-blocked-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        banner.remove();
        // Kullanıcı bilgilendirmeyi gördü ve kapattı — kalıcılık penceresini
        // hemen sonlandır, sonraki sayfalarda tekrar gösterilmesin.
        try { chrome.storage.local.remove('km_uber_promo_block_until'); } catch (_) {}
      });
    }
  }

  function checkPromoBlockedDialog() {
    if (!detectPromoBlockedDialog()) return;

    if (!_promoBlockReported) {
      _promoBlockReported = true;
      console.warn('[Kupon Market][Uber] Promosyon engeli diyaloğu tespit edildi — telemetriye kaydediliyor.');
      try {
        chrome.runtime.sendMessage({
          action: 'kmUberPromoBlocked',
          data: { url: window.location.href },
        }).catch(() => {});
      } catch (_) {}
      // Bu sayfa Uber tarafından birazdan değiştirilebilir (checkout'a otomatik
      // geçiş) — banner'ın bir sonraki ekranda da görünmeye devam etmesi için
      // tespit anını damgalıyoruz.
      try {
        chrome.storage.local.set({ km_uber_promo_block_until: Date.now() + PROMO_BLOCK_PERSIST_MS });
      } catch (_) {}
    }

    injectPromoBlockedNotice();
  }

  // Sayfa/SPA görünümü değiştiği için diyalog metni artık ekranda olmasa bile,
  // yakın zamanda tespit edilmişse banner'ı bu yeni sayfada da göster.
  function checkPersistedPromoBlock() {
    try {
      chrome.storage.local.get('km_uber_promo_block_until', (result) => {
        const until = result && result.km_uber_promo_block_until;
        if (until && Date.now() < until) {
          injectPromoBlockedNotice();
        } else if (until) {
          chrome.storage.local.remove('km_uber_promo_block_until');
        }
      });
    } catch (_) {}
  }

  function initPromoBlockWatcher() {
    checkPromoBlockedDialog();
    checkPersistedPromoBlock();
    if (typeof MutationObserver !== 'undefined') {
      let debounce = null;
      const obs = new MutationObserver(() => {
        clearTimeout(debounce);
        debounce = setTimeout(() => {
          checkPromoBlockedDialog();
          // SPA görünüm değişimlerinde banner DOM'dan silinmiş olabilir —
          // kalıcılık penceresi hâlâ açıksa yeniden göster (idempotent).
          checkPersistedPromoBlock();
        }, 300);
      });
      const target = document.body || document.documentElement;
      if (target) obs.observe(target, { childList: true, subtree: true, characterData: true });
      else document.addEventListener('DOMContentLoaded', () => obs.observe(document.body, { childList: true, subtree: true, characterData: true }), { once: true });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPromoBlockWatcher, { once: true });
  } else {
    initPromoBlockWatcher();
  }
})();