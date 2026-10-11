/**
 * Helper bersama halaman admin (butuh config.js, api.js, ui.js dimuat lebih dulu).
 * Halaman admin berada di folder /admin, jadi tautan memakai path relatif dari sana.
 */
const Admin = (function () {
  const NAV = [
    { key: 'dashboard', href: 'index.html', ic: 'layout-dashboard', label: 'Dashboard' },
    { key: 'books', href: 'books.html', ic: 'book-open', label: 'Buku' },
    { key: 'members', href: 'members.html', ic: 'users', label: 'Anggota' },
    { key: 'loans', href: 'loans.html', ic: 'arrow-left-right', label: 'Peminjaman' },
    { key: 'late', href: 'loans.html?filter=terlambat', ic: 'triangle-alert', label: 'Terlambat' },
    { key: 'settings', href: 'settings.html', ic: 'settings', label: 'Pengaturan' }
  ];
  const USER_KEY = 'lib_user';

  function getUser() {
    try { return sessionStorage.getItem(USER_KEY) || 'Admin'; } catch (e) { return 'Admin'; }
  }

  /** Panggil di awal halaman. Jika belum login, arahkan ke halaman login. */
  function guard() {
    if (!API.getToken()) { location.replace('login.html'); return false; }
    API.onSessionExpired = function () { location.replace('login.html?expired=1'); };
    return true;
  }

  async function logout() {
    try { await API.post('logout'); } catch (e) { /* tetap keluar */ }
    API.clearToken();
    try { sessionStorage.removeItem(USER_KEY); sessionStorage.removeItem('lib_default_pw'); } catch (e) { /* abaikan */ }
    location.replace('login.html');
  }

  /** Isi sidebar dan topbar. active = key menu, title = judul halaman */
  function mountShell(active, title) {
    document.title = title + ' - Admin ' + CONFIG.LIB_NAME;
    const nav = NAV.map(function (n) {
      return '<a href="' + n.href + '"' + (n.key === active ? ' aria-current="page"' : '') + '>' +
        UI.icon(n.ic, 20) + '<span>' + n.label + '</span></a>';
    }).join('');

    document.getElementById('sidebar').innerHTML =
      '<a class="side-brand" href="index.html"><span class="brand-mark">' + UI.icon('book-open', 22) + '</span>' +
      '<span>' + UI.esc(CONFIG.LIB_NAME) + '<small>' + UI.esc(CONFIG.SCHOOL_NAME) + '</small></span></a>' +
      '<nav class="side-nav" aria-label="Menu admin">' + nav + '</nav>' +
      '<div class="side-foot"><a href="../index.html">' + UI.icon('external-link', 20) + '<span>Lihat situs siswa</span></a></div>';

    const nama = getUser();
    document.getElementById('topbar').innerHTML =
      '<button class="icon-btn menu-btn" id="menuBtn" type="button" aria-label="Buka menu">' + UI.icon('menu', 20) + '</button>' +
      '<h1>' + UI.esc(title) + '</h1>' +
      '<div class="user-chip"><span class="avatar">' + UI.esc(nama.charAt(0).toUpperCase()) + '</span>' +
      '<span class="user-name">' + UI.esc(nama) + '</span></div>' +
      '<button class="btn btn-outline btn-sm" id="logoutBtn" type="button">' + UI.icon('log-out', 18) + 'Keluar</button>';

    const close = function () { document.body.classList.remove('nav-open'); };
    document.getElementById('menuBtn').onclick = function () { document.body.classList.toggle('nav-open'); };
    document.getElementById('scrim').onclick = close;
    document.getElementById('logoutBtn').onclick = logout;
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
  }

  /**
   * Modal berbasis <dialog>.
   * opt: { title, html, submit, danger, narrow, onSubmit(data), onOpen(dialog) }
   * onSubmit boleh melempar Error: pesannya tampil di dalam modal dan modal tetap terbuka.
   * Mengembalikan Promise<boolean> (true jika berhasil disimpan).
   */
  function modal(opt) {
    return new Promise(function (resolve) {
      const dlg = document.createElement('dialog');
      dlg.className = 'modal' + (opt.narrow ? ' narrow' : '');
      dlg.innerHTML =
        '<form class="modal-form">' +
          '<div class="modal-head"><h2>' + UI.esc(opt.title) + '</h2>' +
            '<button type="button" class="icon-btn" data-close aria-label="Tutup">' + UI.icon('x', 18) + '</button></div>' +
          '<div class="modal-body">' + (opt.html || '') + '<div class="form-error" hidden></div></div>' +
          '<div class="modal-foot"><button type="button" class="btn btn-outline" data-close>Batal</button>' +
            '<button type="submit" class="btn ' + (opt.danger ? 'btn-danger' : 'btn-primary') + '">' + UI.esc(opt.submit || 'Simpan') + '</button></div>' +
        '</form>';
      document.body.appendChild(dlg);

      const form = dlg.querySelector('form');
      const err = dlg.querySelector('.form-error');
      const btn = dlg.querySelector('button[type=submit]');
      let result = false;

      dlg.addEventListener('close', function () { dlg.remove(); resolve(result); });
      Array.prototype.forEach.call(dlg.querySelectorAll('[data-close]'), function (b) { b.onclick = function () { dlg.close(); }; });

      form.addEventListener('submit', async function (ev) {
        ev.preventDefault();
        err.hidden = true;
        const label = btn.textContent;
        btn.disabled = true; btn.textContent = 'Menyimpan...';
        try {
          await opt.onSubmit(Object.fromEntries(new FormData(form)));
          result = true;
          dlg.close();
        } catch (e) {
          err.textContent = e.message;
          err.hidden = false;
          btn.disabled = false; btn.textContent = label;
        }
      });

      if (opt.onOpen) opt.onOpen(dlg);
      dlg.showModal();
      const first = dlg.querySelector('input:not([type=hidden]), textarea, select');
      if (first) first.focus();
    });
  }

  /** Dialog konfirmasi. opt: { title, text, submit, danger, action() } -> Promise<boolean> */
  function confirmBox(opt) {
    return modal({
      title: opt.title, narrow: true, submit: opt.submit || 'Ya, lanjut', danger: opt.danger,
      html: '<p>' + opt.text + '</p>',
      onSubmit: opt.action
    });
  }

  return { guard: guard, logout: logout, mountShell: mountShell, modal: modal, confirm: confirmBox, getUser: getUser };
})();