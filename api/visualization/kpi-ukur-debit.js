const { pool, ensureVizTables, ensureKpiTables } = require('../../lib/db');
const { requireAdmin } = require('../../lib/auth');
const { checkVizAccess } = require('../../lib/visualization/viz-auth');
const { fetchSumurWells, fetchSumurDebitRows } = require('../../lib/visualization/repo');
const { buildDummySumurDebitRows } = require('../../lib/visualization/dummy');
const { logViewerAction } = require('../../lib/visualization/access-log');

// 5 instalasi yang punya blok di 18.2 Ukur Debit.xlsx (Teritip & Gunung Tembak
// di SUMUR_INSTALLATIONS tidak ikut -- lampiran aslinya memang cuma 5 IPA ini).
// Urutannya dipertahankan sama seperti lampiran asli (nomor 1-5 di kolom NO).
const KPI_INSTALLATIONS = [
  { installation: 'gunung_sari', ipa: 'IPA GUNUNG SARI' },
  { installation: 'kampung_damai', ipa: 'IPA KAMPUNG DAMAI' },
  { installation: 'prapatan', ipa: 'IPA PRAPATAN' },
  { installation: 'zamp', ipa: 'IPA ZAMP' },
  { installation: 'kampung_baru_ulu', ipa: 'IPA KAMPUNG BARU ULU' }
];

function monthIndexFromBulan(bulan) {
  // bulan format 'YYYY-MM' -> index 0-11
  return Number(bulan.slice(5, 7)) - 1;
}

async function loadDebitAwal() {
  const { rows } = await pool.query('SELECT installation, well_name, debit_awal FROM kpi_debit_awal');
  const map = new Map();
  rows.forEach(r => map.set(r.installation + ' ' + r.well_name, Number(r.debit_awal)));
  return map;
}

async function loadMeta(periodKeys) {
  const { rows } = await pool.query(
    'SELECT * FROM kpi_ukur_debit_meta WHERE period_key = ANY($1)',
    [periodKeys]
  );
  const byKey = {};
  rows.forEach(r => {
    byKey[r.period_key] = {
      keterangan: r.keterangan || [],
      signPlaceDate: r.sign_place_date || '',
      roleLeft: r.role_left || '',
      nameLeft: r.name_left || '',
      roleRight: r.role_right || '',
      nameRight: r.name_right || ''
    };
  });
  return byKey;
}

const DEFAULT_META = {
  keterangan: [],
  signPlaceDate: '',
  roleLeft: 'Mengetahui / Menyetujui — Manajer Produksi',
  nameLeft: '',
  roleRight: 'Dibuat oleh — Supervisor Sumber Air Baku & Lingkungan',
  nameRight: ''
};

