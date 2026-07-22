// Helper bersama dipakai semua halaman generator surat (apps/*.html) untuk
// mencatat riwayat ke server setelah unduhan berhasil. Hanya tercatat kalau
// yang mengunduh adalah admin (server yang memutuskan lewat token JWT) --
// viewer/publik tetap bisa unduh seperti biasa, panggilan ini gagal senyap
// dan tidak pernah mengganggu alur unduh.
function saveHistoryEntry(documentType, documentName, details) {
  var token = localStorage.getItem('token');
  var role = localStorage.getItem('role');
  if (!token || role !== 'admin') return;

  fetch('/api/history', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + token
    },
    body: JSON.stringify({ documentType: documentType, documentName: documentName, details: details })
  }).catch(function (err) {
    console.error('Gagal mencatat riwayat surat:', err);
  });
}
