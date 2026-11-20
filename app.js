/**
 * app.js — Aplikasi SPA Tracking Delivery Order - PIF
 * Standar ZettBOT: Modular, Tanpa Nested Template Literals, In-Memory Cache, Mobile-First & Desktop Responsive
 */

var STATE = {
  session: getSavedSession(),
  currentPage: 'dashboard',
  dropdowns: { drivers: [], customers: [], mobils: [], bbms: [], vias: [] },
  reportActiveTab: 'orders', // 'orders' or 'aktivitas'

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
    filters: { search: '', status: '', via: '', dateFrom: '', dateTo: '', driverId: '', customerId: '' }
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

  bbmMaster: {
    items: [],
    total: 0,
    page: 1,
    limit: 15,
    totalPages: 1,
    filters: { search: '', status: '' }
  },

  viaMaster: {
    items: [],
    total: 0,
    page: 1,
    limit: 15,
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
    filters: { dateFrom: '', dateTo: '', driverId: '', customerId: '', status: '', via: '', search: '' }
  },

  aktivitas: {
    hasActive: false,
    active: null,
    lastAktivitas: null,
    bbmList: [],
    loading: false
  },

  laporanAktivitas: {
    items: [],
    total: 0,
    page: 1,
    limit: 15,
    totalPages: 1,
    summary: { total: 0, selesai: 0, sedangBerangkat: 0, totalKm: 0, totalBiayaBbm: 0, totalLiterBbm: 0 },
    filters: { dateFrom: '', dateTo: '', driverId: '', platMobil: '', status: '', search: '' }
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
    STATE.currentPage = (STATE.session.user.divisi === 'Driver' || STATE.session.user.divisi === 'Admin Delivery') ? 'tracking-driver' : 'dashboard';
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
  var aktSearch = document.getElementById('akt-rep-search');
  if (aktSearch && aktSearch.value.trim() !== STATE.laporanAktivitas.filters.search) {
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
  var isAdminDelivery = user.divisi === 'Admin Delivery';

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
      '<button type="button" class="dropdown-item ' + (STATE.currentPage === 'report' && STATE.reportActiveTab === 'orders' ? 'active' : '') + '" onclick="switchReportTab(\'orders\')">' + ICONS.fileText + '<span>Laporan Delivery Order</span></button>' +
      '<button type="button" class="dropdown-item ' + (STATE.currentPage === 'report' && STATE.reportActiveTab === 'aktivitas' ? 'active' : '') + '" onclick="switchReportTab(\'aktivitas\')">' + ICONS.truck + '<span>Laporan Aktivitas Driver</span></button>' +
      '<button type="button" class="dropdown-item ' + (STATE.currentPage === 'karyawan' ? 'active' : '') + '" onclick="navigateTo(\'karyawan\')">' + ICONS.users + '<span>Master Karyawan</span></button>' +
      '<button type="button" class="dropdown-item ' + (STATE.currentPage === 'customer' ? 'active' : '') + '" onclick="navigateTo(\'customer\')">' + ICONS.building + '<span>Master Customer</span></button>' +
      '<button type="button" class="dropdown-item ' + (STATE.currentPage === 'mobil' ? 'active' : '') + '" onclick="navigateTo(\'mobil\')">' + ICONS.truck + '<span>Master Mobil</span></button>' +
      '<button type="button" class="dropdown-item ' + (STATE.currentPage === 'bbm-master' ? 'active' : '') + '" onclick="navigateTo(\'bbm-master\')">' + ICONS.fuel + '<span>Master BBM</span></button>' +
      '<button type="button" class="dropdown-item ' + (STATE.currentPage === 'via-master' ? 'active' : '') + '" onclick="navigateTo(\'via-master\')">' + ICONS.truck + '<span>Master Pengiriman VIA</span></button>' +
      '<button type="button" class="dropdown-item danger" onclick="handleLogout()">' + ICONS.logout + '<span>Keluar</span></button>';
  } else if (isAdminDelivery) {
    navPrimary =
      '<button type="button" class="nav-btn ' + (STATE.currentPage === 'tracking-driver' ? 'active' : '') + '" onclick="navigateTo(\'tracking-driver\')">' + ICONS.truck + '<span>Tracking Pengiriman</span></button>' +
      '<button type="button" class="nav-btn ' + (STATE.currentPage === 'dashboard' ? 'active' : '') + '" onclick="navigateTo(\'dashboard\')">' + ICONS.dashboard + '<span>Ringkasan</span></button>';

    overflowItems =
      '<button type="button" class="dropdown-item danger" onclick="handleLogout()">' + ICONS.logout + '<span>Keluar</span></button>';
  } else {
    navPrimary =
      '<button type="button" class="nav-btn ' + (STATE.currentPage === 'aktivitas-driver' ? 'active' : '') + '" onclick="navigateTo(\'aktivitas-driver\')">' + ICONS.clock + '<span>Aktivitas</span></button>' +
      '<button type="button" class="nav-btn ' + (STATE.currentPage === 'tracking-driver' ? 'active' : '') + '" onclick="navigateTo(\'tracking-driver\')">' + ICONS.truck + '<span>Tracking Driver</span></button>' +
      '<button type="button" class="nav-btn ' + (STATE.currentPage === 'dashboard' ? 'active' : '') + '" onclick="navigateTo(\'dashboard\')">' + ICONS.dashboard + '<span>Ringkasan</span></button>';

    overflowItems =
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
  } else if (STATE.currentPage === 'bbm-master') {
    pageBody = renderMasterBbmView();
  } else if (STATE.currentPage === 'via-master') {
    pageBody = renderViaMasterView();
  } else if (STATE.currentPage === 'report') {
    pageBody = renderReportView();
  } else if (STATE.currentPage === 'aktivitas-driver') {
    pageBody = renderAktivitasDriverView();
  } else if (STATE.currentPage === 'laporan-aktivitas') {
    STATE.reportActiveTab = 'aktivitas';
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
      refreshViaFilterDropdownInDom_();
    });
  } else if (p === 'tracking-driver') {
    fetchDriverTrackingData(forceRefresh, opts);
  } else if (p === 'karyawan') {
    fetchKaryawanData(forceRefresh, opts);
  } else if (p === 'customer') {
    fetchCustomerData(forceRefresh, opts);
  } else if (p === 'mobil') {
    fetchMobilData(forceRefresh, opts);
  } else if (p === 'bbm-master') {
    fetchMasterBbmData(forceRefresh, opts);
  } else if (p === 'via-master') {
    fetchMasterViaData(forceRefresh, opts);
  } else if (p === 'report' || p === 'laporan-aktivitas') {
    ensureDropdownsLoaded(forceRefresh, opts).then(function () {
      if (STATE.reportActiveTab === 'orders') {
        fetchReportData(forceRefresh, opts);
      } else {
        fetchLaporanAktivitasData(forceRefresh, opts);
      }
      refreshViaFilterDropdownInDom_();
    });
  } else if (p === 'aktivitas-driver') {
    ensureDropdownsLoaded(forceRefresh, opts).then(function () {
      fetchAktivitasDriverData(forceRefresh, opts);
    });
  }
}

function ensureDropdownsLoaded(forceRefresh, fetchOpts) {
  var servedFromCache = !forceRefresh && hasCacheEntry('dropdowns');
  return callGasApi('getMasterDropdowns', {}, {
    cacheKey: 'dropdowns',
    forceRefresh: Boolean(forceRefresh)
  }).then(function (data) {
    var normalized = data || { drivers: [], customers: [], mobils: [], bbms: [], vias: [] };
    if (!normalized.mobils) {
      normalized.mobils = [];
    }
    if (!normalized.bbms) {
      normalized.bbms = [];
    }
    if (!normalized.vias) {
      normalized.vias = [];
    }
    var snap = JSON.stringify(normalized);
    var changed = STATE.lastSnapshots.dropdowns !== snap;
    STATE.dropdowns = normalized;
    STATE.lastSnapshots.dropdowns = snap;
    refreshViaFilterDropdownInDom_();

    if (servedFromCache && !(fetchOpts && fetchOpts.silent)) {
      callGasApi('getMasterDropdowns', {}, {
        cacheKey: 'dropdowns',
        forceRefresh: true
      }).then(function (fresh) {
        var normFresh = fresh || { drivers: [], customers: [], mobils: [], bbms: [], vias: [] };
        if (!normFresh.mobils) {
          normFresh.mobils = [];
        }
        if (!normFresh.bbms) {
          normFresh.bbms = [];
        }
        if (!normFresh.vias) {
          normFresh.vias = [];
        }
        var freshSnap = JSON.stringify(normFresh);
        if (STATE.lastSnapshots.dropdowns !== freshSnap) {
          STATE.dropdowns = normFresh;
          STATE.lastSnapshots.dropdowns = freshSnap;
          refreshViaFilterDropdownInDom_();
          if (!isUiBusyForBackgroundSync() && (STATE.currentPage === 'orders' || STATE.currentPage === 'monitor' || STATE.currentPage === 'report' || STATE.currentPage === 'aktivitas-driver' || STATE.currentPage === 'laporan-aktivitas')) {
            renderApp();
          }
        }
      }).catch(function () {});
    } else if (changed && fetchOpts && fetchOpts.silent && !isUiBusyForBackgroundSync()) {
      if (STATE.currentPage === 'orders' || STATE.currentPage === 'monitor' || STATE.currentPage === 'report' || STATE.currentPage === 'aktivitas-driver' || STATE.currentPage === 'laporan-aktivitas') {
        renderApp();
      }
    }
  }).catch(function () {
    if (!STATE.dropdowns) {
      STATE.dropdowns = { drivers: [], customers: [], mobils: [], bbms: [], vias: [] };
    }
  });
}

// ============================================================================
// LOGIN & PENGATURAN API
// ============================================================================

function renderLoginView() {
  var currentUrl = getApiUrl();
  var apiNotice = currentUrl
    ? ''
    : '<div class="alert-box alert-warning" style="margin-bottom:14px">URL Server Backend GAS belum dipasang di config.js.</div>';

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
            '<input id="login-username" class="form-control" type="text" placeholder="Masukkan username" autocomplete="username" required />' +
          '</div>' +
          '<div class="form-group">' +
            '<label class="form-label" for="login-password">Password / PIN <span class="req">*</span></label>' +
            '<input id="login-password" class="form-control" type="password" placeholder="Masukkan password" autocomplete="current-password" required />' +
          '</div>' +
          '<button id="login-submit-btn" type="submit" class="btn btn-navy" style="width:100%;padding:11px">Masuk ke Aplikasi</button>' +
        '</form>' +
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
        STATE.currentPage = (data.user.divisi === 'Driver' || data.user.divisi === 'Admin Delivery') ? 'tracking-driver' : 'dashboard';
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
    via: f.via,
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

function buildViaFilterOptionsHtml(selectedVia) {
  var activeVias = (STATE.dropdowns && STATE.dropdowns.vias && STATE.dropdowns.vias.length)
    ? STATE.dropdowns.vias
    : [{ namaVia: 'Driver' }, { namaVia: 'Kurir' }, { namaVia: 'Online' }];

  var html = '<option value="">Semua VIA</option>';
  var matched = false;

  for (var i = 0; i < activeVias.length; i++) {
    var vName = activeVias[i].namaVia;
    if (vName === selectedVia) {
      matched = true;
    }
    html += '<option value="' + escapeHtml(vName) + '" ' + (selectedVia === vName ? 'selected' : '') + '>' + escapeHtml(vName) + '</option>';
  }

  if (!matched && selectedVia) {
    html += '<option value="' + escapeHtml(selectedVia) + '" selected>' + escapeHtml(selectedVia) + '</option>';
  }

  return html;
}

function refreshViaFilterDropdownInDom_() {
  var ordVia = document.getElementById('ord-filter-via');
  if (ordVia) {
    var curVal = STATE.orders.filters.via || ordVia.value;
    ordVia.innerHTML = buildViaFilterOptionsHtml(curVal);
    ordVia.value = curVal;
  }
  var repVia = document.getElementById('rep-via');
  if (repVia) {
    var curRepVal = STATE.report.filters.via || repVia.value;
    repVia.innerHTML = buildViaFilterOptionsHtml(curRepVal);
    repVia.value = curRepVal;
  }
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

  var viaOpts = buildViaFilterOptionsHtml(f.via);

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
          '<label class="form-label">Pengiriman VIA</label>' +
          '<select id="ord-filter-via" class="form-control">' + viaOpts + '</select>' +
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
          '<button type="button" class="btn-reset-filter" onclick="resetOrdersFilter()" title="Reset Filter">' + ICONS.rotateCcw + '<span>Reset</span></button>' +
        '</div>' +
      '</div>' +
    '</div>'
  );
}

function applyOrdersFilter() {
  STATE.orders.filters.search = document.getElementById('ord-filter-search').value.trim();
  STATE.orders.filters.status = document.getElementById('ord-filter-status').value;
  STATE.orders.filters.via = document.getElementById('ord-filter-via') ? document.getElementById('ord-filter-via').value : '';
  STATE.orders.filters.driverId = document.getElementById('ord-filter-driver').value;
  STATE.orders.filters.dateFrom = document.getElementById('ord-filter-from').value;
  STATE.orders.filters.dateTo = document.getElementById('ord-filter-to').value;
  STATE.orders.page = 1;
  fetchOrdersData(false);
}

