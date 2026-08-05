// Logika KPI 18.2 Ukur Debit (apps/kpi-sab/ukur-debit.html). Sengaja bukan
// berkas api/ tersendiri -- proyek ini di paket Hobby Vercel, dibatasi 12
// Serverless Function per deployment, dan sudah pas 12 sebelum fitur ini ada.
// GET-nya digabung ke api/visualization/data.js (dataType 'kpi_ukur_debit'),
// POST-nya digabung ke api/visualization/admin-input.js (body.kind
// 'debit_awal' / 'meta') supaya jumlah berkas di api/ tidak nambah.
const ExcelJS = require('exceljs');
const { pool } = require('../db');
const { fetchSumurWells, fetchSumurDebitRows } = require('./repo');
const { buildDummySumurDebitRows } = require('./dummy');
const { logViewerAction } = require('./access-log');

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

async function getKpiUkurDebitData(access, tahunQuery) {
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
    const year = tahunQuery || String(new Date().getFullYear());
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
    return {
      locked: true,
      availableYears: [],
      year,
      groups,
      meta: { '1': DEFAULT_META, '2': DEFAULT_META }
    };
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

  const year = tahunQuery || availableYears[availableYears.length - 1];

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

  return { locked: false, availableYears, year, groups, meta };
}

async function saveDebitAwal(installation, well_name, debit_awal) {
  await pool.query(
    `INSERT INTO kpi_debit_awal (installation, well_name, debit_awal, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (installation, well_name) DO UPDATE SET debit_awal = EXCLUDED.debit_awal, updated_at = now()`,
    [installation, well_name, Number(debit_awal)]
  );
}

async function saveMeta(period_key, m) {
  await pool.query(
    `INSERT INTO kpi_ukur_debit_meta (period_key, keterangan, sign_place_date, role_left, name_left, role_right, name_right, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now())
     ON CONFLICT (period_key) DO UPDATE SET
       keterangan = EXCLUDED.keterangan, sign_place_date = EXCLUDED.sign_place_date,
       role_left = EXCLUDED.role_left, name_left = EXCLUDED.name_left,
       role_right = EXCLUDED.role_right, name_right = EXCLUDED.name_right,
       updated_at = now()`,
    [period_key, JSON.stringify(m.keterangan || []), m.signPlaceDate || '', m.roleLeft || '', m.nameLeft || '', m.roleRight || '', m.nameRight || '']
  );
}

// ---------------------------------------------------------------------------
// UNDUH EXCEL -- dibangun di SERVER dengan exceljs, bukan di browser dengan
// SheetJS. Alasan: build SheetJS gratis yang dipakai tombol Unduh Excel di
// halaman viz lain TIDAK bisa menulis border/font (cuma fitur Pro-nya yang
// bisa) -- sudah dicoba dan hasilnya polos tanpa garis kotak sama sekali,
// beda jauh dari contoh yang sudah disetujui. exceljs di server tidak
// punya batasan itu, jadi hasilnya bisa persis format 18.2 Ukur Debit.xlsx
// asli (Times New Roman, garis kotak penuh, tebal di header/JUMLAH/RATA-RATA).
const MONTHS_ID = ['JANUARI', 'FEBRUARI', 'MARET', 'APRIL', 'MEI', 'JUNI', 'JULI', 'AGUSTUS', 'SEPTEMBER', 'OKTOBER', 'NOVEMBER', 'DESEMBER'];
const TNR = 'Times New Roman';
const THIN = { style: 'thin', color: { argb: 'FF000000' } };
const GRID = { top: THIN, left: THIN, bottom: THIN, right: THIN };
const COL_WIDTHS = [4.33, 29.55, 11.66, 10.55, 11.33, 12.33, 12.66, 10.33, 11.55, 9.55, 11.33, 13.66, 11.33, 8.66, 11.55, 11, 9.33, 10.44, 11, 10.44, 10.55];

function colLetter(n) {
  let s = '';
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}
function monthColsXlsx(i) { const base = 4 + i * 3; return { real: base, pm: base + 1, pct: base + 2 }; }

