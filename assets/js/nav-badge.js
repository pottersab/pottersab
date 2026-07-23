/* ===========================================================================
   LONCENG NOTIFIKASI DI NAVBAR
   ---------------------------------------------------------------------------
   Menampilkan laporan lapangan (Formulir Pekerjaan SAB) yang belum dibuatkan
   berita acara. Diklik -> daftar isinya terbuka, lengkap dengan tombol menuju
   halaman Berita Acara.

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

  var BIDANG_LABEL = {
    transmisi: 'Pipa Transmisi',
    'pipa-sumur': 'Pipa Sumur',
    'service-sumur': 'Service Sumur',
    lainnya: 'Pekerjaan Lainnya'
  };

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
  var urlBeritaAcara = basis + 'apps/berita-acara.html';
  var diHalamanBeritaAcara = /berita-acara\.html$/.test(location.pathname);

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m];
    });
  }

  function tanggalPendek(s) {
    if (!s) return '';
    var d = new Date(s + 'T00:00:00');
    return isNaN(d) ? s : d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
  }

  var gaya = document.createElement('style');
  gaya.textContent =
    '.nav-lonceng-wrap{position:relative;display:none;}' +
    '.nav-lonceng{position:relative;display:flex;align-items:center;justify-content:center;' +
    'width:38px;height:38px;border-radius:50%;border:1px solid #DCE9EF;background:#FFFFFF;' +
    'cursor:pointer;transition:border-color .15s,background .15s;flex-shrink:0;padding:0;}' +
    '.nav-lonceng:hover{border-color:#BFD8E0;background:#F6FAFB;}' +
    '.nav-lonceng svg{stroke:#3C5A6E;}' +
    '.nav-lonceng-angka{position:absolute;top:-4px;right:-4px;min-width:18px;height:18px;' +
    'padding:0 5px;border-radius:9px;background:#D93025;color:#fff;font-size:11px;' +
    'font-weight:700;line-height:18px;text-align:center;border:2px solid #F4F8FA;' +
    'font-family:system-ui,sans-serif;}' +
    '.nav-lonceng-panel{position:absolute;top:calc(100% + 8px);right:0;width:320px;max-width:86vw;' +
    'background:#fff;border:1px solid #DCE9EF;border-radius:12px;z-index:200;' +
    'box-shadow:0 18px 36px rgba(10,37,55,.16);overflow:hidden;display:none;' +
    'font-family:system-ui,sans-serif;}' +
    '.nav-lonceng-wrap.buka .nav-lonceng-panel{display:block;}' +
    '.nav-lonceng-judul{padding:12px 14px;border-bottom:1px solid #EDF3F5;font-size:13px;' +
    'font-weight:700;color:#0A2537;}' +
    '.nav-lonceng-judul small{display:block;font-weight:400;font-size:11.5px;color:#3C5A6E;margin-top:2px;}' +
    '.nav-lonceng-daftar{max-height:300px;overflow-y:auto;}' +
    '.nav-lonceng-item{padding:10px 14px;border-bottom:1px solid #F1F6F8;font-size:12.5px;color:#3C5A6E;line-height:1.45;}' +
    '.nav-lonceng-item:last-child{border-bottom:none;}' +
    '.nav-lonceng-item b{display:block;color:#0A2537;font-size:13px;font-weight:600;}' +
    '.nav-lonceng-item .meta{display:flex;gap:6px;flex-wrap:wrap;margin-top:3px;font-size:11.5px;}' +
    '.nav-lonceng-item .tag{background:#E7F1F4;color:#0A6A72;border-radius:99px;padding:1px 8px;font-weight:600;}' +
    '.nav-lonceng-aksi{display:block;padding:11px 14px;background:#0A2537;color:#fff;font-size:13px;' +
    'font-weight:600;text-align:center;text-decoration:none;}' +
    '.nav-lonceng-aksi:hover{background:#0A6A72;}';
  document.head.appendChild(gaya);

  var kotak = document.createElement('div');
  kotak.className = 'nav-lonceng-wrap';
  kotak.innerHTML =
    '<button class="nav-lonceng" type="button" title="Laporan lapangan yang belum dibuatkan berita acara">' +
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>' +
    '<path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>' +
    '<span class="nav-lonceng-angka" id="navLoncengAngka">0</span></button>' +
    '<div class="nav-lonceng-panel" id="navLoncengPanel"></div>';
  wrap.parentNode.insertBefore(kotak, wrap);

  var tombol = kotak.querySelector('.nav-lonceng');
  var panel = kotak.querySelector('.nav-lonceng-panel');

  tombol.addEventListener('click', function (e) {
    e.stopPropagation();
    kotak.classList.toggle('buka');
  });
  document.addEventListener('click', function (e) {
    if (!kotak.contains(e.target)) kotak.classList.remove('buka');
  });

  function isiPanel(rows) {
    var daftar = rows.map(function (r) {
      var judul = r.uraian || BIDANG_LABEL[r.bidang] || 'Laporan lapangan';
      return '<div class="nav-lonceng-item"><b>' + esc(judul) + '</b>' +
        '<div class="meta"><span class="tag">' + esc(BIDANG_LABEL[r.bidang] || r.bidang) + '</span>' +
        (r.instalasi ? '<span class="tag">' + esc(r.instalasi) + '</span>' : '') +
        '</div>' +
        '<div style="margin-top:3px">' + esc(tanggalPendek(r.tanggal)) +
        (r.created_by ? ' · dilaporkan ' + esc(r.created_by) : '') + '</div></div>';
    }).join('');

    panel.innerHTML =
      '<div class="nav-lonceng-judul">Laporan lapangan belum ber-BA' +
      '<small>Buatkan berita acaranya supaya masuk ke Riwayat Pekerjaan SAB.</small></div>' +
      '<div class="nav-lonceng-daftar">' + daftar + '</div>' +
      (diHalamanBeritaAcara
        ? '<div class="nav-lonceng-aksi" style="background:#E7F1F4;color:#0A6A72">Pilih laporannya di panel bawah ini</div>'
        : '<a class="nav-lonceng-aksi" href="' + urlBeritaAcara + '">Buat Berita Acara →</a>');
  }

  function tampilkan(jumlah, rows) {
    if (!jumlah) { kotak.style.display = 'none'; return; }
    document.getElementById('navLoncengAngka').textContent = jumlah > 99 ? '99+' : String(jumlah);
    kotak.style.display = 'block';
    tombol.setAttribute('aria-label', jumlah + ' laporan lapangan menunggu dibuatkan berita acara');
    isiPanel(rows || []);
  }

  function muat() {
    // API selalu dipanggil dengan path absolut -- endpoint-nya memang cuma
    // ada satu, tidak tergantung dari halaman mana lonceng ini dimuat.
    fetch('/api/pekerjaan?draft=1', { headers: { Authorization: 'Bearer ' + token } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { if (d) tampilkan(d.count || 0, d.rows); })
      .catch(function () { /* diam saja -- lonceng bukan fitur utama halaman */ });
  }

  muat();
  // Menyegarkan saat pemakai kembali ke tab ini, supaya angkanya tidak basi
  // setelah membuat berita acara di tab lain.
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) muat();
  });
  // Dipakai halaman Berita Acara untuk menyegarkan lonceng setelah draft
  // ditandai selesai, tanpa perlu memuat ulang halaman.
  window.segarkanLoncengDraft = muat;
})();