async function handleGet(req, res) {
  const access = await checkVizAccess(req);

  // Ambil nama sumur (metadata, bukan angka) untuk semua instalasi dulu --
  // dipakai baik jalur terkunci (angka dummy) maupun jalur asli.
  const wellsByInst = {};
  await Promise.all(KPI_INSTALLATIONS.map(async inst => {
    wellsByInst[inst.installation] = await fetchSumurWells(inst.installation, 'debit');
  }));

  if (!access.granted) {
    // Dummy selalu mencakup tahun berjalan (rentangnya dari DUMMY_SUMUR_START
    // sampai "sekarang"), jadi tahun yang diminta -- atau tahun berjalan kalau
    // tidak diminta -- selalu ada isinya, tidak perlu dihitung dari datanya.
    const year = req.query.tahun || String(new Date().getFullYear());
    const groups = KPI_INSTALLATIONS.map(inst => {
      const wells = wellsByInst[inst.installation];
      const dummyRows = buildDummySumurDebitRows(wells, 80);
      return {
        installation: inst.installation,
        ipa: inst.ipa,
        wells: wells.map(name => {
          const real = new Array(12).fill(null);
          dummyRows.forEach(r => {
            if (r.Bulan.slice(0, 4) === year) real[monthIndexFromBulan(r.Bulan)] = r[name];
          });
          const known = real.find(v => v !== null);
          return { name, awal: Math.round((known || 50) * 1.05), real };
        })
      };
    });
    return res.status(200).json({
      locked: true,
      availableYears: [],
      year,
      groups,
      meta: { '1': DEFAULT_META, '2': DEFAULT_META }
    });
  }

  // --- akses asli ---
  const [debitAwalMap, allReadings] = await Promise.all([
    loadDebitAwal(),
    Promise.all(KPI_INSTALLATIONS.map(inst => fetchSumurDebitRows({ installation: inst.installation })))
  ]);

  const availableYearsSet = new Set();
  allReadings.forEach(({ rows }) => rows.forEach(r => availableYearsSet.add(r.Bulan.slice(0, 4))));
  const availableYears = Array.from(availableYearsSet).sort();
  const currentRealYear = String(new Date().getFullYear());
  if (!availableYears.includes(currentRealYear)) availableYears.push(currentRealYear);
  availableYears.sort();

  const year = req.query.tahun || availableYears[availableYears.length - 1];

  const groups = KPI_INSTALLATIONS.map((inst, i) => {
    const wells = wellsByInst[inst.installation];
    const { rows } = allReadings[i];
    return {
      installation: inst.installation,
      ipa: inst.ipa,
      wells: wells.map(name => {
        const real = new Array(12).fill(null);
        rows.forEach(r => {
          if (r.Bulan.slice(0, 4) === year && r[name] !== undefined && r[name] !== null) {
            real[monthIndexFromBulan(r.Bulan)] = r[name];
          }
        });
        const awal = debitAwalMap.get(inst.installation + ' ' + name);
        return { name, awal: awal !== undefined ? awal : null, real };
      })
    };
  });

  const periodKeys = [`${year}-1`, `${year}-2`];
  const metaByKey = await loadMeta(periodKeys);
  const meta = {
    '1': metaByKey[periodKeys[0]] || DEFAULT_META,
    '2': metaByKey[periodKeys[1]] || DEFAULT_META
  };

  await logViewerAction(access, 'kpi_ukur_debit', 'view');

  return res.status(200).json({ locked: false, availableYears, year, groups, meta });
}

async function handlePost(req, res) {
  const user = requireAdmin(req, res);
  if (!user) return;

  const { kind } = req.body || {};

  if (kind === 'debit_awal') {
    const { installation, well_name, debit_awal } = req.body;
    if (!installation || !well_name || debit_awal === undefined || debit_awal === null || isNaN(Number(debit_awal))) {
      return res.status(400).json({ error: 'installation, well_name, dan debit_awal (angka) wajib diisi' });
    }
    await pool.query(
      `INSERT INTO kpi_debit_awal (installation, well_name, debit_awal, updated_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (installation, well_name) DO UPDATE SET debit_awal = EXCLUDED.debit_awal, updated_at = now()`,
      [installation, well_name, Number(debit_awal)]
    );
    return res.status(200).json({ success: true });
  }

  if (kind === 'meta') {
    const { period_key, keterangan, signPlaceDate, roleLeft, nameLeft, roleRight, nameRight } = req.body;
    if (!period_key) return res.status(400).json({ error: 'period_key wajib diisi' });
    await pool.query(
      `INSERT INTO kpi_ukur_debit_meta (period_key, keterangan, sign_place_date, role_left, name_left, role_right, name_right, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now())
       ON CONFLICT (period_key) DO UPDATE SET
         keterangan = EXCLUDED.keterangan, sign_place_date = EXCLUDED.sign_place_date,
         role_left = EXCLUDED.role_left, name_left = EXCLUDED.name_left,
         role_right = EXCLUDED.role_right, name_right = EXCLUDED.name_right,
         updated_at = now()`,
      [period_key, JSON.stringify(keterangan || []), signPlaceDate || '', roleLeft || '', nameLeft || '', roleRight || '', nameRight || '']
    );
    return res.status(200).json({ success: true });
  }

  return res.status(400).json({ error: 'kind tidak dikenal (pakai "debit_awal" atau "meta")' });
}

module.exports = async (req, res) => {
  await ensureVizTables();
  await ensureKpiTables();

  if (req.method === 'GET') return handleGet(req, res);
  if (req.method === 'POST') return handlePost(req, res);
  return res.status(405).json({ error: 'Method not allowed' });
};
