/**
 * Klien API untuk backend Google Apps Script.
 * - get()  : aksi publik (katalog, status siswa), dengan cache opsional
 * - post() : aksi admin (otomatis menyertakan token sesi)
 * POST memakai Content-Type text/plain agar tidak memicu preflight CORS.
 */
const API = (function () {
  const TOKEN_KEY = 'lib_token';
  const api = { onSessionExpired: null };

  api.ready = function () {
    return /^https:\/\/script\.google(usercontent)?\.com\//.test(CONFIG.API_URL);
  };

  api.getToken = function () {
    try { return sessionStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; }
  };
  api.setToken = function (t) {
    try { sessionStorage.setItem(TOKEN_KEY, t); } catch (e) { /* abaikan */ }
  };
  api.clearToken = function () {
    try { sessionStorage.removeItem(TOKEN_KEY); } catch (e) { /* abaikan */ }
  };

  async function parse(res) {
    let json;
    try {
      json = await res.json();
    } catch (e) {
      throw new Error('Server tidak merespons dengan benar. Periksa URL Web App di config.js dan pastikan akses deploy "Anyone".');
    }
    if (!json.ok) {
      const err = new Error(json.error || 'Terjadi kesalahan');
      if (/Sesi berakhir/.test(err.message)) {
        api.clearToken();
        if (api.onSessionExpired) api.onSessionExpired();
      }
      throw err;
    }
    return json.data;
  }

  function networkError() {
    return new Error('Tidak bisa terhubung ke server. Periksa koneksi internet lalu coba lagi.');
  }

  /** ttl = lama cache dalam detik (0 = tanpa cache) */
  api.get = async function (action, params, ttl) {
    if (!api.ready()) throw new Error('URL Web App belum diatur di assets/js/config.js');
    params = params || {};
    const qs = new URLSearchParams(Object.assign({ action: action }, params)).toString();
    const key = 'lib_cache_' + qs;
    if (ttl) {
      try {
        const hit = JSON.parse(sessionStorage.getItem(key) || 'null');
        if (hit && Date.now() - hit.t < ttl * 1000) return hit.d;
      } catch (e) { /* abaikan */ }
    }
    let res;
    try { res = await fetch(CONFIG.API_URL + '?' + qs); } catch (e) { throw networkError(); }
    const data = await parse(res);
    if (ttl) {
      try { sessionStorage.setItem(key, JSON.stringify({ t: Date.now(), d: data })); } catch (e) { /* abaikan */ }
    }
    return data;
  };

  api.post = async function (action, body, opts) {
    if (!api.ready()) throw new Error('URL Web App belum diatur di assets/js/config.js');
    const withAuth = !(opts && opts.auth === false);
    const payload = Object.assign({ action: action }, body || {});
    if (withAuth) payload.token = api.getToken();
    let res;
    try {
      res = await fetch(CONFIG.API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload)
      });
    } catch (e) { throw networkError(); }
    return parse(res);
  };

  return api;
})();