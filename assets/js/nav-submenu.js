/* ===========================================================================
   SUB MENU "ABOUT SAB" DI NAVBAR
   ---------------------------------------------------------------------------
   Mengubah butir menu "About SAB" jadi menu bertingkat:

     About SAB ▾
       ├── Profil Tim        -> tujuan asli butir itu (about.html / go('about'))
       └── Galeri Kegiatan   -> galeri.html

   Navbar tersalin di 20 halaman dengan DUA bentuk markup berbeda (.nav-links
   di halaman utama, .ptmb-nav-links di apps/), jadi markup + gaya + logikanya
   semua dibangun dari berkas ini -- sama seperti assets/js/nav-badge.js. Tiap
   halaman cukup menambahkan satu baris:

     <script defer src="assets/js/nav-submenu.js"></script>

   (sesuaikan kedalaman path-nya: ../assets/... atau ../../assets/...)

   Butir "About SAB" yang asli TIDAK dibuang, cuma dipindah masuk ke dalam
   panel dan diganti tulisannya jadi "Profil Tim". Itu disengaja: di
   index.html butir itu bukan tautan biasa melainkan <button onclick="go
   ('about')"> yang memindah halaman di tempat. Kalau diganti tautan baru,
   perilaku itu hilang.
   =========================================================================== */

