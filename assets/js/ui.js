/**
 * Helper UI bersama (dipakai halaman siswa dan admin).
 * Ikon: Iconify (set Lucide). Semua ikon memakai SATU warna lewat variabel CSS --icon.
 */
const UI = (function () {
  const COVER_COLORS = ['#4338CA', '#0E7490', '#9D2B6B', '#3F6B45', '#B45309', '#334155', '#6D28D9', '#9F1239'];

  function esc(s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function icon(name, size) {
    size = size || 18;
    return '<iconify-icon icon="lucide:' + name + '" width="' + size + '" height="' + size + '" aria-hidden="true"></iconify-icon>';
  }

  function hash(s) {
    let h = 0;
    String(s).split('').forEach(function (c) { h = (h * 31 + c.charCodeAt(0)) | 0; });
    return Math.abs(h);
  }

  function coverColor(b) { return COVER_COLORS[hash(b.judul) % COVER_COLORS.length]; }

  /** Sampul buku. Jika cover_url kosong atau gagal dimuat, tampil sampul buatan dengan judul. size: '', 'sm', 'lg' */
  function cover(b, size) {
    const img = b.cover_url
      ? '<img src="' + esc(b.cover_url) + '" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">'
      : '';
    return '<div class="cover ' + (size || '') + '" style="--c:' + coverColor(b) + '">' + img +
      '<span class="cover-title">' + esc(b.judul) + '</span>' +
      '<span class="cover-author">' + esc(b.penulis || '') + '</span></div>';
  }

  /** Punggung buku untuk ilustrasi rak di beranda */
  function spine(b, i) {
    const h = 130 + (hash(b.judul) % 60);
    const w = 36 + (hash(b.penulis || b.judul) % 14);
    return '<a class="spine" href="book.html?id=' + encodeURIComponent(b.id) + '" title="' + esc(b.judul) +
      '" style="--c:' + coverColor(b) + ';--h:' + h + 'px;--w:' + w + 'px;--i:' + i + '"><span>' + esc(b.judul) + '</span></a>';
  }

  function availBadge(b) {
    const n = Number(b.stok_tersedia);
    return n > 0
      ? '<span class="badge ok">Tersedia ' + n + '</span>'
      : '<span class="badge bad">Sedang dipinjam</span>';
  }

  function loanBadge(l) {
    switch (l.status_waktu) {
      case 'terlambat': return '<span class="badge bad">Terlambat ' + l.hari_terlambat + ' hari</span>';
      case 'hari_ini': return '<span class="badge warn">Jatuh tempo hari ini</span>';
      case 'hampir': return '<span class="badge warn">Sisa ' + l.sisa_hari + ' hari</span>';
      case 'aman': return '<span class="badge ok">Sisa ' + l.sisa_hari + ' hari</span>';
      default: return '<span class="badge muted">Dikembalikan</span>';
    }
  }

  function parseDate(s) {
    const p = String(s).split('-').map(Number);
    return Date.UTC(p[0], p[1] - 1, p[2]);
  }
  function diffDays(a, b) { return Math.round((parseDate(a) - parseDate(b)) / 86400000); }

  function fmtDate(s) {
    if (!s) return '-';
    return new Date(parseDate(s)).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  }

  function rupiah(n) { return 'Rp ' + Number(n).toLocaleString('id-ID'); }

  function debounce(fn, ms) {
    let t;
    return function () {
      const args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, ms);
    };
  }

  /** Blok kosong / error / info */
  function state(o) {
    return '<div class="state span-all"><div class="state-icon">' + icon(o.icon || 'info', 26) + '</div>' +
      '<h3>' + esc(o.title) + '</h3>' + (o.text ? '<p>' + esc(o.text) + '</p>' : '') + (o.action || '') + '</div>';
  }

  function toast(msg, type) {
    let box = document.getElementById('toasts');
    if (!box) {
      box = document.createElement('div');
      box.id = 'toasts';
      box.setAttribute('role', 'status');
      box.setAttribute('aria-live', 'polite');
      document.body.appendChild(box);
    }
    const t = document.createElement('div');
    t.className = 'toast ' + (type || '');
    t.textContent = msg;
    box.appendChild(t);
    setTimeout(function () { t.classList.add('out'); setTimeout(function () { t.remove(); }, 250); }, 3600);
  }

  /** Header dan footer halaman siswa. active: 'katalog' | 'status' */
  function mountChrome(active) {
    const items = [
      { key: 'katalog', href: 'index.html', ic: 'library', label: 'Katalog' },
      { key: 'status', href: 'status.html', ic: 'clock', label: 'Cek pinjaman' }
    ];
    const nav = items.map(function (i) {
      return '<a href="' + i.href + '" title="' + i.label + '"' + (i.key === active ? ' aria-current="page"' : '') + '>' +
        icon(i.ic, 18) + '<span class="lbl">' + i.label + '</span></a>';
    }).join('') +
      '<a href="admin/login.html" title="Masuk admin">' + icon('lock', 18) + '<span class="lbl">Admin</span></a>';

    const header = document.getElementById('site-header');
    if (header) {
      header.innerHTML = '<div class="wrap bar">' +
        '<a class="brand" href="index.html"><span class="brand-mark">' + icon('book-open', 22) + '</span>' +
        '<span>' + esc(CONFIG.LIB_NAME) + '<small>' + esc(CONFIG.SCHOOL_NAME) + '</small></span></a>' +
        '<nav class="nav" aria-label="Menu utama">' + nav + '</nav></div>';
    }
    const footer = document.getElementById('site-footer');
    if (footer) {
      footer.innerHTML = '<div class="wrap">' + esc(CONFIG.LIB_NAME) + ' ' + esc(CONFIG.SCHOOL_NAME) + '</div>';
    }
  }

  return {
    esc: esc, icon: icon, cover: cover, spine: spine, availBadge: availBadge, loanBadge: loanBadge,
    diffDays: diffDays, fmtDate: fmtDate, rupiah: rupiah, debounce: debounce, state: state,
    toast: toast, mountChrome: mountChrome
  };
})();