function buildKpiExcelBlock(ws, rowOffset, monthNames, monthBase, judulBulan, data) {
  const R = r => r + rowOffset;

  ws.getCell(`A${R(1)}`).value = 'PERUSAHAAN UMUM DAERAH TIRTA MANUNTUNG';
  ws.getCell(`A${R(1)}`).font = { bold: true, size: 12, name: 'Arial' };
  ws.getCell(`A${R(2)}`).value = 'KOTA BALIKPAPAN';
  ws.getCell(`A${R(2)}`).font = { bold: true, size: 12, name: 'Arial' };

  ws.mergeCells(`A${R(4)}:U${R(4)}`);
  ws.getCell(`A${R(4)}`).value = ' 18.2 PENGUKURAN DEBIT SUMUR';
  ws.getCell(`A${R(4)}`).font = { bold: true, size: 14, name: TNR };
  ws.getCell(`A${R(4)}`).alignment = { horizontal: 'center' };

  ws.mergeCells(`A${R(5)}:U${R(5)}`);
  ws.getCell(`A${R(5)}`).value = judulBulan;
  ws.getCell(`A${R(5)}`).font = { bold: true, size: 12, name: TNR };
  ws.getCell(`A${R(5)}`).alignment = { horizontal: 'center' };

  const headerRows = [R(7), R(8), R(9)];
  ws.mergeCells(`A${R(7)}:A${R(9)}`);
  ws.getCell(`A${R(7)}`).value = 'NO';
  ws.mergeCells(`B${R(7)}:B${R(9)}`);
  ws.getCell(`B${R(7)}`).value = 'IPA/ NO.SUMUR';
  ws.getCell(`C${R(7)}`).value = 'DEBIT';
  ws.getCell(`C${R(8)}`).value = 'AWAL';
  ws.getCell(`C${R(9)}`).value = 'M3/H';

  monthNames.forEach((mn, i) => {
    const { real, pm, pct } = monthColsXlsx(i);
    const c1 = colLetter(real), c3 = colLetter(pct);
    ws.mergeCells(`${c1}${R(7)}:${c3}${R(7)}`);
    ws.getCell(`${c1}${R(7)}`).value = mn;
    ws.getCell(`${c1}${R(8)}`).value = 'REAL';
    ws.mergeCells(`${colLetter(pm)}${R(8)}:${c3}${R(8)}`);
    ws.getCell(`${colLetter(pm)}${R(8)}`).value = 'RATIO EFFISIENSI';
    ws.getCell(`${colLetter(pm)}${R(9)}`).value = '±';
    ws.getCell(`${c3}${R(9)}`).value = '%';
  });

  headerRows.forEach(rr => {
    const row = ws.getRow(rr);
    for (let c = 1; c <= 21; c++) {
      const cell = row.getCell(c);
      cell.font = { bold: true, size: 12, name: TNR };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = GRID;
    }
  });
  ws.getRow(R(7)).height = 24;

  let r = R(10);
  const jumlahRows = [];
  data.groups.forEach(g => {
    ws.getCell(`A${r}`).value = g.no;
    ws.getCell(`B${r}`).value = g.ipa;
    r++;

    const firstWellRow = r;
    g.wells.forEach(w => {
      ws.getCell(`B${r}`).value = w.name;
      const awalCell = ws.getCell(`C${r}`);
      if (w.awal !== null && w.awal !== undefined) awalCell.value = w.awal;
      awalCell.numFmt = '0.00';

      monthNames.forEach((mn, i) => {
        const { real, pm, pct } = monthColsXlsx(i);
        const rc = colLetter(real), pmc = colLetter(pm), pctc = colLetter(pct);
        const realCell = ws.getCell(`${rc}${r}`);
        const v = w.real[monthBase + i];
        if (v !== null && v !== undefined) realCell.value = v;
        ws.getCell(`${pmc}${r}`).value = { formula: `IF(${rc}${r}="","",${rc}${r}-C${r})` };
        ws.getCell(`${pctc}${r}`).value = { formula: `IF(${rc}${r}="","",${rc}${r}/C${r}*100)` };
        [realCell, ws.getCell(`${pmc}${r}`), ws.getCell(`${pctc}${r}`)].forEach(c => { c.numFmt = '0.00'; });
      });
      r++;
    });
    const lastWellRow = r - 1;

    ws.getCell(`B${r}`).value = 'JUMLAH';
    ws.getCell(`C${r}`).value = { formula: `SUM(C${firstWellRow}:C${lastWellRow})` };
    ws.getCell(`C${r}`).numFmt = '0.00';
    monthNames.forEach((mn, i) => {
      const { real } = monthColsXlsx(i);
      const rc = colLetter(real);
      const cell = ws.getCell(`${rc}${r}`);
      cell.value = { formula: `IF(COUNT(${rc}${firstWellRow}:${rc}${lastWellRow})=0,"",SUM(${rc}${firstWellRow}:${rc}${lastWellRow}))` };
      cell.numFmt = '0.00';
    });
    jumlahRows.push(r);
    r++;
  });

  for (let rr = R(10); rr <= r - 1; rr++) {
    for (let c = 1; c <= 21; c++) {
      const cell = ws.getRow(rr).getCell(c);
      if (!cell.font) cell.font = { size: 12, name: TNR };
      cell.alignment = cell.alignment || { horizontal: 'center' };
      cell.border = GRID;
    }
  }
  jumlahRows.forEach(rr => {
    for (let c = 1; c <= 21; c++) ws.getRow(rr).getCell(c).font = { bold: true, size: 12, name: TNR };
  });

  const rataRow = r;
  for (let c = 1; c <= 21; c++) {
    const cell = ws.getRow(rataRow).getCell(c);
    cell.font = { bold: true, size: 12, name: TNR };
    cell.alignment = { horizontal: 'center' };
    cell.border = GRID;
  }
  ws.getCell(`B${rataRow}`).value = 'RATA RATA';
  monthNames.forEach((mn, i) => {
    const { pct } = monthColsXlsx(i);
    const pctc = colLetter(pct);
    const cell = ws.getCell(`${pctc}${rataRow}`);
    cell.value = { formula: `IF(COUNT(${pctc}${R(10)}:${pctc}${rataRow - 1})=0,"",AVERAGE(${pctc}${R(10)}:${pctc}${rataRow - 1}))` };
    cell.numFmt = '0.00';
  });
  r = rataRow + 1;

  const meta = data.meta[monthBase === 0 ? '1' : '2'] || {};
  const ketHeaderRow = r; ws.getCell(`B${ketHeaderRow}`).value = 'Keterangan :'; ws.getCell(`B${ketHeaderRow}`).font = { size: 12, name: TNR }; r++;
  (meta.keterangan || []).forEach(k => {
    ws.getCell(`B${r}`).value = '~ ' + k;
    ws.getCell(`B${r}`).font = { size: 12, name: TNR };
    r++;
  });
  let lastKetRow = r - 1;
  if (lastKetRow < ketHeaderRow) lastKetRow = ketHeaderRow;

  ws.mergeCells(`R${lastKetRow}:T${lastKetRow}`);
  ws.getCell(`R${lastKetRow}`).value = meta.signPlaceDate || '';
  ws.getCell(`R${lastKetRow}`).font = { size: 11, name: 'Calibri' };
  ws.getCell(`R${lastKetRow}`).alignment = { horizontal: 'center' };

  const dibuatRow = lastKetRow + 1;
  ws.mergeCells(`R${dibuatRow}:T${dibuatRow}`);
  ws.getCell(`R${dibuatRow}`).value = 'Dibuat oleh';
  ws.getCell(`R${dibuatRow}`).font = { size: 12, name: TNR };
  ws.getCell(`R${dibuatRow}`).alignment = { horizontal: 'center' };

  const roleRow = dibuatRow + 1;
  ws.mergeCells(`D${roleRow}:F${roleRow}`);
  ws.getCell(`D${roleRow}`).value = meta.roleLeft || 'Mengetahui/Menyetujui :';
  ws.getCell(`D${roleRow}`).font = { size: 12, name: TNR };
  ws.getCell(`D${roleRow}`).alignment = { horizontal: 'center' };

  ws.mergeCells(`R${roleRow}:T${roleRow + 1}`);
  ws.getCell(`R${roleRow}`).value = meta.roleRight || '';
  ws.getCell(`R${roleRow}`).font = { size: 12, name: TNR };
  ws.getCell(`R${roleRow}`).alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };

  const roleLeftRow = roleRow + 1;
  ws.mergeCells(`D${roleLeftRow}:F${roleLeftRow}`);
  ws.getCell(`D${roleLeftRow}`).font = { size: 12, name: TNR };
  ws.getCell(`D${roleLeftRow}`).alignment = { horizontal: 'center' };

  const nameRow = roleLeftRow + 5;
  ws.mergeCells(`C${nameRow}:G${nameRow + 1}`);
  ws.getCell(`C${nameRow}`).value = meta.nameLeft || '';
  ws.getCell(`C${nameRow}`).font = { bold: true, size: 12, name: TNR };
  ws.getCell(`C${nameRow}`).alignment = { horizontal: 'center', vertical: 'top', wrapText: true };

  ws.mergeCells(`R${nameRow}:T${nameRow}`);
  ws.getCell(`R${nameRow}`).value = meta.nameRight || '';
  ws.getCell(`R${nameRow}`).font = { bold: true, size: 12, name: TNR };
  ws.getCell(`R${nameRow}`).alignment = { horizontal: 'center' };

  return nameRow + 2;
}

async function buildKpiExcelWorkbook(data) {
  const wb = new ExcelJS.Workbook();
  wb.calcProperties.fullCalcOnLoad = true;
  const ws = wb.addWorksheet('18.2 UKUR DEBIT SUMUR', { pageSetup: { orientation: 'landscape', fitToPage: true } });
  COL_WIDTHS.forEach((w, i) => { ws.getColumn(i + 1).width = w; });

  const nextRow = buildKpiExcelBlock(ws, 0, MONTHS_ID.slice(0, 6), 0, `BULAN : Januari - Juni ${data.year}`, data);
  const rowOffset2 = nextRow + 1;
  buildKpiExcelBlock(ws, rowOffset2, MONTHS_ID.slice(6, 12), 6, `BULAN : Juli - Desember ${data.year}`, data);

  return wb.xlsx.writeBuffer();
}

module.exports = { KPI_INSTALLATIONS, getKpiUkurDebitData, saveDebitAwal, saveMeta, buildKpiExcelWorkbook };
