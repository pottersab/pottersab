// Perbaiki nomor BA pekerjaan terakhir di Riwayat Pekerjaan SAB (tabel
// `pekerjaan`). Kasusnya: pekerjaan terakhir (status final, id terbesar)
// terlanjur bernomor BA 45 padahal harusnya 46 -- lihat commit
// "Formulir SAB: ...". Nomor 46 tidak pernah ditulis ke database, jadi cukup
// perbaiki datanya; logika usulan nomor (api/pekerjaan.js) tidak disentuh.
//
// AMAN: default cuma MENAMPILKAN apa yang akan diubah (dry-run). Untuk benar
// benar menulis ke database, jalankan dengan flag --apply.
//
// Cara pakai (butuh DATABASE_URL sudah di-set di environment):
//   node scripts/fix-no-ba-terakhir.js               # dry-run
//   node scripts/fix-no-ba-terakhir.js --apply       # benar-benar perbarui
//   node scripts/fix-no-ba-terakhir.js 47 --apply    # ganti ke nomor lain
//
// Flag --apply WAJIB untuk menulis; tanpa flag hanya menampilkan rencana.

const { pool, ensurePekerjaanTable } = require('../lib/db');

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const nomorBaru = Number(args.find(a => /^\d+$/.test(a))) || 46;

(async () => {
  try {
    await ensurePekerjaanTable();

    // Pekerjaan terakhir: status final, belum dihapus, id terbesar.
    const { rows } = await pool.query(
      `SELECT id, no_ba, to_char(tanggal, 'YYYY-MM-DD') AS tanggal, uraian
       FROM pekerjaan
       WHERE deleted_at IS NULL AND status = 'final'
       ORDER BY id DESC LIMIT 1`
    );
    if (!rows[0]) {
      console.log('Tidak ada pekerjaan berstatus final di database.');
      await pool.end();
      return;
    }

    const r = rows[0];
    const lama = r.no_ba;
    const cocok = lama && lama.match(/^\s*([0-9]+)/);
    if (!cocok) {
      console.log(`Pekerjaan terakhir (id=${r.id}) tidak punya nomor BA diawali angka:`);
      console.log(`  no_ba = ${lama}`);
      await pool.end();
      return;
    }

    const nomorLama = Number(cocok[1]);
    if (nomorLama === nomorBaru) {
      console.log(`Nomor BA pekerjaan terakhir (id=${r.id}) sudah ${nomorBaru}. Tidak ada yang diubah.`);
      await pool.end();
      return;
    }

    const baru = lama.replace(/^\s*[0-9]+/, String(nomorBaru));
    console.log(`Pekerjaan terakhir: id=${r.id}, tanggal=${r.tanggal}`);
    console.log(`  no_ba lama : ${lama}`);
    console.log(`  no_ba baru : ${baru}`);
    console.log('');

    // Cek apakah nomor baru sudah dipakai pekerjaan lain yang masih tampil.
    const { rows: duplikat } = await pool.query(
      `SELECT id, no_ba, to_char(tanggal, 'YYYY-MM-DD') AS tanggal
       FROM pekerjaan
       WHERE deleted_at IS NULL AND no_ba ~ '^\\s*[0-9]+'
         AND (regexp_match(no_ba, '^\\s*([0-9]+)'))[1]::int = $1
         AND id <> $2`,
      [nomorBaru, r.id]
    );
    if (duplikat.length) {
      console.log(`PERHATIAN: nomor ${nomorBaru} sudah dipakai pekerjaan lain:`);
      duplikat.forEach(d => console.log(`  id=${d.id} tanggal=${d.tanggal} no_ba=${d.no_ba}`));
      console.log('Periksa dulu sebelum --apply.');
    } else {
      console.log(`Nomor ${nomorBaru} belum dipakai pekerjaan lain. Aman.`);
    }

    if (!apply) {
      console.log('');
      console.log('Dry-run selesai. Jalankan lagi dengan --apply untuk benar-benar menulis ke database.');
      await pool.end();
      return;
    }

    await pool.query('UPDATE pekerjaan SET no_ba = $1, updated_at = now() WHERE id = $2', [baru, r.id]);
    console.log(`Diperbarui id=${r.id} -> ${baru}`);
    await pool.end();
  } catch (err) {
    console.error('Gagal:', err.message);
    await pool.end();
    process.exitCode = 1;
  }
})();
