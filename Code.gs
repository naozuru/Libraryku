/**
 * =====================================================================
 *  PERPUSTAKAAN SEKOLAH - BACKEND (Google Apps Script + Google Sheets)
 * =====================================================================
 *  CARA PAKAI (ringkas, detail lengkap ada di README):
 *  1. Buat Google Spreadsheet baru -> Extensions > Apps Script.
 *  2. Tempel seluruh isi file ini ke Code.gs.
 *  3. Project Settings (ikon gear) -> Time zone: (GMT+07:00) Asia/Jakarta.
 *  4. Jalankan fungsi setup() sekali (izinkan akses).
 *     (opsional) jalankan seedSampleData() untuk data contoh.
 *  5. Deploy > New deployment > Web app
 *       Execute as : Me
 *       Who has access : Anyone
 *     Salin URL Web App -> tempel ke assets/js/config.js di frontend.
 *  6. Login awal: username "admin", password "admin123"  (WAJIB diganti!)
 *
 *  FORMAT API
 *  - Semua respons JSON: { ok: true, data: ... } atau { ok: false, error: "..." }
 *  - GET  ?action=...  -> hanya aksi publik (katalog, status siswa)
 *  - POST body JSON (kirim dengan Content-Type: text/plain agar tanpa preflight CORS)
 *      { "action": "...", "token": "...", ...parameter }
 * =====================================================================
 */

const TZ = 'Asia/Jakarta';
const TOKEN_TTL = 21600; // 6 jam (detik) - batas maksimum CacheService

const SHEETS = {
  Books:    ['id', 'judul', 'penulis', 'kategori', 'penerbit', 'tahun', 'isbn', 'stok_total', 'stok_tersedia', 'cover_url', 'deskripsi'],
  Members:  ['id', 'nis', 'nama', 'kelas', 'jenjang'],
  Loans:    ['id', 'id_buku', 'id_anggota', 'tgl_pinjam', 'tgl_jatuh_tempo', 'tgl_kembali', 'status', 'perpanjangan'],
  Settings: ['key', 'value'],
  Admins:   ['username', 'password_hash', 'nama']
};

// Kolom yang harus berformat teks (agar NIS/ISBN/tanggal tidak diubah Sheets)
const TEXT_COLS = {
  Books: ['tahun', 'isbn'],
  Members: ['nis'],
  Loans: ['tgl_pinjam', 'tgl_jatuh_tempo', 'tgl_kembali']
};

const DEFAULT_SETTINGS = {
  durasi_pinjam_default: 7,     // hari
  maks_buku_per_siswa: 3,
  maks_perpanjangan: 1,         // kali
  durasi_perpanjangan: 7,       // hari
  denda_per_hari: 0,            // 0 = denda tidak aktif
  hampir_jatuh_tempo_hari: 2    // penanda "hampir jatuh tempo"
};

/* ===================================================================
 *  SETUP
 * =================================================================== */

function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.setSpreadsheetTimeZone(TZ);

  Object.keys(SHEETS).forEach(function (name) {
    const sh = ss.getSheetByName(name) || ss.insertSheet(name);
    const headers = SHEETS[name];
    sh.getRange(1, 1, 1, headers.length)
      .setValues([headers]).setFontWeight('bold').setBackground('#EEF2FF');
    sh.setFrozenRows(1);
    (TEXT_COLS[name] || []).forEach(function (col) {
      const i = headers.indexOf(col) + 1;
      sh.getRange(2, i, sh.getMaxRows() - 1, 1).setNumberFormat('@');
    });
  });

  // Hapus sheet bawaan kosong (Sheet1 / Lembar1)
  ss.getSheets().forEach(function (s) {
    if (!SHEETS[s.getName()] && s.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(s);
  });

  const st = ss.getSheetByName('Settings');
  if (st.getLastRow() < 2) {
    const rows = Object.keys(DEFAULT_SETTINGS).map(function (k) { return [k, DEFAULT_SETTINGS[k]]; });
    st.getRange(2, 1, rows.length, 2).setValues(rows);
  }

  const ad = ss.getSheetByName('Admins');
  if (ad.getLastRow() < 2) ad.appendRow(['admin', hashPassword_('admin123'), 'Administrator']);

  Logger.log('Setup selesai. Login awal: admin / admin123 (segera ganti password!).');
}