function resetOrdersFilter() {
  STATE.orders.filters = { search: '', status: '', via: '', dateFrom: '', dateTo: '', driverId: '', customerId: '' };
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
        statusExtra = '<div class="cell-sub" style="color:var(--rose)"><strong>Alasan:</strong> ' + escapeHtml(d.alasanGagalKirim || '-') + '</div>' +
          (d.sudahDikirimUlang === 'Ya' ? '<div class="cell-sub" style="color:var(--emerald)">Sudah dijadwalkan ulang</div>' : '<div class="cell-sub" style="color:var(--amber)">Belum dijadwalkan ulang</div>');
      } else if (d.namaPenerima) {
        statusExtra = '<div class="cell-sub">Penerima: ' + escapeHtml(d.namaPenerima) + '</div>';
      }

      var mobilLine = d.platMobil
        ? '<div style="margin:3px 0"><span class="vehicle-tag">' + escapeHtml(d.platMobil) + (d.jenisMobil ? ' · ' + escapeHtml(d.jenisMobil) : '') + '</span></div>'
        : '<div class="cell-sub">Mobil: -</div>';

      var viaTag = d.via ? '<span class="badge badge-via badge-via-' + d.via.toLowerCase() + '">' + escapeHtml(d.via) + '</span>' : '';

      var fotoSummary = (d.status === 'Gagal Kirim')
        ? '<div class="cell-sub" style="color:var(--rose)">Bukti Gagal: ' + (d.gagalKirimFotos || []).length + '/6</div>'
        : '<div class="cell-sub">PickUp Foto: ' + (d.pickUpFotos || []).length + '/6</div><div class="cell-sub">CheckIn Foto: ' + (d.checkInFotos || []).length + '/6</div>';

      rowsHtml +=
        '<tr>' +
          '<td><div class="cell-strong">' + escapeHtml(d.idTracking) + '</div><div class="cell-sub">' + formatDateID(d.tanggalDO) + '</div></td>' +
          '<td><div class="cell-strong">' + escapeHtml(d.nomorDO) + ' ' + viaTag + '</div>' +
            (d.percobaanKe > 1 ? '<div class="cell-sub"><span class="badge badge-info">Kirim Ulang #' + d.percobaanKe + '</span></div>' : '') +
          '</td>' +
          '<td><div class="cell-strong">' + escapeHtml(d.namaCustomer) + '</div><div class="cell-sub">' + escapeHtml(d.customerAlamat || '-') + '</div></td>' +
          '<td><div class="cell-strong">' + escapeHtml(d.namaDriver) + '</div>' + mobilLine + '<div class="cell-sub">Via: ' + escapeHtml(d.via || 'Driver') + ' · Input: ' + escapeHtml(d.namaBackOffice) + '</div></td>' +
          '<td>' + getStatusBadgeHtml(d.status) + statusExtra + '</td>' +
          '<td>' + fotoSummary + '</td>' +
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
      var pkpMaps = buildGoogleMapsUrl(d.pickUpLat, d.pickUpLng);
      var pkpMaps = buildGoogleMapsUrl(d.pickUpLat, d.pickUpLng);
      var ciMaps = buildGoogleMapsUrl(d.checkInLat, d.checkInLng);
      var coMaps = buildGoogleMapsUrl(d.checkOutLat, d.checkOutLng);
      var failMaps = buildGoogleMapsUrl(d.gagalKirimLat, d.gagalKirimLng);

      var gpsLinks = '';
      if (pkpMaps) {
        var pkpCoord = (d.pickUpLat !== null && d.pickUpLat !== undefined && d.pickUpLat !== '') ? ' (' + Number(d.pickUpLat).toFixed(4) + ', ' + Number(d.pickUpLng).toFixed(4) + ')' : '';
        gpsLinks += '<div><a target="_blank" rel="noopener" href="' + escapeHtml(pkpMaps) + '">📍 Pick Up' + escapeHtml(pkpCoord) + '</a></div>';
      }
      if (ciMaps) {
        var ciCoord = (d.checkInLat !== null && d.checkInLat !== undefined && d.checkInLat !== '') ? ' (' + Number(d.checkInLat).toFixed(4) + ', ' + Number(d.checkInLng).toFixed(4) + ')' : '';
        var ciLabel = (d.via === 'Kurir' || d.via === 'Online') ? '📍 Selesai' : '📍 Check-In';
        gpsLinks += '<div><a target="_blank" rel="noopener" href="' + escapeHtml(ciMaps) + '">' + ciLabel + escapeHtml(ciCoord) + '</a></div>';
      }
      if (coMaps && coMaps !== ciMaps) {
        var coCoord = (d.checkOutLat !== null && d.checkOutLat !== undefined && d.checkOutLat !== '') ? ' (' + Number(d.checkOutLat).toFixed(4) + ', ' + Number(d.checkOutLng).toFixed(4) + ')' : '';
        gpsLinks += '<div><a target="_blank" rel="noopener" href="' + escapeHtml(coMaps) + '">📍 Check-Out' + escapeHtml(coCoord) + '</a></div>';
      }
      if (failMaps) {
        var failCoord = (d.gagalKirimLat !== null && d.gagalKirimLat !== undefined && d.gagalKirimLat !== '') ? ' (' + Number(d.gagalKirimLat).toFixed(4) + ', ' + Number(d.gagalKirimLng).toFixed(4) + ')' : '';
        gpsLinks += '<div><a style="color:var(--rose)" target="_blank" rel="noopener" href="' + escapeHtml(failMaps) + '">⚠️ Gagal Kirim' + escapeHtml(failCoord) + '</a></div>';
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

      var monViaTag = d.via ? '<span class="badge badge-via badge-via-' + d.via.toLowerCase() + '">' + escapeHtml(d.via) + '</span>' : '';

      rowsHtml +=
        '<tr>' +
          '<td><div class="cell-strong">' + escapeHtml(d.nomorDO) + ' ' + monViaTag + '</div><div class="cell-sub">' + escapeHtml(d.idTracking) + ' · ' + formatDateID(d.tanggalDO) + '</div></td>' +
          '<td><div class="cell-strong">' + escapeHtml(d.namaCustomer) + '</div><div class="cell-sub">Driver: ' + escapeHtml(d.namaDriver) + ' (' + escapeHtml(d.via || 'Driver') + ')</div><div class="cell-sub">Mobil: ' + mobilSummary + '</div></td>' +
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

function renderOrderPersonnelOptionsHtml(selectedVia, currentDriverId) {
  if (selectedVia !== 'Driver') {
    return '';
  }

  // selectedVia === 'Driver'
  var drivers = STATE.dropdowns.drivers || [];
  var filtered = [];
  for (var i = 0; i < drivers.length; i++) {
    var d = drivers[i];
    if (d.divisi === 'Driver') {
      filtered.push(d);
    }
  }
  var list = filtered.length ? filtered : drivers;
  var html = '<option value="">-- Pilih Driver --</option>';
  for (var j = 0; j < list.length; j++) {
    var selD = (currentDriverId && currentDriverId === list[j].idKaryawan) ? 'selected' : '';
    html += '<option value="' + escapeHtml(list[j].idKaryawan) + '" ' + selD + '>' +
      escapeHtml(list[j].namaKaryawan) + (list[j].divisi ? ' (' + escapeHtml(list[j].divisi) + ')' : '') +
      '</option>';
  }
  return html;
}

function handleOrderViaChange(selectedVia, keepDriverId) {
  var drvGroup = document.getElementById('ord-driver-group');
  var drvSel = document.getElementById('ord-driver');
  var drvLabel = document.getElementById('ord-driver-label');
  var mobilLabel = document.getElementById('ord-mobil-label');
  var mobilSel = document.getElementById('ord-mobil');

  if (selectedVia === 'Driver') {
    if (drvGroup) drvGroup.style.display = 'block';
    if (drvLabel) drvLabel.innerHTML = 'Driver Bertugas <span class="req">*</span>';
    if (drvSel) {
      drvSel.required = true;
      var curDrv = keepDriverId !== undefined ? keepDriverId : drvSel.value;
      drvSel.innerHTML = renderOrderPersonnelOptionsHtml('Driver', curDrv);
    }
    if (mobilLabel) mobilLabel.innerHTML = 'Plat Mobil <span class="req">*</span>';
    if (mobilSel) mobilSel.required = true;
  } else {
    // Kurir, Online, atau VIA lainnya: kolom petugas dan barisnya dihilangkan total
    if (drvGroup) drvGroup.style.display = 'none';
    if (drvSel) {
      drvSel.required = false;
      drvSel.innerHTML = '';
      if (selectedVia === 'Kurir') {
        drvSel.value = 'KURIR';
      } else if (selectedVia === 'Online') {
        drvSel.value = 'ONLINE';
      } else {
        drvSel.value = String(selectedVia).toUpperCase();
      }
    }
    if (mobilLabel) mobilLabel.innerHTML = 'Plat Mobil (Opsional)';
    if (mobilSel) mobilSel.required = false;
  }
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
    ? 'Kirim Ulang / Jadwalkan Ulang Delivery Order'
    : (isEdit ? 'Ubah Delivery Order' : 'Input Delivery Order Baru - PIF');

  var curVia = existing ? (existing.via || 'Driver') : 'Driver';
  var curDriverId = (!isRedelivery && existing) ? (existing.idDriver || '') : '';

  var custOpts = '<option value="">-- Pilih Customer --</option>';
  var customers = STATE.dropdowns.customers || [];
  for (var c = 0; c < customers.length; c++) {
    var selC = existing && existing.idCustomer === customers[c].idCustomer ? 'selected' : '';
    custOpts += '<option value="' + escapeHtml(customers[c].idCustomer) + '" ' + selC + '>' + escapeHtml(customers[c].namaCustomer) + '</option>';
  }

  var isDriverVia = (curVia === 'Driver');
  var drvOpts = isDriverVia ? renderOrderPersonnelOptionsHtml('Driver', curDriverId) : '';

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
    ? '<div class="alert-box alert-warning" style="margin-bottom:14px;border-left:4px solid var(--rose)">' +
        '<div style="font-weight:700;margin-bottom:4px;font-size:14px">Penjadwalan Ulang DO Gagal Kirim</div>' +
        '<div>Nomor DO: <strong>' + escapeHtml(existing.nomorDO) + '</strong></div>' +
        '<div>Pengiriman Sebelumnya: <strong>' + escapeHtml(existing.namaDriver || '-') + '</strong> (Via ' + escapeHtml(existing.via || 'Driver') + ')</div>' +
        '<div style="margin-top:6px;padding:6px 8px;background:#fff1f2;border-radius:6px"><strong>Keterangan Gagal Kirim:</strong> <span style="color:var(--rose)">' + escapeHtml(existing.alasanGagalKirim || '-') + '</span></div>' +
      '</div>'
    : '';

  // Dropdown via dinamis dari Master VIA
  var viaOpts = '';
  var activeVias = (STATE.dropdowns && STATE.dropdowns.vias && STATE.dropdowns.vias.length)
    ? STATE.dropdowns.vias
    : [{ namaVia: 'Driver' }, { namaVia: 'Kurir' }, { namaVia: 'Online' }];
  var hasCurVia = false;
  for (var vi = 0; vi < activeVias.length; vi++) {
    var vName = activeVias[vi].namaVia;
    if (vName === curVia) hasCurVia = true;
    viaOpts += '<option value="' + escapeHtml(vName) + '" ' + (curVia === vName ? 'selected' : '') + '>' + escapeHtml(vName) + '</option>';
  }
  if (!hasCurVia && curVia) {
    viaOpts = '<option value="' + escapeHtml(curVia) + '" selected>' + escapeHtml(curVia) + '</option>' + viaOpts;
  }

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
            '<label class="form-label" for="ord-tanggal">' + (isRedelivery ? 'Tanggal Pengiriman Baru (Jadwal Ulang) <span class="req">*</span>' : 'Tanggal Delivery Order <span class="req">*</span>') + '</label>' +
            '<input id="ord-tanggal" class="form-control" type="date" value="' + escapeHtml(isEdit ? existing.tanggalDO : getTodayYMD()) + '" required />' +
          '</div>' +
        '</div>' +
        (!isRedelivery ?
          '<div class="barcode-scan-topbar">' +
            '<button type="button" class="btn btn-navy btn-sm" id="btn-toggle-barcode" onclick="toggleOrderBarcodeScanner()" style="display:inline-flex;align-items:center;gap:6px;font-size:12.5px;padding:6px 12px">' +
              (ICONS.barcode || ICONS.camera) +
              '<span>Scan Barcode Invoice (Code 128)</span>' +
            '</button>' +
          '</div>' +
          '<div id="ord-barcode-scanner-area" class="barcode-scanner-container" style="display:none">' +
            '<div id="ord-barcode-reader" class="barcode-reader-box"></div>' +
            '<div style="margin-top:8px;display:flex;gap:8px;justify-content:space-between;align-items:center">' +
              '<button type="button" class="btn btn-secondary btn-sm" onclick="triggerBarcodeFileInput()">Pilih Foto Barcode</button>' +
              '<button type="button" class="btn btn-outline-danger btn-sm" onclick="stopOrderBarcodeScanner()">Tutup Scanner</button>' +
            '</div>' +
            '<input id="ord-barcode-file-input" type="file" accept="image/*" style="display:none" onchange="handleBarcodeFileScan(this.files)" />' +
          '</div>'
        : '') +
        '<div class="form-group">' +
          '<label class="form-label" for="ord-nomor">Nomor Delivery Order <span class="req">*</span></label>' +
          '<input id="ord-nomor" class="form-control" type="text" value="' + escapeHtml(existing ? existing.nomorDO : '') + '" ' + (isRedelivery ? 'readonly' : '') + ' placeholder="Contoh: DO-PIF/11/0012" required />' +
        '</div>' +
        '<div class="form-grid-2">' +
          '<div class="form-group">' +
            '<label class="form-label" for="ord-via">Pengiriman VIA <span class="req">*</span></label>' +
            '<select id="ord-via" class="form-control" required onchange="handleOrderViaChange(this.value)">' +
              viaOpts +
            '</select>' +
          '</div>' +
          '<div class="form-group">' +
            '<label class="form-label" for="ord-customer">Nama Customer <span class="req">*</span></label>' +
            '<select id="ord-customer" class="form-control" required>' + custOpts + '</select>' +
          '</div>' +
        '</div>' +
        '<div id="ord-driver-group" class="form-group" style="display:' + (isDriverVia ? 'block' : 'none') + '">' +
          '<label id="ord-driver-label" class="form-label" for="ord-driver">Driver Bertugas <span class="req">*</span></label>' +
          '<select id="ord-driver" class="form-control" ' + (isDriverVia ? 'required' : '') + '>' + drvOpts + '</select>' +
        '</div>' +
        '<div class="form-grid-2">' +
          '<div class="form-group">' +
            '<label id="ord-mobil-label" class="form-label" for="ord-mobil">Plat Mobil ' + (isDriverVia ? '<span class="req">*</span>' : '(Opsional)') + '</label>' +
            '<select id="ord-mobil" class="form-control" ' + (isDriverVia ? 'required' : '') + ' onchange="handleOrderMobilChange(this.value)">' +
              '<option value="">' + (isDriverVia ? '-- Pilih Plat Mobil --' : '-- Tanpa Kendaraan / Opsional --') + '</option>' +
              (mobilBuilt.html.replace('<option value="">-- Pilih Plat Mobil --</option>', '')) +
            '</select>' +
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
        '<button id="ord-save-btn" type="submit" class="btn btn-primary">' + (isRedelivery ? 'Jadwalkan Kirim Ulang' : 'Simpan Delivery Order') + '</button>' +
      '</div>' +
    '</form>';

  openModal(html);

  if (!STATE.dropdowns.mobils.length || !STATE.dropdowns.drivers.length || !STATE.dropdowns.customers.length || !STATE.dropdowns.vias.length) {
    ensureDropdownsLoaded(false, { silent: true }).then(function () {
      var mobilSel = document.getElementById('ord-mobil');
      if (mobilSel && !mobilSel.value) {
        var refreshedMobil = buildOrderMobilOptionsHtml(preSelectedMobilId);
        var viaVal = document.getElementById('ord-via') ? document.getElementById('ord-via').value : 'Driver';
        mobilSel.innerHTML = '<option value="">' + (viaVal === 'Driver' ? '-- Pilih Plat Mobil --' : '-- Tanpa Kendaraan / Opsional --') + '</option>' +
          (refreshedMobil.html.replace('<option value="">-- Pilih Plat Mobil --</option>', ''));
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
        var viaV = document.getElementById('ord-via') ? document.getElementById('ord-via').value : 'Driver';
        if (viaV === 'Driver') {
          drvSel.innerHTML = renderOrderPersonnelOptionsHtml(viaV, curDriverId);
        }
      }
      var viaSel = document.getElementById('ord-via');
      if (viaSel && STATE.dropdowns.vias && STATE.dropdowns.vias.length) {
        var activeSelectedVia = viaSel.value;
        var dynOpts = '';
        var matchSel = false;
        for (var vIdx = 0; vIdx < STATE.dropdowns.vias.length; vIdx++) {
          var vItem = STATE.dropdowns.vias[vIdx];
          if (vItem.namaVia === activeSelectedVia) matchSel = true;
          dynOpts += '<option value="' + escapeHtml(vItem.namaVia) + '" ' + (vItem.namaVia === activeSelectedVia ? 'selected' : '') + '>' + escapeHtml(vItem.namaVia) + '</option>';
        }
        if (!matchSel && activeSelectedVia) {
          dynOpts = '<option value="' + escapeHtml(activeSelectedVia) + '" selected>' + escapeHtml(activeSelectedVia) + '</option>' + dynOpts;
        }
        viaSel.innerHTML = dynOpts;
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
    var selectedVia = document.getElementById('ord-via') ? document.getElementById('ord-via').value : 'Driver';
    var driverVal = '';

    if (selectedVia === 'Driver') {
      driverVal = document.getElementById('ord-driver').value;
      if (!driverVal) {
        showToast('Driver bertugas wajib dipilih.', 'warning');
        return;
      }
      var mobilVal = document.getElementById('ord-mobil').value || '';
      if (!mobilVal) {
        showToast('Plat Mobil wajib dipilih dari Master Mobil untuk pengiriman via Driver.', 'warning');
        return;
      }
    } else if (selectedVia === 'Kurir') {
      driverVal = 'KURIR';
    } else if (selectedVia === 'Online') {
      driverVal = 'ONLINE';
    } else {
      driverVal = selectedVia.toUpperCase();
    }

    var payload = {
      tanggalDO: document.getElementById('ord-tanggal').value,
      nomorDO: document.getElementById('ord-nomor').value.trim(),
      idCustomer: document.getElementById('ord-customer').value,
      idDriver: driverVal,
      idMobil: document.getElementById('ord-mobil').value || '',
      via: selectedVia
    };

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
        if (d.via === 'Kurir') {
          cardActions += '<button type="button" class="btn btn-primary btn-sm" onclick="openPickUpModal([\'' + escapeHtml(d.idTracking) + '\'])">' + ICONS.camera + '<span>Serahkan ke Kurir</span></button>';
        } else if (d.via === 'Online') {
          cardActions += '<button type="button" class="btn btn-primary btn-sm" onclick="openPickUpModal([\'' + escapeHtml(d.idTracking) + '\'])">' + ICONS.camera + '<span>Pick Up Online</span></button>';
        } else {
          cardActions += '<button type="button" class="btn btn-primary btn-sm" onclick="openPickUpModal([\'' + escapeHtml(d.idTracking) + '\'])">' + ICONS.camera + '<span>Pick Up</span></button>';
        }
        cardActions += '<button type="button" class="btn btn-outline-danger btn-sm" onclick="openFailedModal([\'' + escapeHtml(d.idTracking) + '\'])">' + ICONS.alert + '<span>Gagal Kirim</span></button>';
      } else if (d.status === 'Dalam Perjalanan') {
        if (d.via === 'Online') {
          cardActions += '<button type="button" class="btn btn-emerald btn-sm" onclick="openCompleteOnlineModal(\'' + escapeHtml(d.idTracking) + '\')">' + ICONS.check + '<span>Selesai (Bukti Terima)</span></button>';
          cardActions += '<button type="button" class="btn btn-outline-danger btn-sm" onclick="openFailedModal([\'' + escapeHtml(d.idTracking) + '\'])">' + ICONS.alert + '<span>Gagal Kirim</span></button>';
        } else {
          cardActions += '<button type="button" class="btn btn-primary btn-sm" onclick="openCheckInModal([\'' + escapeHtml(d.idTracking) + '\'])">' + ICONS.mapPin + '<span>Check-In</span></button>';
          cardActions += '<button type="button" class="btn btn-outline-danger btn-sm" onclick="openFailedModal([\'' + escapeHtml(d.idTracking) + '\'])">' + ICONS.alert + '<span>Gagal Kirim</span></button>';
        }
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

      var drvViaTag = d.via ? '<span class="badge badge-via badge-via-' + d.via.toLowerCase() + '">' + escapeHtml(d.via) + '</span> ' : '';

      cardsHtml +=
        '<div class="driver-do-card ' + (isSelected ? 'selected' : '') + '">' +
          '<div class="do-card-head">' +
            '<label class="do-check-label">' +
              checkControl +
              '<div>' +
                '<div class="cell-strong" style="font-size:15px">' + escapeHtml(d.nomorDO) + ' ' + drvViaTag + '</div>' +
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
      bulkButtons =
        '<button type="button" class="btn btn-primary" onclick="openPickUpSelected()">' + ICONS.camera + '<span>Pick Up Terpilih (' + selectedIds.length + ')</span></button>' +
        '<button type="button" class="btn btn-danger" onclick="openFailedSelected()">' + ICONS.alert + '<span>Gagal Kirim (' + selectedIds.length + ')</span></button>';
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

function renderPhotoUploaderSection(labelText, isOptional, allowGallery) {
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
        '<div class="photo-slot" onclick="' + (allowGallery ? 'triggerGalleryInput()' : 'triggerCameraInput()') + '">' +
          ICONS.camera +
          '<span>Slot Foto ' + (i + 1) + '</span>' +
        '</div>';
    }
  }

  var btnControls = allowGallery
    ? '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:4px">' +
        '<button type="button" class="btn btn-primary btn-sm" onclick="triggerCameraInput()">' + ICONS.camera + '<span>Buka Kamera Langsung</span></button>' +
        '<button type="button" class="btn btn-secondary btn-sm" onclick="triggerGalleryInput()">' + ICONS.upload + '<span>Pilih dari Galeri HP</span></button>' +
      '</div>' +
      '<input id="modal-gallery-input" type="file" accept="image/*" style="display:none" onchange="handleModalPhotoFiles(this.files)" />'
    : '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:4px">' +
        '<button type="button" class="btn btn-primary btn-sm" onclick="triggerCameraInput()">' + ICONS.camera + '<span>Buka Kamera HP (Wajib Foto Langsung)</span></button>' +
      '</div>';

  return (
    '<div class="form-group">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">' +
        '<label class="form-label">' + escapeHtml(labelText) + (isOptional ? ' (Opsional maks 6 foto)' : ' <span class="req">*</span> (Min 1, Maks 6 foto)') + '</label>' +
        '<span id="photo-count-label" class="form-hint">' + STATE.modalPhotos.length + ' / 6 terisi</span>' +
      '</div>' +
      btnControls +
      '<input id="modal-camera-input" type="file" accept="image/*" capture="environment" style="display:none" onchange="handleModalPhotoFiles(this.files)" />' +
      '<div id="photo-slots-container" class="photo-slots-grid">' + slotsHtml + '</div>' +
    '</div>'
  );
}

function triggerCameraInput() {
  var el = document.getElementById('modal-camera-input');
  if (el) {
    el.value = '';
    el.click();
  }
}

function triggerGalleryInput() {
  var el = document.getElementById('modal-gallery-input');
  if (el) {
    el.value = '';
    el.click();
  } else {
    triggerCameraInput();
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
        '<div class="photo-slot" onclick="triggerCameraInput()">' +
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
      showToast(err.message, 'warning');
    });
}

function updateGpsBoxDom() {
  var holder = document.getElementById('gps-box-holder');
  if (holder) {
    holder.innerHTML = renderGpsStatusBox();
  } else {
    var box = document.getElementById('gps-status-box');
    if (box && box.parentNode) {
      box.outerHTML = renderGpsStatusBox();
    }
  }
  var submitBtn = document.getElementById('gps-required-submit-btn');
  if (submitBtn) {
    submitBtn.disabled = !STATE.modalGps || STATE.modalGpsLoading;
  }
  var btnPickup = document.getElementById('pickup-submit-btn');
  if (btnPickup) {
    btnPickup.disabled = !STATE.modalGps || STATE.modalGpsLoading;
  }
  var btnOnline = document.getElementById('online-complete-btn');
  if (btnOnline) {
    btnOnline.disabled = !STATE.modalGps || STATE.modalGpsLoading;
  }
  var btnCheckout = document.getElementById('btn-submit-checkout-akt');
  if (btnCheckout) {
    btnCheckout.disabled = !STATE.modalGps || STATE.modalGpsLoading;
  }
  var btnBbm = document.getElementById('btn-submit-bbm-akt');
  if (btnBbm) {
    btnBbm.disabled = !STATE.modalGps || STATE.modalGpsLoading;
  }
  var btnCheckin = document.getElementById('btn-submit-checkin-akt');
  if (btnCheckin) {
    btnCheckin.disabled = !STATE.modalGps || STATE.modalGpsLoading;
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
  STATE.modalGps = null;
  STATE.modalGpsLoading = true;
  STATE.modalGpsError = '';

  var isAllKurir = false;
  if (idTrackings.length > 0) {
    var countKurir = 0;
    for (var k = 0; k < idTrackings.length; k++) {
      for (var m = 0; m < STATE.tracking.items.length; m++) {
        if (STATE.tracking.items[m].idTracking === idTrackings[k]) {
          if (STATE.tracking.items[m].via === 'Kurir') {
            countKurir++;
          }
          break;
        }
      }
    }
    isAllKurir = (countKurir === idTrackings.length);
  }

  var kurirNotice = isAllKurir
    ? '<div class="alert-box alert-info" style="margin-top:10px;margin-bottom:12px">' +
        'Pengiriman Via <strong>Kurir</strong>: Setelah foto penyerahan barang diambil dan dikonfirmasi, status DO akan <strong>langsung berpindah ke Selesai</strong>.' +
      '</div>'
    : '';

  var modalTitle = isAllKurir
    ? 'Konfirmasi Serahkan ke Kurir (' + idTrackings.length + ' DO)'
    : 'Konfirmasi Pick Up Barang (' + idTrackings.length + ' DO)';

  var submitBtnText = isAllKurir
    ? 'Konfirmasi Serahkan (Selesai)'
    : 'Konfirmasi Pick Up';

  var photoLabel = isAllKurir
    ? 'Foto Bukti Serah Terima Barang ke Kurir'
    : 'Foto Ambil Barang (6 Kolom Foto)';

  var html =
    '<div class="modal-header">' +
      '<h3 class="modal-title">' + escapeHtml(modalTitle) + '</h3>' +
      '<button type="button" class="modal-close" onclick="closeModal()">' + ICONS.x + '</button>' +
    '</div>' +
    '<div class="modal-body">' +
      '<div><div class="form-label" style="margin-bottom:6px">Delivery Order:</div>' + buildSelectedDosSummaryHtml(idTrackings) + '</div>' +
      kurirNotice +
      '<div class="form-group" style="margin-top:10px">' +
        '<label class="form-label">Koordinat GPS Lokasi Pick Up <span class="req">*</span></label>' +
        '<div id="gps-box-holder">' + renderGpsStatusBox() + '</div>' +
      '</div>' +
      renderPhotoUploaderSection(photoLabel, false, false) +
    '</div>' +
    '<div class="modal-footer">' +
      '<button type="button" class="btn btn-secondary" onclick="closeModal()">Batal</button>' +
      '<button id="pickup-submit-btn" type="button" class="btn btn-primary" onclick="submitPickUp(' + isAllKurir + ')">' + escapeHtml(submitBtnText) + '</button>' +
    '</div>';

  openModal(html);
  acquireModalGps();
}

function submitPickUp(isAllKurir) {
  var idTrackings = STATE.modalTargetIds || [];
  if (!STATE.modalGps) {
    showToast('Koordinat GPS wajib terdeteksi sebelum konfirmasi.', 'warning');
    return;
  }
  if (!STATE.modalPhotos.length) {
    showToast('Unggah minimal 1 foto terlebih dahulu.', 'warning');
    return;
  }
  var btn = document.getElementById('pickup-submit-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span><span>Mengunggah foto & menyimpan...</span>';

  callGasApi('pickUpOrders', { idTrackings: idTrackings, photos: STATE.modalPhotos, gps: STATE.modalGps })
    .then(function () {
      STATE.tracking.selectedIds = {};
      clearApiCache('tracking_');
      clearApiCache('orders_');
      clearApiCache('dashboard_');
      clearApiCache('report_');
      closeModal();
      fetchDriverTrackingData(true);
      showToast(
        isAllKurir
          ? 'Penyerahan barang ke Kurir berhasil! Status DO langsung Selesai.'
          : 'Pick Up Multi-DO berhasil dicatat!',
        'success'
      );
    })
    .catch(function (err) {
      showToast(err.message, 'error');
      var b = document.getElementById('pickup-submit-btn');
      if (b) {
        b.disabled = false;
        b.textContent = isAllKurir ? 'Konfirmasi Serahkan (Selesai)' : 'Konfirmasi Pick Up';
      }
    });
}

function openCompleteOnlineModal(idTracking) {
  var item = null;
  for (var i = 0; i < STATE.tracking.items.length; i++) {
    if (STATE.tracking.items[i].idTracking === idTracking) {
      item = STATE.tracking.items[i];
      break;
    }
  }
  if (!item) {
    showToast('Delivery order tidak ditemukan.', 'error');
    return;
  }

  STATE.modalPhotos = [];
  STATE.modalTargetIds = [idTracking];
  STATE.modalGps = null;
  STATE.modalGpsLoading = true;
  STATE.modalGpsError = '';

  var html =
    '<div class="modal-header">' +
      '<h3 class="modal-title">Selesai Pengiriman Online</h3>' +
      '<button type="button" class="modal-close" onclick="closeModal()">' + ICONS.x + '</button>' +
    '</div>' +
    '<div class="modal-body">' +
      '<div class="alert-box alert-info" style="margin-bottom:12px">' +
        'Pengiriman Via Online untuk <strong>' + escapeHtml(item.nomorDO) + '</strong> (' + escapeHtml(item.namaCustomer) + '). ' +
        'Upload foto bukti barang telah diterima customer (bisa ambil langsung dari kamera atau pilih dari galeri HP).' +
      '</div>' +
      '<div class="form-group">' +
        '<label class="form-label">Koordinat GPS Lokasi Penerima <span class="req">*</span></label>' +
        '<div id="gps-box-holder">' + renderGpsStatusBox() + '</div>' +
      '</div>' +
      '<div class="form-group">' +
        '<label class="form-label" for="online-penerima">Nama Penerima Barang (Opsional)</label>' +
        '<input id="online-penerima" class="form-control" type="text" placeholder="Nama customer / penerima barang" />' +
      '</div>' +
      '<div class="form-group">' +
        '<label class="form-label" for="online-keterangan">Keterangan / Catatan (Opsional)</label>' +
        '<textarea id="online-keterangan" class="form-control" rows="2" placeholder="Catatan tambahan tanda terima..."></textarea>' +
      '</div>' +
      renderPhotoUploaderSection('Foto Bukti Terima Barang oleh Customer', false, true) +
    '</div>' +
    '<div class="modal-footer">' +
      '<button type="button" class="btn btn-secondary" onclick="closeModal()">Batal</button>' +
      '<button id="online-complete-btn" type="button" class="btn btn-emerald" onclick="submitCompleteOnlineDelivery(\'' + escapeHtml(idTracking) + '\')">' + ICONS.check + '<span>Selesai Pengiriman</span></button>' +
    '</div>';

  openModal(html);
  acquireModalGps();
}

function submitCompleteOnlineDelivery(idTracking) {
  if (!STATE.modalGps) {
    showToast('Koordinat GPS wajib terdeteksi sebelum menyelesaikan pengiriman.', 'warning');
    return;
  }
  if (!STATE.modalPhotos.length) {
    showToast('Wajib mengunggah minimal 1 foto bukti barang sudah diterima customer.', 'warning');
    return;
  }

  var btn = document.getElementById('online-complete-btn');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span><span>Menyimpan Bukti Selesai...</span>';
  }

  var payload = {
    idTracking: idTracking,
    photos: STATE.modalPhotos,
    gps: STATE.modalGps,
    namaPenerima: document.getElementById('online-penerima') ? document.getElementById('online-penerima').value.trim() : '',
    keterangan: document.getElementById('online-keterangan') ? document.getElementById('online-keterangan').value.trim() : ''
  };

  callGasApi('completeOnlineDelivery', payload)
    .then(function () {
      clearApiCache('tracking_');
      clearApiCache('orders_');
      clearApiCache('dashboard_');
      clearApiCache('report_');
      closeModal();
      fetchDriverTrackingData(true);
      showToast('Pengiriman Online berhasil diselesaikan!', 'success');
    })
    .catch(function (err) {
      showToast(err.message, 'error');
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Selesai Pengiriman';
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
        '<label class="form-label" for="fail-alasan">Keterangan / Alasan Gagal Kirim <span class="req">*</span></label>' +
        '<textarea id="fail-alasan" class="form-control" rows="3" placeholder="Contoh: Toko tutup, PIC menolak barang, kurir/ekspedisi menolak pengiriman, alamat tidak dapat diakses..." required></textarea>' +
      '</div>' +
      renderPhotoUploaderSection('Foto Bukti Kendala di Lapangan', false, true) +
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
    showToast('Keterangan / alasan Gagal Kirim wajib diisi minimal 3 karakter.', 'warning');
    return;
  }
  if (!STATE.modalPhotos || !STATE.modalPhotos.length) {
    showToast('Foto bukti kendala Gagal Kirim wajib diambil minimal 1 foto.', 'warning');
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

      var pkpMaps = buildGoogleMapsUrl(d.pickUpLat, d.pickUpLng);
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
              '<div class="cell-sub" style="margin-top:4px">Pengiriman VIA: <strong>' + escapeHtml(d.via || 'Driver') + '</strong></div>' +
            '</div>' +
          '</div>' +
          '<div class="card" style="padding:12px">' +
            '<div class="cell-strong" style="margin-bottom:8px">Ringkasan Tahap Lapangan</div>' +
            '<div class="form-grid-2">' +
              '<div><div class="cell-sub">Pick Up Batch: <strong>' + escapeHtml(d.idPickUpBatch || '-') + '</strong></div><div class="cell-sub">Waktu: ' + (d.waktuPickUp ? formatDateTimeID(d.waktuPickUp) : '-') + '</div>' + (pkpMaps ? '<div style="margin-top:2px"><a target="_blank" rel="noopener" href="' + escapeHtml(pkpMaps) + '">Lihat Lokasi GPS Pick Up (' + d.pickUpLat + ', ' + d.pickUpLng + ')</a></div>' : '') + '</div>' +
              '<div><div class="cell-sub">Penerima: <strong>' + escapeHtml(d.namaPenerima || '-') + '</strong></div><div class="cell-sub">Keterangan: ' + escapeHtml(d.keterangan || '-') + '</div></div>' +
              '<div><div class="cell-sub">' + ((d.via === 'Kurir' || d.via === 'Online') ? 'Selesai' : 'Check-In') + ': ' + (d.waktuCheckIn ? formatDateTimeID(d.waktuCheckIn) : '-') + '</div>' + (ciMaps ? '<div style="margin-top:2px"><a target="_blank" rel="noopener" href="' + escapeHtml(ciMaps) + '">Lihat Lokasi GPS ' + ((d.via === 'Kurir' || d.via === 'Online') ? 'Selesai' : 'Check-In') + ' (' + d.checkInLat + ', ' + d.checkInLng + ')</a></div>' : '') + '</div>' +
              '<div><div class="cell-sub">Check-Out: ' + (d.waktuCheckOut ? formatDateTimeID(d.waktuCheckOut) : '-') + (d.waktuCheckIn && d.waktuCheckOut ? ' (' + formatDuration(d.waktuCheckIn, d.waktuCheckOut) + ')' : '') + '</div>' + (coMaps && coMaps !== ciMaps ? '<div style="margin-top:2px"><a target="_blank" rel="noopener" href="' + escapeHtml(coMaps) + '">Lihat Lokasi GPS Check-Out (' + d.checkOutLat + ', ' + d.checkOutLng + ')</a></div>' : '') + '</div>' +
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

function resetKaryawanFilter() {
  STATE.karyawan.filters = { search: '', divisi: '', status: '' };
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
      var badgeDivisi = k.divisi === 'Back Office'
        ? '<span class="badge badge-info">Back Office</span>'
        : (k.divisi === 'Admin Delivery'
            ? '<span class="badge badge-primary">Admin Delivery</span>'
            : '<span class="badge badge-jalan">Driver</span>');
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
        '<p class="page-subtitle">Kelola data karyawan beserta akun login divisi Back Office, Driver, dan Admin Delivery</p>' +
      '</div>' +
      '<div class="header-actions">' +
        renderSyncStatusBadge() +
        '<button type="button" class="btn btn-primary" onclick="openKaryawanModal(\'\')">' + ICONS.plus + '<span>Tambah Karyawan</span></button>' +
      '</div>' +
    '</div>' +
    '<div class="card" style="margin-bottom:14px">' +
      '<div class="filter-bar" style="margin-bottom:0">' +
        '<div class="form-group"><label class="form-label">Cari Karyawan</label><input id="kry-search" class="form-control" type="text" value="' + escapeHtml(f.search) + '" placeholder="Nama, ID, username..." onkeydown="if(event.key===\'Enter\'){event.preventDefault();applyKaryawanFilter();}" /></div>' +
        '<div class="form-group"><label class="form-label">Divisi</label><select id="kry-divisi" class="form-control"><option value="">Semua Divisi</option><option value="Back Office" ' + (f.divisi === 'Back Office' ? 'selected' : '') + '>Back Office</option><option value="Driver" ' + (f.divisi === 'Driver' ? 'selected' : '') + '>Driver</option><option value="Admin Delivery" ' + (f.divisi === 'Admin Delivery' ? 'selected' : '') + '>Admin Delivery</option></select></div>' +
        '<div class="form-group"><label class="form-label">Status</label><select id="kry-status" class="form-control"><option value="">Semua</option><option value="Aktif" ' + (f.status === 'Aktif' ? 'selected' : '') + '>Aktif</option><option value="Nonaktif" ' + (f.status === 'Nonaktif' ? 'selected' : '') + '>Nonaktif</option></select></div>' +
        '<div class="form-group" style="display:flex;gap:6px">' +
          '<button type="button" class="btn btn-navy" onclick="applyKaryawanFilter()">Filter</button>' +
          '<button type="button" class="btn-reset-filter" onclick="resetKaryawanFilter()" title="Reset Filter">' + ICONS.rotateCcw + '<span>Reset</span></button>' +
        '</div>' +
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
  var curDivisi = item ? item.divisi : 'Driver';

  var html =
    '<div class="modal-header"><h3 class="modal-title">' + (isEdit ? 'Ubah Data Karyawan' : 'Tambah Karyawan Baru') + '</h3><button type="button" class="modal-close" onclick="closeModal()">' + ICONS.x + '</button></div>' +
    '<form id="karyawan-form">' +
      '<div class="modal-body">' +
        '<div class="form-grid-2">' +
          '<div class="form-group"><label class="form-label">Nama Lengkap <span class="req">*</span></label><input id="kf-nama" class="form-control" type="text" value="' + escapeHtml(item ? item.namaKaryawan : '') + '" required /></div>' +
          '<div class="form-group"><label class="form-label">Divisi <span class="req">*</span></label><select id="kf-divisi" class="form-control" required><option value="Driver" ' + (curDivisi === 'Driver' ? 'selected' : '') + '>Driver</option><option value="Back Office" ' + (curDivisi === 'Back Office' ? 'selected' : '') + '>Back Office</option><option value="Admin Delivery" ' + (curDivisi === 'Admin Delivery' ? 'selected' : '') + '>Admin Delivery</option></select></div>' +
        '</div>' +
        '<div class="form-grid-2">' +
          '<div class="form-group"><label class="form-label">No. WhatsApp</label><input id="kf-wa" class="form-control" type="text" value="' + escapeHtml(item ? item.noWhatsApp : '') + '" placeholder="0812xxxxxxxx" /></div>' +
          '<div class="form-group"><label class="form-label">Status <span class="req">*</span></label><select id="kf-status" class="form-control"><option value="Aktif" ' + (!item || item.status === 'Aktif' ? 'selected' : '') + '>Aktif</option><option value="Nonaktif" ' + (item && item.status === 'Nonaktif' ? 'selected' : '') + '>Nonaktif</option></select></div>' +
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

function resetCustomerFilter() {
  STATE.customer.filters = { search: '', status: '' };
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
        '<div class="form-group" style="display:flex;gap:6px">' +
          '<button type="button" class="btn btn-navy" onclick="applyCustomerFilter()">Filter</button>' +
          '<button type="button" class="btn-reset-filter" onclick="resetCustomerFilter()" title="Reset Filter">' + ICONS.rotateCcw + '<span>Reset</span></button>' +
        '</div>' +
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

function resetMobilFilter() {
  STATE.mobil.filters = { search: '', status: '' };
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
    rowsHtml = '<tr><td colspan="6" class="empty-state">Tidak ada data mobil.</td></tr>';
  } else {
    for (var i = 0; i < items.length; i++) {
      var m = items[i];
      var badgeStatus = m.status === 'Aktif' ? '<span class="badge badge-selesai">Aktif</span>' : '<span class="badge badge-gagal">Nonaktif</span>';
      rowsHtml +=
        '<tr>' +
          '<td><div class="cell-strong">' + escapeHtml(m.idMobil) + '</div></td>' +
          '<td><div class="cell-strong">' + escapeHtml(m.platMobil) + '</div></td>' +
          '<td>' + escapeHtml(m.jenisMobil || '-') + '</td>' +
          '<td><span class="badge" style="background:#fef3c7;color:#92400e;border:1px solid #fde68a">' + escapeHtml(m.jenisBbm || 'Solar / Biosolar') + '</span></td>' +
          '<td>' + badgeStatus + '</td>' +
          '<td><button type="button" class="btn btn-secondary btn-sm" onclick="openMobilModal(\'' + escapeHtml(m.idMobil) + '\')">' + ICONS.edit + '<span>Edit</span></button></td>' +
        '</tr>';
    }
  }

  return (
    '<div class="page-header">' +
      '<div>' +
        '<h2 class="page-title">Master Mobil</h2>' +
        '<p class="page-subtitle">Kelola data plat nomor kendaraan, jenis mobil, dan jenis BBM untuk pengiriman Delivery Order</p>' +
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
        '<div class="form-group" style="display:flex;gap:6px">' +
          '<button type="button" class="btn btn-navy" onclick="applyMobilFilter()">Filter</button>' +
          '<button type="button" class="btn-reset-filter" onclick="resetMobilFilter()" title="Reset Filter">' + ICONS.rotateCcw + '<span>Reset</span></button>' +
        '</div>' +
      '</div>' +
    '</div>' +
    '<div class="table-card">' +
      '<div class="table-wrap"><table class="data-table"><thead><tr><th>ID Mobil</th><th>Plat Mobil</th><th>Jenis Mobil</th><th>Jenis BBM</th><th>Status</th><th>Aksi</th></tr></thead><tbody>' + rowsHtml + '</tbody></table></div>' +
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

  var bbmOpts =
    '<option value="Solar / Biosolar" ' + (!item || item.jenisBbm === 'Solar / Biosolar' ? 'selected' : '') + '>Solar / Biosolar</option>' +
    '<option value="Dexlite" ' + (item && item.jenisBbm === 'Dexlite' ? 'selected' : '') + '>Dexlite</option>' +
    '<option value="Pertamina Dex" ' + (item && item.jenisBbm === 'Pertamina Dex' ? 'selected' : '') + '>Pertamina Dex</option>' +
    '<option value="Pertalite" ' + (item && item.jenisBbm === 'Pertalite' ? 'selected' : '') + '>Pertalite</option>' +
    '<option value="Pertamax" ' + (item && item.jenisBbm === 'Pertamax' ? 'selected' : '') + '>Pertamax</option>' +
    '<option value="Pertamax Turbo" ' + (item && item.jenisBbm === 'Pertamax Turbo' ? 'selected' : '') + '>Pertamax Turbo</option>';

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
          '<label class="form-label" for="mbl-jenis-bbm">Jenis BBM <span class="req">*</span></label>' +
          '<select id="mbl-jenis-bbm" class="form-control">' + bbmOpts + '</select>' +
          '<span class="form-hint">Jenis BBM default yang akan otomatis terpilih saat driver mengisi BBM di SPBU.</span>' +
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
      jenisBbm: document.getElementById('mbl-jenis-bbm').value,
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
// MASTER BBM (JENIS BBM & HARGA PER LITER)
// ============================================================================

function fetchMasterBbmData(forceRefresh, fetchOpts) {
  var silent = Boolean(fetchOpts && fetchOpts.silent);
  var f = STATE.bbmMaster.filters;
  var payload = {
    page: STATE.bbmMaster.page,
    limit: STATE.bbmMaster.limit,
    search: f.search,
    status: f.status
  };
  var cacheKey = 'bbm_master_' + JSON.stringify(payload);
  var servedFromCache = !forceRefresh && hasCacheEntry(cacheKey);
  if (!servedFromCache) {
    setSyncVisualState(true, false);
  }

  callGasApi('listBbmMaster', payload, {
    cacheKey: cacheKey,
    forceRefresh: Boolean(forceRefresh)
  }).then(function (data) {
    var snap = JSON.stringify({ query: payload, data: data });
    var changed = STATE.lastSnapshots.bbmMaster !== snap;

    STATE.bbmMaster.items = data.items || [];
    STATE.bbmMaster.total = data.total || 0;
    STATE.bbmMaster.page = data.page || 1;
    STATE.bbmMaster.totalPages = data.totalPages || 1;
    STATE.lastSnapshots.bbmMaster = snap;

    setSyncVisualState(false, !servedFromCache || Boolean(forceRefresh));

    if (STATE.currentPage === 'bbm-master' && (changed || (!silent && !servedFromCache))) {
      renderApp();
    }
    if (servedFromCache && !silent) {
      fetchMasterBbmData(true, { silent: true });
    }
  }).catch(function (err) {
    setSyncVisualState(false, false);
    if (!silent) {
      showToast(err.message, 'error');
    }
  });
}

function applyMasterBbmFilter() {
  STATE.bbmMaster.filters.search = document.getElementById('bbm-m-search').value.trim();
  STATE.bbmMaster.filters.status = document.getElementById('bbm-m-status').value;
  STATE.bbmMaster.page = 1;
  fetchMasterBbmData(false);
}

function resetMasterBbmFilter() {
  STATE.bbmMaster.filters = { search: '', status: '' };
  STATE.bbmMaster.page = 1;
  fetchMasterBbmData(false);
}

function changeMasterBbmPage(p) {
  STATE.bbmMaster.page = p;
  fetchMasterBbmData(false);
}

function renderMasterBbmView() {
  var f = STATE.bbmMaster.filters;
  var items = STATE.bbmMaster.items;
  var rowsHtml = '';

  if (!items.length) {
    rowsHtml = '<tr><td colspan="5" class="empty-state">Tidak ada data master BBM.</td></tr>';
  } else {
    for (var i = 0; i < items.length; i++) {
      var b = items[i];
      var badgeStatus = b.status === 'Aktif' ? '<span class="badge badge-selesai">Aktif</span>' : '<span class="badge badge-gagal">Nonaktif</span>';
      rowsHtml +=
        '<tr>' +
          '<td><div class="cell-strong">' + escapeHtml(b.idBbm) + '</div></td>' +
          '<td><div class="cell-strong">' + escapeHtml(b.namaBbm) + '</div></td>' +
          '<td><strong style="color:var(--navy);font-size:14px">Rp ' + formatNumberID(b.hargaPerLiter) + '</strong> <span class="cell-sub">/ liter</span></td>' +
          '<td>' + badgeStatus + '</td>' +
          '<td><button type="button" class="btn btn-secondary btn-sm" onclick="openMasterBbmModal(\'' + escapeHtml(b.idBbm) + '\')">' + ICONS.edit + '<span>Edit</span></button></td>' +
        '</tr>';
    }
  }

  return (
    '<div class="page-header">' +
      '<div>' +
        '<h2 class="page-title">Master BBM</h2>' +
        '<p class="page-subtitle">Kelola daftar jenis bahan bakar (BBM) dan tarif harga resmi per liter untuk kalkulasi otomatis pengisian armada</p>' +
      '</div>' +
      '<div class="header-actions">' +
        renderSyncStatusBadge() +
        '<button type="button" class="btn btn-primary" onclick="openMasterBbmModal(\'\')">' + ICONS.plus + '<span>Tambah BBM</span></button>' +
      '</div>' +
    '</div>' +
    '<div class="card" style="margin-bottom:14px">' +
      '<div class="filter-bar" style="margin-bottom:0">' +
        '<div class="form-group"><label class="form-label">Cari Jenis BBM</label><input id="bbm-m-search" class="form-control" type="text" value="' + escapeHtml(f.search) + '" placeholder="Nama BBM, ID..." onkeydown="if(event.key===\'Enter\'){event.preventDefault();applyMasterBbmFilter();}" /></div>' +
        '<div class="form-group"><label class="form-label">Status</label><select id="bbm-m-status" class="form-control"><option value="">Semua</option><option value="Aktif" ' + (f.status === 'Aktif' ? 'selected' : '') + '>Aktif</option><option value="Nonaktif" ' + (f.status === 'Nonaktif' ? 'selected' : '') + '>Nonaktif</option></select></div>' +
        '<div class="form-group" style="display:flex;gap:6px">' +
          '<button type="button" class="btn btn-navy" onclick="applyMasterBbmFilter()">Filter</button>' +
          '<button type="button" class="btn-reset-filter" onclick="resetMasterBbmFilter()" title="Reset Filter">' + ICONS.rotateCcw + '<span>Reset</span></button>' +
        '</div>' +
      '</div>' +
    '</div>' +
    '<div class="table-card">' +
      '<div class="table-wrap"><table class="data-table"><thead><tr><th>ID BBM</th><th>Nama Jenis BBM</th><th>Harga Per Liter (Rp)</th><th>Status</th><th>Aksi</th></tr></thead><tbody>' + rowsHtml + '</tbody></table></div>' +
      renderPaginationBar(STATE.bbmMaster.page, STATE.bbmMaster.totalPages, STATE.bbmMaster.total, 'changeMasterBbmPage') +
    '</div>'
  );
}

function openMasterBbmModal(idBbm) {
  var item = null;
  if (idBbm) {
    for (var i = 0; i < STATE.bbmMaster.items.length; i++) {
      if (STATE.bbmMaster.items[i].idBbm === idBbm) {
        item = STATE.bbmMaster.items[i];
        break;
      }
    }
  }
  var isEdit = Boolean(item);

  var html =
    '<div class="modal-header"><h3 class="modal-title">' + (isEdit ? 'Ubah Data Master BBM' : 'Tambah Jenis BBM Baru') + '</h3><button type="button" class="modal-close" onclick="closeModal()">' + ICONS.x + '</button></div>' +
    '<form id="bbm-master-form">' +
      '<div class="modal-body">' +
        '<div class="form-group">' +
          '<label class="form-label" for="bbm-m-nama">Nama Jenis BBM <span class="req">*</span></label>' +
          '<input id="bbm-m-nama" class="form-control" type="text" value="' + escapeHtml(item ? item.namaBbm : '') + '" placeholder="Contoh: Pertalite, Solar / Biosolar, Dexlite..." required />' +
        '</div>' +
        '<div class="form-group">' +
          '<label class="form-label" for="bbm-m-harga">Harga Per Liter (Rp) <span class="req">*</span></label>' +
          '<input id="bbm-m-harga" class="form-control" type="number" min="1" step="1" value="' + (item ? item.hargaPerLiter : '') + '" placeholder="Contoh: 10000" required />' +
          '<span class="form-hint">Digunakan untuk konversi otomatis antara Total Biaya (Rp) dan Jumlah Liter di form pengisian driver.</span>' +
        '</div>' +
        '<div class="form-group">' +
          '<label class="form-label" for="bbm-m-status-input">Status</label>' +
          '<select id="bbm-m-status-input" class="form-control"><option value="Aktif" ' + (!item || item.status === 'Aktif' ? 'selected' : '') + '>Aktif</option><option value="Nonaktif" ' + (item && item.status === 'Nonaktif' ? 'selected' : '') + '>Nonaktif</option></select>' +
        '</div>' +
      '</div>' +
      '<div class="modal-footer">' +
        '<button type="button" class="btn btn-secondary" onclick="closeModal()">Batal</button>' +
        '<button id="bbm-m-save-btn" type="submit" class="btn btn-primary">Simpan Master BBM</button>' +
      '</div>' +
    '</form>';

  openModal(html);

  document.getElementById('bbm-master-form').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var btn = document.getElementById('bbm-m-save-btn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span><span>Menyimpan...</span>';

    var namaVal = document.getElementById('bbm-m-nama').value.trim();
    var hargaVal = Number(document.getElementById('bbm-m-harga').value);
    var statusVal = document.getElementById('bbm-m-status-input').value;

    if (!namaVal) {
      showToast('Nama BBM wajib diisi.', 'warning');
      btn.disabled = false;
      btn.textContent = 'Simpan Master BBM';
      return;
    }
    if (isNaN(hargaVal) || hargaVal <= 0) {
      showToast('Harga per liter harus berupa angka positif.', 'warning');
      btn.disabled = false;
      btn.textContent = 'Simpan Master BBM';
      return;
    }

    callGasApi('saveBbmMaster', {
      idBbm: item ? item.idBbm : '',
      namaBbm: namaVal,
      hargaPerLiter: hargaVal,
      status: statusVal
    }).then(function () {
      clearApiCache('bbm_master_');
      clearApiCache('dropdowns');
      closeModal();
      fetchMasterBbmData(true);
      ensureDropdownsLoaded(true);
      showToast('Data master BBM berhasil disimpan.', 'success');
    }).catch(function (err) {
      showToast(err.message, 'error');
      btn.disabled = false;
      btn.textContent = 'Simpan Master BBM';
    });
  });
}

// ============================================================================
// MASTER PENGIRIMAN VIA (DRIVER, KURIR, ONLINE, DLL)
// ============================================================================

function fetchMasterViaData(forceRefresh, fetchOpts) {
  var silent = Boolean(fetchOpts && fetchOpts.silent);
  var f = STATE.viaMaster.filters;
  var payload = { page: STATE.viaMaster.page, limit: STATE.viaMaster.limit, search: f.search, status: f.status };
  var cacheKey = 'via_master_' + JSON.stringify(payload);
  var servedFromCache = !forceRefresh && hasCacheEntry(cacheKey);
  if (!servedFromCache) {
    setSyncVisualState(true, false);
  }

  callGasApi('listViaMaster', payload, {
    cacheKey: cacheKey,
    forceRefresh: Boolean(forceRefresh)
  }).then(function (data) {
    var snap = JSON.stringify({ query: payload, data: data });
    var changed = STATE.lastSnapshots.viaMaster !== snap;

    STATE.viaMaster.items = data.items || [];
    STATE.viaMaster.total = data.total || 0;
    STATE.viaMaster.page = data.page || 1;
    STATE.viaMaster.totalPages = data.totalPages || 1;
    STATE.lastSnapshots.viaMaster = snap;

    setSyncVisualState(false, !servedFromCache || Boolean(forceRefresh));

    if (STATE.currentPage === 'via-master' && (changed || (!silent && !servedFromCache))) {
      renderApp();
    }
    if (servedFromCache && !silent) {
      fetchMasterViaData(true, { silent: true });
    }
  }).catch(function (err) {
    setSyncVisualState(false, false);
    if (!silent) {
      showToast(err.message, 'error');
    }
  });
}

function applyMasterViaFilter() {
  STATE.viaMaster.filters.search = document.getElementById('via-m-search').value.trim();
  STATE.viaMaster.filters.status = document.getElementById('via-m-status').value;
  STATE.viaMaster.page = 1;
  fetchMasterViaData(false);
}

function resetMasterViaFilter() {
  STATE.viaMaster.filters = { search: '', status: '' };
  STATE.viaMaster.page = 1;
  fetchMasterViaData(false);
}

function changeMasterViaPage(p) {
  STATE.viaMaster.page = p;
  fetchMasterViaData(false);
}

function renderViaMasterView() {
  var f = STATE.viaMaster.filters;
  var items = STATE.viaMaster.items;
  var rowsHtml = '';

  if (!items.length) {
    rowsHtml = '<tr><td colspan="5" class="empty-state">Tidak ada data master pengiriman VIA.</td></tr>';
  } else {
    for (var i = 0; i < items.length; i++) {
      var v = items[i];
      var badgeStatus = v.status === 'Aktif' ? '<span class="badge badge-selesai">Aktif</span>' : '<span class="badge badge-gagal">Nonaktif</span>';
      rowsHtml +=
        '<tr>' +
          '<td><div class="cell-strong">' + escapeHtml(v.idVia) + '</div></td>' +
          '<td><div class="cell-strong">' + escapeHtml(v.namaVia) + '</div></td>' +
          '<td>' + escapeHtml(v.keterangan || '-') + '</td>' +
          '<td>' + badgeStatus + '</td>' +
          '<td><button type="button" class="btn btn-secondary btn-sm" onclick="openMasterViaModal(\'' + escapeHtml(v.idVia) + '\')">' + ICONS.edit + '<span>Edit</span></button></td>' +
        '</tr>';
    }
  }

  return (
    '<div class="page-header">' +
      '<div>' +
        '<h2 class="page-title">Master Pengiriman VIA</h2>' +
        '<p class="page-subtitle">Kelola daftar moda dan jalur pengiriman (Driver, Kurir, Online, dsb) yang terhubung ke form input DO</p>' +
      '</div>' +
      '<div class="header-actions">' +
        renderSyncStatusBadge() +
        '<button type="button" class="btn btn-primary" onclick="openMasterViaModal(\'\')">' + ICONS.plus + '<span>Tambah VIA</span></button>' +
      '</div>' +
    '</div>' +
    '<div class="card" style="margin-bottom:14px">' +
      '<div class="filter-bar" style="margin-bottom:0">' +
        '<div class="form-group"><label class="form-label">Cari Pengiriman VIA</label><input id="via-m-search" class="form-control" type="text" value="' + escapeHtml(f.search) + '" placeholder="Nama VIA, Keterangan, ID..." onkeydown="if(event.key===\'Enter\'){event.preventDefault();applyMasterViaFilter();}" /></div>' +
        '<div class="form-group"><label class="form-label">Status</label><select id="via-m-status" class="form-control"><option value="">Semua</option><option value="Aktif" ' + (f.status === 'Aktif' ? 'selected' : '') + '>Aktif</option><option value="Nonaktif" ' + (f.status === 'Nonaktif' ? 'selected' : '') + '>Nonaktif</option></select></div>' +
        '<div class="form-group" style="display:flex;gap:6px">' +
          '<button type="button" class="btn btn-navy" onclick="applyMasterViaFilter()">Filter</button>' +
          '<button type="button" class="btn-reset-filter" onclick="resetMasterViaFilter()" title="Reset Filter">' + ICONS.rotateCcw + '<span>Reset</span></button>' +
        '</div>' +
      '</div>' +
    '</div>' +
    '<div class="table-card">' +
      '<div class="table-wrap"><table class="data-table"><thead><tr><th>ID VIA</th><th>Nama Moda Pengiriman</th><th>Keterangan</th><th>Status</th><th>Aksi</th></tr></thead><tbody>' + rowsHtml + '</tbody></table></div>' +
      renderPaginationBar(STATE.viaMaster.page, STATE.viaMaster.totalPages, STATE.viaMaster.total, 'changeMasterViaPage') +
    '</div>'
  );
}

function openMasterViaModal(idVia) {
  var item = null;
  if (idVia) {
    for (var i = 0; i < STATE.viaMaster.items.length; i++) {
      if (STATE.viaMaster.items[i].idVia === idVia) {
        item = STATE.viaMaster.items[i];
        break;
      }
    }
  }
  var isEdit = Boolean(item);

  var html =
    '<div class="modal-header"><h3 class="modal-title">' + (isEdit ? 'Ubah Data Master VIA' : 'Tambah Moda Pengiriman VIA Baru') + '</h3><button type="button" class="modal-close" onclick="closeModal()">' + ICONS.x + '</button></div>' +
    '<form id="via-master-form">' +
      '<div class="modal-body">' +
        '<div class="form-group">' +
          '<label class="form-label" for="via-m-nama">Nama Moda Pengiriman VIA <span class="req">*</span></label>' +
          '<input id="via-m-nama" class="form-control" type="text" value="' + escapeHtml(item ? item.namaVia : '') + '" placeholder="Contoh: Driver, Kurir, Online, Kargo..." required />' +
        '</div>' +
        '<div class="form-group">' +
          '<label class="form-label" for="via-m-keterangan">Keterangan</label>' +
          '<input id="via-m-keterangan" class="form-control" type="text" value="' + escapeHtml(item ? item.keterangan : '') + '" placeholder="Contoh: Ekspedisi logistik pihak ketiga, paket eksternal..." />' +
        '</div>' +
        '<div class="form-group">' +
          '<label class="form-label" for="via-m-status-input">Status</label>' +
          '<select id="via-m-status-input" class="form-control"><option value="Aktif" ' + (!item || item.status === 'Aktif' ? 'selected' : '') + '>Aktif</option><option value="Nonaktif" ' + (item && item.status === 'Nonaktif' ? 'selected' : '') + '>Nonaktif</option></select>' +
        '</div>' +
      '</div>' +
      '<div class="modal-footer">' +
        '<button type="button" class="btn btn-secondary" onclick="closeModal()">Batal</button>' +
        '<button id="via-m-save-btn" type="submit" class="btn btn-primary">Simpan Master VIA</button>' +
      '</div>' +
    '</form>';

  openModal(html);

  document.getElementById('via-master-form').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var btn = document.getElementById('via-m-save-btn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span><span>Menyimpan...</span>';

    var namaVal = document.getElementById('via-m-nama').value.trim();
    var ketVal = document.getElementById('via-m-keterangan').value.trim();
    var statusVal = document.getElementById('via-m-status-input').value;

    if (!namaVal) {
      showToast('Nama Moda Pengiriman VIA wajib diisi.', 'warning');
      btn.disabled = false;
      btn.textContent = 'Simpan Master VIA';
      return;
    }

    callGasApi('saveViaMaster', {
      idVia: item ? item.idVia : '',
      namaVia: namaVal,
      keterangan: ketVal,
      status: statusVal
    }).then(function () {
      clearApiCache('via_master_');
      clearApiCache('dropdowns');
      closeModal();
      fetchMasterViaData(true);
      ensureDropdownsLoaded(true);
      showToast('Data master VIA berhasil disimpan.', 'success');
    }).catch(function (err) {
      showToast(err.message, 'error');
      btn.disabled = false;
      btn.textContent = 'Simpan Master VIA';
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
    via: f.via,
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
  STATE.report.filters.via = document.getElementById('rep-via') ? document.getElementById('rep-via').value : '';
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
    via: f.via,
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

function switchReportTab(tabName) {
  STATE.reportActiveTab = tabName;
  STATE.currentPage = 'report';
  var dropdown = document.getElementById('overflow-dropdown');
  if (dropdown) dropdown.classList.remove('open');
  renderApp();
  if (tabName === 'orders') {
    fetchReportData(false);
  } else {
    fetchLaporanAktivitasData(false);
  }
}

function resetReportFilter() {
  STATE.report.filters = { dateFrom: '', dateTo: '', driverId: '', customerId: '', status: '', via: '', search: '' };
  STATE.report.page = 1;
  fetchReportData(true);
}

function resetLaporanAktivitasFilter() {
  var isDriver = STATE.session && STATE.session.user && STATE.session.user.divisi === 'Driver';
  STATE.laporanAktivitas.filters = {
    dateFrom: '',
    dateTo: '',
    driverId: isDriver ? STATE.session.user.idKaryawan : '',
    platMobil: '',
    status: '',
    search: ''
  };
  STATE.laporanAktivitas.page = 1;
  fetchLaporanAktivitasData(true);
}

function renderReportView() {
  var isAktivitas = STATE.reportActiveTab === 'aktivitas';
  var navTabsHtml =
    '<div class="segmented-nav">' +
      '<button type="button" class="segmented-tab-btn ' + (!isAktivitas ? 'active' : '') + '" onclick="switchReportTab(\'orders\')">' +
        ICONS.fileText + '<span>Laporan Delivery Order</span>' +
      '</button>' +
      '<button type="button" class="segmented-tab-btn ' + (isAktivitas ? 'active' : '') + '" onclick="switchReportTab(\'aktivitas\')">' +
        ICONS.truck + '<span>Laporan Aktivitas Driver & Kendaraan</span>' +
      '</button>' +
    '</div>';

  if (isAktivitas) {
    return navTabsHtml + renderLaporanAktivitasContent_();
  }
  return navTabsHtml + renderReportDeliveryOrderContent_();
}

function renderReportDeliveryOrderContent_() {
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

  var viaOpts = buildViaFilterOptionsHtml(f.via);

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
      var repViaTag = r.via ? '<span class="badge badge-via badge-via-' + r.via.toLowerCase() + '">' + escapeHtml(r.via) + '</span>' : '';
      rowsHtml +=
        '<tr>' +
          '<td><div class="cell-strong">' + escapeHtml(r.nomorDO) + ' ' + repViaTag + '</div><div class="cell-sub">' + escapeHtml(r.idTracking) + ' · #' + (r.percobaanKe || 1) + '</div></td>' +
          '<td>' + formatDateID(r.tanggalDO) + '</td>' +
          '<td><div class="cell-strong">' + escapeHtml(r.namaCustomer) + '</div><div class="cell-sub">Petugas: ' + escapeHtml(r.namaDriver) + ' (' + escapeHtml(r.via || 'Driver') + ')</div><div class="cell-sub">Mobil: ' + repMobilText + '</div></td>' +
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
        '<div class="form-group"><label class="form-label">Pengiriman VIA</label><select id="rep-via" class="form-control">' + viaOpts + '</select></div>' +
        '<div class="form-group"><label class="form-label">Status</label><select id="rep-status" class="form-control">' + stOpts + '</select></div>' +
        '<div class="form-group"><label class="form-label">Cari Teks</label><input id="rep-search" class="form-control" type="text" value="' + escapeHtml(f.search) + '" placeholder="No DO / Plat / Penerima..." onkeydown="if(event.key===\'Enter\'){event.preventDefault();applyReportFilter();}" /></div>' +
        '<div class="form-group" style="display:flex;gap:6px">' +
          '<button type="button" class="btn btn-navy" style="flex:1" onclick="applyReportFilter()">Tampilkan</button>' +
          '<button type="button" class="btn-reset-filter" onclick="resetReportFilter()" title="Reset Filter">' + ICONS.rotateCcw + '<span>Reset</span></button>' +
        '</div>' +
      '</div>' +
    '</div>' +
    '<div class="table-card">' +
      '<div class="table-wrap"><table class="data-table"><thead><tr><th>Nomor DO / ID</th><th>Tgl DO</th><th>Customer, Driver & Mobil</th><th>Status</th><th>Waktu Pengiriman</th><th>Penerima / Alasan Gagal</th><th>Aksi</th></tr></thead><tbody>' + rowsHtml + '</tbody></table></div>' +
      renderPaginationBar(STATE.report.page, STATE.report.totalPages, STATE.report.total, 'changeReportPage') +
    '</div>'
  );
}

// ============================================================================
// MENU AKTIVITAS DRIVER (CHECK-OUT, ISI BBM, CHECK-IN KANTOR)
// ============================================================================

function fetchAktivitasDriverData(forceRefresh, fetchOpts) {
  if (!STATE.session || !STATE.session.user) {
    return Promise.resolve();
  }
  var driverId = STATE.session.user.idKaryawan;
  var cacheKey = 'aktivitas_driver_' + driverId;
  var isSilent = Boolean(fetchOpts && fetchOpts.silent);

  if (!isSilent) {
    STATE.aktivitas.loading = true;
  }

  return callGasApi('getActiveAktivitas', { driverId: driverId }, {
    cacheKey: cacheKey,
    forceRefresh: Boolean(forceRefresh)
  }).then(function (data) {
    STATE.aktivitas.loading = false;
    var res = data || { hasActive: false, aktivitas: null, lastAktivitas: null, bbmList: [] };
    var snap = JSON.stringify(res);
    var changed = STATE.lastSnapshots[cacheKey] !== snap;
    STATE.lastSnapshots[cacheKey] = snap;

    STATE.aktivitas.hasActive = Boolean(res.hasActive);
    STATE.aktivitas.active = res.aktivitas || null;
    STATE.aktivitas.lastAktivitas = res.lastAktivitas || null;
    STATE.aktivitas.bbmList = res.bbmList || [];

    if (STATE.currentPage === 'aktivitas-driver' && (!isSilent || (changed && !isUiBusyForBackgroundSync()))) {
      renderApp();
    }
  }).catch(function (err) {
    STATE.aktivitas.loading = false;
    if (!isSilent) {
      showToast('Gagal memuat status aktivitas: ' + err.message, 'error');
    }
  });
}

function renderAktivitasDriverView() {
  var act = STATE.aktivitas.active;
  var last = STATE.aktivitas.lastAktivitas;
  var bbmList = STATE.aktivitas.bbmList || [];
  var heroHtml = '';

  if (act) {
    // Sedang Berangkat
    var mapsBerangkat = (act.gpsBerangkatLat && act.gpsBerangkatLng)
      ? buildGoogleMapsUrl(act.gpsBerangkatLat, act.gpsBerangkatLng)
      : '';
    var fotoKmAwalLink = act.fotoKmAwal
      ? '<a class="btn btn-secondary btn-sm" target="_blank" rel="noopener" href="' + escapeHtml(act.fotoKmAwal) + '">' + ICONS.eye + '<span>Foto KM Awal</span></a>'
      : '';

    heroHtml =
      '<div class="trip-hero ongoing">' +
        '<div class="trip-hero-header">' +
          '<div>' +
            '<div style="margin-bottom:8px">' +
              '<span class="badge" style="background:#10b981;color:#ffffff;font-size:12px;padding:4px 10px;font-weight:700">Sedang Berangkat</span>' +
              ' <span class="vehicle-tag" style="background:rgba(255,255,255,0.15);color:#ffffff;border:none">' + escapeHtml(act.idAktivitas) + '</span>' +
            '</div>' +
            '<h2 class="trip-hero-title">' + ICONS.truck + '<span>' + escapeHtml(act.platMobil) + '</span></h2>' +
            '<p class="trip-hero-subtitle">' + escapeHtml(act.jenisMobil || 'Armada Operasional') + ' · Berangkat: ' + formatDateTimeID(act.waktuBerangkat) + '</p>' +
          '</div>' +
          '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">' +
            fotoKmAwalLink +
            (mapsBerangkat ? '<a class="btn btn-secondary btn-sm" target="_blank" rel="noopener" href="' + escapeHtml(mapsBerangkat) + '">' + ICONS.mapPin + '<span>GPS Berangkat</span></a>' : '') +
          '</div>' +
        '</div>' +
        '<div class="trip-stat-grid">' +
          '<div class="trip-stat-item"><span class="trip-stat-label">Odometer Awal</span><span class="trip-stat-value"><span class="odometer-badge">' + formatNumberID(act.kmAwal) + ' KM</span></span></div>' +
          '<div class="trip-stat-item"><span class="trip-stat-label">Total Isi BBM</span><span class="trip-stat-value">Rp ' + formatNumberID(act.totalBiayaBbm || 0) + '</span></div>' +
          '<div class="trip-stat-item"><span class="trip-stat-label">Volume BBM</span><span class="trip-stat-value">' + (act.totalLiterBbm || 0) + ' Liter</span></div>' +
          '<div class="trip-stat-item"><span class="trip-stat-label">Frekuensi BBM</span><span class="trip-stat-value">' + bbmList.length + ' Kali</span></div>' +
        '</div>' +
        '<div class="trip-hero-actions">' +
          '<button type="button" class="btn btn-emerald" style="padding:12px 20px;font-size:14px" onclick="openBbmModal()">' + ICONS.fuel + '<span>Isi BBM di SPBU</span></button>' +
          '<button type="button" class="btn btn-navy" style="background:#ffffff;color:#0f172a;padding:12px 20px;font-size:14px" onclick="openCheckInAktivitasModal()">' + ICONS.check + '<span>Check-In (Tiba di Kantor)</span></button>' +
        '</div>' +
      '</div>';
  } else {
    // Belum Berangkat / Selesai
    var lastInfo = '';
    if (last) {
      lastInfo =
        '<div style="margin-top:16px;padding:12px 14px;background:rgba(255,255,255,0.08);border-radius:var(--radius-sm);font-size:12.5px">' +
          '<strong>Perjalanan Terakhir:</strong> ' + escapeHtml(last.platMobil) + ' (' + formatDateID(last.tanggal) + ') · Total Jarak: <strong>' + formatNumberID(last.totalKm) + ' KM</strong> · Total BBM: <strong>Rp ' + formatNumberID(last.totalBiayaBbm) + '</strong>' +
        '</div>';
    }

    heroHtml =
      '<div class="trip-hero idle">' +
        '<div class="trip-hero-header">' +
          '<div>' +
            '<div style="margin-bottom:8px"><span class="badge" style="background:#64748b;color:#ffffff;font-size:12px;padding:4px 10px">Armada Siap</span></div>' +
            '<h2 class="trip-hero-title">' + ICONS.truck + '<span>Siap Berangkat Tugas</span></h2>' +
            '<p class="trip-hero-subtitle">Mulai perjalanan dinas harian atau pengiriman barang dengan melakukan Check-Out keberangkatan.</p>' +
          '</div>' +
        '</div>' +
        '<div class="trip-hero-actions">' +
          '<button type="button" class="btn btn-primary" style="padding:14px 24px;font-size:15px;font-weight:700" onclick="openCheckOutAktivitasModal()">' + ICONS.truck + '<span>Check-Out (Berangkat dari Kantor)</span></button>' +
        '</div>' +
        lastInfo +
      '</div>';
  }

  // Riwayat Pengisian BBM Sesi Ini
  var bbmListHtml = '';
  if (act) {
    if (!bbmList.length) {
      bbmListHtml = '<div class="empty-state" style="padding:28px 16px">Belum ada pengisian BBM selama sesi perjalanan ini. Klik "Isi BBM di SPBU" jika melakukan pengisian bahan bakar.</div>';
    } else {
      var itemsHtml = '';
      for (var b = 0; b < bbmList.length; b++) {
        var item = bbmList[b];
        var itemGpsUrl = (item.gpsLat && item.gpsLng) ? buildGoogleMapsUrl(item.gpsLat, item.gpsLng) : '';
        var itemFotoLink = item.fotoBbm
          ? '<a class="btn btn-secondary btn-sm" target="_blank" rel="noopener" href="' + escapeHtml(item.fotoBbm) + '">' + ICONS.eye + '<span>Foto Struk</span></a>'
          : '';
        var itemGpsBtn = itemGpsUrl
          ? '<a class="btn btn-secondary btn-sm" target="_blank" rel="noopener" href="' + escapeHtml(itemGpsUrl) + '">' + ICONS.mapPin + '<span>Peta SPBU</span></a>'
          : '';

        itemsHtml +=
          '<div class="bbm-item">' +
            '<div class="bbm-item-left">' +
              '<div class="bbm-icon-box">' + ICONS.fuel + '</div>' +
              '<div>' +
                '<div class="bbm-item-title">' + escapeHtml(item.jenisBbm || 'BBM') + ' · <span class="odometer-badge" style="font-size:11px;padding:2px 6px">' + formatNumberID(item.kmBbm) + ' KM</span></div>' +
                '<div class="bbm-item-meta">' +
                  '<span>' + formatDateTimeID(item.waktuBbm) + '</span>' +
                  (item.catatan ? '<span>· ' + escapeHtml(item.catatan) + '</span>' : '') +
                '</div>' +
              '</div>' +
            '</div>' +
            '<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;justify-content:flex-end">' +
              '<div class="bbm-item-right">' +
                '<div class="bbm-item-cost">Rp ' + formatNumberID(item.biayaBbm) + '</div>' +
                '<div class="bbm-item-volume">' + (item.literBbm || 0) + ' Liter</div>' +
              '</div>' +
              itemFotoLink +
              itemGpsBtn +
            '</div>' +
          '</div>';
      }
      bbmListHtml = '<div class="bbm-timeline">' + itemsHtml + '</div>';
    }
  }

  return (
    '<div class="page-header">' +
      '<div>' +
        '<h2 class="page-title">Aktivitas Operasional Driver</h2>' +
        '<p class="page-subtitle">Pencatatan keberangkatan armada, kilometer odometer, pengisian BBM di jalan, dan check-in kantor</p>' +
      '</div>' +
      '<div class="header-actions">' +
        renderSyncStatusBadge() +
        '<button type="button" class="btn btn-secondary btn-sm" onclick="fetchAktivitasDriverData(true)">' + ICONS.refresh + '<span>Perbarui</span></button>' +
      '</div>' +
    '</div>' +
    heroHtml +
    (act ? '<div class="card" style="margin-top:20px"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:8px"><h3 style="margin:0;font-size:16px;font-weight:700">Rincian Pengisian BBM Sesi Ini</h3><button type="button" class="btn btn-secondary btn-sm" onclick="openBbmModal()">' + ICONS.plus + '<span>Catat Isi BBM</span></button></div>' + bbmListHtml + '</div>' : '')
  );
}

// ----------------------------------------------------------------------------
// MODAL CHECK-OUT (BERANGKAT)
// ----------------------------------------------------------------------------

function renderPhotoSlotsHtml(labelText, isOptional) {
  return renderPhotoUploaderSection(labelText, isOptional);
}

function openCheckOutAktivitasModal() {
  if (!STATE.dropdowns || !STATE.dropdowns.mobils || !STATE.dropdowns.mobils.length) {
    ensureDropdownsLoaded(true).then(function () {
      openCheckOutAktivitasModalContent_();
    }).catch(function () {
      openCheckOutAktivitasModalContent_();
    });
    return;
  }
  openCheckOutAktivitasModalContent_();
}

function openCheckOutAktivitasModalContent_() {
  STATE.modalPhotos = [];
  STATE.modalGps = null;
  STATE.modalGpsLoading = true;
  STATE.modalGpsError = '';

  var mobils = (STATE.dropdowns && STATE.dropdowns.mobils) || [];
  var mobilOpts = '<option value="">-- Pilih Kendaraan / Plat Mobil --</option>';
  for (var m = 0; m < mobils.length; m++) {
    var mob = mobils[m];
    var label = mob.platMobil + (mob.jenisMobil ? ' (' + mob.jenisMobil + ')' : '');
    mobilOpts += '<option value="' + escapeHtml(mob.idMobil) + '">' + escapeHtml(label) + '</option>';
  }

  var body =
    '<div class="modal-header">' +
      '<h3 class="modal-title">Check-Out (Berangkat dari Kantor)</h3>' +
      '<button type="button" class="modal-close" onclick="closeModal()">' + ICONS.x + '</button>' +
    '</div>' +
    '<div class="modal-body">' +
      '<div class="form-group">' +
        '<label class="form-label">Pilih Kendaraan / Plat Mobil <span class="req">*</span></label>' +
        '<select id="akt-out-mobil" class="form-control">' + mobilOpts + '</select>' +
      '</div>' +
      '<div class="form-group">' +
        '<label class="form-label">Kilometer Awal (Odometer Speedometer) <span class="req">*</span></label>' +
        '<input id="akt-out-km" class="form-control" type="number" min="0" placeholder="Contoh: 125000" />' +
        '<span class="form-hint">Ketik angka kilometer yang tertera di speedometer saat mobil hendak berangkat.</span>' +
      '</div>' +
      renderPhotoUploaderSection('Foto Kilometer Awal (Speedometer)', false) +
      '<div class="form-group">' +
        '<label class="form-label">Koordinat GPS Keberangkatan <span class="req">*</span></label>' +
        '<div id="gps-box-holder">' + renderGpsStatusBox() + '</div>' +
      '</div>' +
      '<div class="form-group">' +
        '<label class="form-label">Catatan / Tujuan Keberangkatan (Opsional)</label>' +
        '<textarea id="akt-out-catatan" class="form-control" rows="2" placeholder="Contoh: Pengiriman area Jakarta Barat & Tangerang..."></textarea>' +
      '</div>' +
    '</div>' +
    '<div class="modal-footer">' +
      '<button type="button" class="btn btn-secondary" onclick="closeModal()">Batal</button>' +
      '<button id="btn-submit-checkout-akt" type="button" class="btn btn-primary" onclick="submitCheckOutAktivitas()" disabled>' + ICONS.truck + '<span>Berangkat Sekarang</span></button>' +
    '</div>';

  openModal(body, false);
  acquireModalGps();
}

function submitCheckOutAktivitas() {
  var idMobil = document.getElementById('akt-out-mobil').value;
  var kmVal = document.getElementById('akt-out-km').value;
  var catatan = document.getElementById('akt-out-catatan').value.trim();

  if (!idMobil) {
    showToast('Pilih kendaraan / plat mobil terlebih dahulu.', 'warning');
    return;
  }
  if (!kmVal || isNaN(Number(kmVal)) || Number(kmVal) < 0) {
    showToast('Ketik kilometer awal odometer dengan angka yang valid.', 'warning');
    return;
  }
  if (!STATE.modalPhotos.length) {
    showToast('Wajib mengambil minimal 1 foto kilometer awal (speedometer).', 'warning');
    return;
  }
  if (!STATE.modalGps) {
    showToast('Koordinat GPS wajib aktif dan terkunci sebelum berangkat.', 'warning');
    return;
  }

  var btn = document.getElementById('btn-submit-checkout-akt');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span><span>Menyimpan Keberangkatan...</span>';
  }

  callGasApi('checkOutAktivitas', {
    idMobil: idMobil,
    kmAwal: Number(kmVal),
    fotoKmAwal: (STATE.modalPhotos && STATE.modalPhotos.length ? STATE.modalPhotos[0] : ''),
    photos: STATE.modalPhotos,
    gps: STATE.modalGps,
    catatanBerangkat: catatan,
    catatan: catatan
  }).then(function (res) {
    closeModal();
    showToast(res.message || 'Check-Out Berangkat berhasil! Selamat bertugas.', 'success');
    clearApiCache();
    fetchAktivitasDriverData(true);
  }).catch(function (err) {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = ICONS.truck + '<span>Berangkat Sekarang</span>';
    }
    showToast(err.message, 'error');
  });
}

// ----------------------------------------------------------------------------
// MODAL ISI BBM DI JALAN
// ----------------------------------------------------------------------------

function isBbmMatch(a, b) {
  if (!a || !b) return false;
  var s1 = String(a).toLowerCase().trim();
  var s2 = String(b).toLowerCase().trim();
  return s1 === s2 || s1.indexOf(s2) !== -1 || s2.indexOf(s1) !== -1;
}

function getSelectedBbmPrice(jenisNama) {
  var bbmList = (STATE.dropdowns && STATE.dropdowns.bbms && STATE.dropdowns.bbms.length)
    ? STATE.dropdowns.bbms
    : [
        { namaBbm: 'Solar / Biosolar', hargaPerLiter: 6800 },
        { namaBbm: 'Dexlite', hargaPerLiter: 13700 },
        { namaBbm: 'Pertamina Dex', hargaPerLiter: 14200 },
        { namaBbm: 'Pertalite', hargaPerLiter: 10000 },
        { namaBbm: 'Pertamax', hargaPerLiter: 12100 },
        { namaBbm: 'Pertamax Turbo', hargaPerLiter: 13250 }
      ];
  for (var i = 0; i < bbmList.length; i++) {
    if (bbmList[i].namaBbm === jenisNama || isBbmMatch(bbmList[i].namaBbm, jenisNama)) {
      return Number(bbmList[i].hargaPerLiter) || 0;
    }
  }
  return 0;
}

function onBbmBiayaInput() {
  var jenisEl = document.getElementById('akt-bbm-jenis');
  var biayaEl = document.getElementById('akt-bbm-biaya');
  var literEl = document.getElementById('akt-bbm-liter');
  if (!jenisEl || !biayaEl || !literEl) return;
  var harga = getSelectedBbmPrice(jenisEl.value);
  var biaya = parseFloat(biayaEl.value);
  if (harga > 0 && !isNaN(biaya) && biaya > 0) {
    var liter = Math.round((biaya / harga) * 100) / 100;
    literEl.value = liter;
  } else if (!biayaEl.value) {
    literEl.value = '';
  }
}

function onBbmLiterInput() {
  var jenisEl = document.getElementById('akt-bbm-jenis');
  var biayaEl = document.getElementById('akt-bbm-biaya');
  var literEl = document.getElementById('akt-bbm-liter');
  if (!jenisEl || !biayaEl || !literEl) return;
  var harga = getSelectedBbmPrice(jenisEl.value);
  var liter = parseFloat(literEl.value);
  if (harga > 0 && !isNaN(liter) && liter > 0) {
    var biaya = Math.round(liter * harga);
    biayaEl.value = biaya;
  } else if (!literEl.value) {
    biayaEl.value = '';
  }
}

function onBbmJenisChange() {
  var jenisEl = document.getElementById('akt-bbm-jenis');
  var badgeEl = document.getElementById('akt-bbm-price-badge');
  if (!jenisEl) return;
  var harga = getSelectedBbmPrice(jenisEl.value);
  if (badgeEl) {
    badgeEl.textContent = harga > 0 ? 'Harga Master: Rp ' + formatNumberID(harga) + ' / Liter' : 'Harga belum disetel';
  }
  var biayaEl = document.getElementById('akt-bbm-biaya');
  var literEl = document.getElementById('akt-bbm-liter');
  if (biayaEl && biayaEl.value && Number(biayaEl.value) > 0) {
    onBbmBiayaInput();
  } else if (literEl && literEl.value && Number(literEl.value) > 0) {
    onBbmLiterInput();
  }
}

function openBbmModal() {
  var act = STATE.aktivitas.active;
  if (!act) {
    showToast('Tidak ada perjalanan aktif. Silakan Check-Out Berangkat terlebih dahulu.', 'warning');
    return;
  }

  STATE.modalPhotos = [];
  STATE.modalGps = null;
  STATE.modalGpsLoading = true;
  STATE.modalGpsError = '';

  // Auto-detect fuel type from Master Mobil
  var carJenis = (act && act.jenisBbm) || '';
  if (!carJenis && STATE.dropdowns && STATE.dropdowns.mobils) {
    for (var m = 0; m < STATE.dropdowns.mobils.length; m++) {
      if (STATE.dropdowns.mobils[m].platMobil === act.platMobil) {
        carJenis = STATE.dropdowns.mobils[m].jenisBbm || '';
        break;
      }
    }
  }

  var bbmList = (STATE.dropdowns && STATE.dropdowns.bbms && STATE.dropdowns.bbms.length)
    ? STATE.dropdowns.bbms
    : [
        { namaBbm: 'Solar / Biosolar', hargaPerLiter: 6800 },
        { namaBbm: 'Dexlite', hargaPerLiter: 13700 },
        { namaBbm: 'Pertamina Dex', hargaPerLiter: 14200 },
        { namaBbm: 'Pertalite', hargaPerLiter: 10000 },
        { namaBbm: 'Pertamax', hargaPerLiter: 12100 },
        { namaBbm: 'Pertamax Turbo', hargaPerLiter: 13250 }
      ];

  var matchedBbm = null;
  if (carJenis) {
    for (var bi = 0; bi < bbmList.length; bi++) {
      if (bbmList[bi].namaBbm === carJenis || isBbmMatch(bbmList[bi].namaBbm, carJenis)) {
        matchedBbm = bbmList[bi];
        break;
      }
    }
  }
  if (!matchedBbm && bbmList.length) {
    matchedBbm = bbmList[0];
  }

  var jenisOpts = '';
  for (var k = 0; k < bbmList.length; k++) {
    var bItem = bbmList[k];
    var isSel = matchedBbm && matchedBbm.namaBbm === bItem.namaBbm;
    jenisOpts += '<option value="' + escapeHtml(bItem.namaBbm) + '" ' + (isSel ? 'selected' : '') + '>' +
      escapeHtml(bItem.namaBbm) + ' (Rp ' + formatNumberID(bItem.hargaPerLiter) + '/L)' +
      '</option>';
  }
  jenisOpts += '<option value="Lainnya">Lainnya</option>';

  var curPrice = matchedBbm ? Number(matchedBbm.hargaPerLiter) : 0;
  var priceBadgeText = curPrice > 0 ? 'Harga Master: Rp ' + formatNumberID(curPrice) + ' / Liter' : 'Harga belum disetel';

  var body =
    '<div class="modal-header">' +
      '<h3 class="modal-title">Catat Pengisian BBM di SPBU</h3>' +
      '<button type="button" class="modal-close" onclick="closeModal()">' + ICONS.x + '</button>' +
    '</div>' +
    '<div class="modal-body">' +
      '<div style="margin-bottom:14px;padding:10px 14px;background:var(--bg-subtle);border-radius:var(--radius-sm);font-size:12.5px">' +
        'Armada: <strong>' + escapeHtml(act.platMobil) + '</strong>' + (carJenis ? ' · Jenis BBM Mobil: <strong>' + escapeHtml(carJenis) + '</strong>' : '') + ' · KM Awal: <strong>' + formatNumberID(act.kmAwal) + ' KM</strong>' +
      '</div>' +
      '<div class="form-group">' +
        '<label class="form-label">Jenis BBM (Terkunci Sesuai Master Kendaraan) <span class="req">*</span></label>' +
        '<select id="akt-bbm-jenis" class="form-control" disabled style="background-color:var(--bg-subtle);cursor:not-allowed;opacity:0.9">' + jenisOpts + '</select>' +
        '<div id="akt-bbm-price-badge" class="calc-badge-price">' + priceBadgeText + '</div>' +
      '</div>' +
      '<div class="form-group">' +
        '<label class="form-label">Kilometer saat Isi BBM <span class="req">*</span></label>' +
        '<input id="akt-bbm-km" class="form-control" type="number" min="' + act.kmAwal + '" placeholder="Contoh: ' + (act.kmAwal + 30) + '" />' +
        '<span class="form-hint">Kilometer odometer speedometer mobil saat tiba di SPBU (harus >= ' + formatNumberID(act.kmAwal) + ' KM).</span>' +
      '</div>' +
      '<div class="form-grid">' +
        '<div class="form-group">' +
          '<label class="form-label">Biaya / Total Pembelian (Rp) <span class="req">*</span></label>' +
          '<input id="akt-bbm-biaya" class="form-control" type="number" min="0" placeholder="Contoh: 200000" oninput="onBbmBiayaInput()" />' +
        '</div>' +
        '<div class="form-group">' +
          '<label class="form-label">Jumlah Liter</label>' +
          '<input id="akt-bbm-liter" class="form-control" type="number" step="0.01" min="0" placeholder="Contoh: 20" oninput="onBbmLiterInput()" />' +
        '</div>' +
      '</div>' +
      renderPhotoUploaderSection('Foto Struk SPBU / Dispenser / Meteran', false) +
      '<div class="form-group">' +
        '<label class="form-label">Koordinat GPS Lokasi SPBU <span class="req">*</span></label>' +
        '<div id="gps-box-holder">' + renderGpsStatusBox() + '</div>' +
      '</div>' +
      '<div class="form-group">' +
        '<label class="form-label">Catatan Tambahan (Opsional)</label>' +
        '<input id="akt-bbm-catatan" class="form-control" type="text" placeholder="Contoh: SPBU Pertamina Daan Mogot KM 12..." />' +
      '</div>' +
    '</div>' +
    '<div class="modal-footer">' +
      '<button type="button" class="btn btn-secondary" onclick="closeModal()">Batal</button>' +
      '<button id="btn-submit-bbm-akt" type="button" class="btn btn-emerald" onclick="submitBbmAktivitas()" disabled>' + ICONS.check + '<span>Simpan Pengisian BBM</span></button>' +
    '</div>';

  openModal(body, false);
  acquireModalGps();
}

function submitBbmAktivitas() {
  var act = STATE.aktivitas.active;
  if (!act) {
    showToast('Tidak ada perjalanan aktif.', 'warning');
    return;
  }

  var kmVal = document.getElementById('akt-bbm-km').value;
  var biayaVal = document.getElementById('akt-bbm-biaya').value;
  var literVal = document.getElementById('akt-bbm-liter').value;
  var jenisVal = document.getElementById('akt-bbm-jenis').value;
  var catatan = document.getElementById('akt-bbm-catatan').value.trim();

  if (!kmVal || isNaN(Number(kmVal)) || Number(kmVal) < act.kmAwal) {
    showToast('Kilometer pengisian harus berupa angka dan minimal ' + formatNumberID(act.kmAwal) + ' KM.', 'warning');
    return;
  }
  if (!biayaVal || isNaN(Number(biayaVal)) || Number(biayaVal) <= 0) {
    showToast('Biaya pembelian BBM harus diisi dengan nominal angka yang valid.', 'warning');
    return;
  }
  if (!STATE.modalPhotos.length) {
    showToast('Wajib mengambil minimal 1 foto struk SPBU atau meteran dispenser.', 'warning');
    return;
  }
  if (!STATE.modalGps) {
    showToast('Koordinat GPS SPBU wajib aktif dan terkunci.', 'warning');
    return;
  }

  var btn = document.getElementById('btn-submit-bbm-akt');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span><span>Menyimpan Transaksi BBM...</span>';
  }

  callGasApi('saveBbmAktivitas', {
    idAktivitas: act.idAktivitas,
    kmBbm: Number(kmVal),
    biayaBbm: Number(biayaVal),
    literBbm: literVal ? Number(literVal) : 0,
    jenisBbm: jenisVal,
    fotoBbm: (STATE.modalPhotos && STATE.modalPhotos.length ? STATE.modalPhotos[0] : ''),
    photos: STATE.modalPhotos,
    gps: STATE.modalGps,
    catatan: catatan
  }).then(function (res) {
    closeModal();
    showToast(res.message || 'Catatan pengisian BBM berhasil disimpan!', 'success');
    clearApiCache();
    fetchAktivitasDriverData(true);
  }).catch(function (err) {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = ICONS.check + '<span>Simpan Pengisian BBM</span>';
    }
    showToast(err.message, 'error');
  });
}

// ----------------------------------------------------------------------------
// MODAL CHECK-IN (TIBA DI KANTOR / SELESAI TUGAS)
// ----------------------------------------------------------------------------

function openCheckInAktivitasModal() {
  var act = STATE.aktivitas.active;
  if (!act) {
    showToast('Tidak ada perjalanan aktif.', 'warning');
    return;
  }

  STATE.modalPhotos = [];
  STATE.modalGps = null;
  STATE.modalGpsLoading = true;
  STATE.modalGpsError = '';

  var body =
    '<div class="modal-header">' +
      '<h3 class="modal-title">Check-In (Tiba Kembali di Kantor)</h3>' +
      '<button type="button" class="modal-close" onclick="closeModal()">' + ICONS.x + '</button>' +
    '</div>' +
    '<div class="modal-body">' +
      '<div style="margin-bottom:14px;padding:12px 14px;background:var(--bg-subtle);border-radius:var(--radius-sm);font-size:12.5px">' +
        'Armada: <strong>' + escapeHtml(act.platMobil) + '</strong> (' + escapeHtml(act.jenisMobil || '-') + ')<br />' +
        'KM Awal Berangkat: <strong>' + formatNumberID(act.kmAwal) + ' KM</strong> · Total Isi BBM: <strong>Rp ' + formatNumberID(act.totalBiayaBbm || 0) + '</strong>' +
      '</div>' +
      '<div class="form-group">' +
        '<label class="form-label">Kilometer Akhir Speedometer <span class="req">*</span></label>' +
        '<input id="akt-in-km" class="form-control" type="number" min="' + act.kmAwal + '" placeholder="Contoh: ' + (act.kmAwal + 85) + '" oninput="calculateTripKmCheckIn()" />' +
        '<span class="form-hint">Ketik angka odometer saat tiba di kantor (harus >= KM Awal).</span>' +
      '</div>' +
      '<div class="km-calc-display">' +
        '<span>Total Jarak Tempuh Sesi Ini:</span>' +
        '<span id="akt-in-calc-display" class="km-calc-number">0 KM</span>' +
      '</div>' +
      renderPhotoUploaderSection('Foto Kilometer Akhir (Speedometer)', false) +
      '<div class="form-group">' +
        '<label class="form-label">Koordinat GPS Kantor <span class="req">*</span></label>' +
        '<div id="gps-box-holder">' + renderGpsStatusBox() + '</div>' +
      '</div>' +
      '<div class="form-group">' +
        '<label class="form-label">Catatan Kepulangan / Kondisi Armada (Opsional)</label>' +
        '<textarea id="akt-in-catatan" class="form-control" rows="2" placeholder="Contoh: Pengiriman selesai lancar, sisa BBM 1/2 tangki..."></textarea>' +
      '</div>' +
    '</div>' +
    '<div class="modal-footer">' +
      '<button type="button" class="btn btn-secondary" onclick="closeModal()">Batal</button>' +
      '<button id="btn-submit-checkin-akt" type="button" class="btn btn-primary" onclick="submitCheckInAktivitas()" disabled>' + ICONS.check + '<span>Selesai & Check-In Kantor</span></button>' +
    '</div>';

  openModal(body, false);
  acquireModalGps();
}

function calculateTripKmCheckIn() {
  var act = STATE.aktivitas.active;
  if (!act) {
    return;
  }
  var inputEl = document.getElementById('akt-in-km');
  var displayEl = document.getElementById('akt-in-calc-display');
  if (!inputEl || !displayEl) {
    return;
  }

  var val = Number(inputEl.value);
  if (!inputEl.value || isNaN(val)) {
    displayEl.textContent = '0 KM';
    displayEl.style.color = 'var(--text-muted)';
    return;
  }

  var diff = val - act.kmAwal;
  if (diff >= 0) {
    displayEl.textContent = formatNumberID(diff) + ' KM';
    displayEl.style.color = 'var(--emerald)';
  } else {
    displayEl.textContent = 'KM Akhir < KM Awal (' + formatNumberID(diff) + ' KM)';
    displayEl.style.color = 'var(--rose)';
  }
}

function submitCheckInAktivitas() {
  var act = STATE.aktivitas.active;
  if (!act) {
    showToast('Tidak ada perjalanan aktif.', 'warning');
    return;
  }

  var kmVal = document.getElementById('akt-in-km').value;
  var catatan = document.getElementById('akt-in-catatan').value.trim();

  if (!kmVal || isNaN(Number(kmVal)) || Number(kmVal) < act.kmAwal) {
    showToast('Kilometer akhir harus berupa angka dan minimal sama dengan KM Awal (' + formatNumberID(act.kmAwal) + ' KM).', 'warning');
    return;
  }
  if (!STATE.modalPhotos.length) {
    showToast('Wajib mengambil minimal 1 foto speedometer / kilometer akhir.', 'warning');
    return;
  }
  if (!STATE.modalGps) {
    showToast('Koordinat GPS kantor wajib aktif dan terkunci.', 'warning');
    return;
  }

  var btn = document.getElementById('btn-submit-checkin-akt');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span><span>Menyimpan Check-In Kantor...</span>';
  }

  callGasApi('checkInAktivitas', {
    idAktivitas: act.idAktivitas,
    kmAkhir: Number(kmVal),
    fotoKmAkhir: (STATE.modalPhotos && STATE.modalPhotos.length ? STATE.modalPhotos[0] : ''),
    photos: STATE.modalPhotos,
    gps: STATE.modalGps,
    catatanCheckIn: catatan,
    catatan: catatan
  }).then(function (res) {
    closeModal();
    showToast(res.message || 'Check-In kantor berhasil disimpan! Status perjalanan selesai.', 'success');
    clearApiCache();
    fetchAktivitasDriverData(true);
  }).catch(function (err) {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = ICONS.check + '<span>Selesai & Check-In Kantor</span>';
    }
    showToast(err.message, 'error');
  });
}

// ============================================================================
// LAPORAN & MONITORING AKTIVITAS DRIVER (BACK OFFICE & DRIVER)
// ============================================================================

function fetchLaporanAktivitasData(forceRefresh, fetchOpts) {
  if (!STATE.session || !STATE.session.user) {
    return Promise.resolve();
  }
  var f = STATE.laporanAktivitas.filters;
  var page = STATE.laporanAktivitas.page;
  var limit = STATE.laporanAktivitas.limit;
  var cacheKey = 'laporan_aktivitas_' + page + '_' + JSON.stringify(f);
  var isSilent = Boolean(fetchOpts && fetchOpts.silent);

  return callGasApi('listLaporanAktivitas', {
    dateFrom: f.dateFrom,
    dateTo: f.dateTo,
    driverId: f.driverId,
    platMobil: f.platMobil,
    status: f.status,
    search: f.search,
    page: page,
    limit: limit
  }, {
    cacheKey: cacheKey,
    forceRefresh: Boolean(forceRefresh)
  }).then(function (data) {
    var res = data || { items: [], total: 0, page: 1, limit: 15, totalPages: 1, summary: {} };
    var snap = JSON.stringify(res);
    var changed = STATE.lastSnapshots[cacheKey] !== snap;
    STATE.lastSnapshots[cacheKey] = snap;

    STATE.laporanAktivitas.items = res.items || [];
    STATE.laporanAktivitas.total = Number(res.total) || 0;
    STATE.laporanAktivitas.page = Number(res.page) || 1;
    STATE.laporanAktivitas.limit = Number(res.limit) || 15;
    STATE.laporanAktivitas.totalPages = Number(res.totalPages) || 1;
    STATE.laporanAktivitas.summary = res.summary || { total: 0, selesai: 0, sedangBerangkat: 0, totalKm: 0, totalBiayaBbm: 0, totalLiterBbm: 0 };

    if ((STATE.currentPage === 'report' || STATE.currentPage === 'laporan-aktivitas') && (!isSilent || (changed && !isUiBusyForBackgroundSync()))) {
      renderApp();
    }
  }).catch(function (err) {
    if (!isSilent) {
      showToast('Gagal memuat laporan aktivitas: ' + err.message, 'error');
    }
  });
}

function applyLaporanAktivitasFilter() {
  STATE.laporanAktivitas.filters.dateFrom = document.getElementById('akt-rep-from').value;
  STATE.laporanAktivitas.filters.dateTo = document.getElementById('akt-rep-to').value;
  STATE.laporanAktivitas.filters.driverId = document.getElementById('akt-rep-driver') ? document.getElementById('akt-rep-driver').value : '';
  STATE.laporanAktivitas.filters.platMobil = document.getElementById('akt-rep-mobil').value;
  STATE.laporanAktivitas.filters.status = document.getElementById('akt-rep-status').value;
  STATE.laporanAktivitas.filters.search = document.getElementById('akt-rep-search').value.trim();
  STATE.laporanAktivitas.page = 1;
  fetchLaporanAktivitasData(true);
}

function changeLaporanAktivitasPage(p) {
  STATE.laporanAktivitas.page = p;
  fetchLaporanAktivitasData(false);
}

function triggerExportAktivitas(formatType) {
  var f = STATE.laporanAktivitas.filters;
  showToast('Menyiapkan seluruh data laporan aktivitas untuk export ' + formatType.toUpperCase() + '...', 'info');

  callGasApi('listLaporanAktivitas', {
    dateFrom: f.dateFrom,
    dateTo: f.dateTo,
    driverId: f.driverId,
    platMobil: f.platMobil,
    status: f.status,
    search: f.search,
    exportAll: true
  }).then(function (data) {
    if (formatType === 'pdf') {
      exportAktivitasToPdf(data.items || [], data.summary || {}, f);
    } else {
      exportAktivitasToExcel(data.items || [], data.summary || {}, f);
    }
  }).catch(function (err) {
    showToast(err.message, 'error');
  });
}

function renderLaporanAktivitasContent_() {
  var f = STATE.laporanAktivitas.filters;
  var s = STATE.laporanAktivitas.summary || {};
  var user = STATE.session.user;
  var isDriver = user.divisi === 'Driver';

  var drivers = (STATE.dropdowns && STATE.dropdowns.drivers) || [];
  var mobils = (STATE.dropdowns && STATE.dropdowns.mobils) || [];

  // Dropdown Driver Options
  var drvOpts = '<option value="">Semua Driver</option>';
  if (isDriver) {
    drvOpts = '<option value="' + escapeHtml(user.idKaryawan) + '" selected>' + escapeHtml(user.namaKaryawan) + '</option>';
  } else {
    for (var d = 0; d < drivers.length; d++) {
      var drv = drivers[d];
      drvOpts += '<option value="' + escapeHtml(drv.idKaryawan) + '" ' + (f.driverId === drv.idKaryawan ? 'selected' : '') + '>' + escapeHtml(drv.namaKaryawan) + '</option>';
    }
  }

  // Dropdown Mobil Options
  var mblOpts = '<option value="">Semua Plat Kendaraan</option>';
  for (var m = 0; m < mobils.length; m++) {
    var mob = mobils[m];
    var mVal = mob.platMobil;
    mblOpts += '<option value="' + escapeHtml(mVal) + '" ' + (f.platMobil === mVal ? 'selected' : '') + '>' + escapeHtml(mVal) + (mob.jenisMobil ? ' (' + escapeHtml(mob.jenisMobil) + ')' : '') + '</option>';
  }

  // Status Options
  var statuses = ['', 'Sedang Berangkat', 'Selesai'];
  var stOpts = '';
  for (var st = 0; st < statuses.length; st++) {
    var sv = statuses[st];
    stOpts += '<option value="' + escapeHtml(sv) + '" ' + (f.status === sv ? 'selected' : '') + '>' + (sv || 'Semua Status') + '</option>';
  }

  var items = STATE.laporanAktivitas.items || [];
  var rowsHtml = '';

  if (!items.length) {
    rowsHtml = '<tr><td colspan="7" class="empty-state">Tidak ada data aktivitas driver sesuai filter.</td></tr>';
  } else {
    for (var i = 0; i < items.length; i++) {
      var r = items[i];
      var isSelesai = r.status === 'Selesai';
      var statusBadge = isSelesai
        ? '<span class="badge" style="background:#ecfdf5;color:#047857;border:1px solid #a7f3d0">Selesai</span>'
        : '<span class="badge" style="background:#eff6ff;color:#1d4ed8;border:1px solid #bfdbfe">Sedang Berangkat</span>';

      var kmInfo =
        '<div style="font-family:ui-monospace,monospace;font-size:12px">' +
          '<div>Awal: <strong>' + formatNumberID(r.kmAwal) + '</strong> KM</div>' +
          '<div>Akhir: ' + (r.kmAkhir !== null ? '<strong>' + formatNumberID(r.kmAkhir) + '</strong> KM' : '-') + '</div>' +
          (isSelesai ? '<div style="color:var(--emerald);font-weight:700">Total: ' + formatNumberID(r.totalKm) + ' KM</div>' : '') +
        '</div>';

      var bbmInfo =
        '<div>' +
          '<div class="cell-strong">Rp ' + formatNumberID(r.totalBiayaBbm || 0) + '</div>' +
          '<div class="cell-sub">' + (r.totalLiterBbm || 0) + ' Liter</div>' +
        '</div>';

      var waktuInfo =
        '<div class="cell-sub">' +
          '<div>Brgkt: ' + (r.waktuBerangkat ? formatDateTimeID(r.waktuBerangkat) : '-') + '</div>' +
          '<div>Masuk: ' + (r.waktuCheckIn ? formatDateTimeID(r.waktuCheckIn) : '-') + '</div>' +
        '</div>';

      rowsHtml +=
        '<tr>' +
          '<td><div class="cell-strong">' + escapeHtml(r.idAktivitas) + '</div><div class="cell-sub">' + formatDateID(r.tanggal) + '</div></td>' +
          '<td><div class="cell-strong">' + escapeHtml(r.namaDriver) + '</div><div class="cell-sub"><span class="vehicle-tag">' + escapeHtml(r.platMobil) + '</span> ' + escapeHtml(r.jenisMobil || '') + '</div></td>' +
          '<td>' + statusBadge + '</td>' +
          '<td>' + kmInfo + '</td>' +
          '<td>' + bbmInfo + '</td>' +
          '<td>' + waktuInfo + '</td>' +
          '<td><button type="button" class="btn btn-secondary btn-sm" onclick="openAktivitasDetailModal(\'' + escapeHtml(r.idAktivitas) + '\')">' + ICONS.eye + '<span>Detail</span></button></td>' +
        '</tr>';
    }
  }

  return (
    '<div class="page-header">' +
      '<div>' +
        '<h2 class="page-title">Laporan Aktivitas Driver & Kendaraan</h2>' +
        '<p class="page-subtitle">Monitoring harian kilometer tempuh, riwayat keberangkatan armada, dan pembukuan pengeluaran BBM</p>' +
      '</div>' +
      '<div class="header-actions">' +
        renderSyncStatusBadge() +
        '<button type="button" class="btn btn-outline-danger" onclick="triggerExportAktivitas(\'pdf\')">' + ICONS.download + '<span>Export PDF</span></button>' +
        '<button type="button" class="btn btn-emerald" onclick="triggerExportAktivitas(\'excel\')">' + ICONS.download + '<span>Export Excel</span></button>' +
      '</div>' +
    '</div>' +
    '<div class="metrics-grid">' +
      renderMetricCard('Total Perjalanan', s.total || 0, '#eff6ff', '#1d4ed8', ICONS.truck) +
      renderMetricCard('Selesai / Jalan', (s.selesai || 0) + ' / ' + (s.sedangBerangkat || 0), '#ecfdf5', '#047857', ICONS.check) +
      renderMetricCard('Total KM Tempuh', formatNumberID(s.totalKm || 0) + ' KM', '#f1f5f9', '#0f172a', ICONS.mapPin) +
      renderMetricCard('Total Pengeluaran BBM', 'Rp ' + formatNumberID(s.totalBiayaBbm || 0), '#fffbeb', '#b45309', ICONS.fuel) +
    '</div>' +
    '<div class="card" style="margin-bottom:14px">' +
      '<div class="filter-bar" style="margin-bottom:0">' +
        '<div class="form-group"><label class="form-label">Dari Tanggal</label><input id="akt-rep-from" class="form-control" type="date" value="' + escapeHtml(f.dateFrom) + '" /></div>' +
        '<div class="form-group"><label class="form-label">Sampai Tanggal</label><input id="akt-rep-to" class="form-control" type="date" value="' + escapeHtml(f.dateTo) + '" /></div>' +
        '<div class="form-group"><label class="form-label">Driver</label><select id="akt-rep-driver" class="form-control" ' + (isDriver ? 'disabled' : '') + '>' + drvOpts + '</select></div>' +
        '<div class="form-group"><label class="form-label">Armada Mobil</label><select id="akt-rep-mobil" class="form-control">' + mblOpts + '</select></div>' +
        '<div class="form-group"><label class="form-label">Status</label><select id="akt-rep-status" class="form-control">' + stOpts + '</select></div>' +
        '<div class="form-group"><label class="form-label">Cari Teks</label><input id="akt-rep-search" class="form-control" type="text" value="' + escapeHtml(f.search) + '" placeholder="ID / Plat / Driver..." onkeydown="if(event.key===\'Enter\'){event.preventDefault();applyLaporanAktivitasFilter();}" /></div>' +
        '<div class="form-group" style="display:flex;gap:6px">' +
          '<button type="button" class="btn btn-navy" style="flex:1" onclick="applyLaporanAktivitasFilter()">Tampilkan</button>' +
          '<button type="button" class="btn-reset-filter" onclick="resetLaporanAktivitasFilter()" title="Reset Filter">' + ICONS.rotateCcw + '<span>Reset</span></button>' +
        '</div>' +
      '</div>' +
    '</div>' +
    '<div class="table-card">' +
      '<div class="table-wrap"><table class="data-table"><thead><tr><th>ID / Tgl</th><th>Driver & Kendaraan</th><th>Status</th><th>Kilometer (Awal/Akhir/Total)</th><th>Pengeluaran BBM</th><th>Waktu Operasional</th><th>Aksi</th></tr></thead><tbody>' + rowsHtml + '</tbody></table></div>' +
      renderPaginationBar(STATE.laporanAktivitas.page, STATE.laporanAktivitas.totalPages, STATE.laporanAktivitas.total, 'changeLaporanAktivitasPage') +
    '</div>'
  );
}

function renderLaporanAktivitasView() {
  STATE.reportActiveTab = 'aktivitas';
  return renderReportView();
}

// ----------------------------------------------------------------------------
// MODAL DETAIL AKTIVITAS (TIMELINE, GALERI FOTO & LOG BBM)
// ----------------------------------------------------------------------------

function openAktivitasDetailModal(idAktivitas) {
  openModal(
    '<div class="modal-header"><h3 class="modal-title">Memuat Detail Aktivitas...</h3><button type="button" class="modal-close" onclick="closeModal()">' + ICONS.x + '</button></div>' +
    '<div class="modal-body" style="text-align:center;padding:40px"><span class="spinner dark"></span><p>Mengambil data lengkap perjalanan & BBM...</p></div>',
    true
  );

  callGasApi('getAktivitasDetail', { idAktivitas: idAktivitas }).then(function (data) {
    var act = data.aktivitas;
    var bbmList = data.bbmList || [];
    if (!act) {
      showToast('Data aktivitas tidak ditemukan.', 'error');
      closeModal();
      return;
    }

    var mapsBerangkat = (act.gpsBerangkatLat && act.gpsBerangkatLng)
      ? buildGoogleMapsUrl(act.gpsBerangkatLat, act.gpsBerangkatLng)
      : '';
    var mapsCheckIn = (act.gpsCheckInLat && act.gpsCheckInLng)
      ? buildGoogleMapsUrl(act.gpsCheckInLat, act.gpsCheckInLng)
      : '';

    var fotoAwalHtml = act.fotoKmAwal
      ? '<a href="' + escapeHtml(act.fotoKmAwal) + '" target="_blank" rel="noopener"><img src="' + escapeHtml(act.fotoKmAwal) + '" alt="KM Awal" style="width:100%;max-height:160px;object-fit:cover;border-radius:var(--radius-sm);border:1px solid var(--border-color)" /></a>'
      : '<div class="empty-state" style="padding:20px">Tidak ada foto KM Awal</div>';

    var fotoAkhirHtml = act.fotoKmAkhir
      ? '<a href="' + escapeHtml(act.fotoKmAkhir) + '" target="_blank" rel="noopener"><img src="' + escapeHtml(act.fotoKmAkhir) + '" alt="KM Akhir" style="width:100%;max-height:160px;object-fit:cover;border-radius:var(--radius-sm);border:1px solid var(--border-color)" /></a>'
      : '<div class="empty-state" style="padding:20px">Belum ada foto KM Akhir (Belum Check-In)</div>';

    var bbmRows = '';
    if (!bbmList.length) {
      bbmRows = '<tr><td colspan="6" class="empty-state">Tidak ada transaksi pengisian BBM pada sesi ini.</td></tr>';
    } else {
      for (var b = 0; b < bbmList.length; b++) {
        var bm = bbmList[b];
        var bmGps = (bm.gpsLat && bm.gpsLng) ? buildGoogleMapsUrl(bm.gpsLat, bm.gpsLng) : '';
        bbmRows +=
          '<tr>' +
            '<td>' + formatDateTimeID(bm.waktuBbm) + '</td>' +
            '<td><span class="odometer-badge" style="font-size:11px;padding:2px 6px">' + formatNumberID(bm.kmBbm) + ' KM</span></td>' +
            '<td>' + escapeHtml(bm.jenisBbm || 'BBM') + '</td>' +
            '<td>' + (bm.literBbm || 0) + ' L</td>' +
            '<td><strong>Rp ' + formatNumberID(bm.biayaBbm) + '</strong></td>' +
            '<td>' +
              (bm.fotoBbm ? '<a class="btn btn-secondary btn-sm" target="_blank" rel="noopener" href="' + escapeHtml(bm.fotoBbm) + '">' + ICONS.eye + '<span>Foto</span></a> ' : '') +
              (bmGps ? '<a class="btn btn-secondary btn-sm" target="_blank" rel="noopener" href="' + escapeHtml(bmGps) + '">' + ICONS.mapPin + '<span>GPS</span></a>' : '') +
            '</td>' +
          '</tr>';
      }
    }

    var body =
      '<div class="modal-header">' +
        '<h3 class="modal-title">Detail Aktivitas Armada: ' + escapeHtml(act.idAktivitas) + '</h3>' +
        '<button type="button" class="modal-close" onclick="closeModal()">' + ICONS.x + '</button>' +
      '</div>' +
      '<div class="modal-body">' +
        '<div class="grid-2-col" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px;margin-bottom:20px">' +
          '<div class="card" style="margin:0;padding:16px">' +
            '<h4 style="margin:0 0 10px 0;font-size:14px;color:var(--text-muted)">INFORMASI PERJALANAN</h4>' +
            '<table style="width:100%;font-size:13px;line-height:1.8">' +
              '<tr><td style="color:var(--text-muted);width:110px">Driver:</td><td><strong>' + escapeHtml(act.namaDriver) + '</strong> (' + escapeHtml(act.idDriver) + ')</td></tr>' +
              '<tr><td style="color:var(--text-muted)">Kendaraan:</td><td><span class="vehicle-tag">' + escapeHtml(act.platMobil) + '</span> ' + escapeHtml(act.jenisMobil || '') + '</td></tr>' +
              '<tr><td style="color:var(--text-muted)">Status:</td><td>' + (act.status === 'Selesai' ? '<span class="badge" style="background:#ecfdf5;color:#047857">Selesai</span>' : '<span class="badge" style="background:#eff6ff;color:#1d4ed8">Sedang Berangkat</span>') + '</td></tr>' +
              '<tr><td style="color:var(--text-muted)">Tanggal:</td><td>' + formatDateID(act.tanggal) + '</td></tr>' +
              '<tr><td style="color:var(--text-muted)">Waktu Brgkt:</td><td>' + (act.waktuBerangkat ? formatDateTimeID(act.waktuBerangkat) : '-') + '</td></tr>' +
              '<tr><td style="color:var(--text-muted)">Waktu Selesai:</td><td>' + (act.waktuCheckIn ? formatDateTimeID(act.waktuCheckIn) : '-') + '</td></tr>' +
            '</table>' +
          '</div>' +
          '<div class="card" style="margin:0;padding:16px">' +
            '<h4 style="margin:0 0 10px 0;font-size:14px;color:var(--text-muted)">RINGKASAN ODOMETER & BIAYA</h4>' +
            '<table style="width:100%;font-size:13px;line-height:1.8">' +
              '<tr><td style="color:var(--text-muted);width:130px">KM Awal Berangkat:</td><td><span class="odometer-badge">' + formatNumberID(act.kmAwal) + ' KM</span></td></tr>' +
              '<tr><td style="color:var(--text-muted)">KM Akhir Check-In:</td><td>' + (act.kmAkhir !== null ? '<span class="odometer-badge">' + formatNumberID(act.kmAkhir) + ' KM</span>' : '-') + '</td></tr>' +
              '<tr><td style="color:var(--text-muted)">Total Jarak Tempuh:</td><td><strong style="color:var(--emerald);font-size:15px">' + formatNumberID(act.totalKm) + ' KM</strong></td></tr>' +
              '<tr><td style="color:var(--text-muted)">Total Pengeluaran BBM:</td><td><strong>Rp ' + formatNumberID(act.totalBiayaBbm || 0) + '</strong></td></tr>' +
              '<tr><td style="color:var(--text-muted)">Total Volume BBM:</td><td>' + (act.totalLiterBbm || 0) + ' Liter</td></tr>' +
              (act.catatanBerangkat ? '<tr><td style="color:var(--text-muted)">Catatan Brgkt:</td><td>' + escapeHtml(act.catatanBerangkat) + '</td></tr>' : '') +
              (act.catatanCheckIn ? '<tr><td style="color:var(--text-muted)">Catatan CheckIn:</td><td>' + escapeHtml(act.catatanCheckIn) + '</td></tr>' : '') +
            '</table>' +
          '</div>' +
        '</div>' +
        '<div style="margin-bottom:20px">' +
          '<h4 style="margin:0 0 10px 0;font-size:14px;font-weight:700">FOTO BUKTI SPEEDOMETER & GPS</h4>' +
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">' +
            '<div class="card" style="margin:0;padding:12px">' +
              '<div style="font-weight:700;margin-bottom:6px;font-size:12px">FOTO KM AWAL' + (mapsBerangkat ? ' · <a target="_blank" rel="noopener" href="' + escapeHtml(mapsBerangkat) + '">Peta GPS Berangkat</a>' : '') + '</div>' +
              fotoAwalHtml +
            '</div>' +
            '<div class="card" style="margin:0;padding:12px">' +
              '<div style="font-weight:700;margin-bottom:6px;font-size:12px">FOTO KM AKHIR' + (mapsCheckIn ? ' · <a target="_blank" rel="noopener" href="' + escapeHtml(mapsCheckIn) + '">Peta GPS Check-In</a>' : '') + '</div>' +
              fotoAkhirHtml +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div>' +
          '<h4 style="margin:0 0 10px 0;font-size:14px;font-weight:700">LOG PENGISIAN BBM PADA PERJALANAN INI (' + bbmList.length + ' PENGISIAN)</h4>' +
          '<div class="table-wrap"><table class="data-table"><thead><tr><th>Waktu</th><th>KM Odometer</th><th>Jenis BBM</th><th>Liter</th><th>Biaya (Rp)</th><th>Bukti & GPS</th></tr></thead><tbody>' + bbmRows + '</tbody></table></div>' +
        '</div>' +
      '</div>' +
      '<div class="modal-footer">' +
        '<button type="button" class="btn btn-secondary" onclick="closeModal()">Tutup</button>' +
      '</div>';

    openModal(body, true);
  }).catch(function (err) {
    showToast('Gagal memuat detail aktivitas: ' + err.message, 'error');
    closeModal();
  });
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
  stopOrderBarcodeScanner();
  var root = document.getElementById('modal-root');
  if (root) {
    root.innerHTML = '';
  }
}

// ============================================================================
// BARCODE SCANNER (CODE 128 / INVOICE) VIA HTML5-QRCODE
// ============================================================================

var _orderBarcodeScannerInstance = null;

function playScanBeepSound() {
  try {
    var AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    var ctx = new AudioCtx();
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    gain.gain.setValueAtTime(0.25, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.15);
  } catch (e) {
    // Non-blocking
  }
}

function stopOrderBarcodeScanner() {
  var area = document.getElementById('ord-barcode-scanner-area');
  if (area) {
    area.style.display = 'none';
  }
  var btn = document.getElementById('btn-toggle-barcode');
  if (btn) {
    btn.innerHTML = (ICONS.barcode || ICONS.camera) + ' <span>Scan Barcode Invoice (Code 128)</span>';
  }
  if (_orderBarcodeScannerInstance) {
    var instance = _orderBarcodeScannerInstance;
    _orderBarcodeScannerInstance = null;
    try {
      instance.stop().then(function () {
        try { instance.clear(); } catch (_) {}
      }).catch(function (_) {
        try { instance.clear(); } catch (__) {}
      });
    } catch (_) {
      try { instance.clear(); } catch (___) {}
    }
  }
}

function onBarcodeScanSuccess(decodedText) {
  var cleanText = String(decodedText || '').trim();
  if (!cleanText) return;

  playScanBeepSound();
  stopOrderBarcodeScanner();

  var inputNomor = document.getElementById('ord-nomor');
  if (inputNomor) {
    inputNomor.value = cleanText;
    inputNomor.focus();
    inputNomor.classList.add('input-scan-highlight');
    setTimeout(function () {
      if (inputNomor) inputNomor.classList.remove('input-scan-highlight');
    }, 2500);
  }
  showToast('Nomor DO berhasil dipindai: ' + cleanText, 'success');
}

function toggleOrderBarcodeScanner() {
  var area = document.getElementById('ord-barcode-scanner-area');
  if (!area) return;

  if (area.style.display !== 'none') {
    stopOrderBarcodeScanner();
    return;
  }

  if (typeof Html5Qrcode === 'undefined') {
    showToast('Library pemindai barcode belum selesai dimuat. Silakan tunggu sebentar atau ketik Nomor DO secara manual.', 'warning');
    return;
  }

  area.style.display = 'block';
  var btn = document.getElementById('btn-toggle-barcode');
  if (btn) {
    btn.innerHTML = ICONS.x + ' <span>Tutup Scanner</span>';
  }

  var readerId = 'ord-barcode-reader';
  var readerEl = document.getElementById(readerId);
  if (readerEl) {
    readerEl.innerHTML = '<div style="padding:20px;text-align:center;color:#94a3b8"><span class="spinner dark"></span><div style="margin-top:6px">Menghubungkan ke kamera...</div></div>';
  }

  if (_orderBarcodeScannerInstance) {
    try { _orderBarcodeScannerInstance.clear(); } catch (_) {}
    _orderBarcodeScannerInstance = null;
  }

  try {
    var formatsToSupport = undefined;
    if (window.Html5QrcodeSupportedFormats) {
      formatsToSupport = [
        Html5QrcodeSupportedFormats.CODE_128,
        Html5QrcodeSupportedFormats.CODE_39,
        Html5QrcodeSupportedFormats.EAN_13,
        Html5QrcodeSupportedFormats.QR_CODE
      ];
    }

    var config = {
      fps: 15,
      qrbox: function (viewfinderWidth, viewfinderHeight) {
        var w = Math.min(viewfinderWidth * 0.9, 320);
        var h = Math.min(viewfinderHeight * 0.45, 110);
        return { width: Math.round(w), height: Math.round(h) };
      },
      aspectRatio: 1.777778,
      formatsToSupport: formatsToSupport
    };

    _orderBarcodeScannerInstance = new Html5Qrcode(readerId, { formatsToSupport: formatsToSupport, verbose: false });
    _orderBarcodeScannerInstance.start(
      { facingMode: 'environment' },
      config,
      function (decodedText) {
        onBarcodeScanSuccess(decodedText);
      },
      function () {
        // Continuous decoding frame search, ignore error frame
      }
    ).catch(function (err) {
      if (readerEl) {
        readerEl.innerHTML =
          '<div class="alert-box alert-warning" style="margin:8px;font-size:12.5px;text-align:left">' +
            'Kamera live tidak dapat diakses (' + escapeHtml(err.message || 'Izin ditolak atau tidak ada kamera') + ').<br/>' +
            'Silakan gunakan tombol <strong>"Pilih Foto Barcode"</strong> di bawah untuk memilih foto barcode dari galeri/kamera HP.' +
          '</div>';
      }
    });
  } catch (err) {
    showToast('Error scanner: ' + err.message, 'error');
    stopOrderBarcodeScanner();
  }
}

function triggerBarcodeFileInput() {
  var fileInput = document.getElementById('ord-barcode-file-input');
  if (fileInput) {
    fileInput.value = '';
    fileInput.click();
  }
}

function handleBarcodeFileScan(files) {
  if (!files || !files.length) return;
  var file = files[0];

  if (typeof Html5Qrcode === 'undefined') {
    showToast('Library pemindai barcode belum selesai dimuat.', 'error');
    return;
  }

  var area = document.getElementById('ord-barcode-scanner-area');
  if (area) area.style.display = 'block';

  var readerId = 'ord-barcode-reader';
  var readerEl = document.getElementById(readerId);
  if (readerEl) {
    readerEl.innerHTML = '<div style="padding:15px;text-align:center;color:#94a3b8"><span class="spinner dark"></span><div style="margin-top:6px">Memindai barcode dari file gambar...</div></div>';
  }

  var fileScanner = new Html5Qrcode(readerId, { verbose: false });
  fileScanner.scanFile(file, true)
    .then(function (decodedText) {
      try { fileScanner.clear(); } catch (_) {}
      onBarcodeScanSuccess(decodedText);
    })
    .catch(function () {
      try { fileScanner.clear(); } catch (_) {}
      if (readerEl) {
        readerEl.innerHTML =
          '<div class="alert-box alert-warning" style="margin:8px;font-size:12.5px;text-align:left">' +
            'Garis barcode tidak terdeteksi dari gambar yang dipilih. Pastikan foto tegak, barcode Code 128 terlihat jelas, tidak buram, dan coba lagi.' +
          '</div>';
      }
    });
}

