// Rapikan titik sumur Teritip yang ditambahkan lewat halaman Peta IPA/Sumur
// (tabel peta_lokasi, 2026-10-07) supaya nyambung dengan daftar sumur yang
// dipakai mengisi data (tabel sumur_wells). Tiga hal yang dikerjakan:
//
//   1. ID titik dibuat 2 digit. Titiknya terlanjur tersimpan sebagai
//      'teritip_1', 'teritip_2', ... padahal penggabungan data debit / statis
//      / dinamis memakai wellIdFromName() (api/visualization/admin-library.js)
//      yang SELALU menghasilkan 2 digit ('teritip_01'). Selama id-nya tidak
//      2 digit, sumur itu tidak akan pernah dapat data di peta walau datanya
//      sudah diinput -- pencocokannya lewat id, bukan lewat nama. Nama
//      titiknya sekalian diseragamkan jadi "Sumur 01 — Teritip" seperti titik
//      lain. Yang sudah benar TIDAK disentuh.
//
//   2. Detail sumber (tabel sumber_sumur, PK sumur_id) yang terlanjur tersimpan
//      di bawah id LAMA ikut dipindah, supaya tidak menggantung dan tampak
//      hilang dari Daftar Sumber Air Baku.
//
//   3. Sumur baru didaftarkan ke sumur_wells kategori 'debit' -- aturannya
//      TIDAK ditulis ulang di sini, tapi dipakai dari lib/visualization/
//      sumur-well.js. Aturan yang disalin pasti menyimpang, dan salinan itulah
//      yang bikin masalah ini ada. Kategori 'level' (statis-dinamis) sengaja
//      TIDAK ikut, supaya jumlah sumur aktif di KPI 18.1a (ANGG) tidak berubah.
//
// Sejak server ikut merapikan id & mendaftarkan sumur saat titik disimpan
// (api/visualization/admin-library.js, handlePeta), skrip ini tidak perlu
// dijalankan rutin -- sekali ini saja, untuk data yang telanjur salah.
//
// AMAN: default cuma MENAMPILKAN apa yang akan diubah (dry-run). Untuk benar
// benar menulis ke database, jalankan dengan flag --apply. Semua perubahan
// ditulis dalam satu transaksi, jadi gagal di tengah = tidak ada yang berubah.
//
// Cara pakai (butuh DATABASE_URL sudah di-set di environment):
//   node scripts/perbaiki-sumur-teritip.js            # dry-run
//   node scripts/perbaiki-sumur-teritip.js --apply    # benar-benar perbarui

const { pool, ensureVizTables, ensurePetaTables, ensureSumberTables } = require('../lib/db');
const { nomorDariId, nomorDariWellName, namaKolomNetral, pastikanSumurTerdaftar } = require('../lib/visualization/sumur-well');

const INSTALLATION = 'teritip';
const LABEL = 'Teritip';

const args = process.argv.slice(2);
const apply = args.includes('--apply');

const pad2 = n => String(n).padStart(2, '0');

// Nama titik di peta, pola yang sama dengan titik-titik lain di lokasi.json.
function namaTitik(nomor) {
  return `Sumur ${pad2(nomor)} — ${LABEL}`;
}

