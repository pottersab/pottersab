/* ===========================================================================
   KPI Sumber Air Baku KHUSUS ADMIN (permintaan user)
   ---------------------------------------------------------------------------
   Dimuat SINKRON di <head> (setelah sesi.js) di setiap halaman apps/kpi-sab/.
   Kalau tidak login sebagai admin (role 'admin'), langsung diarahkan ke
   halaman login. Server juga menolak dataType kpi_* untuk non-admin
   (lihat api/visualization/data.js), jadi ini penjaga antarmuka yang rapi.
   =========================================================================== */
(function () {
  var token = localStorage.getItem('token');
  var role = localStorage.getItem('role');
  if (token && role === 'admin') return;

  // Path login.html dihitung dari lokasi berkas ini (pola sama sesi.js).
  var src = document.currentScript ? (document.currentScript.getAttribute('src') || '') : '';
  var base = src.replace(/assets\/js\/kpi-admin-guard\.js.*$/, '');
  var redirect = encodeURIComponent(location.pathname + location.search);
  location.replace(base + 'login.html?redirect=' + redirect);
})();