function seedSampleData() {
  const books = [
    ['Laskar Pelangi', 'Andrea Hirata', 'Novel', 'Bentang Pustaka', '2005', '9789793062792', 3, 'Kisah perjuangan sepuluh anak di Belitung untuk mendapatkan pendidikan.'],
    ['Bumi Manusia', 'Pramoedya Ananta Toer', 'Novel', 'Lentera Dipantara', '1980', '9789799731234', 2, 'Novel sejarah tentang Minke di masa kolonial.'],
    ['Atomic Habits', 'James Clear', 'Pengembangan Diri', 'Gramedia', '2019', '9786020633176', 2, 'Cara membangun kebiasaan baik dan menghilangkan kebiasaan buruk.'],
    ['Fisika Dasar', 'Halliday & Resnick', 'Sains', 'Erlangga', '2010', '9789790000001', 4, 'Buku referensi fisika untuk siswa SMA.'],
    ['Sejarah Indonesia Modern', 'M.C. Ricklefs', 'Sejarah', 'Serambi', '2008', '9789790000002', 2, 'Sejarah Indonesia dari 1200 hingga masa kini.']
  ];
  books.forEach(function (b) {
    insert_('Books', {
      id: newId_('B'), judul: b[0], penulis: b[1], kategori: b[2], penerbit: b[3], tahun: b[4],
      isbn: b[5], stok_total: b[6], stok_tersedia: b[6], cover_url: '', deskripsi: b[7]
    });
  });
  [['2024001', 'Aisyah Putri', 'X-A', 'SHS'], ['2024002', 'Budi Santoso', 'IX-B', 'JHS'], ['2024003', 'Citra Dewi', 'XI-C', 'SHS']]
    .forEach(function (m) {
      insert_('Members', { id: newId_('M'), nis: m[0], nama: m[1], kelas: m[2], jenjang: m[3] });
    });
}

/* ===================================================================
 *  ENTRY POINT & ROUTER
 * =================================================================== */

function doGet(e) {
  const req = e && e.parameter ? e.parameter : {};
  if (!req.action) return json_({ ok: true, data: 'Perpustakaan API aktif' });
  return route_(req, false);
}

function doPost(e) {
  let req = {};
  try {
    req = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: 'Format permintaan tidak valid' });
  }
  return route_(req, true);
}

const PUBLIC_ACTIONS = {
  listBooks: listBooks_,
  getBook: getBook_,
  listCategories: listCategories_,
  publicStats: publicStats_,
  memberStatus: memberStatus_
};

const ADMIN_ACTIONS = {
  dashboard: dashboard_,
  createBook: createBook_,
  updateBook: updateBook_,
  deleteBook: deleteBook_,
  listMembers: listMembers_,
  createMember: createMember_,
  updateMember: updateMember_,
  deleteMember: deleteMember_,
  importMembers: importMembers_,
  listLoans: listLoans_,
  createLoan: createLoan_,
  returnLoan: returnLoan_,
  extendLoan: extendLoan_,
  getSettings: getSettingsAction_,
  updateSettings: updateSettings_,
  changePassword: changePassword_
};

