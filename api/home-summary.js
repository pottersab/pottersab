const { put, del } = require('@vercel/blob');
const { pool, ensureVizTables, ensureGaleriTable } = require('../lib/db');
const { requireAdmin } = require('../lib/auth');

// File ini melayani DUA hal yang sama-sama mengisi halaman publik:
//
//   GET  /api/home-summary                -> 3 kotak ringkasan di hero index.html
//   GET  /api/home-summary?bagian=galeri  -> daftar foto galeri about.html (publik)
//   POST/PATCH/DELETE ?bagian=galeri      -> kelola foto galeri (admin saja)
//
// Galeri dipasang menumpang di sini, bukan jadi api/galeri.js, karena folder
// /api sudah berisi tepat 12 berkas -- batas Serverless Function Vercel Hobby.
// Berkas ke-13 bikin seluruh deployment gagal. Pola menumpang ini sama dengan
// action=map-latest di api/visualization/admin-library.js dan penggabungan
// mode di api/pekerjaan.js.

// ---------------------------------------------------------------------------
// GALERI
// ---------------------------------------------------------------------------

// Foto sudah dikecilkan di browser oleh assets/js/kompres-foto.js jadi sekitar
// 200-300 KB. Batas 4 MB di sini cuma jaring pengaman kalau ada yang memanggil
// API langsung tanpa lewat halaman: body Serverless Function Vercel dibatasi
// ~4,5 MB, dan kalau terlampaui kegagalannya tidak terbaca sebagai error yang
// jelas.
const MAKS_UKURAN_FOTO = 4 * 1024 * 1024;
const POLA_DATA_URL = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/;

function keteranganAtauNull(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, 300) : null;
}

function toFoto(r) {
  return {
    id: Number(r.id),
    url: r.url,
    keterangan: r.keterangan,
    urutan: Number(r.urutan)
  };
}

