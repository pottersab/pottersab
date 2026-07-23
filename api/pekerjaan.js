const jwt = require('jsonwebtoken');
const { pool, ensurePekerjaanTable } = require('../lib/db');
const { SECRET_KEY } = require('../lib/auth');
const { checkVizAccess } = require('../lib/visualization/viz-auth');

// Endpoint tunggal untuk apps/riwayat-pekerjaan. Semua mode digabung di satu
// file supaya jumlah Serverless Function tetap di bawah batas 12 Vercel Hobby
// -- pola yang sama dipakai api/history.js dan api/visualization/admin-library.js.
//
//   GET  /api/pekerjaan             -> { locked, rows } (dummy kalau tanpa akses)
//   GET  /api/pekerjaan?export=csv  -> unduh CSV (admin saja)
//   GET  /api/pekerjaan?draft=1     -> { count, rows } laporan lapangan yang
//                                      belum dibuatkan berita acara (admin)
//   POST /api/pekerjaan             -> simpan laporan Formulir SAB sebagai
//                                      draft (admin)
//
// Tiga tingkat akses, persis mekanisme yang sudah dipakai halaman data lain:
//   publik        -> locked:true, yang dikirim data CONTOH
//   viewer        -> token viz-access hasil approve email -> data asli
//   admin         -> JWT login.html -> data asli + tombol unduh CSV

// Kolom yang dikirim ke halaman. kontraktor, barang, dan foto sengaja TIDAK
// ikut: halaman riwayat tidak memakainya, dan tidak perlu ikut terkirim ke
// browser setiap kali halaman dibuka.
const SELECT_COLS = `
  id, to_char(tanggal, 'YYYY-MM-DD') AS tanggal, no_ba, bidang, jenis,
  instalasi, lokasi_teks, gps_lat, gps_lng, material,
  diameter_nilai, diameter_satuan, uraian, keterangan`;

function toRow(r) {
  return {
    id: Number(r.id),
    tanggal: r.tanggal,
    no_ba: r.no_ba,
    bidang: r.bidang,
    jenis: r.jenis,
    instalasi: r.instalasi,
    lokasi_teks: r.lokasi_teks,
    gps_lat: r.gps_lat !== null ? Number(r.gps_lat) : null,
    gps_lng: r.gps_lng !== null ? Number(r.gps_lng) : null,
    material: r.material,
    diameter_nilai: r.diameter_nilai !== null ? Number(r.diameter_nilai) : null,
    diameter_satuan: r.diameter_satuan,
    uraian: r.uraian,
    keterangan: r.keterangan
  };
}

// ---------------------------------------------------------------------------
// DATA CONTOH untuk pengunjung tanpa akses. Sengaja dibuat deterministik
// (LCG dengan seed tetap, bukan Math.random) supaya isinya tidak berubah-ubah
// tiap kali halaman dimuat ulang -- kalau angkanya meloncat tiap refresh,
// orang bisa mengira data aslinya yang berubah.
//
// Semua nilai dibikin jelas-jelas palsu: nomor BA memakai kata "CONTOH" dan
// nama lokasinya "Lokasi Contoh N". Bentuk barisnya tetap sama persis dengan
// data asli supaya seluruh grafik & filter di halaman tetap bisa dicoba.
// ---------------------------------------------------------------------------
const DUMMY_BIDANG = [
  { bidang: 'transmisi', jenis: null, satuan: 'mm', dia: [400, 500, 600, 700], n: 62 },
  { bidang: 'pipa-sumur', jenis: 'Pipa Sumur', satuan: 'inch', dia: [2, 3, 4, 6, 8], n: 54 },
  { bidang: 'service-sumur', jenis: 'Pompa & Service Sumur', satuan: null, dia: [], n: 30 },
  { bidang: 'lainnya', jenis: 'Pemeliharaan Sarana & Bangunan', satuan: null, dia: [], n: 34 }
];
const DUMMY_INSTALASI = ['Kampung Damai', 'Batu Ampar', 'Gunung Sari', 'Teritip', 'Prapatan'];
const DUMMY_MATERIAL = ['Steel', 'Ductile', 'HDPE', 'PVC'];
const ROMAWI = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

