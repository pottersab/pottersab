const { pool, ensureVizTables } = require('../lib/db');

// Endpoint publik (tanpa auth, sama seperti beranda) buat isi 3 kotak
// ringkasan di hero index.html. Tanggal/bulan diambil pakai to_char di SQL
// (bukan dibiarkan jadi objek Date bawaan node-postgres) supaya tidak kena
// pergeseran timezone -- pola yang sama dipakai lib/visualization/repo.js.
module.exports = async (req, res) => {
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
    // SELAMA TAHUN BERJALAN -- bukan lagi cuma "ikut bulan terakhir yang
    // ada datanya" (sumur yang tidak dilaporkan sejak tahun lalu jadi tidak
    // terhitung aktif walau dulu pernah ada datanya). Sama dengan logika di
    // apps/peta-ipa-sumur/app.js (statusFromDebit).
    pool.query(`
      SELECT COUNT(DISTINCT (installation, well_name)) as jumlah,
        to_char(MAX(bulan), 'YYYY-MM-DD') as bulan
      FROM sumur_debit_readings
      WHERE value IS NOT NULL AND bulan >= date_trunc('year', CURRENT_DATE)
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
