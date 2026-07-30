/* Registrasi service worker supaya portal bisa di-install ke homescreen. */
(function () {
  if (!('serviceWorker' in navigator)) return;

  window.addEventListener('load', function () {
    navigator.serviceWorker.register('/sw.js', { scope: '/' })
      .catch(function (err) {
        console.warn('[pwa] service worker gagal didaftarkan:', err);
      });
  });
})();
