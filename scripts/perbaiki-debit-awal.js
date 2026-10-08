// Periksa & rapikan kolom Debit Awal di KPI 18.2 Ukur Debit (tabel
// kpi_debit_awal).
//
// Dugaan masalahnya: seed di lib/db.js:776 menulis nama sumur bergaya
// "SUMUR 01 DALAM IPA" (kapital, pakai spasi), sedangkan nama yang dipakai
// sumur_wells -- dan karenanya yang dipakai halaman KPI -- adalah
// "Sumur_01_Dalam_IPA" (kapital di awal kata, pakai garis bawah). Kuncinya
// adalah `installation + ' ' + well_name` (lihat loadDebitAwal di
// lib/visualization/kpi.js), jadi dua bentuk nama itu TIDAK pernah bertemu dan
// 19 nilai Debit Awal bawaan kemungkinan besar tidak pernah terpakai.
//
// TAPI ini belum dipastikan -- dan tidak bisa dipastikan dari kode saja. Kalau
// admin pernah mengisi Debit Awal lewat halaman KPI, nilainya tersimpan di
// baris LAIN dengan nama yang benar, dan baris seed tadi cuma jadi sampah yang
// tidak mengganggu. Skrip ini karena itu:
//   - mencocokkan tiap baris kpi_debit_awal ke sumur_wells lewat NOMOR sumur
//     (bukan lewat nama persis -- dua bentuk nama itu memang beda),
//   - melaporkan mana yang namanya perlu diperbaiki, mana yang cuma duplikat
//     sisa seed, mana yang tidak ketemu sumurnya, dan mana yang harus
//     diperiksa manual,
//   - dan PALING PENTING: tidak pernah menimpa nilai yang sudah diisi admin.
//     Kalau satu sumur punya lebih dari satu baris dan tidak ada yang namanya
//     sudah pas, skrip ini BERHENTI dan melaporkannya -- dua nilai yang
//     bersaing tidak boleh ditebak mana yang benar.
//
// AMAN: default cuma MENAMPILKAN temuan (dry-run). Untuk benar-benar menulis,
// jalankan dengan --apply. Jalankan dry-run DULU dan periksa keluarannya --
// nilai Debit Awal masuk ke laporan yang diserahkan, jadi jangan diubah
// berdasarkan dugaan.
//
// Cara pakai (butuh DATABASE_URL sudah di-set di environment):
//   node scripts/perbaiki-debit-awal.js            # periksa saja
//   node scripts/perbaiki-debit-awal.js --apply    # benar-benar perbarui

const { pool, ensureVizTables, ensureKpiTables } = require('../lib/db');

const args = process.argv.slice(2);
const apply = args.includes('--apply');

// Nomor sumur dari nama bergaya apa pun: "SUMUR 01 DALAM IPA" (format seed
// lama: kapital + spasi) maupun "Sumur_01_Dalam_IPA" (format sumur_wells:
// garis bawah). Dipakai HANYA di skrip sekali-jalan ini -- modul
// lib/visualization/sumur-well.js sengaja tetap ketat pada pola "Sumur_",
// karena di sana nama itu penentu, bukan bahan pencocokan sementara.
function nomorLonggar(nama) {
  const m = String(nama == null ? '' : nama).match(/sumur[\s_]*0*(\d+)/i);
  return m ? parseInt(m[1], 10) : null;
}

