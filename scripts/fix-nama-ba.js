// Perbaiki nama dokumen di Riwayat Surat untuk Berita Acara yang subjudulnya
// kosong. Logika baru di apps/berita-acara.html (namaDokumenRiwayat): kalau
// Sub Judul kosong, nama dokumen memakai isi "Telah Melakukan Pemeriksaan
// Pada" (state.periksaPada) alih-alih jatuh ke nama file mentah
// ("Berita_Acara_45_tanggal.docx").
//
// Script ini menyesuaikan entri history yang SUDAH TERLANJUR tersimpan dengan
// nama lama, supaya konsisten dengan logika baru.
//
// AMAN: default cuma MENAMPILKAN apa yang akan diubah (dry-run). Untuk benar
// benar menulis ke database, jalankan dengan flag --apply.
//
// Cara pakai (butuh DATABASE_URL sudah di-set di environment):
//   node scripts/fix-nama-ba.js                    # dry-run
//   node scripts/fix-nama-ba.js --apply            # benar-benar perbarui

const { pool, ensureTable } = require('../lib/db');

// Sama persis dengan sanitasiNamaDokumen() di apps/berita-acara.html --
// dipertahankan sinkron di sini supaya nama baru identik dengan yang akan
// dihasilkan halaman kalau BA itu diunduh ulang.
function sanitasiNamaDokumen(teks) {
  return String(teks || '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[<>:"/\\|?*]+/g, '')
    .trim()
    .slice(0, 120);
}

// Hanya perbarui nomor urut Berita Acara yang dipilih lewat argumen.
// Default: nomor 45 (kasus yang sedang diperbaiki). Bisa diganti:
//   node scripts/fix-nama-ba.js 45 47 51 --apply
const args = process.argv.slice(2);
const apply = args.includes('--apply');
const nomorTarget = args.filter(a => /^\d+$/.test(a));
const NOMOR = nomorTarget.length ? nomorTarget : ['45'];

(async () => {
  try {
    await ensureTable();

    // details untuk Berita Acara berbentuk { state, photos } -- nomor urut di
    // details.state.nomorUrut. Entri riwayat lain (SPD, KPI, dll) tidak
    // disentuh.
    const { rows } = await pool.query(
      `SELECT id, document_name, details, created_at
       FROM history
       WHERE document_type = 'Berita Acara'
       ORDER BY created_at ASC`
    );

    const kandidat = rows.filter(r => {
      const st = r.details && r.details.state;
      return st && st.nomorUrut != null && NOMOR.includes(String(st.nomorUrut));
    });

    if (!kandidat.length) {
      console.log(`Tidak ada Berita Acara bernomor ${NOMOR.join(', ')} di riwayat.`);
      await pool.end();
      return;
    }

    console.log(`Ditemukan ${kandidat.length} entri Berita Acara nomor ${NOMOR.join(', ')}:`);
    console.log('');

    const rencana = [];
    for (const r of kandidat) {
      const st = r.details.state;
      const namaLama = r.document_name;

      const judul = String(st.subjudul || '').trim();
      let namaBaru;
      if (judul) {
        namaBaru = `${st.nomorUrut}_${judul}`;
      } else {
        const pemeriksaan = sanitasiNamaDokumen(st.periksaPada);
        namaBaru = pemeriksaan ? `${st.nomorUrut}_${pemeriksaan}` : null;
      }

      if (!namaBaru) {
        console.log(`  [LEWATI] id=${r.id} (${r.created_at})`);
        console.log(`    nama saat ini : ${namaLama}`);
        console.log(`    subjudul & periksaPada kosong -> biarkan nama file mentah.`);
        console.log('');
        continue;
      }

      const berubah = namaBaru !== namaLama;
      console.log(`  [${berubah ? 'PERLU DIUBAH' : 'SUDAH BENAR'}] id=${r.id} (${r.created_at})`);
      console.log(`    nama lama : ${namaLama}`);
      console.log(`    nama baru : ${namaBaru}`);
      console.log('');
      if (berubah) rencana.push({ id: r.id, namaBaru });
    }

    if (!rencana.length) {
      console.log('Tidak ada yang perlu diubah.');
      await pool.end();
      return;
    }

    if (!apply) {
      console.log(`Dry-run selesai: ${rencana.length} entri akan diperbarui.`);
      console.log('Jalankan lagi dengan --apply untuk benar-benar menulis ke database.');
      await pool.end();
      return;
    }

    for (const item of rencana) {
      await pool.query(
        'UPDATE history SET document_name = $1 WHERE id = $2',
        [item.namaBaru, item.id]
      );
      console.log(`  Diperbarui id=${item.id} -> ${item.namaBaru}`);
    }
    console.log('');
    console.log(`Selesai: ${rencana.length} entri diperbarui.`);
    await pool.end();
  } catch (err) {
    console.error('Gagal:', err.message);
    await pool.end();
    process.exitCode = 1;
  }
})();