function buildDummyRows() {
  let seed = 20260723;
  const next = (max) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % max; };
  const rows = [];
  let id = 1;
  DUMMY_BIDANG.forEach(def => {
    for (let i = 0; i < def.n; i++) {
      const tahun = 2014 + next(13);
      const bulan = 1 + next(12);
      const hari = 1 + next(28);
      const pad = (v) => String(v).padStart(2, '0');
      rows.push({
        id: id++,
        tanggal: `${tahun}-${pad(bulan)}-${pad(hari)}`,
        no_ba: `${pad(1 + next(99))}/CONTOH/${ROMAWI[bulan - 1]}/${tahun}-Q`,
        bidang: def.bidang,
        jenis: def.jenis,
        instalasi: DUMMY_INSTALASI[next(DUMMY_INSTALASI.length)],
        lokasi_teks: `Lokasi Contoh ${1 + next(18)}`,
        gps_lat: null,
        gps_lng: null,
        material: def.satuan ? DUMMY_MATERIAL[next(DUMMY_MATERIAL.length)] : null,
        diameter_nilai: def.dia.length ? def.dia[next(def.dia.length)] : null,
        diameter_satuan: def.satuan,
        uraian: def.bidang === 'transmisi' ? null : 'Uraian pekerjaan contoh',
        keterangan: null
      });
    }
  });
  rows.sort((a, b) => (a.tanggal < b.tanggal ? -1 : a.tanggal > b.tanggal ? 1 : 0));
  return rows;
}

// Unduhan CSV dipicu lewat navigasi browser (window.location.href), yang tidak
// bisa mengirim header Authorization -- jadi tokennya ikut sebagai query param.
// requireAdmin di lib/auth.js cuma membaca header, makanya di sini dipakai
// pemeriksaan sendiri yang menerima keduanya. Pola query param yang sama sudah
// dipakai tombol Unduh PDF di apps/riwayat-air-baku (lihat viz-auth.js).
function adminDariRequest(req) {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.split(' ')[1] || (req.query && req.query.token) || null;
  if (!token) return null;
  try {
    const payload = jwt.verify(token, SECRET_KEY);
    return payload.role === 'admin' ? payload : null;
  } catch (err) {
    return null;
  }
}