(async () => {
  try {
    await ensureVizTables();
    await ensureKpiTables();

    const { rows: awal } = await pool.query(
      `SELECT installation, well_name, debit_awal FROM kpi_debit_awal
       ORDER BY installation, well_name`
    );
    const { rows: wells } = await pool.query(
      `SELECT installation, well_name FROM sumur_wells
       WHERE category = 'debit' ORDER BY installation, well_name`
    );

    if (!awal.length) {
      console.log('kpi_debit_awal kosong -- belum ada Debit Awal sama sekali.');
      console.log('Kalau memang belum pernah diisi, isi lewat halaman KPI 18.2 (kolom Debit Awal).');
      await pool.end();
      return;
    }

    // Peta: "installation nomor" -> well_name yang SEBENARNYA dipakai halaman KPI.
    const wellPerNomor = new Map();
    wells.forEach(w => {
      const n = nomorLonggar(w.well_name);
      if (n !== null) wellPerNomor.set(w.installation + ' ' + n, w.well_name);
    });

    // Baris dikelompokkan per NAMA TUJUAN, bukan diperiksa satu-satu. Alasannya
    // penting: dua baris berbeda bisa memetakan ke nama tujuan yang SAMA (satu
    // baris seed, satu baris isian admin), dan kalau keduanya diperbaiki
    // sendiri-sendiri, yang satu menimpa/menyalahi kunci yang lain -- persis
    // "nilai admin ketimpa" yang skrip ini janji tidak dilakukan. Yang boleh
    // dilakukan cuma kalau salah satu baris di kelompok itu namanya SUDAH pas:
    // baris itu menang, sisanya duplikat. Kalau tidak ada yang pas, artinya ada
    // dua nilai yang bersaing dan tidak ada dasar untuk memilih -- dilaporkan,
    // tidak disentuh.
    const grup = new Map();   // "installation target" -> [baris]
    const yatim = [];         // nomornya tidak ada di sumur_wells

    awal.forEach(r => {
      const n = nomorLonggar(r.well_name);
      const target = n === null ? undefined : wellPerNomor.get(r.installation + ' ' + n);
      if (!target) { yatim.push(r); return; }
      const k = r.installation + ' ' + target;
      if (!grup.has(k)) grup.set(k, []);
      grup.get(k).push(Object.assign({}, r, { target }));
    });

    const sudahBenar = [];
    const perluGanti = [];
    const duplikat = [];
    const ambigu = [];

    grup.forEach(baris => {
      const pas = baris.find(r => r.well_name === r.target);
      if (pas) {
        sudahBenar.push(pas);
        baris.filter(r => r !== pas).forEach(r => duplikat.push(r));
      } else if (baris.length === 1) {
        perluGanti.push(baris[0]);
      } else {
        baris.forEach(r => ambigu.push(r));
      }
    });

    // --- Laporan -----------------------------------------------------------
    console.log(`kpi_debit_awal: ${awal.length} baris | sumur_wells (debit): ${wells.length} sumur`);
    console.log('');
    console.log(`  Nama sudah cocok           : ${sudahBenar.length}`);
    console.log(`  Nama perlu diperbaiki      : ${perluGanti.length}`);
    console.log(`  Duplikat (sudah ada yg bnr): ${duplikat.length}`);
    console.log(`  Perlu diperiksa manual     : ${ambigu.length}`);
    console.log(`  Tidak ketemu sumurnya      : ${yatim.length}`);

    const tampilkan = (judul, daftar, keterangan) => {
      if (!daftar.length) return;
      console.log('');
      console.log(`=== ${judul} ===`);
      daftar.forEach(r => console.log(
        `  ${r.installation.padEnd(18)} ${String(r.debit_awal).padStart(6)}  "${r.well_name}"`
        + (r.target ? `  ->  "${r.target}"` : '')
      ));
      if (keterangan) console.log('  ' + keterangan);
    };

    tampilkan('Nama sudah cocok (tidak disentuh)', sudahBenar);
    tampilkan('Perlu diperbaiki', perluGanti,
      'Nilainya DIPERTAHANKAN, cuma namanya disamakan supaya terbaca halaman KPI.');
    tampilkan('Duplikat', duplikat,
      'Baris dengan nama yang benar SUDAH ada, jadi baris ini cuma sisa seed -- akan dihapus.');
    tampilkan('Perlu diperiksa manual', ambigu,
      'Dua baris atau lebih menunjuk sumur yang sama dan TIDAK ada yang namanya sudah pas,');
    tampilkan('Nama yang tidak ketemu sumurnya', yatim,
      'Sumurnya tidak ada di sumur_wells. TIDAK disentuh -- periksa manual, mungkin sumurnya memang sudah tidak dipakai.');

    if (ambigu.length) {
      console.log('');
      console.log('  Golongan "Perlu diperiksa manual" TIDAK disentuh skrip ini. Kemungkinan besar itu');
      console.log('  nilai isian admin dan nilai seed yang sama-sama belum pakai nama kanonik -- pilih');
      console.log('  sendiri mana yang benar, lalu samakan namanya dengan nama di kolom paling kanan.');
    }

    console.log('');
    if (duplikat.length) {
      console.log('CATATAN: yang dihapus di golongan "Duplikat" hanya baris yang namanya TIDAK cocok,');
      console.log('dan nilainya sama sekali tidak dipakai halaman KPI (kuncinya beda). Nilai yang');
      console.log('benar ada di baris pasangannya, dan baris itu tidak disentuh.');
    }
    console.log('Nilai Debit Awal yang sudah benar TIDAK PERNAH ditimpa skrip ini.');

    if (!perluGanti.length && !duplikat.length) {
      console.log('');
      console.log('Tidak ada yang perlu diubah.');
      await pool.end();
      return;
    }

    if (!apply) {
      console.log('');
      console.log('Dry-run selesai -- belum ada yang ditulis. Periksa daftar di atas dulu,');
      console.log('baru jalankan lagi dengan --apply.');
      await pool.end();
      return;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      for (const r of perluGanti) {
        await client.query(
          `UPDATE kpi_debit_awal SET well_name = $1, updated_at = now()
           WHERE installation = $2 AND well_name = $3`,
          [r.target, r.installation, r.well_name]
        );
      }

      for (const r of duplikat) {
        await client.query(
          `DELETE FROM kpi_debit_awal WHERE installation = $1 AND well_name = $2`,
          [r.installation, r.well_name]
        );
      }

      await client.query('COMMIT');
      console.log('');
      console.log(`Selesai: ${perluGanti.length} nama diperbaiki, ${duplikat.length} baris duplikat dihapus.`);
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
