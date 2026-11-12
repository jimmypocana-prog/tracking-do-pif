/**
 * app.js — Aplikasi SPA Tracking Delivery Order - PIF
 * Standar ZettBOT: Modular, Tanpa Nested Template Literals, In-Memory Cache, Mobile-First & Desktop Responsive
 */

var STATE = {
  session: getSavedSession(),
  currentPage: 'dashboard',
  dropdowns: { drivers: [], customers: [], mobils: [] },

  autoSyncTimer: null,
  inFlightSync: false,
  lastSyncTime: '',
  lastSyncTickMs: 0,
  lastSnapshots: {},

  dashboardStats: null,
  dashboardRecent: [],

  orders: {
    items: [],
    total: 0,
    page: 1,
    limit: 12,
    totalPages: 1,
    filters: { search: '', status: '', dateFrom: '', dateTo: '', driverId: '', customerId: '' }
  },

  tracking: {
    activeTab: 'Siap Pick Up',
    items: [],
    total: 0,
    page: 1,
    limit: 20,
    totalPages: 1,
    search: '',
    selectedIds: {}
  },

  karyawan: {
    items: [],
    total: 0,
    page: 1,
    limit: 12,
    totalPages: 1,
    filters: { search: '', divisi: '', status: '' }
  },

  customer: {
    items: [],
    total: 0,
    page: 1,
    limit: 12,
    totalPages: 1,
    filters: { search: '', status: '' }
  },

  mobil: {
    items: [],
    total: 0,
    page: 1,
    limit: 12,
    totalPages: 1,
    filters: { search: '', status: '' }
  },

  report: {
    items: [],
    total: 0,
    page: 1,
    limit: 15,
    totalPages: 1,
    summary: { total: 0, siapPickUp: 0, dalamProses: 0, selesai: 0, gagalKirim: 0, redeliveryCount: 0 },
    filters: { dateFrom: '', dateTo: '', driverId: '', customerId: '', status: '', search: '' }
  },

  modalPhotos: [],
  modalTargetIds: [],
  modalGps: null,
  modalGpsLoading: false,
  modalGpsError: ''
};

var AUTO_SYNC_INTERVAL_MS = 15000;

window.onSessionExpired = function () {
  stopAutoSyncLoop();
  STATE.session = null;
  STATE.lastSnapshots = {};
  STATE.lastSyncTime = '';
  STATE.inFlightSync = false;
  closeModal();
  renderApp();
  showToast('Sesi login telah berakhir. Silakan masuk kembali.', 'warning');
};

document.addEventListener('DOMContentLoaded', function () {
  if (STATE.session && STATE.session.user) {
    STATE.currentPage = STATE.session.user.divisi === 'Driver' ? 'tracking-driver' : 'dashboard';
    renderApp();
    loadActivePageData(false);
    startAutoSyncLoop();
  } else {
    renderApp();
  }

  document.addEventListener('click', function (ev) {
    var wrap = document.getElementById('overflow-menu-wrap');
    var dropdown = document.getElementById('overflow-dropdown');
    if (wrap && dropdown && !wrap.contains(ev.target)) {
      dropdown.classList.remove('open');
    }
  });

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) {
      triggerVisibilityOrFocusSync();
    }
  });

  window.addEventListener('focus', function () {
    triggerVisibilityOrFocusSync();
  });
});

// ============================================================================
// AUTO-SYNC ENGINE (STALE-WHILE-REVALIDATE + SMART SILENT POLLING 15 DETIK)
// ============================================================================

function hasCacheEntry(cacheKey) {
  return Boolean(typeof MEMORY_CACHE !== 'undefined' && cacheKey && Object.prototype.hasOwnProperty.call(MEMORY_CACHE, cacheKey));
}

function formatTimeNowHMS() {
  var d = new Date();
  var hh = String(d.getHours()).padStart(2, '0');
  var mm = String(d.getMinutes()).padStart(2, '0');
  var ss = String(d.getSeconds()).padStart(2, '0');
  return hh + ':' + mm + ':' + ss;
}

function renderSyncStatusBadge() {
  var label = STATE.inFlightSync
    ? 'Menyinkronkan...'
    : (STATE.lastSyncTime ? 'Auto-Update · ' + STATE.lastSyncTime : 'Auto-Update Aktif');
  return (
    '<div id="sync-pill" class="sync-pill ' + (STATE.inFlightSync ? 'syncing' : '') + '" title="Data otomatis diperbarui setiap 15 detik dan saat berpindah menu">' +
      '<span class="sync-dot"></span>' +
      '<span id="sync-status-label">' + escapeHtml(label) + '</span>' +
    '</div>'
  );
}

function setSyncVisualState(isSyncing, markUpdated) {
  STATE.inFlightSync = Boolean(isSyncing);
  if (markUpdated) {
    STATE.lastSyncTime = formatTimeNowHMS();
    STATE.lastSyncTickMs = Date.now();
  }
  var pill = document.getElementById('sync-pill');
  var lbl = document.getElementById('sync-status-label');
  if (pill) {
    if (STATE.inFlightSync) {
      pill.classList.add('syncing');
    } else {
      pill.classList.remove('syncing');
    }
  }
  if (lbl) {
    lbl.textContent = STATE.inFlightSync
      ? 'Menyinkronkan...'
      : (STATE.lastSyncTime ? 'Auto-Update · ' + STATE.lastSyncTime : 'Auto-Update Aktif');
  }
}

function isUiBusyForBackgroundSync() {
  var modalRoot = document.getElementById('modal-root');
  if (modalRoot && modalRoot.innerHTML.trim() !== '') {
    return true;
  }
  var dropdown = document.getElementById('overflow-dropdown');
  if (dropdown && dropdown.classList.contains('open')) {
    return true;
  }
  var activeEl = document.activeElement;
  if (activeEl) {
    var tag = activeEl.tagName;
    if (tag === 'TEXTAREA' || tag === 'SELECT') {
      return true;
    }
    if (tag === 'INPUT') {
      var inputType = String(activeEl.type || '').toLowerCase();
      if (inputType !== 'checkbox' && inputType !== 'radio' && inputType !== 'button' && inputType !== 'submit') {
        return true;
      }
    }
  }
  var ordSearch = document.getElementById('ord-filter-search');
  if (ordSearch && ordSearch.value.trim() !== STATE.orders.filters.search) {
    return true;
  }
  var drvSearch = document.getElementById('drv-search-input');
  if (drvSearch && drvSearch.value.trim() !== STATE.tracking.search) {
    return true;
  }
  var krySearch = document.getElementById('kry-search');
  if (krySearch && krySearch.value.trim() !== STATE.karyawan.filters.search) {
    return true;
  }
  var cstSearch = document.getElementById('cst-search');
  if (cstSearch && cstSearch.value.trim() !== STATE.customer.filters.search) {
    return true;
  }
  var mblSearch = document.getElementById('mbl-search');
  if (mblSearch && mblSearch.value.trim() !== STATE.mobil.filters.search) {
    return true;
  }
  var repSearch = document.getElementById('rep-search');
  if (repSearch && repSearch.value.trim() !== STATE.report.filters.search) {
    return true;
  }
  return false;
}

function startAutoSyncLoop() {
  stopAutoSyncLoop();
  STATE.autoSyncTimer = setInterval(function () {
    runSilentBackgroundSync();
  }, AUTO_SYNC_INTERVAL_MS);
}

function stopAutoSyncLoop() {
  if (STATE.autoSyncTimer) {
    clearInterval(STATE.autoSyncTimer);
    STATE.autoSyncTimer = null;
  }
}

function triggerVisibilityOrFocusSync() {
  if (!STATE.session || !STATE.session.user) {
    return;
  }
  if (Date.now() - (STATE.lastSyncTickMs || 0) < 3000) {
    return;
  }
  runSilentBackgroundSync();
}

function runSilentBackgroundSync() {
  if (!STATE.session || !STATE.session.user) {
    return;
  }
  if (document.hidden || STATE.inFlightSync) {
    return;
  }
  if (isUiBusyForBackgroundSync()) {
    return;
  }
  loadActivePageData(true, { silent: true });
}

// ============================================================================
// NAVIGASI & RENDER SHELL
// ============================================================================

function navigateTo(pageName) {
  STATE.currentPage = pageName;
  STATE.tracking.selectedIds = {};
  var dropdown = document.getElementById('overflow-dropdown');
  if (dropdown) {
    dropdown.classList.remove('open');
  }
  renderApp();
  loadActivePageData(false);
}

function toggleOverflowMenu(ev) {
  if (ev) {
    ev.stopPropagation();
  }
  var dropdown = document.getElementById('overflow-dropdown');
  if (dropdown) {
    dropdown.classList.toggle('open');
  }
}

function renderApp() {
  var root = document.getElementById('app-root');
  if (!STATE.session || !STATE.session.user) {
    root.innerHTML = renderLoginView();
    bindLoginEvents();
    return;
  }

  var user = STATE.session.user;
  var isBackOffice = user.divisi === 'Back Office';

  var navPrimary = '';
  var overflowItems = '';

  if (isBackOffice) {
    navPrimary =
      '<button type="button" class="nav-btn ' + (STATE.currentPage === 'dashboard' ? 'active' : '') + '" onclick="navigateTo(\'dashboard\')">' + ICONS.dashboard + '<span>Dashboard</span></button>' +
      '<button type="button" class="nav-btn ' + (STATE.currentPage === 'orders' ? 'active' : '') + '" onclick="navigateTo(\'orders\')">' + ICONS.box + '<span>Delivery Order - PIF</span></button>' +
      '<button type="button" class="nav-btn desktop-only-nav ' + (STATE.currentPage === 'monitor' ? 'active' : '') + '" onclick="navigateTo(\'monitor\')">' + ICONS.mapPin + '<span>Tracking</span></button>' +
      '<button type="button" class="nav-btn desktop-only-nav ' + (STATE.currentPage === 'report' ? 'active' : '') + '" onclick="navigateTo(\'report\')">' + ICONS.fileText + '<span>Laporan</span></button>';

    overflowItems =
      '<button type="button" class="dropdown-item mobile-only-nav ' + (STATE.currentPage === 'monitor' ? 'active' : '') + '" onclick="navigateTo(\'monitor\')">' + ICONS.mapPin + '<span>Tracking Monitor</span></button>' +
      '<button type="button" class="dropdown-item mobile-only-nav ' + (STATE.currentPage === 'report' ? 'active' : '') + '" onclick="navigateTo(\'report\')">' + ICONS.fileText + '<span>Laporan Delivery</span></button>' +
      '<button type="button" class="dropdown-item ' + (STATE.currentPage === 'karyawan' ? 'active' : '') + '" onclick="navigateTo(\'karyawan\')">' + ICONS.users + '<span>Master Karyawan</span></button>' +
      '<button type="button" class="dropdown-item ' + (STATE.currentPage === 'customer' ? 'active' : '') + '" onclick="navigateTo(\'customer\')">' + ICONS.building + '<span>Master Customer</span></button>' +
      '<button type="button" class="dropdown-item ' + (STATE.currentPage === 'mobil' ? 'active' : '') + '" onclick="navigateTo(\'mobil\')">' + ICONS.truck + '<span>Master Mobil</span></button>' +
      '<button type="button" class="dropdown-item" onclick="openApiSettingsModal()">' + ICONS.settings + '<span>Pengaturan Server API</span></button>' +
      '<button type="button" class="dropdown-item danger" onclick="handleLogout()">' + ICONS.logout + '<span>Keluar</span></button>';
  } else {
    navPrimary =
      '<button type="button" class="nav-btn ' + (STATE.currentPage === 'tracking-driver' ? 'active' : '') + '" onclick="navigateTo(\'tracking-driver\')">' + ICONS.truck + '<span>Tracking Driver</span></button>' +
      '<button type="button" class="nav-btn ' + (STATE.currentPage === 'dashboard' ? 'active' : '') + '" onclick="navigateTo(\'dashboard\')">' + ICONS.dashboard + '<span>Ringkasan</span></button>';

    overflowItems =
      '<button type="button" class="dropdown-item" onclick="openApiSettingsModal()">' + ICONS.settings + '<span>Pengaturan Server API</span></button>' +
      '<button type="button" class="dropdown-item danger" onclick="handleLogout()">' + ICONS.logout + '<span>Keluar</span></button>';
  }

  var pageBody = '';
  if (STATE.currentPage === 'dashboard') {
    pageBody = renderDashboardView();
  } else if (STATE.currentPage === 'orders') {
    pageBody = renderOrdersView();
  } else if (STATE.currentPage === 'monitor') {
    pageBody = renderMonitorView();
  } else if (STATE.currentPage === 'tracking-driver') {
    pageBody = renderDriverTrackingView();
  } else if (STATE.currentPage === 'karyawan') {
    pageBody = renderKaryawanView();
  } else if (STATE.currentPage === 'customer') {
    pageBody = renderCustomerView();
  } else if (STATE.currentPage === 'mobil') {
    pageBody = renderMobilView();
  } else if (STATE.currentPage === 'report') {
    pageBody = renderReportView();
  }

  root.innerHTML =
    '<div class="app-shell">' +
      '<header class="topbar">' +
        '<div class="topbar-inner">' +
          '<div class="brand-wrap">' +
            '<div class="brand-mark">' + ICONS.truck + '</div>' +
            '<div class="brand-text">' +
              '<div class="brand-title">Tracking Delivery Order - PIF</div>' +
              '<div class="brand-subtitle">' + escapeHtml(user.namaKaryawan) + ' · ' + escapeHtml(user.divisi) + '</div>' +
            '</div>' +
          '</div>' +
          '<nav class="nav-wrap">' +
            navPrimary +
            '<div id="overflow-menu-wrap" class="overflow-menu-wrap">' +
              '<button type="button" class="nav-btn" onclick="toggleOverflowMenu(event)">' + ICONS.menu + '<span>Lainnya</span></button>' +
              '<div id="overflow-dropdown" class="overflow-dropdown">' +
                '<div class="dropdown-user-info">' +
                  '<div class="dropdown-user-name">' + escapeHtml(user.namaKaryawan) + '</div>' +
                  '<div class="dropdown-user-role">Divisi ' + escapeHtml(user.divisi) + ' (' + escapeHtml(user.idKaryawan) + ')</div>' +
                '</div>' +
                overflowItems +
              '</div>' +
            '</div>' +
          '</nav>' +
        '</div>' +
      '</header>' +
      '<main class="main-content" id="page-container">' + pageBody + '</main>' +
    '</div>';
}

function loadActivePageData(forceRefresh, fetchOpts) {
  if (!STATE.session || !STATE.session.user) {
    return;
  }
  var p = STATE.currentPage;
  var opts = fetchOpts || {};

  if (p === 'dashboard') {
    fetchDashboardData(forceRefresh, opts);
  } else if (p === 'orders' || p === 'monitor') {
    ensureDropdownsLoaded(forceRefresh, opts).then(function () {
      fetchOrdersData(forceRefresh, opts);
    });
  } else if (p === 'tracking-driver') {
    fetchDriverTrackingData(forceRefresh, opts);
  } else if (p === 'karyawan') {
    fetchKaryawanData(forceRefresh, opts);
  } else if (p === 'customer') {
    fetchCustomerData(forceRefresh, opts);
  } else if (p === 'mobil') {
    fetchMobilData(forceRefresh, opts);
  } else if (p === 'report') {
    ensureDropdownsLoaded(forceRefresh, opts).then(function () {
      fetchReportData(forceRefresh, opts);
    });
  }
}

function ensureDropdownsLoaded(forceRefresh, fetchOpts) {
  var servedFromCache = !forceRefresh && hasCacheEntry('dropdowns');
  return callGasApi('getMasterDropdowns', {}, {
    cacheKey: 'dropdowns',
    forceRefresh: Boolean(forceRefresh)
  }).then(function (data) {
    var normalized = data || { drivers: [], customers: [], mobils: [] };
    if (!normalized.mobils) {
      normalized.mobils = [];
    }
    var snap = JSON.stringify(normalized);
    var changed = STATE.lastSnapshots.dropdowns !== snap;
    STATE.dropdowns = normalized;
    STATE.lastSnapshots.dropdowns = snap;
    if (servedFromCache && !(fetchOpts && fetchOpts.silent)) {
      callGasApi('getMasterDropdowns', {}, {
        cacheKey: 'dropdowns',
        forceRefresh: true
      }).then(function (fresh) {
        var normFresh = fresh || { drivers: [], customers: [], mobils: [] };
        if (!normFresh.mobils) {
          normFresh.mobils = [];
        }
        var freshSnap = JSON.stringify(normFresh);
        if (STATE.lastSnapshots.dropdowns !== freshSnap) {
          STATE.dropdowns = normFresh;
          STATE.lastSnapshots.dropdowns = freshSnap;
          if (!isUiBusyForBackgroundSync() && (STATE.currentPage === 'orders' || STATE.currentPage === 'monitor' || STATE.currentPage === 'report')) {
            renderApp();
          }
        }
      }).catch(function () {});
    } else if (changed && fetchOpts && fetchOpts.silent && !isUiBusyForBackgroundSync()) {
      if (STATE.currentPage === 'orders' || STATE.currentPage === 'monitor' || STATE.currentPage === 'report') {
        renderApp();
      }
    }
  }).catch(function () {
    if (!STATE.dropdowns) {
      STATE.dropdowns = { drivers: [], customers: [], mobils: [] };
    }
  });
}

