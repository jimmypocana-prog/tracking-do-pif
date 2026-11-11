/**
 * config.js — Konfigurasi Endpoint Backend Google Apps Script & Konstanta Aplikasi
 * Program: Tracking Delivery Order - PIF
 */

var PIF_CONFIG = {
  APP_NAME: 'Tracking Delivery Order - PIF',
  // Tempel URL Web App Google Apps Script (/exec) di bawah ini sebelum deploy ke Vercel / GitHub Pages
  DEFAULT_API_URL: 'https://script.google.com/macros/s/AKfycbzuAAcEFBOwPET_WC2qGY6bfgu_Pjvkr4XVVsGwZqgZKQfFfMGV2BEfEfqwVJW75IiY/exec',
  STORAGE_KEY_API: 'pif_do_gas_api_url_v1',
  STORAGE_KEY_SESSION: 'pif_do_session_v1',
  MAX_PHOTOS: 6,
  IMAGE_MAX_DIM: 1024,
  IMAGE_QUALITY: 0.72
};

function getApiUrl() {
  var saved = '';
  try {
    saved = String(localStorage.getItem(PIF_CONFIG.STORAGE_KEY_API) || '').trim();
  } catch (e) {
    saved = '';
  }
  return saved || String(PIF_CONFIG.DEFAULT_API_URL || '').trim();
}

function setApiUrl(url) {
  var clean = String(url || '').trim();
  try {
    if (clean) {
      localStorage.setItem(PIF_CONFIG.STORAGE_KEY_API, clean);
    } else {
      localStorage.removeItem(PIF_CONFIG.STORAGE_KEY_API);
    }
  } catch (e) {
    // Abaikan jika storage dibatasi browser
  }
  return clean;
}

