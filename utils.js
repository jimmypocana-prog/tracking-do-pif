/**
 * utils.js — Utilitas UI, Ikon SVG Vektor, Kompresi Foto HP, Validasi GPS Wajib, & Format Data
 * Program: Tracking Delivery Order - PIF
 */

var ICONS = {
  truck: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 17h4V5H2v12h3"/><path d="M20 17h2v-3.34a4 4 0 0 0-1.17-2.83L19 9h-5"/><circle cx="7.5" cy="17.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/></svg>',
  dashboard: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/></svg>',
  box: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>',
  mapPin: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>',
  fileText: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/></svg>',
  users: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  building: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4"/><path d="M8 6h.01"/><path d="M16 6h.01"/><path d="M12 6h.01"/><path d="M12 10h.01"/><path d="M12 14h.01"/><path d="M16 10h.01"/><path d="M16 14h.01"/><path d="M8 10h.01"/><path d="M8 14h.01"/></svg>',
  menu: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/></svg>',
  plus: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
  refresh: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>',
  camera: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg>',
  check: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
  x: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
  alert: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  download: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
  phone: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>',
  settings: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
  logout: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>',
  eye: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>',
  edit: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>',
  redo: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 2.7"/></svg>'
};

function escapeHtml(str) {
  return String(str === null || str === undefined ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getTodayYMD() {
  var d = new Date();
  var yyyy = d.getFullYear();
  var mm = String(d.getMonth() + 1).padStart(2, '0');
  var dd = String(d.getDate()).padStart(2, '0');
  return yyyy + '-' + mm + '-' + dd;
}

function formatDateID(ymd) {
  if (!ymd) {
    return '-';
  }
  var clean = String(ymd).substring(0, 10);
  var parts = clean.split('-');
  if (parts.length !== 3) {
    return escapeHtml(ymd);
  }
  var months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  var mIdx = parseInt(parts[1], 10) - 1;
  var mName = months[mIdx] || parts[1];
  return parts[2] + ' ' + mName + ' ' + parts[0];
}

function formatDateTimeID(iso) {
  if (!iso) {
    return '-';
  }
  var d = new Date(iso);
  if (isNaN(d.getTime())) {
    return escapeHtml(iso);
  }
  var dd = String(d.getDate()).padStart(2, '0');
  var months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  var mm = months[d.getMonth()];
  var yyyy = d.getFullYear();
  var hh = String(d.getHours()).padStart(2, '0');
  var mi = String(d.getMinutes()).padStart(2, '0');
  return dd + ' ' + mm + ' ' + yyyy + ', ' + hh + ':' + mi;
}

function formatDuration(startIso, endIso) {
  if (!startIso || !endIso) {
    return '-';
  }
  var t1 = new Date(startIso).getTime();
  var t2 = new Date(endIso).getTime();
  if (isNaN(t1) || isNaN(t2) || t2 < t1) {
    return '-';
  }
  var diffMin = Math.round((t2 - t1) / 60000);
  if (diffMin < 60) {
    return diffMin + ' menit';
  }
  var hours = Math.floor(diffMin / 60);
  var mins = diffMin % 60;
  return hours + ' jam ' + mins + ' mnt';
}

function getStatusBadgeHtml(status) {
  var st = String(status || '').trim();
  var cls = 'badge-siap';
  if (st === 'Dalam Perjalanan') {
    cls = 'badge-jalan';
  } else if (st === 'Check-In Customer') {
    cls = 'badge-checkin';
  } else if (st === 'Selesai') {
    cls = 'badge-selesai';
  } else if (st === 'Gagal Kirim') {
    cls = 'badge-gagal';
  }
  return '<span class="badge ' + cls + '">' + escapeHtml(st) + '</span>';
}

function buildGoogleMapsUrl(lat, lng) {
  if (lat === null || lat === undefined || lng === null || lng === undefined || lat === '' || lng === '') {
    return '';
  }
  return 'https://www.google.com/maps?q=' + encodeURIComponent(String(lat) + ',' + String(lng));
}

function buildWhatsAppUrl(phone, text) {
  var digits = String(phone || '').replace(/[^0-9]/g, '');
  if (!digits) {
    return '';
  }
  if (digits.indexOf('0') === 0) {
    digits = '62' + digits.substring(1);
  } else if (digits.indexOf('8') === 0) {
    digits = '62' + digits;
  }
  var base = 'https://wa.me/' + digits;
  if (text) {
    return base + '?text=' + encodeURIComponent(text);
  }
  return base;
}

function compressImageFile(file, maxDim, quality) {
  return new Promise(function (resolve, reject) {
    if (!file) {
      reject(new Error('File foto tidak ditemukan.'));
      return;
    }
    var reader = new FileReader();
    reader.onerror = function () {
      reject(new Error('Gagal membaca file foto.'));
    };
    reader.onload = function (ev) {
      var img = new Image();
      img.onerror = function () {
        reject(new Error('Format gambar tidak didukung browser.'));
      };
      img.onload = function () {
        var width = img.width;
        var height = img.height;
        var limit = maxDim || PIF_CONFIG.IMAGE_MAX_DIM;

        if (width > height && width > limit) {
          height = Math.round((height * limit) / width);
          width = limit;
        } else if (height >= width && height > limit) {
          width = Math.round((width * limit) / height);
          height = limit;
        }

        var canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        var ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        var dataUrl = canvas.toDataURL('image/jpeg', quality || PIF_CONFIG.IMAGE_QUALITY);
        resolve(dataUrl);
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  });
}

function requestMandatoryGps() {
  return new Promise(function (resolve, reject) {
    if (window.isSecureContext === false) {
      reject(new Error('Akses GPS diblokir karena alamat web bukan HTTPS yang aman.'));
      return;
    }
    if (!navigator.geolocation) {
      reject(new Error('Perangkat atau aplikasi ini tidak mendukung GPS (Geolocation).'));
      return;
    }

    function handleSuccess(pos) {
      var lat = pos.coords.latitude;
      var lng = pos.coords.longitude;
      var accuracy = pos.coords.accuracy;
      if (!isFinite(lat) || !isFinite(lng) || (lat === 0 && lng === 0)) {
        reject(new Error('Koordinat GPS belum akurat. Nyalakan GPS perangkat lalu coba lagi.'));
        return;
      }
      resolve({
        lat: Number(lat.toFixed(7)),
        lng: Number(lng.toFixed(7)),
        accuracy: Math.round(accuracy || 0)
      });
    }

    function buildPermissionDeniedMessage(err) {
      var hasApkBridge = Boolean(window.AndroidApp && typeof window.AndroidApp.isAndroidApk === 'function');
      if (hasApkBridge) {
        return 'Izin lokasi ditolak di HP! Ketuk "Buka Setelan Izin APK" -> Izin -> Lokasi -> pilih "Izinkan saat aplikasi digunakan", dan pastikan GPS HP menyala.';
      }
      var raw = err && err.message ? ' (' + err.message + ')' : '';
      return 'Izin lokasi ditolak' + raw + '. Jika memakai APK lama, pembungkus APK tidak mendukung GPS; gunakan APK resmi terbaru atau buka lewat Chrome HP & pilih Izinkan Lokasi.';
    }

    navigator.geolocation.getCurrentPosition(
      handleSuccess,
      function (err) {
        if (err && err.code === 1) {
          reject(new Error(buildPermissionDeniedMessage(err)));
          return;
        }
        // Fallback akurasi jaringan bila sinyal satelit GPS lemah (mis. di dalam gudang)
        navigator.geolocation.getCurrentPosition(
          handleSuccess,
          function (err2) {
            var msg = 'Gagal mengambil lokasi GPS.';
            if (err2 && err2.code === 1) {
              msg = buildPermissionDeniedMessage(err2);
            } else if (err2 && err2.code === 2) {
              msg = 'Sinyal GPS tidak ditemukan. Pastikan Lokasi (GPS) di HP sudah menyala.';
            } else if (err2 && err2.code === 3) {
              msg = 'Waktu tunggu sinyal GPS habis. Coba bergerak ke area terbuka lalu tekan Ambil GPS Ulang.';
            }
            reject(new Error(msg));
          },
          {
            enableHighAccuracy: false,
            timeout: 12000,
            maximumAge: 15000
          }
        );
      },
      {
        enableHighAccuracy: true,
        timeout: 12000,
        maximumAge: 0
      }
    );
  });
}

function showToast(message, type) {
  var root = document.getElementById('toast-root');
  if (!root) {
    return;
  }
  var el = document.createElement('div');
  el.className = 'toast-item ' + (type || 'info');
  el.textContent = message;
  root.appendChild(el);
  setTimeout(function () {
    if (el.parentNode) {
      el.parentNode.removeChild(el);
    }
  }, 4200);
}