// ============================================================================
// LOGIN & PENGATURAN API
// ============================================================================

function renderLoginView() {
  var currentUrl = getApiUrl();
  var apiNotice = currentUrl
    ? '<div class="alert-box alert-info" style="margin-bottom:14px">Terhubung ke Server Backend GAS. Siap masuk menggunakan akun Master Karyawan.</div>'
    : '<div class="alert-box alert-warning" style="margin-bottom:14px">URL Server Backend GAS belum dipasang. Klik tombol <strong>Pengaturan Server API</strong> di bawah untuk menempel URL Web App (/exec).</div>';

  return (
    '<div class="login-shell">' +
      '<div class="login-card">' +
        '<div style="display:flex;align-items:center;gap:12px;margin-bottom:18px">' +
          '<div class="brand-mark" style="width:42px;height:42px">' + ICONS.truck + '</div>' +
          '<div>' +
            '<h1 style="margin:0;font-size:18px;font-weight:800;color:var(--text-primary)">Tracking Delivery Order - PIF</h1>' +
            '<div style="font-size:12.5px;color:var(--text-muted)">Masuk dengan akun karyawan Back Office atau Driver</div>' +
          '</div>' +
        '</div>' +
        apiNotice +
        '<form id="login-form" style="display:flex;flex-direction:column;gap:13px">' +
          '<div class="form-group">' +
            '<label class="form-label" for="login-username">Username <span class="req">*</span></label>' +
            '<input id="login-username" class="form-control" type="text" placeholder="Contoh: backoffice atau driver1" autocomplete="username" required />' +
          '</div>' +
          '<div class="form-group">' +
            '<label class="form-label" for="login-password">Password / PIN <span class="req">*</span></label>' +
            '<input id="login-password" class="form-control" type="password" placeholder="Masukkan password" autocomplete="current-password" required />' +
          '</div>' +
          '<button id="login-submit-btn" type="submit" class="btn btn-navy" style="width:100%;padding:11px">Masuk ke Aplikasi</button>' +
        '</form>' +
        '<div style="margin-top:16px;padding-top:14px;border-top:1px solid var(--border-color);display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">' +
          '<button type="button" class="btn btn-secondary btn-sm" onclick="openApiSettingsModal()">' + ICONS.settings + '<span>Pengaturan Server API</span></button>' +
          '<span class="form-hint">Akun awal setup: backoffice / driver1</span>' +
        '</div>' +
      '</div>' +
    '</div>'
  );
}

function bindLoginEvents() {
  var form = document.getElementById('login-form');
  if (!form) {
    return;
  }
  form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    var username = document.getElementById('login-username').value.trim();
    var password = document.getElementById('login-password').value;
    var btn = document.getElementById('login-submit-btn');

    if (!getApiUrl()) {
      showToast('Isi URL Server Backend GAS terlebih dahulu.', 'warning');
      openApiSettingsModal();
      return;
    }

    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span><span>Memverifikasi...</span>';

    callGasApi('login', { username: username, password: password })
      .then(function (data) {
        clearApiCache();
        STATE.lastSnapshots = {};
        STATE.lastSyncTime = '';
        STATE.session = data;
        saveSession(data);
        STATE.currentPage = data.user.divisi === 'Driver' ? 'tracking-driver' : 'dashboard';
        renderApp();
        loadActivePageData(true);
        startAutoSyncLoop();
        showToast('Selamat datang, ' + data.user.namaKaryawan + '!', 'success');
      })
      .catch(function (err) {
        showToast(err.message, 'error');
      })
      .finally(function () {
        var b = document.getElementById('login-submit-btn');
        if (b) {
          b.disabled = false;
          b.textContent = 'Masuk ke Aplikasi';
        }
      });
  });
}

function handleLogout() {
  stopAutoSyncLoop();
  callGasApi('logout', {}).catch(function () {});
  saveSession(null);
  clearApiCache();
  STATE.session = null;
  STATE.lastSnapshots = {};
  STATE.lastSyncTime = '';
  STATE.inFlightSync = false;
  renderApp();
  showToast('Anda telah keluar dari aplikasi.', 'info');
}

function openApiSettingsModal() {
  var currentUrl = getApiUrl();
  var html =
    '<div class="modal-header">' +
      '<h3 class="modal-title">Pengaturan Koneksi Backend Google Apps Script</h3>' +
      '<button type="button" class="modal-close" onclick="closeModal()">' + ICONS.x + '</button>' +
    '</div>' +
    '<div class="modal-body">' +
      '<div class="alert-box alert-info">' +
        'Tempel URL Web App hasil Deploy dari Google Apps Script (berakhiran <code>/exec</code>). Anda juga dapat menanamkannya permanen di file <code>config.js</code>.' +
      '</div>' +
      '<div class="form-group">' +
        '<label class="form-label" for="api-url-input">URL Web App Google Apps Script</label>' +
        '<input id="api-url-input" class="form-control" type="url" value="' + escapeHtml(currentUrl) + '" placeholder="https://script.google.com/macros/s/.../exec" />' +
      '</div>' +
    '</div>' +
    '<div class="modal-footer">' +
      '<button type="button" class="btn btn-secondary" onclick="closeModal()">Tutup</button>' +
      '<button type="button" class="btn btn-secondary" onclick="testApiConnection()">Uji Koneksi</button>' +
      '<button type="button" class="btn btn-primary" onclick="saveApiSettings()">Simpan URL</button>' +
    '</div>';
  openModal(html);
}

function saveApiSettings() {
  var val = document.getElementById('api-url-input').value.trim();
  if (val && val.indexOf('https://') !== 0) {
    showToast('URL Web App harus dimulai dengan https://', 'warning');
    return;
  }
  setApiUrl(val);
  clearApiCache();
  STATE.lastSnapshots = {};
  closeModal();
  renderApp();
  showToast('URL Server API berhasil disimpan.', 'success');
}

function testApiConnection() {
  var val = document.getElementById('api-url-input').value.trim();
  if (!val) {
    showToast('Masukkan URL terlebih dahulu.', 'warning');
    return;
  }
  setApiUrl(val);
  callGasApi('ping', {})
    .then(function (data) {
      showToast('Koneksi berhasil! Terhubung ke: ' + (data.app || 'Backend GAS'), 'success');
    })
    .catch(function (err) {
      showToast('Koneksi gagal: ' + err.message, 'error');
    });
}

// ============================================================================
// DASHBOARD
// ============================================================================

function fetchDashboardData(forceRefresh, fetchOpts) {
  var silent = Boolean(fetchOpts && fetchOpts.silent);
  var servedFromCache = !forceRefresh && hasCacheEntry('dashboard_stats') && hasCacheEntry('dashboard_recent');
  if (!servedFromCache) {
    setSyncVisualState(true, false);
  }

  var p1 = callGasApi('getDashboardStats', {}, {
    cacheKey: 'dashboard_stats',
    forceRefresh: Boolean(forceRefresh)
  });
  var p2 = callGasApi('listDeliveryOrders', { page: 1, limit: 6 }, {
    cacheKey: 'dashboard_recent',
    forceRefresh: Boolean(forceRefresh)
  });

  Promise.all([p1, p2])
    .then(function (res) {
      var stats = res[0];
      var recent = (res[1] && res[1].items) ? res[1].items : [];
      var snap = JSON.stringify({ stats: stats, recent: recent });
      var changed = STATE.lastSnapshots.dashboard !== snap;

      STATE.dashboardStats = stats;
      STATE.dashboardRecent = recent;
      STATE.lastSnapshots.dashboard = snap;

      setSyncVisualState(false, !servedFromCache || Boolean(forceRefresh));

      if (STATE.currentPage === 'dashboard' && (changed || (!silent && !servedFromCache))) {
        renderApp();
      }
      if (servedFromCache && !silent) {
        fetchDashboardData(true, { silent: true });
      }
    })
    .catch(function (err) {
      setSyncVisualState(false, false);
      if (!silent) {
        showToast(err.message, 'error');
      }
    });
}

function renderDashboardView() {
  var user = STATE.session.user;
  var isBackOffice = user.divisi === 'Back Office';
  var st = STATE.dashboardStats || { total: 0, hariIni: 0, siapPickUp: 0, dalamPerjalanan: 0, checkIn: 0, selesai: 0, gagalKirim: 0 };

  var metricsHtml =
    '<div class="metrics-grid">' +
      renderMetricCard('Total Delivery Order', st.total, '#eff6ff', '#1d4ed8', ICONS.box) +
      renderMetricCard('DO Hari Ini', st.hariIni, '#f1f5f9', '#0f172a', ICONS.fileText) +
      renderMetricCard('Siap Pick Up', st.siapPickUp, '#f1f5f9', '#334155', ICONS.truck) +
      renderMetricCard('Dalam Perjalanan', st.dalamPerjalanan, '#fffbeb', '#b45309', ICONS.truck) +
      renderMetricCard('Check-In Customer', st.checkIn, '#eef2ff', '#4338ca', ICONS.mapPin) +
      renderMetricCard('Selesai Terkirim', st.selesai, '#ecfdf5', '#047857', ICONS.check) +
    '</div>';

  var failedAlert = st.gagalKirim > 0
    ? '<div class="alert-box alert-danger" style="margin-bottom:16px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">' +
        '<span>Terdapat <strong>' + st.gagalKirim + '</strong> Delivery Order berstatus <strong>Gagal Kirim</strong>.</span>' +
        (isBackOffice
          ? '<button type="button" class="btn btn-outline-danger btn-sm" onclick="openFailedFilterOrders()">Lihat & Kirim Ulang</button>'
          : '<button type="button" class="btn btn-outline-danger btn-sm" onclick="STATE.tracking.activeTab=\'Gagal Kirim\';navigateTo(\'tracking-driver\')">Lihat Daftar</button>') +
      '</div>'
    : '';

  var recentRows = '';
  if (!STATE.dashboardRecent.length) {
    recentRows = '<tr><td colspan="6" class="empty-state">Belum ada Delivery Order tercatat.</td></tr>';
  } else {
    for (var i = 0; i < STATE.dashboardRecent.length; i++) {
      var d = STATE.dashboardRecent[i];
      var mobilText = d.platMobil
        ? (d.platMobil + (d.jenisMobil ? ' · ' + d.jenisMobil : ''))
        : 'Mobil belum tercatat';
      recentRows +=
        '<tr>' +
          '<td><div class="cell-strong">' + escapeHtml(d.idTracking) + '</div><div class="cell-sub">' + formatDateID(d.tanggalDO) + '</div></td>' +
          '<td><div class="cell-strong">' + escapeHtml(d.nomorDO) + '</div>' + (d.percobaanKe > 1 ? '<div class="cell-sub">Kirim Ulang #' + d.percobaanKe + '</div>' : '') + '</td>' +
          '<td><div class="cell-strong">' + escapeHtml(d.namaCustomer) + '</div></td>' +
          '<td><div class="cell-strong">' + escapeHtml(d.namaDriver) + '</div><div class="cell-sub">' + escapeHtml(mobilText) + '</div></td>' +
          '<td>' + getStatusBadgeHtml(d.status) + '</td>' +
          '<td><button type="button" class="btn btn-secondary btn-sm" onclick="openOrderDetailModal(\'' + escapeHtml(d.idTracking) + '\')">' + ICONS.eye + '<span>Detail</span></button></td>' +
        '</tr>';
    }
  }

  var quickCta = isBackOffice
    ? '<button type="button" class="btn btn-primary btn-sm" onclick="navigateTo(\'orders\')">' + ICONS.plus + '<span>Input DO Baru</span></button>'
    : '<button type="button" class="btn btn-primary btn-sm" onclick="navigateTo(\'tracking-driver\')">' + ICONS.truck + '<span>Buka Tracking Driver</span></button>';

  return (
    '<div class="page-header">' +
      '<div>' +
        '<h2 class="page-title">Dashboard Operasional</h2>' +
        '<p class="page-subtitle">Ringkasan status pengiriman real-time untuk ' + escapeHtml(user.namaKaryawan) + '</p>' +
      '</div>' +
      '<div class="header-actions">' +
        renderSyncStatusBadge() +
        quickCta +
      '</div>' +
    '</div>' +
    metricsHtml +
    failedAlert +
    '<div class="table-card">' +
      '<div style="padding:14px 16px;border-bottom:1px solid var(--border-color);display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">' +
        '<div style="font-weight:700;font-size:14px">Aktivitas Delivery Order Terbaru</div>' +
        '<button type="button" class="btn btn-secondary btn-sm" onclick="navigateTo(\'' + (isBackOffice ? 'orders' : 'tracking-driver') + '\')">Lihat Semua</button>' +
      '</div>' +
      '<div class="table-wrap">' +
        '<table class="data-table">' +
          '<thead><tr><th>ID Tracking / Tgl</th><th>Nomor DO</th><th>Customer</th><th>Driver & Mobil</th><th>Status</th><th>Aksi</th></tr></thead>' +
          '<tbody>' + recentRows + '</tbody>' +
        '</table>' +
      '</div>' +
    '</div>'
  );
}

function renderMetricCard(label, value, bg, color, iconSvg) {
  return (
    '<div class="metric-card">' +
      '<div class="metric-top">' +
        '<span class="metric-label">' + escapeHtml(label) + '</span>' +
        '<span class="metric-icon" style="background:' + bg + ';color:' + color + '">' + iconSvg + '</span>' +
      '</div>' +
      '<div class="metric-value">' + escapeHtml(String(value)) + '</div>' +
    '</div>'
  );
}

function openFailedFilterOrders() {
  STATE.orders.filters.status = 'Gagal Kirim';
  STATE.orders.page = 1;
  navigateTo('orders');
}

// ============================================================================
// MENU DELIVERY ORDER - PIF & TRACKING MONITOR (BACK OFFICE)
// ============================================================================

function fetchOrdersData(forceRefresh, fetchOpts) {
  var silent = Boolean(fetchOpts && fetchOpts.silent);
  var f = STATE.orders.filters;
  var payload = {
    page: STATE.orders.page,
    limit: STATE.orders.limit,
    search: f.search,
    status: f.status,
    dateFrom: f.dateFrom,
    dateTo: f.dateTo,
    driverId: f.driverId,
    customerId: f.customerId
  };
  var cacheKey = 'orders_' + JSON.stringify(payload);
  var servedFromCache = !forceRefresh && hasCacheEntry(cacheKey);
  if (!servedFromCache) {
    setSyncVisualState(true, false);
  }

  callGasApi('listDeliveryOrders', payload, {
    cacheKey: cacheKey,
    forceRefresh: Boolean(forceRefresh)
  }).then(function (data) {
    var snap = JSON.stringify({ query: payload, data: data });
    var changed = STATE.lastSnapshots.orders !== snap;

    STATE.orders.items = data.items || [];
    STATE.orders.total = data.total || 0;
    STATE.orders.page = data.page || 1;
    STATE.orders.totalPages = data.totalPages || 1;
    STATE.lastSnapshots.orders = snap;

    setSyncVisualState(false, !servedFromCache || Boolean(forceRefresh));

    if ((STATE.currentPage === 'orders' || STATE.currentPage === 'monitor') && (changed || (!silent && !servedFromCache))) {
      renderApp();
    }
    if (servedFromCache && !silent) {
      fetchOrdersData(true, { silent: true });
    }
  }).catch(function (err) {
    setSyncVisualState(false, false);
    if (!silent) {
      showToast(err.message, 'error');
    }
  });
}