function route_(req, viaPost) {
  try {
    const action = String(req.action || '');

    if (PUBLIC_ACTIONS[action]) return json_({ ok: true, data: PUBLIC_ACTIONS[action](req) });
    if (!viaPost) throw new Error('Aksi ini harus dikirim dengan POST');

    if (action === 'login') return json_({ ok: true, data: login_(req) });
    if (action === 'logout') { logout_(req); return json_({ ok: true, data: true }); }

    const user = requireAdmin_(req.token);
    const fn = ADMIN_ACTIONS[action];
    if (!fn) throw new Error('Aksi tidak dikenal: ' + action);

    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      return json_({ ok: true, data: fn(req, user) });
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return json_({ ok: false, error: err.message || String(err) });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* ===================================================================
 *  AUTH
 * =================================================================== */

function hashPassword_(pw, salt) {
  salt = salt || Utilities.getUuid().slice(0, 8);
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + pw, Utilities.Charset.UTF_8);
  const hex = digest.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
  return salt + '$' + hex;
}

function checkPassword_(pw, stored) {
  const salt = String(stored).split('$')[0];
  return hashPassword_(pw, salt) === stored;
}

function login_(req) {
  const username = str_(req.username).toLowerCase();
  const cache = CacheService.getScriptCache();
  const failKey = 'fail_' + username;
  if (Number(cache.get(failKey) || 0) >= 5) {
    throw new Error('Terlalu banyak percobaan login. Coba lagi dalam 5 menit.');
  }
  const admin = readAll_('Admins').filter(function (a) { return String(a.username).toLowerCase() === username; })[0];
  if (!admin || !checkPassword_(str_(req.password), admin.password_hash)) {
    cache.put(failKey, String(Number(cache.get(failKey) || 0) + 1), 300);
    throw new Error('Username atau password salah');
  }
  cache.remove(failKey);
  const token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  cache.put('tok_' + token, admin.username, TOKEN_TTL);
  return { token: token, nama: admin.nama, username: admin.username, expires_in: TOKEN_TTL };
}

function logout_(req) {
  if (req.token) CacheService.getScriptCache().remove('tok_' + req.token);
}

function requireAdmin_(token) {
  const user = token ? CacheService.getScriptCache().get('tok_' + token) : null;
  if (!user) throw new Error('Sesi berakhir, silakan login kembali');
  return user;
}

function changePassword_(req, user) {
  const admin = readAll_('Admins').filter(function (a) { return a.username === user; })[0];
  if (!admin || !checkPassword_(str_(req.password_lama), admin.password_hash)) throw new Error('Password lama salah');
  const baru = str_(req.password_baru);
  if (baru.length < 6) throw new Error('Password baru minimal 6 karakter');
  update_('Admins', admin._row, { password_hash: hashPassword_(baru) });
  return true;
}

/* ===================================================================
 *  HELPER DATABASE (Spreadsheet)
 * =================================================================== */

function sheet_(name) {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
}

function normalize_(v, header, sheetName) {
  if (v instanceof Date) return Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
  if (v === null || v === undefined) return '';
  if (typeof v === 'number' && (TEXT_COLS[sheetName] || []).indexOf(header) > -1) return String(v);
  return v;
}

function readAll_(name) {
  const sh = sheet_(name);
  const last = sh.getLastRow();
  if (last < 2) return [];
  const headers = SHEETS[name];
  return sh.getRange(2, 1, last - 1, headers.length).getValues().map(function (r, i) {
    const o = { _row: i + 2 };
    headers.forEach(function (h, j) { o[h] = normalize_(r[j], h, name); });
    return o;
  });
}

function insert_(name, obj) {
  const headers = SHEETS[name];
  sheet_(name).appendRow(headers.map(function (h) { return obj[h] === undefined ? '' : obj[h]; }));
}

function update_(name, row, patch) {
  const headers = SHEETS[name];
  const sh = sheet_(name);
  const current = sh.getRange(row, 1, 1, headers.length).getValues()[0];
  const merged = headers.map(function (h, j) { return patch[h] === undefined ? current[j] : patch[h]; });
  sh.getRange(row, 1, 1, headers.length).setValues([merged]);
}

function remove_(name, row) {
  sheet_(name).deleteRow(row);
}

function findBy_(name, field, value) {
  const v = String(value);
  return readAll_(name).filter(function (r) { return String(r[field]) === v; })[0] || null;
}

function indexBy_(arr, field) {
  const m = {};
  arr.forEach(function (x) { m[x[field]] = x; });
  return m;
}

function clean_(o) {
  const c = {};
  Object.keys(o).forEach(function (k) { if (k !== '_row') c[k] = o[k]; });
  return c;
}

function newId_(prefix) {
  return prefix + '-' + Utilities.getUuid().replace(/-/g, '').slice(0, 8).toUpperCase();
}

function str_(v) { return String(v === null || v === undefined ? '' : v).trim(); }

function int_(v, def) {
  const n = parseInt(v, 10);
  return isNaN(n) ? def : n;
}

/* ===================================================================
 *  HELPER TANGGAL (semua disimpan sebagai teks yyyy-MM-dd, zona WIB)
 * =================================================================== */

function today_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'); }

function parseDate_(s) {
  const p = String(s).split('-').map(Number);
  return new Date(Date.UTC(p[0], p[1] - 1, p[2]));
}

function addDays_(s, n) {
  const d = parseDate_(s);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Selisih hari a - b (positif jika a setelah b) */
function diffDays_(a, b) {
  return Math.round((parseDate_(a) - parseDate_(b)) / 86400000);
}

/* ===================================================================
 *  PENGATURAN
 * =================================================================== */

function getSettings_() {
  const out = {};
  Object.keys(DEFAULT_SETTINGS).forEach(function (k) { out[k] = DEFAULT_SETTINGS[k]; });
  readAll_('Settings').forEach(function (r) {
    if (DEFAULT_SETTINGS.hasOwnProperty(r.key) && r.value !== '') out[r.key] = Number(r.value);
  });
  return out;
}

function getSettingsAction_() { return getSettings_(); }

function updateSettings_(req) {
  const rows = readAll_('Settings');
  Object.keys(DEFAULT_SETTINGS).forEach(function (k) {
    if (req[k] === undefined) return;
    const val = Number(req[k]);
    if (isNaN(val) || val < 0) throw new Error('Nilai ' + k + ' tidak valid');
    const existing = rows.filter(function (r) { return r.key === k; })[0];
    if (existing) update_('Settings', existing._row, { value: val });
    else insert_('Settings', { key: k, value: val });
  });
  return getSettings_();
}

/* ===================================================================
 *  BUKU - PUBLIK
 * =================================================================== */

function listBooks_(req) {
  const q = str_(req.q).toLowerCase();
  const kategori = str_(req.kategori);
  const tersedia = String(req.tersedia) === 'true';
  const pageSize = Math.min(Math.max(int_(req.pageSize, 12), 1), 100);
  const page = Math.max(int_(req.page, 1), 1);

  let items = readAll_('Books').filter(function (b) {
    if (kategori && b.kategori !== kategori) return false;
    if (tersedia && Number(b.stok_tersedia) < 1) return false;
    if (!q) return true;
    return [b.judul, b.penulis, b.isbn, b.kategori, b.penerbit]
      .join(' ').toLowerCase().indexOf(q) > -1;
  });
  items.sort(function (a, b) { return String(a.judul).localeCompare(String(b.judul)); });

  const total = items.length;
  items = items.slice((page - 1) * pageSize, page * pageSize).map(clean_);
  return { items: items, total: total, page: page, pageSize: pageSize };
}

function getBook_(req) {
  const b = findBy_('Books', 'id', req.id);
  if (!b) throw new Error('Buku tidak ditemukan');
  return clean_(b);
}

function listCategories_() {
  const count = {};
  readAll_('Books').forEach(function (b) {
    if (b.kategori) count[b.kategori] = (count[b.kategori] || 0) + 1;
  });
  return Object.keys(count).sort().map(function (k) { return { nama: k, jumlah: count[k] }; });
}

function publicStats_() {
  const books = readAll_('Books');
  return {
    total_judul: books.length,
    total_eksemplar: books.reduce(function (s, b) { return s + Number(b.stok_total || 0); }, 0),
    judul_tersedia: books.filter(function (b) { return Number(b.stok_tersedia) > 0; }).length,
    total_kategori: listCategories_().length
  };
}

/* ===================================================================
 *  STATUS PINJAMAN SISWA (publik, berdasarkan NIS)
 * =================================================================== */

function memberStatus_(req) {
  const nis = str_(req.nis);
  if (!nis) throw new Error('NIS wajib diisi');
  const m = findBy_('Members', 'nis', nis);
  if (!m) throw new Error('NIS tidak ditemukan');
  const books = indexBy_(readAll_('Books'), 'id');
  const st = getSettings_();
  const loans = readAll_('Loans')
    .filter(function (l) { return l.id_anggota === m.id && l.status === 'Dipinjam'; })
    .map(function (l) { return enrichLoan_(l, books, {}, st); })
    .map(function (l) {
      return {
        judul: l.judul, cover_url: l.cover_url, tgl_pinjam: l.tgl_pinjam, tgl_jatuh_tempo: l.tgl_jatuh_tempo,
        sisa_hari: l.sisa_hari, hari_terlambat: l.hari_terlambat, status_waktu: l.status_waktu, denda: l.denda
      };
    })
    .sort(function (a, b) { return a.sisa_hari - b.sisa_hari; });
  return { nama: m.nama, kelas: m.kelas, jenjang: m.jenjang, pinjaman: loans };
}

/* ===================================================================
 *  BUKU - ADMIN (CRUD)
 * =================================================================== */

function validateBook_(req) {
  const judul = str_(req.judul);
  if (!judul) throw new Error('Judul wajib diisi');
  const stok = int_(req.stok_total, -1);
  if (stok < 0) throw new Error('Stok harus berupa angka 0 atau lebih');
  return {
    judul: judul,
    penulis: str_(req.penulis),
    kategori: str_(req.kategori),
    penerbit: str_(req.penerbit),
    tahun: str_(req.tahun),
    isbn: str_(req.isbn),
    stok_total: stok,
    cover_url: str_(req.cover_url),
    deskripsi: str_(req.deskripsi)
  };
}

function createBook_(req) {
  const data = validateBook_(req);
  data.id = newId_('B');
  data.stok_tersedia = data.stok_total;
  insert_('Books', data);
  return clean_(data);
}

function updateBook_(req) {
  const b = findBy_('Books', 'id', req.id);
  if (!b) throw new Error('Buku tidak ditemukan');
  const data = validateBook_(req);
  const dipinjam = Number(b.stok_total) - Number(b.stok_tersedia);
  if (data.stok_total < dipinjam) {
    throw new Error('Stok total tidak boleh kurang dari jumlah yang sedang dipinjam (' + dipinjam + ')');
  }
  data.stok_tersedia = data.stok_total - dipinjam;
  update_('Books', b._row, data);
  return clean_(findBy_('Books', 'id', req.id));
}

function deleteBook_(req) {
  const b = findBy_('Books', 'id', req.id);
  if (!b) throw new Error('Buku tidak ditemukan');
  const aktif = readAll_('Loans').some(function (l) { return l.id_buku === b.id && l.status === 'Dipinjam'; });
  if (aktif) throw new Error('Buku masih dipinjam, tidak bisa dihapus');
  remove_('Books', b._row);
  return true;
}

/* ===================================================================
 *  ANGGOTA (SISWA) - ADMIN
 * =================================================================== */

function validateMember_(m) {
  const nis = str_(m.nis), nama = str_(m.nama);
  if (!nis) throw new Error('NIS wajib diisi');
  if (!nama) throw new Error('Nama wajib diisi');
  const jenjang = str_(m.jenjang).toUpperCase();
  return { nis: nis, nama: nama, kelas: str_(m.kelas), jenjang: (jenjang === 'JHS' || jenjang === 'SHS') ? jenjang : '' };
}

function listMembers_(req) {
  const q = str_(req.q).toLowerCase();
  const loans = readAll_('Loans').filter(function (l) { return l.status === 'Dipinjam'; });
  const aktif = {};
  loans.forEach(function (l) { aktif[l.id_anggota] = (aktif[l.id_anggota] || 0) + 1; });
  return readAll_('Members')
    .filter(function (m) {
      return !q || [m.nis, m.nama, m.kelas].join(' ').toLowerCase().indexOf(q) > -1;
    })
    .sort(function (a, b) { return String(a.nama).localeCompare(String(b.nama)); })
    .map(function (m) { const c = clean_(m); c.pinjaman_aktif = aktif[m.id] || 0; return c; });
}

function createMember_(req) {
  const data = validateMember_(req);
  if (findBy_('Members', 'nis', data.nis)) throw new Error('NIS sudah terdaftar');
  data.id = newId_('M');
  insert_('Members', data);
  return clean_(data);
}

function updateMember_(req) {
  const m = findBy_('Members', 'id', req.id);
  if (!m) throw new Error('Anggota tidak ditemukan');
  const data = validateMember_(req);
  const dup = findBy_('Members', 'nis', data.nis);
  if (dup && dup.id !== m.id) throw new Error('NIS sudah dipakai anggota lain');
  update_('Members', m._row, data);
  return clean_(findBy_('Members', 'id', req.id));
}

function deleteMember_(req) {
  const m = findBy_('Members', 'id', req.id);
  if (!m) throw new Error('Anggota tidak ditemukan');
  const aktif = readAll_('Loans').some(function (l) { return l.id_anggota === m.id && l.status === 'Dipinjam'; });
  if (aktif) throw new Error('Anggota masih memiliki pinjaman aktif');
  remove_('Members', m._row);
  return true;
}

/** req.rows = [{nis, nama, kelas, jenjang}, ...]  (dari CSV yang diparse di frontend) */
function importMembers_(req) {
  const rows = req.rows || [];
  if (!rows.length) throw new Error('Tidak ada data untuk diimpor');
  if (rows.length > 2000) throw new Error('Maksimal 2000 baris per impor');
  const exist = {};
  readAll_('Members').forEach(function (m) { exist[m.nis] = true; });
  const toAdd = [], errors = [];
  let skipped = 0;
  rows.forEach(function (r, i) {
    try {
      const d = validateMember_(r);
      if (exist[d.nis]) { skipped++; return; }
      exist[d.nis] = true;
      toAdd.push([newId_('M'), d.nis, d.nama, d.kelas, d.jenjang]);
    } catch (e) {
      errors.push('Baris ' + (i + 1) + ': ' + e.message);
    }
  });
  if (toAdd.length) {
    const sh = sheet_('Members');
    const start = sh.getLastRow() + 1;
    sh.getRange(start, 2, toAdd.length, 1).setNumberFormat('@'); // kolom NIS = teks
    sh.getRange(start, 1, toAdd.length, 5).setValues(toAdd);
  }
  return { ditambahkan: toAdd.length, dilewati: skipped, gagal: errors.length, pesan_error: errors.slice(0, 20) };
}

/* ===================================================================
 *  PEMINJAMAN
 * =================================================================== */

function enrichLoan_(l, books, members, st) {
  const b = books[l.id_buku] || {};
  const m = members[l.id_anggota] || {};
  const out = {
    id: l.id, id_buku: l.id_buku, id_anggota: l.id_anggota,
    judul: b.judul || '(buku telah dihapus)', cover_url: b.cover_url || '',
    nama: m.nama || '', nis: m.nis || '', kelas: m.kelas || '',
    tgl_pinjam: l.tgl_pinjam, tgl_jatuh_tempo: l.tgl_jatuh_tempo, tgl_kembali: l.tgl_kembali,
    status: l.status, perpanjangan: Number(l.perpanjangan || 0)
  };
  if (l.status === 'Dipinjam') {
    const sisa = diffDays_(l.tgl_jatuh_tempo, today_());
    out.sisa_hari = sisa;
    out.hari_terlambat = sisa < 0 ? -sisa : 0;
    out.status_waktu = sisa < 0 ? 'terlambat'
      : sisa === 0 ? 'hari_ini'
      : sisa <= st.hampir_jatuh_tempo_hari ? 'hampir' : 'aman';
    out.denda = out.hari_terlambat * st.denda_per_hari;
  } else {
    out.sisa_hari = null;
    out.hari_terlambat = Math.max(0, diffDays_(l.tgl_kembali, l.tgl_jatuh_tempo));
    out.status_waktu = 'dikembalikan';
    out.denda = out.hari_terlambat * st.denda_per_hari;
  }
  return out;
}

function allEnrichedLoans_() {
  const books = indexBy_(readAll_('Books'), 'id');
  const members = indexBy_(readAll_('Members'), 'id');
  const st = getSettings_();
  return readAll_('Loans').map(function (l) { return enrichLoan_(l, books, members, st); });
}

/** req.filter: aktif | terlambat | selesai | semua ; req.q: cari nama/NIS/judul */
function listLoans_(req) {
  const filter = str_(req.filter) || 'aktif';
  const q = str_(req.q).toLowerCase();
  let list = allEnrichedLoans_().filter(function (l) {
    if (filter === 'aktif' && l.status !== 'Dipinjam') return false;
    if (filter === 'terlambat' && l.status_waktu !== 'terlambat') return false;
    if (filter === 'selesai' && l.status !== 'Dikembalikan') return false;
    if (!q) return true;
    return [l.nama, l.nis, l.judul, l.kelas].join(' ').toLowerCase().indexOf(q) > -1;
  });
  if (filter === 'terlambat') list.sort(function (a, b) { return b.hari_terlambat - a.hari_terlambat; });
  else if (filter === 'aktif') list.sort(function (a, b) { return a.sisa_hari - b.sisa_hari; });
  else list.sort(function (a, b) { return String(b.tgl_pinjam).localeCompare(String(a.tgl_pinjam)); });
  return list;
}

function createLoan_(req) {
  const book = findBy_('Books', 'id', req.id_buku);
  if (!book) throw new Error('Buku tidak ditemukan');
  const member = findBy_('Members', 'id', req.id_anggota);
  if (!member) throw new Error('Anggota tidak ditemukan');
  if (Number(book.stok_tersedia) < 1) throw new Error('Stok buku sedang habis');

  const st = getSettings_();
  const aktif = readAll_('Loans').filter(function (l) { return l.id_anggota === member.id && l.status === 'Dipinjam'; });
  if (aktif.length >= st.maks_buku_per_siswa) {
    throw new Error('Siswa sudah mencapai batas ' + st.maks_buku_per_siswa + ' buku');
  }
  if (aktif.some(function (l) { return l.id_buku === book.id; })) {
    throw new Error('Siswa sedang meminjam buku yang sama');
  }

  const durasi = Math.min(Math.max(int_(req.durasi, st.durasi_pinjam_default), 1), 90);
  const tglPinjam = today_();
  const loan = {
    id: newId_('L'), id_buku: book.id, id_anggota: member.id,
    tgl_pinjam: tglPinjam, tgl_jatuh_tempo: addDays_(tglPinjam, durasi),
    tgl_kembali: '', status: 'Dipinjam', perpanjangan: 0
  };
  insert_('Loans', loan);
  update_('Books', book._row, { stok_tersedia: Number(book.stok_tersedia) - 1 });
  return loan;
}

function returnLoan_(req) {
  const l = findBy_('Loans', 'id', req.id);
  if (!l) throw new Error('Data peminjaman tidak ditemukan');
  if (l.status === 'Dikembalikan') throw new Error('Buku sudah dikembalikan');
  update_('Loans', l._row, { tgl_kembali: today_(), status: 'Dikembalikan' });
  const b = findBy_('Books', 'id', l.id_buku);
  if (b) {
    update_('Books', b._row, { stok_tersedia: Math.min(Number(b.stok_tersedia) + 1, Number(b.stok_total)) });
  }
  return true;
}

function extendLoan_(req) {
  const l = findBy_('Loans', 'id', req.id);
  if (!l) throw new Error('Data peminjaman tidak ditemukan');
  if (l.status !== 'Dipinjam') throw new Error('Peminjaman sudah selesai');
  const st = getSettings_();
  if (Number(l.perpanjangan || 0) >= st.maks_perpanjangan) {
    throw new Error('Batas perpanjangan (' + st.maks_perpanjangan + 'x) sudah tercapai');
  }
  // Jika sudah terlambat, hitung dari hari ini; jika belum, dari jatuh tempo lama
  const dasar = diffDays_(l.tgl_jatuh_tempo, today_()) < 0 ? today_() : l.tgl_jatuh_tempo;
  const baru = addDays_(dasar, st.durasi_perpanjangan);
  update_('Loans', l._row, { tgl_jatuh_tempo: baru, perpanjangan: Number(l.perpanjangan || 0) + 1 });
  return { tgl_jatuh_tempo: baru };
}

/* ===================================================================
 *  DASHBOARD ADMIN
 * =================================================================== */

function dashboard_() {
  const books = readAll_('Books');
  const loans = allEnrichedLoans_();
  const aktif = loans.filter(function (l) { return l.status === 'Dipinjam'; });
  const terlambat = aktif.filter(function (l) { return l.status_waktu === 'terlambat'; })
    .sort(function (a, b) { return b.hari_terlambat - a.hari_terlambat; });
  return {
    total_judul: books.length,
    total_eksemplar: books.reduce(function (s, b) { return s + Number(b.stok_total || 0); }, 0),
    total_anggota: readAll_('Members').length,
    sedang_dipinjam: aktif.length,
    jatuh_tempo_hari_ini: aktif.filter(function (l) { return l.status_waktu === 'hari_ini'; }).length,
    hampir_jatuh_tempo: aktif.filter(function (l) { return l.status_waktu === 'hampir'; }).length,
    terlambat: terlambat.length,
    terlambat_teratas: terlambat.slice(0, 5),
    peminjaman_terbaru: loans.sort(function (a, b) { return String(b.tgl_pinjam).localeCompare(String(a.tgl_pinjam)); }).slice(0, 5)
  };
}