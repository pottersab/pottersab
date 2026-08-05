const { pool, ensureVizTables, ensureKpiTables } = require('../../lib/db');
const { requireAdmin } = require('../../lib/auth');
const { DATASETS } = require('../../lib/visualization/columns');
const { saveDebitAwal, saveMeta } = require('../../lib/visualization/kpi');

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
      await ensureKpiTables();
      const { period_key } = req.body;
      if (!period_key) return res.status(400).json({ error: 'period_key wajib diisi' });
      await saveMeta(period_key, req.body);
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
