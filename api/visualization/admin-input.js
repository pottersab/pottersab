const { pool, ensureVizTables, ensureKpiTables } = require('../../lib/db');
const { requireAdmin } = require('../../lib/auth');
const { DATASETS } = require('../../lib/visualization/columns');
const { saveDebitAwal, saveMeta, saveApatdMeta, savePengambilanTarget, savePengambilanMeta, saveKualitasElevasi, saveKualitasMeta, saveKpi192Meta, saveLevelSumurMeta } = require('../../lib/visualization/kpi');

function toNumOrNull(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

async function upsertGroup(source, bulanDate, values) {
  const dbCols = source.columns.map(c => c.db);
  const vals = source.columns.map(c => toNumOrNull(values ? values[c.csv] : undefined));
  const colList = ['bulan', ...dbCols].join(', ');
  const placeholders = ['$1', ...dbCols.map((_, i) => `$${i + 2}`)].join(', ');
  const updateSet = dbCols.map(c => `${c} = EXCLUDED.${c}`).join(', ');
  await pool.query(
    `INSERT INTO ${source.table} (${colList}) VALUES (${placeholders})
     ON CONFLICT (bulan) DO UPDATE SET ${updateSet}`,
    [bulanDate, ...vals]
  );
}

async function loadGroup(source, bulanDate) {
  const dbCols = source.columns.map(c => c.db);
  const { rows } = await pool.query(
    `SELECT ${dbCols.join(', ')} FROM ${source.table} WHERE bulan = $1`,
    [bulanDate]
  );
  if (!rows[0]) return { found: false, values: {} };
  const values = {};
  source.columns.forEach(c => {
    const v = rows[0][c.db];
    values[c.csv] = v !== null && v !== undefined ? Number(v) : '';
  });
  return { found: true, values };
}

// Pengganti Google Apps Script (SCRIPT_URL) yang tadinya dipakai
// apps/input-air-baku.html. Admin-only (JWT role admin dari login.html),
// menulis langsung ke tabel Postgres air_permukaan / air_tanah_dalam.
module.exports = async (req, res) => {
  await ensureVizTables();

  const user = requireAdmin(req, res);
  if (!user) return;

  if (req.method === 'GET') {
    const { bulan } = req.query;
    if (!bulan) return res.status(400).json({ error: 'bulan wajib diisi' });
    const bulanDate = `${bulan}-01`;
    const [ap, atd] = await Promise.all([
      loadGroup(DATASETS.ap, bulanDate),
      loadGroup(DATASETS.atd, bulanDate)
    ]);
    return res.status(200).json({ ap, atd });
  }

  if (req.method === 'POST') {
    // KPI 18.2 Ukur Debit (Debit Awal & Keterangan/Penandatangan) numpang di
    // endpoint admin ini juga -- lihat lib/visualization/kpi.js untuk alasan
    // kenapa tidak jadi berkas api/ sendiri (batas 12 Serverless Function
    // paket Hobby).
    const { kind } = req.body || {};
    if (kind === 'debit_awal') {
      await ensureKpiTables();
      const { installation, well_name, debit_awal } = req.body;
      if (!installation || !well_name || debit_awal === undefined || debit_awal === null || isNaN(Number(debit_awal))) {
        return res.status(400).json({ error: 'installation, well_name, dan debit_awal (angka) wajib diisi' });
      }
      await saveDebitAwal(installation, well_name, debit_awal);
      return res.status(200).json({ success: true });
    }
    if (kind === 'meta') {
      // Keterangan & Penandatangan cuma satu baris pengaturan ('global'),
      // bukan per periode lagi -- lihat lib/visualization/kpi.js.
      await ensureKpiTables();
      await saveMeta(null, req.body);
      return res.status(200).json({ success: true });
    }
    if (kind === 'apatd_meta') {
      // Keterangan & Penandatangan KPI 18.3a APATD -- tabel sendiri
      // (kpi_apatd_meta), labelnya beda dari 18.2 ("Mengetahui" / "Direkap
      // oleh"), lihat lib/visualization/kpi.js.
      await ensureKpiTables();
      await saveApatdMeta(req.body);
      return res.status(200).json({ success: true });
    }
    if (kind === 'pengambilan_target') {
      // Anggaran per jumlah hari (31/30/29/28) KPI 18.3b Pengambilan Air Baku
      // -- lihat catatan kpi_pengambilan_target di lib/db.js.
      await ensureKpiTables();
      const { day_count, ap_value, atd_value } = req.body;
      const dc = Number(day_count);
      if (![31, 30, 29, 28].includes(dc)) {
        return res.status(400).json({ error: 'day_count harus 31, 30, 29, atau 28' });
      }
      const toNumOrNullLocal = v => (v === undefined || v === null || v === '' || isNaN(Number(v))) ? null : Number(v);
      await savePengambilanTarget(dc, toNumOrNullLocal(ap_value), toNumOrNullLocal(atd_value));
      return res.status(200).json({ success: true });
    }
    if (kind === 'pengambilan_meta') {
      await ensureKpiTables();
      await savePengambilanMeta(req.body);
      return res.status(200).json({ success: true });
    }
    if (kind === 'kualitas_elevasi') {
      // Status ON/OFF pintu elevasi 3/5/7 KPI 18.4 Laporan Kualitas Air Baku
      // -- diedit langsung di panel harian halaman itu (bukan lewat Input
      // Massal), satu toggle sekali klik/POST. Lihat kualitas_pintu_elevasi
      // di lib/db.js & saveKualitasElevasi di lib/visualization/kpi.js.
      await ensureVizTables();
      const { tanggal, lokasi, elevasi, on } = req.body;
      if (!tanggal || !/^\d{4}-\d{2}-\d{2}$/.test(tanggal)) {
        return res.status(400).json({ error: 'tanggal (YYYY-MM-DD) wajib diisi' });
      }
      if (!['manggar', 'teritip'].includes(lokasi)) {
        return res.status(400).json({ error: 'lokasi harus manggar atau teritip' });
      }
      if (![3, 5, 7].includes(Number(elevasi))) {
        return res.status(400).json({ error: 'elevasi harus 3, 5, atau 7' });
      }
      await saveKualitasElevasi(tanggal, lokasi, Number(elevasi), !!on);
      return res.status(200).json({ success: true });
    }
    if (kind === 'kualitas_meta') {
      await ensureKpiTables();
      await saveKualitasMeta(req.body);
      return res.status(200).json({ success: true });
    }
    if (kind === 'kpi_192_meta') {
      // Keterangan & Penandatangan KPI 19.2 Evaluasi Hasil Monitoring --
      // tabel sendiri (kpi_192_meta), labelnya beda dari KPI lain
      // ("Mengetahui/ Menyetujui" / "Dibuat Oleh"), lihat kpi.js.
      await ensureKpiTables();
      await saveKpi192Meta(req.body);
      return res.status(200).json({ success: true });
    }
    if (kind === 'kpi_18_1a_meta') {
      // Keterangan & Penandatangan KPI 18.1a Pengukuran Level Sumur --
      // tabel sendiri (kpi_18_1a_meta), label "Mengetahui/Menyetujui :" /
      // "Di buat oleh :" (lihat kpi.js).
      await ensureKpiTables();
      await saveLevelSumurMeta(req.body);
      return res.status(200).json({ success: true });
    }

    const { bulan, ap, atd } = req.body || {};
    if (!bulan) return res.status(400).json({ error: 'bulan wajib diisi' });
    const bulanDate = `${bulan}-01`;
    await Promise.all([
      upsertGroup(DATASETS.ap, bulanDate, ap),
      upsertGroup(DATASETS.atd, bulanDate, atd)
    ]);
    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