function renderOrdersFilterBar(isMonitor) {
  var f = STATE.orders.filters;
  var driverOpts = '<option value="">Semua Driver</option>';
  var drivers = STATE.dropdowns.drivers || [];
  for (var i = 0; i < drivers.length; i++) {
    driverOpts += '<option value="' + escapeHtml(drivers[i].idKaryawan) + '" ' + (f.driverId === drivers[i].idKaryawan ? 'selected' : '') + '>' + escapeHtml(drivers[i].namaKaryawan) + '</option>';
  }

  var statuses = ['', 'Siap Pick Up', 'Dalam Perjalanan', 'Check-In Customer', 'Selesai', 'Gagal Kirim'];
  var statusOpts = '';
  for (var s = 0; s < statuses.length; s++) {
    var val = statuses[s];
    statusOpts += '<option value="' + escapeHtml(val) + '" ' + (f.status === val ? 'selected' : '') + '>' + (val || 'Semua Status') + '</option>';
  }

  return (
    '<div class="card" style="margin-bottom:14px">' +
      '<div class="filter-bar" style="margin-bottom:0">' +
        '<div class="form-group">' +
          '<label class="form-label">Cari DO / Customer / Mobil</label>' +
          '<input id="ord-filter-search" class="form-control" type="text" value="' + escapeHtml(f.search) + '" placeholder="No DO, ID Tracking, Plat, Customer..." onkeydown="if(event.key===\'Enter\'){event.preventDefault();applyOrdersFilter();}" />' +
        '</div>' +
        '<div class="form-group">' +
          '<label class="form-label">Status</label>' +
          '<select id="ord-filter-status" class="form-control">' + statusOpts + '</select>' +
        '</div>' +
        '<div class="form-group">' +
          '<label class="form-label">Driver</label>' +
          '<select id="ord-filter-driver" class="form-control">' + driverOpts + '</select>' +
        '</div>' +
        '<div class="form-group">' +
          '<label class="form-label">Dari Tanggal</label>' +
          '<input id="ord-filter-from" class="form-control" type="date" value="' + escapeHtml(f.dateFrom) + '" />' +
        '</div>' +
        '<div class="form-group">' +
          '<label class="form-label">Sampai Tanggal</label>' +
          '<input id="ord-filter-to" class="form-control" type="date" value="' + escapeHtml(f.dateTo) + '" />' +
        '</div>' +
        '<div class="form-group" style="display:flex;flex-direction:row;gap:6px">' +
          '<button type="button" class="btn btn-navy" style="flex:1" onclick="applyOrdersFilter()">Terapkan</button>' +
          '<button type="button" class="btn btn-secondary" onclick="resetOrdersFilter()">Reset</button>' +
        '</div>' +
      '</div>' +
    '</div>'
  );
}

function applyOrdersFilter() {
  STATE.orders.filters.search = document.getElementById('ord-filter-search').value.trim();
  STATE.orders.filters.status = document.getElementById('ord-filter-status').value;
  STATE.orders.filters.driverId = document.getElementById('ord-filter-driver').value;
  STATE.orders.filters.dateFrom = document.getElementById('ord-filter-from').value;
  STATE.orders.filters.dateTo = document.getElementById('ord-filter-to').value;
  STATE.orders.page = 1;
  fetchOrdersData(false);
}

function resetOrdersFilter() {
  STATE.orders.filters = { search: '', status: '', dateFrom: '', dateTo: '', driverId: '', customerId: '' };
  STATE.orders.page = 1;
  fetchOrdersData(false);
}

function changeOrdersPage(newPage) {
  STATE.orders.page = newPage;
  fetchOrdersData(false);
}

function renderOrdersView() {
  var items = STATE.orders.items;
  var rowsHtml = '';

  if (!items.length) {
    rowsHtml = '<tr><td colspan="7" class="empty-state">Tidak ada Delivery Order yang sesuai filter.</td></tr>';
  } else {
    for (var i = 0; i < items.length; i++) {
      var d = items[i];
      var actions =
        '<button type="button" class="btn btn-secondary btn-sm" onclick="openOrderDetailModal(\'' + escapeHtml(d.idTracking) + '\')">' + ICONS.eye + '<span>Detail</span></button>';

      if (d.status === 'Siap Pick Up') {
        actions += '<button type="button" class="btn btn-secondary btn-sm" onclick="openOrderFormModal(\'' + escapeHtml(d.idTracking) + '\', false)">' + ICONS.edit + '<span>Edit</span></button>';
      }
      if (d.status === 'Gagal Kirim' && d.sudahDikirimUlang !== 'Ya') {
        actions += '<button type="button" class="btn btn-outline-danger btn-sm" onclick="openOrderFormModal(\'' + escapeHtml(d.idTracking) + '\', true)">' + ICONS.redo + '<span>Kirim Ulang</span></button>';
      }
      if (d.driverWhatsApp) {
        var waMsg = 'Halo ' + d.namaDriver + ', mohon cek Delivery Order No: ' + d.nomorDO + ' untuk Customer ' + d.namaCustomer + (d.platMobil ? ' (Mobil: ' + d.platMobil + ')' : '') + '.';
        actions += '<a class="btn btn-outline-emerald btn-sm" target="_blank" rel="noopener" href="' + escapeHtml(buildWhatsAppUrl(d.driverWhatsApp, waMsg)) + '">' + ICONS.phone + '<span>WA Driver</span></a>';
      }

      var statusExtra = '';
      if (d.status === 'Gagal Kirim') {
        statusExtra = '<div class="cell-sub" style="color:var(--rose)">Alasan: ' + escapeHtml(d.alasanGagalKirim || '-') + '</div>' +
          (d.sudahDikirimUlang === 'Ya' ? '<div class="cell-sub">Sudah dikirim ulang</div>' : '');
      } else if (d.namaPenerima) {
        statusExtra = '<div class="cell-sub">Penerima: ' + escapeHtml(d.namaPenerima) + '</div>';
      }

      var mobilLine = d.platMobil
        ? '<div style="margin:3px 0"><span class="vehicle-tag">' + escapeHtml(d.platMobil) + (d.jenisMobil ? ' · ' + escapeHtml(d.jenisMobil) : '') + '</span></div>'
        : '<div class="cell-sub">Mobil: -</div>';

      rowsHtml +=
        '<tr>' +
          '<td><div class="cell-strong">' + escapeHtml(d.idTracking) + '</div><div class="cell-sub">' + formatDateID(d.tanggalDO) + '</div></td>' +
          '<td><div class="cell-strong">' + escapeHtml(d.nomorDO) + '</div>' +
            (d.percobaanKe > 1 ? '<div class="cell-sub"><span class="badge badge-info">Kirim Ulang #' + d.percobaanKe + '</span></div>' : '') +
          '</td>' +
          '<td><div class="cell-strong">' + escapeHtml(d.namaCustomer) + '</div><div class="cell-sub">' + escapeHtml(d.customerAlamat || '-') + '</div></td>' +
          '<td><div class="cell-strong">' + escapeHtml(d.namaDriver) + '</div>' + mobilLine + '<div class="cell-sub">Input: ' + escapeHtml(d.namaBackOffice) + '</div></td>' +
          '<td>' + getStatusBadgeHtml(d.status) + statusExtra + '</td>' +
          '<td><div class="cell-sub">PickUp Foto: ' + (d.pickUpFotos || []).length + '/6</div><div class="cell-sub">CheckIn Foto: ' + (d.checkInFotos || []).length + '/6</div></td>' +
          '<td><div class="action-cluster">' + actions + '</div></td>' +
        '</tr>';
    }
  }

  return (
    '<div class="page-header">' +
      '<div>' +
        '<h2 class="page-title">Delivery Order - PIF</h2>' +
        '<p class="page-subtitle">Input DO baru oleh Back Office, pantau status pengiriman, armada mobil, dan kirim ulang DO gagal</p>' +
      '</div>' +
      '<div class="header-actions">' +
        renderSyncStatusBadge() +
        '<button type="button" class="btn btn-primary" onclick="openOrderFormModal(\'\', false)">' + ICONS.plus + '<span>Tambah Delivery Order</span></button>' +
      '</div>' +
    '</div>' +
    renderOrdersFilterBar(false) +
    '<div class="table-card">' +
      '<div class="table-wrap">' +
        '<table class="data-table">' +
          '<thead><tr><th>ID Tracking & Tgl</th><th>Nomor DO</th><th>Customer</th><th>Driver & Mobil</th><th>Status & Catatan</th><th>Bukti Foto</th><th>Aksi</th></tr></thead>' +
          '<tbody>' + rowsHtml + '</tbody>' +
        '</table>' +
      '</div>' +
      renderPaginationBar(STATE.orders.page, STATE.orders.totalPages, STATE.orders.total, 'changeOrdersPage') +
    '</div>'
  );
}

function renderMonitorView() {
  var items = STATE.orders.items;
  var rowsHtml = '';

  if (!items.length) {
    rowsHtml = '<tr><td colspan="7" class="empty-state">Tidak ada data tracking sesuai filter.</td></tr>';
  } else {
    for (var i = 0; i < items.length; i++) {
      var d = items[i];
      var ciMaps = buildGoogleMapsUrl(d.checkInLat, d.checkInLng);
      var coMaps = buildGoogleMapsUrl(d.checkOutLat, d.checkOutLng);
      var failMaps = buildGoogleMapsUrl(d.gagalKirimLat, d.gagalKirimLng);

      var gpsLinks = '';
      if (ciMaps) {
        gpsLinks += '<div><a target="_blank" rel="noopener" href="' + escapeHtml(ciMaps) + '">Peta Check-In</a></div>';
      }
      if (coMaps) {
        gpsLinks += '<div><a target="_blank" rel="noopener" href="' + escapeHtml(coMaps) + '">Peta Check-Out</a></div>';
      }
      if (failMaps) {
        gpsLinks += '<div><a style="color:var(--rose)" target="_blank" rel="noopener" href="' + escapeHtml(failMaps) + '">Peta Gagal Kirim</a></div>';
      }
      if (!gpsLinks) {
        gpsLinks = '<span class="cell-sub">Belum ada GPS</span>';
      }

      var waktuSummary =
        '<div class="cell-sub">Pick Up: ' + (d.waktuPickUp ? formatDateTimeID(d.waktuPickUp) : '-') + '</div>' +
        '<div class="cell-sub">Check-In: ' + (d.waktuCheckIn ? formatDateTimeID(d.waktuCheckIn) : '-') + '</div>' +
        '<div class="cell-sub">Check-Out: ' + (d.waktuCheckOut ? formatDateTimeID(d.waktuCheckOut) : '-') + '</div>';

      var mobilSummary = d.platMobil
        ? escapeHtml(d.platMobil) + (d.jenisMobil ? ' (' + escapeHtml(d.jenisMobil) + ')' : '')
        : '-';

      rowsHtml +=
        '<tr>' +
          '<td><div class="cell-strong">' + escapeHtml(d.nomorDO) + '</div><div class="cell-sub">' + escapeHtml(d.idTracking) + ' · ' + formatDateID(d.tanggalDO) + '</div></td>' +
          '<td><div class="cell-strong">' + escapeHtml(d.namaCustomer) + '</div><div class="cell-sub">Driver: ' + escapeHtml(d.namaDriver) + '</div><div class="cell-sub">Mobil: ' + mobilSummary + '</div></td>' +
          '<td>' + getStatusBadgeHtml(d.status) + (d.percobaanKe > 1 ? '<div class="cell-sub">Percobaan #' + d.percobaanKe + '</div>' : '') + '</td>' +
          '<td>' + waktuSummary + '</td>' +
          '<td>' + gpsLinks + '</td>' +
          '<td><div class="cell-strong">' + escapeHtml(d.namaPenerima || '-') + '</div><div class="cell-sub">' + escapeHtml(d.status === 'Gagal Kirim' ? 'Gagal: ' + d.alasanGagalKirim : (d.keterangan || '-')) + '</div></td>' +
          '<td><button type="button" class="btn btn-secondary btn-sm" onclick="openOrderDetailModal(\'' + escapeHtml(d.idTracking) + '\')">' + ICONS.eye + '<span>Detail & Foto</span></button></td>' +
        '</tr>';
    }
  }

  return (
    '<div class="page-header">' +
      '<div>' +
        '<h2 class="page-title">Monitoring Tracking Driver</h2>' +
        '<p class="page-subtitle">Pantau lokasi GPS Check-In/Check-Out, armada kendaraan, foto bukti barang, penerima, dan kendala</p>' +
      '</div>' +
      '<div class="header-actions">' +
        renderSyncStatusBadge() +
      '</div>' +
    '</div>' +
    renderOrdersFilterBar(true) +
    '<div class="table-card">' +
      '<div class="table-wrap">' +
        '<table class="data-table">' +
          '<thead><tr><th>Nomor DO / Tracking</th><th>Customer, Driver & Mobil</th><th>Status</th><th>Waktu Tahapan</th><th>Titik GPS</th><th>Penerima & Ket.</th><th>Aksi</th></tr></thead>' +
          '<tbody>' + rowsHtml + '</tbody>' +
        '</table>' +
      '</div>' +
      renderPaginationBar(STATE.orders.page, STATE.orders.totalPages, STATE.orders.total, 'changeOrdersPage') +
    '</div>'
  );
}

function handleOrderMobilChange(selectedIdMobil) {
  var jenisInput = document.getElementById('ord-jenis-mobil');
  if (!jenisInput) {
    return;
  }
  var mobils = STATE.dropdowns.mobils || [];
  var foundJenis = '';
  for (var i = 0; i < mobils.length; i++) {
    if (mobils[i].idMobil === selectedIdMobil) {
      foundJenis = mobils[i].jenisMobil || '';
      break;
    }
  }
  jenisInput.value = foundJenis;
}

function buildOrderMobilOptionsHtml(preSelectedMobilId) {
  var mobils = STATE.dropdowns.mobils || [];
  var html = '<option value="">-- Pilih Plat Mobil --</option>';
  var matched = false;
  var matchedJenis = '';
  for (var m = 0; m < mobils.length; m++) {
    var isSel = Boolean(preSelectedMobilId && preSelectedMobilId === mobils[m].idMobil);
    if (isSel) {
      matched = true;
      matchedJenis = mobils[m].jenisMobil || '';
    }
    html += '<option value="' + escapeHtml(mobils[m].idMobil) + '" ' + (isSel ? 'selected' : '') + '>' + escapeHtml(mobils[m].platMobil) + '</option>';
  }
  return { html: html, matched: matched, matchedJenis: matchedJenis };
}