async function handleGaleri(req, res) {
  await ensureGaleriTable();

  // --- Publik: dibaca setiap pengunjung about.html ---
  if (req.method === 'GET') {
    const { rows } = await pool.query(
      `SELECT id, url, keterangan, urutan FROM galeri ORDER BY urutan, id`
    );
    return res.status(200).json({ rows: rows.map(toFoto) });
  }

  // --- Sisanya khusus admin ---
  const user = requireAdmin(req, res);
  if (!user) return;

  if (req.method === 'POST') {
    const b = req.body || {};
    const cocok = POLA_DATA_URL.exec(typeof b.dataUrl === 'string' ? b.dataUrl : '');
    if (!cocok) {
      return res.status(400).json({ error: 'Foto harus berupa data URL JPEG, PNG, atau WEBP.' });
    }

    const tipe = cocok[1];
    const isi = Buffer.from(cocok[2], 'base64');
    if (!isi.length) return res.status(400).json({ error: 'Isi foto kosong.' });
    if (isi.length > MAKS_UKURAN_FOTO) {
      return res.status(413).json({ error: 'Foto terlalu besar, maksimal 4 MB.' });
    }

    let hasil;
    try {
      hasil = await put(`galeri/foto.${tipe === 'jpeg' ? 'jpg' : tipe}`, isi, {
        access: 'public',
        contentType: `image/${tipe}`,
        // Nama berkas diberi akhiran acak oleh Vercel supaya dua unggahan
        // tidak pernah saling menimpa.
        addRandomSuffix: true
      });
    } catch (err) {
      // Paling sering: Blob Store belum dibuat di dashboard Vercel, jadi
      // BLOB_READ_WRITE_TOKEN belum ada. Disebut jelas supaya tidak terbaca
      // sebagai "foto rusak".
      return res.status(500).json({
        error: process.env.BLOB_READ_WRITE_TOKEN
          ? 'Gagal mengunggah foto ke penyimpanan: ' + err.message
          : 'Penyimpanan foto belum aktif. Buat Blob Store di dashboard Vercel dulu.'
      });
    }

    // Foto baru selalu masuk ke urutan paling belakang.
    const { rows } = await pool.query(
      `INSERT INTO galeri (url, pathname, keterangan, urutan, created_by)
       VALUES ($1, $2, $3, COALESCE((SELECT MAX(urutan) FROM galeri), 0) + 10, $4)
       RETURNING id, url, keterangan, urutan`,
      [hasil.url, hasil.pathname, keteranganAtauNull(b.keterangan), user.username || 'admin']
    );
    return res.status(200).json({ success: true, foto: toFoto(rows[0]) });
  }

  if (req.method === 'PATCH') {
    const b = req.body || {};

    // Ubah urutan: halaman mengirim SELURUH daftar id sesuai tampilan barunya,
    // bukan cuma foto yang digeser, supaya hasil akhirnya tidak bergantung
    // pada nomor urut lama yang mungkin sudah tidak rapat.
    if (Array.isArray(b.urutan)) {
      const ids = b.urutan.map(Number).filter(Number.isInteger);
      if (!ids.length) return res.status(400).json({ error: 'Daftar urutan kosong.' });
      await pool.query(
        `UPDATE galeri SET urutan = u.pos * 10
         FROM unnest($1::bigint[]) WITH ORDINALITY AS u(id, pos)
         WHERE galeri.id = u.id`,
        [ids]
      );
      return res.status(200).json({ success: true });
    }

    const id = Number(b.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'id wajib diisi.' });
    const { rowCount } = await pool.query(
      `UPDATE galeri SET keterangan = $1 WHERE id = $2`,
      [keteranganAtauNull(b.keterangan), id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Foto tidak ditemukan.' });
    return res.status(200).json({ success: true });
  }

  if (req.method === 'DELETE') {
    const id = Number(req.query.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'id wajib diisi.' });

    // Baris dihapus lebih dulu supaya foto langsung hilang dari halaman. Kalau
    // penghapusan berkas di Blob gagal, yang tertinggal cuma berkas yatim yang
    // tidak tampil di mana pun -- lebih baik daripada baris yang tidak bisa
    // dihapus gara-gara penyimpanan sedang bermasalah.
    const { rows } = await pool.query(
      `DELETE FROM galeri WHERE id = $1 RETURNING url`, [id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Foto tidak ditemukan.' });

    try {
      await del(rows[0].url);
    } catch (err) {
      return res.status(200).json({ success: true, peringatan: 'Foto hilang dari galeri, tapi berkasnya masih tersimpan di Blob.' });
    }
    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

// ---------------------------------------------------------------------------
// RINGKASAN BERANDA
// ---------------------------------------------------------------------------

// Endpoint publik (tanpa auth, sama seperti beranda) buat isi 3 kotak
// ringkasan di hero index.html. Tanggal/bulan diambil pakai to_char di SQL
// (bukan dibiarkan jadi objek Date bawaan node-postgres) supaya tidak kena
// pergeseran timezone -- pola yang sama dipakai lib/visualization/repo.js.
module.exports = async (req, res) => {
  if (req.query.bagian === 'galeri') return handleGaleri(req, res);

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  await ensureVizTables();

  const [levelResult, teritipResult, airBakuResult, sumurResult] = await Promise.all([
    pool.query(`
      SELECT to_char(tanggal, 'YYYY-MM-DD') as tanggal, level_waduk_manggar_m
      FROM manggar_level_curahhujan
      WHERE level_waduk_manggar_m IS NOT NULL
      ORDER BY tanggal DESC LIMIT 1
    `),
    pool.query(`
      SELECT to_char(tanggal, 'YYYY-MM-DD') as tanggal, level_waduk_teritip_m
      FROM teritip_level
      WHERE level_waduk_teritip_m IS NOT NULL
      ORDER BY tanggal DESC LIMIT 1
    `),
    pool.query(`
      SELECT to_char(ap.bulan, 'YYYY-MM-DD') as bulan,
        (ap.teritip + ap.kampung_damai + ap.batu_ampar + ap.km_12 + ap.gunung_tembak) as ap_total,
        (atd.kampung_damai + atd.gunung_sari + atd.prapatan + atd.zamp + atd.kampung_baru_ulu) as atd_total
      FROM air_permukaan ap
      JOIN air_tanah_dalam atd ON atd.bulan = ap.bulan
      WHERE ap.teritip IS NOT NULL AND ap.kampung_damai IS NOT NULL AND ap.batu_ampar IS NOT NULL
        AND ap.km_12 IS NOT NULL AND ap.gunung_tembak IS NOT NULL
        AND atd.kampung_damai IS NOT NULL AND atd.gunung_sari IS NOT NULL AND atd.prapatan IS NOT NULL
        AND atd.zamp IS NOT NULL AND atd.kampung_baru_ulu IS NOT NULL
      ORDER BY ap.bulan DESC LIMIT 1
    `),
    // Sumur dianggap aktif kalau ADA data debit (bukan null) yang diinput
    // dalam 12 BULAN TERAKHIR -- sumur yang sudah lama tidak dilaporkan jadi
    // tidak terhitung aktif walau dulu pernah ada datanya.
    //
    // Jendelanya sengaja berjalan (12 bulan ke belakang dari bulan ini), bukan
    // "sejak awal tahun": data debit diinput bulanan dan baru masuk setelah
    // bulannya lewat, jadi patokan awal tahun bikin angkanya jatuh ke 0 setiap
    // 1 Januari sampai data Januari diinput -- beranda menampilkan "0 titik"
    // selama sebulan penuh tiap tahun padahal sumurnya jalan semua.
    //
    // Jendela yang sama dipakai query debit di api/visualization/admin-library.js
    // (action=map-latest); dua angka ini harus selalu cocok karena keduanya
    // sama-sama tampil sebagai "sumur aktif".
    pool.query(`
      SELECT COUNT(DISTINCT (installation, well_name)) as jumlah,
        to_char(MAX(bulan), 'YYYY-MM-DD') as bulan
      FROM sumur_debit_readings
      WHERE value IS NOT NULL
        AND bulan >= date_trunc('month', CURRENT_DATE) - INTERVAL '11 months'
    `)
  ]);

  const levelRow = levelResult.rows[0];
  const teritipRow = teritipResult.rows[0];
  const airBakuRow = airBakuResult.rows[0];
  const sumurRow = sumurResult.rows[0];

  return res.status(200).json({
    level: levelRow
      ? { value: Number(levelRow.level_waduk_manggar_m), date: levelRow.tanggal }
      : null,
    teritip: teritipRow
      ? { value: Number(teritipRow.level_waduk_teritip_m), date: teritipRow.tanggal }
      : null,
    airBaku: airBakuRow
      ? { value: Number(airBakuRow.ap_total) + Number(airBakuRow.atd_total), periodStart: airBakuRow.bulan }
      : null,
    sumurAktif: (sumurRow && Number(sumurRow.jumlah) > 0)
      ? { count: Number(sumurRow.jumlah), periodStart: sumurRow.bulan }
      : null
  });
};
