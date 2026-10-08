// ===========================================================================
// Aturan penamaan & pendaftaran sumur dalam -- SATU tempat.
// ---------------------------------------------------------------------------
// Kenapa dipisah jadi modul: aturan "sumur baru harus ikut terdaftar di
// sumur_wells" dipakai di beberapa jalur (simpan titik peta, skrip perbaikan),
// dan begitu aturannya disalin, salinannya pasti menyimpang. Yang pernah
// terjadi (2026-10-07, 9 sumur Teritip baru): titik ditambahkan di peta tapi
// tidak pernah terdaftar sebagai sumur yang bisa diisi data, dan id-nya
// tersimpan tanpa nol di depan ('teritip_1') padahal penggabungan data
// memakai wellIdFromName() yang SELALU menghasilkan 2 digit ('teritip_01') --
// jadi datanya tidak akan pernah menempel ke titik di peta.
//
// Semua fungsi yang MENULIS ke database menerima parameter query `q`
// (boleh `pool`, boleh `client`) dan tidak pernah memanggil pool.query
// sendiri. Itu yang membuat modul ini bisa dipakai di dalam transaksi
// pemanggil -- penting, karena pendaftaran sumur harus ikut batal kalau
// penyimpanan titiknya gagal.
// ===========================================================================

const pad2 = n => String(n).padStart(2, '0');

// Nomor di ujung id titik peta: "teritip_07" -> 7. null kalau id-nya tidak
// berpola nomor (bukan error -- pemanggil yang memutuskan itu masalah atau bukan).
function nomorDariId(id) {
  const m = String(id == null ? '' : id).match(/_(\d+)$/);
  return m ? parseInt(m[1], 10) : null;
}

// Instalasi dari id sumur: "gunung_sari_01" -> "gunung_sari".
// Pakai regex, BUKAN potong berdasarkan panjang angka: "teritip_007" harus
// jadi "teritip", dan cara potong gampang salah di kasus nol berlebih itu.
function installationDariId(id) {
  return String(id == null ? '' : id).replace(/_\d+$/, '');
}

// Nomor dari nama kolom di sumur_wells: "Sumur_04_Dalam_IPA" -> 4.
// Sengaja lebih longgar dari wellIdFromName() di api/visualization/
// admin-library.js (yang menuntut pemisah "_" setelah angkanya): di sini yang
// dibutuhkan cuma NOMORNYA, untuk mendeteksi "nomor ini sudah terdaftar".
function nomorDariWellName(nama) {
  const m = String(nama == null ? '' : nama).match(/^Sumur_?0*(\d+)/i);
  return m ? parseInt(m[1], 10) : null;
}

// "kampung_baru_ulu" -> "Kampung_Baru_Ulu" (dipakai menyusun nama kolom).
function labelInstalasi(installation) {
  return String(installation || '').split('_').filter(Boolean)
    .map(k => k.charAt(0).toUpperCase() + k.slice(1))
    .join('_');
}

// Nama kolom bawaan untuk sumur yang belum punya keterangan lokasi pompa:
// "Sumur_07_Teritip". Sumur lama berakhiran lokasi pompa ("Sumur_04_Dalam_IPA"),
// dan itu memang belum tentu diketahui saat menambah titik di lapangan --
// admin boleh menggantinya lewat field "Nama kolom data" di halaman peta.
function namaKolomNetral(installation, nomor) {
  return `Sumur_${pad2(nomor)}_${labelInstalasi(installation)}`;
}

// Rapikan id sumur jadi bentuk kanonik "{installation}_{NN}".
// Dipakai SERVER, bukan cuma klien: halaman peta menyarankan id yang sudah
// rapi, tapi field-nya bisa diketik bebas, dan yang tersimpan apa adanya
// adalah yang bikin bug.
function normalisasiIdSumur(idMentah, installation) {
  const bersih = String(idMentah == null ? '' : idMentah).trim().toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');

  if (!bersih) return { ok: false, error: 'ID sumur wajib diisi.' };

  const nomor = nomorDariId(bersih);
  if (nomor === null) {
    return { ok: false, error: 'ID sumur harus diakhiri nomor, mis. teritip_01.' };
  }
  if (nomor < 1) {
    return { ok: false, error: 'Nomor sumur minimal 1.' };
  }

  // Prefix WAJIB sama dengan instalasi induknya: id inilah yang mengikat sumur
  // ke instalasinya (lihat wellIdFromName), jadi id berprefix lain akan
  // menempatkan sumur di instalasi yang salah.
  if (installationDariId(bersih) !== installation) {
    return {
      ok: false,
      error: `ID "${bersih}" tidak cocok dengan instalasi yang dipilih. ID sumur harus berawalan "${installation}_".`
    };
  }

  const id = `${installation}_${pad2(nomor)}`;
  return { ok: true, id, nomor, berubah: id !== bersih, error: null };
}