function openOrderFormModal(existingIdTracking, isRedelivery) {
  var existing = null;
  if (existingIdTracking) {
    for (var i = 0; i < STATE.orders.items.length; i++) {
      if (STATE.orders.items[i].idTracking === existingIdTracking) {
        existing = STATE.orders.items[i];
        break;
      }
    }
  }

  var isEdit = Boolean(existing && !isRedelivery);
  var title = isRedelivery
    ? 'Kirim Ulang Delivery Order (Redelivery)'
    : (isEdit ? 'Ubah Delivery Order' : 'Input Delivery Order Baru - PIF');

  var custOpts = '<option value="">-- Pilih Customer --</option>';
  var customers = STATE.dropdowns.customers || [];
  for (var c = 0; c < customers.length; c++) {
    var selC = existing && existing.idCustomer === customers[c].idCustomer ? 'selected' : '';
    custOpts += '<option value="' + escapeHtml(customers[c].idCustomer) + '" ' + selC + '>' + escapeHtml(customers[c].namaCustomer) + '</option>';
  }

  var drvOpts = '<option value="">-- Pilih Driver --</option>';
  var drivers = STATE.dropdowns.drivers || [];
  for (var d = 0; d < drivers.length; d++) {
    var selD = (!isRedelivery && existing && existing.idDriver === drivers[d].idKaryawan) ? 'selected' : '';
    drvOpts += '<option value="' + escapeHtml(drivers[d].idKaryawan) + '" ' + selD + '>' + escapeHtml(drivers[d].namaKaryawan) + '</option>';
  }

  var preSelectedMobilId = existing ? (existing.idMobil || '') : '';
  var mobils = STATE.dropdowns.mobils || [];
  var mobilBuilt = buildOrderMobilOptionsHtml(preSelectedMobilId);

  var mobilNotice = '';
  if (!mobils.length) {
    mobilNotice = '<div class="form-hint" style="color:var(--amber)">Belum ada mobil aktif. Tambah terlebih dahulu di menu <strong>Lainnya → Master Mobil</strong>.</div>';
  } else if (preSelectedMobilId && !mobilBuilt.matched && existing && existing.platMobil) {
    mobilNotice = '<div class="form-hint" style="color:var(--amber)">Mobil sebelumnya (' + escapeHtml(existing.platMobil) + ') sedang nonaktif. Silakan pilih Plat Mobil aktif.</div>';
  }

  var redeliveryBanner = isRedelivery && existing
    ? '<div class="alert-box alert-warning">Mengirim ulang <strong>' + escapeHtml(existing.nomorDO) + '</strong> setelah gagal kirim oleh <strong>' + escapeHtml(existing.namaDriver) + '</strong> (Alasan: ' + escapeHtml(existing.alasanGagalKirim) + '). Riwayat gagal sebelumnya tetap tersimpan aman.</div>'
    : '';

  var html =
    '<div class="modal-header">' +
      '<h3 class="modal-title">' + escapeHtml(title) + '</h3>' +
      '<button type="button" class="modal-close" onclick="closeModal()">' + ICONS.x + '</button>' +
    '</div>' +
    '<form id="order-form">' +
      '<div class="modal-body">' +
        redeliveryBanner +
        '<div class="form-grid-2">' +
          '<div class="form-group">' +
            '<label class="form-label">ID Tracking (Otomatis)</label>' +
            '<input id="ord-id-tracking" class="form-control" type="text" readonly value="' + escapeHtml(isEdit ? existing.idTracking : 'Memuat ID...') + '" />' +
          '</div>' +
          '<div class="form-group">' +
            '<label class="form-label" for="ord-tanggal">Tanggal Delivery Order <span class="req">*</span></label>' +
            '<input id="ord-tanggal" class="form-control" type="date" value="' + escapeHtml(isEdit ? existing.tanggalDO : getTodayYMD()) + '" required />' +
          '</div>' +
        '</div>' +
        '<div class="form-group">' +
          '<label class="form-label" for="ord-nomor">Nomor Delivery Order <span class="req">*</span></label>' +
          '<input id="ord-nomor" class="form-control" type="text" value="' + escapeHtml(existing ? existing.nomorDO : '') + '" ' + (isRedelivery ? 'readonly' : '') + ' placeholder="Contoh: DO-PIF/11/0012" required />' +
        '</div>' +
        '<div class="form-grid-2">' +
          '<div class="form-group">' +
            '<label class="form-label" for="ord-customer">Nama Customer <span class="req">*</span></label>' +
            '<select id="ord-customer" class="form-control" required>' + custOpts + '</select>' +
          '</div>' +
          '<div class="form-group">' +
            '<label class="form-label" for="ord-driver">Driver Bertugas <span class="req">*</span></label>' +
            '<select id="ord-driver" class="form-control" required>' + drvOpts + '</select>' +
          '</div>' +
        '</div>' +
        '<div class="form-grid-2">' +
          '<div class="form-group">' +
            '<label class="form-label" for="ord-mobil">Plat Mobil <span class="req">*</span></label>' +
            '<select id="ord-mobil" class="form-control" required onchange="handleOrderMobilChange(this.value)">' + mobilBuilt.html + '</select>' +
            mobilNotice +
          '</div>' +
          '<div class="form-group">' +
            '<label class="form-label" for="ord-jenis-mobil">Jenis Mobil (Otomatis)</label>' +
            '<input id="ord-jenis-mobil" class="form-control" type="text" readonly value="' + escapeHtml(mobilBuilt.matchedJenis) + '" placeholder="Otomatis terisi sesuai Plat Mobil" />' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="modal-footer">' +
        '<button type="button" class="btn btn-secondary" onclick="closeModal()">Batal</button>' +
        '<button id="ord-save-btn" type="submit" class="btn btn-primary">' + (isRedelivery ? 'Buat Pengiriman Ulang' : 'Simpan Delivery Order') + '</button>' +
      '</div>' +
    '</form>';

  openModal(html);

  if (!STATE.dropdowns.mobils.length || !STATE.dropdowns.drivers.length || !STATE.dropdowns.customers.length) {
    ensureDropdownsLoaded(false, { silent: true }).then(function () {
      var mobilSel = document.getElementById('ord-mobil');
      if (mobilSel && !mobilSel.value) {
        var refreshedMobil = buildOrderMobilOptionsHtml(preSelectedMobilId);
        mobilSel.innerHTML = refreshedMobil.html;
        handleOrderMobilChange(mobilSel.value);
      }
      var custSel = document.getElementById('ord-customer');
      if (custSel && !custSel.value && STATE.dropdowns.customers.length) {
        var cHtml = '<option value="">-- Pilih Customer --</option>';
        for (var ci = 0; ci < STATE.dropdowns.customers.length; ci++) {
          var cu = STATE.dropdowns.customers[ci];
          cHtml += '<option value="' + escapeHtml(cu.idCustomer) + '" ' + (existing && existing.idCustomer === cu.idCustomer ? 'selected' : '') + '>' + escapeHtml(cu.namaCustomer) + '</option>';
        }
        custSel.innerHTML = cHtml;
      }
      var drvSel = document.getElementById('ord-driver');
      if (drvSel && !drvSel.value && STATE.dropdowns.drivers.length) {
        var dHtml = '<option value="">-- Pilih Driver --</option>';
        for (var di = 0; di < STATE.dropdowns.drivers.length; di++) {
          var dr = STATE.dropdowns.drivers[di];
          dHtml += '<option value="' + escapeHtml(dr.idKaryawan) + '" ' + (!isRedelivery && existing && existing.idDriver === dr.idKaryawan ? 'selected' : '') + '>' + escapeHtml(dr.namaKaryawan) + '</option>';
        }
        drvSel.innerHTML = dHtml;
      }
    });
  }

  if (!isEdit) {
    callGasApi('getNextTrackingId', {}).then(function (data) {
      var input = document.getElementById('ord-id-tracking');
      if (input && data && data.nextIdTracking) {
        input.value = data.nextIdTracking;
      }
    }).catch(function () {});
  }

  document.getElementById('order-form').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var btn = document.getElementById('ord-save-btn');
    var payload = {
      tanggalDO: document.getElementById('ord-tanggal').value,
      nomorDO: document.getElementById('ord-nomor').value.trim(),
      idCustomer: document.getElementById('ord-customer').value,
      idDriver: document.getElementById('ord-driver').value,
      idMobil: document.getElementById('ord-mobil').value
    };

    if (!payload.idMobil) {
      showToast('Plat Mobil wajib dipilih dari Master Mobil.', 'warning');
      return;
    }

    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span><span>Menyimpan...</span>';

    var action = isEdit ? 'updateDeliveryOrder' : 'createDeliveryOrder';
    if (isEdit) {
      payload.idTracking = existing.idTracking;
    }

    callGasApi(action, payload)
      .then(function (res) {
        clearApiCache('orders_');
        clearApiCache('dashboard_');
        clearApiCache('report_');
        clearApiCache('tracking_');
        closeModal();
        fetchOrdersData(true);
        showToast(
          res.isRedelivery
            ? 'Kirim Ulang DO berhasil dibuat (Percobaan #' + res.item.percobaanKe + ').'
            : 'Delivery Order berhasil disimpan (' + res.item.idTracking + ').',
          'success'
        );
      })
      .catch(function (err) {
        showToast(err.message, 'error');
        var b = document.getElementById('ord-save-btn');
        if (b) {
          b.disabled = false;
          b.textContent = isRedelivery ? 'Buat Pengiriman Ulang' : 'Simpan Delivery Order';
        }
      });
  });
}

// ============================================================================
// MENU TRACKING DRIVER (MULTI-DO, 6 SLOT FOTO, WAJIB GPS, GAGAL KIRIM)
// ============================================================================

function fetchDriverTrackingData(forceRefresh, fetchOpts) {
  var silent = Boolean(fetchOpts && fetchOpts.silent);
  var payload = {
    page: STATE.tracking.page,
    limit: STATE.tracking.limit,
    status: STATE.tracking.activeTab,
    search: STATE.tracking.search
  };
  var cacheKey = 'tracking_' + JSON.stringify(payload);
  var servedFromCache = !forceRefresh && hasCacheEntry(cacheKey);
  if (!servedFromCache) {
    setSyncVisualState(true, false);
  }

  callGasApi('listDeliveryOrders', payload, {
    cacheKey: cacheKey,
    forceRefresh: Boolean(forceRefresh)
  }).then(function (data) {
    var newItems = data.items || [];
    var snap = JSON.stringify({ query: payload, data: data });
    var changed = STATE.lastSnapshots.tracking !== snap;

    var validMap = {};
    for (var vi = 0; vi < newItems.length; vi++) {
      validMap[newItems[vi].idTracking] = true;
    }
    var keptSelected = {};
    var prevKeys = Object.keys(STATE.tracking.selectedIds || {});
    for (var ki = 0; ki < prevKeys.length; ki++) {
      if (validMap[prevKeys[ki]]) {
        keptSelected[prevKeys[ki]] = true;
      }
    }

    STATE.tracking.items = newItems;
    STATE.tracking.total = data.total || 0;
    STATE.tracking.page = data.page || 1;
    STATE.tracking.totalPages = data.totalPages || 1;
    STATE.tracking.selectedIds = keptSelected;
    STATE.lastSnapshots.tracking = snap;

    setSyncVisualState(false, !servedFromCache || Boolean(forceRefresh));

    if (STATE.currentPage === 'tracking-driver' && (changed || (!silent && !servedFromCache))) {
      renderApp();
    }
    if (servedFromCache && !silent) {
      fetchDriverTrackingData(true, { silent: true });
    }
  }).catch(function (err) {
    setSyncVisualState(false, false);
    if (!silent) {
      showToast(err.message, 'error');
    }
  });
}

function switchTrackingTab(tabName) {
  STATE.tracking.activeTab = tabName;
  STATE.tracking.page = 1;
  STATE.tracking.selectedIds = {};
  fetchDriverTrackingData(false);
}

function searchDriverTracking() {
  STATE.tracking.search = document.getElementById('drv-search-input').value.trim();
  STATE.tracking.page = 1;
  STATE.tracking.selectedIds = {};
  fetchDriverTrackingData(false);
}

function toggleTrackingCheckbox(idTracking) {
  if (STATE.tracking.selectedIds[idTracking]) {
    delete STATE.tracking.selectedIds[idTracking];
  } else {
    STATE.tracking.selectedIds[idTracking] = true;
  }
  renderApp();
}

function getSelectedTrackingIds() {
  return Object.keys(STATE.tracking.selectedIds);
}

function renderDriverTrackingView() {
  var tabs = ['Siap Pick Up', 'Dalam Perjalanan', 'Check-In Customer', 'Selesai', 'Gagal Kirim'];
  var tabsHtml = '';
  for (var t = 0; t < tabs.length; t++) {
    var tab = tabs[t];
    tabsHtml += '<button type="button" class="tab-btn ' + (STATE.tracking.activeTab === tab ? 'active' : '') + '" onclick="switchTrackingTab(\'' + tab + '\')">' + escapeHtml(tab) + '</button>';
  }

  var items = STATE.tracking.items;
  var activeTab = STATE.tracking.activeTab;
  var canSelect = activeTab === 'Siap Pick Up' || activeTab === 'Dalam Perjalanan' || activeTab === 'Check-In Customer';

  var cardsHtml = '';
  if (!items.length) {
    cardsHtml = '<div class="card empty-state">Belum ada Delivery Order pada tab <strong>' + escapeHtml(activeTab) + '</strong>.</div>';
  } else {
    cardsHtml = '<div class="driver-cards-grid">';
    for (var i = 0; i < items.length; i++) {
      var d = items[i];
      var isSelected = Boolean(STATE.tracking.selectedIds[d.idTracking]);

      var cardActions = '<button type="button" class="btn btn-secondary btn-sm" onclick="openOrderDetailModal(\'' + escapeHtml(d.idTracking) + '\')">' + ICONS.eye + '<span>Detail</span></button>';
      if (d.status === 'Siap Pick Up') {
        cardActions += '<button type="button" class="btn btn-primary btn-sm" onclick="openPickUpModal([\'' + escapeHtml(d.idTracking) + '\'])">' + ICONS.camera + '<span>Pick Up</span></button>';
      } else if (d.status === 'Dalam Perjalanan') {
        cardActions += '<button type="button" class="btn btn-primary btn-sm" onclick="openCheckInModal([\'' + escapeHtml(d.idTracking) + '\'])">' + ICONS.mapPin + '<span>Check-In</span></button>';
        cardActions += '<button type="button" class="btn btn-outline-danger btn-sm" onclick="openFailedModal([\'' + escapeHtml(d.idTracking) + '\'])">' + ICONS.alert + '<span>Gagal Kirim</span></button>';
      } else if (d.status === 'Check-In Customer') {
        cardActions += '<button type="button" class="btn btn-emerald btn-sm" onclick="openCheckOutModal([\'' + escapeHtml(d.idTracking) + '\'])">' + ICONS.check + '<span>Check-Out</span></button>';
        cardActions += '<button type="button" class="btn btn-outline-danger btn-sm" onclick="openFailedModal([\'' + escapeHtml(d.idTracking) + '\'])">' + ICONS.alert + '<span>Gagal Kirim</span></button>';
      }
      if (d.customerWhatsApp) {
        cardActions += '<a class="btn btn-outline-emerald btn-sm" target="_blank" rel="noopener" href="' + escapeHtml(buildWhatsAppUrl(d.customerWhatsApp, 'Halo ' + d.namaCustomer + ', saya Driver pengiriman untuk DO ' + d.nomorDO + '.')) + '">' + ICONS.phone + '<span>WA</span></a>';
      }

      var checkControl = canSelect
        ? '<input type="checkbox" class="do-checkbox" ' + (isSelected ? 'checked' : '') + ' onchange="toggleTrackingCheckbox(\'' + escapeHtml(d.idTracking) + '\')" />'
        : '';

      var extraNote = '';
      if (d.status === 'Gagal Kirim') {
        extraNote = '<div class="alert-box alert-danger" style="padding:8px 10px"><strong>Alasan Gagal:</strong> ' + escapeHtml(d.alasanGagalKirim || '-') + '</div>';
      } else if (d.namaPenerima) {
        extraNote = '<div class="cell-sub"><strong>Penerima:</strong> ' + escapeHtml(d.namaPenerima) + (d.keterangan ? ' · ' + escapeHtml(d.keterangan) : '') + '</div>';
      }

      var vehicleBadge = d.platMobil
        ? '<div style="margin-top:6px"><span class="vehicle-tag">Mobil: ' + escapeHtml(d.platMobil) + (d.jenisMobil ? ' · ' + escapeHtml(d.jenisMobil) : '') + '</span></div>'
        : '';

      cardsHtml +=
        '<div class="driver-do-card ' + (isSelected ? 'selected' : '') + '">' +
          '<div class="do-card-head">' +
            '<label class="do-check-label">' +
              checkControl +
              '<div>' +
                '<div class="cell-strong" style="font-size:15px">' + escapeHtml(d.nomorDO) + '</div>' +
                '<div class="cell-sub">' + escapeHtml(d.idTracking) + ' · ' + formatDateID(d.tanggalDO) + (d.percobaanKe > 1 ? ' · Kirim Ulang #' + d.percobaanKe : '') + '</div>' +
              '</div>' +
            '</label>' +
            getStatusBadgeHtml(d.status) +
          '</div>' +
          '<div style="border-top:1px solid var(--border-color);padding-top:8px">' +
            '<div class="cell-strong">' + escapeHtml(d.namaCustomer) + '</div>' +
            '<div class="cell-sub">' + escapeHtml(d.customerAlamat || 'Alamat belum tercatat') + '</div>' +
            vehicleBadge +
          '</div>' +
          extraNote +
          '<div class="action-cluster" style="margin-top:auto;padding-top:4px">' + cardActions + '</div>' +
        '</div>';
    }
    cardsHtml += '</div>';
  }

  var selectedIds = getSelectedTrackingIds();
  var bulkBar = '';
  if (selectedIds.length > 0) {
    var bulkButtons = '';
    if (activeTab === 'Siap Pick Up') {
      bulkButtons = '<button type="button" class="btn btn-primary" onclick="openPickUpSelected()">' + ICONS.camera + '<span>Pick Up Terpilih (' + selectedIds.length + ')</span></button>';
    } else if (activeTab === 'Dalam Perjalanan') {
      bulkButtons =
        '<button type="button" class="btn btn-primary" onclick="openCheckInSelected()">' + ICONS.mapPin + '<span>Check-In Customer (' + selectedIds.length + ')</span></button>' +
        '<button type="button" class="btn btn-danger" onclick="openFailedSelected()">' + ICONS.alert + '<span>Gagal Kirim (' + selectedIds.length + ')</span></button>';
    } else if (activeTab === 'Check-In Customer') {
      bulkButtons =
        '<button type="button" class="btn btn-emerald" onclick="openCheckOutSelected()">' + ICONS.check + '<span>Check-Out (' + selectedIds.length + ')</span></button>' +
        '<button type="button" class="btn btn-danger" onclick="openFailedSelected()">' + ICONS.alert + '<span>Gagal Kirim (' + selectedIds.length + ')</span></button>';
    }

    bulkBar =
      '<div class="bulk-action-bar">' +
        '<div><strong>' + selectedIds.length + ' Delivery Order</strong> dipilih (Multi-DO)</div>' +
        '<div class="action-cluster">' + bulkButtons + '</div>' +
      '</div>';
  }

  return (
    '<div class="page-header">' +
      '<div>' +
        '<h2 class="page-title">Tracking Driver</h2>' +
        '<p class="page-subtitle">Centang satu atau banyak DO untuk Multi-DO Pick Up, Check-In/Out wajib GPS, atau input Gagal Kirim</p>' +
      '</div>' +
      '<div class="header-actions">' +
        renderSyncStatusBadge() +
      '</div>' +
    '</div>' +
    '<div class="tabs-bar">' + tabsHtml + '</div>' +
    '<div class="card" style="margin-bottom:14px;padding:12px">' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
        '<input id="drv-search-input" class="form-control" style="flex:1;min-width:200px" type="text" value="' + escapeHtml(STATE.tracking.search) + '" placeholder="Cari No DO, Plat Mobil, atau Customer..." onkeydown="if(event.key===\'Enter\'){event.preventDefault();searchDriverTracking();}" />' +
        '<button type="button" class="btn btn-navy" onclick="searchDriverTracking()">Cari</button>' +
      '</div>' +
    '</div>' +
    cardsHtml +
    bulkBar +
    (STATE.tracking.totalPages > 1
      ? '<div class="card" style="margin-top:14px;padding:0">' + renderPaginationBar(STATE.tracking.page, STATE.tracking.totalPages, STATE.tracking.total, 'changeDriverTrackingPage') + '</div>'
      : '')
  );
}