(function () {
  var navLinks = document.getElementById('navLinks');
  if (!navLinks) return;

  // Cari butir "About SAB" lewat tulisannya, bukan lewat href: di apps/
  // href-nya "../index.html?page=about", di galeri.html "about.html", dan di
  // index.html tidak ada href sama sekali.
  var asli = null;
  var butir = navLinks.querySelectorAll('a, button');
  for (var i = 0; i < butir.length; i++) {
    if (/about\s*sab/i.test(butir[i].textContent || '')) { asli = butir[i]; break; }
  }
  if (!asli || !asli.parentNode) return;

  // Path dihitung dari lokasi berkas ini supaya benar baik dipanggil dari
  // root, dari apps/, maupun dari apps/<folder>/ (pola sama dengan nav-badge.js).
  function hitungBasis() {
    var s = document.currentScript;
    if (!s) {
      var semua = document.querySelectorAll('script[src*="nav-submenu.js"]');
      s = semua[semua.length - 1];
    }
    var src = s ? s.getAttribute('src') : '';
    return src.replace(/assets\/js\/nav-submenu\.js.*$/, '');
  }
  var basis = hitungBasis();

  // Ganti HANYA tulisannya, ikon <svg> di dalamnya dibiarkan utuh.
  function gantiTulisan(el, teks) {
    for (var i = 0; i < el.childNodes.length; i++) {
      var n = el.childNodes[i];
      if (n.nodeType === 3 && n.nodeValue.trim()) { n.nodeValue = teks; return; }
    }
    el.appendChild(document.createTextNode(teks));
  }

  var gaya = document.createElement('style');
  gaya.textContent =
    '.nav-sub{position:relative;}' +
    // Tombol pembuka sengaja memakai <a>: di apps/ yang bergaya cuma
    // ".ptmb-nav-links a", <button> di sana tidak kebagian gaya apa pun.
    '.nav-sub-top{cursor:pointer;}' +
    '.nav-sub-caret{display:inline-block;width:6px;height:6px;margin-left:5px;' +
    'border-right:1.6px solid currentColor;border-bottom:1.6px solid currentColor;' +
    'transform:rotate(45deg) translate(-2px,-2px);transition:transform .15s;}' +
    '.nav-sub.buka .nav-sub-caret{transform:rotate(-135deg) translate(-2px,-2px);}' +
    '.nav-sub-panel{position:absolute;top:calc(100% + 8px);left:0;min-width:186px;' +
    'background:#fff;border:1px solid #DCE9EF;border-radius:12px;padding:6px;' +
    'box-shadow:0 18px 36px rgba(10,37,55,.14);z-index:70;' +
    'opacity:0;visibility:hidden;transform:translateY(-4px);' +
    'transition:opacity .15s,transform .15s,visibility .15s;}' +
    '.nav-sub.buka .nav-sub-panel{opacity:1;visibility:visible;transform:translateY(0);}' +
    '.nav-sub-panel a,.nav-sub-panel button{display:flex;align-items:center;gap:9px;' +
    'width:100%;padding:9px 11px;border-radius:9px;border:none;background:none;' +
    'font-size:13.5px;font-weight:600;color:#0E2A32;text-align:left;cursor:pointer;' +
    'text-decoration:none;transition:background .12s;}' +
    '.nav-sub-panel a:hover,.nav-sub-panel button:hover{background:#F4F8FA;}' +
    '.nav-sub-panel svg{flex-shrink:0;display:inline-flex;}' +
    // Di layar HP navbar jadi daftar menurun, jadi panelnya ikut menurun
    // (bukan mengambang) supaya tidak menutupi butir menu di bawahnya.
    '@media(max-width:720px){' +
    '.nav-sub-panel{position:static;opacity:1;visibility:visible;transform:none;' +
    'box-shadow:none;border:none;border-left:2px solid #DCE9EF;border-radius:0;' +
    'margin:2px 0 2px 16px;padding:0 0 0 6px;min-width:0;display:none;}' +
    '.nav-sub.buka .nav-sub-panel{display:block;}' +
    '}';
  document.head.appendChild(gaya);

  var wrap = document.createElement('div');
  wrap.className = 'nav-sub';

  var toggle = document.createElement('a');
  toggle.className = 'nav-sub-top' + (asli.classList.contains('active') ? ' active' : '');
  toggle.setAttribute('role', 'button');
  toggle.setAttribute('aria-expanded', 'false');
  var ikon = asli.querySelector('svg');
  if (ikon) toggle.appendChild(ikon.cloneNode(true));
  toggle.appendChild(document.createTextNode('About SAB'));
  var caret = document.createElement('span');
  caret.className = 'nav-sub-caret';
  toggle.appendChild(caret);

  var panel = document.createElement('div');
  panel.className = 'nav-sub-panel';

  asli.parentNode.insertBefore(wrap, asli);
  panel.appendChild(asli);            // butir asli dipindah, bukan disalin
  gantiTulisan(asli, 'Profil Tim');
  asli.classList.remove('active');    // penanda aktif pindah ke pembukanya

  var galeri = document.createElement('a');
  galeri.href = basis + 'galeri.html';
  galeri.innerHTML =
    '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#7C5CD6" ' +
    'stroke-width="2" stroke-linecap="round"><rect x="3" y="5" width="18" height="14" rx="2"/>' +
    '<circle cx="9" cy="10" r="2"/><path d="m21 15-4-4-6 6"/></svg>Galeri Kegiatan';
  panel.appendChild(galeri);

  wrap.appendChild(toggle);
  wrap.appendChild(panel);

  // Halaman galeri belum tentu menandai butir About SAB sebagai aktif, jadi
  // ditandai di sini berdasarkan alamat halaman yang sedang dibuka.
  if (/galeri\.html$/.test(location.pathname)) toggle.classList.add('active');

  toggle.addEventListener('click', function (e) {
    e.preventDefault();
    e.stopPropagation();
    var buka = !wrap.classList.contains('buka');
    wrap.classList.toggle('buka', buka);
    toggle.setAttribute('aria-expanded', buka ? 'true' : 'false');
  });
  document.addEventListener('click', function (e) {
    if (!wrap.contains(e.target)) {
      wrap.classList.remove('buka');
      toggle.setAttribute('aria-expanded', 'false');
    }
  });

  // Menutup submenu begitu salah satu isinya dipilih. Kalau tidak, di
  // index.html submenunya menggantung terbuka: butir "Profil Tim" di sana
  // memindah halaman di tempat (go('about')) tanpa memuat ulang, jadi tidak
  // ada apa pun yang membereskannya.
  panel.addEventListener('click', function () {
    wrap.classList.remove('buka');
    toggle.setAttribute('aria-expanded', 'false');
  });
})();