function csvEscape(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

const BIDANG_LABEL = {
  transmisi: 'Pipa Transmisi',
  'pipa-sumur': 'Pipa Sumur',
  'service-sumur': 'Service Sumur',
  lainnya: 'Pekerjaan Lainnya'
};

const BIDANG_VALID = ['transmisi', 'pipa-sumur', 'service-sumur', 'lainnya'];

function angkaAtauNull(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

function teksAtauNull(v, maks) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (!s) return null;
  return maks ? s.slice(0, maks) : s;
}

// Jam dari <input type="time"> berbentuk "HH:MM". Apa pun selain itu ditolak
// supaya tidak ada string aneh yang masuk ke kolom TIME.
function jamAtauNull(v) {
  const s = teksAtauNull(v);
  return s && /^\d{2}:\d{2}$/.test(s) ? s : null;
}

module.exports = async (req, res) => {
  // --- Simpan laporan lapangan sebagai draft ---
  if (req.method === 'POST') {
    const user = adminDariRequest(req);
    if (!user) return res.status(403).json({ error: 'Khusus admin' });

    const b = req.body || {};
    if (!BIDANG_VALID.includes(b.bidang)) {
      return res.status(400).json({ error: 'bidang tidak dikenal' });
    }

    await ensurePekerjaanTable();
    const { rows } = await pool.query(
      `INSERT INTO pekerjaan
         (tanggal, bidang, jenis, instalasi, gps_lat, gps_lng, gps_akurasi,
          material, diameter_nilai, diameter_satuan, uraian, kontraktor,
          jam_mulai, jam_selesai, barang_pengadaan, barang_gudang, foto_urls,
          status, sumber, created_by)
       VALUES
         ((now() AT TIME ZONE 'Asia/Makassar')::date,
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,
          'draft', 'formulir-sab', $17)
       RETURNING id`,
      [
        b.bidang,
        teksAtauNull(b.jenis, 80),
        teksAtauNull(b.instalasi, 80),
        angkaAtauNull(b.gps_lat),
        angkaAtauNull(b.gps_lng),
        angkaAtauNull(b.gps_akurasi),
        teksAtauNull(b.material, 40),
        angkaAtauNull(b.diameter_nilai),
        teksAtauNull(b.diameter_satuan, 10),
        teksAtauNull(b.uraian, 500),
        teksAtauNull(b.kontraktor, 200),
        jamAtauNull(b.jam_mulai),
        jamAtauNull(b.jam_selesai),
        teksAtauNull(b.barang_pengadaan, 1000),
        teksAtauNull(b.barang_gudang, 1000),
        Array.isArray(b.foto_urls) ? b.foto_urls.filter(u => typeof u === 'string').slice(0, 10) : [],
        user.username || user.displayName || 'admin'
      ]
    );

    return res.status(200).json({ success: true, id: Number(rows[0].id) });
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // --- Laporan lapangan yang belum dibuatkan berita acara ---
  // Dipakai lonceng notifikasi di navbar (assets/js/nav-badge.js) dan nanti
  // oleh panel antrean di halaman Berita Acara.
  if (req.query.draft !== undefined) {
    const user = adminDariRequest(req);
    if (!user) return res.status(403).json({ error: 'Khusus admin' });

    await ensurePekerjaanTable();
    const { rows } = await pool.query(
      `SELECT ${SELECT_COLS}, created_by, to_char(created_at, 'YYYY-MM-DD') AS dibuat
       FROM pekerjaan
       WHERE deleted_at IS NULL AND status = 'draft'
       ORDER BY tanggal, id`
    );
    return res.status(200).json({ count: rows.length, rows: rows.map(toRow) });
  }

  // --- Unduh CSV: admin saja ---
  if (req.query.export === 'csv') {
    if (!adminDariRequest(req)) {
      return res.status(403).json({ error: 'Khusus admin' });
    }

    await ensurePekerjaanTable();
    const { rows } = await pool.query(
      `SELECT ${SELECT_COLS} FROM pekerjaan
       WHERE deleted_at IS NULL AND status = 'final'
       ORDER BY tanggal, id`
    );

    const header = ['Tanggal', 'No. BA', 'Bidang', 'Jenis', 'Instalasi', 'Lokasi',
      'Koordinat', 'Material', 'Diameter', 'Satuan', 'Uraian', 'Keterangan'];
    const lines = [header.join(',')];
    rows.forEach(r => {
      const koordinat = r.gps_lat !== null && r.gps_lng !== null ? `${r.gps_lat}, ${r.gps_lng}` : '';
      lines.push([
        r.tanggal, r.no_ba, BIDANG_LABEL[r.bidang] || r.bidang, r.jenis, r.instalasi,
        r.lokasi_teks, koordinat, r.material, r.diameter_nilai, r.diameter_satuan,
        r.uraian, r.keterangan
      ].map(csvEscape).join(','));
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename=riwayat-pekerjaan-sab.csv');
    // BOM di depan supaya Excel membaca UTF-8 dengan benar (nama lokasi
    // banyak yang pakai karakter non-ASCII).
    return res.status(200).send('\ufeff' + lines.join('\r\n'));
  }

  // --- Daftar pekerjaan ---
  // Pengunjung tanpa akses tidak pernah menyentuh database sama sekali: data
  // contoh dibangun di memori, jadi halaman publik tetap ringan.
  const access = await checkVizAccess(req);

  if (!access.granted) {
    return res.status(200).json({ locked: true, rows: buildDummyRows() });
  }

  await ensurePekerjaanTable();
  const { rows } = await pool.query(
    `SELECT ${SELECT_COLS} FROM pekerjaan
     WHERE deleted_at IS NULL AND status = 'final'
     ORDER BY tanggal, id`
  );

  return res.status(200).json({ locked: false, rows: rows.map(toRow) });
};