function changeDriverTrackingPage(newPage) {
  STATE.tracking.page = newPage;
  STATE.tracking.selectedIds = {};
  fetchDriverTrackingData(false);
}

function openPickUpSelected() {
  openPickUpModal(getSelectedTrackingIds());
}

function openCheckInSelected() {
  var ids = getSelectedTrackingIds();
  if (!ids.length) {
    return;
  }
  var custId = null;
  for (var i = 0; i < STATE.tracking.items.length; i++) {
    var item = STATE.tracking.items[i];
    if (STATE.tracking.selectedIds[item.idTracking]) {
      if (!custId) {
        custId = item.idCustomer;
      } else if (custId !== item.idCustomer) {
        showToast('Check-In bersamaan hanya untuk DO milik Customer yang sama.', 'warning');
        return;
      }
    }
  }
  openCheckInModal(ids);
}

function openCheckOutSelected() {
  openCheckOutModal(getSelectedTrackingIds());
}

function openFailedSelected() {
  openFailedModal(getSelectedTrackingIds());
}

// ==================== HELPER 6 SLOT FOTO & GPS MODAL ====================

function renderPhotoUploaderSection(labelText, isOptional) {
  var slotsHtml = '';
  for (var i = 0; i < PIF_CONFIG.MAX_PHOTOS; i++) {
    var photoData = STATE.modalPhotos[i];
    if (photoData) {
      slotsHtml +=
        '<div class="photo-slot filled">' +
          '<img src="' + photoData + '" alt="Foto ' + (i + 1) + '" />' +
          '<span class="photo-slot-badge">Foto ' + (i + 1) + '</span>' +
          '<button type="button" class="photo-slot-remove" onclick="removeModalPhoto(' + i + ')" title="Hapus foto">' + ICONS.x + '</button>' +
        '</div>';
    } else {
      slotsHtml +=
        '<div class="photo-slot" onclick="triggerGalleryInput()">' +
          ICONS.camera +
          '<span>Slot Foto ' + (i + 1) + '</span>' +
        '</div>';
    }
  }

  return (
    '<div class="form-group">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">' +
        '<label class="form-label">' + escapeHtml(labelText) + (isOptional ? ' (Opsional maks 6 foto)' : ' <span class="req">*</span> (Min 1, Maks 6 foto)') + '</label>' +
        '<span id="photo-count-label" class="form-hint">' + STATE.modalPhotos.length + ' / 6 terisi</span>' +
      '</div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:4px">' +
        '<button type="button" class="btn btn-secondary btn-sm" onclick="triggerCameraInput()">' + ICONS.camera + '<span>Buka Kamera HP</span></button>' +
        '<button type="button" class="btn btn-secondary btn-sm" onclick="triggerGalleryInput()">Pilih dari Galeri</button>' +
      '</div>' +
      '<input id="modal-camera-input" type="file" accept="image/*" capture="environment" style="display:none" onchange="handleModalPhotoFiles(this.files)" />' +
      '<input id="modal-gallery-input" type="file" accept="image/*" multiple style="display:none" onchange="handleModalPhotoFiles(this.files)" />' +
      '<div id="photo-slots-container" class="photo-slots-grid">' + slotsHtml + '</div>' +
    '</div>'
  );
}

function triggerCameraInput() {
  var el = document.getElementById('modal-camera-input');
  if (el) {
    el.click();
  }
}

function triggerGalleryInput() {
  var el = document.getElementById('modal-gallery-input');
  if (el) {
    el.click();
  }
}

function handleModalPhotoFiles(fileList) {
  if (!fileList || !fileList.length) {
    return;
  }
  var remaining = PIF_CONFIG.MAX_PHOTOS - STATE.modalPhotos.length;
  if (remaining <= 0) {
    showToast('Maksimal 6 foto sudah terisi penuh.', 'warning');
    return;
  }

  var filesToProcess = [];
  for (var i = 0; i < Math.min(remaining, fileList.length); i++) {
    filesToProcess.push(fileList[i]);
  }

  Promise.all(filesToProcess.map(function (f) {
    return compressImageFile(f);
  })).then(function (compressedList) {
    for (var j = 0; j < compressedList.length; j++) {
      if (STATE.modalPhotos.length < PIF_CONFIG.MAX_PHOTOS) {
        STATE.modalPhotos.push(compressedList[j]);
      }
    }
    refreshPhotoGridDom();
  }).catch(function (err) {
    showToast(err.message, 'error');
  });
}

function removeModalPhoto(idx) {
  STATE.modalPhotos.splice(idx, 1);
  refreshPhotoGridDom();
}

function refreshPhotoGridDom() {
  var container = document.getElementById('photo-slots-container');
  if (!container) {
    return;
  }
  var slotsHtml = '';
  for (var i = 0; i < PIF_CONFIG.MAX_PHOTOS; i++) {
    var photoData = STATE.modalPhotos[i];
    if (photoData) {
      slotsHtml +=
        '<div class="photo-slot filled">' +
          '<img src="' + photoData + '" alt="Foto ' + (i + 1) + '" />' +
          '<span class="photo-slot-badge">Foto ' + (i + 1) + '</span>' +
          '<button type="button" class="photo-slot-remove" onclick="removeModalPhoto(' + i + ')" title="Hapus foto">' + ICONS.x + '</button>' +
        '</div>';
    } else {
      slotsHtml +=
        '<div class="photo-slot" onclick="triggerGalleryInput()">' +
          ICONS.camera +
          '<span>Slot Foto ' + (i + 1) + '</span>' +
        '</div>';
    }
  }
  container.innerHTML = slotsHtml;
  var countEl = document.getElementById('photo-count-label');
  if (countEl) {
    countEl.textContent = STATE.modalPhotos.length + ' / 6 terisi';
  }
}

function renderGpsStatusBox() {
  if (STATE.modalGpsLoading) {
    return (
      '<div id="gps-status-box" class="gps-box">' +
        '<div style="display:flex;align-items:center;gap:8px"><span class="spinner dark"></span><span>Mengambil koordinat GPS wajib aktif...</span></div>' +
      '</div>'
    );
  }
  if (STATE.modalGps) {
    var mapsUrl = buildGoogleMapsUrl(STATE.modalGps.lat, STATE.modalGps.lng);
    return (
      '<div id="gps-status-box" class="gps-box ready">' +
        '<div>' +
          '<div class="cell-strong" style="color:var(--emerald)">GPS Aktif Terkunci</div>' +
          '<div class="cell-sub">' + STATE.modalGps.lat + ', ' + STATE.modalGps.lng + ' (Akurasi ~' + STATE.modalGps.accuracy + ' m) · <a target="_blank" rel="noopener" href="' + escapeHtml(mapsUrl) + '">Cek Peta</a></div>' +
        '</div>' +
        '<button type="button" class="btn btn-secondary btn-sm" onclick="acquireModalGps()">Ambil Ulang GPS</button>' +
      '</div>'
    );
  }
  var apkSettingsBtn = (window.AndroidApp && typeof window.AndroidApp.openAppSettings === 'function')
    ? '<button type="button" class="btn btn-secondary btn-sm" onclick="window.AndroidApp.openAppSettings()">Buka Setelan Izin APK</button>'
    : '';
  return (
    '<div id="gps-status-box" class="gps-box error">' +
      '<div>' +
        '<div class="cell-strong" style="color:var(--rose)">GPS Belum Aktif / Gagal Diambil</div>' +
        '<div class="cell-sub">' + escapeHtml(STATE.modalGpsError || 'Wajib nyalakan GPS perangkat sebelum menyimpan.') + '</div>' +
      '</div>' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
        apkSettingsBtn +
        '<button type="button" class="btn btn-outline-danger btn-sm" onclick="acquireModalGps()">Aktifkan & Ambil GPS</button>' +
      '</div>' +
    '</div>'
  );
}

function acquireModalGps() {
  STATE.modalGps = null;
  STATE.modalGpsLoading = true;
  STATE.modalGpsError = '';
  updateGpsBoxDom();

  requestMandatoryGps()
    .then(function (coords) {
      STATE.modalGps = coords;
      STATE.modalGpsLoading = false;
      updateGpsBoxDom();
    })
    .catch(function (err) {
      STATE.modalGps = null;
      STATE.modalGpsLoading = false;
      STATE.modalGpsError = err.message;
      updateGpsBoxDom();
      showToast(err.message, 'error');
    });
}

function updateGpsBoxDom() {
  var holder = document.getElementById('gps-box-holder');
  if (holder) {
    holder.innerHTML = renderGpsStatusBox();
  }
  var submitBtn = document.getElementById('gps-required-submit-btn');
  if (submitBtn) {
    submitBtn.disabled = !STATE.modalGps || STATE.modalGpsLoading;
  }
}

function buildSelectedDosSummaryHtml(idTrackings) {
  var badges = '';
  for (var i = 0; i < STATE.tracking.items.length; i++) {
    var item = STATE.tracking.items[i];
    if (idTrackings.indexOf(item.idTracking) !== -1) {
      badges += '<span class="badge badge-info">' + escapeHtml(item.nomorDO) + ' (' + escapeHtml(item.namaCustomer) + ')</span> ';
    }
  }
  return '<div style="display:flex;flex-wrap:wrap;gap:6px">' + badges + '</div>';
}

// ==================== MODAL PICK UP, CHECK-IN, CHECK-OUT, GAGAL KIRIM ====================

function openPickUpModal(idTrackings) {
  if (!idTrackings || !idTrackings.length) {
    return;
  }
  STATE.modalPhotos = [];
  STATE.modalTargetIds = idTrackings.slice();

  var html =
    '<div class="modal-header">' +
      '<h3 class="modal-title">Konfirmasi Pick Up Barang (' + idTrackings.length + ' DO)</h3>' +
      '<button type="button" class="modal-close" onclick="closeModal()">' + ICONS.x + '</button>' +
    '</div>' +
    '<div class="modal-body">' +
      '<div><div class="form-label" style="margin-bottom:6px">Delivery Order yang akan di-Pick Up:</div>' + buildSelectedDosSummaryHtml(idTrackings) + '</div>' +
      renderPhotoUploaderSection('Foto Ambil Barang (6 Kolom Foto)', false) +
    '</div>' +
    '<div class="modal-footer">' +
      '<button type="button" class="btn btn-secondary" onclick="closeModal()">Batal</button>' +
      '<button id="pickup-submit-btn" type="button" class="btn btn-primary" onclick="submitPickUp()">Konfirmasi Pick Up</button>' +
    '</div>';

  openModal(html);
}

