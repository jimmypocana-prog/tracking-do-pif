/**
 * api.js — Klien HTTP Google Apps Script + Client-Side In-Memory Caching (Nol Loading Berulang)
 * Program: Tracking Delivery Order - PIF
 */

var MEMORY_CACHE = {};

function clearApiCache(prefix) {
  if (!prefix) {
    MEMORY_CACHE = {};
    return;
  }
  var keys = Object.keys(MEMORY_CACHE);
  for (var i = 0; i < keys.length; i++) {
    if (keys[i].indexOf(prefix) === 0) {
      delete MEMORY_CACHE[keys[i]];
    }
  }
}

function getSavedSession() {
  try {
    var raw = localStorage.getItem(PIF_CONFIG.STORAGE_KEY_SESSION);
    if (!raw) {
      return null;
    }
    var parsed = JSON.parse(raw);
    if (parsed && parsed.token && parsed.user) {
      return parsed;
    }
    return null;
  } catch (e) {
    return null;
  }
}

function saveSession(sessionObj) {
  try {
    if (sessionObj) {
      localStorage.setItem(PIF_CONFIG.STORAGE_KEY_SESSION, JSON.stringify(sessionObj));
    } else {
      localStorage.removeItem(PIF_CONFIG.STORAGE_KEY_SESSION);
    }
  } catch (e) {
    // Abaikan bila storage tidak tersedia
  }
}

function callGasApi(action, payload, options) {
  var opts = options || {};
  var apiUrl = getApiUrl();
  if (!apiUrl) {
    return Promise.reject(new Error('URL Server Backend GAS belum diatur. Klik "Pengaturan Server API" untuk menempel URL Web App (/exec).'));
  }

  var cacheKey = opts.cacheKey || '';
  if (cacheKey && !opts.forceRefresh && Object.prototype.hasOwnProperty.call(MEMORY_CACHE, cacheKey)) {
    return Promise.resolve(MEMORY_CACHE[cacheKey]);
  }

  var session = getSavedSession();
  var bodyObj = {
    action: action,
    payload: payload || {},
    token: session && session.token ? session.token : ''
  };

  return fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain;charset=utf-8'
    },
    body: JSON.stringify(bodyObj),
    redirect: 'follow'
  })
    .then(function (resp) {
      return resp.text().then(function (text) {
        var json;
        try {
          json = JSON.parse(text);
        } catch (parseErr) {
          throw new Error('Respons server bukan JSON valid. Pastikan URL GAS berakhiran /exec dan akses disetel "Anyone".');
        }
        if (!json.ok) {
          if (json.code === 'UNAUTHORIZED') {
            saveSession(null);
            clearApiCache();
            if (typeof window.onSessionExpired === 'function') {
              window.onSessionExpired();
            }
          }
          throw new Error(json.error || 'Terjadi kesalahan pada server.');
        }
        if (cacheKey) {
          MEMORY_CACHE[cacheKey] = json.data;
        }
        return json.data;
      });
    });
}

