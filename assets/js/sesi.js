/* ===========================================================================
   PENJAGA SESI LOGIN
   ---------------------------------------------------------------------------
   Token dari /api/login berlaku 24 jam, tapi localStorage tidak ikut terhapus
   waktu jendela ditutup. Tanpa penjaga ini, token yang sudah mati tetap
   tersimpan, navbar tetap menampilkan chip admin, lalu semua panggilan API
   ditolak 401 diam-diam -- kelihatan login, tapi tidak ada yang jalan.

   Berkas ini menutup celah itu dari dua sisi:

     1. Saat halaman dimuat, masa berlaku token diperiksa. Kalau sudah lewat,
        sesi dibersihkan lebih dulu supaya skrip navbar di bawahnya melihat
        keadaan yang jujur: belum login.
     2. window.fetch dibungkus. Kalau ada panggilan /api/ dijawab 401 padahal
        token masih tersimpan, sesi diakhiri dan pemakai dibawa ke halaman
        login -- bukan dibiarkan menatap halaman yang diam saja.

   Harus dimuat SINKRON (tanpa defer/async) dan sedini mungkin di <head>,
   sebelum skrip lain sempat membaca localStorage:

     <script src="assets/js/sesi.js"></script>

   (sesuaikan kedalaman path-nya: ../assets/... atau ../../assets/...)
   =========================================================================== */

(function () {
  var KUNCI_SESI = ['token', 'role', 'username', 'displayName', 'avatarInitial'];

  // Path ke login.html dihitung dari lokasi berkas ini, supaya benar baik
  // dipanggil dari root, dari apps/, maupun dari apps/<folder>/.
  function hitungBasis() {
    var s = document.currentScript;
    if (!s) {
      var semua = document.querySelectorAll('script[src*="sesi.js"]');
      s = semua[semua.length - 1];
    }
    var src = s ? s.getAttribute('src') : '';
    return src.replace(/assets\/js\/sesi\.js.*$/, '');
  }
  var urlLogin = hitungBasis() + 'login.html';
  var diHalamanLogin = /login\.html$/.test(location.pathname);

  function bacaKlaim(token) {
    try {
      var muatan = String(token).split('.')[1];
      if (!muatan) return null;
      return JSON.parse(atob(muatan.replace(/-/g, '+').replace(/_/g, '/')));
    } catch (e) {
      return null;
    }
  }

  // Token yang tidak terbaca ikut dianggap mati -- lebih baik minta login ulang
  // daripada menampilkan keadaan login yang tidak bisa dipertanggungjawabkan.
  function sudahLewat(token) {
    var klaim = bacaKlaim(token);
    if (!klaim || !klaim.exp) return true;
    return Date.now() >= klaim.exp * 1000;
  }

  function bersihkan() {
    KUNCI_SESI.forEach(function (k) { localStorage.removeItem(k); });
  }

  // Alamat halaman sekarang, relatif terhadap root situs. Bentuk ini yang
  // diterima getSafeRedirect() di login.html (yang menolak '../' dan URL penuh).
  function alamatSekarang() {
    return (location.pathname + location.search).replace(/^\/+/, '');
  }

  var sedangKeluar = false;
  function akhiri(alasan) {
    if (sedangKeluar) return;
    sedangKeluar = true;
    bersihkan();
    if (diHalamanLogin) return;
    location.replace(
      urlLogin + '?sesi=' + encodeURIComponent(alasan || 'habis') +
      '&redirect=' + encodeURIComponent(alamatSekarang())
    );
  }

  // --- Periksa sekali di awal, sebelum skrip halaman membaca localStorage ---
  var token = localStorage.getItem('token');
  if (token && sudahLewat(token)) bersihkan();

  // --- Tangkap 401 dari API ---------------------------------------------
  // Cuma 401 (token mati / tidak ada). 403 dibiarkan lewat karena itu soal
  // hak akses -- pemakainya sah, cuma bukan admin. /api/login juga dikecualikan:
  // 401 di sana artinya password salah, bukan sesi habis.
  var fetchAsli = window.fetch;
  if (typeof fetchAsli === 'function') {
    window.fetch = function (input, init) {
      return fetchAsli.apply(this, arguments).then(function (res) {
        if (res.status === 401 && localStorage.getItem('token')) {
          var url = typeof input === 'string' ? input : (input && input.url) || '';
          if (/(^|\/)api\//.test(url) && !/(^|\/)api\/login(\?|$)/.test(url)) akhiri('habis');
        }
        return res;
      });
    };
  }

  // Tab yang ditinggal terbuka melewati batas 24 jam: periksa lagi saat
  // pemakainya kembali, jangan tunggu sampai ada panggilan API yang gagal.
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) return;
    var t = localStorage.getItem('token');
    if (t && sudahLewat(t)) akhiri('habis');
  });

  window.Sesi = {
    token: function () { return localStorage.getItem('token'); },
    aktif: function () {
      var t = localStorage.getItem('token');
      return !!t && !sudahLewat(t);
    },
    bersihkan: bersihkan,
    akhiri: akhiri
  };
})();
