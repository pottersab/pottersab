// Samakan titik sumur di peta dengan daftar sumur yang dipakai mengisi data.
//
// Halaman peta menyimpan titiknya di tabel peta_lokasi, sedangkan kolom di
// halaman input data ditentukan tabel sumur_wells. Sejak
// api/visualization/admin-library.js (handlePeta) ikut merapikan id &
// mendaftarkan sumurnya, dua tabel itu tidak bisa lagi lepas sendiri-sendiri --
// TAPI titik yang sudah telanjur salah tidak ikut sembuh, dan itu yang
// dibereskan skrip ini. Untuk tiap instalasi yang punya titik sumur:
//
//   1. ID titik dibuat 2 digit ("teritip_1" -> "teritip_01"). Penggabungan
//      data debit/statis/dinamis memakai wellIdFromName() yang SELALU 2 digit,
//      jadi selama id-nya tidak 2 digit sumur itu tidak akan pernah dapat data
//      di peta walau datanya sudah diinput. Nama titiknya ikut diseragamkan
//      jadi "Sumur NN — <Instalasi>", TAPI HANYA untuk baris yang id-nya juga
//      dirapikan -- baris yang id-nya sudah benar tidak disentuh, supaya nama
//      yang ditulis admin dengan sengaja tidak tertimpa.
//
//   2. Detail sumber (tabel sumber_sumur, PK sumur_id) yang tersimpan di bawah
//      id LAMA ikut dipindah -- id titik peta dipakai juga sebagai sumur_id
//      (lihat lib/db.js), jadi kalau tidak dipindah detailnya menggantung dan
//      tampak hilang dari Daftar Sumber Air Baku.
//
//   3. Sumur yang belum terdaftar didaftarkan ke sumur_wells kategori 'debit'
//      -- aturannya TIDAK ditulis ulang di sini, tapi dipakai dari
//      lib/visualization/sumur-well.js. Aturan yang disalin pasti menyimpang,
//      dan salinan itulah yang bikin masalah ini ada. Kategori 'level'
//      (statis-dinamis) sengaja TIDAK ikut, supaya jumlah sumur aktif di
//      KPI 18.1a (ANGG) tidak berubah.
//
// AMAN: default cuma MENAMPILKAN apa yang akan diubah (dry-run). Untuk benar
// benar menulis, jalankan dengan flag --apply. Semua perubahan ditulis dalam
// satu transaksi, jadi gagal di tengah = tidak ada yang berubah.
//
// Cara pakai (butuh DATABASE_URL sudah di-set di environment):
//   node scripts/sinkron-sumur.js                # periksa semua instalasi
//   node scripts/sinkron-sumur.js teritip        # batasi 1 instalasi
//   node scripts/sinkron-sumur.js --apply        # benar-benar perbarui

const { pool, ensureVizTables, ensurePetaTables, ensureSumberTables } = require('../lib/db');
const { nomorDariId, nomorDariWellName, installationDariId, labelInstalasi, namaKolomNetral, pastikanSumurTerdaftar } = require('../lib/visualization/sumur-well');

const args = process.argv.slice(2);
const apply = args.includes('--apply');
// Argumen bebas (bukan flag) = batasi ke satu instalasi. Berguna kalau habis
// menambah sumur di satu IPA saja dan tidak mau memeriksa yang lain.
const hanya = args.find(a => !a.startsWith('--')) || null;

const pad2 = n => String(n).padStart(2, '0');

// Nama titik pakai SPASI ("Sumur 02 — Gunung Tembak"), nama kolom pakai garis
// bawah ("Sumur_02_Gunung_Tembak") -- pola yang sudah dipakai data/lokasi.json.
function namaTitik(installation, nomor) {
  return `Sumur ${pad2(nomor)} — ${labelInstalasi(installation).replace(/_/g, ' ')}`;
}

// Nama titik itu cuma tampilan -- yang menentukan data adalah id. Jadi nama
// hanya dirapikan otomatis kalau bedanya SEKADAR tanda baca atau huruf besar
// kecil ("Sumur 11 - Teritip" vs "Sumur 11 — Teritip"), yang jelas bukan
// pilihan sadar. Begitu ada kata tambahan ("Sumur 04 — Teritip (rusak)"),
// artinya admin menulis sesuatu yang disengaja, dan itu hanya dilaporkan --
// menimpanya sama dengan menghapus keterangan.
function samaSetelahDinormalkan(a, b) {
  const n = s => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return n(a) === n(b);
}

