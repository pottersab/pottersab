/* ===========================================================================
   KOMPRES FOTO DI BROWSER
   ---------------------------------------------------------------------------
   Dipakai bersama oleh apps/formulir-sab.html dan apps/berita-acara.html.

   Kenapa perlu: foto kamera HP berukuran 3-8 MB, dan kalau dijadikan base64
   ukurannya bertambah ~33% lagi. Padahal:
     - batas body request Serverless Function Vercel ~4,5 MB
     - kuota localStorage cuma ~5 MB
     - Neon free tier 0,5 GB

   Satu foto mentah saja sudah melewati batas pertama, dan kegagalannya tidak
   kelihatan oleh pemakai. Setelah dikecilkan ke sisi terpanjang 1600px dengan
   kualitas JPEG 0.8, ukurannya turun jadi sekitar 200-300 KB -- masih tajam
   untuk lampiran berita acara maupun bukti lapangan.

   Pemakaian:
     const foto = await kompresFoto(file);
     foto.dataUrl      // 'data:image/jpeg;base64,...'  (untuk <img> & docx)
     foto.base64       // tanpa prefix (untuk kiriman Apps Script)
     foto.w, foto.h, foto.orientation
     foto.ukuranAsli, foto.ukuranBaru   // byte, untuk ditampilkan ke pemakai
   =========================================================================== */

function kompresFoto(file, opsi) {
  const o = opsi || {};
  const sisiTerpanjang = o.sisiTerpanjang || 1600;
  const kualitas = o.kualitas || 0.8;

  return new Promise(function (resolve, reject) {
    const reader = new FileReader();
    reader.onerror = function () { reject(new Error('Gagal membaca berkas foto.')); };
    reader.onload = function () {
      const img = new Image();
      img.onerror = function () { reject(new Error('Berkas ini tidak bisa dibaca sebagai gambar.')); };
      img.onload = function () {
        let w = img.naturalWidth;
        let h = img.naturalHeight;

        // Hanya dikecilkan, tidak pernah diperbesar -- foto yang sudah kecil
        // dibiarkan pada ukuran aslinya.
        const skala = Math.min(1, sisiTerpanjang / Math.max(w, h));
        w = Math.max(1, Math.round(w * skala));
        h = Math.max(1, Math.round(h * skala));

        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        // Latar putih: PNG/foto transparan kalau langsung dijadikan JPEG
        // bagian transparannya berubah jadi hitam.
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);

        const dataUrl = canvas.toDataURL('image/jpeg', kualitas);
        resolve({
          dataUrl: dataUrl,
          base64: dataUrl.split(',')[1],
          mime: 'image/jpeg',
          nama: (file.name || 'foto').replace(/\.[^.]+$/, '') + '.jpg',
          w: w,
          h: h,
          orientation: w >= h ? 'landscape' : 'portrait',
          ukuranAsli: file.size || 0,
          // base64 memuat 4 karakter per 3 byte data
          ukuranBaru: Math.round((dataUrl.length - dataUrl.indexOf(',') - 1) * 0.75)
        });
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function formatUkuran(byte) {
  if (!byte) return '-';
  if (byte < 1024) return byte + ' B';
  if (byte < 1024 * 1024) return Math.round(byte / 1024) + ' KB';
  return (byte / 1024 / 1024).toFixed(1) + ' MB';
}