(async () => {
  try {
    await ensureVizTables();
    await ensurePetaTables();
    await ensureSumberTables();

    // --- 1. Titik peta sumur yang id-nya belum 2 digit ----------------------
    const { rows: titik } = await pool.query(
      `SELECT lokasi_id, nama FROM peta_lokasi
       WHERE jenis = 'sumur' AND installation = $1 ORDER BY lokasi_id`,
      [INSTALLATION]
    );

    if (!titik.length) {
      console.log(`Tidak ada titik sumur ${LABEL} di peta_lokasi. Tidak ada yang dikerjakan.`);
      await pool.end();
      return;
    }

    const idTerpakai = new Set(titik.map(t => t.lokasi_id));
    const rename = [];
    const nomorDiPeta = new Set();

    titik.forEach(t => {
      const nomor = nomorDariId(t.lokasi_id);
      if (nomor === null) {
        console.log(`LEWAT  ${t.lokasi_id} -- tidak ada nomor di ujung id, periksa manual.`);
        return;
      }
      nomorDiPeta.add(nomor);

      const idBaru = `${INSTALLATION}_${pad2(nomor)}`;
      const namaBaru = namaTitik(nomor);
      if (t.lokasi_id === idBaru && t.nama === namaBaru) return;   // sudah rapi

      if (t.lokasi_id !== idBaru && idTerpakai.has(idBaru)) {
        console.log(`LEWAT  ${t.lokasi_id} -> ${idBaru} -- id tujuan sudah dipakai titik lain, periksa manual.`);
        return;
      }
      rename.push({ lama: t.lokasi_id, baru: idBaru, namaLama: t.nama, namaBaru });
    });

    // --- 2. Detail tersimpan di bawah id lama ------------------------------
    // Id titik peta dipakai juga sebagai sumur_id di sumber_sumur (lihat
    // komentar di lib/db.js), jadi baris detailnya ikut pindah.
    const { rows: detail } = await pool.query(
      `SELECT sumur_id FROM sumber_sumur WHERE installation = $1`,
      [INSTALLATION]
    );
    const detailPerluIkut = rename
      .map(r => detail.find(d => d.sumur_id === r.lama) ? { lama: r.lama, baru: r.baru, namaBaru: r.namaBaru } : null)
      .filter(Boolean);

    // --- 3. Sumur yang sudah terdaftar & yang perlu ditambah ---------------
    const { rows: wellRows } = await pool.query(
      `SELECT well_name, sort_order FROM sumur_wells
       WHERE installation = $1 AND category = 'debit'`,
      [INSTALLATION]
    );

    const nomorTerdaftar = new Map();   // nomor -> well_name
    wellRows.forEach(w => {
      const n = nomorDariWellName(w.well_name);
      if (n !== null && !nomorTerdaftar.has(n)) nomorTerdaftar.set(n, w.well_name);
    });

    const nomorBaru = Array.from(nomorDiPeta)
      .filter(n => !nomorTerdaftar.has(n))
      .sort((a, b) => a - b);

    // --- Rencana -----------------------------------------------------------
    console.log(`=== Titik peta (peta_lokasi) — ${titik.length} titik sumur ${LABEL} ===`);
    if (rename.length) {
      rename.forEach(r => console.log(`  id   ${r.lama.padEnd(14)} -> ${r.baru}`));
      rename.forEach(r => {
        if (r.namaLama !== r.namaBaru) console.log(`  nama ${r.namaLama.padEnd(14)} -> ${r.namaBaru}`);
      });
    } else {
      console.log('  Sudah rapi semua, tidak ada yang diubah.');
    }

    if (detailPerluIkut.length) {
      console.log('');
      console.log(`=== Detail tersimpan (sumber_sumur) — ${detailPerluIkut.length} baris ikut dipindah ===`);
      detailPerluIkut.forEach(d => console.log(`  sumur_id ${d.lama.padEnd(14)} -> ${d.baru}`));
    }

    console.log('');
    console.log(`=== Daftar sumur untuk input debit (sumur_wells) ===`);
    console.log(`  Terdaftar sekarang: ${nomorTerdaftar.size} sumur`);
    if (nomorBaru.length) {
      nomorBaru.forEach(n => console.log(`  TAMBAH  ${namaKolomNetral(INSTALLATION, n)}`));
      console.log(`  sort_order seluruh sumur ${LABEL} ikut diurutkan ulang menurut nomor,`);
      console.log('  supaya kolomnya terbaca 01..18 -- bukan sumur baru menempel di belakang.');
    } else {
      console.log('  Semua sumur sudah terdaftar, tidak ada yang ditambah.');
    }

    if (!rename.length && !nomorBaru.length && !detailPerluIkut.length) {
      console.log('');
      console.log('Tidak ada yang perlu dikerjakan. Database sudah rapi.');
      await pool.end();
      return;
    }

    if (!apply) {
      console.log('');
      console.log('Dry-run selesai -- belum ada yang ditulis. Jalankan lagi dengan --apply untuk menerapkan.');
      await pool.end();
      return;
    }

    // --- Tulis (satu transaksi) -------------------------------------------
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      for (const r of rename) {
        await client.query(
          `UPDATE peta_lokasi SET lokasi_id = $1, nama = $2, updated_at = now()
           WHERE jenis = 'sumur' AND lokasi_id = $3`,
          [r.baru, r.namaBaru, r.lama]
        );
      }

      for (const d of detailPerluIkut) {
        await client.query(
          `UPDATE sumber_sumur SET sumur_id = $1, nama = $2, updated_at = now()
           WHERE sumur_id = $3`,
          [d.baru, d.namaBaru, d.lama]
        );
      }

      // Aturan pendaftaran (cocokkan lewat NOMOR, tolak nama kolom yang tidak
      // berawalan Sumur_, urutkan sort_order) semuanya di modul bersama.
      let didaftarkan = 0;
      for (const n of nomorBaru) {
        const hasil = await pastikanSumurTerdaftar(client, INSTALLATION, { nomor: n });
        if (!hasil.ok) throw new Error(`Nomor ${pad2(n)}: ${hasil.error}`);
        if (hasil.dibuat) didaftarkan++;
      }

      await client.query('COMMIT');
      console.log('');
      console.log(`Selesai: ${rename.length} titik dirapikan, ${detailPerluIkut.length} detail dipindah, ${didaftarkan} sumur didaftarkan.`);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    await pool.end();
  } catch (err) {
    console.error('Gagal:', err.message);
    await pool.end();
    process.exitCode = 1;
  }
})();
