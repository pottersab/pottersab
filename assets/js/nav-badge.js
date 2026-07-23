/* ===========================================================================
   LONCENG NOTIFIKASI DI NAVBAR
   ---------------------------------------------------------------------------
   Menampilkan jumlah laporan lapangan (Formulir Pekerjaan SAB) yang belum
   dibuatkan berita acara. Diklik -> langsung ke halaman Berita Acara.

   Cuma muncul untuk yang sudah login sebagai admin, dan cuma kalau memang ada
   yang menunggu -- kalau nol, loncengnya tidak ditampilkan sama sekali supaya
   navbar tidak ramai tanpa alasan.

   Navbar tersalin di banyak halaman, jadi markup + gaya + logikanya semua
   dibangun dari berkas ini. Tiap halaman cukup menambahkan satu baris:

     <script defer src="assets/js/nav-badge.js"></script>

   (sesuaikan kedalaman path-nya: ../assets/... atau ../../assets/...)
   =========================================================================== */

(function () {
  var token = localStorage.getItem('token');
  var role = localStorage.getItem('role');
  if (!token || role !== 'admin') return;

  var wrap = document.getElementById('adminWrap');
  if (!wrap || !wrap.parentNode) return;

  // Path ke halaman Berita Acara dihitung dari lokasi berkas ini, supaya
  // benar baik dipanggil dari root (index.html), dari apps/ (berita-acara),
  // maupun dari apps/<folder>/ (riwayat-pekerjaan).
  function hitungBasis() {
    var s = document.currentScript;
    if (!s) {
      var semua = document.querySelectorAll('script[src*="nav-badge.js"]');
      s = semua[semua.length - 1];
    }
    var src = s ? s.getAttribute('src') : '';
    return src.replace(/assets\/js\/nav-badge\.js.*$/, '');
  }
  var basis = hitungBasis();

  var gaya = document.createElement('style');
  gaya.textContent =
    '.nav-lonceng{position:relative;display:none;align-items:center;justify-content:center;' +
    'width:38px;height:38px;border-radius:50%;border:1px solid #DCE9EF;background:#FFFFFF;' +
    'cursor:pointer;transition:border-color .15s,background .15s;flex-shrink:0;}' +
    '.nav-lonceng:hover{border-color:#BFD8E0;background:#F6FAFB;}' +
    '.nav-lonceng svg{stroke:#3C5A6E;}' +
    '.nav-lonceng-angka{position:absolute;top:-4px;right:-4px;min-width:18px;height:18px;' +
    'padding:0 5px;border-radius:9px;background:#D93025;color:#fff;font-size:11px;' +
    'font-weight:700;line-height:18px;text-align:center;border:2px solid #F4F8FA;' +
    'font-family:system-ui,sans-serif;}';
  document.head.appendChild(gaya);

  var tombol = document.createElement('button');
  tombol.className = 'nav-lonceng';
  tombol.type = 'button';
  tombol.title = 'Laporan lapangan yang belum dibuatkan berita acara';
  tombol.innerHTML =
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>' +
    '<path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>' +
    '<span class="nav-lonceng-angka" id="navLoncengAngka">0</span>';
  tombol.addEventListener('click', function () {
    window.location.href = basis + 'apps/berita-acara.html';
  });
  wrap.parentNode.insertBefore(tombol, wrap);

  function tampilkan(jumlah) {
    if (!jumlah) { tombol.style.display = 'none'; return; }
    document.getElementById('navLoncengAngka').textContent = jumlah > 99 ? '99+' : String(jumlah);
    tombol.style.display = 'flex';
    tombol.setAttribute('aria-label', jumlah + ' laporan lapangan menunggu dibuatkan berita acara');
  }

  function muat() {
    // API selalu dipanggil dengan path absolut -- endpoint-nya memang cuma
    // ada satu, tidak tergantung dari halaman mana lonceng ini dimuat.
    fetch('/api/pekerjaan?draft=1', { headers: { Authorization: 'Bearer ' + token } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { if (d) tampilkan(d.count || 0); })
      .catch(function () { /* diam saja -- lonceng bukan fitur utama halaman */ });
  }

  muat();
  // Menyegarkan saat pemakai kembali ke tab ini, supaya angkanya tidak basi
  // setelah membuat berita acara di tab lain.
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) muat();
  });
})();