(async () => {
  try {
    await ensureVizTables();
    await ensurePetaTables();
    await ensureSumberTables();

    const { rows: semuaTitik } = await pool.query(
      `SELECT lokasi_id, nama, installation FROM peta_lokasi WHERE jenis = 'sumur'`
    );

    if (!semuaTitik.length) {
      console.log('Tidak ada titik sumur di peta_lokasi. Tidak ada yang dikerjakan.');
      await pool.end();
      return;
    }

    // Dikelompokkan menurut PREFIX ID, bukan kolom installation: id-nya yang
    // mengikat sumur (wellIdFromName memakai "{installation}_{NN}"), dan
    // data/lokasi.json pun begitu.
    const perInstalasi = new Map();
    const instalasiBeda = [];    // installation tidak cocok dengan prefix id-nya

    semuaTitik.forEach(t => {
      const dariId = installationDariId(t.lokasi_id);
      if (t.installation !== dariId) {
        instalasiBeda.push({ id: t.lokasi_id, tersimpan: t.installation, sebenarnya: dariId });
      }
      if (!perInstalasi.has(dariId)) perInstalasi.set(dariId, []);
      perInstalasi.get(dariId).push(t);
    });

    const { rows: semuaWell } = await pool.query(
      `SELECT installation, well_name FROM sumur_wells WHERE category = 'debit'`
    );
    const { rows: semuaDetail } = await pool.query(`SELECT sumur_id FROM sumber_sumur`);

    // --- Susun rencana per instalasi --------------------------------------
    const rencana = [];

    [...perInstalasi.keys()].sort().forEach(installation => {
      if (hanya && installation !== hanya) return;

      const titik = perInstalasi.get(installation).slice().sort(
        (a, b) => (nomorDariId(a.lokasi_id) || 0) - (nomorDariId(b.lokasi_id) || 0)
      );

      const idTerpakai = new Set(titik.map(t => t.lokasi_id));
      const rename = [];
      const namaRapi = [];       // id sudah benar, cuma nama yang beda tanda baca
      const nomorDiPeta = new Set();
      const perluDilihat = [];

      titik.forEach(t => {
        const nomor = nomorDariId(t.lokasi_id);
        if (nomor === null) {
          perluDilihat.push({ id: t.lokasi_id, nama: t.nama, alasan: 'tidak ada nomor di ujung id' });
          return;
        }
        nomorDiPeta.add(nomor);

        const idBaru = `${installation}_${pad2(nomor)}`;
        const namaBaru = namaTitik(installation, nomor);

        if (t.lokasi_id !== idBaru) {
          if (idTerpakai.has(idBaru)) {
            perluDilihat.push({ id: t.lokasi_id, nama: t.nama, alasan: `id tujuan ${idBaru} sudah dipakai titik lain` });
            return;
          }
          rename.push({ lama: t.lokasi_id, baru: idBaru, namaBaru });
          return;
        }

        // Id sudah rapi: tidak dipindah. Namanya dirapikan HANYA kalau bedanya
        // sekadar tanda baca; sisanya dilaporkan (lihat samaSetelahDinormalkan).
        if (t.nama !== namaBaru) {
          if (samaSetelahDinormalkan(t.nama, namaBaru)) {
            namaRapi.push({ id: t.lokasi_id, lama: t.nama, baru: namaBaru });
          } else {
            perluDilihat.push({ id: t.lokasi_id, nama: t.nama, alasan: `pola namanya beda (mestinya "${namaBaru}")` });
          }
        }
      });

      const detailIkut = rename
        .map(r => (semuaDetail.some(d => d.sumur_id === r.lama) ? { lama: r.lama, baru: r.baru, namaBaru: r.namaBaru } : null))
        .filter(Boolean);

      const nomorTerdaftar = new Set();
      semuaWell.filter(w => w.installation === installation).forEach(w => {
        const n = nomorDariWellName(w.well_name);
        if (n !== null) nomorTerdaftar.add(n);
      });

      const nomorBaru = Array.from(nomorDiPeta).filter(n => !nomorTerdaftar.has(n)).sort((a, b) => a - b);

      rencana.push({
        installation, titik: titik.length, rename, namaRapi, detailIkut, nomorBaru, perluDilihat,
        jumlahTerdaftar: nomorTerdaftar.size
      });
    });

    if (!rencana.length) {
      console.log(hanya ? `Tidak ada titik sumur untuk instalasi "${hanya}".` : 'Tidak ada yang dikerjakan.');
      await pool.end();
      return;
    }

    // --- Laporan ----------------------------------------------------------
    let adaKerja = false;

    rencana.forEach(pl => {
      const perlu = pl.rename.length || pl.namaRapi.length || pl.detailIkut.length || pl.nomorBaru.length;
      if (perlu) adaKerja = true;

      console.log(`=== ${pl.installation} — ${pl.titik} titik di peta, ${pl.jumlahTerdaftar} sumur terdaftar ===`);
      pl.rename.forEach(r => console.log(`  id     ${r.lama.padEnd(18)} -> ${r.baru}`));
      pl.namaRapi.forEach(x => console.log(`  nama   ${x.id.padEnd(18)} "${x.lama}" -> "${x.baru}"`));
      pl.detailIkut.forEach(d => console.log(`  detail ${d.lama.padEnd(18)} -> ${d.baru}`));
      pl.nomorBaru.forEach(n => console.log(`  TAMBAH ${namaKolomNetral(pl.installation, n)}`));
      pl.perluDilihat.forEach(x => console.log(`  LIHAT  ${x.id.padEnd(18)} "${x.nama}" — ${x.alasan}`));
      if (!perlu && !pl.perluDilihat.length) console.log('  Sudah sinkron, tidak ada yang diubah.');
      console.log('');
    });

    if (instalasiBeda.length) {
      console.log('=== Titik yang installation-nya tidak cocok dengan prefix id ===');
      instalasiBeda.forEach(x => console.log(
        `  ${x.id.padEnd(18)} tersimpan "${x.tersimpan}" -- padahal id-nya menunjuk "${x.sebenarnya}"`
      ));
      console.log('  TIDAK disentuh skrip ini: arah perbaikannya bisa dua-duanya benar (id-nya yang');
      console.log('  salah, atau instalasinya yang salah). Periksa manual dulu.');
      console.log('');
    }

    if (!adaKerja) {
      console.log('Tidak ada yang perlu ditulis. Baris "LIHAT" di atas cuma pemberitahuan.');
      await pool.end();
      return;
    }

    if (!apply) {
      console.log('Dry-run selesai -- belum ada yang ditulis. Jalankan lagi dengan --apply untuk menerapkan.');
      await pool.end();
      return;
    }

    // --- Tulis (satu transaksi) -------------------------------------------
    const client = await pool.connect();
    let nRename = 0, nNama = 0, nDetail = 0, nTambah = 0;
    try {
      await client.query('BEGIN');

      for (const pl of rencana) {
        for (const r of pl.rename) {
          await client.query(
            `UPDATE peta_lokasi SET lokasi_id = $1, nama = $2, updated_at = now()
             WHERE jenis = 'sumur' AND lokasi_id = $3`,
            [r.baru, r.namaBaru, r.lama]
          );
        }

        for (const x of pl.namaRapi) {
          await client.query(
            `UPDATE peta_lokasi SET nama = $1, updated_at = now()
             WHERE jenis = 'sumur' AND lokasi_id = $2`,
            [x.baru, x.id]
          );
        }

        for (const d of pl.detailIkut) {
          await client.query(
            `UPDATE sumber_sumur SET sumur_id = $1, updated_at = now() WHERE sumur_id = $2`,
            [d.baru, d.lama]
          );
        }

        // Aturan pendaftaran (cocokkan lewat NOMOR, tolak nama kolom yang tidak
        // berawalan Sumur_, urutkan sort_order) semuanya di modul bersama.
        for (const n of pl.nomorBaru) {
          const hasil = await pastikanSumurTerdaftar(client, pl.installation, { nomor: n });
          if (!hasil.ok) throw new Error(`${pl.installation} nomor ${pad2(n)}: ${hasil.error}`);
          if (hasil.dibuat) nTambah++;
        }

        nRename += pl.rename.length;
        nNama += pl.namaRapi.length;
        nDetail += pl.detailIkut.length;
      }

      await client.query('COMMIT');
      console.log(`Selesai: ${nRename} id dirapikan, ${nNama} nama diseragamkan, ${nDetail} detail dipindah, ${nTambah} sumur didaftarkan.`);
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
