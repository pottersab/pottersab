// Impor satu kali: 1.066 baris rekap pekerjaan Sub Divisi Sumber Air Baku
// (2014-2026) ke tabel `pekerjaan`.
//
// Sumber datanya adalah rekap yang sudah diolah dari berkas Word riwayat
// pekerjaan seluruh IPA + rekap berita acara pipa transmisi.
//
// PENTING: berkas JSON-nya sengaja disimpan DI LUAR folder project ini.
// Vercel menyajikan seluruh isi repo sebagai file statis, jadi kalau datanya
// ditaruh di dalam repo (mis. scripts/data/), siapa pun bisa mengunduh seluruh
// rekap asli lewat URL biasa tanpa perlu login -- membatalkan seluruh gerbang
// akses di api/pekerjaan.js. Lokasi defaultnya: ../data-impor/ (sejajar
// dengan folder project, bukan di dalamnya).
//
// Cara pakai (dari root project ini):
//   DATABASE_URL="postgres://...." node scripts/migrate-pekerjaan-historis.js
//
// Di PowerShell:
//   $env:DATABASE_URL="postgres://...."; node scripts/migrate-pekerjaan-historis.js
//
// Kalau berkasnya ditaruh di tempat lain, sebutkan path-nya sebagai argumen:
//   node scripts/migrate-pekerjaan-historis.js "D:/arsip/pekerjaan.json"
//
// Aman dijalankan berkali-kali: baris dengan sumber 'impor-historis' dihapus
// dulu sebelum diisi ulang, jadi tidak pernah dobel. Pekerjaan yang masuk
// lewat Formulir SAB / Berita Acara (sumber lain) tidak ikut tersentuh.

const fs = require('fs');
const path = require('path');
const { pool, ensurePekerjaanTable } = require('../lib/db');

const SUMBER = 'impor-historis';
const DATA_PATH = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(__dirname, '..', '..', 'data-impor', 'pekerjaan-historis.json');

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL belum di-set.');
    process.exit(1);
  }

  if (!fs.existsSync(DATA_PATH)) {
    console.error(`Berkas data tidak ditemukan: ${DATA_PATH}`);
    console.error('Sebutkan path-nya sebagai argumen kalau disimpan di tempat lain.');
    process.exit(1);
  }

  const rows = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  console.log(`Membaca ${rows.length} baris dari ${DATA_PATH}`);

  await ensurePekerjaanTable();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rowCount: dihapus } = await client.query(
      'DELETE FROM pekerjaan WHERE sumber = $1', [SUMBER]
    );
    if (dihapus) console.log(`Menghapus ${dihapus} baris impor sebelumnya.`);

    for (const r of rows) {
      await client.query(
        `INSERT INTO pekerjaan
           (tanggal, no_ba, bidang, jenis, instalasi, instalasi_asli, lokasi_teks,
            material, diameter_nilai, diameter_satuan, uraian, keterangan,
            status, sumber, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'final',$13,'impor')`,
        [r.tanggal, r.no_ba, r.bidang, r.jenis, r.instalasi, r.instalasi_asli,
         r.lokasi_teks, r.material, r.diameter_nilai, r.diameter_satuan,
         r.uraian, r.keterangan, SUMBER]
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  const { rows: ringkas } = await pool.query(
    `SELECT bidang, COUNT(*)::int AS n, MIN(tanggal)::text AS dari, MAX(tanggal)::text AS sampai
     FROM pekerjaan WHERE sumber = $1 GROUP BY bidang ORDER BY n DESC`, [SUMBER]
  );
  console.log('\nSelesai:');
  ringkas.forEach(r => console.log(`  ${r.bidang.padEnd(14)} ${String(r.n).padStart(5)} baris  ${r.dari} .. ${r.sampai}`));
  const total = ringkas.reduce((a, r) => a + r.n, 0);
  console.log(`  ${'TOTAL'.padEnd(14)} ${String(total).padStart(5)} baris`);

  await pool.end();
}

main().catch(err => { console.error(err); process.exit(1); });