// Pastikan sumur terdaftar di sumur_wells kategori 'debit' saja -- kategori
// 'level' SENGAJA tidak ikut. Kalau sumur baru ikut didaftarkan di sana, jumlah
// sumur AKTIF yang dipakai KPI 18.1a (ANGG) ikut berubah, dan itu angka laporan
// yang sudah disetujui.
//
// Pencocokan "sudah terdaftar" memakai NOMOR, bukan nama persis: sumur lama
// bernama "Sumur_04_Dalam_IPA", sumur baru "Sumur_01_Teritip" -- dua-duanya
// sumur nomor 4 dan 1. Kalau dicocokkan lewat nama, sumur yang sama bisa
// terdaftar dua kali sebagai dua kolom.
async function pastikanSumurTerdaftar(q, installation, opsi) {
  const nomor = Number(opsi && opsi.nomor);
  if (!Number.isInteger(nomor) || nomor < 1) {
    return { ok: false, error: 'Nomor sumur tidak valid.' };
  }

  const { rows } = await q.query(
    `SELECT well_name, sort_order FROM sumur_wells
     WHERE installation = $1 AND category = 'debit'`,
    [installation]
  );

  const nomorKeNama = new Map();
  rows.forEach(r => {
    const n = nomorDariWellName(r.well_name);
    if (n !== null && !nomorKeNama.has(n)) nomorKeNama.set(n, r.well_name);
  });

  let wellName = nomorKeNama.get(nomor) || null;
  let dibuat = false;

  if (!wellName) {
    const usul = String((opsi && opsi.namaKolom) || '').trim();

    if (usul) {
      // Nama dari admin harus cocok pola "Sumur_<nomor>_..." -- kalau tidak,
      // wellIdFromName() tidak mengenalinya dan datanya balik tidak menempel
      // ke titik peta. Ditolak, bukan dibiarkan: diam-diam salah lebih mahal
      // daripada pesan error.
      if (nomorDariWellName(usul) !== nomor) {
        return {
          ok: false,
          error: `Nama kolom "${usul}" harus diawali Sumur_${pad2(nomor)}_ (mis. ${namaKolomNetral(installation, nomor)}).`
        };
      }
      // Cek tabrakan nama SEBELUM insert: tanpa ini, ON CONFLICT DO NOTHING
      // gagal senyap dan sumurnya tetap tidak dapat data.
      if (rows.some(r => r.well_name === usul)) {
        return { ok: false, error: `Nama kolom "${usul}" sudah dipakai sumur lain di instalasi ini.` };
      }
      wellName = usul;
    } else {
      wellName = namaKolomNetral(installation, nomor);
    }
    dibuat = true;
  }

  // Urutkan ulang sort_order seluruh sumur instalasi ini MENURUT NOMOR, supaya
  // sumur yang baru disisipkan di tengah (mis. Sumur 05 di antara 03 dan 08)
  // tampil di posisi yang benar, bukan menempel di belakang.
  const urutan = new Map();
  [...nomorKeNama.keys(), nomor].sort((a, b) => a - b)
    .forEach((n, i) => urutan.set(nomorKeNama.get(n) || wellName, i));

  // Cuma baris yang benar-benar BERUBAH yang di-UPDATE. Instalasi yang nomornya
  // sudah rapat (mis. Gunung Sari 01-08) menghasilkan nol UPDATE -- penting
  // karena urutan kolom dipakai memetakan label di KPI 18.2, dan menulis ulang
  // sort_order tanpa alasan cuma menambah risiko.
  const perluUrut = rows
    .map(r => ({ nama: r.well_name, urut: urutan.get(r.well_name) }))
    .filter(x => x.urut !== undefined && x.urut !== x.sort_order);

  if (dibuat) {
    await q.query(
      `INSERT INTO sumur_wells (installation, category, well_name, sort_order, active)
       VALUES ($1, 'debit', $2, $3, TRUE)
       ON CONFLICT (installation, category, well_name) DO NOTHING`,
      [installation, wellName, urutan.get(wellName)]
    );
  }

  for (const x of perluUrut) {
    await q.query(
      `UPDATE sumur_wells SET sort_order = $1
       WHERE installation = $2 AND category = 'debit' AND well_name = $3`,
      [x.urut, installation, x.nama]
    );
  }

  return { ok: true, wellName, dibuat, error: null };
}

module.exports = {
  nomorDariId,
  installationDariId,
  nomorDariWellName,
  labelInstalasi,
  namaKolomNetral,
  normalisasiIdSumur,
  pastikanSumurTerdaftar
};
