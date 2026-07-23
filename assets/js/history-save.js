// Helper bersama dipakai semua halaman generator surat (apps/*.html) untuk
// mencatat riwayat ke server setelah unduhan berhasil. Hanya tercatat kalau
// yang mengunduh adalah admin (server yang memutuskan lewat token JWT) --
// viewer/publik tetap bisa unduh seperti biasa, panggilan ini gagal senyap
// dan tidak pernah mengganggu alur unduh.
// Mengembalikan Promise berisi entry yang tersimpan (atau null kalau
// dilewati/gagal). Pemanggil lama yang tidak memakai nilai kembaliannya tetap
// bekerja seperti sebelumnya; halaman Berita Acara memakainya untuk mengikat
// baris pekerjaan ke entri riwayat surat ini.
function saveHistoryEntry(documentType, documentName, details) {
  var token = localStorage.getItem('token');
  var role = localStorage.getItem('role');
  if (!token || role !== 'admin') return Promise.resolve(null);

  return fetch('/api/history', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + token
    },
    body: JSON.stringify({ documentType: documentType, documentName: documentName, details: details })
  }).then(function (res) {
    return res.ok ? res.json() : null;
  }).then(function (d) {
    return d && d.entry ? d.entry : null;
  }).catch(function (err) {
    console.error('Gagal mencatat riwayat surat:', err);
    return null;
  });
}
