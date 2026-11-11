const manifest = chrome.runtime.getManifest();

const No = manifest.system_no;

// Dialog gösterici (tüm dialogları hide edip hedefi fadeIn ile gösterir)
function showDialog(dialogId) {
    const allIds = ['#PreloaderDialog', '#ErrorDialog', '#SuccessDialog', '#FormDialog', '#LoggedDialog'];
    const currentVisible = allIds.find(id => id !== '#' + dialogId && $(id).is(':visible'));
    if (currentVisible) {
        $(currentVisible).fadeOut(350, function() { $('#' + dialogId).fadeIn(350); });
    } else {
        allIds.forEach(id => { if (id !== '#' + dialogId) $(id).hide(); });
        $('#' + dialogId).fadeIn(350);
    }
}

// 🔒 GÜVENLİK - Secret Key
const SECRET_KEY = 'YemekHub2025SecretKey!@#$%'; // Backend ile aynı olmalı

// 🔒 EKLENTİ GÜVENLİK SİSTEMİ
// NOT: Bu değer sunucudaki SECURITY_CONFIG.secret_check.expected_value ile aynı olmalı!
const EXTENSION_SECRET = 'X7kM9pL2qR5sT8vW';

// Güvenli API Base URL (Google Maps işlemleri için)
const SECURE_API_BASE = 'http://154.49.170.75:3000';

// 🔒 SHA256 Hash Fonksiyonu
async function generateSignature(data) {
    const encoder = new TextEncoder();
    const dataBuffer = encoder.encode(data);
    const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return hashHex;
}

// 🔒 GÜVENLİ API İSTEĞİ FONKSİYONU
async function secureApiRequest(endpoint, params = {}, method = 'GET') {
    try {
        const timestamp = Math.floor(Date.now() / 1000);
        const apiToken = params.api_token || '';
        
        // İmza için veri hazırla
        const signatureData = `${apiToken}${endpoint}${timestamp}${SECRET_KEY}`;
        const signature = await generateSignature(signatureData);
        
        // URL oluştur
        let url = `${SITE_API_BASE}${endpoint}`;
        if (method === 'GET') {
            const queryParams = new URLSearchParams(params);
            queryParams.append('timestamp', timestamp);
            url += `?${queryParams.toString()}`;
        }
        
        // Güvenli headers
        const headers = {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'X-Timestamp': timestamp.toString(),
            'X-Signature': signature
        };
        
        const requestOptions = {
            method: method,
            headers: headers
        };
        
        // POST için body ekle
        if (method === 'POST') {
            params.timestamp = timestamp;
            requestOptions.body = JSON.stringify(params);
        }
        
        const response = await fetch(url, requestOptions);
        return response;
        
    } catch (error) {
        throw error;
    }
}

const Logo = manifest.logo_url;
const Name = manifest.systemname;
const SatinAlLink = manifest.satin_al_link;
const DestekLink = manifest.destek_link;
const MainUrl = manifest.client_main_url;
const SorguUrl = manifest.client_query_url;

let HBY_SessionData = {
    isLogged: false,
    cookies: [],
    expiry: 0,
    token: '',
    isCookieInserted: false
};

// Adres düzenleme için global değişken
let duzenlenecekAdresId = null;

// Harita için global değişkenler
let mapIframeWindow = null;
let mapReady = false;

// Sayfa yükleme performansını iyileştirmek için DOMContentLoaded kullanımı
document.addEventListener('DOMContentLoaded', function () {
    initApp();
    
    // 🌐 IP adresini yükle ve göster
    loadAndDisplayUserIP();
    
    // 🗄️ OFFLINE STORAGE - Başlangıçta satın alınan hesapları yükle
    loadPurchasesFromStorage();
    
    // 🚀 WEB SİTESİNDEN OTOMATİK GİRİŞ - temp_auto_login_token kontrolü
    checkAutoLoginToken();
    
    // 🔄 OTOMATİK ADRES EKLEME TOGGLE - Durumu yükle ve event listener ekle
    initAutoAddressToggle();
    
    // 🚨 ESKİ EKLENTİ KONTROLÜ - Sadece login.html sayfasında kontrol et
    if (window.location.href.includes('login.html')) {
        checkOldExtensions();
    }
    
    // ✅ HAR İTA ZORUNLULUĞU: Kaydet butonunu başlangıçta devre dışı bırak
    const kaydetBtn = document.getElementById("adresKaydetBtn");
    if (kaydetBtn) {
        kaydetBtn.disabled = true;
        kaydetBtn.style.opacity = "0.5";
        kaydetBtn.style.cursor = "not-allowed";
        kaydetBtn.innerHTML = '<i class="fas fa-map-marker-alt me-2"></i>Önce Haritadan Konum Seçin';
    }
    
    // ✨ YENİ: Form alanlarını başlangıçta gizle (sayfa yüklendikten sonra)
    setTimeout(() => {
        hideAddressFormFields();
        showMapSearchInstructions();
    }, 100);
});

// 🔄 OTOMATİK ADRES EKLEME TOGGLE FONKSİYONLARI
function initAutoAddressToggle() {
    const toggle = document.getElementById('autoAddressToggle');
    const toggleLabel = document.getElementById('autoAddressToggleLabel');
    const addressSelectionWrapper = document.querySelector('.address-selection-wrapper');
    
    if (!toggle) return;
    
    // Storage'dan durumu yükle (varsayılan: açık)
    chrome.storage.local.get(['autoAddressEnabled'], function(result) {
        const isEnabled = result.autoAddressEnabled !== false; // Varsayılan true
        toggle.checked = isEnabled;
        updateAutoAddressToggleUI(isEnabled);
    });
    
    // Toggle değişikliğini dinle
    toggle.addEventListener('change', function() {
        const isEnabled = toggle.checked;
        chrome.storage.local.set({ autoAddressEnabled: isEnabled });
        updateAutoAddressToggleUI(isEnabled);
    });
}

function updateAutoAddressToggleUI(isEnabled) {
    const toggle = document.getElementById('autoAddressToggle');
    const toggleLabel = document.getElementById('autoAddressToggleLabel');
    const addressSelectionWrapper = document.querySelector('.address-selection-wrapper');
    const addressSelect = document.getElementById('addressSelect');
    
    if (toggleLabel) {
        toggleLabel.textContent = isEnabled ? 'Açık' : 'Kapalı';
        toggleLabel.style.color = isEnabled ? '#28a745' : '#dc3545';
    }
    
    if (addressSelectionWrapper) {
        // Toggle kapalıysa tamamen gizle
        addressSelectionWrapper.style.display = isEnabled ? 'block' : 'none';
    }
    
    // Toggle kapatıldığında seçili adresi sıfırla
    if (!isEnabled && addressSelect) {
        addressSelect.selectedIndex = 0;
    }
}

// Otomatik adres ekleme durumunu kontrol et
function isAutoAddressEnabled() {
    const toggle = document.getElementById('autoAddressToggle');
    return toggle ? toggle.checked : true; // Varsayılan true
}

// 🚨 ESKİ EKLENTİ KONTROL SİSTEMİ
// Mevcut versiyon (bu versiyon hariç tutulacak)
const CURRENT_VERSION = '7.6';

// Mevcut eklentinin ID'sini al (kendini hariç tutmak için)
const CURRENT_EXTENSION_ID = chrome.runtime.id;

// Eski eklenti olup olmadığını kontrol eden fonksiyon
function isOldYemekTimeExtension(extName) {
    const nameLower = extName.toLowerCase();
    
    // "yemek time" veya "yemektime" içeriyorsa
    if (!nameLower.includes('yemek time') && !nameLower.includes('yemektime')) {
        return false;
    }
    
    // Versiyon numarasını çıkar (V7.5, V7.4, V6, vb.)
    const versionMatch = nameLower.match(/v?(\d+\.?\d*)/i);
    
    if (versionMatch) {
        const version = parseFloat(versionMatch[1]);
        // Mevcut versiyondan (7.6) küçükse eski eklentidir
        if (version < parseFloat(CURRENT_VERSION)) {
            return true;
        }
    }
    
    // Versiyon bulunamadıysa ama "yemek time" içeriyorsa ve güncel versiyon değilse
    // V7.6 içermiyorsa eski kabul et
    if (!nameLower.includes('v7.6') && !nameLower.includes('v 7.6')) {
        return true;
    }
    
    return false;
}

async function checkOldExtensions() {
    // management API'si mevcut mu kontrol et
    if (!chrome.management || !chrome.management.getAll) {
        console.log('⚠️ Management API mevcut değil, eski eklenti kontrolü atlanıyor');
        return;
    }
    
    try {
        // Yüklü tüm eklentileri al
        const extensions = await chrome.management.getAll();
        
        // Eski eklentileri filtrele
        const oldExtensions = extensions.filter(ext => {
            // Kendimizi hariç tut
            if (ext.id === CURRENT_EXTENSION_ID) return false;
            
            // Sadece eklentileri kontrol et (tema vs. değil)
            if (ext.type !== 'extension') return false;
            
            // Eski YEMEK TIME eklentisi mi kontrol et
            return isOldYemekTimeExtension(ext.name);
        });
        
        if (oldExtensions.length > 0) {
            console.log('🚨 Eski eklentiler tespit edildi:', oldExtensions.map(e => e.name));
            showOldExtensionWarning(oldExtensions);
        } else {
            console.log('✅ Eski eklenti bulunamadı');
        }
        
    } catch (error) {
        console.error('❌ Eski eklenti kontrolü hatası:', error);
    }
}

function showOldExtensionWarning(oldExtensions) {
    // Uyarı modalını oluştur - BU MODAL KAPATILMAZ, ESKİ EKLENTİ KALDIRILMALI
    const extensionList = oldExtensions.map(ext => `• ${ext.name} (${ext.enabled ? 'Aktif' : 'Devre Dışı'})`).join('\n');
    
    // Sayfayı tamamen bloke et - form ve butonları devre dışı bırak
    const formElements = document.querySelectorAll('input, button, select, textarea, a');
    formElements.forEach(el => {
        el.disabled = true;
        el.style.pointerEvents = 'none';
    });
    
    // Modal HTML'i oluştur - KAPATMA BUTONU YOK
    const modalHtml = `
        <div id="oldExtensionWarningModal" style="
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.95);
            z-index: 99999;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        ">
            <div style="
                background: linear-gradient(135deg, #1a1d29 0%, #252a3a 100%);
                border-radius: 16px;
                padding: 28px;
                max-width: 420px;
                width: 100%;
                box-shadow: 0 20px 60px rgba(0,0,0,0.5);
                border: 2px solid #ff6b35;
            ">
                <div style="text-align: center; margin-bottom: 20px;">
                    <i class="fas fa-ban" style="font-size: 56px; color: #ff6b35;"></i>
                </div>
                <h3 style="color: #ff6b35; text-align: center; margin-bottom: 16px; font-size: 20px;">
                    🚫 Eski Eklenti Tespit Edildi!
                </h3>
                <p style="color: #ff6b6b; font-size: 15px; line-height: 1.6; margin-bottom: 20px; text-align: center; font-weight: 600;">
                    Devam etmek için eski eklentiyi kaldırmanız GEREKLİDİR!
                </p>
                <p style="color: #e6e9f0; font-size: 13px; line-height: 1.6; margin-bottom: 16px; text-align: center;">
                    Sisteminizde eski YEMEK TIME eklentisi tespit edildi. 
                    Çakışma ve hata oluşmaması için eski eklentiyi kaldırın ve sayfayı yenileyin.
                </p>
                <div style="
                    background: rgba(255,107,53,0.15);
                    border: 2px solid rgba(255,107,53,0.5);
                    border-radius: 10px;
                    padding: 14px;
                    margin-bottom: 20px;
                    max-height: 100px;
                    overflow-y: auto;
                ">
                    <p style="color: #ff6b35; font-size: 12px; margin: 0; font-weight: 700; margin-bottom: 8px;">
                        🔍 Tespit Edilen Eski Eklenti:
                    </p>
                    <pre style="color: #ffa07a; font-size: 12px; margin: 0; white-space: pre-wrap; font-weight: 600;">${extensionList}</pre>
                </div>
                <div style="
                    background: rgba(40,167,69,0.15);
                    border: 1px solid rgba(40,167,69,0.4);
                    border-radius: 10px;
                    padding: 14px;
                    margin-bottom: 20px;
                ">
                    <p style="color: #28a745; font-size: 13px; margin: 0; line-height: 1.6;">
                        <strong>📋 Nasıl Kaldırılır?</strong><br><br>
                        <strong>Chrome:</strong> Adres çubuğuna <code style="background: rgba(0,0,0,0.4); padding: 3px 8px; border-radius: 4px; color: #4ECDC4;">chrome://extensions</code> yazın<br><br>
                        <strong>Kiwi/Lemur:</strong> Eklentiler Sayfası
                    </p>
                </div>
                <div style="display: flex; gap: 12px; flex-direction: column;">
                    <button id="oldExtWarningOpenSettings" style="
                        background: linear-gradient(135deg, #ff6b35 0%, #ff8c5a 100%);
                        border: none;
                        color: white;
                        padding: 14px 20px;
                        border-radius: 10px;
                        font-weight: 700;
                        cursor: pointer;
                        font-size: 15px;
                        transition: transform 0.2s;
                    ">
                        <i class="fas fa-cog me-2"></i>Eklenti Ayarlarını Aç
                    </button>
                    <button id="oldExtWarningRefresh" style="
                        background: linear-gradient(135deg, #28a745 0%, #34c759 100%);
                        border: none;
                        color: white;
                        padding: 14px 20px;
                        border-radius: 10px;
                        font-weight: 700;
                        cursor: pointer;
                        font-size: 15px;
                        transition: transform 0.2s;
                    ">
                        <i class="fas fa-sync-alt me-2"></i>Kaldırdım, Sayfayı Yenile
                    </button>
                </div>
                <p style="color: #888; font-size: 11px; text-align: center; margin-top: 16px; margin-bottom: 0;">
                    ⚠️ Eski eklentiyi kaldırmadan devam edemezsiniz
                </p>
            </div>
        </div>
    `;
    
    // Modal'ı sayfaya ekle
    document.body.insertAdjacentHTML('beforeend', modalHtml);
    
    // Event listener'ları ekle
    document.getElementById('oldExtWarningOpenSettings').addEventListener('click', function() {
        // Eklenti ayarları sayfasını aç
        chrome.tabs.create({ url: 'chrome://extensions' });
    });
    
    document.getElementById('oldExtWarningRefresh').addEventListener('click', function() {
        // Sayfayı yenile - tekrar kontrol edilecek
        window.location.reload();
    });
}

function checkMapRequirement() {
    const kaydetBtn = document.getElementById("adresKaydetBtn");
    
    // Koordinatlar var mı kontrol et
    if (window.selectedLat && window.selectedLng) {
        // Koordinatlar var - butonu aktif et
        kaydetBtn.disabled = false;
        kaydetBtn.style.opacity = "1";
        kaydetBtn.style.cursor = "pointer";
        kaydetBtn.innerHTML = duzenlenecekAdresId ? 'Değişiklikleri Kaydet' : 'Adresi Kaydet';
        
        // ✨ YENİ: Form alanlarını göster
        showAddressFormFields();
        
        // Başarı mesajı göster (opsiyonel)
        showLocationSelectedMessage();
    } else {
        // Koordinatlar yok - butonu devre dışı bırak
        kaydetBtn.disabled = true;
        kaydetBtn.style.opacity = "0.5";
        kaydetBtn.style.cursor = "not-allowed";
        kaydetBtn.innerHTML = '<i class="fas fa-map-marker-alt me-2"></i>Önce Haritadan Konum Seçin';
        
        // ✨ YENİ: Form alanlarını gizle
        hideAddressFormFields();
    }
}

// ✨ YENİ: Form alanlarını göster/gizle fonksiyonları
function showAddressFormFields() {
    // Talimat mesajını gizle
    hideMapSearchInstructions();
    
    // Doğru ID'lerle form alanlarını göster ve vurgula
    const formElementIds = [
        'musteriAdi',           // Ad
        'musteriSoyadi',        // Soyad
        'adresEtiketiInput',   // Adres Etiketi
        'ilSelect',             // İl seçimi
        'ilceSelect',           // İlçe seçimi  
        'mahalleSelect',        // Mahalle seçimi
        'binaNo',               // Bina bilgileri
        'katNo',
        'daireNo',
        'telefonNo',            // Telefon
        'adresTarifi'           // Adres tarifi
    ];
    
    formElementIds.forEach(id => {
        const element = document.getElementById(id);
        if (element && element.closest('.form-group')) {
            const formGroup = element.closest('.form-group');
            formGroup.style.display = 'block';
            formGroup.style.opacity = '1';
            formGroup.style.pointerEvents = 'auto';
            formGroup.style.transition = 'all 0.3s ease';
            
            // Hafif highlight efekti
            formGroup.style.transform = 'scale(1.02)';
            formGroup.style.boxShadow = '0 4px 12px rgba(40, 167, 69, 0.15)';
            setTimeout(() => {
                formGroup.style.transform = 'scale(1)';
                formGroup.style.boxShadow = 'none';
            }, 300);
        }
    });
    
    // Cadde/Sokak input'unu da göster
    const caddeInput = document.querySelector('input[placeholder="Cadde/Sokak"]');
    if (caddeInput && caddeInput.closest('.form-group')) {
        const formGroup = caddeInput.closest('.form-group');
        formGroup.style.display = 'block';
        formGroup.style.opacity = '1';
        formGroup.style.pointerEvents = 'auto';
        formGroup.style.transition = 'all 0.3s ease';
    }
    
    // Posta kodu input'unu da göster
    const postaInput = document.querySelector('.postal-code-input');
    if (postaInput && postaInput.closest('.form-group')) {
        const formGroup = postaInput.closest('.form-group');
        formGroup.style.display = 'block';
        formGroup.style.opacity = '1';
        formGroup.style.pointerEvents = 'auto';
        formGroup.style.transition = 'all 0.3s ease';
    }
    
    // Bilgilendirici mesaj göster
    showFieldsAvailableMessage();
}

function hideAddressFormFields() {
    // Doğru ID'lerle form alanlarını gizle
    const formElementIds = [
        'musteriAdi',           // Ad
        'musteriSoyadi',        // Soyad
        'adresEtiketiInput',   // Adres Etiketi
        'ilSelect',             // İl seçimi
        'ilceSelect',           // İlçe seçimi  
        'mahalleSelect',        // Mahalle seçimi
        'binaNo',               // Bina bilgileri
        'katNo',
        'daireNo',
        'telefonNo',            // Telefon
        'adresTarifi'           // Adres tarifi
    ];
    
    formElementIds.forEach(id => {
        const element = document.getElementById(id);
        if (element && element.closest('.form-group')) {
            const formGroup = element.closest('.form-group');
            formGroup.style.display = 'none';
            formGroup.style.opacity = '0.3';
            formGroup.style.pointerEvents = 'none';
        }
    });
    
    // Cadde/Sokak input'unu da gizle
    const caddeInput = document.querySelector('input[placeholder="Cadde/Sokak"]');
    if (caddeInput && caddeInput.closest('.form-group')) {
        const formGroup = caddeInput.closest('.form-group');
        formGroup.style.display = 'none';
        formGroup.style.opacity = '0.3';
        formGroup.style.pointerEvents = 'none';
    }
    
    // Posta kodu input'unu da gizle
    const postaInput = document.querySelector('.postal-code-input');
    if (postaInput && postaInput.closest('.form-group')) {
        const formGroup = postaInput.closest('.form-group');
        formGroup.style.display = 'none';
        formGroup.style.opacity = '0.3';
        formGroup.style.pointerEvents = 'none';
    }
}

function showFieldsAvailableMessage() {
    // Alanların kullanılabilir olduğunu göster  
    const mapContainer = document.querySelector('#mapFrame')?.parentElement;
    if (mapContainer) {
        let message = mapContainer.querySelector('.fields-available-message');
        if (!message) {
            message = document.createElement('div');
            message.className = 'fields-available-message';
            message.style.cssText = `
                background: linear-gradient(45deg, #28a745, #20c997);
                color: white;
                padding: 8px 12px;
                border-radius: 6px;
                font-size: 13px;
                text-align: center;
                margin-top: 8px;
                box-shadow: 0 2px 6px rgba(40, 167, 69, 0.3);
                animation: slideIn 0.3s ease;
            `;
            message.innerHTML = '<i class="fas fa-check-circle me-1"></i>Harika! Artık aşağıdaki alanları doldurabilirsiniz';
            mapContainer.appendChild(message);
            
            // 3 saniye sonra mesajı gizle
            setTimeout(() => {
                if (message && message.parentElement) {
                    message.style.animation = 'fadeOut 0.3s ease';
                    setTimeout(() => {
                        message.remove();
                    }, 300);
                }
            }, 3000);
        }
    }
}

function showMapSearchInstructions() {
    // Harita arama talimatları göster
    const mapContainer = document.querySelector('#mapFrame')?.parentElement;
    if (mapContainer) {
        const instructionDiv = document.createElement('div');
        instructionDiv.className = 'map-search-instructions';
        instructionDiv.style.cssText = `
            background: linear-gradient(45deg, #007bff, #6610f2);
            color: white;
            padding: 12px 16px;
            border-radius: 8px;
            font-size: 14px;
            text-align: center;
            margin-top: 10px;
            box-shadow: 0 3px 8px rgba(0, 123, 255, 0.3);
            border-left: 4px solid #fff;
            animation: pulse 2s infinite;
        `;
        instructionDiv.innerHTML = `
            <div style="font-weight: 600; margin-bottom: 5px;">
                <i class="fas fa-search me-2"></i>📍 Adres Aramaya Başlayın
            </div>
            <div style="font-size: 12px; opacity: 0.9;">
                Yukarıdaki harita arama kutusuna adresinizi yazın.<br>
                <strong>Adres seçildikten sonra diğer alanlar otomatik açılacak!</strong>
            </div>
        `;
        mapContainer.appendChild(instructionDiv);
        
        // CSS animasyon ekle
        const style = document.createElement('style');
        style.textContent = `
            @keyframes pulse {
                0% { transform: scale(1); box-shadow: 0 3px 8px rgba(0, 123, 255, 0.3); }
                50% { transform: scale(1.02); box-shadow: 0 5px 15px rgba(0, 123, 255, 0.5); }
                100% { transform: scale(1); box-shadow: 0 3px 8px rgba(0, 123, 255, 0.3); }
            }
            @keyframes fadeOut {
                0% { opacity: 1; transform: scale(1); }
                100% { opacity: 0; transform: scale(0.95); }
            }
            @keyframes slideIn {
                0% { opacity: 0; transform: translateY(-10px); }
                100% { opacity: 1; transform: translateY(0); }
            }
        `;
        document.head.appendChild(style);
    }
}

function hideMapSearchInstructions() {
    // Talimat mesajını gizle
    const instructions = document.querySelector('.map-search-instructions');
    if (instructions) {
        instructions.style.animation = 'fadeOut 0.3s ease';
        setTimeout(() => {
            instructions.remove();
        }, 300);
    }
}

function showLocationSelectedMessage() {
    // Eğer daha önce mesaj gösterilmemişse göster
    if (!window.locationMessageShown) {
        // Geçici bilgi mesajı oluştur
        const infoDiv = document.createElement('div');
        infoDiv.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: linear-gradient(45deg, #4CAF50, #45a049);
            color: white;
            padding: 12px 20px;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.2);
            z-index: 10000;
            font-size: 14px;
            font-weight: 500;
            animation: slideInRight 0.3s ease-out;
        `;
        infoDiv.innerHTML = '<i class="fas fa-check-circle me-2"></i>Konum seçildi! Artık formu doldurabilirsiniz.';
        
        // CSS animasyonu ekle
        if (!document.querySelector('#locationMessageStyles')) {
            const styles = document.createElement('style');
            styles.id = 'locationMessageStyles';
            styles.textContent = `
                @keyframes slideInRight {
                    from { transform: translateX(100%); opacity: 0; }
                    to { transform: translateX(0); opacity: 1; }
                }
            `;
            document.head.appendChild(styles);
        }
        
        document.body.appendChild(infoDiv);
        
        // 3 saniye sonra mesajı kaldır
        setTimeout(() => {
            infoDiv.style.animation = 'slideInRight 0.3s ease-out reverse';
            setTimeout(() => {
                if (infoDiv.parentNode) {
                    infoDiv.parentNode.removeChild(infoDiv);
                }
            }, 300);
        }, 3000);
        
        window.locationMessageShown = true;
    }
}

// Uygulama başlangıç fonksiyonu
function initApp() {
    tumAdresleriGetir();
    loadAddressList(); // Adres listesini yükle
    loadUserPreferences(); // Kullanıcı tercihlerini yükle

    //  görsellerini ve linkleri yükle
    if (Logo && Logo.length) $('.logo').attr('src', Logo);
    if (Name && Name.length) {
        $('#AnaLogoText').html(Name);
        document.title = Name + '';
    }

    // Form submit engelle
    document.body.addEventListener('submit', e => e.preventDefault());

    // Event Listeners tanımla
    setupEventListeners();

    // Session durumunu kontrol et
    checkSessionStatus();

    // API ile iletişim kur (arka planda)
    setTimeout(fetchScripts, 100);
}

// Event Listener'ları kurulumu
function setupEventListeners() {
    // Login'e yönlendirme
    $('#LoginRedirectButton').on('click', function () {
        chrome.tabs.create({ url: 'pages/login.html' });
    });

    // Token giriş formu
    $('#TokenGirisForm').on('submit', handleTokenLogin);

    // Uber: Token uber- ile başlıyorsa (isim alanı kullanılmıyor)
    $('#TokenGirisForm [name="token"]').on('input', function() {
        const val = $(this).val().trim();
        $('#uberNameArea').hide();
        $('#uberNameError').hide();

        if (val.toLowerCase().startsWith('mgy-') || val.toLowerCase().startsWith('mgm-') || val.toLowerCase().startsWith('mg-')) {
            $('#addressSelectionArea').slideDown(200);
            $('#autoAddressToggle').prop('checked', true);
            updateAutoAddressToggleUI(true);
            if (!$('#tokenAddressWarning').length) {
                $('#addressSelectionArea').prepend('<div id="tokenAddressWarning" class="alert alert-info py-1 px-2 mb-2" style="font-size:12px;"></div>');
            }
            $('#tokenAddressWarning')
                .removeClass('alert-warning')
                .addClass('alert-info')
                .html('<i class="fas fa-info-circle me-1"></i>mg- Hemen, mgy- Yemek, mgm- Sanal Market. Harita pinli adres zorunlu.')
                .show();
        } else {
            $('#tokenAddressWarning').hide();
            $('#addressSelect').css('border-color', '');
        }
    });

    // Uber isim alanları devre dışı
    $('#uberFirstName, #uberLastName').on('input', function() {});

    // Token logout işlemi
    $('#TokenLogoutForm').on('submit', handleLogout);

    // Hesap satın alma ve destek butonlarını görünür hale getir
    if (SatinAlLink && SatinAlLink.length)
        $('#HesapSatinAlButon').attr('href', SatinAlLink).fadeIn(250);
    if (DestekLink && DestekLink.length)
        $('#DestekButon').attr('href', DestekLink).fadeIn(350);

    // Yeni adres ekle bağlantısı
    $('#addAddressLink').on('click', function (e) {
        e.preventDefault();
        $('#AdresPopup').fadeIn(300);
        $('#AdresListeGorunumu').hide();
        $('#AdresFormGorunumu').show();
        duzenlenecekAdresId = null;
        formuTemizle();
        initializeMap();
    });

    // Adres seçimi değiştiğinde tercihi kaydet
    $('#addressSelect').on('change', function () {
        const selectedAddressId = $(this).val();
        saveUserPreferences();
    });
}

// Kullanıcı tercihlerini yükle
function loadUserPreferences() {
    chrome.storage.local.get(['userPreferences'], function (result) {
        const prefs = result.userPreferences || {};
        
        // Seçili adresi yükle (adres listesi yüklendikten sonra yapılacak)
        if (prefs.selectedAddressId) {
            setTimeout(() => {
                $('#addressSelect').val(prefs.selectedAddressId);
            }, 500);
        }
    });
}

// Kullanıcı tercihlerini kaydet
function saveUserPreferences() {
    const prefs = {
        selectedAddressId: $('#addressSelect').val()
    };
    
    chrome.storage.local.set({ userPreferences: prefs });
}

// Adres listesini yükle
function loadAddressList() {
    chrome.storage.local.get(['addresses'], function (result) {
        const addresses = result.addresses || [];
        const addressSelect = $('#addressSelect');
        
        // Select'i temizle
        addressSelect.empty();
        addressSelect.append('<option value="">Adres seçin (opsiyonel)</option>');
        
        if (addresses.length === 0) {
            $('#noAddressWarning').show();
            addressSelect.prop('disabled', true);
        } else {
            $('#noAddressWarning').hide();
            addressSelect.prop('disabled', false);
            
            // Adresleri ekle
            addresses.forEach((address, index) => {
                const addressText = `${address.addressLabel || 'Adres'} - ${address.neighborhood}, ${address.street}`;
                const addressId = address.place_id || address.form_id;
                addressSelect.append(`<option value="${addressId}">${addressText}</option>`);
            });
        }
        
        // Kaydedilmiş tercihi yükle
        chrome.storage.local.get(['userPreferences'], function (result) {
            const prefs = result.userPreferences || {};
            if (prefs.selectedAddressId && addresses.some(a => (a.place_id || a.form_id) === prefs.selectedAddressId)) {
                addressSelect.val(prefs.selectedAddressId);
            }
        });
    });
}

// 🛡️ GÜVENLİ TEMİZLEME FONKSİYONU - POPUP'TA ÇALIŞACAK
async function performPreCleanup() {
    console.log('🛡️ ÖN TEMİZLEME BAŞLIYOR - YEMEKSEPETİ.COM AÇILMADAN ÖNCE...');
    
    return new Promise((resolve) => {
        // Background.js'deki güvenli temizleme fonksiyonunu çağır
        chrome.runtime.sendMessage({
            action: 'clearYemeksepetiLikeChromeSettings'
        }, (response) => {
            if (chrome.runtime.lastError) {
                console.error('Background ile iletişim hatası:', chrome.runtime.lastError);
                resolve(false);
            } else {
                console.log('🛡️ ÖN TEMİZLEME TAMAMLANDI:', response);
                resolve(response && response.success);
            }
        });
    });
}

// ============================================
// 🍪 COOKIE MANAGEMENT ( mantığıyla geliştirilmiş - Popup versiyonu)
// ============================================

/**
 * Cookie'leri paralel olarak ekler ( mantığı)
 * @param {Array} cookies - Eklenecek cookie'ler
 * @returns {Promise<boolean>} - Başarılı ise true
 */
async function addCookiesInPopup(cookies) {
    console.log('🍪 POPUP: Cookie ekleme başlıyor...', cookies.length, 'adet cookie');
    
    if (!cookies || cookies.length === 0) {
        console.log('🍪 Eklenecek cookie bulunamadı');
        return true;
    }
    
    const nowInSeconds = Math.floor(Date.now() / 1000);
    const platformDomain = '.yemeksepeti.com';
    
    // Tüm cookie'leri paralel olarak set et ( mantığı)
    const cookiePromises = cookies.map(async (cookie) => {
        try {
            // SameSite mapping (Backend "None" gönderir, Chrome "no_restriction" bekler)
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
                secure: true, // ⚡ HTTPS için zorunlu (sunucudan false gelse bile true yapıyoruz)
                httpOnly: cookie.httpOnly !== false,
                sameSite: sameSite
            };
            
            // Expiration date kontrolü ( mantığı + Session desteği)
            if (cookie.expirationDate && typeof cookie.expirationDate === 'number' && cookie.expirationDate > 0) {
                cookieData.expirationDate = cookie.expirationDate < nowInSeconds
                    ? nowInSeconds + (365 * 24 * 60 * 60)  // Süresi geçmişse 1 yıl ekle
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
                // Session cookie - 1 saat ömür ver
                cookieData.expirationDate = nowInSeconds + (60 * 60);
            } else {
                // Fallback: 1 saat
                cookieData.expirationDate = nowInSeconds + (60 * 60);
            }
            
            // Third-party cookie'ler için partitioned flag
            if (cookie.domain && !cookie.domain.includes('yemeksepeti.com')) {
                try {
                    cookieData.partitionKey = {
                        topLevelSite: 'https://www.yemeksepeti.com'
                    };
                } catch (e) {
                    // Partitioned cookies desteklenmiyorsa sessizce geç
                }
            }
            
            // Promise ile cookie set et
            const result = await new Promise((resolve) => {
                chrome.cookies.set(cookieData, (resultCookie) => {
                    if (chrome.runtime.lastError) {
                        console.error('[Popup CookieManager] ❌ Chrome API hatası:', {
                            cookieName: cookieData.name,
                            error: chrome.runtime.lastError.message,
                            url: cookieData.url,
                            domain: cookieData.domain,
                            originalExpiry: cookie.expiry
                        });
                        resolve(false);
                    } else if (!resultCookie) {
                        console.error('[Popup CookieManager] ❌ Cookie set edildi ama dönen değer null:', cookieData.name);
                        resolve(false);
                    } else {
                        console.log(`[Popup CookieManager] ✅ Cookie eklendi: ${cookieData.name} → ${domain}`);
                        resolve(true);
                    }
                });
            });
            
            return {
                name: cookie.name,
                success: result,
                error: result ? null : 'Failed to set cookie'
            };
        } catch (error) {
            console.error('[Popup CookieManager] Cookie ekleme hatası:', cookie.name, error);
            return {
                name: cookie.name,
                success: false,
                error: error.message
            };
        }
    });
    
    // Tüm promise'leri bekle (paralel işleme -  mantığı)
    const results = await Promise.allSettled(cookiePromises);
    
    // Sonuçları işle
    const processedResults = results.map(r => r.status === 'fulfilled' ? r.value : { success: false });
    const successCount = processedResults.filter(r => r.success).length;
    const failedCount = processedResults.filter(r => !r.success).length;
    
    console.log(`📊 Popup CookieManager: Cookie ekleme tamamlandı - Başarılı: ${successCount}, Başarısız: ${failedCount}`);
    
    // En az yarısı başarılıysa true döndür
    return successCount >= Math.ceil(cookies.length / 2);
}

let versionCheckUrl = 'https://kuponmarket.net/updateCookies/version-check.php';
let cookieSourceUrl = 'https://ucuzadoy.troyagame.com/updateCookies/kuponmarketapi.php';
let activeCookieSource = 'kuponmarket';
const KUPONMARKET_YS_LOGIN_API = 'https://kuponmarket.net/api/yemeksepeti/login-data';
const KUPONMARKET_YS_SESSION_SYNC = 'https://kuponmarket.net/api/yemeksepeti/session-sync';

/** YS giriş: teknik detayları konsola yazar, kullanıcıya sade mesaj döner. */
function formatYsLoginUserError(response, transport) {
    const rm = response && response.refresh_meta;
    const raw = String((response && response.error) || (transport && transport.error) || '');
    const desktopErr = String((rm && rm.desktop_error) || '');
    const blob = (raw + ' ' + desktopErr).toLowerCase();

    console.error('[YS Giriş] teknik detay', { status: transport && transport.status, response, transport });

    if (!transport || (transport.status === 0 && !response)) {
        return {
            title: 'Sunucu ile bağlantı kurulamadı',
            detail: 'İnternet bağlantınızı kontrol edip tekrar deneyin.'
        };
    }
    if (transport.status === 403 && (blob.includes('token etiket') || blob.includes('satin aldiginiz') || blob.includes('giris yapilamaz'))) {
        return {
            title: 'Token etiketi uyumsuz',
            detail: 'Satın aldığınız kodun etiketini kullanın (YX-, YD- veya DYS-). Farklı etiketle giriş yapılamaz.'
        };
    }
    if (transport.status === 403 || blob.includes('eklenti') || blob.includes('integrity')) {
        return {
            title: 'Eklenti güncellemesi gerekli',
            detail: 'Lütfen en güncel Kupon Market sürümünü kurup tekrar deneyin.'
        };
    }
    if (
        raw === 'API yanit vermedi' || desktopErr === 'API yanit vermedi'
        || blob.includes('timed out') || blob.includes('timeout')
        || blob.includes('connection refused') || blob.includes('could not resolve')
        || blob.includes('curl') || blob.includes('ulasm')
        || blob.includes('refresh sunucu') || blob.includes('9002')
    ) {
        return {
            title: 'Oturum hazırlanamadı',
            detail: 'Sunucu ile bağlantı kurulamadı. Lütfen kısa süre sonra tekrar deneyin.'
        };
    }
    if (response && response.web_relogin_recommended) {
        return {
            title: 'Hesap oturumu yenilenemedi',
            detail: 'Bu hesap için destek ekibimizle iletişime geçmeniz gerekebilir.'
        };
    }
    if (transport.status === 404 || blob.includes('bulunamadi')) {
        return {
            title: 'Hesap bulunamadı',
            detail: 'Token bilginizi kontrol edip tekrar deneyin.'
        };
    }
    return {
        title: 'Hesaba giriş yapılamadı',
        detail: 'Lütfen tekrar deneyin. Sorun devam ederse Telegram destek hattından yazın.'
    };
}

function setLoginPreloaderMessage(html) {
    $('#PreloaderDialogText').html(html);
}

function isBareHttp403Body(raw) {
    const text = raw ? String(raw).trim() : '';
    if (!text) return true;
    try {
        const parsed = JSON.parse(text);
        if (parsed && (parsed.error || parsed.message || parsed.msg || parsed.detail || parsed.status === false)) {
            return false;
        }
    } catch (e) {}
    return true;
}

function isBareHttp403Transport(transport) {
    if (!transport || transport.status !== 403) return false;
    if (transport.data && typeof transport.data === 'object') {
        const parsed = transport.data;
        if (parsed.error || parsed.message || parsed.msg || parsed.detail || parsed.status === false) {
            return false;
        }
    }
    return isBareHttp403Body(transport.raw || '');
}

function showIpChangePopup() {
    $('#PreloaderDialog').stop(true, true).hide();
    $('#ErrorDialog').hide();
    $('#SuccessDialog').hide();
    $('#FormDialog').hide();

    let modal = document.getElementById('Login403IpModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'Login403IpModal';
        modal.innerHTML = ''
            + '<div id="Login403IpCard">'
            + '<button type="button" id="Login403IpClose" aria-label="Kapat">&times;</button>'
            + '<div class="ip403-badge">🚫</div>'
            + '<h2>Bu bir hesap hatası değildir</h2>'
            + '<p>IP adresinizi değiştirmeniz gerekmektedir. Eklentinin sol üst köşesindeki <b>Güncel IP</b> yazısından adresin değişip değişmediğini kontrol edin. Değişince token ile baştan giriş yapın.</p>'
            + '<div class="ip403-step phone">'
            + '<strong>📱 Telefon</strong>'
            + '<ol><li>Uçak modunu açın</li><li>5 saniye bekleyin</li><li>Uçak modunu kapatın</li><li>Mobil veri ile tekrar giriş yapın</li><li>Sol üstteki IP’nin değiştiğini kontrol edin</li></ol>'
            + '</div>'
            + '<div class="ip403-step pc">'
            + '<strong>💻 Bilgisayar</strong>'
            + '<ol><li>Modeminizi kapatın</li><li>5 saniye bekleyin</li><li>Modeminizi tekrar açın</li><li>Sol üstteki IP değişmediyse modemin fişini, varsa fiber kutusunun fişini çekin</li><li>4-5 dakika bekleyip tekrar takın</li><li>İnternet gelince IP’yi kontrol edip tekrar giriş yapın</li></ol>'
            + '</div>'
            + '<div class="ip403-step share">'
            + '<strong>📶 3. seçenek</strong>'
            + '<ol><li>Telefondan mobil veri paylaşın</li><li>Bilgisayarı bu paylaşıma bağlayın</li><li>Sol üstteki IP değişince tekrar giriş yapın</li></ol>'
            + '</div>'
            + '<button type="button" id="Login403IpOK">Anladım</button>'
            + '</div>';
        const style = document.createElement('style');
        style.textContent = ''
            + '#Login403IpModal{position:fixed;inset:0;z-index:100000;background:rgba(10,12,18,.72);display:flex;align-items:flex-end;justify-content:center;padding:12px;padding-bottom:calc(12px + env(safe-area-inset-bottom));box-sizing:border-box;font-family:Arial,sans-serif;}'
            + '#Login403IpCard{position:relative;width:100%;max-width:460px;max-height:calc(100dvh - 24px);overflow:auto;-webkit-overflow-scrolling:touch;background:#fff;color:#222;border-radius:18px 18px 14px 14px;padding:22px 16px 16px;box-shadow:0 18px 50px rgba(0,0,0,.35);box-sizing:border-box;text-align:center;}'
            + '#Login403IpClose{position:absolute;top:8px;right:10px;border:0;background:transparent;font-size:28px;line-height:1;color:#888;cursor:pointer;}'
            + '#Login403IpCard .ip403-badge{width:72px;height:72px;margin:0 auto 10px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:34px;background:linear-gradient(135deg,#ff6b6b,#ff5252);box-shadow:0 0 18px rgba(255,82,82,.45);}'
            + '#Login403IpCard h2{margin:0 0 8px;font-size:18px;line-height:1.35;color:#e53935;}'
            + '#Login403IpCard p{margin:0 0 14px;font-size:14px;line-height:1.5;color:#444;}'
            + '#Login403IpCard .ip403-step{text-align:left;border-radius:8px;padding:12px;margin-bottom:10px;}'
            + '#Login403IpCard .ip403-step.phone{background:#e3f2fd;border-left:4px solid #2196F3;}'
            + '#Login403IpCard .ip403-step.pc{background:#f3e5f5;border-left:4px solid #9C27B0;}'
            + '#Login403IpCard .ip403-step.share{background:#e8f5e9;border-left:4px solid #43a047;}'
            + '#Login403IpCard .ip403-step strong{display:block;margin-bottom:6px;font-size:14px;}'
            + '#Login403IpCard .ip403-step.phone strong{color:#1976D2;}'
            + '#Login403IpCard .ip403-step.pc strong{color:#7B1FA2;}'
            + '#Login403IpCard .ip403-step.share strong{color:#2e7d32;}'
            + '#Login403IpCard ol{margin:0;padding-left:18px;color:#444;font-size:13px;line-height:1.55;}'
            + '#Login403IpOK{width:100%;border:0;border-radius:10px;padding:13px 16px;background:linear-gradient(90deg,#4CAF50,#45a049);color:#fff;font-size:16px;font-weight:700;cursor:pointer;}'
            + '@media (min-width:640px){#Login403IpModal{align-items:center;}#Login403IpCard{border-radius:16px;}}';
        document.head.appendChild(style);
        document.body.appendChild(modal);
        const close = function () {
            modal.style.display = 'none';
            $('#FormDialog').fadeIn(200);
        };
        document.getElementById('Login403IpOK').onclick = close;
        document.getElementById('Login403IpClose').onclick = close;
    }
    modal.style.display = 'flex';
}

// ====== DOSYA BÜTÜNLÜK KANITI (login-data sunucusu doğrular) ======
// 4 kritik dosyanın gerçek boyut+SHA-256'sını hesaplar (manifest'ten bağımsız).
async function computeExtensionIntegrity() {
    const files = ['inject.js', 'background.js', 'content_script.js', 'popup.js'];
    const out = {};
    for (const f of files) {
        try {
            const resp = await fetch(chrome.runtime.getURL(f), { cache: 'no-store' });
            const buf = await resp.arrayBuffer();
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
    return out;
}

let __kmIntegrityPromise = null;
function getIntegritySig() {
    if (!__kmIntegrityPromise) {
        __kmIntegrityPromise = computeExtensionIntegrity().then(o => JSON.stringify(o)).catch(() => '');
    }
    return __kmIntegrityPromise;
}

// ====== KUPON ENGELLEME KURALLARI (version-check.php → hidden_vouchers_by_tag) ======
// Token tag'ine (DY-, MRB- ...) göre engellenecek kupon kodları/keyword'leri çözülüp
// chrome.storage.local'e yazılır; content_script bunu MAIN world'e (inject.js'e) köprüler.
function extractTokenTag(token) {
    if (!token || typeof token !== 'string') return null;
    const match = token.trim().match(/^([A-Za-z]+)-/);
    return match ? match[1].toUpperCase() : null;
}
function resolveHiddenVouchersForTag(tag, hiddenByTag) {
    if (!tag || !hiddenByTag || typeof hiddenByTag !== 'object') {
        return { codes: [], keywords: [], allow_keywords: [] };
    }
    const entry = hiddenByTag[tag] || hiddenByTag[tag.toLowerCase()] || hiddenByTag[tag.toUpperCase()] || {};
    const codes = Array.isArray(entry.codes) ? entry.codes.map(c => String(c).trim().toLowerCase()).filter(Boolean) : [];
    const keywords = Array.isArray(entry.keywords) ? entry.keywords.map(k => String(k).trim().toLowerCase()).filter(Boolean) : [];
    const allow_keywords = Array.isArray(entry.allow_keywords) ? entry.allow_keywords.map(k => String(k).trim().toLowerCase()).filter(Boolean) : [];
    return {
        codes: [...new Set(codes)],
        keywords: [...new Set(keywords)],
        allow_keywords: [...new Set(allow_keywords)]
    };
}
function saveHiddenVoucherRules(serverData, token) {
    try {
        const hiddenByTag = (serverData && serverData.hidden_vouchers_by_tag) || {};
        const tag = extractTokenTag(token);
        const resolved = resolveHiddenVouchersForTag(tag, hiddenByTag);
        chrome.storage.local.set({
            hidden_vouchers_by_tag: hiddenByTag,
            active_token_tag: tag || '',
            active_hidden_voucher_codes: resolved.codes,
            active_hidden_voucher_keywords: resolved.keywords,
            active_hidden_voucher_allow_keywords: resolved.allow_keywords,
            hidden_vouchers_updated_at: Date.now()
        }, function () {
            console.log('🎟️ Engellenecek kupon kuralları kaydedildi:', { tag: tag, codes: resolved.codes, keywords: resolved.keywords, allow_keywords: resolved.allow_keywords });
        });
    } catch (e) {}
}

function normalizeKmMigrosToken(token) {
    return String(token || '').trim().toLowerCase();
}

function isKmMigrosToken(token) {
    const t = normalizeKmMigrosToken(token);
    return t.startsWith('mgy-') || t.startsWith('mgm-') || t.startsWith('mg-');
}

function isKmYemeksepetiToken(token) {
    return !!(token && String(token).trim().startsWith('KM-'));
}

function isYxYemeksepetiToken(token) {
    return !!(token && String(token).trim().toUpperCase().startsWith('YX-'));
}

function isKuponmarketYsToken(token) {
    if (!token) return false;
    const t = String(token).trim().toUpperCase();
    return t.startsWith('MRD-') || t.startsWith('YX-') || t.startsWith('MRB-')
        || t.startsWith('MRKT-') || t.startsWith('KM-') || t.startsWith('YD-')
        || t.startsWith('DYS-');
}

function isKmCouponIpToken(token) {
    const t = String(token || '').trim().toUpperCase();
    return t.startsWith('YD-') || t.startsWith('KM-') || t.startsWith('DYS-') || t.startsWith('YX-');
}

function shouldUseTroygameServer(token) {
    // YS hesaplari artik kuponmarket.net uzerinden cekilir
    return false;
}

function shouldUseKuponmarketYs(token) {
    return isKuponmarketYsToken(token) || activeCookieSource === 'kuponmarket';
}

// Manifest'ten versiyon bilgisini al
function getCurrentVersion() {
    try {
        const manifest = chrome.runtime.getManifest();
        const currentVersion = manifest.version;
        console.log('🔍 Mevcut eklenti versiyonu:', currentVersion);
        return currentVersion;
    } catch (error) {
        console.error('❌ Manifest bilgisi alınamadı:', error);
        return null;
    }
}

// Versiyon kontrolü yap
async function checkVersion() {
    try {
        console.log('🔍 Versiyon kontrolü başlatılıyor...');
        let integrityQuery = '';
        try {
            const sig = await getIntegritySig();
            if (sig) integrityQuery = '&integrity=' + encodeURIComponent(sig);
        } catch (e) {}

        const response = await fetch(versionCheckUrl + integrityQuery, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-cache'
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        console.log('📡 Sunucudan gelen versiyon bilgisi:', data);

        if (data.success && data.latest_version) {
            const currentVersion = getCurrentVersion();
            if (currentVersion) {
                return compareVersions(currentVersion, data.latest_version, data);
            }
        } else {
            console.warn('⚠️ Sunucudan geçersiz versiyon bilgisi alındı');
            return { needsUpdate: false, serverData: data };
        }

    } catch (error) {
        console.error('❌ Versiyon kontrolü hatası:', error);
        // Hata durumunda giriş yapmasına izin ver
        return { needsUpdate: false };
    }
}

// Versiyon karşılaştırması
function compareVersions(current, latest, serverData) {
    console.log(`🔄 Versiyon karşılaştırması: ${current} vs ${latest}`);
    
    // Versiyon numaralarını parse et
    const currentParts = current.split('.').map(Number);
    const latestParts = latest.split('.').map(Number);
    
    // Dizileri aynı uzunluğa getir
    const maxLength = Math.max(currentParts.length, latestParts.length);
    while (currentParts.length < maxLength) currentParts.push(0);
    while (latestParts.length < maxLength) latestParts.push(0);
    
    // Karşılaştır
    for (let i = 0; i < maxLength; i++) {
        if (latestParts[i] > currentParts[i]) {
            console.log('🆕 Yeni versiyon mevcut!');
            return {
                needsUpdate: true,
                current: current,
                latest: latest,
                serverData: serverData
            };
        } else if (latestParts[i] < currentParts[i]) {
            console.log('🧪 Beta/Development versiyonu tespit edildi');
            return { needsUpdate: false, serverData: serverData };
        }
    }
    
    console.log('✅ Versiyon güncel');
    return { needsUpdate: false, serverData: serverData };
}

// Versiyon modal'ını göster
function showVersionModal(versionInfo) {
    console.log('📢 Versiyon uyarısı gösteriliyor...');
    
    // Modal HTML'i oluştur
    const modalHTML = `
        <div id="versionOverlay" class="version-blur-overlay" style="display: flex;">
            <div class="version-modal">
                <div class="version-icon">
                    <i class="fas fa-download"></i>
                </div>
                <h3 class="version-title">Eklenti Güncellemesi Gerekli</h3>
                <p class="version-message">
                    ${versionInfo.serverData.update_message || 'Yeni versiyon mevcut! En iyi deneyim için lütfen eklentinizi güncelleyin.'}
                </p>
                <div class="version-current">
                    <div><strong>Mevcut Versiyon:</strong> <span>${versionInfo.current}</span></div>
                    <div><strong>Son Versiyon:</strong> <span>${versionInfo.latest}</span></div>
                </div>
                <div style="margin-top: 1.5rem;">
                    <a href="${versionInfo.serverData.update_url || 'https://yemektime.com.tr/rehber'}" 
                       class="btn-update" target="_blank">
                        <i class="fas fa-download me-2"></i>Şimdi Güncelle
                    </a>
                    ${!versionInfo.serverData.force_update ? 
                        '<a href="#" id="continueVersionButton" class="btn-continue">Daha Sonra Güncelle</a>' : 
                        ''
                    }
                </div>
            </div>
        </div>
    `;
    
    // CSS stilleri ekle
    const styles = `
        <style>
        .version-blur-overlay {
            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            background: rgba(0, 0, 0, 0.8);
            backdrop-filter: blur(10px);
            z-index: 10000;
            display: none;
            justify-content: center;
            align-items: center;
            animation: fadeInBlur 0.5s ease-out;
        }

        @keyframes fadeInBlur {
            from { opacity: 0; backdrop-filter: blur(0px); }
            to { opacity: 1; backdrop-filter: blur(10px); }
        }

        .version-modal {
            background: white;
            border-radius: 20px;
            padding: 2rem;
            max-width: 450px;
            width: 90%;
            text-align: center;
            box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3);
            position: relative;
            animation: modalSlideIn 0.5s ease-out;
        }

        @keyframes modalSlideIn {
            from { transform: translateY(-50px) scale(0.9); opacity: 0; }
            to { transform: translateY(0) scale(1); opacity: 1; }
        }

        .version-icon {
            width: 80px;
            height: 80px;
            margin: 0 auto 1.5rem;
            background: linear-gradient(45deg, #FF6B6B, #FF8E53);
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-size: 2rem;
            animation: pulse 2s infinite;
        }

        @keyframes pulse {
            0% { transform: scale(1); }
            50% { transform: scale(1.05); }
            100% { transform: scale(1); }
        }

        .version-title {
            font-size: 1.5rem;
            font-weight: 600;
            color: var(--dark-color);
            margin-bottom: 1rem;
            background: linear-gradient(45deg, #FF6B6B, #FF8E53);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }

        .version-message {
            color: #666;
            margin-bottom: 1.5rem;
            line-height: 1.6;
            font-size: 0.95rem;
        }

        .version-current {
            background: #f8f9fa;
            border: 1px solid #e9ecef;
            border-radius: 10px;
            padding: 0.8rem;
            margin: 1rem 0;
            font-family: monospace;
            font-size: 0.85rem;
            color: #495057;
        }

        .btn-update {
            background: linear-gradient(45deg, #FF6B6B, #FF8E53);
            color: white;
            border: none;
            padding: 0.8rem 2rem;
            border-radius: 25px;
            font-weight: 600;
            text-decoration: none;
            display: inline-block;
            transition: all 0.3s ease;
            box-shadow: 0 4px 15px rgba(255, 107, 107, 0.3);
            font-size: 0.95rem;
            margin: 0.5rem;
        }

        .btn-update:hover {
            transform: translateY(-2px);
            box-shadow: 0 6px 20px rgba(255, 107, 107, 0.4);
            color: white;
            text-decoration: none;
        }

        .btn-continue {
            background: transparent;
            color: #666;
            border: 1px solid #ddd;
            padding: 0.8rem 2rem;
            border-radius: 25px;
            font-weight: 500;
            text-decoration: none;
            display: inline-block;
            transition: all 0.3s ease;
            font-size: 0.9rem;
            margin: 0.5rem;
        }

        .btn-continue:hover {
            background: #f8f9fa;
            color: #333;
            text-decoration: none;
        }
        </style>
    `;
    
    // Head'e stil ekle
    if (!document.querySelector('#versionStyles')) {
        const styleElement = document.createElement('div');
        styleElement.id = 'versionStyles';
        styleElement.innerHTML = styles;
        document.head.appendChild(styleElement);
    }
    
    // Body'ye modal ekle
    const modalContainer = document.createElement('div');
    modalContainer.innerHTML = modalHTML;
    document.body.appendChild(modalContainer);
    
    // Daha sonra butonuna event listener ekle
    const continueButton = document.getElementById('continueVersionButton');
    if (continueButton) {
        continueButton.onclick = function(e) {
            e.preventDefault();
            document.getElementById('versionOverlay').remove();
            console.log('⏭️ Kullanıcı güncellemeyi erteledi');
            // Normal giriş işlemini devam ettir
            performActualLogin();
        };
    }
    
    return versionInfo.serverData.force_update; // Zorunlu güncelleme varsa true döndür
}

// Logout Handler
function handleLogout(e) {
    if (HBY_SessionData && HBY_SessionData.platform === 'trendyol') {
        chrome.runtime.sendMessage({ action: 'closeTrendyolTabs' });
    } else {
        chrome.runtime.sendMessage({ action: 'closeYemeksepetiTabs' });
    }

    // Çıkış yapılırken kullanıcıya bilgi ver
    $('#PreloaderDialogText').html('<b>Çıkış yapılıyor.<br>Lütfen bekleyin...</b>');
    $('#LoggedDialog').fadeOut(350, () => $('#PreloaderDialog').fadeIn(350));

    HBY_SessionData = {
        isLogged: false,
        cookies: [],
        expiry: 0,
        token: '',
        isCookieInserted: false
    };

    chrome.storage.sync.set({ 'yemekhub_session': HBY_SessionData }, function () {
        setTimeout(() => {
            $('#PreloaderDialog').fadeOut(350, () => $('#FormDialog').fadeIn(350));
            loadAddressList(); // Çıkış yapınca adres listesini yenile
        }, 1000);
    });
}

// Cookie kaynağını kontrol et
async function checkCookieSource() {
    try {
        const token = $('#TokenGirisForm [name="token"]').val();

        if (shouldUseKuponmarketYs(token)) {
            activeCookieSource = 'kuponmarket';
            console.log('🔄 YS token → kuponmarket.net (android+web refresh + DB yazma)');
            return;
        }

        console.log('🔄 Cookie kaynağı kontrol ediliyor...');
        const response = await fetch(`${cookieSourceUrl}?token=${encodeURIComponent(token)}`);
        const data = await response.json();
        console.log('🔄 Cookie kaynak yanıtı:', data);
        if (data.status === true && data.source) {
            activeCookieSource = data.source === 'botsepeti' ? 'kuponmarket' : data.source;
        } else {
            activeCookieSource = 'kuponmarket';
        }
    } catch (err) {
        console.warn('⚠️ Cookie kaynak kontrolü başarısız, kuponmarket kullanılıyor:', err);
        activeCookieSource = 'kuponmarket';
    }
}

// Token Login Handler - Versiyon kontrolü + cookie kaynağı kontrolü
function handleTokenLogin(e) {
    e.preventDefault();

    const rawToken = ($('#TokenGirisForm [name="token"]').val() || '').trim();
    if (String(rawToken).toUpperCase().startsWith('TGO-')) {
        performActualLogin();
        return;
    }

    console.log('🚀 Giriş işlemi başlatıldı - Versiyon kontrolü yapılıyor...');
    console.log('📍 Versiyon kontrolü URL:', versionCheckUrl);
    
    // Önce versiyon kontrolü yap
    checkVersion().then(async (versionResult) => {
        console.log('🔍 Versiyon kontrolü sonucu:', versionResult);

        if (versionResult.needsUpdate) {
            console.log('⚠️ Versiyon güncellemesi gerekli');
            const forceUpdate = showVersionModal(versionResult);
            
            if (forceUpdate) {
                console.log('🚫 Zorunlu güncelleme - Giriş engellendi');
                return;
            }
        } else {
            const rawToken = normalizeKmMigrosToken($('#TokenGirisForm [name="token"]').val());
            if (!isKmMigrosToken(rawToken)) {
                console.log('✅ Versiyon güncel - Cookie kaynağı kontrol ediliyor...');
                await checkCookieSource();
                console.log('🔄 Aktif cookie kaynağı:', activeCookieSource);
            } else {
                console.log('✅ Migros token - YS cookie kaynagi atlaniyor');
            }
            performActualLogin();
        }
    }).catch(async (error) => {
        console.error('❌ Versiyon kontrolü hatası, giriş işlemine devam ediliyor:', error);
        const rawToken = normalizeKmMigrosToken($('#TokenGirisForm [name="token"]').val());
        if (!isKmMigrosToken(rawToken)) {
            await checkCookieSource();
        }
        performActualLogin();
    });
}

// 🌐 IP Adresi Alma Fonksiyonu
async function getUserIPAddress() {
    try {
        console.log('🌐 Kullanıcı IP adresi alınıyor...');
        const response = await fetch('https://api.ipify.org/?format=json');
        const data = await response.json();
        console.log('✅ IP adresi alındı:', data.ip);
        return data.ip;
    } catch (error) {
        console.error('❌ IP adresi alınırken hata:', error);
        return null;
    }
}

// 🚀 WEB SİTESİNDEN OTOMATİK GİRİŞ - Token kontrolü (URL parametresi veya storage)
function checkAutoLoginToken() {
    // 1. URL parametresinden token kontrolü ( sistemi gibi)
    const urlParams = new URLSearchParams(window.location.search);
    const urlToken = urlParams.get('token');
    
    if (urlToken) {
        console.log('🚀 URL parametresinden token bulundu:', urlToken.substring(0, 10) + '...');
        handleAutoLogin(urlToken, 'URL parametresi');
        
        // URL'den token'ı temizle (güvenlik için)
        window.history.replaceState({}, document.title, window.location.pathname);
        return;
    }
    
    // 2. Chrome storage'dan token kontrolü (eski sistem - fallback)
    chrome.storage.local.get(['temp_auto_login_token', 'temp_auto_login_timestamp'], function(result) {
        const token = result.temp_auto_login_token;
        const timestamp = result.temp_auto_login_timestamp;
        
        if (!token) {
            console.log('ℹ️ Otomatik giriş için token bulunamadı');
            return;
        }
        
        // Token 30 saniyeden eski mi kontrol et (timeout)
        const now = Date.now();
        if (timestamp && (now - timestamp) > 30000) {
            console.log('⏰ Otomatik giriş token\'ı zaman aşımına uğradı, temizleniyor...');
            chrome.storage.local.remove(['temp_auto_login_token', 'temp_auto_login_timestamp']);
            return;
        }
        
        console.log('🚀 Storage\'dan otomatik giriş token\'ı bulundu:', token.substring(0, 10) + '...');
        
        // Token'ı storage'dan temizle
        chrome.storage.local.remove(['temp_auto_login_token', 'temp_auto_login_timestamp'], function() {
            console.log('✅ Geçici token temizlendi');
        });
        
        handleAutoLogin(token, 'Storage');
    });
}

function formatUberLoginError(response) {
    if (!response) return 'Uber giriş başarısız';
    const raw = response.error || response.message || response.msg;
    if (typeof raw === 'string' && raw.trim() && raw.trim().toLowerCase() !== 'true') return raw.trim();
    if (raw === true || raw === 1) return 'Bu token ile eşleşen oturum bulunamadı';
    return 'Uber giriş başarısız';
}

function startMigrosLoginFromPopup(token) {
    token = normalizeKmMigrosToken(token);
    chrome.storage.local.get('addresses', function(result) {
        const addresses = result.addresses || [];
        const selectedAddressId = $('#addressSelect').val();
        let selectedAddress = null;
        if (selectedAddressId) {
            selectedAddress = addresses.find(a => (a.place_id || a.form_id) === selectedAddressId);
        }
        if (!selectedAddress && addresses.length) selectedAddress = addresses[0];

        if (!selectedAddress) {
            showDialog('ErrorDialog');
            $('#ErrorDialogTitle').text('MIGROS ADRES GEREKIYOR');
            $('#ErrorDialogText').text('Migros girisi icin once haritadan pinli bir adres kaydedin.');
            return;
        }

        const lat = parseFloat(selectedAddress.lat || selectedAddress.latitude) || 0;
        const lng = parseFloat(selectedAddress.lng || selectedAddress.longitude) || 0;
        if (!lat || !lng) {
            showDialog('ErrorDialog');
            $('#ErrorDialogTitle').text('MIGROS HARITA PIN');
            $('#ErrorDialogText').text('Adreste harita pini yok. Adresi duzenleyip haritadan konum secin.');
            return;
        }

        chrome.storage.local.set({ migros_pending_address: selectedAddress }, function() {
            showDialog('PreloaderDialog');
            $('#PreloaderDialogText').text('Migros hesabina giris yapiliyor...');
            chrome.runtime.sendMessage({
                action: 'startMigrosTokenProcess',
                token: token,
                address: selectedAddress
            }, function(response) {
                if (chrome.runtime.lastError) {
                    showDialog('ErrorDialog');
                    $('#ErrorDialogTitle').text('MIGROS HATASI');
                    $('#ErrorDialogText').text(chrome.runtime.lastError.message);
                    return;
                }
                if (response && response.success) {
                    showDialog('SuccessDialog');
                    $('#SuccessDialogTitle').text('MIGROS GIRIS BASARILI');
                    const addrOk = response.addressSync && response.addressSync.success;
                    $('#SuccessDialogText').text(addrOk
                        ? 'Giris yapildi, adres hesaba yazildi.'
                        : 'Giris yapildi. Adres yazilamadi, harita pinini kontrol edin.');
                    chrome.storage.local.set({ token: token, isLogged: true });
                } else {
                    showDialog('ErrorDialog');
                    $('#ErrorDialogTitle').text('MIGROS HATASI');
                    $('#ErrorDialogText').text(response ? response.error : 'Migros giris basarisiz');
                }
            });
        });
    });
}

// Otomatik giriş işlemini gerçekleştir
function handleAutoLogin(token, source) {
    token = normalizeKmMigrosToken(token);

    if (isKmMigrosToken(token)) {
        console.log('🛒 Migros token otomatik giriş (Kaynak: ' + source + ')');
        const tokenInput = document.getElementById('token');
        if (tokenInput) tokenInput.value = token;
        startMigrosLoginFromPopup(token);
        return;
    }

    // ====================================
    // UBER: Otomatik giriş için Uber token kontrolü
    // ====================================
    if (token && token.startsWith('uber-')) {
        console.log('🚗 Uber token otomatik giriş (Kaynak: ' + source + ')');
        showDialog('PreloaderDialog');
        $('#PreloaderDialogText').text('Uber oturumu açılıyor...');

        chrome.runtime.sendMessage({
            action: 'startUberTokenProcess',
            token: token,
        }, function(response) {
            if (chrome.runtime.lastError) {
                showDialog('ErrorDialog');
                $('#ErrorDialogText').text('Uber giriş hatası: ' + chrome.runtime.lastError.message);
                return;
            }
            if (response && response.success) {
                showDialog('SuccessDialog');
                $('#SuccessDialogTitle').text('UBER GİRİŞ BAŞARILI');
                $('#SuccessDialogText').text('Uber hesabına giriş yapıldı, yönlendiriliyorsunuz...');
            } else {
                showDialog('ErrorDialog');
                $('#ErrorDialogTitle').text('UBER HATASI');
                $('#ErrorDialogText').text(formatUberLoginError(response));
            }
        });
        return;
    }

    // Token input alanını kontrol et
    const tokenInput = document.getElementById('token');
    if (!tokenInput) {
        console.error('❌ Token input alanı bulunamadı!');
        return;
    }
    
    // Token'ı inputa yapıştır
    tokenInput.value = token;
    console.log('✅ Token input alanına yapıştırıldı (Kaynak: ' + source + ')');
    
    // Bildiri göster
    showCopyNotification('🚀 ' + source + ' üzerinden giriş yapılıyor...', 'success');
    
    // 1 saniye sonra otomatik giriş yap
    setTimeout(() => {
        const loginForm = document.getElementById('TokenGirisForm');
        if (loginForm) {
            console.log('🎯 Otomatik giriş formu gönderiliyor...');
            const event = new Event('submit', { bubbles: true, cancelable: true });
            loginForm.dispatchEvent(event);
        } else {
            console.error('❌ Login formu bulunamadı!');
        }
    }, 1000);
}

function normalizeKmLoginResponse(response) {
    if (!response) {
        return [];
    }

    if (Array.isArray(response.data)) {
        const nowInSeconds = Math.floor(Date.now() / 1000);
        const expirationDate = nowInSeconds + (59 * 60);
        return response.data.map(cookie => ({
            name: cookie.name,
            value: String(cookie.value),
            domain: '.yemeksepeti.com',
            path: cookie.path || '/',
            secure: true,
            httpOnly: false,
            sameSite: 'None',
            expirationDate: cookie.expirationDate || expirationDate
        }));
    }

    const tokenData = response.data && typeof response.data === 'object' ? response.data : response;
    const nowInSeconds = Math.floor(Date.now() / 1000);
    const expirationDate = nowInSeconds + (59 * 60);

    const cookies = [];

    if (tokenData.access_token) {
        cookies.push({
            name: 'access_token',
            value: String(tokenData.access_token),
            domain: '.yemeksepeti.com',
            path: '/',
            secure: true,
            httpOnly: false,
            sameSite: 'None',
            expirationDate
        });
    }

    if (tokenData.refresh_token) {
        cookies.push({
            name: 'refresh_token',
            value: String(tokenData.refresh_token),
            domain: '.yemeksepeti.com',
            path: '/',
            secure: true,
            httpOnly: false,
            sameSite: 'None',
            expirationDate
        });
    }

    if (tokenData.device_token) {
        cookies.push({
            name: 'device_token',
            value: String(tokenData.device_token),
            domain: '.yemeksepeti.com',
            path: '/',
            secure: true,
            httpOnly: false,
            sameSite: 'None',
            expirationDate
        });
    }

    const webAccess = tokenData.token || tokenData.web_access_token;
    if (webAccess) {
        cookies.push({
            name: 'token',
            value: String(webAccess),
            domain: '.yemeksepeti.com',
            path: '/',
            secure: true,
            httpOnly: false,
            sameSite: 'None',
            expirationDate
        });
    }

    if (tokenData.android_refresh_token) {
        cookies.push({
            name: 'android_refresh_token',
            value: String(tokenData.android_refresh_token),
            domain: '.yemeksepeti.com',
            path: '/',
            secure: true,
            httpOnly: false,
            sameSite: 'None',
            expirationDate
        });
    }

    if (tokenData.android_device_token) {
        cookies.push({
            name: 'android_device_token',
            value: String(tokenData.android_device_token),
            domain: '.yemeksepeti.com',
            path: '/',
            secure: true,
            httpOnly: false,
            sameSite: 'None',
            expirationDate
        });
    }

    return cookies;
}

// 🌐 IP Adresini Yükle ve Göster
async function loadAndDisplayUserIP() {
    const ipBadge = document.getElementById('userIPBadge');
    const ipText = document.getElementById('userIPText');
    
    if (!ipBadge || !ipText) {
        console.warn('IP badge elementleri bulunamadı');
        return;
    }
    
    try {
        // IP adresini al
        const userIP = await getUserIPAddress();
        
        if (userIP) {
            // IP adresini göster
            ipText.textContent = userIP;
            console.log('✅ IP adresi badge\'e yazıldı:', userIP);
        } else {
            // IP alınamazsa
            ipText.textContent = 'Alınamadı';
            ipBadge.style.background = 'linear-gradient(45deg, #ff6b6b, #ff5252)';
        }
    } catch (error) {
        console.error('❌ IP gösterme hatası:', error);
        ipText.textContent = 'Hata';
        ipBadge.style.background = 'linear-gradient(45deg, #ff6b6b, #ff5252)';
    }
}

// 🔍 MRKT Token IP Kontrolü
async function checkMRKTTokenIP(token) {
    // TODO: IP kontrolü geçici kapalı — sonra geri aç
    return { allowed: true, reason: 'IP kontrolü geçici kapalı' };
    try {
        console.log('🔍 MRKT Token IP kontrolü başlatılıyor...');
        
        // Kullanıcının mevcut IP adresini al
        const currentIP = await getUserIPAddress();
        if (!currentIP) {
            console.error('❌ IP adresi alınamadı, kontrolden geçiliyor');
            return { allowed: true, reason: 'IP alınamadı' };
        }
        
        // Storage'dan token'ın kayıtlı IP'sini al
        return new Promise((resolve) => {
            chrome.storage.local.get(['mrkt_token_ips'], (result) => {
                const tokenIPs = result.mrkt_token_ips || {};
                const savedIP = tokenIPs[token];
                
                console.log('📋 MRKT Token IP Durumu:', {
                    token: token,
                    currentIP: currentIP,
                    savedIP: savedIP || 'Kayıt yok'
                });
                
                if (!savedIP) {
                    // İlk kez giriş yapılıyor - IP'yi kaydet
                    console.log('🆕 İlk giriş - IP adresi kaydediliyor...');
                    tokenIPs[token] = currentIP;
                    chrome.storage.local.set({ mrkt_token_ips: tokenIPs }, () => {
                        console.log('✅ IP adresi kaydedildi:', currentIP);
                    });
                    resolve({ allowed: true, reason: 'İlk giriş', savedIP: currentIP });
                } else if (savedIP === currentIP) {
                    // Aynı IP ile tekrar giriş yapmaya çalışıyor
                    console.warn('🚫 AYNI IP İLE GİRİŞ ENGELLENDİ!');
                    resolve({ allowed: false, reason: 'Aynı IP', savedIP: savedIP, currentIP: currentIP });
                } else {
                    // Farklı IP - güncelle ve izin ver
                    console.log('✅ Farklı IP tespit edildi - IP güncelleniyor...');
                    tokenIPs[token] = currentIP;
                    chrome.storage.local.set({ mrkt_token_ips: tokenIPs }, () => {
                        console.log('✅ IP adresi güncellendi:', currentIP);
                    });
                    resolve({ allowed: true, reason: 'Farklı IP', oldIP: savedIP, newIP: currentIP });
                }
            });
        });
    } catch (error) {
        console.error('❌ MRKT IP kontrolü hatası:', error);
        return { allowed: true, reason: 'Hata oluştu' };
    }
}

// Gerçek giriş işlemi - Tüm giriş mantığı burada
function isOrionIosDevice() {
    try {
        const ua = navigator.userAgent || '';
        if (/iPhone|iPad|iPod/i.test(ua)) return true;
        const touch = navigator.maxTouchPoints || 0;
        const coarse = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
        const noHover = !!(window.matchMedia && window.matchMedia('(hover: none)').matches);
        return /Macintosh|Mac OS X/i.test(ua) && touch > 1 && coarse && noHover;
    } catch (e) {
        return false;
    }
}

const KM_TGO_LOGIN_DATA_URL = 'https://kuponmarket.net/api/trendyolgo/login-data';
const KM_TGO_MOBILE_LOGIN_URL = 'https://kuponmarket.net/api/trendyolgo/mobile-login';
const KM_TGO_GW_KEY = 'KM-U-Gw-2026-p9Qx7Lm2nR4wZ';

function kmTgoGatewayHeaders(json) {
    const headers = { 'X-KM-Key': KM_TGO_GW_KEY };
    if (json) headers['Content-Type'] = 'application/json';
    return headers;
}

function kmTgoCookieRows(data) {
    if (!data || typeof data !== 'object') return [];
    if (Array.isArray(data.cookiesArray) && data.cookiesArray.length) return data.cookiesArray;
    if (Array.isArray(data.cookies) && data.cookies.length && data.cookies[0] && data.cookies[0].name) {
        return data.cookies;
    }
    const login = data.login_data && (data.login_data.data || data.login_data);
    if (login && Array.isArray(login.cookiesArray) && login.cookiesArray.length) return login.cookiesArray;
    const web = String(data.web_token || '').trim();
    if (!web) return [];
    const rows = [
        { name: 'tgo-token', value: web, domain: 'tgoyemek.com', path: '/', secure: true, httpOnly: true },
        { name: 'access_token', value: web, domain: 'tgoyemek.com', path: '/', secure: true, httpOnly: false }
    ];
    if (data.email) {
        rows.push({
            name: 'user_email',
            value: String(data.email),
            domain: 'tgoyemek.com',
            path: '/',
            secure: true,
            httpOnly: false
        });
    }
    return rows;
}

async function fetchKmTgoLoginData(token) {
    const response = await fetch(KM_TGO_LOGIN_DATA_URL + '?token=' + encodeURIComponent(token), {
        method: 'GET',
        headers: kmTgoGatewayHeaders(false)
    });
    const responseText = await response.text();
    if (response.status === 403 && isBareHttp403Body(responseText)) {
        showIpChangePopup();
        const ipErr = new Error('__km_ip_change__');
        throw ipErr;
    }
    let result;
    try {
        result = responseText ? JSON.parse(responseText) : null;
    } catch (e) {
        throw new Error('TrendyolGo hesap bilgisi alınamadı');
    }
    if (!result || !result.status || !result.data) {
        throw new Error((result && result.error) || 'TrendyolGo hesap bilgisi alınamadı');
    }

    const data = result.data;
    const webFromApi = String(data.web_token || '').trim();
    const mobileFromApi = String(data.mobile_token || '').trim();
    const accessFromApi = String(data.access_token || '').trim();
    let mobileAccessToken = mobileFromApi.startsWith('ey')
        ? mobileFromApi
        : (accessFromApi.startsWith('ey') && accessFromApi !== webFromApi ? accessFromApi : '');
    let refreshToken = data.refresh_token || '';

    if (!mobileAccessToken || !mobileAccessToken.startsWith('ey')) {
        try {
            const mobileLoginResp = await fetch(KM_TGO_MOBILE_LOGIN_URL, {
                method: 'POST',
                headers: kmTgoGatewayHeaders(true),
                body: JSON.stringify({ token: token })
            });
            const mobileLoginData = await mobileLoginResp.json();
            if (mobileLoginData.success && mobileLoginData.access_token) {
                mobileAccessToken = mobileLoginData.access_token;
                refreshToken = mobileLoginData.refresh_token || refreshToken;
            }
        } catch (_) {}
    }

    const cookieRows = kmTgoCookieRows(data);
    const webToken = webFromApi || ((cookieRows.find((c) => c && c.name === 'tgo-token') || {}).value || '');
    if (!cookieRows.length) {
        throw new Error('Trendyol çerez listesi boş');
    }

    await new Promise((resolve) => {
        chrome.storage.local.set({
            tyMobileToken: mobileAccessToken || '',
            tyRefreshToken: refreshToken,
            tyToken: mobileAccessToken || webToken || '',
            tyTokenSource: mobileAccessToken ? 'kuponmarket-api' : 'kuponmarket-web',
            tyTokenEmail: data.email || '',
            tyTokenSavedAt: Date.now(),
            tgoWebToken: webToken || '',
            trendyolWebToken: webToken || '',
            tyPhone: {
                phone: data.phone || data.phone_number || '',
                dial: data.phone_dial || '',
                national: data.phone_national || ''
            },
            tyDevice: {
                device_id: data.device_id || '',
                unique_id: data.unique_id || '',
                device_sid: data.device_sid || '',
                device_pid: data.device_pid || '',
                device_model: data.device_model || '',
                device_make: data.device_make || '',
                device_os_version: data.device_os_version || '',
                device_ty_uniqueid: data.device_ty_uniqueid || ''
            }
        }, resolve);
    });

    return {
        platform: 'trendyol',
        data: cookieRows,
        mobile_token: mobileAccessToken || '',
        phone: data.phone || data.phone_number || '',
        phone_dial: data.phone_dial || '',
        phone_national: data.phone_national || '',
        device: data.device || null
    };
}

function addressHasPoint(address) {
    if (!address) return false;
    const lat = parseFloat(address.latitude || address.lat || 0);
    const lng = parseFloat(address.longitude || address.lng || 0);
    return Boolean(lat && lng);
}

function forceTgoAddressEntry(token) {
    const modal = document.getElementById("AdresPopup");
    const liste = document.getElementById("AdresListeGorunumu");
    const form = document.getElementById("AdresFormGorunumu");
    if (!modal || !liste || !form) return;
    window.pendingTgoToken = token;
    modal.style.display = "flex";
    liste.style.display = "none";
    form.style.display = "block";
    const backBtn = document.getElementById("ListeyeDonButon");
    if (backBtn) backBtn.style.display = "none";
    const formTitle = document.querySelector('#AdresFormGorunumu .popup-title');
    if (formTitle) formTitle.innerHTML = 'TGO Token - Zorunlu Adres Ekleme';
    const kaydetBtn = document.getElementById('adresKaydetBtn');
    if (kaydetBtn) kaydetBtn.innerHTML = '<i class="fas fa-save me-2"></i>Adresi Kaydet ve Devam Et';
    const kapatBtn = document.getElementById("AdresPopupKapat");
    if (kapatBtn) kapatBtn.style.display = "none";
}

async function handleTrendyolLoginResponse(response, token, selectedAddress) {
    $('#PreloaderDialogText').html('<b>Trendyol oturumu hazirlaniyor...</b>');
    await new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: 'tgoClearLoginData' }, resolve);
    });
    const cookieResult = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: 'addCookiesFromPopup', cookies: response.data }, resolve);
    });
    if (!cookieResult || !cookieResult.success) {
        showError('Trendyol cerezi yazilamadi', (cookieResult && cookieResult.error) || '');
        return;
    }
    chrome.storage.local.set({
        tyMobileToken: response.mobile_token || '',
        tyDevice: response.device || null,
        tyPhone: { phone: response.phone, dial: response.phone_dial, national: response.phone_national }
    });
    const webCookie = (response.data || []).find((cookie) => cookie.name === 'tgo-token');
    const typedFirst = String(selectedAddress && (selectedAddress.first_name || '') || '').trim();
    const typedLast = String(selectedAddress && (selectedAddress.last_name || '') || '').trim();
    const typedNameOk = /[A-Za-zÇĞİÖŞÜçğıöşü]/.test(typedFirst) && typedFirst.length >= 2
        && /[A-Za-zÇĞİÖŞÜçğıöşü]/.test(typedLast) && typedLast.length >= 2;
    if (typedNameOk) {
        $('#PreloaderDialogText').html('<b>İsim Trendyol hesabına yazılıyor...</b>');
        const nameResult = await new Promise((resolve) => {
            chrome.runtime.sendMessage({
                action: 'tgoUpdatePersonName',
                firstName: typedFirst,
                lastName: typedLast,
                webToken: webCookie ? webCookie.value : '',
                mobileToken: response.mobile_token || ''
            }, resolve);
        });
        if (!nameResult || !nameResult.updated) {
            console.warn('Trendyol isim guncellenemedi', nameResult && nameResult.error);
        }
    }
    if (addressHasPoint(selectedAddress) && webCookie) {
        const accountPhone = {
            phone: response.phone || '',
            dial: response.phone_dial || '',
            national: response.phone_national || ''
        };
        $('#PreloaderDialogText').html('<b>Trendyol adresi hazirlaniyor...</b>');
        await new Promise((resolve) => {
            chrome.runtime.sendMessage({
                action: 'tgoSetupCouponRules',
                accessToken: webCookie.value
            }, resolve);
        });
        await new Promise((resolve) => {
            chrome.storage.local.set({
                tgoPendingAddress: {
                    address: selectedAddress,
                    webToken: webCookie.value,
                    accountPhone: accountPhone,
                    createdAt: Date.now()
                }
            }, resolve);
        });
    }
    HBY_SessionData = {
        isLogged: true,
        cookies: response.data,
        expiry: Math.floor(Date.now() / 1000) + (45 * 60),
        token: token,
        isCookieInserted: true,
        platform: 'trendyol'
    };
    await new Promise((resolve) => {
        chrome.storage.sync.set({ yemekhub_session: HBY_SessionData }, () => {
            if (chrome.runtime.lastError) {
                const slim = Object.assign({}, HBY_SessionData, { cookies: [] });
                chrome.storage.sync.set({ yemekhub_session: slim }, resolve);
                return;
            }
            resolve();
        });
    });
    $('#SuccessDialogText').html('Trendyol hesabi hazir.<br><small>tgoyemek.com aciliyor...</small>');
    showDialog('SuccessDialog');
    setTimeout(() => { window.location.href = 'https://tgoyemek.com/'; }, 800);
}

async function performActualLogin() {
    console.log('🔐 Normal giriş işlemi başlatılıyor...');
    
    const rawLoginToken = ($('#TokenGirisForm [name="token"]').val() || '').trim();
    const token = String(rawLoginToken).toUpperCase().startsWith('TGO-')
        ? rawLoginToken
        : normalizeKmMigrosToken(rawLoginToken);
    if (token) {
        $('#TokenGirisForm [name="token"]').val(token);
    }

    // ====================================
    // MIGROS: Token mg-/mgy-/mgm- ile basliyorsa Migros girisi yap
    // ====================================
    if (isKmMigrosToken(token)) {
        startMigrosLoginFromPopup(token);
        return;
    }

    // ====================================
    // UBER: Token uber- ile başlıyorsa Uber girişi yap
    // ====================================
    if (token && token.startsWith('uber-')) {
        console.log('🚗 Uber token tespit edildi, Uber giriş akışı başlatılıyor...');
        showDialog('PreloaderDialog');
        $('#PreloaderDialogText').text('Uber oturumu açılıyor...');

        chrome.runtime.sendMessage({
            action: 'startUberTokenProcess',
            token: token,
        }, function(response) {
            if (chrome.runtime.lastError) {
                showDialog('ErrorDialog');
                $('#ErrorDialogText').text('Uber giriş hatası: ' + chrome.runtime.lastError.message);
                return;
            }
            if (response && response.success) {
                showDialog('SuccessDialog');
                $('#SuccessDialogTitle').text('UBER GİRİŞ BAŞARILI');
                $('#SuccessDialogText').text('Uber hesabına giriş yapıldı, yönlendiriliyorsunuz...');
            } else {
                showDialog('ErrorDialog');
                $('#ErrorDialogTitle').text('UBER HATASI');
                $('#ErrorDialogText').text(formatUberLoginError(response));
            }
        });
        return;
    }

    // 🔄 Otomatik adres ekleme toggle durumunu kontrol et
    const autoAddressEnabled = isAutoAddressEnabled();
    console.log('🔄 Otomatik adres ekleme durumu:', autoAddressEnabled ? 'Açık' : 'Kapalı');
    
    // 🎯 MRB TOKEN KONTROLÜ - Adres zorunluluğu + Campaigns sayfası yönlendirmesi
    const isMrbToken = token && token.startsWith('MRB-');
    console.log('🔍 MRB Token analizi:', { token: token, isMrbToken: isMrbToken });
    
    if (isMrbToken && autoAddressEnabled) {
        console.log('🎯 MRB token tespit edildi! Adres kontrolü yapılıyor...');
        
        // Önce adres seçimi kontrol et
        const selectedAddressId = $('#addressSelect').val();
        const isAddressOptional = !selectedAddressId || selectedAddressId === "";
        
        console.log('📋 MRB Token - Adres seçimi durumu:', { selectedAddressId: selectedAddressId, isOptional: isAddressOptional });
        
        if (isAddressOptional) {
            console.log('🚫 MRB Token - Adres seçimi opsiyonel! Adres kontrol ediliyor...');
            
            // Mevcut adresleri kontrol et
            chrome.storage.local.get('addresses', (result) => {
                const addresses = result.addresses || [];
                console.log('📍 MRB Token - Opsiyonel durum, mevcut adresler:', addresses.length, 'adet');
                
                if (addresses.length === 0) {
                    console.log('⚠️ MRB token - Hiç adres yok! Uyarı verip yeni adres ekleme başlatılıyor...');
                    alert('🎯 MRB Token kullanıyorsunuz!\n\nHiç kayıtlı adresiniz yok.\nAdres ekleme ekranına yönlendiriliyorsunuz...');
                    forceMrbAddressEntry(token);
                } else {
                    console.log('🚫 MRB token - Adresler var ama seçilmemiş! Uyarı verip yeni adres ekleme açılıyor...');
                    alert('🎯 MRB Token kullanıyorsunuz!\n\n❌ Adres seçimi zorunludur!\n\nMevcut adreslerinizden birini seçebilir veya yeni adres ekleyebilirsiniz.\nAdres ekleme ekranına yönlendiriliyorsunuz...');
                    forceMrbAddressEntry(token);
                }
            });
            return; // Giriş işlemini iptal et
        }
        
        console.log('✅ MRB token - Adres seçili, normal giriş akışına devam...');
    } else if (isMrbToken && !autoAddressEnabled) {
        console.log('🔄 MRB token - Otomatik adres ekleme kapalı, adres kontrolü atlanıyor...');
    }
    
    // 🎯 MRD TOKEN KONTROLÜ - Sadece adres zorunluluğu
    const isMrdToken = token && token.startsWith('MRD-');
    console.log('🔍 MRD Token analizi:', { token: token, isMrdToken: isMrdToken });
    
    if (isMrdToken && autoAddressEnabled) {
        console.log('🎯 MRD token tespit edildi! Adres kontrolü yapılıyor...');
        
        // Önce adres seçimi kontrol et
        const selectedAddressId = $('#addressSelect').val();
        const isAddressOptional = !selectedAddressId || selectedAddressId === "";
        
        console.log('📋 MRD Token - Adres seçimi durumu:', { selectedAddressId: selectedAddressId, isOptional: isAddressOptional });
        
        if (isAddressOptional) {
            console.log('🚫 MRD Token - Adres seçimi opsiyonel! Adres kontrol ediliyor...');
            
            // Mevcut adresleri kontrol et
            chrome.storage.local.get('addresses', (result) => {
                const addresses = result.addresses || [];
                console.log('📍 MRD Token - Opsiyonel durum, mevcut adresler:', addresses.length, 'adet');
                
                if (addresses.length === 0) {
                    console.log('⚠️ MRD token - Hiç adres yok! Uyarı verip yeni adres ekleme başlatılıyor...');
                    alert('🎯 MRD Token kullanıyorsunuz!\n\nHiç kayıtlı adresiniz yok.\nAdres ekleme ekranına yönlendiriliyorsunuz...');
                    forceMrdAddressEntry(token);
                } else {
                    console.log('🚫 MRD token - Adresler var ama seçilmemiş! Uyarı verip yeni adres ekleme açılıyor...');
                    alert('🎯 MRD Token kullanıyorsunuz!\n\n❌ Adres seçimi zorunludur!\n\nMevcut adreslerinizden birini seçebilir veya yeni adres ekleyebilirsiniz.\nAdres ekleme ekranına yönlendiriliyorsunuz...');
                    forceMrdAddressEntry(token);
                }
            });
            return; // Giriş işlemini iptal et
        }
        
        console.log('✅ MRD token - Adres seçili, normal giriş akışına devam...');
    } else if (isMrdToken && !autoAddressEnabled) {
        console.log('🔄 MRD token - Otomatik adres ekleme kapalı, adres kontrolü atlanıyor...');
    }
    
    // 🎯 MRKT TOKEN KONTROLÜ - IP Kontrolü + Adres Zorunluluğu
    const isMrktToken = token && token.startsWith('MRKT-');
    console.log('🔍 MRKT Token analizi:', { token: token, isMrktToken: isMrktToken });
    
    if (isMrktToken && autoAddressEnabled) {
        console.log('🎯 MRKT token tespit edildi! IP ve adres kontrolü yapılıyor...');
        
        // 1. Adres kontrolü (MRD- ile aynı)
        const selectedAddressId = $('#addressSelect').val();
        const isAddressOptional = !selectedAddressId || selectedAddressId === "";
        
        console.log('📋 MRKT Token - Adres seçimi durumu:', { selectedAddressId: selectedAddressId, isOptional: isAddressOptional });
        
        if (isAddressOptional) {
            console.log('🚫 MRKT Token - Adres seçimi opsiyonel! Adres kontrol ediliyor...');
            
            // Mevcut adresleri kontrol et
            chrome.storage.local.get('addresses', (result) => {
                const addresses = result.addresses || [];
                console.log('📍 MRKT Token - Opsiyonel durum, mevcut adresler:', addresses.length, 'adet');
                
                if (addresses.length === 0) {
                    console.log('⚠️ MRKT token - Hiç adres yok! Uyarı verip yeni adres ekleme başlatılıyor...');
                    alert('🎯 MRKT Token kullanıyorsunuz!\n\nHiç kayıtlı adresiniz yok.\nAdres ekleme ekranına yönlendiriliyorsunuz...');
                    forceMrktAddressEntry(token);
                } else {
                    console.log('🚫 MRKT token - Adresler var ama seçilmemiş! Uyarı verip yeni adres ekleme açılıyor...');
                    alert('🎯 MRKT Token kullanıyorsunuz!\n\n❌ Adres seçimi zorunludur!\n\nMevcut adreslerinizden birini seçebilir veya yeni adres ekleyebilirsiniz.\nAdres ekleme ekranına yönlendiriliyorsunuz...');
                    forceMrktAddressEntry(token);
                }
            });
            return; // Giriş işlemini iptal et
        }
        
        // 2. IP Kontrolü
        console.log('🌐 MRKT Token - IP kontrolü yapılıyor...');
        
        const ipCheck = await checkMRKTTokenIP(token);
        
        if (!ipCheck.allowed) {
            console.error('🚫 MRKT Token - Aynı IP ile giriş engellendi!');
            
            // MRKT IP Block Modal'ı göster
            showMRKTIPBlockModal(ipCheck.savedIP, ipCheck.currentIP);
            
            return; // Giriş işlemini iptal et
        }
        
        console.log('✅ MRKT token - IP kontrolü geçti:', ipCheck.reason);
        if (ipCheck.reason === 'İlk giriş') {
            console.log('🆕 İlk giriş - IP kaydedildi:', ipCheck.savedIP);
        } else if (ipCheck.reason === 'Farklı IP') {
            console.log('🔄 IP değişti:', ipCheck.oldIP, '→', ipCheck.newIP);
        }
        
        console.log('✅ MRKT token - Tüm kontroller geçildi, normal giriş akışına devam...');
    } else if (isMrktToken && !autoAddressEnabled) {
        console.log('🔄 MRKT token - Otomatik adres ekleme kapalı, adres kontrolü atlanıyor...');
        // IP kontrolü yine de yapılır
        const ipCheck = await checkMRKTTokenIP(token);
        
        if (!ipCheck.allowed) {
            console.error('🚫 MRKT Token - Aynı IP ile giriş engellendi!');
            showMRKTIPBlockModal(ipCheck.savedIP, ipCheck.currentIP);
            return;
        }
        console.log('✅ MRKT token - IP kontrolü geçti (adres kontrolü kapalı):', ipCheck.reason);
    }

    const isTgoToken = String(token || '').toUpperCase().startsWith('TGO-');
    if (isTgoToken && !autoAddressEnabled) {
        alert('TGO hesabıyla giriş için Otomatik Adres Ekleme açık olmalıdır.');
        return;
    }
    if (isTgoToken && autoAddressEnabled && !window.pendingTgoAddress) {
        const tgoSelectedAddressId = $('#addressSelect').val();
        if (!tgoSelectedAddressId) {
            chrome.storage.local.get('addresses', (result) => {
                const addresses = result.addresses || [];
                if (addresses.length === 0) {
                    alert('TGO token kullanıyorsunuz.\n\nKayıtlı adresiniz yok.\nAdres ekleme ekranına yönlendiriliyorsunuz.');
                } else {
                    alert('TGO token kullanıyorsunuz.\n\nAdres seçimi zorunludur.\nMevcut adreslerinizden birini seçebilir veya yeni adres ekleyebilirsiniz.');
                }
                forceTgoAddressEntry(token);
            });
            return;
        }
    }

    if (isKmCouponIpToken(token)) {
        const ipCheck = await checkKmCouponIpLimit(token);
        if (!ipCheck.allowed) {
            showKmCouponIpBlockModal(ipCheck.savedIP, ipCheck.currentIP);
            return;
        }
    }
    
    // Seçili adres ID'sini al
    const selectedAddressId = $('#addressSelect').val();
    
    // Select'ten bir adres seçilmiş mi kontrol et (boş değil ve "Adres seçin" değil)
    const autoAddAddress = selectedAddressId && selectedAddressId !== "";
    
    // Tercihleri kaydet
    saveUserPreferences();
    
    // Önce adresleri kontrol et
    chrome.storage.local.get('addresses', async (result) => {
        const addresses = result.addresses || [];
        let selectedAddress = null;

        if (window.pendingTgoAddress) {
            selectedAddress = window.pendingTgoAddress;
            window.pendingTgoAddress = null;
        } else if (autoAddAddress || (String(token || '').toUpperCase().startsWith('TGO-') && selectedAddressId)) {
            // Seçili adresi bul
            selectedAddress = addresses.find(a => (a.place_id || a.form_id) === selectedAddressId);
            
            // Eğer seçili adres bulunduysa ve ilk sırada değilse, ilk sıraya taşı
            if (selectedAddress) {
                const currentIndex = addresses.findIndex(a => (a.place_id || a.form_id) === selectedAddressId);
                if (currentIndex > 0) {
                    // Adresi listeden çıkar ve başa ekle
                    addresses.splice(currentIndex, 1);
                    addresses.unshift(selectedAddress);
                    
                    // Güncellenmiş listeyi kaydet
                    chrome.storage.local.set({ addresses: addresses }, () => {
                        console.log('Seçili adres başa taşındı');
                    });
                }
            }
            
            console.log('Otomatik eklenecek adres:', selectedAddress);
        }

        if (autoAddressEnabled && String(token || '').toUpperCase().startsWith('TGO-') && !addressHasPoint(selectedAddress)) {
            alert('TGO girişi için koordinatı olan bir adres gerekli.');
            forceTgoAddressEntry(token);
            return;
        }

        if (!String(token || '').toUpperCase().startsWith('TGO-') && isOrionIosDevice()) {
            alert('iOS Orion tarayıcısında Yemeksepeti hesabı ile giriş kapalıdır.\n\nBu girişi Android veya Windows üzerinden yapın.');
            return;
        }

        if (String(token || '').toUpperCase().startsWith('TGO-')) {
            setLoginPreloaderMessage('<b>Hesap bilgileri sorgulanıyor.<br>Lütfen bekleyin...</b>');
            $('#FormDialog').fadeOut(350, () => $('#PreloaderDialog').fadeIn(350));
            try {
                const tgoResponse = await fetchKmTgoLoginData(token);
                await handleTrendyolLoginResponse(tgoResponse, token, selectedAddress);
            } catch (tgoErr) {
                const msg = (tgoErr && tgoErr.message) ? tgoErr.message : String(tgoErr);
                if (msg === '__km_ip_change__') return;
                showError('TrendyolGo giriş hatası', msg);
            }
            return;
        }
        
        // ===== 1. AŞAMA: HESAP BİLGİLERİ SORGULA =====
        setLoginPreloaderMessage('<b>Hesabınız doğrulanıyor...</b><br><small>Lütfen bekleyin</small>');
        $('#FormDialog').fadeOut(350, () => $('#PreloaderDialog').fadeIn(350));

        let loginApiUrl, loginApiHeaders;
        let __kmSig = '';
        try { __kmSig = await getIntegritySig(); } catch (e) {}
        loginApiUrl = `${KUPONMARKET_YS_LOGIN_API}?token=${encodeURIComponent(token)}&force=1`;
        if (__kmSig) { loginApiUrl += '&integrity=' + encodeURIComponent(__kmSig); }
        loginApiHeaders = {
            'Accept': 'application/json',
            'X-Version': chrome.runtime.getManifest().version,
            'X-Requested': 'KuponMarketYS'
        };
        console.log('🔄 Cookie kaynağı: kuponmarket.net', token);
        console.log('📡 login-data isteği (background):', loginApiUrl.split('&integrity=')[0]);

        const loginTransport = await new Promise((resolve) => {
            chrome.runtime.sendMessage({
                action: 'fetchYemeksepetiLoginData',
                url: loginApiUrl,
                headers: loginApiHeaders
            }, (bg) => {
                if (chrome.runtime.lastError) {
                    resolve({ ok: false, status: 0, error: chrome.runtime.lastError.message, data: null });
                    return;
                }
                resolve(bg || { ok: false, status: 0, error: 'Background yanıt vermedi', data: null });
            });
        });

        if (!loginTransport.ok && !loginTransport.data) {
            if (isBareHttp403Transport(loginTransport)) {
                showIpChangePopup();
                return;
            }
            const errUi = formatYsLoginUserError(null, loginTransport);
            showError(errUi.title, errUi.detail);
            return;
        }

        const response = loginTransport.data;
        const xhr = { status: loginTransport.status || 0 };
        console.log('📥 login-data yanıt:', xhr.status, response?.status, response?.error || '', response?.refresh_meta || '');

        (async function handleLoginDataResponse() {
                // Null kontrolü ekle
                if (!response) {
                    showError('Sunucudan boş yanıt alındı.', 'Lütfen daha sonra tekrar deneyin.');
                    return;
                }

                // ===== KUPON ENGELLEME KURALLARI (kuponmarket'in KENDİ login-data yanıtından) =====
                // Sunucu (login-data controller) token tag'ine göre çözülmüş codes/keywords döner.
                // content_script bunu MAIN world'e köprüler; inject.js cart/calculate+checkout'ta uygular.
                try {
                    if (response.hidden_vouchers) {
                        chrome.storage.local.set({
                            active_token_tag: response.hidden_vouchers.tag || '',
                            active_hidden_voucher_codes: Array.isArray(response.hidden_vouchers.codes) ? response.hidden_vouchers.codes : [],
                            active_hidden_voucher_keywords: Array.isArray(response.hidden_vouchers.keywords) ? response.hidden_vouchers.keywords : [],
                            active_hidden_voucher_allow_keywords: Array.isArray(response.hidden_vouchers.allow_keywords) ? response.hidden_vouchers.allow_keywords : [],
                            hidden_vouchers_updated_at: Date.now()
                        });
                        console.log('🎟️ Engellenecek kupon kuralları (login-data):', response.hidden_vouchers);
                    }
                } catch (e) {}

                const normalizedCookies = normalizeKmLoginResponse(response);

                // Yalnizca hosting → 9002 refresh basarili (status=true) ise giris
                if (response && response.status === true && normalizedCookies.length > 0) {
                    
                    // ===== 2. AŞAMA: ÖN TEMİZLEME İŞLEMİ =====
                    setLoginPreloaderMessage('<b>Oturum hazırlanıyor...</b><br><small>Lütfen bekleyin</small>');
                    
                    console.log('🛡️ Ön temizleme başlatılıyor...');
                    const cleanupSuccess = await performPreCleanup();
                    
                    if (cleanupSuccess) {
                        console.log('✅ Ön temizleme başarılı');
                    } else {
                        console.warn('⚠️ Ön temizleme başarısız, devam ediliyor');
                    }
                    
                    // ===== 3. AŞAMA: TEMİZLİK DOĞRULAMA =====
                    // ⚡ AKILLI BEKLEME: Temizliğin gerçekten bittiğini doğrula
                    console.log('⏳ Temizlik doğrulanıyor...');
                    
                    // Yemeksepeti cookie'lerinin temizlendiğini doğrula (max 500ms bekle)
                    let cleanupVerified = false;
                    for (let i = 0; i < 5; i++) {
                        const testCookie = await new Promise(resolve => {
                            chrome.cookies.get({ url: 'https://www.yemeksepeti.com', name: 'access_token' }, resolve);
                        });
                        
                        if (!testCookie) {
                            cleanupVerified = true;
                            console.log(`✅ Temizlik doğrulandı (${(i+1)*100}ms)`);
                            break;
                        }
                        await new Promise(resolve => setTimeout(resolve, 100));
                    }
                    
                    if (!cleanupVerified) {
                        console.warn('⚠️ Temizlik doğrulanamadı, devam ediliyor...');
                    }
                    
                    // ===== 4. AŞAMA: COOKIE EKLEME (BACKGROUND.JS'TE - GÜVENİLİR) =====
                    setLoginPreloaderMessage('<b>Giriş bilgileri yükleniyor...</b><br><small>Lütfen bekleyin</small>');
                    
                    console.log('🍪 Cookie ekleme işlemi background.js\'te başlatılıyor...');
                    
                    let cookieSuccess = false;
                    let cookieResult = null;
                    
                    try {
                        console.log('📤 Background.js\'e cookie ekleme isteği gönderiliyor...', normalizedCookies.length, 'adet cookie');
                        
                        // Background.js'e cookie ekleme isteği gönder (daha güvenilir)
                        cookieResult = await new Promise((resolve) => {
                            chrome.runtime.sendMessage({
                                action: 'addCookiesFromPopup',
                                cookies: normalizedCookies
                            }, (result) => {
                                if (chrome.runtime.lastError) {
                                    console.error('❌ Background.js ile iletişim hatası:', chrome.runtime.lastError);
                                    resolve({ success: false, error: chrome.runtime.lastError.message, successCount: 0, total: normalizedCookies.length });
                                } else {
                                    console.log('📥 Background.js\'ten yanıt alındı:', result);
                                    // ⚠️ NULL CHECK: result null ise fallback değer
                                    resolve(result || { 
                                        success: false, 
                                        error: 'Background.js yanıt vermedi', 
                                        successCount: 0, 
                                        failCount: normalizedCookies.length,
                                        total: normalizedCookies.length 
                                    });
                                }
                            });
                        });
                        
                        // ⚠️ NULL CHECK: cookieResult null olabilir
                        if (!cookieResult) {
                            console.error('❌ Cookie ekleme sonucu null! Background.js yanıt vermedi.');
                            cookieSuccess = false;
                        } else {
                            cookieSuccess = cookieResult.success;
                        }
                        
                        if (cookieSuccess && cookieResult) {
                            console.log('✅ Cookie ekleme background.js\'te başarılı:', (cookieResult.successCount || 0) + '/' + (cookieResult.total || 0));
                        } else {
                            console.error('❌ Cookie ekleme background.js\'te başarısız!');
                            if (cookieResult) {
                                console.error('❌ Detay:', {
                                    error: cookieResult.error || 'Bilinmeyen hata',
                                    successCount: cookieResult.successCount || 0,
                                    failCount: cookieResult.failCount || 0,
                                    total: cookieResult.total || 0
                                });
                            } else {
                                console.error('❌ cookieResult null - Background.js yanıt vermedi veya çöktü');
                            }
                        }
                    } catch (cookieError) {
                        console.error('🍪 Cookie ekleme sırasında exception:', cookieError);
                        console.error('🍪 Exception detayları:', {
                            message: cookieError.message,
                            stack: cookieError.stack
                        });
                        cookieSuccess = false;
                    }
                    
                    // ===== 5. AŞAMA: COOKIE DOĞRULAMA (CHROME 131+ İÇİN ÖNEMLİ) =====
                    setLoginPreloaderMessage('<b>Oturum kontrol ediliyor...</b><br><small>Lütfen bekleyin</small>');
                    
                    // ⚡ AKILLI BEKLEME: Cookie'lerin yazıldığını doğrula (max 1000ms)
                    let cookieVerifyAttempts = 0;
                    const maxCookieAttempts = 10;
                    
                    while (cookieVerifyAttempts < maxCookieAttempts) {
                        const accessToken = await new Promise(resolve => {
                            chrome.cookies.get({ url: 'https://www.yemeksepeti.com', name: 'access_token' }, resolve);
                        });
                        
                        if (accessToken && accessToken.value) {
                            console.log(`✅ Cookie doğrulandı (${(cookieVerifyAttempts+1)*100}ms)`);
                            break;
                        }
                        
                        cookieVerifyAttempts++;
                        await new Promise(resolve => setTimeout(resolve, 100));
                    }
                    
                    if (cookieVerifyAttempts >= maxCookieAttempts) {
                        console.warn('⚠️ Cookie doğrulama zaman aşımı, devam ediliyor...');
                    }
                    
                    // ⚡ CHROME 131+ COOKIE DOĞRULAMA
                    try {
                        const criticalCookies = ['access_token', 'refresh_token', 'device_token', 'token'];
                        let verifiedCount = 0;
                        
                        for (const cookieName of criticalCookies) {
                            try {
                                const cookie = await new Promise((resolve) => {
                                    chrome.cookies.get({
                                        url: 'https://www.yemeksepeti.com',
                                        name: cookieName
                                    }, resolve);
                                });
                                
                                if (cookie && cookie.value) {
                                    console.log(`✅ Cookie doğrulandı: ${cookieName}`);
                                    verifiedCount++;
                                } else {
                                    console.warn(`⚠️ Cookie bulunamadı: ${cookieName}`);
                                }
                            } catch (err) {
                                console.warn(`⚠️ Cookie kontrol hatası: ${cookieName}`, err);
                            }
                        }
                        
                        console.log(`📊 Cookie doğrulama: ${verifiedCount}/${criticalCookies.length} başarılı`);
                        
                        // Eğer hiçbir cookie doğrulanamadıysa, işlemi durdur
                        if (verifiedCount === 0) {
                            console.error('❌ HİÇBİR CRİTİCAL COOKIE DOĞRULANAMADI!');
                            console.error('❌ Cookie ekleme sonucu:', cookieResult);
                            console.error('⚠️ SORUN GİDERME:');
                            console.error('1. Eklentiyi tamamen kaldırıp yeniden yükleyin');
                            console.error('2. Chrome\'u yeniden başlatın');
                            console.error('3. Yemeksepeti.com\'u hiç açmadan token ile giriş yapın');
                            console.error('4. Console\'da "[CookieManager]" log\'larına bakın');
                            
                            $('#PreloaderDialog').fadeOut(350);
                            $('#ErrorDialogText').html(
                                '<b>Cookie Ekleme Başarısız</b><br>' +
                                'Oturum bilgileri yüklenemedi.<br><br>' +
                                '<small style="color: #ff6b6b;">Detaylar için Console\'a (F12) bakın.</small><br><br>' +
                                '<b>Çözüm Adımları:</b><br>' +
                                '<small>1. Eklentiyi kaldırıp yeniden yükleyin<br>' +
                                '2. Chrome\'u yeniden başlatın<br>' +
                                '3. Tekrar deneyin</small>'
                            );
                            $('#ErrorDialog').fadeIn(350);
                            return; // İşlemi durdur, yönlendirme yapma
                        } else if (verifiedCount < criticalCookies.length) {
                            console.warn(`⚠️ Bazı cookie'ler eksik (${verifiedCount}/${criticalCookies.length}), ama yeterli sayıda var, devam ediliyor`);
                            cookieSuccess = true; // En az 1 cookie varsa devam et
                        } else {
                            console.log('✅ Tüm critical cookie\'ler doğrulandı!');
                            cookieSuccess = true;
                        }
                    } catch (verifyError) {
                        console.error('❌ Cookie doğrulama hatası:', verifyError);
                    }

                    // ===== 5b: Oturum senkronu (tarayici <-> sunucu) =====
                    setLoginPreloaderMessage('<b>Bekletiliyor...</b><br><small>Oturum doğrulanıyor</small>');
                    try {
                        const syncIntegrity = __kmSig || await getIntegritySig();
                        const sessionSyncResult = await new Promise((resolve) => {
                            chrome.runtime.sendMessage({
                                action: 'syncYsSessionToServer',
                                token: token,
                                integrity: syncIntegrity,
                                waitForYs: true,
                                waitForYsMs: 9000
                            }, (r) => {
                                if (chrome.runtime.lastError) {
                                    resolve({ ok: false, error: chrome.runtime.lastError.message });
                                    return;
                                }
                                resolve(r || { ok: false, error: 'session-sync yanit yok' });
                            });
                        });
                        console.log('🔄 session-sync:', sessionSyncResult);
                        if (sessionSyncResult && sessionSyncResult.ok && sessionSyncResult.updated) {
                            console.log('✅ DB refresh guncellendi:', sessionSyncResult.fields);
                        }
                        chrome.runtime.sendMessage({
                            action: 'scheduleYsSessionSync',
                            token: token,
                            integrity: syncIntegrity,
                            source: 'popup-post-login',
                            delayMs: 6000
                        });
                    } catch (syncErr) {
                        console.warn('⚠️ session-sync atlandi:', syncErr);
                    }
                    
                    // ===== 6. AŞAMA: SESSION DATA HAZIRLA =====
                    const currentTime = Math.floor(Date.now() / 1000);
                    HBY_SessionData = {
                        isLogged: true,
                        cookies: normalizedCookies,
                        expiry: currentTime + (45 * 60), // 45 dakika
                        token: token,
                        isCookieInserted: cookieSuccess, // Cookie popup'ta başarılı olduysa true
                        autoAddAddress: selectedAddress ? true : false,
                        selectedAddress: selectedAddress, // Seçili adresi de kaydet
                        selectedAddressId: selectedAddressId, // ID'yi de kaydet (content_script için)
                        addressAddSessionId: Date.now().toString() // Her yeni giriş için unique session ID
                    };

                    // ===== SİPARİŞ GİZLEME: token giriş tarihini (cutoff) not al =====
                    // Bu token için İLK giriş anı kaydedilir. Bu tarihten SONRAKİ siparişler
                    // (kullanıcının kendi siparişleri) gizlenmez; öncekiler gizlenip fake eklenir.
                    try {
                        chrome.storage.local.get(['ys_orders_cutoff'], function (prev) {
                            var p = prev && prev.ys_orders_cutoff;
                            if (!p || p.token !== token) {
                                chrome.storage.local.set({ ys_orders_cutoff: { token: token, ts: Date.now() } });
                            }
                        });
                    } catch (e) {}

                    // ===== 7. AŞAMA: SESSION'I KAYDET =====
                    chrome.storage.sync.set({ 'yemekhub_session': HBY_SessionData }, function () {
                        
                        // ===== 8. AŞAMA: DYNAMIC HEADERS'I GÜNCELLE =====
                        setLoginPreloaderMessage('<b>Son kontroller yapılıyor...</b><br><small>Lütfen bekleyin</small>');
                        
                        chrome.runtime.sendMessage({
                            action: 'runDynamicHeaders'
                        }, function (response) {
                            console.log('Dinamik headerlar güncellendi:', response);
                            
                            // ===== 9. AŞAMA: BAŞARI MESAJI VE YÖNLENDİRME =====
                            $('#SuccessDialogText').html(
                                'Hesap başarıyla hazırlandı!<br>' +
                                '<b>✅ Sistem temizlendi</b><br>' +
                                '<b>✅ Oturum bilgileri yüklendi</b><br>' +
                                '<b>✅ Cookie\'ler hazır</b><br>' +
                                (selectedAddress ? '<b>📍 Adres otomatik eklenecek</b><br>' : '') +
                                '<small>Yemeksepeti\'ne yönlendiriliyorsunuz...</small><br><br>' +
                                '<button id="manualRedirectBtn" class="btn btn-success mt-3" style="display: none;">' +
                                '<i class="fas fa-external-link-alt me-2"></i>Yemeksepeti\'ne Git' +
                                '</button>'
                            );

                            $('#PreloaderDialog').fadeOut(350, () => $('#SuccessDialog').fadeIn(350));

                            // Manuel yönlendirme butonunu 5 saniye sonra göster
                            let redirectTimeout = setTimeout(() => {
                                console.log('🚀 TÜM HAZIRLIK İŞLEMLERİ TAMAMLANDI');
                                console.log('✅ Cookie\'ler HAZIR ve DOĞRULANDI');
                                console.log('✅ Yemeksepeti.com açıldığında cookie\'ler ZATEN MEVCUT olacak');
                                console.log('🎯 Akıllı yönlendirme başlatılıyor...');
                                performSmartRedirect(token, selectedAddress);
                            }, 1200);

                            // 3 saniye sonra manuel yönlendirme butonunu göster
                            setTimeout(() => {
                                const manualBtn = document.getElementById('manualRedirectBtn');
                                if (manualBtn) {
                                    manualBtn.style.display = 'inline-block';
                                    manualBtn.onclick = function() {
                                        clearTimeout(redirectTimeout); // Otomatik yönlendirmeyi iptal et
                                        console.log('👆 Kullanıcı manuel yönlendirme butonunu tıkladı');
                                        performSmartRedirect(token, selectedAddress);
                                    };
                                }
                            }, 3000);
                            
                            // ===== 10. AŞAMA: YEMEKSEPETİ.COM'A YÖNLENDİR =====
                            // Artık TÜM İŞLEMLER TAMAMLANDI - güvenle yönlendirebiliriz
                            setTimeout(() => {
                                console.log('🚀 TÜM HAZIRLIK İŞLEMLERİ TAMAMLANDI - AKILLI YÖNLENDİRME BAŞLATIILIYOR');
                                console.log(`📊 Cookie durumu: ${cookieSuccess ? 'Başarılı' : 'Content script\'te denenecek'}`);
                                performSmartRedirect(token, selectedAddress);
                            }, 1200);
                        });
                    });
                    
                } else {
                    const errUi = formatYsLoginUserError(response, loginTransport);
                    showError(errUi.title, errUi.detail);
                }
        })().catch((err) => {
            console.error('❌ login-data işleme hatası:', err);
            showError('Beklenmeyen bir hata oluştu', 'Lütfen tekrar deneyin.');
        });
    });
}

// 🚨 MRB Token için zorunlu adres ekleme (Campaigns sayfası yönlendirmesi için)
function forceMrbAddressEntry(token) {
    console.log('🚨 MRB Token - Zorunlu adres ekleme penceresi açılıyor...');
    
    // Adres ekleme modalını aç
    const modal = document.getElementById("AdresPopup");
    const liste = document.getElementById("AdresListeGorunumu");
    const form = document.getElementById("AdresFormGorunumu");
    
    if (modal && liste && form) {
        // MRB token'ı global olarak sakla (adres eklendikten sonra normal giriş için)
        window.pendingMrbToken = token;
        
        modal.style.display = "flex";
        liste.style.display = "none";
        form.style.display = "block";
        document.getElementById("ListeyeDonButon").style.display = "none";
        
        // Form başlığını güncelle
        const formTitle = document.querySelector('#AdresFormGorunumu .popup-title');
        if (formTitle) {
            formTitle.innerHTML = '🎯 MRB Token - Zorunlu Adres Ekleme';
        }
        
        // Kaydet buton metnini güncelle
        const kaydetBtn = document.getElementById('adresKaydetBtn');
        if (kaydetBtn) {
            kaydetBtn.innerHTML = '<i class="fas fa-save me-2"></i>Adresi Kaydet ve Devam Et';
        }
        
        // Kapama butonunu gizle (zorunlu olduğu için)
        const kapatBtn = document.getElementById("AdresPopupKapat");
        if (kapatBtn) {
            kapatBtn.style.display = "none";
        }
        
        console.log('📝 MRB Adres ekleme formu açıldı - Normal giriş için token bekliyor:', token);
    }
}

// 🚨 MRD Token için zorunlu adres ekleme
function forceMrdAddressEntry(token) {
    console.log('🚨 MRD Token - Zorunlu adres ekleme penceresi açılıyor...');
    
    // Adres ekleme modalını aç
    const modal = document.getElementById("AdresPopup");
    const liste = document.getElementById("AdresListeGorunumu");
    const form = document.getElementById("AdresFormGorunumu");
    
    if (modal && liste && form) {
        // MRD token'ı global olarak sakla (adres eklendikten sonra normal giriş için)
        window.pendingMrdToken = token;
        
        modal.style.display = "flex";
        liste.style.display = "none";
        form.style.display = "block";
        document.getElementById("ListeyeDonButon").style.display = "none";
        
        // Form başlığını güncelle
        const formTitle = document.querySelector('#AdresFormGorunumu .popup-title');
        if (formTitle) {
            formTitle.innerHTML = '🎯 MRD Token - Zorunlu Adres Ekleme';
        }
        
        // Kaydet buton metnini güncelle
        const kaydetBtn = document.getElementById('adresKaydetBtn');
        if (kaydetBtn) {
            kaydetBtn.innerHTML = '<i class="fas fa-save me-2"></i>Adresi Kaydet ve Devam Et';
        }
        
        // Kapama butonunu gizle (zorunlu olduğu için)
        const kapatBtn = document.getElementById("AdresPopupKapat");
        if (kapatBtn) {
            kapatBtn.style.display = "none";
        }
        
        console.log('📝 MRD Adres ekleme formu açıldı - Normal giriş için token bekliyor:', token);
    }
}

// 🚨 MRKT Token için zorunlu adres ekleme
function forceMrktAddressEntry(token) {
    console.log('🚨 MRKT Token - Zorunlu adres ekleme penceresi açılıyor...');
    
    // Adres ekleme modalını aç
    const modal = document.getElementById("AdresPopup");
    const liste = document.getElementById("AdresListeGorunumu");
    const form = document.getElementById("AdresFormGorunumu");
    
    if (modal && liste && form) {
        // MRKT token'ı global olarak sakla (adres eklendikten sonra normal giriş için)
        window.pendingMrktToken = token;
        
        modal.style.display = "flex";
        liste.style.display = "none";
        form.style.display = "block";
        document.getElementById("ListeyeDonButon").style.display = "none";
        
        // Form başlığını güncelle
        const formTitle = document.querySelector('#AdresFormGorunumu .popup-title');
        if (formTitle) {
            formTitle.innerHTML = '🎯 MRKT Token - Zorunlu Adres Ekleme';
        }
        
        // Kaydet buton metnini güncelle
        const kaydetBtn = document.getElementById('adresKaydetBtn');
        if (kaydetBtn) {
            kaydetBtn.innerHTML = '<i class="fas fa-save me-2"></i>Adresi Kaydet ve Devam Et';
        }
        
        // Kapama butonunu gizle (zorunlu olduğu için)
        const kapatBtn = document.getElementById("AdresPopupKapat");
        if (kapatBtn) {
            kapatBtn.style.display = "none";
        }
        
        console.log('📝 MRKT Adres ekleme formu açıldı - Normal giriş için token bekliyor:', token);
    }
}

function showTokenIPBlockModal(savedIP, currentIP, serviceLabel) {
    console.log('🚫 IP Block Modal açılıyor...', { savedIP, currentIP, serviceLabel });

    $('#mrktSavedIP').text(savedIP || '-');
    $('#mrktCurrentIP').text(currentIP || '-');

    const $desc = $('#tokenIPBlockDesc');
    if ($desc.length) {
        $desc.html(
            '<i class="fas fa-info-circle me-1"></i>' +
            '<strong>' + (serviceLabel || 'Token') + ' bu IP adresi ile zaten kullanılmış.</strong><br>' +
            'Farklı bir IP adresinden tekrar deneyin.'
        );
    }

    $('#MRKTIPBlockModal').fadeIn(300);

    $('#MRKTIPBlockClose, #MRKTIPBlockOK').off('click').on('click', function() {
        $('#MRKTIPBlockModal').fadeOut(300, () => {
            $('#FormDialog').fadeIn(350);
        });
    });

    $('#MRKTIPBlockModal').off('click').on('click', function(e) {
        if (e.target === this) {
            const modalBox = $('.adres-popup-box');
            modalBox.css('animation', 'shake 0.5s');
            setTimeout(() => {
                modalBox.css('animation', '');
            }, 500);
        }
    });
}

// Aynı IP'de en fazla 3 farklı YD / KM / DYS / YX kodu.
async function checkKmCouponIpLimit(token) {
    const key = String(token || '').trim().toUpperCase();
    try {
        const currentIP = await getUserIPAddress();
        if (!currentIP) {
            return { allowed: true, reason: 'IP alınamadı' };
        }
        return new Promise((resolve) => {
            chrome.storage.local.get(['km_coupon_ip_log'], (result) => {
                const log = result.km_coupon_ip_log || {};
                const entry = log[currentIP] || { tokens: [], locked: false, at: Date.now() };
                const tokens = Array.isArray(entry.tokens) ? entry.tokens.slice() : [];

                if (tokens.indexOf(key) !== -1) {
                    resolve({ allowed: true, reason: 'Aynı token', savedIP: currentIP, currentIP: currentIP });
                    return;
                }
                if (entry.locked || tokens.length >= 3) {
                    log[currentIP] = { tokens: tokens, locked: true, at: Date.now() };
                    chrome.storage.local.set({ km_coupon_ip_log: log });
                    resolve({ allowed: false, reason: '3 token doldu', savedIP: currentIP, currentIP: currentIP });
                    return;
                }
                tokens.push(key);
                log[currentIP] = { tokens: tokens, locked: tokens.length >= 3, at: Date.now() };
                chrome.storage.local.set({ km_coupon_ip_log: log });
                resolve({ allowed: true, reason: 'Kayıt', savedIP: currentIP, currentIP: currentIP, count: tokens.length });
            });
        });
    } catch (error) {
        console.error('Kupon IP kontrolü hatası:', error);
        return { allowed: true, reason: 'Hata oluştu' };
    }
}

function showKmCouponIpBlockModal(savedIP, currentIP) {
    showTokenIPBlockModal(savedIP, currentIP, 'Kodunuz');
    const $desc = $('#tokenIPBlockDesc');
    if ($desc.length) {
        $desc.html(
            '<i class="fas fa-info-circle me-1"></i>' +
            'Aynı IP adresi üzerinden 3 farklı hesapta sipariş geçtiniz. Doyasıya ve market kuponlarını daha stabil kullanmanız adına IP değiştirmeniz zorunludur.'
        );
    }
}

// 🚫 MRKT IP Engelleme Modal'ını Göster
function showMRKTIPBlockModal(savedIP, currentIP) {
    showTokenIPBlockModal(savedIP, currentIP, 'MRKT Token\'ınız');
}

// 🎯 AKILLI YÖNLENDİRME FONKSİYONU
function performSmartRedirect(token, selectedAddress) {
    const isMrbToken = token && token.startsWith('MRB-');
    
    if (isMrbToken && selectedAddress && selectedAddress.latitude && selectedAddress.longitude) {
        // MRB- token için campaigns sayfası (koordinatlarla)
        const campaignUrl = `https://www.yemeksepeti.com/campaigns?url_key=merhaba_hva1_apr25&lat=${selectedAddress.latitude}&lng=${selectedAddress.longitude}`;
        console.log('🎯 MRB Token - Campaigns sayfasına yönlendiriliyor:', campaignUrl);
        window.location.href = campaignUrl;
    } else {
        // Normal token veya MRD token - sadece ana sayfa
        console.log('🌐 Yemeksepeti ana sayfasına yönlendiriliyor');
        window.location.href = 'https://www.yemeksepeti.com/';
    }
}


// Session durumunu kontrol et - Daha az agresif sıfırlama
function checkSessionStatus() {
    chrome.storage.sync.get(['yemekhub_session'], function (result) {
        if (result.yemekhub_session && result.yemekhub_session.isLogged) {
            HBY_SessionData = result.yemekhub_session;
            const currentTime = Math.floor(Date.now() / 1000);

            // Sadece gerçekten süresi dolmuşsa sıfırla
            if (HBY_SessionData.expiry && currentTime > HBY_SessionData.expiry) {
                console.log('Session süresi doldu, sıfırlanıyor...');
                resetSession();
            } else {
                // Session aktif
                $('#FormDialog').hide();
                $('#TokenLogoutForm [name="token"]').val(HBY_SessionData.token);
                $('#LoggedDialog').show();

                // Kalan süreyi hesapla ve göster
                if (HBY_SessionData.expiry) {
                    const remainingTime = Math.floor((HBY_SessionData.expiry - currentTime) / 60);
                    if ($('.status-badge').length) {
                        $('.status-badge').html(`<i class="fas fa-check me-1"></i> Aktif (${remainingTime} dk)`);
                    }
                }
            }
        } else {
            // Session yok veya logged değil - sadece UI'yi göster, sıfırlama yapma
            $('#LoggedDialog').hide();
            $('#FormDialog').show();
        }
    });
}

// Scriptleri indir ve kaydet (arka planda çalışacak)
function fetchScripts() {
    $.ajax({
        type: 'GET',
        url: MainUrl,
        contentType: 'application/json;charset=UTF-8',
        success: function (response) {
            try {
                // Null kontrolü ekle
                if (!response) {
                    console.warn('Sunucudan boş yanıt alındı.');
                    return;
                }

                // Eğer response zaten bir obje ise JSON.parse etme
                let parsedResponse;
                if (typeof response === 'string') {
                    parsedResponse = JSON.parse(response);
                } else {
                    parsedResponse = response;
                }

                // Null kontrolü ve status kontrolü
                if (parsedResponse && parsedResponse.status === true && parsedResponse.data && parsedResponse.data.scripts) {
                    const scripts = JSON.parse(parsedResponse.data.scripts).map(script => {
                        try {
                            return atob(script);
                        } catch {
                            return '';
                        }
                    });

                    chrome.storage.sync.set({ 'yemekhub_client_javascripts': scripts }, function () {
                        console.log('client javascripts saved!');
                    });
                } else {
                    console.warn('Hesap sorgu sunucusu şu anda aktif değil veya ulaşılamaz durumda.');
                }
            } catch (e) {
                console.error('JSON parse error:', e);
            }
        },
        error: function () {
            console.error('Sunucu bağlantısında hata oluştu.');
        }
    });
}

// Hata mesajlarını göster
function showError(title, extra = '') {
    const safeTitle = title ? String(title) : 'Bir hata oluştu.';
    const safeExtra = extra ? String(extra) : '';

    $('#ErrorDialogTitle').html('İşlem tamamlanamadı');
    $('#ErrorDialogText').html(
        `${safeTitle}<br>` +
        (safeExtra ? `<span style="opacity:0.9">${safeExtra}</span><br>` : '') +
        `<small>Giriş ekranına yönlendiriliyorsunuz...</small>`
    );
    $('#PreloaderDialog').fadeOut(350, function () {
        $('#ErrorDialog').fadeIn(350);
    });

    setTimeout(() => {
        $('#ErrorDialog').fadeOut(350, function () {
            $('#FormDialog').fadeIn(350);
        });
    }, 3500);
}

// Session sıfırla
function resetSession() {
    HBY_SessionData = {
        isLogged: false,
        cookies: [],
        expiry: 0,
        token: '',
        isCookieInserted: false
    };
    chrome.storage.sync.set({ 'yemekhub_session': HBY_SessionData });
}

// Harita işlemleri için yeni fonksiyonlar
function initializeMap() {
    const iframe = document.getElementById('mapFrame');
    if (iframe) {
        // Iframe yüklendiğinde haritayı başlat
        iframe.onload = function() {
            mapIframeWindow = iframe.contentWindow;
            mapReady = true;
            
            // Düzenleme modunda değilse varsayılan konumu ayarla
            if (!duzenlenecekAdresId) {
                setTimeout(() => {
                    if (mapIframeWindow) {
                        mapIframeWindow.postMessage({
                            action: 'setLocation',
                            lat: 41.0082,
                            lng: 28.9784
                        }, '*');
                    }
                }, 500);
            }
        };
    }
}

// Haritadan gelen mesajları dinle
window.addEventListener('message', function(event) {
    // Güvenlik kontrolü - sadece güvenilir kaynaklardan gelen mesajları kabul et
    if (event.origin !== 'https://www.yemekhub.com') return;
    
    // Form yükleniyorsa işlem yapma
    if (window.isLoadingEditForm) {
        console.log('⏳ Form yükleniyor, konum güncellemesi atlandı');
        return;
    }
    
    if (event.data && event.data.type === 'locationUpdate') {
        console.log('Haritadan konum güncellendi:', event.data.lat, event.data.lng);
        
        // Düzenleme modundaysa ve ilk konum güncellemesi değilse
        if (duzenlenecekAdresId) {
            // İlk konum güncellemesi harita yüklenirken geliyor, onu yoksay
            if (!window.userMovedMap) {
                window.userMovedMap = true;
                console.log("🗺️ Düzenleme modu - İlk konum güncellemesi, sadece flag ayarlandı");
                // İlk güncellemeyi yoksaymıyoruz, sadece flag'i ayarlıyoruz
                // return; // Bu satırı kaldırıyoruz
            } else {
                // Kullanıcı haritayı hareket ettirdi, formu temizle ve yeniden doldur
                console.log("🔄 Kullanıcı haritayı hareket ettirdi, form güncellenecek");
                
                // Form alanlarını temizle (il, ilçe, mahalle hariç - bunlar API'den gelecek)
                clearAddressFields();
            }
        }
        
        // Koordinatları kaydet
        window.selectedLat = event.data.lat;
        window.selectedLng = event.data.lng;
        
        // ✅ HAR İTA ZORUNLULUĞU KONTROLÜ
        checkMapRequirement();
        
        // Reverse geocoding yapmak için koordinatları kullan
        reverseGeocode(event.data.lat, event.data.lng);
        
        // Aynı zamanda adres arama inputunu da güncelle (gizli olsa bile)
        updateAddressSearchInput(event.data.lat, event.data.lng);
    }
    
    // Google Maps'teki arama kutusundan adres seçildiğinde
    if (event.data && event.data.type === 'placeSelected' && event.data.placeId) {
        console.log('Haritadan yer seçildi:', event.data.placeId);
        
        // Düzenleme modundaysa kullanıcı aktif olarak adres değiştiriyor
        if (duzenlenecekAdresId) {
            window.userMovedMap = true;
            console.log('📍 Düzenleme modunda place seçildi, userMovedMap = true');
        }
        
        // Place ID ile detayları al ve formu doldur
        fetchPlaceDetails(event.data.placeId);
        
        // ✅ HAR İTA ZORUNLULUĞU KONTROLÜ
        checkMapRequirement();
    }
});

// Place ID ile yer detaylarını al
async function fetchPlaceDetails(placeId) {
    try {
        // Önce form alanlarını temizle
        clearAddressFields();
        
        // Programatik değişiklik başlıyor
        isProgrammaticChange = true;
        
        // GÜVENLİ API kullan
        const selected = await securePlaceDetails(placeId);
        
        if (selected && selected.success) {
            // Gizli input'a adresi yaz
            if (selected.full_address) {
                document.getElementById("adresAraInput").value = selected.full_address;
            }
            
            // Global değişkenleri güncelle
            window.selectedPlaceId = selected.place_id || placeId;
            window.selectedLat = selected.lat;
            window.selectedLng = selected.lng;
            
            // Form alanlarını doldur
            if (selected.il) {
                setSelectValue("ilSelect", selected.il);
                
                // Cities endpoint güvenlik gerektirmez (Google API kullanmıyor)
                const ilceRes = await fetch(`${API_BASE}/cities/${selected.il}`);
                const ilceler = await ilceRes.json();
                const ilceSelect = document.getElementById("ilceSelect");
                ilceSelect.innerHTML = '<option value="">İlçe seçin</option>';
                if (Array.isArray(ilceler)) {
                    ilceler.forEach(ilce => ilceSelect.add(new Option(ilce, ilce)));
                }
                
                if (selected.ilce) {
                    let ilce = normalizeIlceAdi(selected.ilce, selected.il);
                    setSelectValue("ilceSelect", ilce);
                    
                    const mahalleRes = await fetch(`${API_BASE}/cities/${selected.il}/${ilce}`);
                    const mahalleler = await mahalleRes.json();
                    const mahalleSelect = document.getElementById("mahalleSelect");
                    mahalleSelect.innerHTML = '<option value="">Mahalle seçin</option>';
                    if (Array.isArray(mahalleler)) {
                        mahalleler.forEach(mh => mahalleSelect.add(new Option(mh, mh)));
                    }
                    
                    if (selected.mahalle) {
                        setSelectValue("mahalleSelect", selected.mahalle);
                    }
                }
            }
            
            // Programatik değişiklik bitti
            isProgrammaticChange = false;
            
            if (selected.cadde) {
                document.querySelector("input[placeholder='Cadde/Sokak']").value = selected.cadde;
            }
            
            if (selected.no) {
                document.getElementById("binaNo").value = selected.no;
            }
            
            if (selected.posta_kodu) {
                document.querySelector(".postal-code-input").value = selected.posta_kodu;
            }
        }
    } catch (err) {
        console.error("Place details hatası:", err);
        isProgrammaticChange = false;
    }
}

// 🔒 GÜVENLİ API İSTEK SİSTEMİ - Challenge-Response
// Google API key artık sunucuda saklanıyor, eklenti challenge ile doğrulanıyor

/**
 * Sunucudan challenge al
 */
async function getSecurityChallenge() {
    try {
        const response = await fetch(`${SECURE_API_BASE}/api/challenge`);
        const data = await response.json();
        
        if (!data.success) {
            console.error('❌ Challenge alınamadı:', data.error);
            return null;
        }
        
        console.log('🔐 Challenge alındı:', data.challenge_type);
        return data;
    } catch (error) {
        console.error('❌ Challenge isteği başarısız:', error);
        return null;
    }
}

/**
 * Challenge'a yanıt oluştur
 */
function generateChallengeResponse(challenge) {
    switch (challenge.challenge_type) {
        case 'manifest_check':
            // Manifest'ten istenen alanı döndür
            const field = challenge.field || 'version';
            return manifest[field] || '';
            
        case 'secret_check':
            // Gizli değeri döndür
            return EXTENSION_SECRET;
            
        case 'code_check':
            // Kod hash'i (gerekirse)
            return '';
            
        case 'combined':
            // Birden fazla değeri JSON olarak döndür
            return JSON.stringify({
                manifest: manifest[challenge.field || 'version'] || '',
                secret: EXTENSION_SECRET
            });
            
        default:
            console.error('❌ Bilinmeyen challenge tipi:', challenge.challenge_type);
            return '';
    }
}

/**
 * Güvenli API isteği yap (challenge-response ile)
 */
async function secureGoogleApiRequest(endpoint, params = {}) {
    try {
        // 1. Challenge al
        const challenge = await getSecurityChallenge();
        if (!challenge) {
            throw new Error('Challenge alınamadı');
        }
        
        // 2. Challenge yanıtı oluştur
        const challengeResponse = generateChallengeResponse(challenge);
        
        // 3. Güvenli istek yap
        const response = await fetch(`${SECURE_API_BASE}${endpoint}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Challenge-Id': challenge.challenge_id,
                'X-Challenge-Response': challengeResponse,
                'X-Client-Nonce': challenge.nonce
            },
            body: JSON.stringify(params)
        });
        
        const data = await response.json();
        
        if (!data.success) {
            console.error('❌ Güvenli API isteği başarısız:', data.error);
            
            // Challenge gerekiyorsa tekrar dene
            if (data.need_challenge) {
                console.log('🔄 Challenge yeniden alınıyor...');
                return await secureGoogleApiRequest(endpoint, params);
            }
            
            return null;
        }
        
        console.log('✅ Güvenli API isteği başarılı');
        return data;
    } catch (error) {
        console.error('❌ Güvenli API isteği hatası:', error);
        return null;
    }
}

/**
 * Güvenli Reverse Geocode
 */
async function secureReverseGeocode(lat, lng) {
    return await secureGoogleApiRequest('/api/secure/reversegeocode', { lat, lng });
}

/**
 * Güvenli Place Details
 */
async function securePlaceDetails(placeId) {
    return await secureGoogleApiRequest('/api/secure/placedetails', { place_id: placeId });
}

/**
 * Güvenli Autocomplete
 */
async function secureAutocomplete(input) {
    return await secureGoogleApiRequest('/api/secure/autocomplete', { input });
}

/**
 * Güvenli Geocode (adres -> koordinat)
 */
async function secureGeocode(address) {
    return await secureGoogleApiRequest('/api/secure/geocode', { address });
}

// UYARI: Bu fonksiyon artık kullanılmıyor, güvenlik için sunucu taraflı çalışıyor
// Geriye uyumluluk için bırakıldı
async function getGoogleApiKey() {
    console.warn('⚠️ getGoogleApiKey() artık kullanılmamalı! Güvenli API kullanın.');
    return null; // Artık API key döndürmüyoruz
}

// Adres arama inputunu güncelle - GÜVENLİ VERSİYON
async function updateAddressSearchInput(lat, lng) {
    try {
        // Güvenli API ile reverse geocode yap
        const data = await secureReverseGeocode(lat, lng);
        
        if (data && data.success && data.full_address) {
            const adresAraInput = document.getElementById('adresAraInput');
            if (adresAraInput) {
                adresAraInput.value = data.full_address;
            }
        } else {
            console.error('❌ Adres bulunamadı');
        }
    } catch (error) {
        console.error('Adres güncelleme hatası:', error);
    }
}

// Reverse geocoding fonksiyonu - GÜVENLİ VERSİYON
async function reverseGeocode(lat, lng) {
    // Düzenleme modunda ve kullanıcı haritayı hareket ettirmediyse işlem yapma
    if (duzenlenecekAdresId && !window.userMovedMap) {
        return;
    }
    
    console.log("Reverse geocoding başlatıldı:", lat, lng);
    
    try {
        // Güvenli API kullan (challenge-response ile)
        const data = await secureReverseGeocode(lat, lng);
        
        if (data && data.success) {
            const addressData = {
                il: data.il || '',
                ilce: data.ilce || '',
                mahalle: data.mahalle || '',
                sokak: data.cadde || '',
                no: data.no || '',
                postaKodu: data.posta_kodu || ''
            };
            // Form alanlarını doldur
            fillFormFromGeocode(addressData);
        } else {
            console.error('❌ Reverse geocoding başarısız:', data?.error || 'Bilinmeyen hata');
        }
    } catch (error) {
        console.error('❌ Reverse geocoding hatası:', error);
    }
}

// Google Maps Geocoding API ile reverse geocoding - GÜVENLİ VERSİYON
async function reverseGeocodeWithGoogle(lat, lng) {
    try {
        // Güvenli API ile reverse geocode yap
        const data = await secureReverseGeocode(lat, lng);
        
        if (data && data.success) {
            const addressData = {
                il: data.il || '',
                ilce: data.ilce || '',
                mahalle: data.mahalle || '',
                sokak: data.cadde || '',
                no: data.no || '',
                postaKodu: data.posta_kodu || ''
            };
            
            // Form alanlarını doldur
            fillFormFromGeocode(addressData);
        } else {
            console.error('❌ Reverse geocoding başarısız');
        }
    } catch (error) {
        console.error('Reverse geocoding hatası:', error);
    }
}


// İlçe adını normalize et (Google Maps formatından sunucu formatına)
function normalizeIlceAdi(ilceAdi, ilAdi) {
    if (!ilceAdi) return '';
    
    let normalized = ilceAdi
        .replace(' İlçesi', '')
        .replace(' District', '')
        .trim();
    
    // "İl Adı + Merkez" formatını sadece "Merkez"e çevir
    // Örn: "Çanakkale Merkez" -> "Merkez", "İstanbul Merkez" -> "Merkez"
    if (ilAdi) {
        const merkez = normalized.replace(ilAdi, '').trim();
        if (merkez === 'Merkez' || merkez === 'merkez') {
            normalized = 'Merkez';
        }
    }
    
    // Bazı özel durumlar
    if (normalized.endsWith(' Merkez')) {
        normalized = 'Merkez';
    }
    
    console.log(`📍 İlçe normalizasyonu: "${ilceAdi}" -> "${normalized}"`);
    return normalized;
}

// Geocode verilerinden formu doldur
function fillFormFromGeocode(addressData) {
    console.log("Form dolduruluyor, adres verileri:", addressData);
    
    // Önce tüm form alanlarını temizle
    clearAddressFields();
    
    // Programatik değişiklik başlıyor
    isProgrammaticChange = true;
    
    // İl bilgisini doldur
    if (addressData.il) {
        // İl isimlerini normalize et (örn: "İstanbul Province" -> "İstanbul")
        let il = addressData.il.replace(' Province', '').replace(' İli', '');
        setSelectValue("ilSelect", il);
        $('#ilSelect').trigger('change');
        
        setTimeout(() => {
            // İlçe bilgisini doldur
            if (addressData.ilce) {
                // İlçe isimlerini normalize et - İL ADI + MERKEZ -> MERKEZ
                let ilce = normalizeIlceAdi(addressData.ilce, il);
                setSelectValue("ilceSelect", ilce);
                $('#ilceSelect').trigger('change');
                
                setTimeout(() => {
                    // Mahalle bilgisini doldur
                    if (addressData.mahalle) {
                        // Mahalle isimlerini normalize et
                        let mahalle = addressData.mahalle
                            .replace(' Mahallesi', '')
                            .replace(' Mah.', '')
                            .replace(' mah.', '')
                            .trim();
                        setSelectValue("mahalleSelect", mahalle);
                    } else {
                        console.log('⚠️ Mahalle bilgisi bulunamadı, kullanıcı manuel seçecek');
                    }
                    
                    // Programatik değişiklik bitti
                    isProgrammaticChange = false;
                    
                    // Sokak ve diğer bilgileri doldur (select'ler yüklendikten sonra)
                    if (addressData.sokak) {
                        let sokak = addressData.sokak.replace(' Caddesi', ' Cad.')
                                                     .replace(' Sokağı', ' Sok.')
                                                     .replace(' Sokak', ' Sok.')
                                                     .replace(' Cadde', ' Cad.');
                        document.querySelector('input[placeholder="Cadde/Sokak"]').value = sokak;
                    }
                    
                    if (addressData.no) {
                        document.getElementById('binaNo').value = addressData.no;
                    }
                    
                    if (addressData.postaKodu) {
                        document.querySelector('.postal-code-input').value = addressData.postaKodu;
                    }
                }, 500);
            } else {
                // İlçe yoksa flag'i kapat
                isProgrammaticChange = false;
            }
        }, 500);
    } else {
        // İl yoksa flag'i kapat
        isProgrammaticChange = false;
    }
    
    // Eğer bazı alanlar boşsa, formatted_address'ten parse etmeyi dene
    if (!addressData.sokak || !addressData.no) {
        setTimeout(() => {
            parseFormattedAddress();
        }, 1000);
    }
}

// Adres form alanlarını temizle
function clearAddressFields() {
    console.log("Form alanları temizleniyor");
    
    // Sokak ve bina bilgilerini temizle
    document.querySelector('input[placeholder="Cadde/Sokak"]').value = '';
    document.getElementById('binaNo').value = '';
    document.getElementById('katNo').value = '';
    document.getElementById('daireNo').value = '';
    document.querySelector('.postal-code-input').value = '';
    
    // Düzenleme modunda il, ilçe, mahalle'yi temizleme (bunlar API'den gelecek)
    if (!duzenlenecekAdresId) {
        // Sadece yeni adres eklerken mahalle select'ini temizle
        document.getElementById('mahalleSelect').value = '';
    }
}

// Formatted address'i parse et (yedek çözüm)
function parseFormattedAddress() {
    const adresAraInput = document.getElementById('adresAraInput');
    if (adresAraInput && adresAraInput.value) {
        const fullAddress = adresAraInput.value;
        
        // Sokak ve numara için regex pattern'leri
        const sokakPattern = /(\w+\s+(Cad\.|Caddesi|Sok\.|Sokak|Sokağı|Bulvarı|Blv\.))/i;
        const noPattern = /No[:\s]*(\d+)/i;
        
        // Sokak adını bul
        const sokakMatch = fullAddress.match(sokakPattern);
        if (sokakMatch && !document.querySelector('input[placeholder="Cadde/Sokak"]').value) {
            document.querySelector('input[placeholder="Cadde/Sokak"]').value = sokakMatch[0];
        }
        
        // Bina numarasını bul
        const noMatch = fullAddress.match(noPattern);
        if (noMatch && !document.getElementById('binaNo').value) {
            document.getElementById('binaNo').value = noMatch[1];
        }
    }
}

// Haritadaki konumu ara butonu için event listener
document.addEventListener('DOMContentLoaded', function() {
    const mapSearchBtn = document.getElementById('mapSearchBtn');
    if (mapSearchBtn) {
        mapSearchBtn.addEventListener('click', async function() {
            if (!window.selectedLat || !window.selectedLng) {
                alert('Lütfen önce haritadan bir konum seçin!');
                return;
            }
            
            // Butonu devre dışı bırak ve loading göster
            mapSearchBtn.disabled = true;
            mapSearchBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Aranıyor...';
            
            try {
                // Reverse geocoding yap
                await reverseGeocode(window.selectedLat, window.selectedLng);
                
                // Başarılı mesajı
                mapSearchBtn.innerHTML = '<i class="fas fa-check"></i> Adres Bulundu!';
                setTimeout(() => {
                    mapSearchBtn.innerHTML = '<i class="fas fa-search"></i> Haritadaki Konumu Ara';
                    mapSearchBtn.disabled = false;
                }, 2000);
            } catch (error) {
                // Hata durumu
                mapSearchBtn.innerHTML = '<i class="fas fa-times"></i> Hata Oluştu';
                setTimeout(() => {
                    mapSearchBtn.innerHTML = '<i class="fas fa-search"></i> Haritadaki Konumu Ara';
                    mapSearchBtn.disabled = false;
                }, 2000);
            }
        });
    }
});

// Sayfa yüklendiğinde olayları bağla
document.addEventListener("DOMContentLoaded", function () {
    const modal = document.getElementById("AdresPopup");
    const liste = document.getElementById("AdresListeGorunumu");
    const form = document.getElementById("AdresFormGorunumu");

    document.getElementById("AdresYonetimiButon").addEventListener("click", () => {
        modal.style.display = "flex";
        liste.style.display = "block";
        form.style.display = "none";
        document.getElementById("ListeyeDonButon").style.display = "none";
        adresleriListele();
    });

    document.getElementById("YeniAdresEkle").addEventListener("click", () => {
        duzenlenecekAdresId = null; // Yeni ekleme modu
        formuTemizle();
        document.querySelector('#AdresFormGorunumu .popup-title').textContent = '📘 Yeni Adres Ekle';
        document.getElementById('adresKaydetBtn').textContent = 'Adresi Kaydet';
        liste.style.display = "none";
        form.style.display = "block";
        document.getElementById("ListeyeDonButon").style.display = "inline-block";
        initializeMap();
    });

    document.getElementById("ListeyeDonButon").addEventListener("click", () => {
        duzenlenecekAdresId = null; // Düzenleme modundan çık
        form.style.display = "none";
        liste.style.display = "block";
        document.getElementById("ListeyeDonButon").style.display = "none";
    });

    document.getElementById("AdresPopupKapat").addEventListener("click", () => {
        modal.style.display = "none";
        duzenlenecekAdresId = null; // Düzenleme modundan çık
        
        // Popup kapandığında ana sayfadaki listeyi güncelle
        loadAddressList();
        
        // Kullanıcı tercihlerini yeniden yükle (seçili adres korunsun)
        setTimeout(() => {
            chrome.storage.local.get(['userPreferences'], function (result) {
                const prefs = result.userPreferences || {};
                if (prefs.selectedAddressId) {
                    const addressSelect = document.getElementById('addressSelect');
                    if (addressSelect) {
                        addressSelect.value = prefs.selectedAddressId;
                        console.log('✅ Popup kapanırken seçili adres korundu:', prefs.selectedAddressId);
                    }
                }
            });
        }, 100);
    });

    // Dışa aktar butonu
    document.getElementById("AdresDisaAktar").addEventListener("click", () => {
        console.log("Dışa aktar tıklandı");
        adreslerDisaAktar();
    });

    // İçe aktar butonu
    document.getElementById("AdresIceAktar").addEventListener("click", () => {
        console.log("İçe aktar tıklandı");
        document.getElementById("dosyaSec").click();
    });

    // Dosya seçildiğinde
    document.getElementById("dosyaSec").addEventListener("change", (e) => {
        const file = e.target.files[0];
        if (file) {
            console.log("Dosya seçildi:", file.name);
            adreslerIceAktar(file);
        }
    });
});

document.querySelector('.phone-input').addEventListener('input', function (e) {
    let val = e.target.value.replace(/\D/g, ''); // Sadece rakamları al
    if (val.length === 1 && val !== '5') {
        val = ''; // İlk rakam 5 değilse temizle
    }
    if (val.length > 10) {
        val = val.slice(0, 10); // En fazla 10 hane
    }
    e.target.value = val;
});

const API_BASE = 'http://154.49.170.75:3000';

// Programatik değişiklik flag'i
let isProgrammaticChange = false;

async function fetchJsonSafe(url) {
    try {
        const response = await fetch(url);
        if (!response.ok) {
            return null;
        }
        return await response.json();
    } catch (error) {
        return null;
    }
}

function showAddressSearchOnlyPopup() {
    if (document.getElementById('yt-address-lock-wall')) return;
    const wall = document.createElement('div');
    wall.id = 'yt-address-lock-wall';
    wall.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:rgba(17,24,39,.55);display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box;font-family:Arial,sans-serif;';
    wall.innerHTML = '<div style="width:100%;max-width:420px;background:#fff;border-radius:16px;padding:22px 18px;text-align:center;box-shadow:0 16px 50px rgba(0,0,0,.25);">'
        + '<div style="font-size:34px;line-height:1;margin-bottom:8px;">🔍</div>'
        + '<h2 style="font-size:18px;line-height:1.3;margin:0 0 10px;color:#1e3a8a;">Adresi arama kutusundan seç</h2>'
        + '<p style="margin:0 0 16px;color:#333;font-size:14px;line-height:1.55;">Şehir ve ilçe buradan değiştirilemez. Yukarıdaki arama kutusuna adresi yaz. Seçince bu alanlar otomatik dolar. Mahalle ve caddeyi istersen düzeltebilirsin.</p>'
        + '<button id="yt-address-lock-ok" type="button" style="width:100%;background:#2563eb;color:#fff;border:0;border-radius:10px;padding:12px 16px;font-size:15px;font-weight:700;cursor:pointer;">Anladım</button>'
        + '</div>';
    document.body.appendChild(wall);
    document.getElementById('yt-address-lock-ok').onclick = function () {
        wall.remove();
    };
}

function lockAutoAddressFields() {
    ['ilSelect', 'ilceSelect'].forEach(function (id) {
        const el = document.getElementById(id);
        if (!el || el.dataset.ytLocked) return;
        el.dataset.ytLocked = '1';
        function blockManualLocationChange(e) {
            if (isProgrammaticChange) return;
            e.preventDefault();
            el.blur();
            showAddressSearchOnlyPopup();
        }
        el.addEventListener('mousedown', blockManualLocationChange);
        el.addEventListener('pointerdown', blockManualLocationChange);
        el.addEventListener('touchstart', blockManualLocationChange, { passive: false });
        el.addEventListener('keydown', blockManualLocationChange);
    });
}

$(document).ready(async function () {
    lockAutoAddressFields();
    // İl listesini yükle
    const cities = await fetchJsonSafe(`${API_BASE}/cities`);
    if (Array.isArray(cities)) {
        cities.forEach(city => {
            $('#ilSelect').append(new Option(city, city));
        });
    }

    // İl seçilince ilçe listesini doldur
    $('#ilSelect').on('change', async function () {
        const selectedIl = $(this).val();
        $('#ilceSelect').empty().append(new Option('İlçe seçin', ''));
        $('#mahalleSelect').empty().append(new Option('Mahalle seçin', ''));
        
        // Sadece kullanıcı manuel değiştirdiğinde temizle
        if (!isProgrammaticChange) {
            // İl değiştiğinde sokak ve bina bilgilerini temizle
            document.querySelector('input[placeholder="Cadde/Sokak"]').value = '';
            document.getElementById('binaNo').value = '';
            document.getElementById('katNo').value = '';
            document.getElementById('daireNo').value = '';
        }

        if (selectedIl) {
            const towns = await fetchJsonSafe(`${API_BASE}/cities/${encodeURIComponent(selectedIl)}`);
            if (Array.isArray(towns)) {
                towns.forEach(town => {
                    $('#ilceSelect').append(new Option(town, town));
                });
            }
        }
    });

    // İlçe seçilince mahalleleri çek
    $('#ilceSelect').on('change', async function () {
        const selectedIl = $('#ilSelect').val();
        const selectedIlce = $(this).val();

        $('#mahalleSelect').empty().append(new Option('Mahalle seçin', ''));
        
        // Sadece kullanıcı manuel değiştirdiğinde temizle
        if (!isProgrammaticChange) {
            // İlçe değiştiğinde sokak ve bina bilgilerini temizle
            document.querySelector('input[placeholder="Cadde/Sokak"]').value = '';
            document.getElementById('binaNo').value = '';
        }

        if (selectedIl && selectedIlce) {
            const neighborhoods = await fetchJsonSafe(`${API_BASE}/cities/${encodeURIComponent(selectedIl)}/${encodeURIComponent(selectedIlce)}`);
            if (Array.isArray(neighborhoods)) {
                neighborhoods.forEach(mahalle => {
                    $('#mahalleSelect').append(new Option(mahalle, mahalle));
                });
            }
        }
    });
});

document.getElementById("adresKaydetBtn").addEventListener("click", function (e) {
    // Koordinat kontrolü yap
    if (!window.selectedLat || !window.selectedLng) {
        e.preventDefault(); // Formu göndermeyi engelle
        
        // Uyarı mesajı göster
        alert("⚠️ Lütfen önce haritadan bir konum seçin!\n\n" +
              "🗺️ Haritayı kullanarak istediğiniz konumu seçin veya\n" +
              "🔍 Üst kısımdaki arama kutusundan adres arayın.");
        
        // Kaydet butonunu tekrar kontrol et
        checkMapRequirement();
        return false;
    }

    // Ad ve soyad alanlarını al
    const musteriAdi = document.getElementById('musteriAdi')?.value?.trim() || '';
    const musteriSoyadi = document.getElementById('musteriSoyadi')?.value?.trim() || '';
    
    console.log('📝 Adres kaydedilirken ad/soyad bilgileri:', { musteriAdi, musteriSoyadi });
    
    // Koordinatlar varsa normal işleme devam et
    const il = document.getElementById("ilSelect").value.trim();
    const ilce = document.getElementById("ilceSelect").value.trim();
    const mahalle = document.getElementById("mahalleSelect").value.trim();
    const sokak = document.querySelector('input[placeholder="Cadde/Sokak"]').value.trim();

    const etiket = document.getElementById('adresEtiketiInput').value.trim() || 'Ev';
    const binaNo = document.getElementById('binaNo').value.trim();
    const katNo = document.getElementById('katNo').value.trim();
    const daireNo = document.getElementById('daireNo').value.trim();

    const postaKodu = document.querySelector('input[placeholder="Posta kodu"]').value.trim();
    const telefon = document.getElementById('telefonNo').value.trim();

    const tarifi = document.getElementById('adresTarifi').value.trim(); // Zorunlu

    // 🛡️ Zorunlu alanları kontrol et
    const requiredFields = {
        "İl": il,
        "İlçe": ilce,
        "Mahalle": mahalle,
        "Sokak": sokak,
        "Etiket": etiket,
        "Bina No": binaNo,
        "Kat No": katNo,
        "Daire No": daireNo,
        "Posta Kodu": postaKodu,
        "Telefon": telefon,
        "Adres Tarifi": tarifi
    };

    for (const [alan, deger] of Object.entries(requiredFields)) {
        if (!deger) {
            alert(`🚫 "${alan}" alanı zorunludur!`);
            return;
        }
    }

    const adSoyad = (musteriAdi && musteriSoyadi)
        ? `${musteriAdi} ${musteriSoyadi}`
        : musteriAdi
            ? musteriAdi
            : `Kullanıcı ${telefon.slice(-4)}`;

    const adresVerisi = {
        etiket,
        il,
        ilce,
        mahalle,
        sokak,
        binaNo,
        katNo,
        daireNo,
        postaKodu,
        telefon,
        adSoyad,
        tarifi,
        otomatikEkle: true, // Her zaman true
        rastgeleBosluk: false, // Devre dışı - Unicode boşluk ekleme kapalı
        sadeAdres: true // Her zaman true
    };

    // 🌍 Konum bilgileri
    const placeId = window.selectedPlaceId || crypto.randomUUID(); // fallback
    const lat = window.selectedLat || null;
    const lng = window.selectedLng || null;

    const exportJson = generateExportJson(adresVerisi, placeId, lat, lng);
    
    // Ad/Soyad bilgilerini adres verisine ekle
    if (musteriAdi || musteriSoyadi) {
        exportJson.first_name = musteriAdi;
        exportJson.last_name = musteriSoyadi;
        exportJson.fullname = [musteriAdi, musteriSoyadi].filter(Boolean).join(' ').trim();
    }
    
    // 👤 AD/SOYAD GÜNCELLEMESİ - Önce name update'i yap
    if ((musteriAdi || musteriSoyadi) && musteriAdi && musteriSoyadi) {
        console.log('👤 Ad/Soyad güncelleniyor...', { musteriAdi, musteriSoyadi });
        updateCustomerName(musteriAdi, musteriSoyadi, function(nameUpdateSuccess) {
            if (nameUpdateSuccess) {
                console.log('✅ Ad/Soyad başarıyla güncellendi');
            } else {
                console.log('⚠️ Ad/Soyad güncellenemedi ama adres işlemine devam ediliyor');
            }
            
            // Ad/Soyad güncellemesi tamamlandı, şimdi adres işlemi
            proceedWithAddressOperation();
        });
    } else {
        // Ad/Soyad boş, direkt adres işlemi
        proceedWithAddressOperation();
    }
    
    function proceedWithAddressOperation() {
        if (duzenlenecekAdresId) {
            // Düzenleme modu
            adresiGuncelle(duzenlenecekAdresId, exportJson);
        } else {
            // Yeni ekleme modu
            adresiKaydet(exportJson, function() {
                loadAddressList(); // Yeni adres eklendikten sonra listeyi güncelle
            });
        }
    }
});

document.addEventListener("DOMContentLoaded", () => {
    adresleriListele();
    const input = document.getElementById("adresAraInput");
    const suggestionBox = document.getElementById("autocompleteSonuclari");

    // Autocomplete önerilerini getir - GÜVENLİ VERSİYON
    input.addEventListener("input", async () => {
        const query = input.value.trim();
        if (query.length < 3) {
            suggestionBox.innerHTML = "";
            return;
        }

        try {
            const data = await secureAutocomplete(query);
            
            if (data && data.success && data.predictions) {
                suggestionBox.innerHTML = data.predictions.map(r => `
                    <li data-place_id="${r.place_id}">${r.description}</li>
                `).join("");
            } else {
                suggestionBox.innerHTML = "";
            }
        } catch (err) {
            console.error("Autocomplete isteği başarısız:", err);
        }
    });

    // Autocomplete sonucuna tıklanınca detayları çek - GÜVENLİ VERSİYON
    suggestionBox.addEventListener("click", async e => {
        if (e.target.tagName.toLowerCase() !== "li") return;

        const placeId = e.target.dataset.place_id;
        if (!placeId) return;

        try {
            // Önce form alanlarını temizle
            clearAddressFields();
            
            // Programatik değişiklik başlıyor
            isProgrammaticChange = true;
            
            // GÜVENLİ API kullan
            const selected = await securePlaceDetails(placeId);
            if (!selected || !selected.success) {
                isProgrammaticChange = false;
                return alert("Adres bilgileri alınamadı - güvenlik doğrulaması başarısız");
            }

            suggestionBox.innerHTML = "";
            document.getElementById("adresAraInput").value = selected.full_address || "";

            // 🌍 Global olarak sakla (adres kaydederken lazım olacak)
            window.selectedPlaceId = selected.place_id;
            window.selectedLat = selected.lat;
            window.selectedLng = selected.lng;
			
			checkMapRequirement();
			
            // Haritayı güncelle
            if (selected.lat && selected.lng && mapIframeWindow && mapReady) {
                mapIframeWindow.postMessage({
                    action: 'setLocation',
                    lat: selected.lat,
                    lng: selected.lng
                }, '*');
            }

            // İl
            if (selected.il) {
                setSelectValue("ilSelect", selected.il);

                // Cities endpoint güvenlik gerektirmez
                const ilceRes = await fetch(`${API_BASE}/cities/${selected.il}`);
                const ilceler = await ilceRes.json();
                const ilceSelect = document.getElementById("ilceSelect");
                ilceSelect.innerHTML = '<option value="">İlçe seçin</option>';
                if (Array.isArray(ilceler)) {
                    ilceler.forEach(ilce => ilceSelect.add(new Option(ilce, ilce)));
                }
                ilceSelect.disabled = false;

                // İlçe
                if (selected.ilce) {
                    let ilce = normalizeIlceAdi(selected.ilce, selected.il);
                    setSelectValue("ilceSelect", ilce);

                    const mahalleRes = await fetch(`${API_BASE}/cities/${selected.il}/${ilce}`);
                    const mahalleler = await mahalleRes.json();
                    const mahalleSelect = document.getElementById("mahalleSelect");
                    mahalleSelect.innerHTML = '<option value="">Mahalle seçin</option>';
                    if (Array.isArray(mahalleler)) {
                        mahalleler.forEach(mh => mahalleSelect.add(new Option(mh, mh)));
                    }
                    mahalleSelect.disabled = false;

                    if (selected.mahalle) {
                        setSelectValue("mahalleSelect", selected.mahalle);
                    }
                }
            }

            // Programatik değişiklik bitti
            isProgrammaticChange = false;

            if (selected.cadde) {
                document.querySelector("input[placeholder='Cadde/Sokak']").value = selected.cadde;
            }

            if (selected.no) {
                const binaInput = document.getElementById("binaNo");
                if (binaInput) binaInput.value = selected.no;
            }

            if (selected.posta_kodu) {
                const postaInput = document.querySelector(".postal-code-input");
                if (postaInput) postaInput.value = selected.posta_kodu;
            }

        } catch (err) {
        console.error("Otomatik doldurma hatası:", err);
        isProgrammaticChange = false;
        }
    });
});

function setSelectValue(selectId, value) {
    const select = document.getElementById(selectId);
    if (!select || !value) return;
    
    // Önce value ile dene
    select.value = value;
    
    // Eğer seçilmediyse, text ile karşılaştır
    if (select.value !== value) {
        const options = select.options;
        for (let i = 0; i < options.length; i++) {
            if (options[i].text === value || options[i].text.toLowerCase() === value.toLowerCase()) {
                select.selectedIndex = i;
                break;
            }
        }
    }
    
    // Hala seçilmediyse yeni option ekle
    if (select.value !== value && !Array.from(select.options).some(opt => opt.text === value)) {
        const newOpt = new Option(value, value);
        select.add(newOpt);
        select.value = value;
    }
}

// Türkiye şehir kodları mapping
const cityCodeMap = {
    "Adana": 1, "Adıyaman": 2, "Afyonkarahisar": 3, "Ağrı": 4, "Amasya": 5, "Ankara": 6, "Antalya": 7, "Artvin": 8, "Aydın": 9, "Balıkesir": 10,
    "Bilecik": 11, "Bingöl": 12, "Bitlis": 13, "Bolu": 14, "Burdur": 15, "Bursa": 16, "Çanakkale": 17, "Çankırı": 18, "Çorum": 19, "Denizli": 20,
    "Diyarbakır": 21, "Edirne": 22, "Elazığ": 23, "Erzincan": 24, "Erzurum": 25, "Eskişehir": 26, "Gaziantep": 27, "Giresun": 28, "Gümüşhane": 29, "Hakkari": 30,
    "Hatay": 31, "Isparta": 32, "Mersin": 33, "İstanbul": 34, "İzmir": 35, "Kars": 36, "Kastamonu": 37, "Kayseri": 38, "Kırklareli": 39, "Kırşehir": 40,
    "Kocaeli": 41, "Konya": 42, "Kütahya": 43, "Malatya": 44, "Manisa": 45, "Kahramanmaraş": 46, "Mardin": 47, "Muğla": 48, "Muş": 49, "Nevşehir": 50,
    "Niğde": 51, "Ordu": 52, "Rize": 53, "Sakarya": 54, "Samsun": 55, "Siirt": 56, "Sinop": 57, "Sivas": 58, "Tekirdağ": 59, "Tokat": 60,
    "Trabzon": 61, "Tunceli": 62, "Şanlıurfa": 63, "Uşak": 64, "Van": 65, "Yozgat": 66, "Zonguldak": 67, "Aksaray": 68, "Bayburt": 69, "Karaman": 70,
    "Kırıkkale": 71, "Batman": 72, "Şırnak": 73, "Bartın": 74, "Ardahan": 75, "Iğdır": 76, "Yalova": 77, "Karabük": 78, "Kilis": 79, "Osmaniye": 80, "Düzce": 81
};

// Random form ID generator - SABİT DEĞER
function generateFormId() {
    // Sabit form_id kullan (randomlaştırma devre dışı)
    return 'mi374wz5lr14';
    
    /* ESKİ RANDOM SİSTEM (pasif)
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < 12; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
    */
}

function generateExportJson(adresVerisi, placeId, lat, lng) {
    const cityId = cityCodeMap[adresVerisi.il] || 0;
    const formId = generateFormId();
    
    // Telefon numarasını formatla
    const phoneNumber = "+90" + adresVerisi.telefon;
    
    // Formatted address oluştur
    const formattedAddress = `${adresVerisi.mahalle}, ${adresVerisi.sokak}, ${adresVerisi.binaNo}, ${adresVerisi.postaKodu} ${adresVerisi.ilce} ${adresVerisi.il}`;
    
    // Delivery instructions oluştur
	const deliveryInstructions = adresVerisi.tarifi || ""; // Boşsa boş bırak, otomatik metin ekleme
    
    const json = {
        // Temel bilgiler
        city_id: cityId, city: adresVerisi.il, city_name: adresVerisi.il, district: adresVerisi.ilce, areas: adresVerisi.mahalle, neighborhood: adresVerisi.mahalle,
        street: adresVerisi.sokak, address_line1: adresVerisi.sokak, address_line2: adresVerisi.binaNo, address_line3: adresVerisi.mahalle, address_line4: adresVerisi.il,
        building: adresVerisi.binaNo, entrance: adresVerisi.daireNo, apartment: adresVerisi.daireNo, floor: adresVerisi.katNo, postcode: adresVerisi.postaKodu,
        
        // Konum bilgileri
        longitude: lng || 0, latitude: lat || 0,
        
        // İletişim ve teslim bilgileri
        delivery_instructions: deliveryInstructions, formatted_customer_address: formattedAddress, phone_number: phoneNumber,
        
        // Sistem bilgileri
        form_id: formId, country_code: "TR", location_type: "polygon", object_type: "new address",
        place_id: placeId || `hrehere:af:streetsection:${generateFormId()}:CggIBCDb7oDAAxABGgE3`, type: "0", meta: JSON.stringify({ provider: "here" }),
        
        // Kullanıcı bilgileri
        addressLabel: adresVerisi.etiket, fullname: adresVerisi.adSoyad,
        
        // Ayarlar
        autoAddAddress: adresVerisi.otomatikEkle, useRandomSpaces: adresVerisi.rastgeleBosluk, useCleanAddress: adresVerisi.sadeAdres
    };

    return json;
}

// 👤 MÜŞTERI AD/SOYAD GÜNCELLEME FONKSİYONU
function updateCustomerName(firstName, lastName, callback) {
    console.log('👤 updateCustomerName çağrıldı:', { firstName, lastName });
    
    // Session'dan gerekli bilgileri al
    chrome.storage.sync.get(['yemekhub_session'], function(result) {
        const sessionData = result.yemekhub_session;
        
        if (!sessionData || !sessionData.cookies) {
            console.error('❌ Session verisi bulunamadı');
            if (typeof callback === 'function') callback(false);
            return;
        }

        if (sessionData.platform === 'trendyol') {
            const webCookie = (sessionData.cookies || []).find((cookie) => cookie && cookie.name === 'tgo-token');
            chrome.runtime.sendMessage({
                action: 'tgoUpdatePersonName',
                firstName: firstName,
                lastName: lastName,
                webToken: webCookie ? webCookie.value : ''
            }, (result) => {
                if (typeof callback === 'function') callback(!!(result && result.updated));
            });
            return;
        }
        
        // Cookie'lerden gerekli header bilgilerini al
        const cookies = sessionData.cookies;
        let accessToken = '';
        let deviceId = '';
        
        // Access token ve device ID'yi bul
        for (const cookie of cookies) {
            if (cookie.name === 'ys_access_token') {
                accessToken = cookie.value;
            }
            if (cookie.name === 'ys_device_id') {
                deviceId = cookie.value;
            }
        }
        
        if (!accessToken) {
            console.error('❌ Access token bulunamadı');
            if (typeof callback === 'function') callback(false);
            return;
        }
        
        // API'ye PUT isteği gönder
        const customerData = {
            first_name: firstName,
            last_name: lastName
        };
        
        console.log('📡 Customer API isteği gönderiliyor:', customerData);
        
        fetch('https://www.yemeksepeti.com/api/v5/customers', {
            method: 'PUT',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${accessToken}`,
                'X-Device-Id': deviceId,
                'User-Agent': 'okhttp/4.12.0',
                'X-Requested-With': 'XMLHttpRequest'
            },
            body: JSON.stringify(customerData)
        })
        .then(response => {
            console.log('📡 Customer API response status:', response.status);
            if (response.ok) {
                return response.json();
            } else {
                throw new Error(`HTTP ${response.status}`);
            }
        })
        .then(data => {
            console.log('✅ Customer API başarılı:', data);
            if (typeof callback === 'function') callback(true);
        })
        .catch(error => {
            console.error('❌ Customer API hatası:', error);
            if (typeof callback === 'function') callback(false);
        });
    });
}

function adresiKaydet(adres, callback) {
    chrome.storage.local.get("addresses", (result) => {
        const mevcutAdresler = result.addresses || [];
        mevcutAdresler.unshift(adres); // Yeni adresi en başa ekle
        
        chrome.storage.local.set({ addresses: mevcutAdresler }, () => {
            console.log("✅ Yeni adres başarıyla eklendi.");
            console.log("Kaydedilen adres:", adres);
            
            // Popup içindeki listeyi güncelle
            adresleriListele();
            
            // Ana sayfadaki adres listesini güncelle
            loadAddressList();
            
            // Yeni eklenen adresi otomatik olarak seç
            const yeniAdresId = adres.place_id || adres.form_id;
            if (yeniAdresId) {
                setTimeout(() => {
                    $('#addressSelect').val(yeniAdresId);
                    // Tercihi kaydet
                    saveUserPreferences();
                }, 100);
            }
            
            // 🎯 MRB TOKEN KONTROLÜ - Adres eklendikten sonra normal giriş akışını tetikle (Campaigns sayfası yönlendirmesi)
            if (window.pendingMrbToken) {
                console.log('🔥 MRB Token için adres eklendi! Normal giriş akışı başlatılıyor...', window.pendingMrbToken);
                
                // Modalı kapat
                document.getElementById("AdresPopup").style.display = "none";
                
                // Kapama butonunu tekrar göster
                const kapatBtn = document.getElementById("AdresPopupKapat");
                if (kapatBtn) {
                    kapatBtn.style.display = "block";
                }
                
                // Form başlığını sıfırla
                const formTitle = document.querySelector('#AdresFormGorunumu .popup-title');
                if (formTitle) {
                    formTitle.innerHTML = '📘 Yeni Adres Ekle';
                }
                
                // Kaydet buton metnini sıfırla
                const kaydetBtn = document.getElementById('adresKaydetBtn');
                if (kaydetBtn) {
                    kaydetBtn.innerHTML = '<i class="fas fa-save me-2"></i>Adresi Kaydet';
                }
                
                // Token'ı input'a geri koy ve normal giriş akışını tetikle
                const mrbToken = window.pendingMrbToken;
                window.pendingMrbToken = null; // Temizle
                
                setTimeout(() => {
                    // Token'ı forma geri koy
                    $('#TokenGirisForm [name="token"]').val(mrbToken);
                    
                    // Normal giriş akışını tetikle (performActualLogin)
                    console.log('📋 MRB Token - Normal giriş akışı tetikleniyor...');
                    performActualLogin();
                }, 500);
                
                if (typeof callback === "function") callback();
                return;
            }
            
            // 🎯 MRD TOKEN KONTROLÜ - Adres eklendikten sonra normal giriş akışını tetikle
            if (window.pendingMrdToken) {
                console.log('🔥 MRD Token için adres eklendi! Normal giriş akışı başlatılıyor...', window.pendingMrdToken);
                
                // Modalı kapat
                document.getElementById("AdresPopup").style.display = "none";
                
                // Kapama butonunu tekrar göster
                const kapatBtn = document.getElementById("AdresPopupKapat");
                if (kapatBtn) {
                    kapatBtn.style.display = "block";
                }
                
                // Form başlığını sıfırla
                const formTitle = document.querySelector('#AdresFormGorunumu .popup-title');
                if (formTitle) {
                    formTitle.innerHTML = '📘 Yeni Adres Ekle';
                }
                
                // Kaydet buton metnini sıfırla
                const kaydetBtn = document.getElementById('adresKaydetBtn');
                if (kaydetBtn) {
                    kaydetBtn.innerHTML = '<i class="fas fa-save me-2"></i>Adresi Kaydet';
                }
                
                // Token'ı input'a geri koy ve normal giriş akışını tetikle
                const mrdToken = window.pendingMrdToken;
                window.pendingMrdToken = null; // Temizle
                
                setTimeout(() => {
                    // Token'ı forma geri koy
                    $('#TokenGirisForm [name="token"]').val(mrdToken);
                    
                    // Normal giriş akışını tetikle (performActualLogin)
                    console.log('📋 MRD Token - Normal giriş akışı tetikleniyor...');
                    performActualLogin();
                }, 500);
                
                if (typeof callback === "function") callback();
                return;
            }
            
            // 🎯 MRKT TOKEN KONTROLÜ - Adres eklendikten sonra normal giriş akışını tetikle
            if (window.pendingMrktToken) {
                console.log('🔥 MRKT Token için adres eklendi! Normal giriş akışı başlatılıyor...', window.pendingMrktToken);
                
                // Modalı kapat
                document.getElementById("AdresPopup").style.display = "none";
                
                // Kapama butonunu tekrar göster
                const kapatBtn = document.getElementById("AdresPopupKapat");
                if (kapatBtn) {
                    kapatBtn.style.display = "block";
                }
                
                // Form başlığını sıfırla
                const formTitle = document.querySelector('#AdresFormGorunumu .popup-title');
                if (formTitle) {
                    formTitle.innerHTML = '📘 Yeni Adres Ekle';
                }
                
                // Kaydet buton metnini sıfırla
                const kaydetBtn = document.getElementById('adresKaydetBtn');
                if (kaydetBtn) {
                    kaydetBtn.innerHTML = '<i class="fas fa-save me-2"></i>Adresi Kaydet';
                }
                
                // Token'ı input'a geri koy ve normal giriş akışını tetikle
                const mrktToken = window.pendingMrktToken;
                window.pendingMrktToken = null; // Temizle
                
                setTimeout(() => {
                    // Token'ı forma geri koy
                    $('#TokenGirisForm [name="token"]').val(mrktToken);
                    
                    // Normal giriş akışını tetikle (performActualLogin)
                    console.log('📋 MRKT Token - Normal giriş akışı tetikleniyor...');
                    performActualLogin();
                }, 500);
                
                if (typeof callback === "function") callback();
                return;
            }

            if (window.pendingTgoToken) {
                document.getElementById("AdresPopup").style.display = "none";
                const kapatBtn = document.getElementById("AdresPopupKapat");
                if (kapatBtn) kapatBtn.style.display = "block";
                const formTitle = document.querySelector('#AdresFormGorunumu .popup-title');
                if (formTitle) formTitle.innerHTML = '📘 Yeni Adres Ekle';
                const kaydetBtn = document.getElementById('adresKaydetBtn');
                if (kaydetBtn) kaydetBtn.innerHTML = '<i class="fas fa-save me-2"></i>Adresi Kaydet';
                const tgoToken = window.pendingTgoToken;
                window.pendingTgoToken = null;
                window.pendingTgoAddress = adres;
                setTimeout(() => {
                    const tgoAdresId = adres.place_id || adres.form_id;
                    if (tgoAdresId) {
                        $('#addressSelect').val(tgoAdresId);
                        saveUserPreferences();
                    }
                    $('#TokenGirisForm [name="token"]').val(tgoToken);
                    performActualLogin();
                }, 800);
                if (typeof callback === "function") callback();
                return;
            }
            
            // Normal akış - Modalı kapat
            document.getElementById("AdresFormGorunumu").style.display = "none";
            document.getElementById("AdresListeGorunumu").style.display = "block";
            
            if (typeof callback === "function") callback();
        });
    });
}

function tumAdresleriGetir() {
    chrome.storage.local.get("addresses", (result) => {
        const adresler = result.addresses || [];
        console.log("📦 Kayıtlı tüm adresler:", adresler);
    });
}

function adresiSil(place_id) {
    chrome.storage.local.get("addresses", (result) => {
        const adresler = result.addresses || [];
        console.log("Silinecek ID:", place_id);
        console.log("Mevcut adresler:", adresler);
        
        const yeniAdresler = adresler.filter(adres => {
            // Her iki ID'yi de kontrol et
            const adresId = adres.place_id || adres.form_id;
            console.log("Karşılaştırma:", adresId, "!==", place_id);
            return adresId !== place_id;
        });
        
        console.log("Filtrelenmiş adresler:", yeniAdresler);

        if (adresler.length === yeniAdresler.length) {
            console.error("Adres bulunamadı!");
            return;
        }

        chrome.storage.local.set({ addresses: yeniAdresler }, () => {
            console.log("🗑️ Adres silindi.");
            
            // Popup içindeki listeyi güncelle
            adresleriListele();
            
            // Ana sayfadaki adres listesini güncelle
            loadAddressList();
            
            // Eğer silinen adres seçili adresse, seçimi temizle
            chrome.storage.local.get(['userPreferences'], function (result) {
                const prefs = result.userPreferences || {};
                if (prefs.selectedAddressId === place_id) {
                    // Seçimi temizle
                    $('#addressSelect').val('');
                    // Güncellenmiş tercihi kaydet
                    saveUserPreferences();
                }
            });
        });
    });
}

function getAddressData(callback) {
    chrome.storage.local.get('addresses', (data) => {
        const addresses = data.addresses || [];
        if (addresses.length > 0) {
            // İlk adresi döndür (aktif olan)
            console.log("📤 Aktif adres:", addresses[0]);
            callback(addresses[0]);
        } else {
            console.warn("📭 Kayıtlı adres bulunamadı");
            callback(null);
        }
    });
}

function adresleriListele() {
    const container = document.getElementById("adresListesi");

    chrome.storage.local.get('addresses', (result) => {
        const addresses = result.addresses || [];

        if (!addresses.length) {
            container.innerHTML = `<div class="text-muted">Henüz kayıtlı adresiniz yok.</div>`;
            return;
        }

        container.innerHTML = '';

        addresses.forEach((adres, index) => {
            const iconMap = {
                "Ev": "fa-home",
                "İş": "fa-building",
                "Yazlık": "fa-umbrella-beach"
            };
            // Özel etiketler için varsayılan ikon
            const icon = iconMap[adres.addressLabel] || "fa-map-marker-alt";
            const labelText = adres.addressLabel || "Ev"; // Varsayılan: Ev
            const isFirst = index === 0;

            const card = document.createElement("div");
            card.className = "adres-card rounded p-3 mb-3 position-relative pointer";
            card.style.backgroundColor = "#1f2739";
            card.style.border = "1px solid rgba(255,255,255,0.1)";
            card.dataset.place_id = adres.place_id || adres.form_id;

            card.innerHTML = `
                <div class="d-flex justify-content-between align-items-start">
                    <div class="fw-bold text-white fs-5">
                        <i class="fas ${icon} me-2"></i>${labelText}
                    </div>
                    <div class="d-flex align-items-center gap-2">
                        ${isFirst ? '<span class="badge bg-success">Kullanılıyor</span>' : ''}
                        <i class="fas fa-pen text-warning pointer fs-5 me-2" data-place_id="${adres.place_id || adres.form_id}"></i>
                        <i class="fas fa-trash text-danger pointer fs-5" data-place_id="${adres.place_id || adres.form_id}"></i>
                    </div>
                </div>

                <div class="text-muted mt-2">${adres.fullname}</div>
                <div class="text-light">${adres.neighborhood}, ${adres.street}, No: ${adres.building}, Kat: ${adres.floor}, Daire: ${adres.apartment}</div>
                <div class="text-light">${adres.district}/${adres.city}</div>
                <div class="text-secondary small mt-1">${adres.phone_number}</div>
            `;

            // 🌟 Kart tıklanınca bu adresi en başa taşı ve popup'ı kapat
            card.addEventListener("click", (e) => {
                // Sil veya düzenle ikonuna tıklanmadıysa
                if (e.target.closest("i.fa-trash") || e.target.closest("i.fa-pen")) return;

                const placeId = card.dataset.place_id;
                chrome.storage.local.get('addresses', (res) => {
                    const tumAdresler = res.addresses || [];
                    const index = tumAdresler.findIndex(a => (a.place_id || a.form_id) === placeId);
                    if (index > -1) {
                        const secilen = tumAdresler.splice(index, 1)[0];
                        tumAdresler.unshift(secilen); // başa ekle

                        chrome.storage.local.set({ addresses: tumAdresler }, () => {
                            console.log("⭐ Seçilen adres öne alındı");
                            adresleriListele(); // yeniden listele
                            
                            // Ana formdaki dropdown'ı güncelle
                            loadAddressList();
                            
                            // Seçili adresi otomatik olarak ayarla
                            setTimeout(() => {
                                const addressSelect = document.getElementById('addressSelect');
                                if (addressSelect) {
                                    addressSelect.value = placeId;
                                    saveUserPreferences(); // Tercihi kaydet
                                    console.log('✅ Ana formdaki dropdown güncellendi:', placeId);
                                }
                                
                                // Popup'ı kapat
                                const modal = document.getElementById("AdresPopup");
                                if (modal) {
                                    modal.style.display = "none";
                                    console.log('✅ Adres yönetimi popup\'ı kapatıldı');
                                }
                            }, 100);
                        });
                    }
                });
            });

            container.appendChild(card);
        });

        // Silme butonları
        container.querySelectorAll(".fa-trash").forEach(icon => {
            icon.addEventListener("click", (e) => {
                e.stopPropagation(); // Kart tıklamasını engelle
                const placeId = e.target.dataset.place_id;
                if (confirm("Bu adresi silmek istediğinize emin misiniz?")) {
                    adresiSil(placeId); // sil ve yeniden listele
                }
            });
        });

        // Düzenleme butonları
        container.querySelectorAll(".fa-pen").forEach(icon => {
            icon.addEventListener("click", (e) => {
                e.stopPropagation(); // Kart tıklamasını engelle
                const placeId = e.target.dataset.place_id;
                console.log("Düzenleme tıklandı:", placeId);
                adresiDuzenle(placeId);
            });
        });
    });
}

// Yeni eklenen fonksiyonlar

// Formu temizle
function formuTemizle() {
    document.getElementById('adresEtiketiInput').value = 'Ev';
    document.getElementById('ilSelect').value = '';
    document.getElementById('ilceSelect').innerHTML = '<option value="">İlçe seçin</option>';
    document.getElementById('mahalleSelect').innerHTML = '<option value="">Mahalle seçin</option>';
    document.querySelector('input[placeholder="Cadde/Sokak"]').value = '';
    document.getElementById('binaNo').value = '';
    document.getElementById('katNo').value = '';
    document.getElementById('daireNo').value = '';
    document.querySelector('input[placeholder="Posta kodu"]').value = '';
    document.getElementById('telefonNo').value = '';
    document.getElementById('adresTarifi').value = '';
    document.getElementById('adresAraInput').value = '';
    
    // Global değişkenleri temizle
    window.selectedLat = null;
    window.selectedLng = null;
    window.selectedPlaceId = null;
    window.userMovedMap = false;
    window.isLoadingEditForm = false;
    window.locationMessageShown = false; // Mesaj flag'ini sıfırla
	
	checkMapRequirement();
    
    // Haritayı varsayılan konuma getir
    if (mapIframeWindow && mapReady) {
        mapIframeWindow.postMessage({
            action: 'setLocation',
            lat: 41.0082,
            lng: 28.9784
        }, '*');
    }
}

// Adresi güncelle
function adresiGuncelle(addressId, yeniAdres) {
    chrome.storage.local.get("addresses", (result) => {
        const mevcutAdresler = result.addresses || [];
        const index = mevcutAdresler.findIndex(a => (a.place_id || a.form_id) === addressId);
        
        if (index > -1) {
            // Mevcut ID'leri ve diğer sabit değerleri koru
            const eskiAdres = mevcutAdresler[index];
            yeniAdres.place_id = eskiAdres.place_id;
            yeniAdres.form_id = eskiAdres.form_id;
            yeniAdres.city_id = eskiAdres.city_id;
            yeniAdres.city_name = eskiAdres.city_name;
            yeniAdres.meta = eskiAdres.meta;
            yeniAdres.country_code = eskiAdres.country_code;
            yeniAdres.location_type = eskiAdres.location_type;
            yeniAdres.object_type = eskiAdres.object_type;
            yeniAdres.type = eskiAdres.type;
            
            mevcutAdresler[index] = yeniAdres;
            
            chrome.storage.local.set({ addresses: mevcutAdresler }, () => {
                console.log("✅ Adres başarıyla güncellendi.");
                
                // Popup içindeki listeyi güncelle
                adresleriListele();
                
                // Ana sayfadaki adres listesini güncelle
                loadAddressList();
                
                // Güncellenen adresi seçili tut
                const guncelAdresId = yeniAdres.place_id || yeniAdres.form_id;
                if (guncelAdresId) {
                    setTimeout(() => {
                        $('#addressSelect').val(guncelAdresId);
                        // Tercihi kaydet
                        saveUserPreferences();
                    }, 100);
                }
                
                // Formu kapat ve listeye dön
                document.getElementById("AdresFormGorunumu").style.display = "none";
                document.getElementById("AdresListeGorunumu").style.display = "block";
                duzenlenecekAdresId = null;
            });
        }
    });
}

// Adresi düzenle
function adresiDuzenle(addressId) {
    chrome.storage.local.get("addresses", (result) => {
        const mevcutAdresler = result.addresses || [];
        const adres = mevcutAdresler.find(a => (a.place_id || a.form_id) === addressId);
        
        if (adres) {
            console.log("Düzenlenecek adres detayları:", adres);
            
            duzenlenecekAdresId = addressId;
            window.userMovedMap = false;
            window.isLoadingEditForm = true;
            
            // Programatik değişiklik flag'ini aç
            isProgrammaticChange = true;
            
            // Formu göster
            document.getElementById("AdresListeGorunumu").style.display = "none";
            document.getElementById("AdresFormGorunumu").style.display = "block";
            document.getElementById("ListeyeDonButon").style.display = "inline-block";
            
            // ✨ YENİ: Düzenleme modunda form alanlarını göster
            showAddressFormFields();
            
            // Başlığı güncelle
            document.querySelector('#AdresFormGorunumu .popup-title').textContent = '📝 Adresi Düzenle';
            document.getElementById('adresKaydetBtn').textContent = 'Değişiklikleri Kaydet';
            
            // Form alanlarını doldur (Ad/Soyad dahil)
            document.getElementById('musteriAdi').value = adres.first_name || '';
            document.getElementById('musteriSoyadi').value = adres.last_name || '';
            document.getElementById('adresEtiketiInput').value = adres.addressLabel || 'Ev';
            
            // TÜM INPUT ALANLARI HEMEN DOLDUR
            document.querySelector('input[placeholder="Cadde/Sokak"]').value = adres.street || adres.address_line1 || '';
            document.getElementById('binaNo').value = adres.building || adres.address_line2 || '';
            document.getElementById('katNo').value = adres.floor || '';
            document.getElementById('daireNo').value = adres.apartment || adres.entrance || '';
            document.querySelector('input[placeholder="Posta kodu"]').value = adres.postcode || '';
            
            let phoneNumber = adres.phone_number || '';
            if (phoneNumber.startsWith('+90')) {
                phoneNumber = phoneNumber.substring(3);
            }
            document.getElementById('telefonNo').value = phoneNumber;
            
            // Adres tarifini doldur - SADECE TAM EŞLEŞME DURUMUNDA SİL
			const deliveryInstructions = adres.delivery_instructions || '';
			document.getElementById('adresTarifi').value = deliveryInstructions;
            
            console.log("Adres tarifi:", adres.delivery_instructions, "-> Form değeri:", deliveryInstructions);
            
            // Global değişkenleri güncelle
            window.selectedLat = adres.latitude || adres.lat || null;
            window.selectedLng = adres.longitude || adres.lng || null;
            window.selectedPlaceId = adres.place_id || null;
			
			// ✅ HAR İTA ZORUNLULUĞU: Koordinat varsa butonu aktif et
            setTimeout(() => {
                if (window.selectedLat && window.selectedLng) {
                    checkMapRequirement();
                }
            }, 1000);
            
            // İl değerini al ve seç
            const il = adres.city || adres.city_name || '';
            console.log("Kaydedilen il:", il);
            
            const ilSelect = document.getElementById('ilSelect');
            
            // İl select'inde doğru option'ı bul ve seç
            let ilSecildi = false;
            for (let i = 0; i < ilSelect.options.length; i++) {
                if (ilSelect.options[i].value === il || ilSelect.options[i].text === il) {
                    ilSelect.selectedIndex = i;
                    ilSecildi = true;
                    break;
                }
            }
            
            if (!ilSecildi) {
                console.error("İl bulunamadı:", il);
                isProgrammaticChange = false;
                window.isLoadingEditForm = false;
                return;
            }
            
            // İl seçildikten sonra ilçeleri yükle
            const selectedIl = ilSelect.value;
            fetch(`${API_BASE}/cities/${selectedIl}`)
                .then(res => res.json())
                .then(ilceler => {
                    const ilceSelect = document.getElementById('ilceSelect');
                    ilceSelect.innerHTML = '<option value="">İlçe seçin</option>';
                    
                    // İlçeleri ekle
                    ilceler.forEach(ilceIsmi => {
                        const option = new Option(ilceIsmi, ilceIsmi);
                        ilceSelect.add(option);
                    });
                    
                    // Kaydedilen ilçeyi seç
                    const ilce = adres.district || '';
                    console.log("Kaydedilen ilçe:", ilce);
                    console.log("Mevcut ilçe seçenekleri:", ilceler);
                    
                    // İlçeyi bul ve seç
                    let ilceSecildi = false;
                    for (let i = 0; i < ilceSelect.options.length; i++) {
                        if (ilceSelect.options[i].value === ilce || ilceSelect.options[i].text === ilce) {
                            ilceSelect.selectedIndex = i;
                            ilceSecildi = true;
                            break;
                        }
                    }
                    
                    if (!ilceSecildi && ilce) {
                        console.warn("İlçe listede bulunamadı, yeni option ekleniyor:", ilce);
                        const newOption = new Option(ilce, ilce);
                        ilceSelect.add(newOption);
                        ilceSelect.value = ilce;
                    }
                    
                    // İlçe seçildiyse mahalleleri yükle
                    if (ilce) {
                        fetch(`${API_BASE}/cities/${selectedIl}/${ilce}`)
                            .then(res => res.json())
                            .then(mahalleler => {
                                const mahalleSelect = document.getElementById('mahalleSelect');
                                mahalleSelect.innerHTML = '<option value="">Mahalle seçin</option>';
                                
                                // Mahalleleri ekle
                                mahalleler.forEach(mahalleIsmi => {
                                    const option = new Option(mahalleIsmi, mahalleIsmi);
                                    mahalleSelect.add(option);
                                });
                                
                                // Kaydedilen mahalleyi seç
                                const mahalle = adres.neighborhood || adres.areas || adres.address_line3 || '';
                                console.log("Kaydedilen mahalle:", mahalle);
                                console.log("Mevcut mahalle seçenekleri:", mahalleler);
                                
                                // Mahalleyi bul ve seç
                                let mahalleSecildi = false;
                                for (let i = 0; i < mahalleSelect.options.length; i++) {
                                    if (mahalleSelect.options[i].value === mahalle || mahalleSelect.options[i].text === mahalle) {
                                        mahalleSelect.selectedIndex = i;
                                        mahalleSecildi = true;
                                        break;
                                    }
                                }
                                
                                if (!mahalleSecildi && mahalle) {
                                    console.warn("Mahalle listede bulunamadı, yeni option ekleniyor:", mahalle);
                                    const newOption = new Option(mahalle, mahalle);
                                    mahalleSelect.add(newOption);
                                    mahalleSelect.value = mahalle;
                                }
                                
                                // Tüm işlemler tamamlandı
                                isProgrammaticChange = false;
                                
                                // Haritayı başlat
                                initializeMap();
                                setTimeout(() => {
                                    if (window.selectedLat && window.selectedLng && mapIframeWindow && mapReady) {
                                        mapIframeWindow.postMessage({
                                            action: 'setLocation',
                                            lat: window.selectedLat,
                                            lng: window.selectedLng
                                        }, '*');
                                    }
                                    // Harita yüklendikten sonra isLoadingEditForm'u false yap
                                    window.isLoadingEditForm = false;
                                    console.log('🗺️ Harita yüklendi, isLoadingEditForm = false');
                                }, 1000); // Biraz daha uzun bekle
                            })
                            .catch(err => {
                                console.error("Mahalle yükleme hatası:", err);
                                // Hata durumunda bile kaydedilen mahalleyi göster
                                const mahalle = adres.neighborhood || adres.areas || adres.address_line3 || '';
                                if (mahalle) {
                                    const mahalleSelect = document.getElementById('mahalleSelect');
                                    const newOption = new Option(mahalle, mahalle);
                                    mahalleSelect.add(newOption);
                                    mahalleSelect.value = mahalle;
                                }
                                isProgrammaticChange = false;
                            });
                    } else {
                        isProgrammaticChange = false;
                    }
                    
                    // Her durumda harita yüklendikten sonra isLoadingEditForm'u false yap
                    setTimeout(() => {
                        window.isLoadingEditForm = false;
                        console.log('🗺️ İlçe işlemi tamamlandı, isLoadingEditForm = false');
                    }, 1200);
                })
                .catch(err => {
                    console.error("İlçe yükleme hatası:", err);
                    // Hata durumunda bile kaydedilen ilçeyi göster
                    const ilce = adres.district || '';
                    if (ilce) {
                        const ilceSelect = document.getElementById('ilceSelect');
                        const newOption = new Option(ilce, ilce);
                        ilceSelect.add(newOption);
                        ilceSelect.value = ilce;
                    }
                    isProgrammaticChange = false;
                    
                    // Hata durumunda da timeout ile flag'i kapat
                    setTimeout(() => {
                        window.isLoadingEditForm = false;
                        console.log('🗺️ İlçe hatası sonrası, isLoadingEditForm = false');
                    }, 1200);
                });
        }
    });
}
// Adresleri dışa aktar
function adreslerDisaAktar() {
    chrome.storage.local.get("addresses", (result) => {
        const adresler = result.addresses || [];
        
        if (adresler.length === 0) {
            alert("Dışa aktarılacak adres bulunamadı!");
            return;
        }
        
        // Tüm adresleri tek bir JSON'da topla
        const exportData = {
            version: "2.0",
            exportDate: new Date().toISOString(),
            totalAddresses: adresler.length,
            addresses: adresler
        };
        
        // JSON dosyası olarak indir
        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `kuponmarket_adresler_${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        alert(`✅ ${adresler.length} adres başarıyla dışa aktarıldı!`);
    });
}

// Adresleri içe aktar
function adreslerIceAktar(file) {
    const reader = new FileReader();
    
    reader.onload = function(e) {
        try {
            const data = JSON.parse(e.target.result);
            
            // Veri formatını kontrol et
            if (!data.addresses || !Array.isArray(data.addresses)) {
                alert("❌ Geçersiz dosya formatı!");
                return;
            }
            
            chrome.storage.local.get("addresses", (result) => {
                const mevcutAdresler = result.addresses || [];
                let eklenenSayisi = 0;
                
                // Her adresi ekle
                data.addresses.forEach(adres => {
                    // Mevcut adresler arasında bu ID var mı kontrol et
                    const mevcutMu = mevcutAdresler.some(a => 
                        (a.place_id === adres.place_id) || 
                        (a.form_id === adres.form_id)
                    );
                    
                    if (!mevcutMu) {
                        mevcutAdresler.push(adres);
                        eklenenSayisi++;
                    }
                });
                
                if (eklenenSayisi > 0) {
                    chrome.storage.local.set({ addresses: mevcutAdresler }, () => {
                        alert(`✅ ${eklenenSayisi} yeni adres başarıyla eklendi!`);
                        adresleriListele();
                        loadAddressList(); // Ana sayfadaki listeyi güncelle
                    });
                } else {
                    alert("⚠️ Tüm adresler zaten mevcut!");
                }
            });
            
        } catch (error) {
            alert("❌ Dosya okunamadı! Lütfen geçerli bir JSON dosyası seçin.");
            console.error("İçe aktarma hatası:", error);
        }
    };
    
    reader.readAsText(file);
    
    // Input'u temizle (aynı dosyayı tekrar seçebilmek için)
    document.getElementById("dosyaSec").value = "";
}

document.addEventListener("click", function (e) {
    const popup = document.getElementById("AdresPopup");
    const icerik = document.querySelector(".adres-popup-icerik");

    if (!popup || popup.style.display === "none") return;

    if (popup.contains(e.target) && !icerik.contains(e.target)) {
        popup.style.display = "none";
    }
});

// ========================
// API INTERFACE FUNCTIONS
// ========================

// Site API URL si (manifest.json dan alınacak)
const SITE_API_BASE = 'https://yemektime.com.tr/api/extension';

// Global API state
let currentApiToken = '';
let currentUser = null;
let currentCategories = [];
let currentPurchases = [];

// 🗄️ OFFLINE STORAGE - Satın alınan hesapları local storage da sakla
const PURCHASES_STORAGE_KEY = 'offline_purchases';
const MAX_STORED_PURCHASES = 300; // Son 300 hesap

// setupApiInterface kurulumu için global flag
let setupApiInterfaceInitialized = false;

/**
 * 🎯 PROGRESS POPUP - Satın alma süreci için popup modal
 */
function showProgressPopup(message, type = 'loading') {
    // Mevcut popup'ı kapat
    closeProgressPopup();
    
    const iconMap = {
        'loading': '<i class="fas fa-spinner fa-spin"></i>',
        'success': '<i class="fas fa-check-circle"></i>',
        'info': '<i class="fas fa-info-circle"></i>',
        'warning': '<i class="fas fa-exclamation-triangle"></i>'
    };
    
    const colorMap = {
        'loading': 'primary',
        'success': 'success', 
        'info': 'info',
        'warning': 'warning'
    };
    
    const popupHTML = `
        <div id="progressPopupOverlay" class="progress-popup-overlay" style="
            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            background: rgba(0, 0, 0, 0.7);
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 10000;
            backdrop-filter: blur(3px);
        ">
            <div class="progress-popup-modal" style="
                background: white;
                border-radius: 15px;
                padding: 30px;
                text-align: center;
                min-width: 320px;
                max-width: 400px;
                box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
                animation: popupFadeIn 0.3s ease-out;
            ">
                <div class="progress-icon" style="
                    font-size: 48px;
                    color: var(--bs-${colorMap[type]});
                    margin-bottom: 20px;
                ">
                    ${iconMap[type]}
                </div>
                <div class="progress-message" style="
                    font-size: 16px;
                    color: #333;
                    line-height: 1.5;
                    font-weight: 500;
                ">
                    ${message}
                </div>
                ${type === 'loading' ? `
                <div class="progress-bar-container" style="
                    width: 100%;
                    height: 4px;
                    background: #e9ecef;
                    border-radius: 2px;
                    margin-top: 20px;
                    overflow: hidden;
                ">
                    <div class="progress-bar-animation" style="
                        width: 100%;
                        height: 100%;
                        background: linear-gradient(90deg, var(--bs-primary), var(--bs-info));
                        border-radius: 2px;
                        animation: progressSlide 2s infinite;
                    "></div>
                </div>
                ` : ''}
            </div>
        </div>
        
        <style>
        @keyframes popupFadeIn {
            from { 
                opacity: 0; 
                transform: scale(0.8) translateY(-20px); 
            }
            to { 
                opacity: 1; 
                transform: scale(1) translateY(0); 
            }
        }
        
        @keyframes progressSlide {
            0% { transform: translateX(-100%); }
            50% { transform: translateX(0%); }
            100% { transform: translateX(100%); }
        }
        
        @keyframes popupFadeOut {
            from { 
                opacity: 1; 
                transform: scale(1) translateY(0); 
            }
            to { 
                opacity: 0; 
                transform: scale(0.8) translateY(-20px); 
            }
        }
        </style>
    `;
    
    document.body.insertAdjacentHTML('beforeend', popupHTML);
}

/**
 * 🎯 PROGRESS POPUP - Popup'ı kapat
 */
function closeProgressPopup() {
    const existingPopup = document.getElementById('progressPopupOverlay');
    if (existingPopup) {
        existingPopup.style.animation = 'popupFadeOut 0.2s ease-in';
        setTimeout(() => {
            existingPopup.remove();
        }, 200);
    }
}

/**
 * 🎯 PROGRESS POPUP - Mesajı güncelle (aynı popup'ta)
 */
function updateProgressPopup(message, type = 'loading') {
    const popup = document.getElementById('progressPopupOverlay');
    if (popup) {
        const iconElement = popup.querySelector('.progress-icon');
        const messageElement = popup.querySelector('.progress-message');
        
        const iconMap = {
            'loading': '<i class="fas fa-spinner fa-spin"></i>',
            'success': '<i class="fas fa-check-circle"></i>',
            'info': '<i class="fas fa-info-circle"></i>',
            'warning': '<i class="fas fa-exclamation-triangle"></i>'
        };
        
        const colorMap = {
            'loading': 'primary',
            'success': 'success', 
            'info': 'info',
            'warning': 'warning'
        };
        
        if (iconElement) {
            iconElement.innerHTML = iconMap[type];
            iconElement.style.color = `var(--bs-${colorMap[type]})`;
        }
        
        if (messageElement) {
            messageElement.innerHTML = message;
        }
        
        // Loading bar'ı kaldır/ekle
        const progressBarContainer = popup.querySelector('.progress-bar-container');
        if (type === 'loading' && !progressBarContainer) {
            const modalContent = popup.querySelector('.progress-popup-modal');
            modalContent.insertAdjacentHTML('beforeend', `
                <div class="progress-bar-container" style="
                    width: 100%;
                    height: 4px;
                    background: #e9ecef;
                    border-radius: 2px;
                    margin-top: 20px;
                    overflow: hidden;
                ">
                    <div class="progress-bar-animation" style="
                        width: 100%;
                        height: 100%;
                        background: linear-gradient(90deg, var(--bs-primary), var(--bs-info));
                        border-radius: 2px;
                        animation: progressSlide 2s infinite;
                    "></div>
                </div>
            `);
        } else if (type !== 'loading' && progressBarContainer) {
            progressBarContainer.remove();
        }
    } else {
        // Popup yoksa yeni oluştur
        showProgressPopup(message, type);
    }
}

/**
 * 🗄️ Offline Storage - Satın alınan hesapları local storage'a kaydet
 */
async function savePurchasesToStorage(purchases) {
    try {
        // Son MAX_STORED_PURCHASES kadar hesabı sakla (en yeniler başta)
        const limitedPurchases = purchases.slice(0, MAX_STORED_PURCHASES);
        
        await chrome.storage.local.set({
            [PURCHASES_STORAGE_KEY]: {
                data: limitedPurchases,
                lastUpdated: Date.now(),
                count: limitedPurchases.length
            }
        });
        
        console.log(`✅ ${limitedPurchases.length} hesap offline storage'a kaydedildi`);
    } catch (error) {
        console.error('❌ Purchases storage kaydetme hatası:', error);
    }
}

/**
 * 🗄️ Offline Storage - Satın alınan hesapları local storage dan yükle
 */
async function loadPurchasesFromStorage() {
    try {
        const result = await chrome.storage.local.get([PURCHASES_STORAGE_KEY]);
        
        if (result[PURCHASES_STORAGE_KEY]) {
            const storageData = result[PURCHASES_STORAGE_KEY];
            currentPurchases = storageData.data || [];
            
            console.log(`✅ ${currentPurchases.length} hesap offline storage dan yüklendi`);
            console.log(`📅 Son güncelleme: ${new Date(storageData.lastUpdated).toLocaleString()}`);
            
            return currentPurchases;
        } else {
            console.log('📭 Offline storage da kayıtlı hesap bulunamadı');
            currentPurchases = [];
            return [];
        }
    } catch (error) {
        console.error('❌ Purchases storage yükleme hatası:', error);
        currentPurchases = [];
        return [];
    }
}

/**
 * 🔄 API den fresh hesap listesi çek ve storage a kaydet
 */
async function fetchAndUpdatePurchases() {
    if (!currentApiToken) {
        showApiError('Önce API anahtarını doğrulayın!');
        return false;
    }

    try {
        const response = await secureApiRequest('/user/purchases', { 
            api_token: currentApiToken, 
            limit: MAX_STORED_PURCHASES 
        }, 'GET');

        const data = await response.json();

        if (data.success && data.data && data.data.purchases) {
            const freshPurchases = data.data.purchases;
            
            // Storage'a kaydet
            await savePurchasesToStorage(freshPurchases);
            
            // Global değişkeni güncelle
            currentPurchases = freshPurchases;
            
            console.log(`🔄 ${freshPurchases.length} hesap API den güncellendi`);
            return true;
        } else {
            showApiError(data.message || 'Satın alınan hesaplar getirilemedi!');
            return false;
        }

    } catch (error) {
        console.error('❌ API den hesap çekme hatası:', error);
        showApiError('Hesaplar yüklenirken hata oluştu!');
        return false;
    }
}

/**
 * API Interface setup
 */
function setupApiInterface() {
    if (setupApiInterfaceInitialized) {
        console.log('⚠️ setupApiInterface zaten kuruldu, atlanıyor...');
        return;
    }
    
    console.log('🔧 setupApiInterface kuruluyor...');
    
    const validateApiBtn = document.getElementById('validateApiBtn');
    const showCategoriesBtn = document.getElementById('showCategoriesBtn');
    const showPurchasesBtn = document.getElementById('showPurchasesBtn');
    const apiKeyInput = document.getElementById('apiKey');

    // Ana HESAP SATIN AL butonu initApiInterface() fonksiyonunda kuruldu
    // Burada sadece iç butonları kuruyoruz

    // API key validate butonuna tıklanınca
    if (validateApiBtn) {
        validateApiBtn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            validateApiKey();
        });
    }

    // API key input'a Enter basılınca
    if (apiKeyInput) {
        apiKeyInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                validateApiKey();
            }
        });
    }

    // Kategoriler butonuna tıklanınca
    if (showCategoriesBtn) {
        showCategoriesBtn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            console.log('🛒 Hesap Satın Al (kategoriler) butonuna tıklandı');
            showCategories();
        });
    }

    // Satın alınanlar butonuna tıklanınca
    if (showPurchasesBtn) {
        showPurchasesBtn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            console.log('📋 Token Yönetimi butonuna tıklandı');
            showTokenManagement();
        });
    }

    // Kaydedilmiş API key'i yükle
    loadSavedApiKey();
    
    setupApiInterfaceInitialized = true;
    console.log('✅ setupApiInterface kurulumu tamamlandı');
}

/**
 * API Interface göster/gizle
 */
async function toggleApiInterface() {
    const apiInterface = document.getElementById('ApiInterface');
    const hesapSatinAlBtn = document.getElementById('HesapSatinAlButon');
    
    console.log('🔄 toggleApiInterface çağrıldı');
    console.log('ApiInterface:', apiInterface);
    console.log('HesapSatinAlButon:', hesapSatinAlBtn);
    
    if (apiInterface && hesapSatinAlBtn) {
        if (apiInterface.style.display === 'none' || apiInterface.style.display === '') {
            console.log('📖 API Interface açılıyor...');
            
            // API Interface'i aç
            apiInterface.style.display = 'block';
            hesapSatinAlBtn.innerHTML = '<i class="fas fa-times btn-icon"></i> KAPAT';
            hesapSatinAlBtn.classList.remove('btn-secondary');
            hesapSatinAlBtn.classList.add('btn-danger');
            
            // 🚀 OTOMATIK DOĞRULAMA: Kaydedilmiş API key varsa otomatik doğrula
            chrome.storage.local.get(['saved_api_key'], function(result) {
                if (result.saved_api_key) {
                    const apiKeyInput = document.getElementById('apiKey');
                    if (apiKeyInput) {
                        apiKeyInput.value = result.saved_api_key;
                        currentApiToken = result.saved_api_key;
                        
                        // Otomatik doğrulama yap
                        setTimeout(() => {
                            validateApiKey().then(() => {
                                // Doğrulama başarılıysa kategorileri yükle
                                loadCategories().then((success) => {
                                    // Kategoriler yüklendiyse direkt modal'ı aç
                                    if (success && currentCategories.length > 0) {
                                        setTimeout(() => {
                                            showCategoriesModal();
                                        }, 500);
                                    }
                                });
                            }).catch((error) => {
                                console.error('❌ Otomatik doğrulama hatası:', error);
                            });
                        }, 300);
                    }
                }
            });
        } else {
            console.log('📕 API Interface kapanıyor...');
            apiInterface.style.display = 'none';
            hesapSatinAlBtn.innerHTML = '<i class="fas fa-shopping-cart btn-icon"></i> HESAP SATIN AL';
            hesapSatinAlBtn.classList.remove('btn-danger');
            hesapSatinAlBtn.classList.add('btn-secondary');
            resetApiInterface();
        }
    } else {
        console.error('❌ API Interface veya buton bulunamadı!');
        console.error('ApiInterface:', apiInterface);
        console.error('HesapSatinAlButon:', hesapSatinAlBtn);
    }
}

/**
 * Mevcut token'ı doğrula
 */
async function validateCurrentToken() {
    if (!currentApiToken) {
        return false;
    }
    
    try {
        const response = await secureApiRequest('/validate-key', { api_token: currentApiToken }, 'GET');
        const data = await response.json();
        return data.success === true;
    } catch (error) {
        console.error('Token doğrulama hatası:', error);
        return false;
    }
}

/**
 * Kaydedilmiş API key'i yükle
 */
function loadSavedApiKey() {
    chrome.storage.local.get(['saved_api_key'], function(result) {
        if (result.saved_api_key) {
            const apiKeyInput = document.getElementById('apiKey');
            if (apiKeyInput) {
                apiKeyInput.value = result.saved_api_key;
                currentApiToken = result.saved_api_key;
                // Otomatik doğrula
                setTimeout(() => {
                    validateApiKey();
                }, 500);
            }
        }
    });
}

/**
 * API key'i doğrula
 */
async function validateApiKey() {
    const apiKeyInput = document.getElementById('apiKey');
    const validateBtn = document.getElementById('validateApiBtn');
    const userBalance = document.getElementById('userBalance');
    const actionButtons = document.getElementById('actionButtons');

    if (!apiKeyInput || !apiKeyInput.value.trim()) {
        showApiError('API anahtarı gerekli!');
        return;
    }

    const apiKey = apiKeyInput.value.trim();
    currentApiToken = apiKey;

    // Button loading state
    if (validateBtn) {
        validateBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        validateBtn.disabled = true;
    }

    let data = null; // Declare data variable
    let isSuccess = false;

    try {
        const response = await secureApiRequest('/validate-key', { api_token: apiKey }, 'GET');

        data = await response.json();

        if (data.success) {
            currentUser = data.data;
            
            // Bakiye göster
            if (userBalance) {
                userBalance.style.display = 'block';
                const balanceAmount = document.getElementById('balanceAmount');
                if (balanceAmount) {
                    balanceAmount.textContent = `${data.data.balance} ₺`;
                }
            }

            // Action buttons göster
            if (actionButtons) {
                actionButtons.style.display = 'block';
            }

            // API key'i kaydet (hem saved_api_key hem de api_token olarak)
            chrome.storage.local.set({ 
                'saved_api_key': apiKey,
                'api_token': apiKey  // Kupon sistemi için
            });

            showApiSuccess('API anahtarı doğrulandı!');
            
            // Kategorileri yükle
            loadCategories();
            
            isSuccess = true;

        } else {
            showApiError(data.message || 'API anahtarı geçersiz!');
            resetApiInterface();
        }

    } catch (error) {
        console.error('API validation error:', error);
        showApiError('Bağlantı hatası! Lütfen tekrar deneyin.');
        resetApiInterface();
    }

    // Button normal state - HER DURUMDA çalışır
    if (validateBtn) {
        validateBtn.innerHTML = '<i class="fas fa-check"></i>';
        validateBtn.disabled = false;
    }

    // Return success status
    return isSuccess;
}

/**
 * Kategorileri yükle
 */
async function loadCategories() {
    if (!currentApiToken) {
        showApiError('Önce API anahtarını doğrulayın!');
        return;
    }

    try {
        const response = await secureApiRequest('/categories', { api_token: currentApiToken }, 'GET');

        const data = await response.json();

        if (data.success) {
            currentCategories = data.data.categories;
            console.log('Kategoriler yüklendi:', currentCategories.length, 'adet');
        } else {
            showApiError(data.message || 'Kategoriler yüklenemedi!');
        }

    } catch (error) {
        console.error('Categories loading error:', error);
        showApiError('Kategoriler yüklenirken hata oluştu!');
    }
}

/**
 * Kategorileri göster
 */
function showCategories() {
    if (currentCategories.length === 0) {
        showApiError('Henüz kategori bulunamadı!');
        return;
    }

    showCategoriesModal();
}

/**
 * Kategoriler için modal popup sistemi
 */
function showCategoriesModal() {
    const modalHTML = `
        <div id="categoriesModalOverlay" class="categories-modal-overlay" style="display: flex;">
            <div class="categories-modal">
                <div class="categories-modal-header">
                    <h3><i class="fas fa-tags me-2"></i>Kategoriler</h3>
                    <div class="categories-info">
                        <span class="badge bg-primary">${currentCategories.length} kategori</span>
                        <span class="badge bg-success">Bakiye: ${currentUser ? currentUser.balance : '0'} ₺</span>
                    </div>
                    <button class="btn-close-categories-panel" id="closeCategoriesPanelBtn">
                        <i class="fas fa-times"></i>
                    </button>
                        </div>
                <div class="categories-modal-body">
                    <div class="categories-list">
                        ${generateCategoriesHTML()}
                    </div>
                </div>
                <div class="categories-modal-footer">
                    <button class="btn btn-secondary" id="closeCategoriesFooterBtn">
                        <i class="fas fa-times me-1"></i>Kapat
                        </button>
                    </div>
                </div>
            </div>
        `;
    
    // CSS stilleri ekle
    addCategoriesModalStyles();
    
    // Modal'ı sayfaya ekle
    const modalContainer = document.createElement('div');
    modalContainer.innerHTML = modalHTML;
    document.body.appendChild(modalContainer);
    
    // Event listener'ları kur
    setupCategoriesModalEvents();
}

function addCategoriesModalStyles() {
    if (!document.querySelector('#categoriesModalStyles')) {
        const styles = document.createElement('style');
        styles.id = 'categoriesModalStyles';
        styles.textContent = `
            .categories-modal-overlay {
                position: fixed;
                top: 0;
                left: 0;
                width: 100vw;
                height: 100vh;
                background: rgba(0,0,0,0.5);
                z-index: 10000;
                justify-content: center;
                align-items: center;
                animation: fadeIn 0.3s ease;
            }
            
            .categories-modal {
                background: white;
                border-radius: 15px;
                width: 90%;
                max-width: 700px;
                max-height: 85vh;
                box-shadow: 0 10px 30px rgba(0,0,0,0.3);
                animation: slideInUp 0.3s ease;
                display: flex;
                flex-direction: column;
            }
            
            .categories-modal-header {
                padding: 20px;
                border-bottom: 1px solid #eee;
                display: flex;
                justify-content: space-between;
                align-items: center;
                background: linear-gradient(45deg, #28a745, #20c997);
                color: white;
                border-radius: 15px 15px 0 0;
                flex-wrap: wrap;
                gap: 10px;
            }
            
            .categories-modal-header h3 {
                margin: 0;
                font-size: 1.3rem;
            }
            
            .categories-info {
                display: flex;
                gap: 8px;
                flex-wrap: wrap;
            }
            
            .btn-close-categories-panel {
                background: rgba(255,255,255,0.2);
                border: none;
                color: white;
                width: 35px;
                height: 35px;
                border-radius: 50%;
                cursor: pointer;
                transition: all 0.3s ease;
            }
            
            .btn-close-categories-panel:hover {
                background: rgba(255,255,255,0.3);
                transform: scale(1.1);
            }
            
            .categories-modal-body {
                flex-grow: 1;
                overflow-y: auto;
                padding: 20px;
                max-height: 60vh;
            }
            
            .categories-modal-footer {
                padding: 15px 20px;
                border-top: 1px solid #eee;
                display: flex;
                justify-content: center;
            }
            
            .categories-list {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
                gap: 20px;
            }
            
            .category-card {
                border: 2px solid #e9ecef;
                border-radius: 15px;
                padding: 25px;
                background: white;
                transition: all 0.3s ease;
                box-shadow: 0 4px 12px rgba(0,0,0,0.1);
                text-align: center;
            }
            
            .category-card:hover {
                transform: translateY(-3px);
                box-shadow: 0 8px 25px rgba(0,0,0,0.15);
                border-color: #007bff;
            }
            
            .category-card.unavailable {
                opacity: 0.6;
                background: #f8f9fa;
                border-color: #dee2e6;
            }
            
            .category-header {
                margin-bottom: 20px;
            }
            
            .category-title {
                font-size: 16px;
                font-weight: 600;
                color: #333;
                margin-bottom: 10px;
                line-height: 1.4;
                min-height: 50px;
                display: flex;
                align-items: center;
                justify-content: center;
            }
            
            .category-stock {
                font-size: 12px;
                padding: 6px 12px;
                border-radius: 20px;
                display: inline-block;
                font-weight: 600;
            }
            
            .category-stock.available {
                background: #d4edda;
                color: #155724;
            }
            
            .category-stock.unavailable {
                background: #f8d7da;
                color: #721c24;
            }
            
            .category-price {
                font-size: 28px;
                font-weight: 700;
                color: #007bff;
                margin-bottom: 20px;
                text-shadow: 0 2px 4px rgba(0,123,255,0.1);
            }
            
            .category-quantity {
                margin-bottom: 20px;
            }
            
            .category-quantity label {
                font-size: 14px;
                margin-bottom: 8px;
                color: #666;
                display: block;
                font-weight: 600;
            }
            
            .category-quantity input {
                width: 100px;
                text-align: center;
                font-size: 18px;
                padding: 12px;
                border: 2px solid #ddd;
                border-radius: 10px;
                font-weight: 600;
                background: #f8f9fa;
            }
            
            .category-quantity input:focus {
                border-color: #007bff;
                outline: none;
                box-shadow: 0 0 0 4px rgba(0,123,255,0.1);
                background: white;
            }
            
            .category-purchase-btn {
                width: 100%;
                padding: 15px 20px;
                border-radius: 12px;
                font-weight: 700;
                text-transform: uppercase;
                letter-spacing: 1px;
                border: none;
                transition: all 0.3s ease;
                font-size: 14px;
            }
            
            .category-purchase-btn.available {
                background: linear-gradient(45deg, #28a745, #20c997);
                color: white;
                box-shadow: 0 4px 15px rgba(40, 167, 69, 0.3);
            }
            
            .category-purchase-btn.available:hover {
                transform: translateY(-2px);
                box-shadow: 0 8px 25px rgba(40, 167, 69, 0.4);
            }
            
            .category-purchase-btn.unavailable {
                background: linear-gradient(45deg, #6c757d, #adb5bd);
                color: white;
                cursor: not-allowed;
            }
            
            @media (max-width: 768px) {
                .categories-modal {
                    width: 95%;
                    max-height: 90vh;
                }
                
                .categories-list {
                    grid-template-columns: 1fr;
                    gap: 15px;
                }
                
                .category-card {
                    padding: 20px;
                }
                
                .categories-modal-header {
                    padding: 15px;
                }
                
                .categories-modal-body {
                    padding: 15px;
                }
                
                .category-title {
                    font-size: 14px;
                    min-height: 40px;
                }
                
                .category-price {
                    font-size: 24px;
                }
                
                .category-quantity input {
                    width: 80px;
                    font-size: 16px;
                    padding: 10px;
                }
            }
        `;
        document.head.appendChild(styles);
    }
}

/**
 * Kategori modal popup'ını göster
 */
function showCategoriesModal() {
    const modalHTML = `
        <div id="categoriesModalOverlay" class="categories-modal-overlay" style="display: flex;">
            <div class="categories-modal">
                <div class="categories-modal-header">
                    <h3><i class="fas fa-tags me-2"></i>Kategoriler</h3>
                    <div class="categories-info">
                        <span class="badge bg-primary">${currentCategories.length} kategori</span>
                        <span class="badge bg-success">Bakiye: ${currentUser ? currentUser.balance : '0'} ₺</span>
                    </div>
                    <button class="btn-close-categories-panel" id="closeCategoriesPanelBtn">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div class="categories-modal-body">
                    <div id="categoriesList" class="categories-list">
                        ${generateCategoriesHTML()}
                    </div>
                </div>
                <div class="categories-modal-footer">
                    <button class="btn btn-secondary" id="closeCategoriesFooterBtn">
                        <i class="fas fa-times me-1"></i>Kapat
                    </button>
                </div>
            </div>
        </div>
    `;

    // CSS stilleri ekle
    addCategoriesModalStyles();
    
    // Modal'ı sayfaya ekle
    const modalContainer = document.createElement('div');
    modalContainer.innerHTML = modalHTML;
    document.body.appendChild(modalContainer);
    
    // Event listener'ları kur
    setupCategoriesModalEvents();
}

/**
 * Ürün satın al
 */
async function purchaseProduct(categoryId, categoryTitle, price, quantity = 1) {
    console.log('🛒 purchaseProduct çağrıldı:', { categoryId, categoryTitle, price, quantity });
    
    if (!currentApiToken || !currentUser) {
        showApiError('Önce API anahtarını doğrulayın!');
        return;
    }

    const totalPrice = price * quantity;
    const userBalance = parseFloat(currentUser.balance.replace(',', '.'));
    if (userBalance < totalPrice) {
        showApiError(`Yetersiz bakiye! Gerekli: ${totalPrice.toFixed(2)} ₺`);
        return;
    }

    if (!confirm(`${categoryTitle} kategorisinden ${quantity} adet hesap satın almak istediğinize emin misiniz?\n\nToplam Fiyat: ${totalPrice.toFixed(2)} ₺`)) {
        return;
    }

    // 🎯 PROGRESS POPUP - Satın alma başlangıç
    showProgressPopup('🛒 Hesap satın alma işlemi başlatılıyor...', 'loading');

    // Loading state
    const allButtons = document.querySelectorAll('.category-purchase-btn');
    allButtons.forEach(btn => {
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Satın Alınıyor...';
    });

    try {
        // 🎯 PROGRESS POPUP - Satın alma işlemi
        updateProgressPopup('⏳ Satın alma işlemi gerçekleştiriliyor...', 'loading');
        
        const response = await secureApiRequest('/purchase', { 
            api_token: currentApiToken, 
            category_id: categoryId, 
            quantity: quantity 
        }, 'GET');

        const data = await response.json();

        if (data.success) {
            // Bakiyeyi güncelle
            currentUser.balance = data.data.remaining_balance;
            const balanceAmount = document.getElementById('balanceAmount');
            if (balanceAmount) {
                balanceAmount.textContent = `${data.data.remaining_balance} ₺`;
            }

            // Satın alınan tokenları al
            const purchasedAccounts = data.data.purchased_accounts;
            
            console.log(`✅ ${quantity} adet hesap satın alındı, token yönetim paneli açılıyor`);
            console.log('🛒 Satın alma sonrası gelen veri:', {
                purchased_accounts: purchasedAccounts,
                category_name: data.data.category_name,
                full_data: data.data
            });
            
            // 🎯 PROGRESS POPUP - Satın alma başarılı
            updateProgressPopup(`✅ ${quantity} adet hesap başarıyla satın alındı!`, 'success');
            
            // Kategori modal'ını kapat
            closeCategoriesModal();
            
            setTimeout(async () => {
                // 🎯 PROGRESS POPUP - Token listesi güncelleniyor
                updateProgressPopup('🔄 Token listesi güncelleniyor...', 'loading');
                
                // 🔄 OTOMATIK LİSTE GÜNCELLEMESİ - Satın alma sonrası fresh data çek
                console.log('🔄 Satın alma sonrası otomatik liste güncelleniyor...');
                await fetchAndUpdatePurchases();
                
                // 🎯 PROGRESS POPUP - Token listesi hazır
                updateProgressPopup('✅ Token listesi hazır! Açılıyor...', 'success');
                
                // Satın aldığım hesaplar bölümünü aç
                setTimeout(() => {
                    closeProgressPopup(); // Popup'ı kapat
                    showTokenManagement();
                }, 1000);
                
            }, 1500); // Başarı mesajını 1.5 saniye göster

            // Kategorileri yenile (arka planda)
            await loadCategories();

        } else {
            closeProgressPopup(); // Popup'ı kapat
            showApiError(data.message || 'Satın alma işlemi başarısız!');
        }

    } catch (error) {
        console.error('Purchase error:', error);
        closeProgressPopup(); // Popup'ı kapat
        showApiError('Satın alma sırasında hata oluştu!');
    }

    // Normal state - sadece hata durumunda kategorileri yeniden aç
    if (!data || !data.success) {
        const allButtons = document.querySelectorAll('.category-purchase-btn');
    allButtons.forEach(btn => {
        btn.disabled = false;
            // Buton metnini eski haline getir
            const categoryId = btn.getAttribute('data-category-id');
            const category = currentCategories.find(c => c.id == categoryId);
            if (category) {
                const isAvailable = category.available_count > 0;
                const canAfford = currentUser && parseFloat(currentUser.balance.replace(',', '.')) >= category.price_raw;
                const canPurchase = isAvailable && canAfford;
                btn.innerHTML = `<i class="fas fa-shopping-cart me-2"></i>${canPurchase ? 'Satın Al' : (isAvailable ? 'Yetersiz Bakiye' : 'Stok Yok')}`;
            }
        });
    }
}

/**
 * Token yönetimi göster (eski showPurchases yerine) - OFFLINE VERSION
 */
async function showTokenManagement() {
    console.log('📋 Token Yönetimi açılıyor... (Offline Mode)');
    
    if (!currentApiToken) {
        showApiError('Önce API anahtarını doğrulayın!');
        return;
    }

    // Hızlı loading paneli göster
    showQuickTokenLoadingPanel();

    // 🗄️ Offline storage dan yükle
    await loadPurchasesFromStorage();

    try {
        // 🗄️ OFFLINE MODE - Storage dan yüklenmiş hesapları kullan
        if (currentPurchases.length === 0) {
            // Boş liste ile de panel'i aç - kullanıcı "Listeyi Güncelle" yapabilsin
            closeQuickTokenLoadingPanel();
            showTokenManagementPanel([], 'Satın Alınan Tokenlar (Boş Liste)');
            
            // Bilgilendirici mesaj göster
            setTimeout(() => {
                showApiError('Henüz kayıtlı hesap yok! "Listeyi Güncelle" butonunu kullanarak son hesaplarınızı çekebilirsiniz.');
            }, 500);
            return;
        }

        // Tüm tokenları düz bir listede topla (offline data dan)
            const allTokens = [];
        currentPurchases.forEach(purchase => {
                if (purchase.accounts && purchase.accounts.length > 0) {
                    purchase.accounts.forEach(account => {
                        allTokens.push({
                            account_info: account.account_info,
                            kupon_kodu: account.kupon_kodu,
                            mobile_confirmation: account.mobile_confirmation,
                            reference_code: purchase.order_reference,
                            category_name: purchase.category_name,
                            purchase_date: purchase.purchase_date
                        });
                    });
                }
            });

        console.log(`📋 Offline dan ${allTokens.length} token yüklendi`);

            // Silinen tokenları filtrele ve durumları uygula
            filterAndApplyTokenStates(allTokens).then(filteredTokens => {
                // Loading paneli kapat ve token panelini aç
                closeQuickTokenLoadingPanel();
            showTokenManagementPanel(filteredTokens, 'Tüm Tokenlar (Offline)');
            });

    } catch (error) {
        console.error('❌ Offline token yükleme hatası:', error);
        closeQuickTokenLoadingPanel();
        showApiError('Hesaplar yüklenirken hata oluştu!');
    }
}

// Hızlı loading paneli göster
function showQuickTokenLoadingPanel() {
    const loadingHTML = `
        <div id="quickTokenLoading" class="token-management-overlay" style="display: flex !important; position: fixed !important; top: 0 !important; left: 0 !important; width: 100vw !important; height: 100vh !important; justify-content: center !important; align-items: center !important; z-index: 10000 !important; background: rgba(0, 0, 0, 0.8) !important;">
            <div class="quick-loading-modal" style="background: white !important; border-radius: 20px !important; padding: 50px 60px !important; text-align: center !important; box-shadow: 0 15px 40px rgba(0,0,0,0.4) !important; min-width: 300px !important;">
                <div class="loading-spinner" style="font-size: 3rem !important; color: #007bff !important; margin-bottom: 20px !important;">
                    <i class="fas fa-spinner fa-spin"></i>
                </div>
                <div class="loading-text" style="color: #333 !important; font-weight: 600 !important; font-size: 16px !important; margin: 0 !important;">Tokenlar yükleniyor...</div>
            </div>
        </div>
    `;
    
    // CSS ekle
    if (!document.querySelector('#quickLoadingStyles')) {
        const styles = document.createElement('style');
        styles.id = 'quickLoadingStyles';
        styles.textContent = `
            .quick-loading-modal {
                background: white;
                border-radius: 20px;
                padding: 50px 60px;
                text-align: center;
                box-shadow: 0 15px 40px rgba(0,0,0,0.4);
                animation: slideInUp 0.3s ease-out;
                min-width: 300px;
                position: relative;
            }
            
            .loading-spinner {
                font-size: 3rem;
                color: #007bff;
                margin-bottom: 20px;
                animation: spin 1s linear infinite;
            }
            
            .loading-text {
                color: #333;
                font-weight: 600;
                font-size: 16px;
                margin: 0;
            }
            
            @keyframes slideInUp {
                from {
                    transform: translateY(30px) scale(0.9);
                    opacity: 0;
                }
                to {
                    transform: translateY(0) scale(1);
                    opacity: 1;
                }
            }
            
            @keyframes spin {
                from { transform: rotate(0deg); }
                to { transform: rotate(360deg); }
            }
        `;
        document.head.appendChild(styles);
    }
    
    const modalContainer = document.createElement('div');
    modalContainer.innerHTML = loadingHTML;
    document.body.appendChild(modalContainer);
}

// Hızlı loading paneli kapat
function closeQuickTokenLoadingPanel() {
    const loadingPanel = document.getElementById('quickTokenLoading');
    if (loadingPanel) {
        loadingPanel.remove();
    }
}

/**
 * API interface'i sıfırla
 */
function resetApiInterface() {
    const userBalance = document.getElementById('userBalance');
    const actionButtons = document.getElementById('actionButtons');
    const categoriesList = document.getElementById('categoriesList');
    const purchasesList = document.getElementById('purchasesList');

    if (userBalance) userBalance.style.display = 'none';
    if (actionButtons) actionButtons.style.display = 'none';
    if (categoriesList) categoriesList.style.display = 'none';
    if (purchasesList) purchasesList.style.display = 'none';

    currentApiToken = '';
    currentUser = null;
    currentCategories = [];
    currentPurchases = [];
}

/**
 * API başarı mesajı göster
 */
function showApiSuccess(message) {
    // Önce mevcut success ve error mesajlarını temizle
    const existingMessages = document.querySelectorAll('.alert.alert-success, .api-error');
    existingMessages.forEach(msg => msg.remove());
    
    // Eğer aynı mesaj zaten varsa yeni ekleme
    const apiInterface = document.getElementById('ApiInterface');
    if (apiInterface) {
        const existingMessage = apiInterface.querySelector('.alert.alert-success');
        if (existingMessage && existingMessage.textContent.includes(message)) {
            console.log('⚠️ Aynı success mesajı zaten gösteriliyor, atlanıyor');
            return;
        }
    }

    const successDiv = document.createElement('div');
    successDiv.className = 'alert alert-success mt-2';
    successDiv.innerHTML = `<i class="fas fa-check-circle me-2"></i>${message}`;
    
    if (apiInterface) {
        apiInterface.insertBefore(successDiv, apiInterface.firstChild);
        
        // 3 saniye sonra kaldır
        setTimeout(() => {
            if (successDiv.parentNode) {
                successDiv.remove();
            }
        }, 3000);
    }
}

/**
 * API hata mesajı göster
 */
function showApiError(message) {
    // Mevcut mesajları temizle
    const existingMessages = document.querySelectorAll('.alert');
    existingMessages.forEach(msg => msg.remove());

    const errorDiv = document.createElement('div');
    errorDiv.className = 'api-error';
    errorDiv.innerHTML = `<i class="fas fa-exclamation-triangle me-2"></i>${message}`;
    
    const apiInterface = document.getElementById('ApiInterface');
    if (apiInterface) {
        apiInterface.insertBefore(errorDiv, apiInterface.firstChild);
        
        // 5 saniye sonra kaldır
        setTimeout(() => {
            errorDiv.remove();
        }, 5000);
    }
}

const manualRedirectStyles = `
<style>
#manualRedirectBtn {
    background: linear-gradient(45deg, #FF6B6B, #FF8E53) !important;
    border: none !important;
    padding: 12px 24px !important;
    border-radius: 25px !important;
    font-weight: 600 !important;
    color: white !important;
    box-shadow: 0 4px 15px rgba(255, 107, 107, 0.3) !important;
    transition: all 0.3s ease !important;
    font-size: 14px !important;
}

#manualRedirectBtn:hover {
    transform: translateY(-2px) !important;
    box-shadow: 0 6px 20px rgba(255, 107, 107, 0.4) !important;
    background: linear-gradient(45deg, #FF8E53, #FF6B6B) !important;
}

#manualRedirectBtn:active {
    transform: translateY(0) !important;
}

#SuccessDialog .modal-content {
    text-align: center;
}
</style>
`;

// Stilleri head'e ekle (popup.js yüklenirken bir kez çalıştır):
if (!document.querySelector('#manualRedirectStyles')) {
    const styleElement = document.createElement('div');
    styleElement.id = 'manualRedirectStyles';
    styleElement.innerHTML = manualRedirectStyles;
    document.head.appendChild(styleElement);
}

// API Interface kurulumu için global flag
let apiInterfaceInitialized = false;

// Sayfa yüklendiğinde API interface'i kur - tek seferlik
function initApiInterface() {
    if (apiInterfaceInitialized) {
        console.log('⚠️ API Interface zaten kuruldu, atlanıyor...');
        return;
    }
    
    console.log('🚀 API Interface kuruluyor...');
    
    const hesapSatinAlBtn = document.getElementById('HesapSatinAlButon');
    console.log('🔍 HesapSatinAlButon elementi:', hesapSatinAlBtn);
    
    if (hesapSatinAlBtn) {
        console.log('✅ HESAP SATIN AL butonu bulundu, event listener kuruluyor...');
        
        // Önce mevcut event'leri temizle
        hesapSatinAlBtn.replaceWith(hesapSatinAlBtn.cloneNode(true));
        const newBtn = document.getElementById('HesapSatinAlButon');
        
        newBtn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            console.log('🎯 HESAP SATIN AL butonuna tıklandı!');
            toggleApiInterface();
        });
        
        console.log('✅ Event listener kuruldu');
        apiInterfaceInitialized = true;
    } else {
        console.error('❌ HesapSatinAlButon elementi bulunamadı!');
        return;
    }
    
    // Diğer API interface event'lerini kur
    if (typeof setupApiInterface === 'function') {
        setupApiInterface();
    }
}

// Tek seferlik kurulum
function initApiInterfaceOnce() {
    if (!apiInterfaceInitialized) {
        initApiInterface();
    }
}

// Çoklu yöntemle kurulum ama tek seferlik
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApiInterfaceOnce);
} else {
    initApiInterfaceOnce();
}

// jQuery ready de ekle
$(document).ready(function() {
    setTimeout(initApiInterfaceOnce, 100);
});

// Copy to clipboard fonksiyonu
function copyToClipboard(text) {
    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).then(() => {
            showCopyNotification('Kopyalandı!');
        }).catch(() => {
            fallbackCopyMethod(text);
        });
    } else {
        fallbackCopyMethod(text);
    }
}

function fallbackCopyMethod(text) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
    showCopyNotification('Kopyalandı!');
}

function showCopyNotification(message, type = 'success') {
    const existingNotification = document.getElementById('copy-notification');
    if (existingNotification) {
        existingNotification.remove();
    }
    
    const colorMap = {
        'success': '#28a745',
        'error': '#dc3545',
        'warning': '#ffc107',
        'info': '#17a2b8'
    };
    
    const notification = document.createElement('div');
    notification.id = 'copy-notification';
    notification.innerHTML = `
        <div style="
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background-color: ${colorMap[type] || colorMap.success};
            color: white;
            padding: 16px 24px;
            border-radius: 12px;
            box-shadow: 0 8px 24px rgba(0,0,0,0.3);
            z-index: 10002;
            font-family: inherit;
            font-size: 16px;
            font-weight: 600;
            text-align: center;
            min-width: 200px;
            animation: copyNotificationPop 0.3s ease-out;
        ">
            ${message}
        </div>
        
        <style>
        @keyframes copyNotificationPop {
            0% { 
                opacity: 0; 
                transform: translate(-50%, -50%) scale(0.8); 
            }
            100% { 
                opacity: 1; 
                transform: translate(-50%, -50%) scale(1); 
            }
        }
        </style>
    `;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        if (notification && notification.parentNode) {
            notification.remove();
        }
    }, 2000);
}

// 🎯 TOKEN'I LOGIN SAYFASINA YAPIŞTIR
function pasteTokenToLoginPage(token) {
    try {
        console.log('🔄 Token login sayfasına yapıştırılıyor:', token);
        
        // Eğer popup'tayız - pages/login.html'e yönlendir ve token'ı kaydet
        if (window.location.href.includes('popup.html')) {
            console.log('🔄 Popup\'tan login.html\'e yönlendiriliyor...');
            
            // Token'ı storage'a geçici olarak kaydet
            chrome.storage.local.set({ 'temp_auto_login_token': token }, function() {
                // Login sayfasını aç
                chrome.tabs.create({ url: 'pages/login.html' }, function(tab) {
                    console.log('✅ Login sayfası açıldı, token kaydedildi:', token.substring(0, 10) + '...');
                    showCopyNotification('🎉 Hesap satın alındı! Login sayfası açılıyor...', 'success');
                });
            });
            
        } else {
            // Zaten login.html'deyiz - token'ı direkt yerleştir
            console.log('📝 Login sayfasında token yerleştiriliyor...');
            
            const tokenInput = document.getElementById('token');
            if (tokenInput) {
                tokenInput.value = token;
                tokenInput.focus();
                tokenInput.select();
                
                showCopyNotification('🎉 Hesap satın alındı! Token yapıştırıldı.', 'success');
            } else {
                console.error('❌ Token input alanı bulunamadı!');
            }
        }
        
    } catch (error) {
        console.error('❌ Token yapıştırma hatası:', error);
        showCopyNotification('❌ Token yapıştırırken hata oluştu!', 'error');
    }
}

// 🎯 TOKEN YÖNETİM PANELİ - Satın alınan tokenları göster
function showTokenManagementPanel(tokens, categoryName) {
    
    // Normal modal (tokenlar varsa)
    const modalHTML = `
        <div id="tokenManagementOverlay" class="token-management-overlay" style="display: flex;">
            <div class="token-management-modal">
                <div class="token-management-header">
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <span style="
                            color: white;
                            font-size: 16px;
                            font-weight: 600;
                        ">${categoryName}</span>
                        <span style="
                            background: #198754;
                            color: white;
                            padding: 2px 6px;
                            font-size: 11px;
                            border-radius: 12px;
                            font-weight: 500;
                        ">${tokens.length} adet</span>
                    </div>
                    <div style="flex: 1; display: flex; justify-content: center;">
                        <button class="btn btn-outline-danger btn-sm" id="refreshPurchasesBtn" title="API den son hesapları çek" style="
                            background: linear-gradient(135deg, #dc3545, #c82333);
                            border: none;
                            color: white;
                            font-weight: 600;
                            box-shadow: 0 2px 4px rgba(220, 53, 69, 0.3);
                            transition: all 0.2s ease;
                            font-size: 12px;
                            padding: 6px 12px;
                        ">
                            <i class="fas fa-sync-alt me-1"></i>Listeyi Güncelle
                        </button>
                    </div>
                    <button class="btn-close-token-panel" id="closeTokenPanelBtn">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div class="token-bulk-actions">
                    <div class="bulk-selection">
                        <button class="btn btn-outline-primary btn-modern" id="toggleSelectionModeBtn">
                            <i class="fas fa-filter me-2"></i>SEÇ
                        </button>
                        <div class="selection-controls" style="display: none;">
                            <label class="bulk-checkbox" for="selectAllTokens">
                                <input type="checkbox" id="selectAllTokens">
                                <span class="select-all-text">Tümünü Seç</span>
                            </label>
                            <span id="selectedCount" class="selected-count">0 seçili</span>
                        </div>
                    </div>
                    <div class="bulk-buttons" style="display: none;">
                        <button class="btn btn-warning btn-xs" id="bulkMarkUsedBtn" disabled title="Seçilileri Kullanıldı Yap">
                            <i class="fas fa-check me-1"></i>
                            <span>Kullanıldı</span>
                        </button>
                        <button class="btn btn-success btn-xs" id="bulkMarkActiveBtn" disabled title="Seçilileri Aktif Yap">
                            <i class="fas fa-undo me-1"></i>
                            <span>Aktif</span>
                        </button>
                        <button class="btn btn-danger btn-xs" id="bulkMarkProblematicBtn" disabled title="Seçilileri Sorunlu Yap">
                            <i class="fas fa-exclamation-triangle me-1"></i>
                            <span>Sorunlu</span>
                        </button>
                        <button class="btn btn-secondary btn-xs" id="cancelSelectionBtn" title="Seçimi İptal Et">
                            <i class="fas fa-times me-1"></i>
                            <span>İptal</span>
                        </button>
                    </div>
                </div>
                <div class="token-filter-section">
                    <div class="filter-buttons" id="filterButtonsContainer">
                        ${generateFilterButtonsHTML()}
                    </div>
                </div>
                <div class="token-management-body">
                    <div id="tokenList" class="token-list">
                        ${generateTokenListHTML(tokens)}
                    </div>
                </div>
                <div class="token-management-footer">
                    <button class="btn btn-secondary" id="closeTokenPanelFooterBtn">
                        <i class="fas fa-times me-1"></i>Kapat
                    </button>
                    <button class="btn btn-primary" id="copyAllTokensBtn">
                        <i class="fas fa-copy me-1"></i>Tümünü Kopyala
                    </button>
                </div>
            </div>
        </div>
    `;
    
    // CSS stilleri ekle
    if (!document.querySelector('#tokenManagementStyles')) {
        const styles = document.createElement('style');
        styles.id = 'tokenManagementStyles';
        styles.textContent = `
            .token-management-overlay {
                position: fixed;
                top: 0;
                left: 0;
                width: 100vw;
                height: 100vh;
                background: rgba(0, 0, 0, 0.8);
                z-index: 10000;
                justify-content: center;
                align-items: center;
                animation: fadeIn 0.3s ease-out;
            }
            
            .token-management-modal {
                background: white;
                border-radius: 15px;
                width: 95%;
                max-width: 600px;
                max-height: 90vh;
                display: flex;
                flex-direction: column;
                box-shadow: 0 10px 30px rgba(0,0,0,0.3);
                animation: slideIn 0.3s ease-out;
            }
            
            @media (max-width: 768px) {
                .token-management-modal {
                    width: 98%;
                    max-height: 95vh;
                    border-radius: 10px;
                    margin: 10px;
                }
            }
            
            .token-management-header {
                padding: 20px;
                border-bottom: 1px solid #eee;
                display: flex;
                justify-content: space-between;
                align-items: center;
                background: linear-gradient(45deg, #007bff, #0056b3);
                color: white;
                border-radius: 15px 15px 0 0;
                flex-wrap: wrap;
                gap: 10px;
            }
            
            @media (max-width: 768px) {
                .token-management-header {
                    padding: 15px;
                    border-radius: 10px 10px 0 0;
                }
                
                .token-management-header h3 {
                    font-size: 1.1rem;
                }
                
                .token-category-info {
                    order: 3;
                    width: 100%;
                    justify-content: center;
                    margin-top: 10px;
                }
            }
            
            .token-management-header h3 {
                margin: 0;
                font-size: 1.2rem;
            }
            
            .token-category-info {
                display: flex;
                gap: 8px;
            }
            
            .token-bulk-actions {
                padding: 10px 20px;
                background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%);
                border-bottom: 1px solid #dee2e6;
                display: flex;
                justify-content: space-between;
                align-items: center;
                flex-wrap: wrap;
                gap: 10px;
            }
            
            .bulk-selection {
                display: flex;
                align-items: center;
                gap: 10px;
                flex-wrap: wrap;
            }
            
            .selection-controls {
                display: flex;
                align-items: center;
                gap: 10px;
                animation: slideInLeft 0.3s ease;
            }
            
            @keyframes slideInLeft {
                from {
                    transform: translateX(-20px);
                    opacity: 0;
                }
                to {
                    transform: translateX(0);
                    opacity: 1;
                }
            }
            
            .bulk-checkbox {
                display: flex;
                align-items: center;
                gap: 8px;
                cursor: pointer;
                font-weight: 500;
                padding: 6px 12px;
                border-radius: 20px;
                background: white;
                border: 1px solid #dee2e6;
                transition: all 0.2s ease;
                user-select: none;
            }
            
            .bulk-checkbox:hover {
                background: #f8f9fa;
                border-color: #007bff;
                transform: translateY(-1px);
                box-shadow: 0 2px 8px rgba(0,123,255,0.1);
            }
            
            .bulk-checkbox input[type="checkbox"] {
                width: 14px;
                height: 14px;
                cursor: pointer;
            }
            
            .select-all-text {
                font-size: 12px;
                font-weight: 600;
                color: #333;
            }
            
            .selected-count {
                color: #666;
                font-size: 11px;
                font-weight: 500;
                padding: 4px 8px;
                background: white;
                border-radius: 12px;
                border: 1px solid #dee2e6;
            }
            
            .bulk-buttons {
                display: flex;
                gap: 6px;
                flex-wrap: wrap;
                align-items: center;
            }
            
            .bulk-buttons .btn {
                padding: 6px 12px;
                font-size: 12px;
                border-radius: 6px;
            }
            
            .btn-xs {
                padding: 4px 10px !important;
                font-size: 10px !important;
                border-radius: 15px !important;
                height: 28px !important;
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
                border: none !important;
                transition: all 0.2s ease !important;
                white-space: nowrap !important;
                min-width: auto !important;
            }
            
            .btn-xs span {
                font-weight: 600 !important;
            }
            
            .btn-xs:hover {
                transform: translateY(-1px) !important;
                box-shadow: 0 3px 10px rgba(0,0,0,0.2) !important;
            }
            
            .btn-modern {
                padding: 8px 16px !important;
                font-size: 12px !important;
                font-weight: 600 !important;
                border-radius: 20px !important;
                border: 2px solid #007bff !important;
                background: white !important;
                color: #007bff !important;
                transition: all 0.3s ease !important;
                text-transform: uppercase !important;
                letter-spacing: 0.5px !important;
                box-shadow: 0 2px 8px rgba(0,123,255,0.1) !important;
            }
            
            .btn-modern:hover {
                background: #007bff !important;
                color: white !important;
                transform: translateY(-2px) !important;
                box-shadow: 0 4px 15px rgba(0,123,255,0.3) !important;
            }
            
            .btn-modern.btn-danger {
                border-color: #dc3545 !important;
                color: #dc3545 !important;
                background: white !important;
            }
            
            .btn-modern.btn-danger:hover {
                background: #dc3545 !important;
                color: white !important;
                box-shadow: 0 4px 15px rgba(220,53,69,0.3) !important;
            }
            
            .token-filter-section {
                padding: 10px 20px;
                background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%);
                border-bottom: 1px solid #dee2e6;
            }
            
            .filter-buttons {
                display: flex;
                gap: 6px;
                flex-wrap: wrap;
                justify-content: center;
            }
            
            .filter-btn {
                padding: 4px 10px;
                font-size: 11px;
                border-radius: 15px;
                transition: all 0.3s ease;
                font-weight: 500;
                border: 1px solid #dee2e6;
                background: white;
                min-width: 80px;
            }
            
            .filter-btn:hover {
                transform: translateY(-1px);
                box-shadow: 0 2px 8px rgba(0,0,0,0.1);
            }
            
            .filter-btn.active {
                background: #007bff !important;
                color: white !important;
                border-color: #007bff !important;
                box-shadow: 0 2px 10px rgba(0,123,255,0.3) !important;
            }
            
            .token-checkbox {
                padding: 10px;
                display: flex;
                align-items: center;
                justify-content: center;
                min-width: 40px;
            }
            
            .token-checkbox input[type="checkbox"] {
                width: 16px;
                height: 16px;
                cursor: pointer;
            }
            
            .token-item {
                border: 1px solid #ddd;
                border-radius: 10px;
                padding: 15px;
                margin-bottom: 10px;
                background: white;
                transition: all 0.3s ease;
            }
            
            .token-purchase-date {
                font-size: 11px;
                color: #888;
                margin-bottom: 10px;
                padding: 4px 8px;
                background: #f8f9fa;
                border-radius: 12px;
                display: inline-block;
                border: 1px solid #e9ecef;
            }
            
            .token-purchase-date i {
                color: #6c757d;
            }
            
            .btn-close-token-panel {
                background: rgba(255,255,255,0.2);
                border: none;
                color: white;
                width: 35px;
                height: 35px;
                border-radius: 50%;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
            }
            
            .token-management-body {
                padding: 20px;
                overflow-y: auto;
                flex-grow: 1;
            }
            
            .token-management-footer {
                padding: 15px 20px;
                border-top: 1px solid #eee;
                display: flex;
                gap: 10px;
                justify-content: flex-end;
            }
            
            .token-item {
                border: 1px solid #ddd;
                border-radius: 10px;
                padding: 15px;
                margin-bottom: 10px;
                background: #f8f9fa;
            }
            
            @media (max-width: 768px) {
                .token-item {
                    padding: 12px;
                    margin-bottom: 8px;
                }
            }
            
            .token-item.used {
                background: #e9ecef;
                opacity: 0.7;
            }
            
            .token-info {
                margin: 10px 0;
                display: flex;
                justify-content: center;
                align-items: center;
            }
            
            .token-code {
                font-family: monospace;
                background: white;
                padding: 8px 12px;
                border-radius: 5px;
                border: 1px solid #ccc;
                font-size: 13px;
                width: fit-content;
                white-space: nowrap;
                cursor: pointer;
                transition: all 0.2s ease;
            }
            
            @media (max-width: 768px) {
                .token-code {
                    font-size: 11px;
                    padding: 6px 10px;
                }
            }
            
            .token-code:hover {
                background: #e3f2fd;
                border-color: #007bff;
            }
            
            .token-actions-inline {
                display: flex;
                align-items: center;
                gap: 5px;
            }
            
            .login-icon, .copy-icon {
                cursor: pointer;
                transition: all 0.2s ease;
                padding: 2px;
                border-radius: 3px;
            }
            
            .login-icon:hover {
                background: rgba(40, 167, 69, 0.1);
                transform: scale(1.1);
            }
            
            .copy-icon:hover {
                background: rgba(0, 123, 255, 0.1);
                transform: scale(1.1);
            }
            
            .login-text {
                font-size: 10px;
                color: #28a745;
                font-weight: 600;
                margin-left: 2px;
            }
            
            .login-token-code {
                cursor: pointer;
                display: flex;
                justify-content: space-between;
                align-items: center;
            }
            
            .token-actions {
                display: flex;
                gap: 10px;
                flex-wrap: wrap;
                justify-content: center;
                margin-top: 15px;
                padding-top: 15px;
                border-top: 1px solid #f0f0f0;
            }
            
            @media (max-width: 768px) {
                .token-actions {
                    gap: 8px;
                    margin-top: 12px;
                    padding-top: 12px;
                }
                
                .token-actions .btn {
                    font-size: 10px;
                    padding: 6px 8px;
                    flex: 1;
                    min-width: 70px;
                }
            }
            
            .token-actions .btn {
                font-size: 11px;
                padding: 4px 8px;
            }
            
            @keyframes fadeIn {
                from { opacity: 0; }
                to { opacity: 1; }
            }
            
            @keyframes slideIn {
                from { transform: scale(0.9) translateY(-20px); opacity: 0; }
                to { transform: scale(1) translateY(0); opacity: 1; }
            }
            
            @keyframes fadeOut {
                from { opacity: 1; }
                to { opacity: 0; }
            }
            
            @keyframes slideOut {
                from { transform: scale(1) translateY(0); opacity: 1; }
                to { transform: scale(0.9) translateY(-20px); opacity: 0; }
            }
            
            .token-detail-row {
                display: flex;
                align-items: center;
                padding: 8px 0;
                border-bottom: 1px solid #f0f0f0;
                gap: 10px;
                font-size: 13px;
            }
            
            .token-detail-label {
                font-weight: 600;
                color: #333;
                font-size: 13px;
                white-space: nowrap;
                width: 100px;
                min-width: 100px;
                display: inline-block;
            }

            .token-detail-value {
                color: #666;
                font-size: 13px;
                flex: 1;
                display: flex;
                justify-content: flex-start;
                margin-left: 10px;
            }
            
            .token-detail-value.clickable:hover {
                background: #e3f2fd;
                border-radius: 3px;
                padding: 2px 4px;
            }

            .token-info {
                margin: 10px 0;
                display: flex;
                justify-content: center;
                align-items: center;
            }
        `;
        document.head.appendChild(styles);
    }
    
    // Modal'ı sayfaya ekle
    const modalContainer = document.createElement('div');
    modalContainer.innerHTML = modalHTML;
    document.body.appendChild(modalContainer);
    
    // Event listener'ları kur
    setupTokenManagementEvents();
    setupBulkActionEvents();
    setupFilterButtonEvents();
    
    // Token'lar yüklendikten sonra sayıları güncelle
    setTimeout(() => {
        updateFilterButtonCounts();
    }, 500);
}

// Token listesi HTML'i oluştur
function generateTokenListHTML(tokens) {
    // Boş liste durumu
    if (tokens.length === 0) {
        return `
            <div class="empty-token-list" style="
                padding: 60px 20px;
                text-align: center;
                color: #666;
                min-height: 300px;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
            ">
                <div style="font-size: 64px; margin-bottom: 20px; opacity: 0.3;">
                    📭
                </div>
                <h4 style="color: #333; margin-bottom: 15px; font-size: 18px; font-weight: 600;">Henüz Hesap Yok</h4>
                <p style="margin: 0; max-width: 350px; line-height: 1.6; font-size: 14px; color: #666;">
                    Henüz satın alınmış hesap bulunmuyor. Üstteki <strong style="color: #dc3545;">"Listeyi Güncelle"</strong> butonunu kullanarak son hesaplarınızı çekebilirsiniz.
                </p>
            </div>
        `;
    }
    
    return tokens.map((token, index) => {
        
        // Kupon bilgisi kontrolü - artık tüm API'lerden doğru veri geliyor
        let kuponInfo = 'Kupon Hesaba Tanımlıdır';
        
        if (token.mobile_confirmation == '1' || token.mobile_confirmation === 1) {
            if (token.kupon_kodu && token.kupon_kodu !== '1' && token.kupon_kodu !== 'Kupon Hesaba Tanımlıdır') {
                kuponInfo = token.kupon_kodu;
            } else if (token.account_date && token.account_date !== '1' && token.account_date !== 'Kupon Hesaba Tanımlıdır') {
                kuponInfo = token.account_date;
            }
        }
        
        console.log('🎫 Kupon Info Result:', kuponInfo);
            
        const isUsed = token.isUsed || false;
        const isProblematic = token.isProblematic || false;
        
        
        return `
            <div class="token-item ${isUsed ? 'used' : ''} ${isProblematic ? 'problematic' : ''}" data-token-index="${index}">
                <div class="token-checkbox" style="display: none;">
                    <input type="checkbox" class="token-select" data-token-index="${index}">
                </div>
                <div class="token-details">
                    ${token.purchase_date ? 
                        `<div class="token-purchase-date">
                            <i class="fas fa-calendar-alt me-1"></i>
                            <span>${token.purchase_date}</span>
                        </div>` : ''
                    }
                    <div class="token-detail-row">
                        <span class="token-detail-label">Token:</span>
                    <div class="token-code copy-token-code" data-token="${token.account_info.replace(/"/g, '&quot;')}">
                        ${token.account_info}
                        <i class="fas fa-copy ms-2 text-primary"></i>
                    </div>
                </div>
                    ${(token.mobile_confirmation == '1' || token.mobile_confirmation == 1) && kuponInfo !== 'Kupon Hesaba Tanımlıdır' ?
                        `<div class="token-detail-row">
                            <span class="token-detail-label">Kupon Kodu:</span>
                            <div class="token-code copy-token-code" data-token="${kuponInfo.replace(/"/g, '&quot;')}">
                                ${kuponInfo}
                                <i class="fas fa-copy ms-2 text-primary"></i>
                            </div>
                        </div>` :
                        `<div class="token-detail-row">
                            <span class="token-detail-label">Kupon:</span>
                            <div class="token-code" style="background: #f8f9fa; color: #666; cursor: default;">
                                Hesaba tanımlıdır
                            </div>
                        </div>`
                    }
                    <div class="token-detail-row">
                        <span class="token-detail-label">Durum:</span>
                        <span class="token-detail-value">
                            <span class="badge ${token.isProblematic ? 'bg-danger' : (isUsed ? 'bg-warning' : 'bg-success')}">
                                ${token.isProblematic ? '❌ Sorunlu' : (isUsed ? '🔒 Kullanıldı' : '✅ Aktif')}
                            </span>
                        </span>
                    </div>
                </div>
                <div class="token-actions" data-token-index="${index}">
                    <button class="btn btn-success btn-sm login-token-btn" data-token="${token.account_info.replace(/"/g, '&quot;')}">
                        <i class="fas fa-sign-in-alt me-1"></i>Giriş Yap
                    </button>
                    <button class="btn ${isUsed ? 'btn-warning' : 'btn-outline-warning'} btn-sm toggle-token-used" data-token-index="${index}">
                        <i class="fas ${isUsed ? 'fa-undo' : 'fa-check'} me-1"></i>${isUsed ? 'Aktif Yap' : 'Kullanıldı İşaretle'}
                    </button>
                    <button class="btn ${token.isProblematic ? 'btn-danger' : 'btn-outline-danger'} btn-sm toggle-token-problematic" data-token-index="${index}">
                        <i class="fas ${token.isProblematic ? 'fa-undo' : 'fa-exclamation-triangle'} me-1"></i>${token.isProblematic ? 'Aktif Yap' : 'Sorunlu İşaretle'}
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

// Token yönetim paneli event listener'ları
function setupTokenManagementEvents() {
    // Giriş yap butonları
    document.querySelectorAll('.login-token-btn').forEach(button => {
        button.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            const token = this.getAttribute('data-token').replace(/&quot;/g, '"');
            loginWithToken(token);
        });
    });
    
    // Kullanıldı işaretleme butonları
    document.querySelectorAll('.toggle-token-used').forEach(button => {
        button.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            const tokenIndex = this.getAttribute('data-token-index');
            toggleTokenUsedStatus(tokenIndex, this);
        });
    });
    
    // Sorunlu işaretle butonları
    document.querySelectorAll('.toggle-token-problematic').forEach(button => {
        button.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            const tokenIndex = this.getAttribute('data-token-index');
            toggleTokenProblematicStatus(tokenIndex, this);
        });
    });
    
    // Filtreleme butonları
    document.querySelectorAll('.filter-btn').forEach(button => {
        button.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            const filter = this.getAttribute('data-filter');
            applyTokenFilter(filter);
            
            // Aktif buton stilini güncelle
            document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
            this.classList.add('active');
        });
    });
    
    // 🔄 Listeyi Güncelle butonu
    const refreshBtn = document.getElementById('refreshPurchasesBtn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', async function(e) {
            e.preventDefault();
            e.stopPropagation();
            
            // 🎯 PROGRESS POPUP - Liste güncelleme başlangıç
            showProgressPopup('🔄 Hesap listesi güncelleniyor...', 'loading');
            
            // Loading state
            const originalText = refreshBtn.innerHTML;
            refreshBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>Güncelleniyor...';
            refreshBtn.disabled = true;
            
            // API den fresh data çek
            const success = await fetchAndUpdatePurchases();
            
            if (success) {
                // 🎯 PROGRESS POPUP - Güncelleme başarılı
                updateProgressPopup(`✅ Liste güncellendi! ${currentPurchases.length} hesap yüklendi.`, 'success');
                
                // Panel'i kapat ve tekrar aç (güncel data ile)
                closeTokenManagementPanel();
                setTimeout(() => {
                    closeProgressPopup(); // Popup'ı kapat
                    showTokenManagement();
                }, 1500);
            } else {
                // Error state
                closeProgressPopup(); // Popup'ı kapat
                refreshBtn.innerHTML = originalText;
                refreshBtn.disabled = false;
            }
        });
        
        // Hover efektleri ekle
        refreshBtn.addEventListener('mouseenter', function() {
            if (!this.disabled) {
                this.style.background = 'linear-gradient(135deg, #c82333, #a71e2a)';
                this.style.transform = 'translateY(-1px)';
                this.style.boxShadow = '0 4px 8px rgba(220, 53, 69, 0.4)';
            }
        });
        
        refreshBtn.addEventListener('mouseleave', function() {
            if (!this.disabled) {
                this.style.background = 'linear-gradient(135deg, #dc3545, #c82333)';
                this.style.transform = 'translateY(0)';
                this.style.boxShadow = '0 2px 4px rgba(220, 53, 69, 0.3)';
            }
        });
    }
    
    // Kapat butonları
    const closeBtn = document.getElementById('closeTokenPanelBtn');
    const closeFooterBtn = document.getElementById('closeTokenPanelFooterBtn');
    
    if (closeBtn) {
        closeBtn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            closeTokenManagementPanel();
        });
    }
    
    if (closeFooterBtn) {
        closeFooterBtn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            closeTokenManagementPanel();
        });
    }
    
    // Tümünü kopyala butonu
    const copyAllBtn = document.getElementById('copyAllTokensBtn');
    if (copyAllBtn) {
        copyAllBtn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            copyAllTokens();
        });
    }
    
    // Token kopyalama
    document.querySelectorAll('.copy-token-code').forEach(element => {
        element.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            const token = this.getAttribute('data-token').replace(/&quot;/g, '"');
            copyTokenToClipboard(token, this);
        });
    });
    
    // Kupon kopyalama
    document.querySelectorAll('.copy-kupon-code').forEach(element => {
        element.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            const kupon = this.getAttribute('data-kupon').replace(/&quot;/g, '"');
            copyTokenToClipboard(kupon, this);
        });
    });
    
    // Overlay'e tıklayınca kapat
    const overlay = document.getElementById('tokenManagementOverlay');
    if (overlay) {
        overlay.addEventListener('click', function(e) {
            if (e.target === overlay) {
                closeTokenManagementPanel();
            }
        });
    }
}

// Token'ı kopyala
function copyTokenToClipboard(text, element) {
    navigator.clipboard.writeText(text).then(() => {
        // Token mu kupon kodu mu kontrol et
        const isToken = text.length > 20; // Token genellikle uzun, kupon kodu kısa
        const message = isToken ? '🔑 Token Kopyalandı!' : '🎫 Kupon Kodu Kopyalandı!';
        
        showCopyNotification(message, 'success');
        
        // Kısa animasyon - yeşil glow efekti
        element.style.background = '#d4edda';
        element.style.border = '1px solid #28a745';
        element.style.transform = 'scale(1.02)';
        
        setTimeout(() => {
            element.style.background = '';
            element.style.border = '';
            element.style.transform = '';
        }, 600);
        
    }).catch(err => {
        console.error('Kopyalama hatası:', err);
        showCopyNotification('❌ Kopyalama başarısız!', 'error');
        
        // Hata animasyonu - kırmızı glow
        element.style.background = '#f8d7da';
        element.style.border = '1px solid #dc3545';
        setTimeout(() => {
            element.style.background = '';
            element.style.border = '';
        }, 600);
    });
}

// Token ile giriş yap
function loginWithToken(token) {
    console.log('🔑 Token ile giriş yapılıyor:', token);
    
    // Token'ı otomatik olarak "kullanıldı" işaretle
    const tokenItems = document.querySelectorAll('.token-item');
    tokenItems.forEach(item => {
        const tokenCodeElement = item.querySelector('.token-code[data-token]');
        if (tokenCodeElement) {
            const itemToken = tokenCodeElement.getAttribute('data-token').replace(/&quot;/g, '"');
            if (itemToken === token) {
                // Bu token'ı kullanıldı olarak işaretle
                const tokenIndex = item.getAttribute('data-token-index');
                const usedButton = item.querySelector('.toggle-token-used');
                
                if (!item.classList.contains('used') && usedButton) {
                    console.log('🔄 Giriş yapılan token otomatik kullanıldı işaretleniyor:', token.substring(0, 10) + '...');
                    toggleTokenUsedStatus(tokenIndex, usedButton);
                }
            }
        }
    });
    
    // Paneli kapat
    closeTokenManagementPanel();
    
    // Mevcut loginWithAccount fonksiyonunu kullan
    loginWithAccount(token);
}


// Token kullanıldı durumunu değiştir
function toggleTokenUsedStatus(tokenIndex, button) {
    const tokenItem = document.querySelector(`.token-item[data-token-index="${tokenIndex}"]`);
    if (tokenItem) {
        const tokenCode = tokenItem.querySelector('.token-code').getAttribute('data-token').replace(/&quot;/g, '"');
        const isUsed = tokenItem.classList.contains('used');
        
        // Durum badge'ini bul
        const statusBadge = tokenItem.querySelector('.token-detail-value .badge');
        
        if (isUsed) {
            // Aktif yap
            tokenItem.classList.remove('used');
            button.innerHTML = '<i class="fas fa-check me-1"></i>Kullanıldı İşaretle';
            button.classList.remove('btn-warning');
            button.classList.add('btn-outline-warning');
            
            // Durum badge'ini güncelle
            if (statusBadge) {
                statusBadge.className = 'badge bg-success';
                statusBadge.textContent = '✅ Aktif';
            }
            
            // Local storage'dan kaldır
            removeTokenFromUsedList(tokenCode);
            showCopyNotification('✅ Token aktif olarak işaretlendi', 'success');
            
            // Filtre buton sayılarını güncelle
            setTimeout(() => {
                updateFilterButtonCounts();
            }, 100);
            
            // Eğer "Kullanılanları Göster" filtresindeyse, token'ı gizle
            const activeFilter = document.querySelector('.filter-btn.active');
            if (activeFilter && activeFilter.getAttribute('data-filter') === 'used') {
                setTimeout(() => {
                    tokenItem.style.display = 'none';
                }, 300);
            }
        } else {
            // Kullanıldı yap
            tokenItem.classList.add('used');
            button.innerHTML = '<i class="fas fa-undo me-1"></i>Aktif Yap';
            button.classList.remove('btn-outline-warning');
            button.classList.add('btn-warning');
            
            // Durum badge'ini güncelle
            if (statusBadge) {
                statusBadge.className = 'badge bg-warning';
                statusBadge.textContent = '🔒 Kullanıldı';
            }
            
            // Local storage'a ekle
            addTokenToUsedList(tokenCode);
            showCopyNotification('⚪ Token kullanıldı olarak işaretlendi', 'info');
            
            // Filtre buton sayılarını güncelle
            setTimeout(() => {
                updateFilterButtonCounts();
            }, 100);
            
            // Eğer "Aktifleri Göster" filtresindeyse, token'ı gizle
            const activeFilter = document.querySelector('.filter-btn.active');
            if (activeFilter && activeFilter.getAttribute('data-filter') === 'active') {
                setTimeout(() => {
                    tokenItem.style.display = 'none';
                }, 300);
            }
        }
    } else {
        console.error('❌ Token item bulunamadı:', tokenIndex);
    }
}

// Görünen tokenları kopyala (filtreye göre)
function copyAllTokens() {
    const tokenCodes = [];
    
    // Sadece görünen token'ları al
    document.querySelectorAll('.token-item[style*="block"], .token-item:not([style*="none"])').forEach(tokenItem => {
        const tokenCodeElement = tokenItem.querySelector('.token-code[data-token]');
        if (tokenCodeElement) {
            const tokenText = tokenCodeElement.textContent.trim().replace(/📋/g, '').replace(/Token:/g, '').trim();
        if (tokenText) {
            tokenCodes.push(tokenText);
            }
        }
    });
    
    const allTokensText = tokenCodes.join('\n');
    
    navigator.clipboard.writeText(allTokensText).then(() => {
        // Aktif filtreyi al
        const activeFilter = document.querySelector('.filter-btn.active');
        const filterName = activeFilter ? activeFilter.textContent.trim() : 'Tüm';
        
        // Popup mesajı göster
        alert(`📋 ${tokenCodes.length} adet token başarıyla kopyalandı!\n\nFiltre: ${filterName}\n\nPanoya kopyalandı, istediğiniz yere yapıştırabilirsiniz.`);
        
        // Ayrıca küçük bildirim de göster
        showCopyNotification(`📋 ${tokenCodes.length} token kopyalandı!`, 'success');
    }).catch(err => {
        console.error('Toplu kopyalama hatası:', err);
        alert('❌ Kopyalama işlemi başarısız oldu!');
    });
}

// Token yönetim panelini kapat
function closeTokenManagementPanel() {
    const overlay = document.getElementById('tokenManagementOverlay');
    if (overlay) {
        overlay.style.animation = 'fadeOut 0.3s ease-out';
        setTimeout(() => {
            overlay.remove();
        }, 300);
    }
}

// Toplu işlem event listener'ları
function setupBulkActionEvents() {
    // SEÇ butonu - seçim modunu aç/kapat
    const toggleSelectionBtn = document.getElementById('toggleSelectionModeBtn');
    if (toggleSelectionBtn) {
        toggleSelectionBtn.addEventListener('click', function() {
            const selectionControls = document.querySelector('.selection-controls');
            const bulkButtons = document.querySelector('.bulk-buttons');
            const tokenCheckboxContainers = document.querySelectorAll('.token-checkbox');
            
            if (selectionControls.style.display === 'none') {
                // Seçim modunu aç
                selectionControls.style.display = 'flex';
                bulkButtons.style.display = 'flex';
                tokenCheckboxContainers.forEach(container => {
                    container.style.display = 'flex';
                });
                
                this.innerHTML = '<i class="fas fa-times me-2"></i>KAPAT';
                this.classList.remove('btn-outline-primary');
                this.classList.add('btn-danger');
            } else {
                // Seçim modunu kapat
                exitSelectionMode();
            }
        });
    }
    
    // İptal butonu
    const cancelSelectionBtn = document.getElementById('cancelSelectionBtn');
    if (cancelSelectionBtn) {
        cancelSelectionBtn.addEventListener('click', function() {
            exitSelectionMode();
        });
    }
    
    // Tümünü seç checkbox
    const selectAllCheckbox = document.getElementById('selectAllTokens');
    if (selectAllCheckbox) {
        selectAllCheckbox.addEventListener('change', function() {
            const tokenCheckboxes = document.querySelectorAll('.token-select');
            
            tokenCheckboxes.forEach(checkbox => {
                checkbox.checked = this.checked;
            });
            
            updateSelectedCount();
            updateBulkButtonStates();
        });
    }
    
    // Token checkbox'ları
    document.querySelectorAll('.token-select').forEach(checkbox => {
        checkbox.addEventListener('change', function() {
            updateSelectedCount();
            updateBulkButtonStates();
            updateSelectAllState();
        });
    });
    
    // Toplu kullanıldı işaretle
    const bulkMarkUsedBtn = document.getElementById('bulkMarkUsedBtn');
    if (bulkMarkUsedBtn) {
        bulkMarkUsedBtn.addEventListener('click', function() {
            const selectedTokens = getSelectedTokens();
            if (selectedTokens.length > 0) {
                bulkMarkAsUsed(selectedTokens);
            }
        });
    }
    
    // Toplu aktif yap
    const bulkMarkActiveBtn = document.getElementById('bulkMarkActiveBtn');
    if (bulkMarkActiveBtn) {
        bulkMarkActiveBtn.addEventListener('click', function() {
            const selectedTokens = getSelectedTokens();
            if (selectedTokens.length > 0) {
                bulkMarkAsActive(selectedTokens);
            }
        });
    }
    
    // Toplu sorunlu işaretle
    const bulkMarkProblematicBtn = document.getElementById('bulkMarkProblematicBtn');
    if (bulkMarkProblematicBtn) {
        bulkMarkProblematicBtn.addEventListener('click', function() {
            const selectedTokens = getSelectedTokens();
            if (selectedTokens.length > 0) {
                bulkMarkAsProblematic(selectedTokens);
            }
        });
    }
    
}

// Seçili token sayısını güncelle
function updateSelectedCount() {
    const selectedCheckboxes = document.querySelectorAll('.token-select:checked');
    const selectedCountElement = document.getElementById('selectedCount');
    if (selectedCountElement) {
        selectedCountElement.textContent = `${selectedCheckboxes.length} seçili`;
    }
}

// Toplu işlem butonlarının durumunu güncelle
function updateBulkButtonStates() {
    const selectedCheckboxes = document.querySelectorAll('.token-select:checked');
    const hasSelection = selectedCheckboxes.length > 0;
    
    const bulkMarkUsedBtn = document.getElementById('bulkMarkUsedBtn');
    const bulkMarkActiveBtn = document.getElementById('bulkMarkActiveBtn');
    const bulkMarkProblematicBtn = document.getElementById('bulkMarkProblematicBtn');
    
    if (bulkMarkUsedBtn) bulkMarkUsedBtn.disabled = !hasSelection;
    if (bulkMarkActiveBtn) bulkMarkActiveBtn.disabled = !hasSelection;
    if (bulkMarkProblematicBtn) bulkMarkProblematicBtn.disabled = !hasSelection;
}

// Tümünü seç checkbox durumunu güncelle
function updateSelectAllState() {
    const allCheckboxes = document.querySelectorAll('.token-select');
    const checkedCheckboxes = document.querySelectorAll('.token-select:checked');
    const selectAllCheckbox = document.getElementById('selectAllTokens');
    
    if (selectAllCheckbox && allCheckboxes.length > 0) {
        if (checkedCheckboxes.length === allCheckboxes.length) {
            selectAllCheckbox.checked = true;
            selectAllCheckbox.indeterminate = false;
        } else if (checkedCheckboxes.length > 0) {
            selectAllCheckbox.checked = false;
            selectAllCheckbox.indeterminate = true;
        } else {
            selectAllCheckbox.checked = false;
            selectAllCheckbox.indeterminate = false;
        }
    }
}

// Seçili tokenları al
function getSelectedTokens() {
    const selectedCheckboxes = document.querySelectorAll('.token-select:checked');
    return Array.from(selectedCheckboxes).map(checkbox => {
        const tokenIndex = checkbox.getAttribute('data-token-index');
        const tokenItem = document.querySelector(`.token-item[data-token-index="${tokenIndex}"]`);
        const tokenCode = tokenItem.querySelector('.token-code').getAttribute('data-token');
        return {
            index: tokenIndex,
            code: tokenCode.replace(/&quot;/g, '"'),
            element: tokenItem
        };
    });
}

// Toplu kullanıldı işaretle
function bulkMarkAsUsed(selectedTokens) {
    if (confirm(`${selectedTokens.length} adet token'ı kullanıldı olarak işaretlemek istediğinize emin misiniz?`)) {
        selectedTokens.forEach(token => {
            const button = token.element.querySelector('.toggle-token-used');
            if (button && !token.element.classList.contains('used')) {
                toggleTokenUsedStatus(token.index, button);
            }
        });
        
        // Checkbox'ları temizle
        clearAllSelections();
        showCopyNotification(`✅ ${selectedTokens.length} token kullanıldı olarak işaretlendi!`, 'success');
    }
}

// Toplu aktif yap
function bulkMarkAsActive(selectedTokens) {
    if (confirm(`${selectedTokens.length} adet token'ı aktif olarak işaretlemek istediğinize emin misiniz?`)) {
        selectedTokens.forEach(token => {
            // Hem kullanıldı hem de sorunlu durumunu temizle
            const usedButton = token.element.querySelector('.toggle-token-used');
            const problematicButton = token.element.querySelector('.toggle-token-problematic');
            
            // Eğer kullanıldı ise, aktif yap
            if (usedButton && token.element.classList.contains('used')) {
                toggleTokenUsedStatus(token.index, usedButton);
            }
            
            // Eğer sorunlu ise, düzelt (aktif yap)
            if (problematicButton && token.element.classList.contains('problematic')) {
                toggleTokenProblematicStatus(token.index, problematicButton);
            }
        });
        
        // Checkbox'ları temizle
        clearAllSelections();
        showCopyNotification(`✅ ${selectedTokens.length} token aktif olarak işaretlendi!`, 'success');
    }
}


// Tüm seçimleri temizle
function clearAllSelections() {
    const allCheckboxes = document.querySelectorAll('.token-select, #selectAllTokens');
    const tokenCheckboxContainers = document.querySelectorAll('.token-checkbox');
    
    allCheckboxes.forEach(checkbox => {
        checkbox.checked = false;
        checkbox.indeterminate = false;
    });
    
    // Checkbox'ları gizle
    tokenCheckboxContainers.forEach(container => {
        container.style.display = 'none';
    });
    
    updateSelectedCount();
    updateBulkButtonStates();
}

// Filtre butonlarını sayılarla birlikte oluştur
function generateFilterButtonsHTML() {
    // Token sayılarını hesapla - hem DOM'dan hem de global token verilerinden
    const allTokens = document.querySelectorAll('.token-item');
    let activeCount = 0;
    let usedCount = 0;
    let problematicCount = 0;
    
    if (allTokens.length > 0) {
        // DOM'dan hesapla
        allTokens.forEach(item => {
            const isUsed = item.classList.contains('used');
            const isProblematic = item.classList.contains('problematic');
            
            if (isProblematic) {
                problematicCount++;
            } else if (isUsed) {
                usedCount++;
            } else {
                activeCount++;
            }
        });
    } else {
        // DOM henüz hazır değilse, local storage'dan hesapla
        console.log('🔍 DOM henüz hazır değil, local storage\'dan hesaplanıyor...');
        activeCount = 0;
        usedCount = 0;
        problematicCount = 0;
    }
    
    const totalCount = allTokens.length;
    
    console.log('📊 Filtre sayıları hesaplandı:', {
        total: totalCount,
        active: activeCount,
        used: usedCount,
        problematic: problematicCount
    });
    
    return `
        <button class="btn btn-outline-primary btn-sm filter-btn active" data-filter="all">
            <i class="fas fa-list me-1"></i>Hepsini Göster (${totalCount})
        </button>
        <button class="btn btn-outline-success btn-sm filter-btn" data-filter="active">
            <i class="fas fa-check-circle me-1"></i>Aktifleri Göster (${activeCount})
        </button>
        <button class="btn btn-outline-warning btn-sm filter-btn" data-filter="used">
            <i class="fas fa-clock me-1"></i>Kullanılanları Göster (${usedCount})
        </button>
        <button class="btn btn-outline-danger btn-sm filter-btn" data-filter="problematic">
            <i class="fas fa-exclamation-triangle me-1"></i>Sorunluları Göster (${problematicCount})
        </button>
    `;
}

// Filtre butonlarını güncelle (sayıları yenile)
function updateFilterButtonCounts() {
    const filterButtonsContainer = document.getElementById('filterButtonsContainer');
    if (filterButtonsContainer) {
        // Aktif filtreyi sakla
        const activeFilter = document.querySelector('.filter-btn.active');
        const activeFilterType = activeFilter ? activeFilter.getAttribute('data-filter') : 'all';
        
        // Butonları yeniden oluştur
        filterButtonsContainer.innerHTML = generateFilterButtonsHTML();
        
        // Aktif filtreyi geri yükle
        const newActiveButton = document.querySelector(`[data-filter="${activeFilterType}"]`);
        if (newActiveButton) {
            document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
            newActiveButton.classList.add('active');
        }
        
        // Event listener'ları yeniden kur
        setupFilterButtonEvents();
    }
}

// Filtre butonları için event listener'ları kur
function setupFilterButtonEvents() {
    document.querySelectorAll('.filter-btn').forEach(button => {
        button.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            const filter = this.getAttribute('data-filter');
            applyTokenFilter(filter);
            
            // Aktif buton stilini güncelle
            document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
            this.classList.add('active');
        });
    });
}

// Seçim modundan çık
function exitSelectionMode() {
    const toggleSelectionBtn = document.getElementById('toggleSelectionModeBtn');
    const selectionControls = document.querySelector('.selection-controls');
    const bulkButtons = document.querySelector('.bulk-buttons');
    const tokenCheckboxContainers = document.querySelectorAll('.token-checkbox');
    const allCheckboxes = document.querySelectorAll('.token-select, #selectAllTokens');
    
    // Tüm kontrolleri gizle
    if (selectionControls) selectionControls.style.display = 'none';
    if (bulkButtons) bulkButtons.style.display = 'none';
    
    // Checkbox'ları gizle ve temizle
    tokenCheckboxContainers.forEach(container => {
        container.style.display = 'none';
    });
    
    allCheckboxes.forEach(checkbox => {
        checkbox.checked = false;
        checkbox.indeterminate = false;
    });
    
    // SEÇ butonunu eski haline getir
    if (toggleSelectionBtn) {
        toggleSelectionBtn.innerHTML = '<i class="fas fa-filter me-2"></i>SEÇ';
        toggleSelectionBtn.classList.remove('btn-danger');
        toggleSelectionBtn.classList.add('btn-outline-primary');
    }
    
    updateSelectedCount();
    updateBulkButtonStates();
}

// Token sorunlu durumunu değiştir
function toggleTokenProblematicStatus(tokenIndex, button) {
    const tokenItem = document.querySelector(`.token-item[data-token-index="${tokenIndex}"]`);
    if (tokenItem) {
        const tokenCode = tokenItem.querySelector('.token-code').getAttribute('data-token');
        const isProblematic = tokenItem.classList.contains('problematic');
        
        // Durum badge'ini bul
        const statusBadge = tokenItem.querySelector('.token-detail-value .badge');
        
        if (isProblematic) {
            // Düzelt
            tokenItem.classList.remove('problematic');
            button.innerHTML = '<i class="fas fa-exclamation-triangle me-1"></i>Sorunlu İşaretle';
            button.classList.remove('btn-danger');
            button.classList.add('btn-outline-danger');
            
            // Durum badge'ini güncelle - kullanıldı mı kontrol et
            const isUsed = tokenItem.classList.contains('used');
            if (statusBadge) {
                statusBadge.className = isUsed ? 'badge bg-warning' : 'badge bg-success';
                statusBadge.textContent = isUsed ? '🔒 Kullanıldı' : '✅ Aktif';
            }
            
            // Local storage'dan kaldır
            removeTokenFromProblematicList(tokenCode.replace(/&quot;/g, '"'));
            showCopyNotification('✅ Token düzeltildi!', 'success');
            
            // Filtre buton sayılarını güncelle
            setTimeout(() => {
                updateFilterButtonCounts();
            }, 100);
            
            // Aktif filtre kontrolü - sorunlu durumdan çıktığında gizle
            const activeFilter = document.querySelector('.filter-btn.active');
            if (activeFilter) {
                const currentFilter = activeFilter.getAttribute('data-filter');
                // Sorunluları gösteriyorsak gizle, çünkü artık sorunlu değil
                if (currentFilter === 'problematic') {
                    setTimeout(() => {
                        tokenItem.style.display = 'none';
                    }, 300);
                }
                // Eğer kullanıldı durumunda ve "aktifleri göster"deyse, göster
                else if (currentFilter === 'active' && !isUsed) {
                    tokenItem.style.display = 'block';
                }
                // Eğer kullanıldı durumunda ve "kullanılanları göster"deyse, göster  
                else if (currentFilter === 'used' && isUsed) {
                    tokenItem.style.display = 'block';
                }
            }
        } else {
            // Sorunlu yap
            tokenItem.classList.add('problematic');
            button.innerHTML = '<i class="fas fa-undo me-1"></i>Düzelt';
            button.classList.remove('btn-outline-danger');
            button.classList.add('btn-danger');
            
            // Durum badge'ini güncelle
            if (statusBadge) {
                statusBadge.className = 'badge bg-danger';
                statusBadge.textContent = '❌ Sorunlu';
            }
            
            // Local storage'a ekle
            addTokenToProblematicList(tokenCode.replace(/&quot;/g, '"'));
            showCopyNotification('⚠️ Token sorunlu olarak işaretlendi!', 'warning');
            
            // Filtre buton sayılarını güncelle
            setTimeout(() => {
                updateFilterButtonCounts();
            }, 100);
            
            // Eğer "Aktifleri" veya "Kullanılanları" gösteriyorsak, token'ı gizle
            const activeFilter = document.querySelector('.filter-btn.active');
            if (activeFilter) {
                const currentFilter = activeFilter.getAttribute('data-filter');
                if (currentFilter === 'active' || currentFilter === 'used') {
                    setTimeout(() => {
                        tokenItem.style.display = 'none';
                    }, 300);
                }
            }
        }
    } else {
        console.error('❌ Token item bulunamadı:', tokenIndex);
    }
}

// Toplu sorunlu işaretle
function bulkMarkAsProblematic(selectedTokens) {
    if (confirm(`${selectedTokens.length} adet token'ı sorunlu olarak işaretlemek istediğinize emin misiniz?`)) {
        selectedTokens.forEach(token => {
            const button = token.element.querySelector('.toggle-token-problematic');
            if (button && !token.element.classList.contains('problematic')) {
                toggleTokenProblematicStatus(token.index, button);
            }
        });
        
        // Checkbox'ları temizle
        clearAllSelections();
        showCopyNotification(`⚠️ ${selectedTokens.length} token sorunlu olarak işaretlendi!`, 'warning');
    }
}

// Token filtreleme
function applyTokenFilter(filter) {
    const tokenItems = document.querySelectorAll('.token-item');
    
    tokenItems.forEach(item => {
        const isUsed = item.classList.contains('used');
        const isProblematic = item.classList.contains('problematic');
        let shouldShow = false;
        
        // Debug: Token durumlarını logla
        const tokenIndex = item.getAttribute('data-token-index');
        console.log(`🔍 Token ${tokenIndex} Durumu:`, {
            isUsed: isUsed,
            isProblematic: isProblematic,
            filter: filter,
            classes: item.className
        });
        
        switch(filter) {
            case 'all':
                shouldShow = true;
                break;
            case 'active':
                shouldShow = !isUsed && !isProblematic;
                break;
            case 'used':
                shouldShow = isUsed && !isProblematic;
                break;
            case 'problematic':
                shouldShow = isProblematic;
                break;
        }
        
        console.log(`📊 Token ${tokenIndex} Gösterilecek mi:`, shouldShow);
        item.style.display = shouldShow ? 'block' : 'none';
        
        // Butonları filtreye göre güncelle
        if (shouldShow) {
            updateTokenButtonsForFilter(item, filter);
        }
    });
    
    // Görünen token sayısını güncelle
    const visibleTokens = document.querySelectorAll('.token-item[style*="block"], .token-item:not([style*="none"])');
    console.log(`📊 Filtre uygulandı: ${filter}, Görünen: ${visibleTokens.length} token`);
}

// Token butonlarını filtreye göre güncelle
function updateTokenButtonsForFilter(tokenItem, filter) {
    const tokenIndex = tokenItem.getAttribute('data-token-index');
    const usedButton = tokenItem.querySelector('.toggle-token-used');
    const problematicButton = tokenItem.querySelector('.toggle-token-problematic');
    
    const isUsed = tokenItem.classList.contains('used');
    const isProblematic = tokenItem.classList.contains('problematic');
    
    switch(filter) {
        case 'used':
            // Kullanılanları gösterirken sadece "Aktif Yap" butonu
            if (usedButton) {
                usedButton.innerHTML = '<i class="fas fa-undo me-1"></i>Aktif Yap';
                usedButton.className = 'btn btn-success btn-sm toggle-token-used';
            }
            if (problematicButton) {
                problematicButton.style.display = 'none';
            }
            break;
            
        case 'problematic':
            // Sorunluları gösterirken sadece "Aktif Yap" butonu
            if (problematicButton) {
                problematicButton.innerHTML = '<i class="fas fa-undo me-1"></i>Aktif Yap';
                problematicButton.className = 'btn btn-success btn-sm toggle-token-problematic';
            }
            if (usedButton) {
                usedButton.style.display = 'none';
            }
            break;
            
        default:
            // Diğer filtrelerde normal butonlar
            if (usedButton) {
                usedButton.style.display = 'inline-block';
                usedButton.innerHTML = `<i class="fas ${isUsed ? 'fa-undo' : 'fa-check'} me-1"></i>${isUsed ? 'Aktif Yap' : 'Kullanıldı İşaretle'}`;
                usedButton.className = `btn ${isUsed ? 'btn-warning' : 'btn-outline-warning'} btn-sm toggle-token-used`;
            }
            if (problematicButton) {
                problematicButton.style.display = 'inline-block';
                problematicButton.innerHTML = `<i class="fas ${isProblematic ? 'fa-undo' : 'fa-exclamation-triangle'} me-1"></i>${isProblematic ? 'Aktif Yap' : 'Sorunlu İşaretle'}`;
                problematicButton.className = `btn ${isProblematic ? 'btn-danger' : 'btn-outline-danger'} btn-sm toggle-token-problematic`;
            }
            break;
    }
}

// Sorunlu token listesi yönetimi
function addTokenToProblematicList(tokenCode) {
    chrome.storage.local.get(['problematic_tokens'], function(result) {
        const problematicTokens = result.problematic_tokens || [];
        if (!problematicTokens.includes(tokenCode)) {
            problematicTokens.push(tokenCode);
            chrome.storage.local.set({ 'problematic_tokens': problematicTokens }, function() {
                console.log('⚠️ Token sorunlu listesine eklendi:', tokenCode);
            });
        }
    });
}

function removeTokenFromProblematicList(tokenCode) {
    chrome.storage.local.get(['problematic_tokens'], function(result) {
        const problematicTokens = result.problematic_tokens || [];
        const filteredTokens = problematicTokens.filter(token => token !== tokenCode);
        chrome.storage.local.set({ 'problematic_tokens': filteredTokens }, function() {
            console.log('✅ Token sorunlu listesinden kaldırıldı:', tokenCode);
        });
    });
}

// 🔍 TOKEN DURUMLARINI FİLTRELE VE UYGULA
async function filterAndApplyTokenStates(tokens) {
    // Local storage'dan durumları al
    const usedTokens = await new Promise(resolve => {
        chrome.storage.local.get(['used_tokens'], result => {
            resolve(result.used_tokens || []);
        });
    });
    
    const deletedTokens = await new Promise(resolve => {
        chrome.storage.local.get(['deleted_tokens'], result => {
            resolve(result.deleted_tokens || []);
        });
    });
    
    const problematicTokens = await new Promise(resolve => {
        chrome.storage.local.get(['problematic_tokens'], result => {
            resolve(result.problematic_tokens || []);
        });
    });
    
    // Silinen tokenları filtrele
    const filteredTokens = tokens.filter(token => {
        return !deletedTokens.includes(token.account_info);
    });
    
    // Durumları işaretle
    filteredTokens.forEach(token => {
        token.isUsed = usedTokens.includes(token.account_info);
        token.isProblematic = problematicTokens.includes(token.account_info);
    });
    
    console.log('🔍 Token durumları uygulandı:', {
        total: tokens.length,
        filtered: filteredTokens.length,
        deleted: deletedTokens.length,
        used: usedTokens.length,
        problematic: problematicTokens.length
    });
    
    return filteredTokens;
}

// 💾 LOCAL STORAGE TOKEN YÖNETİMİ
function addTokenToUsedList(tokenCode) {
    chrome.storage.local.get(['used_tokens'], function(result) {
        const usedTokens = result.used_tokens || [];
        if (!usedTokens.includes(tokenCode)) {
            usedTokens.push(tokenCode);
            chrome.storage.local.set({ 'used_tokens': usedTokens }, function() {
                console.log('💾 Token kullanıldı listesine eklendi:', tokenCode);
            });
        }
    });
}

function removeTokenFromUsedList(tokenCode) {
    chrome.storage.local.get(['used_tokens'], function(result) {
        const usedTokens = result.used_tokens || [];
        const filteredTokens = usedTokens.filter(token => token !== tokenCode);
        chrome.storage.local.set({ 'used_tokens': filteredTokens }, function() {
            console.log('💾 Token kullanıldı listesinden kaldırıldı:', tokenCode);
        });
    });
}

function addTokenToDeletedList(tokenCode) {
    chrome.storage.local.get(['deleted_tokens'], function(result) {
        const deletedTokens = result.deleted_tokens || [];
        if (!deletedTokens.includes(tokenCode)) {
            deletedTokens.push(tokenCode);
            chrome.storage.local.set({ 'deleted_tokens': deletedTokens }, function() {
                console.log('💾 Token silinen listesine eklendi:', tokenCode);
            });
        }
    });
}

function isTokenUsed(tokenCode) {
    return new Promise((resolve) => {
        chrome.storage.local.get(['used_tokens'], function(result) {
            const usedTokens = result.used_tokens || [];
            resolve(usedTokens.includes(tokenCode));
        });
    });
}

function isTokenDeleted(tokenCode) {
    return new Promise((resolve) => {
        chrome.storage.local.get(['deleted_tokens'], function(result) {
            const deletedTokens = result.deleted_tokens || [];
            resolve(deletedTokens.includes(tokenCode));
        });
    });
}

// Purchase event listeners setup
function setupPurchaseEventListeners() {
    // Hesap bilgisi kopyalama
    document.querySelectorAll('.copy-account-info').forEach(element => {
        element.addEventListener('click', function() {
            const text = this.getAttribute('data-text').replace(/&quot;/g, '"');
            copyToClipboard(text);
        });
    });
    
    // Kupon kodu kopyalama  
    document.querySelectorAll('.copy-kupon-info').forEach(element => {
        element.addEventListener('click', function() {
            const text = this.getAttribute('data-text').replace(/&quot;/g, '"');
            copyToClipboard(text);
        });
    });
    
    // Giriş yap butonları
    document.querySelectorAll('.login-with-account').forEach(button => {
        button.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            const accountInfo = this.getAttribute('data-account').replace(/&quot;/g, '"');
            loginWithAccount(accountInfo);
        });
    });
    
    
    // Kullanıldı işaretleme butonları
    document.querySelectorAll('.toggle-used').forEach(button => {
        button.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            const accountId = this.getAttribute('data-account-id');
            toggleUsedStatus(accountId, this);
        });
    });
}

// Hesap ile giriş yap
function loginWithAccount(accountInfo) {
    try {
        console.log('🔑 Hesap bilgisi token alanına yapıştırılıyor:', accountInfo);
        
        // Popup'tayız - pages/login.html'e yönlendir ve token'ı kaydet
        if (window.location.href.includes('popup.html') || !document.getElementById('token')) {
            console.log('🔄 Popup\'tan login.html\'e yönlendiriliyor...');
            
            // Token'ı storage'a geçici olarak kaydet
            chrome.storage.local.set({ 'temp_auto_login_token': accountInfo }, function() {
                // Login sayfasını aç
                chrome.tabs.create({ url: 'pages/login.html' }, function(tab) {
                    console.log('✅ Login sayfası açıldı, token kaydedildi:', accountInfo.substring(0, 10) + '...');
                    showCopyNotification('Giriş sayfası açılıyor...');
                });
            });
            
        } else {
            // Zaten login.html'deyiz - token'ı yerleştir ve MRB/MRD kontrolleri yap
            console.log('📝 Login sayfasında token yerleştiriliyor ve kontroller başlatılıyor...');
            
            const tokenInput = document.getElementById('token');
            if (tokenInput) {
                tokenInput.value = accountInfo;
                
                // MRB ve MRD token kontrolü yap
                const isMrbToken = accountInfo && accountInfo.startsWith('MRB-');
                const isMrdToken = accountInfo && accountInfo.startsWith('MRD-');
                console.log('🎯 Token kontrolü:', { isMrbToken, isMrdToken, token: accountInfo });
                
                // Pending kupon var mı kontrol et
                chrome.storage.local.get(['pending_coupon'], function(result) {
                    const pendingCoupon = result.pending_coupon;
                    
                    if (isMrbToken) {
                        console.log('🎯 MRB Token tespit edildi! Normal giriş işlemini başlatıyorum...');
                        // MRB- token için tüm kontrolleri çalıştır (campaigns yönlendirmesi için)
                        const loginForm = document.getElementById('TokenGirisForm');
                        if (loginForm) {
                            const event = new Event('submit', { bubbles: true, cancelable: true });
                            loginForm.dispatchEvent(event);
                            
                            if (pendingCoupon) {
                                showCopyNotification(`MRB Token + Kupon (${pendingCoupon.substring(0, 8)}...) - Adres kontrolleri başlatıldı!`);
                            } else {
                                showCopyNotification('MRB Token - Adres kontrolleri başlatıldı!');
                            }
                        }
                    } else if (isMrdToken) {
                        console.log('🎯 MRD Token tespit edildi! Normal giriş işlemini başlatıyorum...');
                        // MRD- token için tüm kontrolleri çalıştır
                        const loginForm = document.getElementById('TokenGirisForm');
                        if (loginForm) {
                            const event = new Event('submit', { bubbles: true, cancelable: true });
                            loginForm.dispatchEvent(event);
                            
                            if (pendingCoupon) {
                                showCopyNotification(`MRD Token + Kupon (${pendingCoupon.substring(0, 8)}...) - Adres kontrolleri başlatıldı!`);
                            } else {
                                showCopyNotification('MRD Token - Adres kontrolleri başlatıldı!');
                            }
                        }
                    } else {
                        // Normal token - sadece yerleştir, kullanıcı manuel giriş yapsın
                        tokenInput.focus();
                        tokenInput.select();
                        
                        if (pendingCoupon) {
                            showCopyNotification(`Token + Kupon (${pendingCoupon.substring(0, 8)}...) hazır! Manuel giriş yapabilirsiniz.`);
                        } else {
                            showCopyNotification('Token yapıştırıldı! Manuel giriş yapabilirsiniz.');
                        }
                    }
                });
            }
        }
        
    } catch (error) {
        console.error('Login with account error:', error);
        showApiError('Token yapıştırırken hata oluştu!');
    }
}

// Kullanıldı durumu toggle
function toggleUsedStatus(accountId, button) {
    try {
        // Local storage'dan mevcut used durumlarını al
        const usedAccounts = JSON.parse(localStorage.getItem('usedAccounts') || '{}');
        
        // Durumu toggle et
        const isUsed = usedAccounts[accountId] || false;
        usedAccounts[accountId] = !isUsed;
        
        // Local storage'a kaydet
        localStorage.setItem('usedAccounts', JSON.stringify(usedAccounts));
        
        // Button durumunu güncelle
        const purchaseItem = button.closest('.purchase-item');
        if (!isUsed) {
            // Kullanıldı olarak işaretle
            button.innerHTML = '<i class="fas fa-check me-1"></i>Kullanıldı';
            button.classList.remove('btn-outline-secondary');
            button.classList.add('btn-secondary');
            purchaseItem.classList.add('used');
        } else {
            // Kullanılmadı olarak işaretle
            button.innerHTML = '<i class="fas fa-check me-1"></i>Kullanıldı Olarak İşaretle';
            button.classList.remove('btn-secondary');
            button.classList.add('btn-outline-secondary');
            purchaseItem.classList.remove('used');
        }
        
        showCopyNotification(isUsed ? 'Kullanılmadı olarak işaretlendi' : 'Kullanıldı olarak işaretlendi');
        
    } catch (error) {
        console.error('Toggle used status error:', error);
        showApiError('Durum güncellenirken hata oluştu!');
    }
}

// Mevcut used durumlarını restore et
function restoreUsedStatuses() {
    try {
        const usedAccounts = JSON.parse(localStorage.getItem('usedAccounts') || '{}');
        
        document.querySelectorAll('.toggle-used').forEach(button => {
            const accountId = button.getAttribute('data-account-id');
            const isUsed = usedAccounts[accountId] || false;
            
            if (isUsed) {
                const purchaseItem = button.closest('.purchase-item');
                button.innerHTML = '<i class="fas fa-check me-1"></i>Kullanıldı';
                button.classList.remove('btn-outline-secondary');
                button.classList.add('btn-secondary');
                purchaseItem.classList.add('used');
            }
        });
        
    } catch (error) {
        console.error('Restore used statuses error:', error);
    }
}

/**
 * Kategoriler HTML'ini oluştur
 */
function generateCategoriesHTML() {
    return currentCategories.map(category => {
        const isAvailable = category.available_count > 0;
        const canAfford = currentUser && parseFloat(currentUser.balance.replace(',', '.')) >= category.price_raw;
        const isLimited = category.is_limited || false;
        const limitReached = category.limit_reached || false;
        const remainingLimit = category.remaining_limit || 0;
        
        // Satın alma durumu kontrolü
        let canPurchase = isAvailable && canAfford;
        let buttonText = 'Satın Al';
        let statusText = isAvailable ? '✅ Stok Var' : '❌ Stok Yok';
        
        if (isLimited && limitReached) {
            canPurchase = false;
            buttonText = 'Günlük Limit Doldu';
            statusText = '⏰ Limit Doldu';
        } else if (!canAfford) {
            buttonText = 'Yetersiz Bakiye';
        } else if (!isAvailable) {
            buttonText = 'Stok Yok';
        }
        
        // Maksimum miktar belirleme
        let maxQuantity = 100;
        if (isLimited && remainingLimit > 0) {
            maxQuantity = Math.min(maxQuantity, remainingLimit);
        } else if (isLimited && limitReached) {
            maxQuantity = 0;
        }
        
        return `
            <div class="category-card ${canPurchase ? 'available' : 'unavailable'}">
                <div class="category-header">
                    <div class="category-title">${category.title}</div>
                    <span class="category-stock ${canPurchase ? 'available' : 'unavailable'}">
                        ${statusText}
                    </span>
                    ${isLimited ? `
                        <div class="category-limit-info">
                            <small class="text-muted">
                                <i class="fas fa-clock me-1"></i>
                                Günlük Limit: ${limitReached ? 
                                    '<span class="text-danger">Doldu!</span>' : 
                                    `<span class="text-success">${remainingLimit} adet kaldı</span>`
                                }
                            </small>
                        </div>
                    ` : ''}
                </div>
                
                <div class="category-price">${category.price} ₺</div>
                
                <div class="category-quantity">
                    <label>Miktar:</label>
                    <input type="number" class="quantity-input" 
                           data-category-id="${category.id}" 
                           value="1" 
                           min="1" 
                           max="${maxQuantity}"
                           ${maxQuantity === 0 ? 'disabled' : ''}>
                    ${isLimited ? `
                        <small class="text-muted d-block mt-1">
                            Max: ${maxQuantity} adet
                        </small>
                    ` : ''}
                </div>
                
                <button class="category-purchase-btn ${canPurchase ? 'available' : 'unavailable'}" 
                        ${canPurchase ? '' : 'disabled'}
                        data-category-id="${category.id}"
                        data-category-title="${category.title}"
                        data-category-price="${category.price_raw}"
                        data-max-quantity="${maxQuantity}">
                    <i class="fas fa-shopping-cart me-2"></i>
                    ${buttonText}
                </button>
            </div>
        `;
    }).join('');
}

/**
 * Kategori modal event listener'ları
 */
function setupCategoriesModalEvents() {
    // Kapat butonları
    const closeBtn = document.getElementById('closeCategoriesPanelBtn');
    const closeFooterBtn = document.getElementById('closeCategoriesFooterBtn');
    
    [closeBtn, closeFooterBtn].forEach(btn => {
        if (btn) {
            btn.addEventListener('click', closeCategoriesModal);
        }
    });
    
    // Overlay'e tıklayınca kapat
    const overlay = document.getElementById('categoriesModalOverlay');
    if (overlay) {
        overlay.addEventListener('click', function(e) {
            if (e.target === overlay) {
                closeCategoriesModal();
            }
        });
    }
    
    // Satın alma butonları
    document.querySelectorAll('.category-purchase-btn').forEach(button => {
        button.addEventListener('click', function(e) {
            e.preventDefault();
            
            const categoryId = this.getAttribute('data-category-id');
            const categoryTitle = this.getAttribute('data-category-title');
            const categoryPrice = parseFloat(this.getAttribute('data-category-price'));
            
            // Seçilen miktarı al
            const quantityInput = document.querySelector(`.quantity-input[data-category-id="${categoryId}"]`);
            let quantity = parseInt(quantityInput ? quantityInput.value : 1);
            const maxQuantity = parseInt(this.getAttribute('data-max-quantity') || 100);
            
            // Miktar doğrulama
            if (isNaN(quantity) || quantity < 1) {
                quantity = 1;
                if (quantityInput) quantityInput.value = 1;
                showApiError('Geçersiz miktar! Minimum 1 adet olmalıdır.');
                return;
            }
            
            // Günlük limit kontrolü
            if (quantity > maxQuantity) {
                if (maxQuantity === 0) {
                    showApiError('Günlük alım limitiniz dolmuştur! Yarın tekrar deneyiniz.');
                    return;
                } else {
                    quantity = maxQuantity;
                    if (quantityInput) quantityInput.value = maxQuantity;
                    showApiError(`Günlük limit aşıldı! En fazla ${maxQuantity} adet alabilirsiniz.`);
                    return;
                }
            }
            
            if (quantity > 100) {
                quantity = 100;
                if (quantityInput) quantityInput.value = 100;
                showApiError('Maksimum 100 adet satın alabilirsiniz!');
                return;
            }
            
            // Modal'ı kapat ve satın almayı başlat
            closeCategoriesModal();
            purchaseProduct(categoryId, categoryTitle, categoryPrice, quantity);
        });
    });
}

/**
 * Kategori modal'ını kapat
 */
function closeCategoriesModal() {
    const overlay = document.getElementById('categoriesModalOverlay');
    if (overlay) {
        overlay.style.animation = 'fadeOut 0.3s ease-out';
        setTimeout(() => {
            overlay.remove();
        }, 300);
    }
}

// ============ ADRES ARAMA VE ÖZEL ETİKET SİSTEMİ ============

// Özel adres etiketlerini localStorage'dan al
function getCustomAddressLabels() {
    try {
        const stored = localStorage.getItem('ys_custom_address_labels');
        return stored ? JSON.parse(stored) : [];
    } catch (e) {
        return [];
    }
}

// Özel adres etiketini kaydet
function saveCustomAddressLabel(label) {
    if (!label || !label.trim()) return;
    
    const trimmedLabel = label.trim();
    const customLabels = getCustomAddressLabels();
    
    // Varsayılan etiketler
    const defaultLabels = ['Ev', 'İş', 'Yazlık'];
    
    // Zaten varsa ekleme
    if (defaultLabels.includes(trimmedLabel) || customLabels.includes(trimmedLabel)) {
        return;
    }
    
    customLabels.push(trimmedLabel);
    localStorage.setItem('ys_custom_address_labels', JSON.stringify(customLabels));
    
    // Datalist'i güncelle
    updateAddressLabelDatalist();
    
    console.log('📍 Özel etiket kaydedildi:', trimmedLabel);
}

// Datalist'i güncelle
function updateAddressLabelDatalist() {
    const datalist = document.getElementById('adresEtiketleriDatalist');
    if (!datalist) return;
    
    const defaultLabels = ['Ev', 'İş', 'Yazlık'];
    const customLabels = getCustomAddressLabels();
    const allLabels = [...defaultLabels, ...customLabels];
    
    // Datalist'i temizle ve yeniden doldur
    datalist.innerHTML = '';
    allLabels.forEach(label => {
        const option = document.createElement('option');
        option.value = label;
        datalist.appendChild(option);
    });
}

// Adres listesinde arama fonksiyonu
function initAddressSearch() {
    const searchInput = document.getElementById('adresAramaInput');
    if (!searchInput) {
        console.warn('Adres arama input bulunamadı');
        return;
    }
    
    searchInput.addEventListener('input', function() {
        const searchTerm = this.value.toLowerCase().trim();
        const addressCards = document.querySelectorAll('#adresListesi .adres-card');
        
        let visibleCount = 0;
        let hiddenCount = 0;
        
        addressCards.forEach(card => {
            const cardText = card.textContent.toLowerCase();
            
            if (!searchTerm || cardText.includes(searchTerm)) {
                card.style.display = '';
                card.style.opacity = '1';
                card.style.transform = 'scale(1)';
                card.style.transition = 'all 0.2s ease';
                visibleCount++;
            } else {
                card.style.display = 'none';
                card.style.opacity = '0';
                card.style.transform = 'scale(0.95)';
                hiddenCount++;
            }
        });
        
        console.log(`📍 Arama: "${searchTerm}" - Görünen: ${visibleCount}, Gizli: ${hiddenCount}`);
        
        // Sonuç bulunamadı mesajı
        const container = document.getElementById('adresListesi');
        let noResultMsg = container.querySelector('.ys-no-result-message');
        
        if (hiddenCount > 0 && visibleCount === 0) {
            if (!noResultMsg) {
                noResultMsg = document.createElement('div');
                noResultMsg.className = 'ys-no-result-message';
                noResultMsg.style.cssText = `
                    padding: 32px;
                    text-align: center;
                    color: #96a0b5;
                    font-size: 14px;
                `;
                noResultMsg.innerHTML = `
                    <div style="font-size: 48px; margin-bottom: 16px;">🔍</div>
                    <div style="font-weight: 600; margin-bottom: 8px; color: #e6e9f0;">Adres bulunamadı</div>
                    <div>Farklı bir etiket ile arama yapın</div>
                `;
                container.appendChild(noResultMsg);
            }
        } else if (noResultMsg) {
            noResultMsg.remove();
        }
    });
    
    console.log('✅ Adres arama sistemi aktif');
}

// Adres etiketi input'una change event ekle
function initAddressLabelTracking() {
    const labelInput = document.getElementById('adresEtiketiInput');
    if (!labelInput) {
        console.warn('Adres etiketi input bulunamadı');
        return;
    }
    
    // Input değiştiğinde kaydet
    labelInput.addEventListener('change', function() {
        const newLabel = this.value.trim();
        if (newLabel && newLabel !== 'Ev' && newLabel !== 'İş' && newLabel !== 'Yazlık') {
            saveCustomAddressLabel(newLabel);
        }
    });
    
    // Sayfa yüklendiğinde datalist'i güncelle
    updateAddressLabelDatalist();
    
    console.log('✅ Adres etiketi takip sistemi aktif');
}

// Adres popup açıldığında sistemleri başlat
const originalAdresPopupAc = window.tumAdresleriGetir;
if (typeof originalAdresPopupAc === 'function') {
    window.tumAdresleriGetir = function() {
        originalAdresPopupAc.apply(this, arguments);
        setTimeout(() => {
            initAddressSearch();
            initAddressLabelTracking();
        }, 500);
    };
}

// Sayfa yüklendiğinde sistemleri başlat
document.addEventListener('DOMContentLoaded', function() {
    checkForUpdatesOnLoad();
    setTimeout(() => {
        initAddressSearch();
        initAddressLabelTracking();
        updateAddressLabelDatalist();
    }, 1000);
});

// Adres yönetimi butonu tıklandığında da başlat
const adresYonetimiButon = document.getElementById('AdresYonetimiButon');
if (adresYonetimiButon) {
    adresYonetimiButon.addEventListener('click', function() {
        setTimeout(() => {
            initAddressSearch();
            initAddressLabelTracking();
            updateAddressLabelDatalist();
        }, 300);
    });
}

function isNewerVersion(remote, current) {
    const parse = v => v.split('.').map(Number);
    const r = parse(remote);
    const c = parse(current);
    for (let i = 0; i < Math.max(r.length, c.length); i++) {
        const rv = r[i] || 0;
        const cv = c[i] || 0;
        if (rv > cv) return true;
        if (rv < cv) return false;
    }
    return false;
}

async function checkForUpdatesOnLoad() {
    try {
        const MANIFEST_VERSION = chrome.runtime.getManifest().version;
        const res = await fetch('https://kuponmarket.net/api/version', {
            method: 'GET',
            headers: {
                'X-Token': 'xeudL5BmAl7TRxs5tHPTPcJtTxtvc6e5eh5R0FEGbRIJSDEe',
                'X-Version': MANIFEST_VERSION,
                'X-Requested': 'YSNew'
            }
        });
        if (!res.ok) return;
        const data = await res.json();
        if (data?.version && data?.extension_url && isNewerVersion(data.version, MANIFEST_VERSION)) {
            showUpdatePopup({
                version: data.version,
                description: data.description || data.changelog || 'Yeni sürüm mevcut. Güncellemek için aşağıdaki butona tıklayın.',
                update_url: data.extension_url,
                is_mandatory: data.force_update === true
            });
        }
    } catch (_) {}
}

function escapeHtml(text) {
    return String(text ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function showUpdatePopup(updateData) {
    let overlay = document.getElementById('update-overlay');
    if (overlay) overlay.remove();

    const safeVersion = escapeHtml(updateData.version);
    const safeDescription = escapeHtml(updateData.description || 'Yeni sürüm mevcut.');
    const safeUrl = String(updateData.update_url || '').replace(/"/g, '');

    overlay = document.createElement('div');
    overlay.id = 'update-overlay';
    overlay.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
        background: rgba(0,0,0,0.75); display: flex; align-items: center;
        justify-content: center; z-index: 99999; opacity: 0;
        transition: opacity 0.3s ease;
    `;
    overlay.innerHTML = `
        <div style="background:#1a1a2e;border-radius:16px;padding:2rem;max-width:420px;width:90%;
                    box-shadow:0 20px 60px rgba(0,0,0,0.5);text-align:center;border:1px solid #333;">
            <div style="width:60px;height:60px;background:linear-gradient(135deg,#667eea,#764ba2);
                        border-radius:50%;display:flex;align-items:center;justify-content:center;
                        margin:0 auto 1rem;">
                <i class="fas fa-download" style="color:#fff;font-size:1.5rem;"></i>
            </div>
            <span style="background:#667eea;color:#fff;border-radius:20px;padding:3px 12px;
                         font-size:0.75rem;font-weight:600;">v${safeVersion}</span>
            <h3 style="color:#fff;margin:1rem 0 0.5rem;font-size:1.2rem;">Güncelleme Mevcut</h3>
            <p style="color:#aaa;font-size:0.875rem;margin-bottom:1.5rem;text-align:left;white-space:pre-wrap;line-height:1.45;max-height:220px;overflow:auto;">${safeDescription}</p>
            <div style="display:flex;gap:0.75rem;justify-content:center;flex-wrap:wrap;">
                ${!updateData.is_mandatory ? `<button id="update-later-btn"
                    style="padding:0.6rem 1.2rem;border-radius:8px;border:1px solid #555;
                           background:transparent;color:#aaa;cursor:pointer;font-size:0.875rem;">
                    Sonra
                </button>` : ''}
                ${safeUrl ? `<a href="${safeUrl}" target="_blank" id="update-download-btn"
                    style="padding:0.6rem 1.4rem;border-radius:8px;border:none;
                           background:linear-gradient(135deg,#667eea,#764ba2);color:#fff;
                           cursor:pointer;font-size:0.875rem;text-decoration:none;
                           display:inline-flex;align-items:center;gap:0.4rem;">
                    <i class="fas fa-download"></i> Güncelle
                </a>` : ''}
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => { overlay.style.opacity = '1'; });

    const close = () => {
        overlay.style.opacity = '0';
        setTimeout(() => overlay.remove(), 300);
    };

    const laterBtn = overlay.querySelector('#update-later-btn');
    if (laterBtn) laterBtn.addEventListener('click', close);

    const dlBtn = overlay.querySelector('#update-download-btn');
    if (dlBtn) dlBtn.addEventListener('click', close);

    if (!updateData.is_mandatory) {
        overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    }
}

chrome.runtime.onMessage.addListener((request) => {
    if (request.action === 'updateAvailable') {
        showUpdatePopup({
            version: request.version,
            description: request.description || request.changelog || 'Yeni sürüm mevcut. Güncellemek için aşağıdaki butona tıklayın.',
            update_url: request.url,
            is_mandatory: request.force_update === true
        });
    }
});

console.log('✅ Adres Özelleştirme Sistemi Yüklendi');