function submitPickUp() {
  var idTrackings = STATE.modalTargetIds || [];
  if (!STATE.modalPhotos.length) {
    showToast('Unggah minimal 1 foto ambil barang terlebih dahulu.', 'warning');
    return;
  }
  var btn = document.getElementById('pickup-submit-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span><span>Mengunggah foto & menyimpan...</span>';

  callGasApi('pickUpOrders', { idTrackings: idTrackings, photos: STATE.modalPhotos })
    .then(function () {
      STATE.tracking.selectedIds = {};
      clearApiCache('tracking_');
      clearApiCache('orders_');
      clearApiCache('dashboard_');
      clearApiCache('report_');
      closeModal();
      fetchDriverTrackingData(true);
      showToast('Pick Up Multi-DO berhasil dicatat!', 'success');
    })
    .catch(function (err) {
      showToast(err.message, 'error');
      var b = document.getElementById('pickup-submit-btn');
      if (b) {
        b.disabled = false;
        b.textContent = 'Konfirmasi Pick Up';
      }
    });
}

function openCheckInModal(idTrackings) {
  if (!idTrackings || !idTrackings.length) {
    return;
  }
  STATE.modalPhotos = [];
  STATE.modalTargetIds = idTrackings.slice();
  STATE.modalGps = null;
  STATE.modalGpsLoading = true;
  STATE.modalGpsError = '';

  var html =
    '<div class="modal-header">' +
      '<h3 class="modal-title">Check-In di Lokasi Customer (' + idTrackings.length + ' DO)</h3>' +
      '<button type="button" class="modal-close" onclick="closeModal()">' + ICONS.x + '</button>' +
    '</div>' +
    '<div class="modal-body">' +
      '<div><div class="form-label" style="margin-bottom:6px">Delivery Order Check-In:</div>' + buildSelectedDosSummaryHtml(idTrackings) + '</div>' +
      '<div class="form-group">' +
        '<label class="form-label">Status GPS (Wajib Aktif saat Check-In) <span class="req">*</span></label>' +
        '<div id="gps-box-holder">' + renderGpsStatusBox() + '</div>' +
      '</div>' +
      '<div class="form-group">' +
        '<label class="form-label" for="ci-penerima">Nama Penerima Barang <span class="req">*</span></label>' +
        '<input id="ci-penerima" class="form-control" type="text" placeholder="Siapa yang menerima barang?" required />' +
      '</div>' +
      '<div class="form-group">' +
        '<label class="form-label" for="ci-keterangan">Keterangan Tambahan (Opsional)</label>' +
        '<textarea id="ci-keterangan" class="form-control" rows="2" placeholder="Catatan kondisi barang, nomor segel, atau info tambahan..."></textarea>' +
      '</div>' +
      renderPhotoUploaderSection('Foto Lokasi & Penerima (6 Kolom Foto)', false) +
    '</div>' +
    '<div class="modal-footer">' +
      '<button type="button" class="btn btn-secondary" onclick="closeModal()">Batal</button>' +
      '<button id="gps-required-submit-btn" type="button" class="btn btn-primary" disabled onclick="submitCheckIn()">Simpan Check-In</button>' +
    '</div>';

  openModal(html);
  acquireModalGps();
}

function submitCheckIn() {
  var idTrackings = STATE.modalTargetIds || [];
  if (!STATE.modalGps) {
    showToast('GPS wajib aktif sebelum Check-In.', 'error');
    return;
  }
  var namaPenerima = document.getElementById('ci-penerima').value.trim();
  var keterangan = document.getElementById('ci-keterangan').value.trim();
  if (!namaPenerima) {
    showToast('Nama Penerima barang wajib diisi.', 'warning');
    return;
  }
  if (!STATE.modalPhotos.length) {
    showToast('Unggah minimal 1 foto lokasi & penerima.', 'warning');
    return;
  }

  var btn = document.getElementById('gps-required-submit-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span><span>Menyimpan Check-In...</span>';

  callGasApi('checkInOrders', {
    idTrackings: idTrackings,
    gps: STATE.modalGps,
    namaPenerima: namaPenerima,
    keterangan: keterangan,
    photos: STATE.modalPhotos
  })
    .then(function () {
      STATE.tracking.selectedIds = {};
      clearApiCache('tracking_');
      clearApiCache('orders_');
      clearApiCache('dashboard_');
      clearApiCache('report_');
      closeModal();
      fetchDriverTrackingData(true);
      showToast('Check-In Customer beserta GPS & foto berhasil disimpan!', 'success');
    })
    .catch(function (err) {
      showToast(err.message, 'error');
      updateGpsBoxDom();
      var b = document.getElementById('gps-required-submit-btn');
      if (b) {
        b.textContent = 'Simpan Check-In';
      }
    });
}

function openCheckOutModal(idTrackings) {
  if (!idTrackings || !idTrackings.length) {
    return;
  }
  STATE.modalTargetIds = idTrackings.slice();
  STATE.modalGps = null;
  STATE.modalGpsLoading = true;
  STATE.modalGpsError = '';

  var html =
    '<div class="modal-header">' +
      '<h3 class="modal-title">Check-Out dari Customer (' + idTrackings.length + ' DO)</h3>' +
      '<button type="button" class="modal-close" onclick="closeModal()">' + ICONS.x + '</button>' +
    '</div>' +
    '<div class="modal-body">' +
      '<div><div class="form-label" style="margin-bottom:6px">Delivery Order Check-Out:</div>' + buildSelectedDosSummaryHtml(idTrackings) + '</div>' +
      '<div class="form-group">' +
        '<label class="form-label">Status GPS (Wajib Aktif saat Check-Out) <span class="req">*</span></label>' +
        '<div id="gps-box-holder">' + renderGpsStatusBox() + '</div>' +
      '</div>' +
    '</div>' +
    '<div class="modal-footer">' +
      '<button type="button" class="btn btn-secondary" onclick="closeModal()">Batal</button>' +
      '<button id="gps-required-submit-btn" type="button" class="btn btn-emerald" disabled onclick="submitCheckOut()">Konfirmasi Check-Out (Selesai)</button>' +
    '</div>';

  openModal(html);
  acquireModalGps();
}

function submitCheckOut() {
  var idTrackings = STATE.modalTargetIds || [];
  if (!STATE.modalGps) {
    showToast('GPS wajib aktif sebelum Check-Out.', 'error');
    return;
  }
  var btn = document.getElementById('gps-required-submit-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span><span>Menyimpan Check-Out...</span>';

  callGasApi('checkOutOrders', { idTrackings: idTrackings, gps: STATE.modalGps })
    .then(function () {
      STATE.tracking.selectedIds = {};
      clearApiCache('tracking_');
      clearApiCache('orders_');
      clearApiCache('dashboard_');
      clearApiCache('report_');
      closeModal();
      fetchDriverTrackingData(true);
      showToast('Check-Out berhasil! Pengiriman ditandai Selesai.', 'success');
    })
    .catch(function (err) {
      showToast(err.message, 'error');
      updateGpsBoxDom();
      var b = document.getElementById('gps-required-submit-btn');
      if (b) {
        b.textContent = 'Konfirmasi Check-Out (Selesai)';
      }
    });
}

function openFailedModal(idTrackings) {
  if (!idTrackings || !idTrackings.length) {
    return;
  }
  STATE.modalPhotos = [];
  STATE.modalTargetIds = idTrackings.slice();
  STATE.modalGps = null;
  STATE.modalGpsLoading = true;
  STATE.modalGpsError = '';

  var html =
    '<div class="modal-header">' +
      '<h3 class="modal-title">Laporkan Gagal Kirim (' + idTrackings.length + ' DO)</h3>' +
      '<button type="button" class="modal-close" onclick="closeModal()">' + ICONS.x + '</button>' +
    '</div>' +
    '<div class="modal-body">' +
      '<div class="alert-box alert-warning">Setelah status diubah menjadi <strong>Gagal Kirim</strong>, Back Office dapat menjadwalkan kirim ulang Nomor DO ini kepada Driver yang sama atau Driver lain.</div>' +
      '<div><div class="form-label" style="margin-bottom:6px">Delivery Order terkait:</div>' + buildSelectedDosSummaryHtml(idTrackings) + '</div>' +
      '<div class="form-group">' +
        '<label class="form-label">Status GPS (Wajib Aktif) <span class="req">*</span></label>' +
        '<div id="gps-box-holder">' + renderGpsStatusBox() + '</div>' +
      '</div>' +
      '<div class="form-group">' +
        '<label class="form-label" for="fail-alasan">Alasan Gagal Kirim <span class="req">*</span></label>' +
        '<textarea id="fail-alasan" class="form-control" rows="3" placeholder="Contoh: Toko tutup, PIC menolak barang karena tidak sesuai PO, alamat tidak dapat diakses..." required></textarea>' +
      '</div>' +
      renderPhotoUploaderSection('Foto Bukti Kendala di Lapangan', true) +
    '</div>' +
    '<div class="modal-footer">' +
      '<button type="button" class="btn btn-secondary" onclick="closeModal()">Batal</button>' +
      '<button id="gps-required-submit-btn" type="button" class="btn btn-danger" disabled onclick="submitFailedDelivery()">Simpan Status Gagal Kirim</button>' +
    '</div>';

  openModal(html);
  acquireModalGps();
}

function submitFailedDelivery() {
  var idTrackings = STATE.modalTargetIds || [];
  if (!STATE.modalGps) {
    showToast('GPS wajib aktif saat melaporkan Gagal Kirim.', 'error');
    return;
  }
  var alasan = document.getElementById('fail-alasan').value.trim();
  if (!alasan || alasan.length < 3) {
    showToast('Alasan Gagal Kirim wajib diisi minimal 3 karakter.', 'warning');
    return;
  }

  var btn = document.getElementById('gps-required-submit-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span><span>Menyimpan laporan...</span>';

  callGasApi('markFailedDelivery', {
    idTrackings: idTrackings,
    alasan: alasan,
    gps: STATE.modalGps,
    photos: STATE.modalPhotos
  })
    .then(function () {
      STATE.tracking.selectedIds = {};
      clearApiCache('tracking_');
      clearApiCache('orders_');
      clearApiCache('dashboard_');
      clearApiCache('report_');
      closeModal();
      fetchDriverTrackingData(true);
      showToast('Status Gagal Kirim & alasannya berhasil disimpan.', 'info');
    })
    .catch(function (err) {
      showToast(err.message, 'error');
      updateGpsBoxDom();
      var b = document.getElementById('gps-required-submit-btn');
      if (b) {
        b.textContent = 'Simpan Status Gagal Kirim';
      }
    });
}

// ============================================================================
// MODAL DETAIL ORDER (TIMELINE, 6+6 FOTO, GPS MAPS, RIWAYAT KIRIM ULANG)
// ============================================================================

function openOrderDetailModal(idTracking) {
  openModal(
    '<div class="modal-header"><h3 class="modal-title">Detail Delivery Order</h3><button type="button" class="modal-close" onclick="closeModal()">' + ICONS.x + '</button></div>' +
    '<div class="modal-body" style="align-items:center;padding:36px"><span class="spinner dark"></span><span>Memuat detail pengiriman...</span></div>'
  );

  callGasApi('getOrderDetail', { idTracking: idTracking })
    .then(function (data) {
      var d = data.item;
      var logs = data.logs || [];
      var attempts = data.attemptHistory || [];

      var attemptSwitchHtml = '';
      if (attempts.length > 1) {
        var btns = '';
        for (var a = 0; a < attempts.length; a++) {
          var att = attempts[a];
          btns += '<button type="button" class="btn btn-sm ' + (att.idTracking === d.idTracking ? 'btn-navy' : 'btn-secondary') + '" onclick="openOrderDetailModal(\'' + escapeHtml(att.idTracking) + '\')">Percobaan #' + (att.percobaanKe || 1) + ' (' + escapeHtml(att.status) + ')</button>';
        }
        attemptSwitchHtml =
          '<div class="alert-box alert-info">' +
            '<div style="font-weight:700;margin-bottom:6px">Riwayat Percobaan Pengiriman untuk Nomor DO ' + escapeHtml(d.nomorDO) + ':</div>' +
            '<div class="action-cluster">' + btns + '</div>' +
          '</div>';
      }

      var pickUpGallery = renderReadonlyGallery('Foto Barang Pick Up (' + (d.pickUpFotos || []).length + '/6)', d.pickUpFotos);
      var checkInGallery = renderReadonlyGallery('Foto Lokasi & Penerima Check-In (' + (d.checkInFotos || []).length + '/6)', d.checkInFotos);
      var failGallery = (d.gagalKirimFotos && d.gagalKirimFotos.length)
        ? renderReadonlyGallery('Foto Bukti Kendala Gagal Kirim (' + d.gagalKirimFotos.length + '/6)', d.gagalKirimFotos)
        : '';

      var ciMaps = buildGoogleMapsUrl(d.checkInLat, d.checkInLng);
      var coMaps = buildGoogleMapsUrl(d.checkOutLat, d.checkOutLng);
      var failMaps = buildGoogleMapsUrl(d.gagalKirimLat, d.gagalKirimLng);

      var logsHtml = '';
      for (var l = 0; l < logs.length; l++) {
        var lg = logs[l];
        logsHtml +=
          '<div class="timeline-item">' +
            '<div class="cell-strong">' + escapeHtml(lg.aksi) + ' · <span style="font-weight:500;color:var(--text-muted)">' + formatDateTimeID(lg.timestamp) + '</span></div>' +
            '<div class="cell-sub">' + escapeHtml(lg.namaUser) + (lg.koordinatGPS ? ' · GPS: ' + escapeHtml(lg.koordinatGPS) : '') + '</div>' +
            '<div class="cell-sub">' + escapeHtml(lg.catatan) + '</div>' +
          '</div>';
      }

      var html =
        '<div class="modal-header">' +
          '<div>' +
            '<h3 class="modal-title">' + escapeHtml(d.nomorDO) + ' ' + getStatusBadgeHtml(d.status) + '</h3>' +
            '<div class="cell-sub">' + escapeHtml(d.idTracking) + ' · Tanggal DO: ' + formatDateID(d.tanggalDO) + ' · Percobaan #' + (d.percobaanKe || 1) + '</div>' +
          '</div>' +
          '<button type="button" class="modal-close" onclick="closeModal()">' + ICONS.x + '</button>' +
        '</div>' +
        '<div class="modal-body">' +
          attemptSwitchHtml +
          '<div class="form-grid-2">' +
            '<div class="card" style="padding:12px">' +
              '<div class="cell-sub">Customer</div>' +
              '<div class="cell-strong">' + escapeHtml(d.namaCustomer) + '</div>' +
              '<div class="cell-sub">' + escapeHtml(d.customerAlamat || '-') + '</div>' +
              (d.customerWhatsApp ? '<div style="margin-top:6px"><a class="btn btn-outline-emerald btn-sm" target="_blank" rel="noopener" href="' + escapeHtml(buildWhatsAppUrl(d.customerWhatsApp, '')) + '">' + ICONS.phone + '<span>WhatsApp Customer</span></a></div>' : '') +
            '</div>' +
            '<div class="card" style="padding:12px">' +
              '<div class="cell-sub">Driver, Mobil & Back Office</div>' +
              '<div class="cell-strong">' + escapeHtml(d.namaDriver) + '</div>' +
              '<div class="cell-sub">Mobil: <strong>' + escapeHtml(d.platMobil || '-') + '</strong>' + (d.jenisMobil ? ' (' + escapeHtml(d.jenisMobil) + ')' : '') + '</div>' +
              '<div class="cell-sub">Diinput Back Office: ' + escapeHtml(d.namaBackOffice) + '</div>' +
              (d.driverWhatsApp ? '<div style="margin-top:6px"><a class="btn btn-outline-emerald btn-sm" target="_blank" rel="noopener" href="' + escapeHtml(buildWhatsAppUrl(d.driverWhatsApp, '')) + '">' + ICONS.phone + '<span>WhatsApp Driver</span></a></div>' : '') +
            '</div>' +
          '</div>' +
          '<div class="card" style="padding:12px">' +
            '<div class="cell-strong" style="margin-bottom:8px">Ringkasan Tahap Lapangan</div>' +
            '<div class="form-grid-2">' +
              '<div><div class="cell-sub">Pick Up Batch: <strong>' + escapeHtml(d.idPickUpBatch || '-') + '</strong></div><div class="cell-sub">Waktu: ' + formatDateTimeID(d.waktuPickUp) + '</div></div>' +
              '<div><div class="cell-sub">Penerima: <strong>' + escapeHtml(d.namaPenerima || '-') + '</strong></div><div class="cell-sub">Keterangan: ' + escapeHtml(d.keterangan || '-') + '</div></div>' +
              '<div><div class="cell-sub">Check-In: ' + formatDateTimeID(d.waktuCheckIn) + '</div>' + (ciMaps ? '<a target="_blank" rel="noopener" href="' + escapeHtml(ciMaps) + '">Lihat Lokasi GPS Check-In (' + d.checkInLat + ', ' + d.checkInLng + ')</a>' : '') + '</div>' +
              '<div><div class="cell-sub">Check-Out: ' + formatDateTimeID(d.waktuCheckOut) + ' (' + formatDuration(d.waktuCheckIn, d.waktuCheckOut) + ')</div>' + (coMaps ? '<a target="_blank" rel="noopener" href="' + escapeHtml(coMaps) + '">Lihat Lokasi GPS Check-Out (' + d.checkOutLat + ', ' + d.checkOutLng + ')</a>' : '') + '</div>' +
            '</div>' +
            (d.status === 'Gagal Kirim'
              ? '<div class="alert-box alert-danger" style="margin-top:10px"><strong>Gagal Kirim (' + formatDateTimeID(d.waktuGagalKirim) + '):</strong> ' + escapeHtml(d.alasanGagalKirim) + (failMaps ? ' · <a target="_blank" rel="noopener" href="' + escapeHtml(failMaps) + '">Lihat GPS Gagal Kirim</a>' : '') + '</div>'
              : '') +
          '</div>' +
          pickUpGallery +
          checkInGallery +
          failGallery +
          '<div><div class="cell-strong" style="margin-bottom:8px">Log Aktivitas</div><div class="timeline-list">' + (logsHtml || '<div class="cell-sub">Belum ada log.</div>') + '</div></div>' +
        '</div>' +
        '<div class="modal-footer">' +
          '<button type="button" class="btn btn-secondary" onclick="closeModal()">Tutup</button>' +
        '</div>';

      openModal(html, true);
    })
    .catch(function (err) {
      closeModal();
      showToast(err.message, 'error');
    });
}

function renderReadonlyGallery(title, urls) {
  if (!urls || !urls.length) {
    return '<div><div class="cell-strong" style="margin-bottom:4px">' + escapeHtml(title) + '</div><div class="cell-sub">Belum ada foto diunggah.</div></div>';
  }
  var thumbs = '';
  for (var i = 0; i < urls.length; i++) {
    thumbs += '<a class="gallery-thumb" href="' + escapeHtml(urls[i]) + '" target="_blank" rel="noopener"><img src="' + escapeHtml(urls[i]) + '" alt="Bukti foto ' + (i + 1) + '" loading="lazy" /></a>';
  }
  return '<div><div class="cell-strong" style="margin-bottom:6px">' + escapeHtml(title) + '</div><div class="gallery-grid">' + thumbs + '</div></div>';
}

// ============================================================================
// MASTER KARYAWAN, MASTER CUSTOMER & MASTER MOBIL
// ============================================================================

function fetchKaryawanData(forceRefresh, fetchOpts) {
  var silent = Boolean(fetchOpts && fetchOpts.silent);
  var f = STATE.karyawan.filters;
  var payload = { page: STATE.karyawan.page, limit: STATE.karyawan.limit, search: f.search, divisi: f.divisi, status: f.status };
  var cacheKey = 'karyawan_' + JSON.stringify(payload);
  var servedFromCache = !forceRefresh && hasCacheEntry(cacheKey);
  if (!servedFromCache) {
    setSyncVisualState(true, false);
  }

  callGasApi('listKaryawan', payload, {
    cacheKey: cacheKey,
    forceRefresh: Boolean(forceRefresh)
  }).then(function (data) {
    var snap = JSON.stringify({ query: payload, data: data });
    var changed = STATE.lastSnapshots.karyawan !== snap;

    STATE.karyawan.items = data.items || [];
    STATE.karyawan.total = data.total || 0;
    STATE.karyawan.page = data.page || 1;
    STATE.karyawan.totalPages = data.totalPages || 1;
    STATE.lastSnapshots.karyawan = snap;

    setSyncVisualState(false, !servedFromCache || Boolean(forceRefresh));

    if (STATE.currentPage === 'karyawan' && (changed || (!silent && !servedFromCache))) {
      renderApp();
    }
    if (servedFromCache && !silent) {
      fetchKaryawanData(true, { silent: true });
    }
  }).catch(function (err) {
    setSyncVisualState(false, false);
    if (!silent) {
      showToast(err.message, 'error');
    }
  });
}

function applyKaryawanFilter() {
  STATE.karyawan.filters.search = document.getElementById('kry-search').value.trim();
  STATE.karyawan.filters.divisi = document.getElementById('kry-divisi').value;
  STATE.karyawan.filters.status = document.getElementById('kry-status').value;
  STATE.karyawan.page = 1;
  fetchKaryawanData(false);
}

function changeKaryawanPage(p) {
  STATE.karyawan.page = p;
  fetchKaryawanData(false);
}

function renderKaryawanView() {
  var f = STATE.karyawan.filters;
  var items = STATE.karyawan.items;
  var rowsHtml = '';

  if (!items.length) {
    rowsHtml = '<tr><td colspan="6" class="empty-state">Tidak ada data karyawan.</td></tr>';
  } else {
    for (var i = 0; i < items.length; i++) {
      var k = items[i];
      var badgeDivisi = k.divisi === 'Back Office' ? '<span class="badge badge-info">Back Office</span>' : '<span class="badge badge-jalan">Driver</span>';
      var badgeStatus = k.status === 'Aktif' ? '<span class="badge badge-selesai">Aktif</span>' : '<span class="badge badge-gagal">Nonaktif</span>';

      rowsHtml +=
        '<tr>' +
          '<td><div class="cell-strong">' + escapeHtml(k.idKaryawan) + '</div></td>' +
          '<td><div class="cell-strong">' + escapeHtml(k.namaKaryawan) + '</div><div class="cell-sub">@' + escapeHtml(k.username) + '</div></td>' +
          '<td>' + badgeDivisi + '</td>' +
          '<td>' + escapeHtml(k.noWhatsApp || '-') + '</td>' +
          '<td>' + badgeStatus + '</td>' +
          '<td><button type="button" class="btn btn-secondary btn-sm" onclick="openKaryawanModal(\'' + escapeHtml(k.idKaryawan) + '\')">' + ICONS.edit + '<span>Edit</span></button></td>' +
        '</tr>';
    }
  }

  return (
    '<div class="page-header">' +
      '<div>' +
        '<h2 class="page-title">Master Karyawan</h2>' +
        '<p class="page-subtitle">Kelola data karyawan beserta akun login divisi Back Office dan Driver</p>' +
      '</div>' +
      '<div class="header-actions">' +
        renderSyncStatusBadge() +
        '<button type="button" class="btn btn-primary" onclick="openKaryawanModal(\'\')">' + ICONS.plus + '<span>Tambah Karyawan</span></button>' +
      '</div>' +
    '</div>' +
    '<div class="card" style="margin-bottom:14px">' +
      '<div class="filter-bar" style="margin-bottom:0">' +
        '<div class="form-group"><label class="form-label">Cari Karyawan</label><input id="kry-search" class="form-control" type="text" value="' + escapeHtml(f.search) + '" placeholder="Nama, ID, username..." onkeydown="if(event.key===\'Enter\'){event.preventDefault();applyKaryawanFilter();}" /></div>' +
        '<div class="form-group"><label class="form-label">Divisi</label><select id="kry-divisi" class="form-control"><option value="">Semua Divisi</option><option value="Back Office" ' + (f.divisi === 'Back Office' ? 'selected' : '') + '>Back Office</option><option value="Driver" ' + (f.divisi === 'Driver' ? 'selected' : '') + '>Driver</option></select></div>' +
        '<div class="form-group"><label class="form-label">Status</label><select id="kry-status" class="form-control"><option value="">Semua</option><option value="Aktif" ' + (f.status === 'Aktif' ? 'selected' : '') + '>Aktif</option><option value="Nonaktif" ' + (f.status === 'Nonaktif' ? 'selected' : '') + '>Nonaktif</option></select></div>' +
        '<div class="form-group"><button type="button" class="btn btn-navy" onclick="applyKaryawanFilter()">Filter</button></div>' +
      '</div>' +
    '</div>' +
    '<div class="table-card">' +
      '<div class="table-wrap"><table class="data-table"><thead><tr><th>ID Karyawan</th><th>Nama & Username</th><th>Divisi</th><th>No. WhatsApp</th><th>Status</th><th>Aksi</th></tr></thead><tbody>' + rowsHtml + '</tbody></table></div>' +
      renderPaginationBar(STATE.karyawan.page, STATE.karyawan.totalPages, STATE.karyawan.total, 'changeKaryawanPage') +
    '</div>'
  );
}

function openKaryawanModal(idKaryawan) {
  var item = null;
  if (idKaryawan) {
    for (var i = 0; i < STATE.karyawan.items.length; i++) {
      if (STATE.karyawan.items[i].idKaryawan === idKaryawan) {
        item = STATE.karyawan.items[i];
        break;
      }
    }
  }
  var isEdit = Boolean(item);

  var html =
    '<div class="modal-header"><h3 class="modal-title">' + (isEdit ? 'Ubah Data Karyawan' : 'Tambah Karyawan Baru') + '</h3><button type="button" class="modal-close" onclick="closeModal()">' + ICONS.x + '</button></div>' +
    '<form id="karyawan-form">' +
      '<div class="modal-body">' +
        '<div class="form-grid-2">' +
          '<div class="form-group"><label class="form-label">Nama Lengkap <span class="req">*</span></label><input id="kf-nama" class="form-control" type="text" value="' + escapeHtml(item ? item.namaKaryawan : '') + '" required /></div>' +
          '<div class="form-group"><label class="form-label">Divisi <span class="req">*</span></label><select id="kf-divisi" class="form-control" required><option value="Driver" ' + (item && item.divisi === 'Driver' ? 'selected' : '') + '>Driver</option><option value="Back Office" ' + (item && item.divisi === 'Back Office' ? 'selected' : '') + '>Back Office</option></select></div>' +
        '</div>' +
        '<div class="form-grid-2">' +
          '<div class="form-group"><label class="form-label">No. WhatsApp</label><input id="kf-wa" class="form-control" type="text" value="' + escapeHtml(item ? item.noWhatsApp : '') + '" placeholder="0812xxxxxxxx" /></div>' +
          '<div class="form-group"><label class="form-label">Status</label><select id="kf-status" class="form-control"><option value="Aktif" ' + (!item || item.status === 'Aktif' ? 'selected' : '') + '>Aktif</option><option value="Nonaktif" ' + (item && item.status === 'Nonaktif' ? 'selected' : '') + '>Nonaktif</option></select></div>' +
        '</div>' +
        '<div class="form-grid-2">' +
          '<div class="form-group"><label class="form-label">Username Login <span class="req">*</span></label><input id="kf-user" class="form-control" type="text" value="' + escapeHtml(item ? item.username : '') + '" required /></div>' +
          '<div class="form-group"><label class="form-label">Password ' + (isEdit ? '(Kosongkan jika tidak ubah)' : '<span class="req">*</span>') + '</label><input id="kf-pass" class="form-control" type="password" ' + (isEdit ? '' : 'required') + ' placeholder="Minimal 4 karakter" /></div>' +
        '</div>' +
      '</div>' +
      '<div class="modal-footer">' +
        '<button type="button" class="btn btn-secondary" onclick="closeModal()">Batal</button>' +
        '<button id="kf-save-btn" type="submit" class="btn btn-primary">Simpan Karyawan</button>' +
      '</div>' +
    '</form>';

  openModal(html);

  document.getElementById('karyawan-form').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var btn = document.getElementById('kf-save-btn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span><span>Menyimpan...</span>';

    callGasApi('saveKaryawan', {
      idKaryawan: item ? item.idKaryawan : '',
      namaKaryawan: document.getElementById('kf-nama').value.trim(),
      divisi: document.getElementById('kf-divisi').value,
      noWhatsApp: document.getElementById('kf-wa').value.trim(),
      status: document.getElementById('kf-status').value,
      username: document.getElementById('kf-user').value.trim(),
      password: document.getElementById('kf-pass').value
    }).then(function () {
      clearApiCache('karyawan_');
      clearApiCache('dropdowns');
      closeModal();
      fetchKaryawanData(true);
      showToast('Data karyawan berhasil disimpan.', 'success');
    }).catch(function (err) {
      showToast(err.message, 'error');
      btn.disabled = false;
      btn.textContent = 'Simpan Karyawan';
    });
  });
}

function fetchCustomerData(forceRefresh, fetchOpts) {
  var silent = Boolean(fetchOpts && fetchOpts.silent);
  var f = STATE.customer.filters;
  var payload = { page: STATE.customer.page, limit: STATE.customer.limit, search: f.search, status: f.status };
  var cacheKey = 'customer_' + JSON.stringify(payload);
  var servedFromCache = !forceRefresh && hasCacheEntry(cacheKey);
  if (!servedFromCache) {
    setSyncVisualState(true, false);
  }

  callGasApi('listCustomer', payload, {
    cacheKey: cacheKey,
    forceRefresh: Boolean(forceRefresh)
  }).then(function (data) {
    var snap = JSON.stringify({ query: payload, data: data });
    var changed = STATE.lastSnapshots.customer !== snap;

    STATE.customer.items = data.items || [];
    STATE.customer.total = data.total || 0;
    STATE.customer.page = data.page || 1;
    STATE.customer.totalPages = data.totalPages || 1;
    STATE.lastSnapshots.customer = snap;

    setSyncVisualState(false, !servedFromCache || Boolean(forceRefresh));

    if (STATE.currentPage === 'customer' && (changed || (!silent && !servedFromCache))) {
      renderApp();
    }
    if (servedFromCache && !silent) {
      fetchCustomerData(true, { silent: true });
    }
  }).catch(function (err) {
    setSyncVisualState(false, false);
    if (!silent) {
      showToast(err.message, 'error');
    }
  });
}

function applyCustomerFilter() {
  STATE.customer.filters.search = document.getElementById('cst-search').value.trim();
  STATE.customer.filters.status = document.getElementById('cst-status').value;
  STATE.customer.page = 1;
  fetchCustomerData(false);
}

function changeCustomerPage(p) {
  STATE.customer.page = p;
  fetchCustomerData(false);
}

function renderCustomerView() {
  var f = STATE.customer.filters;
  var items = STATE.customer.items;
  var rowsHtml = '';

  if (!items.length) {
    rowsHtml = '<tr><td colspan="6" class="empty-state">Tidak ada data customer.</td></tr>';
  } else {
    for (var i = 0; i < items.length; i++) {
      var c = items[i];
      var badgeStatus = c.status === 'Aktif' ? '<span class="badge badge-selesai">Aktif</span>' : '<span class="badge badge-gagal">Nonaktif</span>';
      rowsHtml +=
        '<tr>' +
          '<td><div class="cell-strong">' + escapeHtml(c.idCustomer) + '</div></td>' +
          '<td><div class="cell-strong">' + escapeHtml(c.namaCustomer) + '</div></td>' +
          '<td>' + escapeHtml(c.alamat || '-') + '</td>' +
          '<td><div>' + escapeHtml(c.namaPIC || '-') + '</div><div class="cell-sub">' + escapeHtml(c.noWhatsApp || '-') + '</div></td>' +
          '<td>' + badgeStatus + '</td>' +
          '<td><button type="button" class="btn btn-secondary btn-sm" onclick="openCustomerModal(\'' + escapeHtml(c.idCustomer) + '\')">' + ICONS.edit + '<span>Edit</span></button></td>' +
        '</tr>';
    }
  }

  return (
    '<div class="page-header">' +
      '<div>' +
        '<h2 class="page-title">Master Customer</h2>' +
        '<p class="page-subtitle">Kelola data tujuan pengiriman, alamat lengkap, dan kontak penerima customer</p>' +
      '</div>' +
      '<div class="header-actions">' +
        renderSyncStatusBadge() +
        '<button type="button" class="btn btn-primary" onclick="openCustomerModal(\'\')">' + ICONS.plus + '<span>Tambah Customer</span></button>' +
      '</div>' +
    '</div>' +
    '<div class="card" style="margin-bottom:14px">' +
      '<div class="filter-bar" style="margin-bottom:0">' +
        '<div class="form-group"><label class="form-label">Cari Customer</label><input id="cst-search" class="form-control" type="text" value="' + escapeHtml(f.search) + '" placeholder="Nama customer, alamat, PIC..." onkeydown="if(event.key===\'Enter\'){event.preventDefault();applyCustomerFilter();}" /></div>' +
        '<div class="form-group"><label class="form-label">Status</label><select id="cst-status" class="form-control"><option value="">Semua</option><option value="Aktif" ' + (f.status === 'Aktif' ? 'selected' : '') + '>Aktif</option><option value="Nonaktif" ' + (f.status === 'Nonaktif' ? 'selected' : '') + '>Nonaktif</option></select></div>' +
        '<div class="form-group"><button type="button" class="btn btn-navy" onclick="applyCustomerFilter()">Filter</button></div>' +
      '</div>' +
    '</div>' +
    '<div class="table-card">' +
      '<div class="table-wrap"><table class="data-table"><thead><tr><th>ID Customer</th><th>Nama Customer</th><th>Alamat</th><th>PIC & WhatsApp</th><th>Status</th><th>Aksi</th></tr></thead><tbody>' + rowsHtml + '</tbody></table></div>' +
      renderPaginationBar(STATE.customer.page, STATE.customer.totalPages, STATE.customer.total, 'changeCustomerPage') +
    '</div>'
  );
}

function openCustomerModal(idCustomer) {
  var item = null;
  if (idCustomer) {
    for (var i = 0; i < STATE.customer.items.length; i++) {
      if (STATE.customer.items[i].idCustomer === idCustomer) {
        item = STATE.customer.items[i];
        break;
      }
    }
  }
  var isEdit = Boolean(item);

  var html =
    '<div class="modal-header"><h3 class="modal-title">' + (isEdit ? 'Ubah Data Customer' : 'Tambah Customer Baru') + '</h3><button type="button" class="modal-close" onclick="closeModal()">' + ICONS.x + '</button></div>' +
    '<form id="customer-form">' +
      '<div class="modal-body">' +
        '<div class="form-group"><label class="form-label">Nama Customer <span class="req">*</span></label><input id="cf-nama" class="form-control" type="text" value="' + escapeHtml(item ? item.namaCustomer : '') + '" required /></div>' +
        '<div class="form-group"><label class="form-label">Alamat Lengkap</label><textarea id="cf-alamat" class="form-control" rows="2">' + escapeHtml(item ? item.alamat : '') + '</textarea></div>' +
        '<div class="form-grid-2">' +
          '<div class="form-group"><label class="form-label">Nama PIC / Penerima</label><input id="cf-pic" class="form-control" type="text" value="' + escapeHtml(item ? item.namaPIC : '') + '" /></div>' +
          '<div class="form-group"><label class="form-label">No. WhatsApp</label><input id="cf-wa" class="form-control" type="text" value="' + escapeHtml(item ? item.noWhatsApp : '') + '" placeholder="0812xxxxxxxx" /></div>' +
        '</div>' +
        '<div class="form-group"><label class="form-label">Status</label><select id="cf-status" class="form-control"><option value="Aktif" ' + (!item || item.status === 'Aktif' ? 'selected' : '') + '>Aktif</option><option value="Nonaktif" ' + (item && item.status === 'Nonaktif' ? 'selected' : '') + '>Nonaktif</option></select></div>' +
      '</div>' +
      '<div class="modal-footer">' +
        '<button type="button" class="btn btn-secondary" onclick="closeModal()">Batal</button>' +
        '<button id="cf-save-btn" type="submit" class="btn btn-primary">Simpan Customer</button>' +
      '</div>' +
    '</form>';

  openModal(html);

  document.getElementById('customer-form').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var btn = document.getElementById('cf-save-btn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span><span>Menyimpan...</span>';

    callGasApi('saveCustomer', {
      idCustomer: item ? item.idCustomer : '',
      namaCustomer: document.getElementById('cf-nama').value.trim(),
      alamat: document.getElementById('cf-alamat').value.trim(),
      namaPIC: document.getElementById('cf-pic').value.trim(),
      noWhatsApp: document.getElementById('cf-wa').value.trim(),
      status: document.getElementById('cf-status').value
    }).then(function () {
      clearApiCache('customer_');
      clearApiCache('dropdowns');
      closeModal();
      fetchCustomerData(true);
      showToast('Data customer berhasil disimpan.', 'success');
    }).catch(function (err) {
      showToast(err.message, 'error');
      btn.disabled = false;
      btn.textContent = 'Simpan Customer';
    });
  });
}

function fetchMobilData(forceRefresh, fetchOpts) {
  var silent = Boolean(fetchOpts && fetchOpts.silent);
  var f = STATE.mobil.filters;
  var payload = { page: STATE.mobil.page, limit: STATE.mobil.limit, search: f.search, status: f.status };
  var cacheKey = 'mobil_' + JSON.stringify(payload);
  var servedFromCache = !forceRefresh && hasCacheEntry(cacheKey);
  if (!servedFromCache) {
    setSyncVisualState(true, false);
  }

  callGasApi('listMobil', payload, {
    cacheKey: cacheKey,
    forceRefresh: Boolean(forceRefresh)
  }).then(function (data) {
    var snap = JSON.stringify({ query: payload, data: data });
    var changed = STATE.lastSnapshots.mobil !== snap;

    STATE.mobil.items = data.items || [];
    STATE.mobil.total = data.total || 0;
    STATE.mobil.page = data.page || 1;
    STATE.mobil.totalPages = data.totalPages || 1;
    STATE.lastSnapshots.mobil = snap;

    setSyncVisualState(false, !servedFromCache || Boolean(forceRefresh));

    if (STATE.currentPage === 'mobil' && (changed || (!silent && !servedFromCache))) {
      renderApp();
    }
    if (servedFromCache && !silent) {
      fetchMobilData(true, { silent: true });
    }
  }).catch(function (err) {
    setSyncVisualState(false, false);
    if (!silent) {
      showToast(err.message, 'error');
    }
  });
}

function applyMobilFilter() {
  STATE.mobil.filters.search = document.getElementById('mbl-search').value.trim();
  STATE.mobil.filters.status = document.getElementById('mbl-status').value;
  STATE.mobil.page = 1;
  fetchMobilData(false);
}

function changeMobilPage(p) {
  STATE.mobil.page = p;
  fetchMobilData(false);
}

function renderMobilView() {
  var f = STATE.mobil.filters;
  var items = STATE.mobil.items;
  var rowsHtml = '';

  if (!items.length) {
    rowsHtml = '<tr><td colspan="5" class="empty-state">Tidak ada data mobil.</td></tr>';
  } else {
    for (var i = 0; i < items.length; i++) {
      var m = items[i];
      var badgeStatus = m.status === 'Aktif' ? '<span class="badge badge-selesai">Aktif</span>' : '<span class="badge badge-gagal">Nonaktif</span>';
      rowsHtml +=
        '<tr>' +
          '<td><div class="cell-strong">' + escapeHtml(m.idMobil) + '</div></td>' +
          '<td><div class="cell-strong">' + escapeHtml(m.platMobil) + '</div></td>' +
          '<td>' + escapeHtml(m.jenisMobil || '-') + '</td>' +
          '<td>' + badgeStatus + '</td>' +
          '<td><button type="button" class="btn btn-secondary btn-sm" onclick="openMobilModal(\'' + escapeHtml(m.idMobil) + '\')">' + ICONS.edit + '<span>Edit</span></button></td>' +
        '</tr>';
    }
  }

  return (
    '<div class="page-header">' +
      '<div>' +
        '<h2 class="page-title">Master Mobil</h2>' +
        '<p class="page-subtitle">Kelola data plat nomor kendaraan dan jenis mobil untuk pengiriman Delivery Order</p>' +
      '</div>' +
      '<div class="header-actions">' +
        renderSyncStatusBadge() +
        '<button type="button" class="btn btn-primary" onclick="openMobilModal(\'\')">' + ICONS.plus + '<span>Tambah Mobil</span></button>' +
      '</div>' +
    '</div>' +
    '<div class="card" style="margin-bottom:14px">' +
      '<div class="filter-bar" style="margin-bottom:0">' +
        '<div class="form-group"><label class="form-label">Cari Plat / Jenis Mobil</label><input id="mbl-search" class="form-control" type="text" value="' + escapeHtml(f.search) + '" placeholder="Plat mobil, jenis mobil, ID..." onkeydown="if(event.key===\'Enter\'){event.preventDefault();applyMobilFilter();}" /></div>' +
        '<div class="form-group"><label class="form-label">Status</label><select id="mbl-status" class="form-control"><option value="">Semua</option><option value="Aktif" ' + (f.status === 'Aktif' ? 'selected' : '') + '>Aktif</option><option value="Nonaktif" ' + (f.status === 'Nonaktif' ? 'selected' : '') + '>Nonaktif</option></select></div>' +
        '<div class="form-group"><button type="button" class="btn btn-navy" onclick="applyMobilFilter()">Filter</button></div>' +
      '</div>' +
    '</div>' +
    '<div class="table-card">' +
      '<div class="table-wrap"><table class="data-table"><thead><tr><th>ID Mobil</th><th>Plat Mobil</th><th>Jenis Mobil</th><th>Status</th><th>Aksi</th></tr></thead><tbody>' + rowsHtml + '</tbody></table></div>' +
      renderPaginationBar(STATE.mobil.page, STATE.mobil.totalPages, STATE.mobil.total, 'changeMobilPage') +
    '</div>'
  );
}

function openMobilModal(idMobil) {
  var item = null;
  if (idMobil) {
    for (var i = 0; i < STATE.mobil.items.length; i++) {
      if (STATE.mobil.items[i].idMobil === idMobil) {
        item = STATE.mobil.items[i];
        break;
      }
    }
  }
  var isEdit = Boolean(item);

  var html =
    '<div class="modal-header"><h3 class="modal-title">' + (isEdit ? 'Ubah Data Mobil' : 'Tambah Mobil Baru') + '</h3><button type="button" class="modal-close" onclick="closeModal()">' + ICONS.x + '</button></div>' +
    '<form id="mobil-form">' +
      '<div class="modal-body">' +
        '<div class="form-group">' +
          '<label class="form-label" for="mbl-plat">Plat Mobil <span class="req">*</span></label>' +
          '<input id="mbl-plat" class="form-control" type="text" style="text-transform:uppercase" value="' + escapeHtml(item ? item.platMobil : '') + '" placeholder="Contoh: B 9123 PIF" required />' +
        '</div>' +
        '<div class="form-group">' +
          '<label class="form-label" for="mbl-jenis">Jenis Mobil <span class="req">*</span></label>' +
          '<input id="mbl-jenis" class="form-control" type="text" list="jenis-mobil-suggestions" value="' + escapeHtml(item ? item.jenisMobil : '') + '" placeholder="Contoh: Blind Van, Pick Up Box, Engkel CDE, CDD Box..." required />' +
          '<datalist id="jenis-mobil-suggestions">' +
            '<option value="Blind Van"></option>' +
            '<option value="Pick Up Box"></option>' +
            '<option value="Pick Up Bak"></option>' +
            '<option value="Gran Max Box"></option>' +
            '<option value="Engkel Box (CDE)"></option>' +
            '<option value="CDD Box"></option>' +
            '<option value="Fuso Box"></option>' +
            '<option value="Wingbox"></option>' +
          '</datalist>' +
        '</div>' +
        '<div class="form-group">' +
          '<label class="form-label" for="mbl-status">Status</label>' +
          '<select id="mbl-status" class="form-control"><option value="Aktif" ' + (!item || item.status === 'Aktif' ? 'selected' : '') + '>Aktif</option><option value="Nonaktif" ' + (item && item.status === 'Nonaktif' ? 'selected' : '') + '>Nonaktif</option></select>' +
        '</div>' +
      '</div>' +
      '<div class="modal-footer">' +
        '<button type="button" class="btn btn-secondary" onclick="closeModal()">Batal</button>' +
        '<button id="mbl-save-btn" type="submit" class="btn btn-primary">Simpan Mobil</button>' +
      '</div>' +
    '</form>';

  openModal(html);

  document.getElementById('mobil-form').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var btn = document.getElementById('mbl-save-btn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span><span>Menyimpan...</span>';

    callGasApi('saveMobil', {
      idMobil: item ? item.idMobil : '',
      platMobil: document.getElementById('mbl-plat').value.trim().toUpperCase(),
      jenisMobil: document.getElementById('mbl-jenis').value.trim(),
      status: document.getElementById('mbl-status').value
    }).then(function () {
      clearApiCache('mobil_');
      clearApiCache('dropdowns');
      closeModal();
      fetchMobilData(true);
      showToast('Data mobil berhasil disimpan.', 'success');
    }).catch(function (err) {
      showToast(err.message, 'error');
      btn.disabled = false;
      btn.textContent = 'Simpan Mobil';
    });
  });
}

// ============================================================================
// LAPORAN DELIVERY (FILTER BACKEND + EXPORT PDF & EXCEL)
// ============================================================================

function fetchReportData(forceRefresh, fetchOpts) {
  var silent = Boolean(fetchOpts && fetchOpts.silent);
  var f = STATE.report.filters;
  var payload = {
    page: STATE.report.page,
    limit: STATE.report.limit,
    dateFrom: f.dateFrom,
    dateTo: f.dateTo,
    driverId: f.driverId,
    customerId: f.customerId,
    status: f.status,
    search: f.search,
    exportAll: false
  };
  var cacheKey = 'report_' + JSON.stringify(payload);
  var servedFromCache = !forceRefresh && hasCacheEntry(cacheKey);
  if (!servedFromCache) {
    setSyncVisualState(true, false);
  }

  callGasApi('getDeliveryReport', payload, {
    cacheKey: cacheKey,
    forceRefresh: Boolean(forceRefresh)
  }).then(function (data) {
    var snap = JSON.stringify({ query: payload, data: data });
    var changed = STATE.lastSnapshots.report !== snap;

    STATE.report.items = data.items || [];
    STATE.report.total = data.total || 0;
    STATE.report.page = data.page || 1;
    STATE.report.totalPages = data.totalPages || 1;
    STATE.report.summary = data.summary || STATE.report.summary;
    STATE.lastSnapshots.report = snap;

    setSyncVisualState(false, !servedFromCache || Boolean(forceRefresh));

    if (STATE.currentPage === 'report' && (changed || (!silent && !servedFromCache))) {
      renderApp();
    }
    if (servedFromCache && !silent) {
      fetchReportData(true, { silent: true });
    }
  }).catch(function (err) {
    setSyncVisualState(false, false);
    if (!silent) {
      showToast(err.message, 'error');
    }
  });
}

function applyReportFilter() {
  STATE.report.filters.dateFrom = document.getElementById('rep-from').value;
  STATE.report.filters.dateTo = document.getElementById('rep-to').value;
  STATE.report.filters.driverId = document.getElementById('rep-driver').value;
  STATE.report.filters.customerId = document.getElementById('rep-customer').value;
  STATE.report.filters.status = document.getElementById('rep-status').value;
  STATE.report.filters.search = document.getElementById('rep-search').value.trim();
  STATE.report.page = 1;
  fetchReportData(false);
}

function changeReportPage(p) {
  STATE.report.page = p;
  fetchReportData(false);
}

function triggerExportReport(formatType) {
  var f = STATE.report.filters;
  showToast('Menyiapkan seluruh data untuk export ' + formatType.toUpperCase() + '...', 'info');
  callGasApi('getDeliveryReport', {
    dateFrom: f.dateFrom,
    dateTo: f.dateTo,
    driverId: f.driverId,
    customerId: f.customerId,
    status: f.status,
    search: f.search,
    exportAll: true
  }).then(function (data) {
    if (formatType === 'pdf') {
      exportReportToPdf(data.items || [], data.summary || {}, f);
    } else {
      exportReportToExcel(data.items || [], data.summary || {}, f);
    }
  }).catch(function (err) {
    showToast(err.message, 'error');
  });
}

function renderReportView() {
  var f = STATE.report.filters;
  var s = STATE.report.summary;
  var drivers = STATE.dropdowns.drivers || [];
  var customers = STATE.dropdowns.customers || [];

  var drvOpts = '<option value="">Semua Driver</option>';
  for (var d = 0; d < drivers.length; d++) {
    drvOpts += '<option value="' + escapeHtml(drivers[d].idKaryawan) + '" ' + (f.driverId === drivers[d].idKaryawan ? 'selected' : '') + '>' + escapeHtml(drivers[d].namaKaryawan) + '</option>';
  }

  var cstOpts = '<option value="">Semua Customer</option>';
  for (var c = 0; c < customers.length; c++) {
    cstOpts += '<option value="' + escapeHtml(customers[c].idCustomer) + '" ' + (f.customerId === customers[c].idCustomer ? 'selected' : '') + '>' + escapeHtml(customers[c].namaCustomer) + '</option>';
  }

  var statuses = ['', 'Siap Pick Up', 'Dalam Perjalanan', 'Check-In Customer', 'Selesai', 'Gagal Kirim'];
  var stOpts = '';
  for (var st = 0; st < statuses.length; st++) {
    var sv = statuses[st];
    stOpts += '<option value="' + escapeHtml(sv) + '" ' + (f.status === sv ? 'selected' : '') + '>' + (sv || 'Semua Status') + '</option>';
  }

  var items = STATE.report.items;
  var rowsHtml = '';
  if (!items.length) {
    rowsHtml = '<tr><td colspan="7" class="empty-state">Tidak ada data laporan sesuai filter.</td></tr>';
  } else {
    for (var i = 0; i < items.length; i++) {
      var r = items[i];
      var repMobilText = r.platMobil
        ? escapeHtml(r.platMobil) + (r.jenisMobil ? ' (' + escapeHtml(r.jenisMobil) + ')' : '')
        : '-';
      rowsHtml +=
        '<tr>' +
          '<td><div class="cell-strong">' + escapeHtml(r.nomorDO) + '</div><div class="cell-sub">' + escapeHtml(r.idTracking) + ' · #' + (r.percobaanKe || 1) + '</div></td>' +
          '<td>' + formatDateID(r.tanggalDO) + '</td>' +
          '<td><div class="cell-strong">' + escapeHtml(r.namaCustomer) + '</div><div class="cell-sub">Driver: ' + escapeHtml(r.namaDriver) + '</div><div class="cell-sub">Mobil: ' + repMobilText + '</div></td>' +
          '<td>' + getStatusBadgeHtml(r.status) + '</td>' +
          '<td><div class="cell-sub">PickUp: ' + (r.waktuPickUp ? formatDateTimeID(r.waktuPickUp) : '-') + '</div><div class="cell-sub">Check-In: ' + (r.waktuCheckIn ? formatDateTimeID(r.waktuCheckIn) : '-') + '</div><div class="cell-sub">Check-Out: ' + (r.waktuCheckOut ? formatDateTimeID(r.waktuCheckOut) : '-') + '</div></td>' +
          '<td><div class="cell-strong">' + escapeHtml(r.namaPenerima || '-') + '</div><div class="cell-sub">' + escapeHtml(r.status === 'Gagal Kirim' ? 'Gagal: ' + r.alasanGagalKirim : (r.keterangan || '-')) + '</div></td>' +
          '<td><button type="button" class="btn btn-secondary btn-sm" onclick="openOrderDetailModal(\'' + escapeHtml(r.idTracking) + '\')">' + ICONS.eye + '<span>Detail</span></button></td>' +
        '</tr>';
    }
  }

  return (
    '<div class="page-header">' +
      '<div>' +
        '<h2 class="page-title">Laporan Delivery Order</h2>' +
        '<p class="page-subtitle">Filter laporan pengiriman dan unduh dokumen PDF atau Excel (.xlsx) lengkap beserta link GPS & armada</p>' +
      '</div>' +
      '<div class="header-actions">' +
        renderSyncStatusBadge() +
        '<button type="button" class="btn btn-outline-danger" onclick="triggerExportReport(\'pdf\')">' + ICONS.download + '<span>Export PDF</span></button>' +
        '<button type="button" class="btn btn-emerald" onclick="triggerExportReport(\'excel\')">' + ICONS.download + '<span>Export Excel</span></button>' +
      '</div>' +
    '</div>' +
    '<div class="metrics-grid">' +
      renderMetricCard('Total Data Laporan', s.total, '#eff6ff', '#1d4ed8', ICONS.fileText) +
      renderMetricCard('Selesai Terkirim', s.selesai, '#ecfdf5', '#047857', ICONS.check) +
      renderMetricCard('Gagal Kirim / Kirim Ulang', s.gagalKirim + ' / ' + s.redeliveryCount, '#fff1f2', '#be123c', ICONS.alert) +
    '</div>' +
    '<div class="card" style="margin-bottom:14px">' +
      '<div class="filter-bar" style="margin-bottom:0">' +
        '<div class="form-group"><label class="form-label">Dari Tanggal</label><input id="rep-from" class="form-control" type="date" value="' + escapeHtml(f.dateFrom) + '" /></div>' +
        '<div class="form-group"><label class="form-label">Sampai Tanggal</label><input id="rep-to" class="form-control" type="date" value="' + escapeHtml(f.dateTo) + '" /></div>' +
        '<div class="form-group"><label class="form-label">Driver</label><select id="rep-driver" class="form-control">' + drvOpts + '</select></div>' +
        '<div class="form-group"><label class="form-label">Customer</label><select id="rep-customer" class="form-control">' + cstOpts + '</select></div>' +
        '<div class="form-group"><label class="form-label">Status</label><select id="rep-status" class="form-control">' + stOpts + '</select></div>' +
        '<div class="form-group"><label class="form-label">Cari Teks</label><input id="rep-search" class="form-control" type="text" value="' + escapeHtml(f.search) + '" placeholder="No DO / Plat / Penerima..." onkeydown="if(event.key===\'Enter\'){event.preventDefault();applyReportFilter();}" /></div>' +
        '<div class="form-group"><button type="button" class="btn btn-navy" style="width:100%" onclick="applyReportFilter()">Tampilkan</button></div>' +
      '</div>' +
    '</div>' +
    '<div class="table-card">' +
      '<div class="table-wrap"><table class="data-table"><thead><tr><th>Nomor DO / ID</th><th>Tgl DO</th><th>Customer, Driver & Mobil</th><th>Status</th><th>Waktu Pengiriman</th><th>Penerima / Alasan Gagal</th><th>Aksi</th></tr></thead><tbody>' + rowsHtml + '</tbody></table></div>' +
      renderPaginationBar(STATE.report.page, STATE.report.totalPages, STATE.report.total, 'changeReportPage') +
    '</div>'
  );
}

// ============================================================================
// KOMPONEN MODAL & PAGINATION
// ============================================================================

function renderPaginationBar(page, totalPages, total, fnName) {
  return (
    '<div class="pagination-bar">' +
      '<div>Total <strong>' + total + '</strong> data · Halaman <strong>' + page + '</strong> dari <strong>' + totalPages + '</strong></div>' +
      '<div style="display:flex;gap:6px">' +
        '<button type="button" class="btn btn-secondary btn-sm" ' + (page <= 1 ? 'disabled' : '') + ' onclick="' + fnName + '(' + (page - 1) + ')">Sebelumnya</button>' +
        '<button type="button" class="btn btn-secondary btn-sm" ' + (page >= totalPages ? 'disabled' : '') + ' onclick="' + fnName + '(' + (page + 1) + ')">Berikutnya</button>' +
      '</div>' +
    '</div>'
  );
}

function openModal(innerHtml, isWide) {
  var root = document.getElementById('modal-root');
  root.innerHTML =
    '<div class="modal-backdrop" onclick="handleBackdropClick(event)">' +
      '<div class="modal-panel ' + (isWide ? 'wide' : '') + '">' + innerHtml + '</div>' +
    '</div>';
}

function handleBackdropClick(ev) {
  if (ev.target && ev.target.classList.contains('modal-backdrop')) {
    closeModal();
  }
}

function closeModal() {
  var root = document.getElementById('modal-root');
  if (root) {
    root.innerHTML = '';
  }
}
