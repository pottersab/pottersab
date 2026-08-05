// Logika KPI 18.2 Ukur Debit (apps/kpi-sab/ukur-debit.html). Sengaja bukan
// berkas api/ tersendiri -- proyek ini di paket Hobby Vercel, dibatasi 12
// Serverless Function per deployment, dan sudah pas 12 sebelum fitur ini ada.
// GET-nya digabung ke api/visualization/data.js (dataType 'kpi_ukur_debit'),
// POST-nya digabung ke api/visualization/admin-input.js (body.kind
// 'debit_awal' / 'meta') supaya jumlah berkas di api/ tidak nambah.
const ExcelJS = require('exceljs');
const { pool } = require('../db');
const { fetchSumurWells, fetchSumurDebitRows, fetchRealRows, fetchWideSingleRows } = require('./repo');
const { buildDummySumurDebitRows, buildDummyRows, buildDummyWideSingleRows } = require('./dummy');
const { logViewerAction } = require('./access-log');
const { DATASETS } = require('./columns');

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

// Nama sumur yang DITAMPILKAN di tabel/Excel -- persis seperti kolom B di
// 18.2 Ukur Debit.xlsx asli ("SUMUR 1", "SUMUR 3 (TNGKI)", dst), BUKAN nama
// panjang dari Data Waduk & Sumur ("SUMUR 03 TERMINAL TANGKI"). Dicocokkan
// lewat URUTAN (sort_order sumur_wells), bukan lewat nama -- nama asli di DB
// (dbName) tetap dipakai untuk mengambil Real & menyimpan Debit Awal, cuma
// tidak pernah ditampilkan. Kalau suatu saat ada sumur baru di luar daftar
// ini, ditampilkan pakai nama aslinya (bukan error) -- lihat labelFor().
const KPI_WELL_LABELS = {
  gunung_sari: ['SUMUR 1', 'SUMUR 2', 'SUMUR 3', 'SUMUR 4', 'SUMUR 5', 'SUMUR 6 ( TLGS 2 )', 'SUMUR 7 ( MTD )'],
  kampung_damai: ['SUMUR 1', 'SUMUR 2', 'SUMUR 3 (TNGKI)', 'SUMUR 5 (PGG)'],
  prapatan: ['SUMUR 1', 'SUMUR 2', 'SUMUR 3'],
  zamp: ['SUMUR 2', 'SUMUR 3'],
  kampung_baru_ulu: ['SUMUR 1', 'SUMUR 2', 'SUMUR 3']
};

function labelFor(installation, idx, dbName) {
  const list = KPI_WELL_LABELS[installation];
  return (list && list[idx]) || dbName;
}

// Tanggal tanda tangan SELALU hari ini -- tidak pernah disimpan, supaya
// admin tidak perlu ganti manual tiap kali buka halaman ini. Dihitung di zona
// WITA (Asia/Makassar), bukan zona server (Vercel jalan di UTC) -- kalau
// dibiarkan UTC, sekitar jam 00:00-08:00 WITA tanggalnya masih "kemarin".
function todaySignDate() {
  const parts = new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Makassar', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());
  return `Balikpapan, ${parts}`;
}

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

// Keterangan & Penandatangan TIDAK per periode (Jan-Jun/Jul-Des) atau per
// tahun -- di file aslinya isinya memang sama di kedua blok, dan admin
// mengeluh harus isi ulang tiap kali. Jadi cuma SATU baris pengaturan
// ('global') yang dipakai untuk semua tahun & periode; sekali diisi, tidak
// perlu diisi ulang lagi. Tanggal tanda tangan sengaja TIDAK ikut disimpan
// di sini -- selalu dihitung ulang ke tanggal hari ini, lihat app.js.
const META_KEY = 'global';

async function loadGlobalMeta() {
  const { rows } = await pool.query('SELECT * FROM kpi_ukur_debit_meta WHERE period_key = $1', [META_KEY]);
  if (!rows[0]) return null;
  const r = rows[0];
  return {
    keterangan: r.keterangan || [],
    roleLeft: r.role_left || '',
    nameLeft: r.name_left || '',
    roleRight: r.role_right || '',
    nameRight: r.name_right || ''
  };
}

// roleLeft/roleRight cuma JABATAN ("Manajer Produksi"), bukan gabungan label
// + jabatan -- labelnya ("Mengetahui/Menyetujui :" / "Dibuat oleh") sudah
// tetap/tidak ikut diedit, lihat buildKpiExcelBlock & ukur-debit.html.
const DEFAULT_META = {
  keterangan: [],
  roleLeft: 'Manajer Produksi',
  nameLeft: '',
  roleRight: 'Supervisor Sumber Air Baku & Lingkungan',
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
        wells: wells.map((name, idx) => {
          const real = new Array(12).fill(null);
          dummyRows.forEach(r => {
            if (r.Bulan.slice(0, 4) === year) real[monthIndexFromBulan(r.Bulan)] = r[name];
          });
          const known = real.find(v => v !== null);
          return { name: labelFor(inst.installation, idx, name), dbName: name, awal: Math.round((known || 50) * 1.05), real };
        })
      };
    });
    return {
      locked: true,
      availableYears: [],
      year,
      groups,
      meta: { '1': { ...DEFAULT_META, signPlaceDate: todaySignDate() }, '2': { ...DEFAULT_META, signPlaceDate: todaySignDate() } }
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
      wells: wells.map((name, idx) => {
        const real = new Array(12).fill(null);
        rows.forEach(r => {
          if (r.Bulan.slice(0, 4) === year && r[name] !== undefined && r[name] !== null) {
            real[monthIndexFromBulan(r.Bulan)] = r[name];
          }
        });
        const awal = debitAwalMap.get(inst.installation + ' ' + name);
        return { name: labelFor(inst.installation, idx, name), dbName: name, awal: awal !== undefined ? awal : null, real };
      })
    };
  });

  const globalMeta = { ...(await loadGlobalMeta() || DEFAULT_META), signPlaceDate: todaySignDate() };
  const meta = { '1': globalMeta, '2': globalMeta };

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

// Satu baris pengaturan ('global') untuk semua tahun & periode -- lihat
// catatan di META_KEY. Parameter period_key dari klien lama sudah tidak
// dipakai lagi, sengaja diabaikan supaya tidak perlu ubah admin-input.js.
async function saveMeta(_period_key, m) {
  await pool.query(
    `INSERT INTO kpi_ukur_debit_meta (period_key, keterangan, role_left, name_left, role_right, name_right, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, now())
     ON CONFLICT (period_key) DO UPDATE SET
       keterangan = EXCLUDED.keterangan,
       role_left = EXCLUDED.role_left, name_left = EXCLUDED.name_left,
       role_right = EXCLUDED.role_right, name_right = EXCLUDED.name_right,
       updated_at = now()`,
    [META_KEY, JSON.stringify(m.keterangan || []), m.roleLeft || '', m.nameLeft || '', m.roleRight || '', m.nameRight || '']
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
// 'hair' -- garis paling tipis yang ada di Excel, dipakai 18.3A APATD.xlsx
// asli untuk pembatas ANTAR baris data (kelihatan seperti putus-putus
// kecil, beda dari garis kotak luar/antar kolom yang 'thin' solid).
const HAIR = { style: 'hair', color: { argb: 'FF000000' } };
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
  let no = 0;
  const jumlahRows = [];
  data.groups.forEach(g => {
    no++;
    ws.getCell(`A${r}`).value = no;
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

  // Label ("Mengetahui/Menyetujui :") dan jabatan ("Manajer Produksi") sengaja
  // DUA sel terpisah, persis seperti D48/D49 di file asli -- jangan digabung
  // jadi satu cell, sudah pernah salah begitu dan bikin jabatan hilang.
  const roleRow = dibuatRow + 1;
  ws.mergeCells(`D${roleRow}:F${roleRow}`);
  ws.getCell(`D${roleRow}`).value = 'Mengetahui/Menyetujui :';
  ws.getCell(`D${roleRow}`).font = { size: 12, name: TNR };
  ws.getCell(`D${roleRow}`).alignment = { horizontal: 'center' };

  ws.mergeCells(`R${roleRow}:T${roleRow + 1}`);
  ws.getCell(`R${roleRow}`).value = meta.roleRight || '';
  ws.getCell(`R${roleRow}`).font = { size: 12, name: TNR };
  ws.getCell(`R${roleRow}`).alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };

  const roleLeftRow = roleRow + 1;
  ws.mergeCells(`D${roleLeftRow}:F${roleLeftRow}`);
  ws.getCell(`D${roleLeftRow}`).value = meta.roleLeft || '';
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

// ===========================================================================
// KPI 18.3a Monitoring Debit Air Permukaan (AP) & Air Tanah Dalam (ATD)
// (apps/kpi-sab/apatd.html). Beda dengan 18.2 -- laporan ini TIDAK punya
// angka yang perlu diedit admin sama sekali. Real per instalasi per bulan
// datang langsung dari tabel air_permukaan/air_tanah_dalam (dataset 'ap'/
// 'atd' di columns.js, sama yang dipakai apps/riwayat-air-baku), yang
// sudah diisi admin lewat apps/input-air-baku.html. Yang disimpan di sini
// cuma satu hal: kpi_apatd_meta (Keterangan & Penandatangan, global -- lihat
// catatan META_KEY di atas, pola yang sama persis dipakai di sini).
// ===========================================================================

function monthIndexFromBulan18_3a(bulan) { return Number(bulan.slice(5, 7)) - 1; }

function pivotApatdGroup(source, rows, year) {
  return source.columns.map(c => {
    const values = new Array(12).fill(null);
    rows.forEach(r => {
      if (r.Bulan.slice(0, 4) === year && r[c.csv] !== undefined && r[c.csv] !== null) {
        values[monthIndexFromBulan18_3a(r.Bulan)] = r[c.csv];
      }
    });
    return { label: c.label, values };
  });
}

const APATD_META_KEY = 'global';

// Label tetap ("Mengetahui" / "Direkap oleh") persis seperti kolom D27/G27 di
// 18.3A APATD.xlsx asli -- BEDA dari 18.2 ("Mengetahui/Menyetujui :" / "Dibuat
// oleh"), jadi disimpan di sini, bukan dipakai bareng DEFAULT_META di atas.
const APATD_LABEL_LEFT = 'Mengetahui';
const APATD_LABEL_RIGHT = 'Direkap oleh';
const DEFAULT_APATD_META = {
  keterangan: [],
  roleLeft: 'Manajer Produksi',
  nameLeft: '',
  roleRight: 'Supervisor Sumber Air Baku & Lingkungan',
  nameRight: ''
};

async function loadGlobalApatdMeta() {
  const { rows } = await pool.query('SELECT * FROM kpi_apatd_meta WHERE period_key = $1', [APATD_META_KEY]);
  if (!rows[0]) return null;
  const r = rows[0];
  return {
    keterangan: r.keterangan || [],
    roleLeft: r.role_left || '',
    nameLeft: r.name_left || '',
    roleRight: r.role_right || '',
    nameRight: r.name_right || ''
  };
}

async function saveApatdMeta(m) {
  await pool.query(
    `INSERT INTO kpi_apatd_meta (period_key, keterangan, role_left, name_left, role_right, name_right, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, now())
     ON CONFLICT (period_key) DO UPDATE SET
       keterangan = EXCLUDED.keterangan,
       role_left = EXCLUDED.role_left, name_left = EXCLUDED.name_left,
       role_right = EXCLUDED.role_right, name_right = EXCLUDED.name_right,
       updated_at = now()`,
    [APATD_META_KEY, JSON.stringify(m.keterangan || []), m.roleLeft || '', m.nameLeft || '', m.roleRight || '', m.nameRight || '']
  );
}

async function getKpiApatdData(access, tahunQuery) {
  if (!access.granted) {
    const year = tahunQuery || String(new Date().getFullYear());
    const apRows = buildDummyRows(DATASETS.ap);
    const atdRows = buildDummyRows(DATASETS.atd);
    return {
      locked: true,
      availableYears: [],
      year,
      groups: [
        { key: 'ap', label: DATASETS.ap.label, items: pivotApatdGroup(DATASETS.ap, apRows, year) },
        { key: 'atd', label: DATASETS.atd.label, items: pivotApatdGroup(DATASETS.atd, atdRows, year) }
      ],
      meta: { ...DEFAULT_APATD_META, labelLeft: APATD_LABEL_LEFT, labelRight: APATD_LABEL_RIGHT, signPlaceDate: todaySignDate() }
    };
  }

  const [apRows, atdRows] = await Promise.all([fetchRealRows(DATASETS.ap), fetchRealRows(DATASETS.atd)]);

  const availableYearsSet = new Set();
  apRows.forEach(r => availableYearsSet.add(r.Bulan.slice(0, 4)));
  atdRows.forEach(r => availableYearsSet.add(r.Bulan.slice(0, 4)));
  const availableYears = Array.from(availableYearsSet).sort();
  const currentRealYear = String(new Date().getFullYear());
  if (!availableYears.includes(currentRealYear)) availableYears.push(currentRealYear);
  availableYears.sort();

  const year = tahunQuery || availableYears[availableYears.length - 1];

  const meta = { ...(await loadGlobalApatdMeta() || DEFAULT_APATD_META), labelLeft: APATD_LABEL_LEFT, labelRight: APATD_LABEL_RIGHT, signPlaceDate: todaySignDate() };

  await Promise.all([logViewerAction(access, 'ap', 'view'), logViewerAction(access, 'atd', 'view')]);

  return {
    locked: false,
    availableYears,
    year,
    groups: [
      { key: 'ap', label: DATASETS.ap.label, items: pivotApatdGroup(DATASETS.ap, apRows, year) },
      { key: 'atd', label: DATASETS.atd.label, items: pivotApatdGroup(DATASETS.atd, atdRows, year) }
    ],
    meta
  };
}

// --- Unduh Excel 18.3A APATD -- exceljs di server, alasan sama persis
// seperti buildKpiExcelWorkbook di atas. ---
const APATD_COL_WIDTHS = [8.66, 24.44, 18.66, 18.66, 18.66, 18.66, 18.66, 18.66];

function buildApatdSubTable(ws, r, judul, judulBulan, group, monthBase) {
  ws.mergeCells(`A${r}:H${r}`);
  ws.getCell(`A${r}`).value = judul;
  ws.getCell(`A${r}`).font = { bold: true, size: 13, name: TNR };
  ws.getCell(`A${r}`).alignment = { horizontal: 'center' };
  r++;

  ws.mergeCells(`A${r}:H${r}`);
  ws.getCell(`A${r}`).value = judulBulan;
  ws.getCell(`A${r}`).font = { bold: true, size: 11, name: TNR };
  ws.getCell(`A${r}`).alignment = { horizontal: 'center' };
  r++;

  const headRow1 = r, headRow2 = r + 1;
  ws.mergeCells(`A${headRow1}:A${headRow2}`);
  ws.getCell(`A${headRow1}`).value = 'NO';
  ws.mergeCells(`B${headRow1}:B${headRow2}`);
  ws.getCell(`B${headRow1}`).value = 'INSTALASI PENGOLAHAN';
  MONTHS_ID.slice(monthBase, monthBase + 6).forEach((mn, i) => {
    const col = colLetter(3 + i);
    ws.getCell(`${col}${headRow1}`).value = mn;
    ws.getCell(`${col}${headRow2}`).value = '( M3 )';
  });
  // Header: persis file asli -- baris nama bulan cuma punya border ATAS
  // (thin), baris satuan (M3) cuma punya border BAWAH (thin), garis kotak
  // (left/right) tetap di kedua baris. Kolom NO & INSTALASI PENGOLAHAN
  // beda: sel-nya di-merge 2 baris (A/B headRow1:headRow2), dan exceljs
  // menyimpan style merge sebagai SATU sel bersama -- nulis border dua kali
  // (headRow1 lalu headRow2) akan saling menimpa, bukan tergabung -- jadi
  // ditulis SEKALI sebagai kotak penuh (top+bottom), bukan split per baris.
  for (let c = 1; c <= 8; c++) {
    const isMergedCol = c <= 2;
    const cell1 = ws.getRow(headRow1).getCell(c);
    cell1.font = { bold: true, size: 11, name: TNR };
    cell1.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    const cell2 = ws.getRow(headRow2).getCell(c);
    cell2.font = { bold: true, size: 11, name: TNR };
    cell2.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };

    if (isMergedCol) {
      cell1.border = { left: THIN, right: THIN, top: THIN, bottom: THIN };
    } else {
      cell1.border = { left: THIN, right: THIN, top: THIN };
      cell2.border = { left: THIN, right: THIN, bottom: THIN };
    }
  }
  r = headRow2 + 1;

  const firstRow = r;
  const sums = new Array(6).fill(0);
  const anyByMonth = new Array(6).fill(false);
  group.items.forEach((item, i) => {
    ws.getCell(`A${r}`).value = i + 1;
    ws.getCell(`B${r}`).value = item.label;
    for (let m = 0; m < 6; m++) {
      const col = colLetter(3 + m);
      const cell = ws.getCell(`${col}${r}`);
      const v = item.values[monthBase + m];
      if (v !== null && v !== undefined) { cell.value = v; sums[m] += v; anyByMonth[m] = true; }
      cell.numFmt = '#,##0';
    }
    r++;
  });
  const lastRow = r - 1;

  // Baris data: garis ANTAR baris pakai 'hair' (tipis, persis file asli),
  // cuma baris paling bawah (nempel JUMLAH) yang 'thin' solid -- lihat HAIR
  // di atas.
  for (let rr = firstRow; rr <= lastRow; rr++) {
    for (let c = 1; c <= 8; c++) {
      const cell = ws.getRow(rr).getCell(c);
      if (!cell.font) cell.font = { size: 11, name: TNR };
      cell.alignment = cell.alignment || { horizontal: 'center' };
      cell.border = { left: THIN, right: THIN, top: HAIR, bottom: rr === lastRow ? THIN : HAIR };
    }
  }

  ws.getCell(`B${r}`).value = 'Jumlah';
  for (let m = 0; m < 6; m++) {
    const col = colLetter(3 + m);
    const cell = ws.getCell(`${col}${r}`);
    // formula TETAP ditulis (supaya ikut kalkulasi ulang kalau datanya
    // berubah), tapi result-nya juga diisi langsung dari total yang sudah
    // dihitung di server -- exceljs tidak pernah menaruh cached value untuk
    // formula yang ditulisnya sendiri, jadi tanpa ini JUMLAH tampil kosong
    // di pembaca Excel yang tidak menjalankan ulang kalkulasi saat dibuka.
    cell.value = { formula: `IF(COUNT(${col}${firstRow}:${col}${lastRow})=0,"",SUM(${col}${firstRow}:${col}${lastRow}))`, result: anyByMonth[m] ? sums[m] : '' };
    cell.numFmt = '#,##0';
    cell.border = { left: THIN, right: THIN, bottom: THIN };
    cell.font = { bold: true, size: 11, name: TNR };
    cell.alignment = { horizontal: 'center' };
  }
  ws.getCell(`A${r}`).border = { left: THIN, right: THIN, bottom: THIN };
  ws.getCell(`B${r}`).border = { left: THIN, right: THIN, bottom: THIN };
  ws.getCell(`A${r}`).font = { bold: true, size: 11, name: TNR };
  ws.getCell(`B${r}`).font = { bold: true, size: 11, name: TNR };
  ws.getCell(`A${r}`).alignment = { horizontal: 'center' };
  ws.getCell(`B${r}`).alignment = { horizontal: 'center' };

  return r + 1;
}

function buildApatdSignBlock(ws, r, meta) {
  const ketHeaderRow = r;
  ws.getCell(`B${ketHeaderRow}`).value = 'Keterangan :';
  ws.getCell(`B${ketHeaderRow}`).font = { size: 11, name: TNR };
  r++;
  (meta.keterangan || []).forEach(k => {
    ws.getCell(`B${r}`).value = '~ ' + k;
    ws.getCell(`B${r}`).font = { size: 11, name: TNR };
    r++;
  });
  let lastKetRow = r - 1;
  if (lastKetRow < ketHeaderRow) lastKetRow = ketHeaderRow;

  ws.mergeCells(`G${lastKetRow}:H${lastKetRow}`);
  ws.getCell(`G${lastKetRow}`).value = meta.signPlaceDate || '';
  ws.getCell(`G${lastKetRow}`).font = { size: 11, name: 'Calibri' };
  ws.getCell(`G${lastKetRow}`).alignment = { horizontal: 'center' };

  const labelRow = lastKetRow + 1;
  ws.mergeCells(`A${labelRow}:C${labelRow}`);
  ws.getCell(`A${labelRow}`).value = APATD_LABEL_LEFT;
  ws.getCell(`A${labelRow}`).font = { size: 11, name: TNR };
  ws.getCell(`A${labelRow}`).alignment = { horizontal: 'center' };

  ws.mergeCells(`G${labelRow}:H${labelRow}`);
  ws.getCell(`G${labelRow}`).value = APATD_LABEL_RIGHT;
  ws.getCell(`G${labelRow}`).font = { size: 11, name: TNR };
  ws.getCell(`G${labelRow}`).alignment = { horizontal: 'center' };

  const roleRow = labelRow + 1;
  ws.mergeCells(`A${roleRow}:C${roleRow}`);
  ws.getCell(`A${roleRow}`).value = meta.roleLeft || '';
  ws.getCell(`A${roleRow}`).font = { size: 11, name: TNR };
  ws.getCell(`A${roleRow}`).alignment = { horizontal: 'center' };

  ws.mergeCells(`G${roleRow}:H${roleRow + 1}`);
  ws.getCell(`G${roleRow}`).value = meta.roleRight || '';
  ws.getCell(`G${roleRow}`).font = { size: 11, name: TNR };
  ws.getCell(`G${roleRow}`).alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };

  const nameRow = roleRow + 5;
  ws.mergeCells(`A${nameRow}:C${nameRow}`);
  ws.getCell(`A${nameRow}`).value = meta.nameLeft || '';
  ws.getCell(`A${nameRow}`).font = { bold: true, size: 11, name: TNR };
  ws.getCell(`A${nameRow}`).alignment = { horizontal: 'center' };

  ws.mergeCells(`G${nameRow}:H${nameRow}`);
  ws.getCell(`G${nameRow}`).value = meta.nameRight || '';
  ws.getCell(`G${nameRow}`).font = { bold: true, size: 11, name: TNR };
  ws.getCell(`G${nameRow}`).alignment = { horizontal: 'center' };

  return nameRow + 2;
}

function buildApatdExcelBlock(ws, rowOffset, judulBulan, data, monthBase) {
  const R = r => r + rowOffset;
  ws.getCell(`A${R(1)}`).value = 'PERUSAHAAN UMUM DAERAH TIRTA MANUNTUNG';
  ws.getCell(`A${R(1)}`).font = { bold: true, size: 12, name: 'Arial' };
  ws.getCell(`A${R(2)}`).value = 'KOTA BALIKPAPAN';
  ws.getCell(`A${R(2)}`).font = { bold: true, size: 12, name: 'Arial' };

  let r = R(4);
  r = buildApatdSubTable(ws, r, '18.3a MONITORING DEBIT AIR PERMUKAAN ( AP )', judulBulan, data.groups[0], monthBase);
  r++;
  r = buildApatdSubTable(ws, r, '18.3a MONITORING DEBIT AIR TANAH DALAM ( ATD )', judulBulan, data.groups[1], monthBase);
  r++;
  return buildApatdSignBlock(ws, r, data.meta);
}

async function buildKpiApatdExcelWorkbook(data) {
  const wb = new ExcelJS.Workbook();
  wb.calcProperties.fullCalcOnLoad = true;
  const ws = wb.addWorksheet('18.3A APATD', { pageSetup: { orientation: 'landscape', fitToPage: true } });
  APATD_COL_WIDTHS.forEach((w, i) => { ws.getColumn(i + 1).width = w; });

  const nextRow = buildApatdExcelBlock(ws, 0, `BULAN Januari - Juni ${data.year}`, data, 0);
  const rowOffset2 = nextRow + 1;
  buildApatdExcelBlock(ws, rowOffset2, `BULAN Juli - Desember ${data.year}`, data, 6);

  return wb.xlsx.writeBuffer();
}

// ===========================================================================
// KPI 18.3b Pengambilan Air Baku (apps/kpi-sab/pengambilan.html). Realisasi
// per bulan = TOTAL Air Permukaan (AP) atau TOTAL Air Tanah Dalam (ATD),
// dihitung ulang dari air_permukaan/air_tanah_dalam (dataset 'ap'/'atd' di
// columns.js) -- sama seperti JUMLAH di 18.3a APATD, cuma dijumlah lagi di
// sini (tidak disimpan sendiri). Anggaran-nya BUKAN angka tetap, tapi aturan
// "jumlah hari dalam bulan itu -> nilai anggaran" (lihat catatan
// kpi_pengambilan_target di lib/db.js) -- nilainya diisi admin lewat panel
// Pengaturan Anggaran di halaman ini, satu set untuk sepanjang tahun.
// ===========================================================================

const PENGAMBILAN_DAY_COUNTS = [31, 30, 29, 28];

function daysInMonth(year, monthIndex) {
  // monthIndex 0-based (0 = Januari). Hari ke-0 bulan berikutnya = hari
  // terakhir bulan ini -- otomatis benar untuk tahun kabisat (Februari 29).
  return new Date(Number(year), monthIndex + 1, 0).getDate();
}

// Total per bulan (0-11) dari baris 'wide' (bentuk { Bulan:'YYYY-MM', <csv>: n, ... }),
// dipakai baik untuk data asli (fetchRealRows) maupun dummy (buildDummyRows) --
// bentuknya sama persis. Kalau tidak ada satu pun kolom terisi di bulan itu,
// hasilnya null (bukan 0) supaya beda dengan "realisasi memang nol".
function sumRealByMonth(source, rows, year) {
  const totals = new Array(12).fill(null);
  rows.forEach(r => {
    if (r.Bulan.slice(0, 4) !== year) return;
    const mi = Number(r.Bulan.slice(5, 7)) - 1;
    let sum = 0, any = false;
    source.columns.forEach(c => {
      const v = r[c.csv];
      if (v !== null && v !== undefined) { sum += v; any = true; }
    });
    if (any) totals[mi] = sum;
  });
  return totals;
}

async function loadPengambilanTargets() {
  const { rows } = await pool.query('SELECT day_count, ap_value, atd_value FROM kpi_pengambilan_target');
  const map = {};
  PENGAMBILAN_DAY_COUNTS.forEach(dc => { map[dc] = { ap: null, atd: null }; });
  rows.forEach(r => {
    map[r.day_count] = {
      ap: r.ap_value !== null && r.ap_value !== undefined ? Number(r.ap_value) : null,
      atd: r.atd_value !== null && r.atd_value !== undefined ? Number(r.atd_value) : null
    };
  });
  return map;
}

async function savePengambilanTarget(day_count, ap_value, atd_value) {
  await pool.query(
    `INSERT INTO kpi_pengambilan_target (day_count, ap_value, atd_value, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (day_count) DO UPDATE SET ap_value = EXCLUDED.ap_value, atd_value = EXCLUDED.atd_value, updated_at = now()`,
    [day_count, ap_value, atd_value]
  );
}

function anggaranFor(source, year, monthIndex, targetsMap) {
  const dc = daysInMonth(year, monthIndex);
  const entry = targetsMap[dc];
  return entry ? entry[source] : null;
}

const PENGAMBILAN_META_KEY = 'global';

// Label tetap persis kolom B16/V17 di 18.3B Pengambilan Air Baku.xlsx asli --
// BEDA dari 18.2 ("Mengetahui/Menyetujui :" / "Dibuat oleh") dan dari 18.3a
// ("Mengetahui" / "Direkap oleh"), jadi punya tabel meta sendiri.
const PENGAMBILAN_LABEL_LEFT = 'Mengetahui';
const PENGAMBILAN_LABEL_RIGHT = 'Dibuat Oleh :';
const DEFAULT_PENGAMBILAN_META = {
  keterangan: [],
  roleLeft: 'Manajer Produksi',
  nameLeft: '',
  roleRight: 'Supervisor Sumber Air Baku & Lingkungan',
  nameRight: ''
};

async function loadGlobalPengambilanMeta() {
  const { rows } = await pool.query('SELECT * FROM kpi_pengambilan_meta WHERE period_key = $1', [PENGAMBILAN_META_KEY]);
  if (!rows[0]) return null;
  const r = rows[0];
  return {
    keterangan: r.keterangan || [],
    roleLeft: r.role_left || '',
    nameLeft: r.name_left || '',
    roleRight: r.role_right || '',
    nameRight: r.name_right || ''
  };
}

async function savePengambilanMeta(m) {
  await pool.query(
    `INSERT INTO kpi_pengambilan_meta (period_key, keterangan, role_left, name_left, role_right, name_right, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, now())
     ON CONFLICT (period_key) DO UPDATE SET
       keterangan = EXCLUDED.keterangan,
       role_left = EXCLUDED.role_left, name_left = EXCLUDED.name_left,
       role_right = EXCLUDED.role_right, name_right = EXCLUDED.name_right,
       updated_at = now()`,
    [PENGAMBILAN_META_KEY, JSON.stringify(m.keterangan || []), m.roleLeft || '', m.nameLeft || '', m.roleRight || '', m.nameRight || '']
  );
}

async function getKpiPengambilanData(access, tahunQuery) {
  if (!access.granted) {
    // Sama seperti Debit Awal di 18.2 -- kalau belum ada akses, Anggaran
    // (angka target admin) juga TIDAK ditampilkan asli, dibuat dari
    // Realisasi dummy * faktor supaya rasionya tetap terlihat wajar.
    const year = tahunQuery || String(new Date().getFullYear());
    const apRows = buildDummyRows(DATASETS.ap);
    const atdRows = buildDummyRows(DATASETS.atd);
    const apReal = sumRealByMonth(DATASETS.ap, apRows, year);
    const atdReal = sumRealByMonth(DATASETS.atd, atdRows, year);
    const fakeAngg = real => real.map(v => (v !== null ? Math.round(v * 1.06) : null));
    return {
      locked: true,
      availableYears: [],
      year,
      groups: [
        { key: 'ap', label: 'Air Permukaan', real: apReal, angg: fakeAngg(apReal) },
        { key: 'atd', label: 'Air Tanah Dalam', real: atdReal, angg: fakeAngg(atdReal) }
      ],
      targets: (() => { const m = {}; PENGAMBILAN_DAY_COUNTS.forEach(dc => { m[dc] = { ap: null, atd: null }; }); return m; })(),
      meta: { ...DEFAULT_PENGAMBILAN_META, labelLeft: PENGAMBILAN_LABEL_LEFT, labelRight: PENGAMBILAN_LABEL_RIGHT, signPlaceDate: todaySignDate() }
    };
  }

  const [apRows, atdRows, targetsMap] = await Promise.all([
    fetchRealRows(DATASETS.ap),
    fetchRealRows(DATASETS.atd),
    loadPengambilanTargets()
  ]);

  const availableYearsSet = new Set();
  apRows.forEach(r => availableYearsSet.add(r.Bulan.slice(0, 4)));
  atdRows.forEach(r => availableYearsSet.add(r.Bulan.slice(0, 4)));
  const availableYears = Array.from(availableYearsSet).sort();
  const currentRealYear = String(new Date().getFullYear());
  if (!availableYears.includes(currentRealYear)) availableYears.push(currentRealYear);
  availableYears.sort();

  const year = tahunQuery || availableYears[availableYears.length - 1];

  const apReal = sumRealByMonth(DATASETS.ap, apRows, year);
  const atdReal = sumRealByMonth(DATASETS.atd, atdRows, year);
  const apAngg = [...Array(12).keys()].map(mi => anggaranFor('ap', year, mi, targetsMap));
  const atdAngg = [...Array(12).keys()].map(mi => anggaranFor('atd', year, mi, targetsMap));

  const meta = { ...(await loadGlobalPengambilanMeta() || DEFAULT_PENGAMBILAN_META), labelLeft: PENGAMBILAN_LABEL_LEFT, labelRight: PENGAMBILAN_LABEL_RIGHT, signPlaceDate: todaySignDate() };

  await logViewerAction(access, 'kpi_pengambilan', 'view');

  return {
    locked: false,
    availableYears,
    year,
    groups: [
      { key: 'ap', label: 'Air Permukaan', real: apReal, angg: apAngg },
      { key: 'atd', label: 'Air Tanah Dalam', real: atdReal, angg: atdAngg }
    ],
    targets: targetsMap,
    meta
  };
}

// --- Unduh Excel 18.3B Pengambilan Air Baku -- exceljs di server, alasan
// sama persis seperti buildKpiExcelWorkbook/buildKpiApatdExcelWorkbook. ---
// 2 kolom tetap (NO, URAIAN) + 6 bulan x 4 kolom (ANGG/REAL/±/%) = 26 kolom (A-Z).
// URAIAN 140px, C-Z 85px -- dikonversi ke satuan lebar kolom Excel (karakter)
// pakai rumus standar (pixel - 5) / 7 (MDW Calibri 11 = 7px): 140px -> 19.29,
// 85px -> 11.43.
const PENGAMBILAN_COL_WIDTHS = [4.33, 19.29]
  .concat(Array(24).fill(11.43));

function pengambilanMonthCols(i) { const base = 3 + i * 4; return { angg: base, real: base + 1, pm: base + 2, pct: base + 3 }; }

function buildPengambilanExcelBlock(ws, rowOffset, monthNames, monthBase, judulBulan, data) {
  const R = r => r + rowOffset;

  ws.getCell(`A${R(1)}`).value = 'PERUSAHAAN UMUM DAERAH TIRTA MANUNTUNG';
  ws.getCell(`A${R(1)}`).font = { bold: true, size: 12, name: 'Arial' };
  ws.getCell(`A${R(2)}`).value = 'KOTA BALIKPAPAN';
  ws.getCell(`A${R(2)}`).font = { bold: true, size: 12, name: 'Arial' };

  ws.mergeCells(`A${R(4)}:Z${R(4)}`);
  ws.getCell(`A${R(4)}`).value = '18.3b LAPORAN PENGAMBILAN AIR Baku & Lingkungan';
  ws.getCell(`A${R(4)}`).font = { bold: true, size: 14, name: TNR };
  ws.getCell(`A${R(4)}`).alignment = { horizontal: 'center' };

  ws.mergeCells(`A${R(5)}:Z${R(5)}`);
  ws.getCell(`A${R(5)}`).value = judulBulan;
  ws.getCell(`A${R(5)}`).font = { bold: true, size: 12, name: TNR };
  ws.getCell(`A${R(5)}`).alignment = { horizontal: 'center' };

  const headerRows = [R(7), R(8), R(9)];
  ws.mergeCells(`A${R(7)}:A${R(9)}`);
  ws.getCell(`A${R(7)}`).value = 'NO';
  ws.mergeCells(`B${R(7)}:B${R(9)}`);
  ws.getCell(`B${R(7)}`).value = 'URAIAN';

  monthNames.forEach((mn, i) => {
    const { angg, real, pm, pct } = pengambilanMonthCols(i);
    const c1 = colLetter(angg), c4 = colLetter(pct);
    ws.mergeCells(`${c1}${R(7)}:${c4}${R(7)}`);
    ws.getCell(`${c1}${R(7)}`).value = mn;
    ws.getCell(`${c1}${R(8)}`).value = 'ANGG';
    ws.getCell(`${colLetter(real)}${R(8)}`).value = 'REAL';
    ws.mergeCells(`${colLetter(pm)}${R(8)}:${c4}${R(8)}`);
    ws.getCell(`${colLetter(pm)}${R(8)}`).value = 'RATIO EFFISIENSI';
    ws.getCell(`${c1}${R(9)}`).value = 'm3';
    ws.getCell(`${colLetter(real)}${R(9)}`).value = 'm3';
    ws.getCell(`${colLetter(pm)}${R(9)}`).value = '±';
    ws.getCell(`${c4}${R(9)}`).value = '%';
  });

  headerRows.forEach(rr => {
    const row = ws.getRow(rr);
    for (let c = 1; c <= 26; c++) {
      const cell = row.getCell(c);
      cell.font = { bold: true, size: 11, name: TNR };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = GRID;
    }
  });
  ws.getRow(R(7)).height = 22;

  let r = R(10);
  data.groups.forEach((g, gi) => {
    ws.getCell(`A${r}`).value = gi + 1;
    ws.getCell(`B${r}`).value = g.label;
    monthNames.forEach((mn, i) => {
      const { angg, real, pm, pct } = pengambilanMonthCols(i);
      const ac = colLetter(angg), rc = colLetter(real), pmc = colLetter(pm), pctc = colLetter(pct);
      const anggVal = g.angg[monthBase + i];
      const realVal = g.real[monthBase + i];
      const anggCell = ws.getCell(`${ac}${r}`);
      if (anggVal !== null && anggVal !== undefined) anggCell.value = anggVal;
      const realCell = ws.getCell(`${rc}${r}`);
      if (realVal !== null && realVal !== undefined) realCell.value = realVal;
      ws.getCell(`${pmc}${r}`).value = { formula: `IF(OR(${rc}${r}="",${ac}${r}=""),"",${rc}${r}-${ac}${r})` };
      ws.getCell(`${pctc}${r}`).value = { formula: `IF(OR(${rc}${r}="",${ac}${r}=""),"",${rc}${r}/${ac}${r}*100)` };
      [anggCell, realCell, ws.getCell(`${pmc}${r}`), ws.getCell(`${pctc}${r}`)].forEach(c => { c.numFmt = '#,##0'; });
    });
    // Baris Air Permukaan / Air Tanah Dalam dibuat lebih tinggi (60) --
    // permintaan user, supaya lebih lega dibanding baris header di atasnya.
    ws.getRow(r).height = 60;
    r++;
  });

  for (let rr = R(10); rr <= r - 1; rr++) {
    for (let c = 1; c <= 26; c++) {
      const cell = ws.getRow(rr).getCell(c);
      if (!cell.font) cell.font = { size: 11, name: TNR };
      cell.alignment = cell.alignment || { horizontal: 'center' };
      cell.border = GRID;
    }
  }
  r++;

  const meta = data.meta;
  const ketHeaderRow = r; ws.getCell(`B${ketHeaderRow}`).value = 'Keterangan :'; ws.getCell(`B${ketHeaderRow}`).font = { size: 11, name: TNR }; r++;
  (meta.keterangan || []).forEach(k => {
    ws.getCell(`B${r}`).value = '~ ' + k;
    ws.getCell(`B${r}`).font = { size: 11, name: TNR };
    r++;
  });
  let lastKetRow = r - 1;
  if (lastKetRow < ketHeaderRow) lastKetRow = ketHeaderRow;

  ws.mergeCells(`W${lastKetRow}:Z${lastKetRow}`);
  ws.getCell(`W${lastKetRow}`).value = meta.signPlaceDate || '';
  ws.getCell(`W${lastKetRow}`).font = { size: 11, name: 'Calibri' };
  ws.getCell(`W${lastKetRow}`).alignment = { horizontal: 'center' };

  const labelRow = lastKetRow + 1;
  ws.mergeCells(`B${labelRow}:D${labelRow}`);
  ws.getCell(`B${labelRow}`).value = PENGAMBILAN_LABEL_LEFT;
  ws.getCell(`B${labelRow}`).font = { size: 11, name: TNR };
  ws.getCell(`B${labelRow}`).alignment = { horizontal: 'center' };

  ws.mergeCells(`W${labelRow}:Z${labelRow}`);
  ws.getCell(`W${labelRow}`).value = PENGAMBILAN_LABEL_RIGHT;
  ws.getCell(`W${labelRow}`).font = { size: 11, name: TNR };
  ws.getCell(`W${labelRow}`).alignment = { horizontal: 'center' };

  const roleRow = labelRow + 1;
  ws.mergeCells(`B${roleRow}:D${roleRow}`);
  ws.getCell(`B${roleRow}`).value = meta.roleLeft || '';
  ws.getCell(`B${roleRow}`).font = { size: 11, name: TNR };
  ws.getCell(`B${roleRow}`).alignment = { horizontal: 'center' };

  ws.mergeCells(`W${roleRow}:Z${roleRow + 1}`);
  ws.getCell(`W${roleRow}`).value = meta.roleRight || '';
  ws.getCell(`W${roleRow}`).font = { size: 11, name: TNR };
  ws.getCell(`W${roleRow}`).alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };

  // Merge NAMA sengaja sama lebar (B:D) dengan merge LABEL "Mengetahui" dan
  // JABATAN di atasnya -- sebelumnya B:F (lebih lebar), jadi titik tengahnya
  // beda dan nama kelihatan tidak center terhadap "Mengetahui"/jabatan.
  const nameRow = roleRow + 5;
  ws.mergeCells(`B${nameRow}:D${nameRow}`);
  ws.getCell(`B${nameRow}`).value = meta.nameLeft || '';
  ws.getCell(`B${nameRow}`).font = { bold: true, size: 11, name: TNR };
  ws.getCell(`B${nameRow}`).alignment = { horizontal: 'center' };

  ws.mergeCells(`W${nameRow}:Z${nameRow}`);
  ws.getCell(`W${nameRow}`).value = meta.nameRight || '';
  ws.getCell(`W${nameRow}`).font = { bold: true, size: 11, name: TNR };
  ws.getCell(`W${nameRow}`).alignment = { horizontal: 'center' };

  return nameRow + 2;
}

async function buildKpiPengambilanExcelWorkbook(data) {
  const wb = new ExcelJS.Workbook();
  wb.calcProperties.fullCalcOnLoad = true;
  const ws = wb.addWorksheet('18.3B PENGAMBILAN AIR BAKU', { pageSetup: { orientation: 'landscape', fitToPage: true } });
  PENGAMBILAN_COL_WIDTHS.forEach((w, i) => { ws.getColumn(i + 1).width = w; });

  const nextRow = buildPengambilanExcelBlock(ws, 0, MONTHS_ID.slice(0, 6), 0, `BULAN : Januari - Juni ${data.year}`, data);
  const rowOffset2 = nextRow + 1;
  buildPengambilanExcelBlock(ws, rowOffset2, MONTHS_ID.slice(6, 12), 6, `BULAN : Juli - Desember ${data.year}`, data);

  return wb.xlsx.writeBuffer();
}

// ===========================================================================
// KPI 18.4 Laporan Kualitas Air Baku (apps/kpi-sab/kualitas.html). Level/NTU/
// PH harian datang dari dataset yang SAMA dipakai apps/riwayat-air-baku
// (manggar_level/manggar_ntu/manggar_ph/teritip_level/teritip_ntu/teritip_ph
// di columns.js, lewat fetchWideSingleRows) -- laporan ini TIDAK menyimpan
// angka sendiri, cuma merata-ratakan per bulan (avgWideSingleByMonth) untuk
// tabel ringkasan di web, dan dipakai APA ADANYA per hari (wideSingleDateMap)
// untuk unduhan Excel yang meniru format 18.4 asli persis (blok harian).
//
// Status ON/OFF pintu elevasi 3/5/7 per lokasi BUKAN data per hari (dense),
// tapi LOG PERUBAHAN status (kualitas_elevasi_log) -- sekali admin meng-ON
// kan elevasi tertentu, status itu "menempel" terus (termasuk bulan/tahun
// berikutnya) sampai admin meng-OFF kan lagi, TIDAK reset tiap hari/bulan.
// Ada kasus operator harus buka pintu elevasi lebih rendah (mis. elevasi 5)
// kalau air di elevasi atas keruh, jadi BISA lebih dari satu elevasi ON
// bersamaan (bukan pilihan tunggal). Status efektif di tanggal manapun
// dihitung dengan forward-fill dari log (buildElevasiDailyForYear) --
// BUKAN lewat Input Massal seperti Level/NTU/PH, karena ini status
// operasional (kapan pintu dibuka/ditutup), bukan hasil ukur harian.
// ===========================================================================

const KUALITAS_ELEVASI_LIST = [3, 5, 7];
const KUALITAS_LOCATIONS = [
  { key: 'manggar', label: 'Waduk Manggar', sheet: 'Waduk Manggar', levelDs: 'manggar_level', ntuDs: 'manggar_ntu', phDs: 'manggar_ph',
    title: '18.4a LAPORAN KWALITAS AIR Baku & Lingkungan WADUK MANGGAR' },
  { key: 'teritip', label: 'Waduk Teritip', sheet: 'Waduk Teritip', levelDs: 'teritip_level', ntuDs: 'teritip_ntu', phDs: 'teritip_ph',
    title: '18.4b LAPORAN KWALITAS AIR Baku & Lingkungan WADUK TERITIP' }
];

// Laporan 18.4 mulai dipakai Juli 2026 (permintaan user) -- bulan sebelum ini
// tidak ditawarkan di pemilih, walau data mentah lama tetap ada di DB (dipakai
// laporan lain). Pemilih bulan tumbuh otomatis tiap bulan berjalan.
const KUALITAS_START_YM = '2026-07';
const MONTHS_TITLE = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

function pad2(n) { return n < 10 ? '0' + n : '' + n; }
function ymToIndex(ym) { const [y, m] = ym.split('-').map(Number); return y * 12 + (m - 1); }
function indexToYm(idx) { return `${Math.floor(idx / 12)}-${pad2((idx % 12) + 1)}`; }

// Bulan berjalan di zona WITA (server Vercel jalan di UTC) -- sama alasannya
// dengan todaySignDate.
function currentYmWITA() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Makassar', year: 'numeric', month: '2-digit' }).format(new Date()).slice(0, 7);
}

function buildAvailableMonths(uptoYm) {
  const start = ymToIndex(KUALITAS_START_YM);
  const end = Math.max(ymToIndex(uptoYm), start);
  const list = [];
  for (let i = start; i <= end; i++) list.push(indexToYm(i));
  return list;
}

// Peta tanggal -> nilai untuk SATU bulan (ym = 'YYYY-MM'), dari baris
// 'wide-single' harian ({ Tanggal:'YYYY-MM-DD', <csvCol>: n }).
function wideSingleMonthMap(rows, dateKey, valueKey, ym) {
  const map = {};
  rows.forEach(r => {
    const d = r[dateKey];
    if (!d || d.slice(0, 7) !== ym) return;
    const v = r[valueKey];
    if (v !== null && v !== undefined) map[d] = v;
  });
  return map;
}

// Ambil semua log perubahan status sampai tanggal tertentu (ASC) -- dipakai
// forward-fill, termasuk perubahan dari bulan/tahun SEBELUMNYA (supaya status
// yang di-ON kan bulan lalu tetap kebaca ON di bulan ini kalau belum pernah
// di-OFF kan lagi).
async function loadKualitasElevasiEvents(uptoDateStr) {
  const { rows } = await pool.query(
    `SELECT lokasi, elevasi, to_char(tanggal_mulai, 'YYYY-MM-DD') as tanggal_mulai, status
     FROM kualitas_elevasi_log
     WHERE tanggal_mulai <= $1
     ORDER BY tanggal_mulai ASC`,
    [uptoDateStr]
  );
  return rows;
}

// Forward-fill untuk SATU bulan: tiap tanggal dapat status elevasi TERAKHIR
// yang berlaku sampai tanggal itu (bisa dari bulan/tahun sebelumnya kalau
// belum pernah diubah lagi) -- BUKAN reset tiap hari/bulan. Kembalikan peta
// ds -> { manggar:{3,5,7}, teritip:{3,5,7} } untuk semua hari di bulan itu.
function buildElevasiDailyForMonth(events, year, monthIndex) {
  const state = { manggar: { 3: false, 5: false, 7: false }, teritip: { 3: false, 5: false, 7: false } };
  const monthStart = `${year}-${pad2(monthIndex + 1)}-01`;
  const byDate = new Map();
  events.forEach(e => {
    if (e.tanggal_mulai < monthStart) {
      state[e.lokasi][e.elevasi] = e.status;
    } else {
      if (!byDate.has(e.tanggal_mulai)) byDate.set(e.tanggal_mulai, []);
      byDate.get(e.tanggal_mulai).push(e);
    }
  });
  const days = daysInMonth(year, monthIndex);
  const map = {};
  for (let d = 1; d <= days; d++) {
    const ds = `${year}-${pad2(monthIndex + 1)}-${pad2(d)}`;
    if (byDate.has(ds)) byDate.get(ds).forEach(e => { state[e.lokasi][e.elevasi] = e.status; });
    map[ds] = {
      manggar: { 3: state.manggar[3], 5: state.manggar[5], 7: state.manggar[7] },
      teritip: { 3: state.teritip[3], 5: state.teritip[5], 7: state.teritip[7] }
    };
  }
  return map;
}

// Menulis SATU baris log perubahan -- klik ulang di tanggal yang SAMA menimpa
// baris itu juga (ON CONFLICT), tidak menumpuk baris duplikat. Efeknya
// "menempel" ke depan otomatis lewat forward-fill di atas, TIDAK perlu
// menulis baris untuk tiap hari ke depan.
async function saveKualitasElevasi(tanggal, loc, elevasi, on) {
  if (!KUALITAS_LOCATIONS.some(l => l.key === loc)) throw new Error('lokasi tidak dikenal');
  const e = Number(elevasi);
  if (!KUALITAS_ELEVASI_LIST.includes(e)) throw new Error('elevasi tidak dikenal');
  await pool.query(
    `INSERT INTO kualitas_elevasi_log (lokasi, elevasi, tanggal_mulai, status, updated_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (lokasi, elevasi, tanggal_mulai) DO UPDATE SET status = EXCLUDED.status, updated_at = now()`,
    [loc, e, tanggal, !!on]
  );
}

const KUALITAS_META_KEY = 'global';
const KUALITAS_LABEL_LEFT = 'Mengetahui';
const KUALITAS_LABEL_RIGHT = 'Dibuat Oleh';
const DEFAULT_KUALITAS_META = {
  keterangan: [],
  roleLeft: 'Manajer Produksi',
  nameLeft: '',
  roleRight: 'Supervisor Sumber Air Baku & Lingkungan',
  nameRight: ''
};

async function loadGlobalKualitasMeta() {
  const { rows } = await pool.query('SELECT * FROM kpi_kualitas_meta WHERE period_key = $1', [KUALITAS_META_KEY]);
  if (!rows[0]) return null;
  const r = rows[0];
  return {
    keterangan: r.keterangan || [],
    roleLeft: r.role_left || '',
    nameLeft: r.name_left || '',
    roleRight: r.role_right || '',
    nameRight: r.name_right || ''
  };
}

async function saveKualitasMeta(m) {
  await pool.query(
    `INSERT INTO kpi_kualitas_meta (period_key, keterangan, role_left, name_left, role_right, name_right, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, now())
     ON CONFLICT (period_key) DO UPDATE SET
       keterangan = EXCLUDED.keterangan,
       role_left = EXCLUDED.role_left, name_left = EXCLUDED.name_left,
       role_right = EXCLUDED.role_right, name_right = EXCLUDED.name_right,
       updated_at = now()`,
    [KUALITAS_META_KEY, JSON.stringify(m.keterangan || []), m.roleLeft || '', m.nameLeft || '', m.roleRight || '', m.nameRight || '']
  );
}

// Bentuk satu lokasi untuk bulan tertentu: baris HARIAN (1..jumlah hari) berisi
// Level/NTU/PH (dari data harian asli, per tanggal -- bukan rata-rata) +
// status ON/OFF elevasi 3/5/7 (forward-fill), plus ringkasan Rata-rata/
// Tertinggi/Terendah untuk Level, NTU, PH.
function buildLocationMonth(loc, levelMap, ntuMap, phMap, elevByDate, year, monthIndex) {
  const days = daysInMonth(year, monthIndex);
  const rows = [];
  const acc = { level: [], ntu: [], ph: [] };
  for (let d = 1; d <= days; d++) {
    const ds = `${year}-${pad2(monthIndex + 1)}-${pad2(d)}`;
    const level = levelMap[ds] !== undefined ? levelMap[ds] : null;
    const ntu = ntuMap[ds] !== undefined ? ntuMap[ds] : null;
    const ph = phMap[ds] !== undefined ? phMap[ds] : null;
    if (level !== null) acc.level.push(level);
    if (ntu !== null) acc.ntu.push(ntu);
    if (ph !== null) acc.ph.push(ph);
    const ev = (elevByDate[ds] || { 3: false, 5: false, 7: false });
    const evLoc = ev[loc.key] || ev; // elevByDate map sudah per-lokasi
    rows.push({
      d, tanggal: ds, level, ntu, ph,
      e3: !!evLoc[3], e5: !!evLoc[5], e7: !!evLoc[7]
    });
  }
  const round2 = n => Math.round(n * 100) / 100;
  const stat = arr => arr.length ? {
    avg: round2(arr.reduce((s, v) => s + v, 0) / arr.length),
    max: round2(Math.max.apply(null, arr)),
    min: round2(Math.min.apply(null, arr))
  } : { avg: null, max: null, min: null };

  return {
    key: loc.key, label: loc.label, title: loc.title, sheet: loc.sheet,
    rows,
    summary: { level: stat(acc.level), ntu: stat(acc.ntu), ph: stat(acc.ph) }
  };
}

// Peta ds -> status per lokasi, tapi diratakan supaya buildLocationMonth bisa
// akses langsung elevByDate[ds][elevasi] untuk lokasi yang bersangkutan.
function elevMapForLocation(monthElevMap, locKey) {
  const out = {};
  Object.keys(monthElevMap).forEach(ds => { out[ds] = monthElevMap[ds][locKey]; });
  return out;
}

async function getKpiKualitasData(access, bulanQuery) {
  const currentYm = currentYmWITA();
  let bulan = (typeof bulanQuery === 'string' && /^\d{4}-\d{2}$/.test(bulanQuery)) ? bulanQuery : null;
  // clamp ke minimal bulan mulai laporan (Juli 2026)
  if (!bulan || ymToIndex(bulan) < ymToIndex(KUALITAS_START_YM)) {
    bulan = ymToIndex(currentYm) >= ymToIndex(KUALITAS_START_YM) ? currentYm : KUALITAS_START_YM;
  }
  const availableMonths = buildAvailableMonths(bulan > currentYm ? bulan : currentYm);
  const [yStr, mStr] = bulan.split('-');
  const year = Number(yStr), monthIndex = Number(mStr) - 1;
  const monthTitle = `${MONTHS_TITLE[monthIndex]} ${year}`;

  if (!access.granted) {
    // Data contoh (terkunci): Level/NTU/PH dummy per tanggal, elevasi dummy
    // TETAP (elevasi 3 OFF, 5 & 7 ON) supaya bentuk laporan tetap kebayang.
    const dummyEv = {};
    const days = daysInMonth(year, monthIndex);
    for (let d = 1; d <= days; d++) {
      const ds = `${year}-${pad2(monthIndex + 1)}-${pad2(d)}`;
      dummyEv[ds] = { manggar: { 3: false, 5: true, 7: true }, teritip: { 3: false, 5: true, 7: true } };
    }
    const locations = KUALITAS_LOCATIONS.map(loc => {
      const levelDummy = buildDummyWideSingleRows(DATASETS[loc.levelDs]);
      const ntuDummy = buildDummyWideSingleRows(DATASETS[loc.ntuDs]);
      const phDummy = buildDummyWideSingleRows(DATASETS[loc.phDs]);
      return buildLocationMonth(
        loc,
        wideSingleMonthMap(levelDummy.rows, levelDummy.dateKey, DATASETS[loc.levelDs].csvCol, bulan),
        wideSingleMonthMap(ntuDummy.rows, ntuDummy.dateKey, DATASETS[loc.ntuDs].csvCol, bulan),
        wideSingleMonthMap(phDummy.rows, phDummy.dateKey, DATASETS[loc.phDs].csvCol, bulan),
        elevMapForLocation(dummyEv, loc.key),
        year, monthIndex
      );
    });
    return {
      locked: true, availableMonths, bulan, year, monthIndex, monthTitle,
      locations,
      meta: { ...DEFAULT_KUALITAS_META, labelLeft: KUALITAS_LABEL_LEFT, labelRight: KUALITAS_LABEL_RIGHT, signPlaceDate: todaySignDate() }
    };
  }

  // --- akses asli ---
  const dsKeys = [];
  KUALITAS_LOCATIONS.forEach(loc => { dsKeys.push(loc.levelDs, loc.ntuDs, loc.phDs); });
  const fetched = {};
  await Promise.all(dsKeys.map(async k => { fetched[k] = await fetchWideSingleRows(DATASETS[k]); }));

  const monthEnd = `${year}-${pad2(monthIndex + 1)}-${pad2(daysInMonth(year, monthIndex))}`;
  const events = await loadKualitasElevasiEvents(monthEnd);
  const monthElevMap = buildElevasiDailyForMonth(events, year, monthIndex);

  const locations = KUALITAS_LOCATIONS.map(loc => {
    const levelData = fetched[loc.levelDs], ntuData = fetched[loc.ntuDs], phData = fetched[loc.phDs];
    return buildLocationMonth(
      loc,
      wideSingleMonthMap(levelData.rows, levelData.dateKey, DATASETS[loc.levelDs].csvCol, bulan),
      wideSingleMonthMap(ntuData.rows, ntuData.dateKey, DATASETS[loc.ntuDs].csvCol, bulan),
      wideSingleMonthMap(phData.rows, phData.dateKey, DATASETS[loc.phDs].csvCol, bulan),
      elevMapForLocation(monthElevMap, loc.key),
      year, monthIndex
    );
  });

  const meta = { ...(await loadGlobalKualitasMeta() || DEFAULT_KUALITAS_META), labelLeft: KUALITAS_LABEL_LEFT, labelRight: KUALITAS_LABEL_RIGHT, signPlaceDate: todaySignDate() };

  await logViewerAction(access, 'kpi_kualitas', 'view');

  return { locked: false, availableMonths, bulan, year, monthIndex, monthTitle, locations, meta };
}

// --- Unduh Excel 18.4 Laporan Kualitas Air Baku -- exceljs di server, alasan
// sama persis seperti KPI lain di atas. Meniru PERSIS file contoh yang sudah
// dirapikan user (18.4 Laporan Kualitas Air Baku Juli 2026.xlsx): SATU bulan
// per file, font Calibri, kop "PEMERINTAH KOTA BALIKPAPAN" /
// "PERUSAHAAN DAERAH AIR MINUM TIRTA MANUNTUNG BALIKPAPAN", lalu judul
// "18.4a/b LAPORAN KWALITAS AIR Baku & Lingkungan WADUK ...", baris
// "BULAN : ...", tabel HARIAN (TANGGAL/LEVEL/ELEVASI 3,5,7/NTU/PH +
// kolom KETERANGAN), Rata rata/Tertinggi/Terendah, dan tanda tangan.
// Tiap lokasi jadi SHEET terpisah (Waduk Manggar & Waduk Teritip) -- pilihan
// user supaya rapi (tidak berdampingan dalam satu sheet). ---
const KUAL_FONT = 'Calibri';
const KUAL_KOP1 = 'PEMERINTAH KOTA BALIKPAPAN';
const KUAL_KOP2 = 'PERUSAHAAN DAERAH AIR MINUM TIRTA MANUNTUNG BALIKPAPAN';
// Catatan pengambilan sampel -- ditaruh di kolom KETERANGAN tepat di bawah
// headernya (3 baris pertama), TIDAK di-merge sepanjang kolom (permintaan user).
const KUAL_NOTE_LINES = ['Data diambil', 'dari IPA 1', 'setiap jam 8.00'];
// 8 kolom: A TANGGAL, B LEVEL, C/D/E ELEVASI 3/5/7, F NTU, G PH, H KETERANGAN.
const KUAL_COL_WIDTHS = [9.5, 9, 7, 7, 7, 9, 9, 22];
const KUAL_DATA_ROW_HEIGHT = 31.5; // 42 px (1 px = 0.75 pt) -- tinggi baris isian
// Garis tengah ANTAR-BARIS (horizontal) putus-putus; garis antar-kolom
// (vertikal) tetap solid biasa -- permintaan user.
const KUAL_DASH = { style: 'dashed', color: { argb: 'FF000000' } };

function kualCellFont(opts) { return Object.assign({ size: 10, name: KUAL_FONT }, opts || {}); }
// Border sel data: semua garis vertikal solid (THIN), garis horizontal tengah
// putus-putus (perimeter atas/bawah tetap solid).
function kualDataBorder(rr, firstRow, lastRow) {
  return {
    top: rr === firstRow ? THIN : KUAL_DASH,
    bottom: rr === lastRow ? THIN : KUAL_DASH,
    left: THIN,
    right: THIN
  };
}

function buildKualitasSheet(wb, loc, monthTitle, meta) {
  const ws = wb.addWorksheet(loc.sheet, { pageSetup: { orientation: 'portrait', fitToPage: true } });
  KUAL_COL_WIDTHS.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  const c = i => colLetter(1 + i); // 0..7 -> A..H

  // Kop -- SATU-SATUNYA teks tebal (selain nama pejabat di bawah).
  ws.getCell('A1').value = KUAL_KOP1;
  ws.getCell('A1').font = kualCellFont({ bold: true, size: 11 });
  ws.mergeCells('A2:H2');
  ws.getCell('A2').value = KUAL_KOP2;
  ws.getCell('A2').font = kualCellFont({ bold: true, size: 11 });

  // Judul (baris 4) lalu BULAN (baris 5) -- keduanya center, TIDAK tebal.
  ws.mergeCells('A4:H4');
  ws.getCell('A4').value = loc.title;
  ws.getCell('A4').font = kualCellFont({ size: 11 });
  ws.getCell('A4').alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  ws.mergeCells('A5:H5');
  ws.getCell('A5').value = `BULAN : ${monthTitle}`;
  ws.getCell('A5').font = kualCellFont({ size: 11 });
  ws.getCell('A5').alignment = { horizontal: 'center' };

  // Header kolom (baris 6-7): ELEVASI span 3 kolom (angka 3/5/7 di bawahnya,
  // ditulis NUMERIK supaya tidak muncul peringatan "angka disimpan sebagai
  // teks"); "Hasil Analisa" span di atas NTU & PH. Header TIDAK tebal.
  const h1 = 6, h2 = 7;
  ws.mergeCells(`${c(0)}${h1}:${c(0)}${h2}`); ws.getCell(`${c(0)}${h1}`).value = 'TANGGAL';
  ws.mergeCells(`${c(1)}${h1}:${c(1)}${h2}`); ws.getCell(`${c(1)}${h1}`).value = 'LEVEL';
  ws.mergeCells(`${c(2)}${h1}:${c(4)}${h1}`); ws.getCell(`${c(2)}${h1}`).value = 'ELEVASI';
  ws.getCell(`${c(2)}${h2}`).value = 3; ws.getCell(`${c(3)}${h2}`).value = 5; ws.getCell(`${c(4)}${h2}`).value = 7;
  ws.mergeCells(`${c(5)}${h1}:${c(6)}${h1}`); ws.getCell(`${c(5)}${h1}`).value = 'Hasil Analisa';
  ws.getCell(`${c(5)}${h2}`).value = 'NTU'; ws.getCell(`${c(6)}${h2}`).value = 'PH';
  ws.mergeCells(`${c(7)}${h1}:${c(7)}${h2}`); ws.getCell(`${c(7)}${h1}`).value = 'KETERANGAN';
  for (let rr = h1; rr <= h2; rr++) {
    for (let i = 0; i <= 7; i++) {
      const cell = ws.getCell(`${c(i)}${rr}`);
      cell.font = kualCellFont();
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = GRID;
    }
  }

  // Data harian (semua center, TIDAK tebal termasuk ON/OFF)
  let r = h2 + 1;
  const firstDataRow = r;
  loc.rows.forEach(row => {
    ws.getCell(`${c(0)}${r}`).value = row.d;
    if (row.level !== null) ws.getCell(`${c(1)}${r}`).value = row.level;
    ws.getCell(`${c(1)}${r}`).numFmt = '0.00';
    [[2, row.e3], [3, row.e5], [4, row.e7]].forEach(pair => {
      ws.getCell(`${c(pair[0])}${r}`).value = pair[1] ? 'ON' : 'OFF';
    });
    if (row.ntu !== null) ws.getCell(`${c(5)}${r}`).value = row.ntu;
    if (row.ph !== null) ws.getCell(`${c(6)}${r}`).value = row.ph;
    ws.getRow(r).height = KUAL_DATA_ROW_HEIGHT;
    r++;
  });
  const lastDataRow = r - 1;

  // Kolom KETERANGAN (H): catatan pengambilan sampel di 3 baris pertama saja
  // (tepat di bawah header KETERANGAN), TIDAK di-merge sepanjang kolom.
  KUAL_NOTE_LINES.forEach((line, idx) => {
    const rr = firstDataRow + idx;
    if (rr <= lastDataRow) ws.getCell(`${c(7)}${rr}`).value = line;
  });

  for (let rr = firstDataRow; rr <= lastDataRow; rr++) {
    for (let i = 0; i <= 7; i++) {
      const cell = ws.getCell(`${c(i)}${rr}`);
      if (!cell.font) cell.font = kualCellFont();
      cell.alignment = cell.alignment || { horizontal: 'center', vertical: 'middle' };
      cell.border = kualDataBorder(rr, firstDataRow, lastDataRow);
    }
  }

  // Ringkasan: Rata rata / Tertinggi / Terendah -- label & data CENTER, tidak
  // tebal (Level di B, NTU di F, PH di G).
  const summaries = [['Rata rata', 'avg', 'AVERAGE'], ['Tertinggi', 'max', 'MAX'], ['Terendah', 'min', 'MIN']];
  summaries.forEach(sdef => {
    const label = sdef[0], key = sdef[1], fn = sdef[2];
    ws.getCell(`${c(0)}${r}`).value = label;
    ws.getCell(`${c(0)}${r}`).font = kualCellFont();
    ws.getCell(`${c(0)}${r}`).alignment = { horizontal: 'center', vertical: 'middle' };
    const put = (i, statObj, numFmt) => {
      const cell = ws.getCell(`${c(i)}${r}`);
      if (statObj[key] !== null && statObj[key] !== undefined) {
        const colL = c(i);
        cell.value = { formula: `IF(COUNT(${colL}${firstDataRow}:${colL}${lastDataRow})=0,"",${fn}(${colL}${firstDataRow}:${colL}${lastDataRow}))`, result: statObj[key] };
      }
      cell.numFmt = numFmt;
      cell.font = kualCellFont();
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
    };
    put(1, loc.summary.level, '0.00');
    put(5, loc.summary.ntu, '0.00');
    put(6, loc.summary.ph, '0.00');
    for (let i = 0; i <= 7; i++) { const cc = ws.getCell(`${c(i)}${r}`); cc.border = GRID; cc.alignment = cc.alignment || { horizontal: 'center', vertical: 'middle' }; }
    r++;
  });

  // Tanda tangan (Keterangan list kiri, blok tanda tangan) -- semua TIDAK
  // tebal KECUALI nama pejabat.
  r += 1;
  const ketHeaderRow = r;
  ws.getCell(`A${ketHeaderRow}`).value = 'Keterangan :';
  ws.getCell(`A${ketHeaderRow}`).font = kualCellFont();
  r++;
  (meta.keterangan || []).forEach(k => {
    ws.getCell(`A${r}`).value = '~ ' + k;
    ws.getCell(`A${r}`).font = kualCellFont();
    r++;
  });
  let lastKetRow = r - 1;
  if (lastKetRow < ketHeaderRow) lastKetRow = ketHeaderRow;

  ws.mergeCells(`F${lastKetRow}:H${lastKetRow}`);
  ws.getCell(`F${lastKetRow}`).value = meta.signPlaceDate || '';
  ws.getCell(`F${lastKetRow}`).font = kualCellFont();
  ws.getCell(`F${lastKetRow}`).alignment = { horizontal: 'center' };

  const labelRow = lastKetRow + 1;
  ws.mergeCells(`A${labelRow}:C${labelRow}`);
  ws.getCell(`A${labelRow}`).value = KUALITAS_LABEL_LEFT;
  ws.getCell(`A${labelRow}`).font = kualCellFont();
  ws.getCell(`A${labelRow}`).alignment = { horizontal: 'center' };
  ws.mergeCells(`F${labelRow}:H${labelRow}`);
  ws.getCell(`F${labelRow}`).value = KUALITAS_LABEL_RIGHT;
  ws.getCell(`F${labelRow}`).font = kualCellFont();
  ws.getCell(`F${labelRow}`).alignment = { horizontal: 'center' };

  const roleRow = labelRow + 1;
  ws.mergeCells(`A${roleRow}:C${roleRow}`);
  ws.getCell(`A${roleRow}`).value = meta.roleLeft || '';
  ws.getCell(`A${roleRow}`).font = kualCellFont();
  ws.getCell(`A${roleRow}`).alignment = { horizontal: 'center' };
  ws.mergeCells(`F${roleRow}:H${roleRow + 1}`);
  ws.getCell(`F${roleRow}`).value = meta.roleRight || '';
  ws.getCell(`F${roleRow}`).font = kualCellFont();
  ws.getCell(`F${roleRow}`).alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };

  const nameRow = roleRow + 5;
  ws.mergeCells(`A${nameRow}:C${nameRow}`);
  ws.getCell(`A${nameRow}`).value = meta.nameLeft || '';
  ws.getCell(`A${nameRow}`).font = kualCellFont({ bold: true });
  ws.getCell(`A${nameRow}`).alignment = { horizontal: 'center' };
  ws.mergeCells(`F${nameRow}:H${nameRow}`);
  ws.getCell(`F${nameRow}`).value = meta.nameRight || '';
  ws.getCell(`F${nameRow}`).font = kualCellFont({ bold: true });
  ws.getCell(`F${nameRow}`).alignment = { horizontal: 'center' };
}

async function buildKpiKualitasExcelWorkbook(data) {
  const wb = new ExcelJS.Workbook();
  wb.calcProperties.fullCalcOnLoad = true;
  data.locations.forEach(loc => buildKualitasSheet(wb, loc, data.monthTitle, data.meta));
  return wb.xlsx.writeBuffer();
}

// ===========================================================================
// KPI 19.2 Evaluasi Hasil Monitoring (apps/kpi-sab/monitoring.html). Bukan
// laporan angka -- isinya daftar berita acara (baris tabel `pekerjaan`) yang
// jatuh dalam rentang tanggal tertentu tiap bulan, dijadwalkan rutin:
//   1. Jalur Pipa Transmisi Km 12 - Kp Damai -- Selasa minggu ke-2 (BA 1-14)
//   2. Jalur Pipa Transmisi Km 12 - Kp Damai -- Selasa minggu ke-4 (BA 15-akhir)
//   3. Service Pompa Sumur                   -- Senin minggu ke-2 (BA 1-14)
//   4. Service Pompa Sumur                   -- Senin minggu ke-4 (BA 15-akhir)
// RENCANA = REALISASI = tanggal jadwalnya (Selasa/Senin minggu ke-2/4), sama
// persis contoh 19.2 Evaluasi Hasil Monitoring.xlsx. Isi KETERANGAN diambil
// OTOMATIS dari `pekerjaan` (bidang transmisi / service-sumur, status final,
// tidak dihapus) di rentang tanggal yang bersangkutan -- satu BA bisa
// mencakup beberapa baris (beberapa titik), jadi digabung per nomor BA.
// Kalau tidak ada BA di rentang itu, KETERANGAN dikosongkan.
// ===========================================================================

const KPI_19_2_DEFS = [
  { uraian: 'Jalur Pipa Transmisi Km 12 - Kp Damai', bidang: 'transmisi', hari: 2, minggu: 2, paruh: 'awal' },
  { uraian: 'Jalur Pipa Transmisi Km 12 - Kp Damai', bidang: 'transmisi', hari: 2, minggu: 4, paruh: 'akhir' },
  { uraian: 'Service Pompa Sumur', bidang: 'service-sumur', hari: 1, minggu: 2, paruh: 'awal' },
  { uraian: 'Service Pompa Sumur', bidang: 'service-sumur', hari: 1, minggu: 4, paruh: 'akhir' }
];

// "Selasa minggu ke-2" = Selasa yang hari-nya jatuh di hari 8-14 bulan itu;
// "minggu ke-4" = hari 22-28. Rentang 8-14 selalu utuh di bulan berapa pun
// (bulan terpendek 28 hari) dan selalu ada satu hari untuk tiap nama hari,
// jadi pencarian ini tidak pernah gagal.
function kpi192Tanggal(year, monthIndex, hari, minggu) {
  const start = (minggu - 1) * 7 + 1;
  const end = minggu * 7;
  for (let d = start; d <= end; d++) {
    if (new Date(year, monthIndex, d).getDay() === hari) return `${year}-${pad2(monthIndex + 1)}-${pad2(d)}`;
  }
  return null;
}

// 'YYYY-MM-DD' -> '5 Mei 2026' (persis format tanggal di contoh 19.2).
function formatTanggalId(tgl) {
  const [y, m, d] = tgl.split('-').map(Number);
  return `${d} ${MONTHS_TITLE[m - 1]} ${y}`;
}

function uniqueNonEmpty(arr) {
  return Array.from(new Set(arr.filter(v => v !== null && v !== undefined && String(v).trim())));
}

// Uraian dari Formulir SAB / Berita Acara sering masuk HURUF KAPITAL semua.
// Dirapikan jadi kalimat biasa, tapi akronim yang sudah lazim (PTMB, ZAMP,
// IPA, dst.) dipertahankan huruf kapitalnya.
function bersihkanUraian(s) {
  if (!s) return '';
  s = String(s).replace(/\s+/g, ' ').trim();
  if (s !== s.toUpperCase() || !/[A-Z]{2,}/.test(s)) return s;
  const ACR = new Set(['PTMB', 'ZAMP', 'ZAM', 'IPA', 'PDAM', 'SAB', 'GPS', 'PU', 'VIB']);
  return s.split(' ').map(w => {
    if (ACR.has(w)) return w;
    return w.length > 1 ? w[0] + w.slice(1).toLowerCase() : w;
  }).join(' ');
}

// Deskripsi satu BA (satu kelompok baris bernomor BA sama). Preferensikan
// `uraian` (terisi untuk pekerjaan yang masuk lewat Formulir SAB / Berita
// Acara); data impor historis pipa transmisi tidak punya uraian, jadi disusun
// dari diameter/instalasi/lokasi. Beberapa lokasi dalam satu BA digabung
// dengan " & ".
function describeBa(group, bidang) {
  const withUraian = group.find(r => r.uraian && r.uraian.trim());
  if (withUraian) return bersihkanUraian(withUraian.uraian);
  const first = group[0];
  const lokasi = uniqueNonEmpty(group.map(r => r.lokasi_teks)).join(' & ');
  if (bidang === 'transmisi') {
    const dia = first.diameter_nilai ? `${first.diameter_nilai}${first.diameter_satuan || ''}` : '';
    const arah = first.instalasi ? ` arah IPA ${first.instalasi}` : '';
    return `Perbaikan Pipa Transmisi${dia ? ' ' + dia : ''}${arah}${lokasi ? ' di ' + lokasi : ''}`.replace(/\s+/g, ' ').trim();
  }
  return `Service Pompa Sumur${lokasi ? ' ' + lokasi : ''}`.trim();
}

// Baris BA di kolom KETERANGAN, persis pola contoh: "(BA No. 24/...) 5 Mei 2026".
function baLineText(group) {
  const first = group[0];
  return `(BA No. ${first.no_ba}) ${formatTanggalId(first.tanggal)}`;
}

// Kelompokkan baris pekerjaan per nomor BA (satu BA = beberapa titik/baris).
// Baris tanpa no_ba jadi kelompok sendiri-sendiri, biar tidak menumpuk ke
// satu "BA kosong".
function groupByBa(rows) {
  const groups = [];
  const byNoBa = new Map();
  rows.forEach(r => {
    if (r.no_ba) {
      if (!byNoBa.has(r.no_ba)) { const g = []; byNoBa.set(r.no_ba, g); groups.push(g); }
      byNoBa.get(r.no_ba).push(r);
    } else {
      groups.push([r]);
    }
  });
  return groups;
}

async function fetchPekerjaanBaRows(bidang, tanggalAwal, tanggalAkhir) {
  const { rows } = await pool.query(
    `SELECT to_char(tanggal, 'YYYY-MM-DD') AS tanggal, no_ba, bidang, instalasi,
            lokasi_teks, uraian, diameter_nilai, diameter_satuan
     FROM pekerjaan
     WHERE deleted_at IS NULL AND status = 'final' AND bidang = $1
       AND tanggal >= $2 AND tanggal <= $3
     ORDER BY tanggal, id`,
    [bidang, tanggalAwal, tanggalAkhir]
  );
  return rows;
}

const KPI192_META_KEY = 'global';
// Label TETAP persis file 19.2 Evaluasi Hasil Monitoring.xlsx asli -- BEDA
// dari KPI lain (kiri "Mengetahui/ Menyetujui" dengan spasi, kanan "Dibuat
// Oleh"), jadi punya konstanta sendiri.
const KPI192_LABEL_LEFT = 'Mengetahui/ Menyetujui';
const KPI192_LABEL_RIGHT = 'Dibuat Oleh';
const DEFAULT_192_META = {
  keterangan: [],
  roleLeft: 'Manajer Produksi',
  nameLeft: '',
  roleRight: 'Supervisor Sumber Air Baku & Lingkungan',
  nameRight: ''
};

async function loadGlobalKpi192Meta() {
  const { rows } = await pool.query('SELECT * FROM kpi_192_meta WHERE period_key = $1', [KPI192_META_KEY]);
  if (!rows[0]) return null;
  const r = rows[0];
  return {
    keterangan: r.keterangan || [],
    roleLeft: r.role_left || '',
    nameLeft: r.name_left || '',
    roleRight: r.role_right || '',
    nameRight: r.name_right || ''
  };
}

async function saveKpi192Meta(m) {
  await pool.query(
    `INSERT INTO kpi_192_meta (period_key, keterangan, role_left, name_left, role_right, name_right, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, now())
     ON CONFLICT (period_key) DO UPDATE SET
       keterangan = EXCLUDED.keterangan,
       role_left = EXCLUDED.role_left, name_left = EXCLUDED.name_left,
       role_right = EXCLUDED.role_right, name_right = EXCLUDED.name_right,
       updated_at = now()`,
    [KPI192_META_KEY, JSON.stringify(m.keterangan || []), m.roleLeft || '', m.nameLeft || '', m.roleRight || '', m.nameRight || '']
  );
}

// Pengunjung tanpa akses TIDAK menyentuh database sama sekali (pola yang sama
// dengan getKpiUkurDebitData/getKpiKualitasData): tanggal RENCANA/REALISASI
// tetap dihitung (hanya turunan jadwal, tidak sensitif), KETERANGAN dikosongkan
// karena isinya (nomor & uraian berita acara) data vital.
async function getKpi192Data(access, bulanQuery) {
  const currentYm = currentYmWITA();
  let bulan = (typeof bulanQuery === 'string' && /^\d{4}-\d{2}$/.test(bulanQuery)) ? bulanQuery : null;

  const build = async () => {
    const [yStr, mStr] = bulan.split('-');
    const year = Number(yStr), monthIndex = Number(mStr) - 1;
    const monthTitle = `${MONTHS_TITLE[monthIndex]} ${year}`;
    const lastDay = daysInMonth(year, monthIndex);
    const rows = [];
    for (let i = 0; i < KPI_19_2_DEFS.length; i++) {
      const def = KPI_19_2_DEFS[i];
      const tanggal = kpi192Tanggal(year, monthIndex, def.hari, def.minggu);
      const tglLabel = tanggal ? formatTanggalId(tanggal) : '';
      let keterangan = [];
      if (access.granted) {
        const awal = def.paruh === 'awal' ? `${bulan}-01` : `${bulan}-15`;
        const akhir = def.paruh === 'awal' ? `${bulan}-14` : `${bulan}-${pad2(lastDay)}`;
        const baRows = await fetchPekerjaanBaRows(def.bidang, awal, akhir);
        keterangan = groupByBa(baRows).map(g => ({
          deskripsi: describeBa(g, def.bidang),
          ba: g[0] && g[0].no_ba ? baLineText(g) : (g[0] ? formatTanggalId(g[0].tanggal) : '')
        }));
      }
      rows.push({ no: i + 1, uraian: def.uraian, rencana: tglLabel, realisasi: tglLabel, keterangan });
    }
    return { year, monthIndex, monthTitle, rows };
  };

  if (!access.granted) {
    if (!bulan) bulan = currentYm;
    const base = await build();
    return {
      locked: true, availableMonths: [bulan], bulan,
      year: base.year, monthIndex: base.monthIndex, monthTitle: base.monthTitle, rows: base.rows,
      meta: { ...DEFAULT_192_META, labelLeft: KPI192_LABEL_LEFT, labelRight: KPI192_LABEL_RIGHT, signPlaceDate: todaySignDate() }
    };
  }

  const { rows: monthsRows } = await pool.query(
    `SELECT DISTINCT to_char(tanggal, 'YYYY-MM') AS ym FROM pekerjaan
     WHERE deleted_at IS NULL AND status = 'final' AND bidang IN ('transmisi','service-sumur')
     ORDER BY ym`
  );
  // Urut DESCENDING -- bulan paling baru tampil paling atas di pemilih
  // (permintaan user), jadi default-nya pun bulan terbaru (availableMonths[0]).
  const availableMonths = Array.from(new Set([...monthsRows.map(r => r.ym), currentYm])).sort((a, b) => b.localeCompare(a));
  if (!bulan || !availableMonths.includes(bulan)) bulan = availableMonths[0];

  const base = await build();
  const meta = { ...(await loadGlobalKpi192Meta() || DEFAULT_192_META), labelLeft: KPI192_LABEL_LEFT, labelRight: KPI192_LABEL_RIGHT, signPlaceDate: todaySignDate() };
  await logViewerAction(access, 'kpi_19_2', 'view');

  return {
    locked: false, availableMonths, bulan,
    year: base.year, monthIndex: base.monthIndex, monthTitle: base.monthTitle, rows: base.rows, meta
  };
}

// --- Unduh Excel 19.2 -- exceljs di server, alasan sama persis seperti KPI
// lain. Meniru format file 19.2 Evaluasi Hasil Monitoring.xlsx: kop Arial 12,
// judul " 19.2 EVALUASI HASIL MONITORING PIPA TRANSMISI AIR Baku & Lingkungan",
// baris "BULAN : ...", header NO/URAIAN/RENCANA/REALISASI/KETERANGAN (Calibri
// 11, TIDAK tebal), 4 blok data (tiap blok NO/URAIAN/RENCANA/REALISASI di-
// merge vertikal; KETERANGAN tiap BA = 2 baris deskripsi + 1 baris BA), lalu
// blok tanda tangan (kiri "Mengetahui/ Menyetujui", kanan "Dibuat Oleh").
const KPI192_FONT = 'Calibri';
const KPI192_KE_FONT = 'Times New Roman';
// KETERANGAN memakai font Times New Roman 12 di file aslinya (beda dari sel
// lain yang Calibri 11) -- kolom I:N di-merge per BA, isi ditaruh di sel I.
//
// Lebar kolom DIHITUNG dari isi (bukan menyalin lebar file contoh), supaya
// pas dengan panjang teks asli, dan dibatasi totalnya maksimal 1 halaman
// kertas legal (14in) landscape. Teks KETERANGAN (TNR 12) lebih lebar ~1.15x
// dari Calibri 11, jadi pengukurannya pakai faktor itu.
const KPI192_PAGE_MAX = 185; // lebar ~1 halaman legal landscape (margin 0.25in)

function computeKpi192ColumnWidths(data) {
  // Basis: kolom A (NO) & I:M minimal; sisanya dihitung dari isi.
  const w = [4, 6, 6, 6, 7, 7, 7, 7, 6, 6, 6, 6, 6, 6];

  // URAIAN (B:D) -- teks tetap ("Jalur Pipa Transmisi..." / "Service Pompa
  // Sumur") dan header "URAIAN", dibagi rata ke 3 kolom.
  const uraianLen = Math.max.apply(null, data.rows.map(r => r.uraian.length).concat('URAIAN'.length));
  const uraianPerCol = Math.max(6, Math.ceil((uraianLen + 3) / 3));
  w[1] = w[2] = w[3] = uraianPerCol;

  // RENCANA (E:F) & REALISASI (G:H) -- tanggal "12 Mei 2026" / header.
  const tglLen = Math.max(11, 7);
  const tglPerCol = Math.max(6, Math.ceil((tglLen + 3) / 2));
  w[4] = w[5] = w[6] = w[7] = tglPerCol;

  // KETERANGAN (I:N) -- teks terpanjang di antara deskripsi & baris BA.
  let ketMax = 0;
  data.rows.forEach(r => {
    const list = r.keterangan.length ? r.keterangan : [{ deskripsi: '', ba: '' }];
    list.forEach(e => {
      const d = Math.ceil((e.deskripsi || '').length * 1.15);
      const b = Math.ceil((e.ba || '').length * 1.15);
      if (d > ketMax) ketMax = d;
      if (b > ketMax) ketMax = b;
    });
  });
  // Deskripsi boleh wrap (merge 2 baris), jadi dijadikan satu baris penuh
  // hanya kalau masuk akal; dibatasi atas supaya tabel tidak melebar berlebihan.
  const ketTarget = Math.min(120, Math.max(30, ketMax));
  const remainder = ketTarget - 5 * w[8];
  w[13] = Math.max(w[8], remainder);

  // Total maksimal 1 halaman legal landscape. Kalau lebih, semua kolom
  // dipangkas proporsional (fitToPage juga tetap menjamin pas 1 halaman).
  const total = w.reduce((a, b) => a + b, 0);
  if (total > KPI192_PAGE_MAX) {
    const ratio = KPI192_PAGE_MAX / total;
    for (let c = 0; c < 14; c++) w[c] = Math.max(3, Math.round(w[c] * ratio));
  }
  return w;
}

function buildKpi192ExcelWorkbook(data) {
  const wb = new ExcelJS.Workbook();
  wb.calcProperties.fullCalcOnLoad = true;
  const ws = wb.addWorksheet('19.2 EVALUASI HASIL MONITORING', { pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 1, paperSize: 5 } });
  ws.pageSetup.margins = { left: 0.25, right: 0.25, top: 0.75, bottom: 0.75, header: 0.3, footer: 0.3 };
  computeKpi192ColumnWidths(data).forEach((wd, i) => { ws.getColumn(i + 1).width = wd; });

  // Kop & judul (Arial 12 tebal -- satu-satunya teks tebal, selain nama
  // pejabat... nama pejabat di template ini justru TIDAK tebal).
  ws.getCell('A1').value = 'PERUSAHAAN UMUM DAERAH TIRTA MANUNTUNG';
  ws.getCell('A1').font = { bold: true, size: 12, name: 'Arial' };
  ws.getCell('A2').value = 'KOTA BALIKPAPAN';
  ws.getCell('A2').font = { bold: true, size: 12, name: 'Arial' };
  ws.mergeCells('A3:N3');
  ws.getCell('A3').value = ' 19.2 EVALUASI HASIL MONITORING PIPA TRANSMISI AIR Baku & Lingkungan';
  ws.getCell('A3').font = { bold: true, size: 12, name: 'Arial' };
  ws.getCell('A3').alignment = { horizontal: 'center' };
  ws.mergeCells('A4:N4');
  ws.getCell('A4').value = `BULAN ${data.monthTitle}`;
  ws.getCell('A4').font = { bold: true, size: 12, name: 'Arial' };
  ws.getCell('A4').alignment = { horizontal: 'center' };

  // Header (baris 5-6): Calibri 11 TIDAK tebal, center. "URAIAN" (contoh
  // file ada yang ketik "URIAN" -- sengaja dibetulkan sesuai spesifikasi).
  const H1 = 5, H2 = 6;
  const headerDefs = [
    ['A', H1, H2, 'NO'],
    ['B', H1, H2, 'URAIAN'],
    ['E', H1, H2, 'RENCANA'],
    ['G', H1, H2, 'REALISASI'],
    ['I', H1, H2, 'KETERANGAN']
  ];
  headerDefs.forEach(([col, r1, r2, label]) => {
    ws.mergeCells(`${col}${r1}:${col === 'B' ? 'D' : col === 'E' ? 'F' : col === 'G' ? 'H' : col === 'I' ? 'N' : col}${r2}`);
    ws.getCell(`${col}${r1}`).value = label;
    ws.getCell(`${col}${r1}`).font = { size: 11, name: KPI192_FONT };
    ws.getCell(`${col}${r1}`).alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    ws.getCell(`${col}${r1}`).border = GRID;
  });

  // Data: 4 blok. Tiap blok = 3 baris per BA (2 baris deskripsi + 1 baris BA),
  // minimal 1 BA supaya grid tetap ada walau KETERANGAN kosong.
  let r = H2 + 1;
  data.rows.forEach(row => {
    const n = Math.max(1, row.keterangan.length);
    const firstRow = r;
    const lastRow = r + n * 3 - 1;

    ws.mergeCells(`A${firstRow}:A${lastRow}`); ws.getCell(`A${firstRow}`).value = row.no;
    ws.mergeCells(`B${firstRow}:D${lastRow}`); ws.getCell(`B${firstRow}`).value = row.uraian;
    ws.mergeCells(`E${firstRow}:F${lastRow}`); ws.getCell(`E${firstRow}`).value = row.rencana;
    ws.mergeCells(`G${firstRow}:H${lastRow}`); ws.getCell(`G${firstRow}`).value = row.realisasi;
    // Gaya & kotak untuk NO/URAIAN/RENCANA/REALISASI (master sel baris pertama).
    ['A', 'B', 'E', 'G'].forEach(col => {
      const cell = ws.getCell(`${col}${firstRow}`);
      cell.font = { size: 11, name: KPI192_FONT };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = GRID;
    });

    for (let i = 0; i < n; i++) {
      const e = row.keterangan[i] || { deskripsi: '', ba: '' };
      const descRow = firstRow + i * 3;
      const baRow = descRow + 2;
      // Deskripsi: 2 baris (TNR 12, kiri). BA: 1 baris di bawahnya. Garis
      // horizontal hanya di ATAS deskripsi & BAWAH BA -- persis file asli,
      // tidak ada garis pemisah antara deskripsi dan nomor BA-nya.
      ws.mergeCells(`I${descRow}:N${descRow + 1}`);
      ws.getCell(`I${descRow}`).value = e.deskripsi;
      ws.getCell(`I${descRow}`).font = { size: 12, name: KPI192_KE_FONT };
      ws.getCell(`I${descRow}`).alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
      ws.getCell(`I${descRow}`).border = { top: THIN, left: THIN, right: THIN };

      ws.mergeCells(`I${baRow}:N${baRow}`);
      ws.getCell(`I${baRow}`).value = e.ba;
      ws.getCell(`I${baRow}`).font = { size: 12, name: KPI192_KE_FONT };
      ws.getCell(`I${baRow}`).alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
      ws.getCell(`I${baRow}`).border = { bottom: THIN, left: THIN, right: THIN };
    }

    r = lastRow + 1;
  });

  // Tanda tangan: 4 baris kosong setelah tabel (persis template), lalu blok
  // kiri "Mengetahui/ Menyetujui" dan kanan "Dibuat Oleh" -- semuanya
  // Calibri 11, center, TIDAK tebal.
  const meta = data.meta || {};
  const labelRow = r + 4;
  ws.mergeCells(`A${labelRow}:F${labelRow}`);
  ws.getCell(`A${labelRow}`).value = meta.labelLeft || KPI192_LABEL_LEFT;
  ws.getCell(`A${labelRow}`).font = { size: 11, name: KPI192_FONT };
  ws.getCell(`A${labelRow}`).alignment = { horizontal: 'center' };
  ws.getCell(`N${labelRow}`).value = meta.signPlaceDate || '';
  ws.getCell(`N${labelRow}`).font = { size: 11, name: KPI192_FONT };
  ws.getCell(`N${labelRow}`).alignment = { horizontal: 'center' };

  const roleRow = labelRow + 1;
  ws.mergeCells(`A${roleRow}:F${roleRow}`);
  ws.getCell(`A${roleRow}`).value = meta.roleLeft || '';
  ws.getCell(`A${roleRow}`).font = { size: 11, name: KPI192_FONT };
  ws.getCell(`A${roleRow}`).alignment = { horizontal: 'center' };
  ws.getCell(`N${roleRow}`).value = meta.labelRight || KPI192_LABEL_RIGHT;
  ws.getCell(`N${roleRow}`).font = { size: 11, name: KPI192_FONT };
  ws.getCell(`N${roleRow}`).alignment = { horizontal: 'center' };

  ws.getCell(`N${roleRow + 1}`).value = meta.roleRight || '';
  ws.getCell(`N${roleRow + 1}`).font = { size: 11, name: KPI192_FONT };
  ws.getCell(`N${roleRow + 1}`).alignment = { horizontal: 'center', wrapText: true };

  const nameRow = roleRow + 4;
  ws.mergeCells(`A${nameRow}:F${nameRow}`);
  ws.getCell(`A${nameRow}`).value = meta.nameLeft || '';
  ws.getCell(`A${nameRow}`).font = { size: 11, name: KPI192_FONT };
  ws.getCell(`A${nameRow}`).alignment = { horizontal: 'center' };
  ws.getCell(`N${nameRow}`).value = meta.nameRight || '';
  ws.getCell(`N${nameRow}`).font = { size: 11, name: KPI192_FONT };
  ws.getCell(`N${nameRow}`).alignment = { horizontal: 'center' };

  return wb.xlsx.writeBuffer();
}

// ===========================================================================
// KPI 18.1a Pengukuran Level Sumur Produksi (apps/kpi-sab/level-sumur.html).
// Beda dari 18.2 (Debit) -- laporan ini cuma MENGHITUNG jumlah sumur, tidak
// menampilkan nilai statis/dinamisnya:
//   - ANGG (anggaran) = jumlah sumur AKTIF per instalasi, dari tabel
//     sumur_wells (category 'level'). Konstan sepanjang tahun (daftar sumur
//     saat ini -- kalau sumur ditambah/dihapus di tengah tahun, laporan tidak
//     membedakan per bulan; konsisten dengan data yang tersedia).
//   - REAL = jumlah sumur yang TERUKUR di bulan itu, dari sumur_level_readings:
//     punya data statis ATAU dinamis dihitung 1 sumur; cuma dianggap 0 kalau
//     kedua-duanya kosong (baris tanpa kedua nilai itu memang tidak pernah
//     disimpan, jadi tinggal hitung barisnya).
//   - ± = REAL - ANGG, % = REAL / ANGG * 100.
// 5 instalasi persis lampiran 18.1A (IPA GN SARI, KAMPUNG DAMAI, PRAPATAN,
// ZAMP, KP BARU). Satu tahun penuh, dua blok semester (Jan-Jun & Jul-Des),
// tiap blok: kolom ANGG/REAL/±/% per bulan (26 kolom A-Z), baris RATA - RATA
// (penjumlahan ANGG/REAL, ± dikosongkan persis file contoh), Keterangan, lalu
// tanda tangan ("Mengetahui/Menyetujui :" / "Di buat oleh :").
// ===========================================================================

const KPI_18_1A_INSTALLATIONS = [
  { installation: 'gunung_sari', label: 'IPA GN SARI' },
  { installation: 'kampung_damai', label: 'IPA KAMPUNG DAMAI' },
  { installation: 'prapatan', label: 'IPA PRAPATAN' },
  { installation: 'zamp', label: 'IPA ZAMP' },
  { installation: 'kampung_baru_ulu', label: 'IPA KP BARU' }
];

const KPI_18_1A_META_KEY = 'global';
const KPI_18_1A_LABEL_LEFT = 'Mengetahui/Menyetujui :';
const KPI_18_1A_LABEL_RIGHT = 'Di buat oleh :';
// Keterangan default persis baris-baris di file contoh 18.1A (tanpa tanda "*"
// -- bintangnya ditulis builder Excel di kolom A). Bisa diedit admin.
const DEFAULT_18_1A_META = {
  keterangan: [
    'Anggaran bulan ini adalah jumlah sumur di setiap IPA yg harus dimonitor',
    'Angka Real adalah jumlah sumur yang dapat di ukur level statis-dinamisnya',
    'Sumur no 1,2,3,4 Gn Sari Tidak ada Casing Pzometer'
  ],
  roleLeft: 'Manajer Produksi',
  nameLeft: '',
  roleRight: 'Supervisor Sumber Air Baku & Lingkungan',
  nameRight: ''
};

async function loadGlobalLevelSumurMeta() {
  const { rows } = await pool.query('SELECT * FROM kpi_18_1a_meta WHERE period_key = $1', [KPI_18_1A_META_KEY]);
  if (!rows[0]) return null;
  const r = rows[0];
  return {
    keterangan: r.keterangan || [],
    roleLeft: r.role_left || '',
    nameLeft: r.name_left || '',
    roleRight: r.role_right || '',
    nameRight: r.name_right || ''
  };
}

async function saveLevelSumurMeta(m) {
  await pool.query(
    `INSERT INTO kpi_18_1a_meta (period_key, keterangan, role_left, name_left, role_right, name_right, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, now())
     ON CONFLICT (period_key) DO UPDATE SET
       keterangan = EXCLUDED.keterangan,
       role_left = EXCLUDED.role_left, name_left = EXCLUDED.name_left,
       role_right = EXCLUDED.role_right, name_right = EXCLUDED.name_right,
       updated_at = now()`,
    [KPI_18_1A_META_KEY, JSON.stringify(m.keterangan || []), m.roleLeft || '', m.nameLeft || '', m.roleRight || '', m.nameRight || '']
  );
}

// Semua sumur level + status aktifnya, dikelompokkan per instalasi. Dipakai
// untuk menghitung ANGG (cuma yang AKTIF) dan untuk panel "Daftar Sumur &
// Status Aktif" di halaman 18.1a. Kolom `active` bukan cara menyembunyikan
// sumur dari grafik -- cuma menentukan anggaran di laporan ini.
async function fetchLevelWellData() {
  const { rows } = await pool.query(
    `SELECT installation, well_name, active, sort_order FROM sumur_wells
     WHERE category = 'level' ORDER BY installation, sort_order, well_name`
  );
  const byInst = {};
  rows.forEach(r => {
    if (!byInst[r.installation]) byInst[r.installation] = [];
    byInst[r.installation].push({ well_name: r.well_name, active: !!r.active, sort_order: r.sort_order });
  });
  return byInst;
}

// Semua baris pengukuran level (statis/dinamis) satu instalasi dalam satu
// tahun. Baris tanpa statis & dinamis sekaligus memang tidak pernah disimpan
// (lihat migrate-library-csv-to-db.js), jadi kemunculan satu well_name di satu
// bulan = sumur itu terukur bulan itu.
async function fetchLevelRealRows(installation, year) {
  const { rows } = await pool.query(
    `SELECT to_char(bulan, 'YYYY-MM') AS bulan, well_name
     FROM sumur_level_readings
     WHERE installation = $1 AND EXTRACT(YEAR FROM bulan) = $2
     ORDER BY bulan, well_name`,
    [installation, year]
  );
  return rows;
}

// Hitung jumlah sumur terukur per bulan (0-11): tiap well_name dihitung
// sekali per bulan, tidak peduli cuma ada statis atau dinamis atau dua-duanya.
// Kalau activeSet diberikan, cuma sumur AKTIF yang dihitung (realisasi sumur
// yang ditandai nonaktif tidak ikut -- konsisten dengan ANGG yang cuma jumlah
// sumur aktif).
// Bulan yang TIDAK punya data sama sekali (belum terlewati / data statis-
// dinamis belum diinput) menghasilkan null -- bukan 0 -- supaya laporan bisa
// mengosongkan bulan itu (persis permintaan user: ANGG/REAL/±/% dikosongkan
// kalau belum ada isian, jangan diisi 0 atau angka).
function countLevelRealByMonth(rows, year, activeSet) {
  const counts = new Array(12).fill(null);
  const seen = Array.from({ length: 12 }, () => new Set());
  rows.forEach(r => {
    if (r.bulan.slice(0, 4) !== String(year)) return;
    if (activeSet && !activeSet.has(r.well_name)) return;
    const mi = Number(r.bulan.slice(5, 7)) - 1;
    if (!seen[mi].has(r.well_name)) { seen[mi].add(r.well_name); counts[mi] = (counts[mi] || 0) + 1; }
  });
  return counts;
}

// Pengunjung tanpa akses TIDAK menyentuh database (pola sama KPI lain):
// ANGG/REAL dummy meniru angka contoh 18.1A supaya bentuk tabel kebayang.
const DUMMY_18_1A_ANG = [7, 4, 3, 2, 3];

async function getKpiLevelSumurData(access, tahunQuery) {
  if (!access.granted) {
    const year = tahunQuery || String(new Date().getFullYear());
    return {
      locked: true, availableYears: [], year,
      groups: KPI_18_1A_INSTALLATIONS.map((inst, i) => ({
        installation: inst.installation, label: inst.label,
        angg: DUMMY_18_1A_ANG[i],
        real: new Array(12).fill(DUMMY_18_1A_ANG[i]),
        wells: []
      })),
      meta: { ...DEFAULT_18_1A_META, labelLeft: KPI_18_1A_LABEL_LEFT, labelRight: KPI_18_1A_LABEL_RIGHT, signPlaceDate: todaySignDate() }
    };
  }

  const currentYear = String(new Date().getFullYear());
  const { rows: yearRows } = await pool.query(
    `SELECT DISTINCT EXTRACT(YEAR FROM bulan)::int AS thn FROM sumur_level_readings ORDER BY thn`
  );
  // Urut menurun -- tahun terbaru di paling atas pemilih (pola sama 19.2).
  const availableYears = Array.from(new Set([...yearRows.map(r => String(r.thn)), currentYear])).sort((a, b) => b.localeCompare(a));
  let year = (typeof tahunQuery === 'string' && /^\d{4}$/.test(tahunQuery)) ? tahunQuery : null;
  if (!year || !availableYears.includes(year)) year = availableYears[0];

  const [wellData, ...readings] = await Promise.all([
    fetchLevelWellData(),
    ...KPI_18_1A_INSTALLATIONS.map(inst => fetchLevelRealRows(inst.installation, year))
  ]);

  const groups = KPI_18_1A_INSTALLATIONS.map((inst, i) => {
    const wells = wellData[inst.installation] || [];
    const activeSet = new Set(wells.filter(w => w.active).map(w => w.well_name));
    return {
      installation: inst.installation, label: inst.label,
      angg: activeSet.size,
      real: countLevelRealByMonth(readings[i], year, activeSet),
      wells
    };
  });

  const meta = { ...(await loadGlobalLevelSumurMeta() || DEFAULT_18_1A_META), labelLeft: KPI_18_1A_LABEL_LEFT, labelRight: KPI_18_1A_LABEL_RIGHT, signPlaceDate: todaySignDate() };
  await logViewerAction(access, 'kpi_18_1a', 'view');

  return { locked: false, availableYears, year, groups, meta };
}

// --- Unduh Excel 18.1A -- exceljs di server (alasan sama KPI lain). Meniru
// file 18.1A Pengukuran Level Sumur.xlsx: kop Arial 12, judul Calibri 14
// tebal, header 3 baris dengan GARIS GANDA (double), baris data Calibri 12
// dengan garis tipis, RATA - RATA (jumlah, garis bawah ganda), Keterangan,
// lalu tanda tangan. Dua blok (Januari-Juni & Juli-Desember) satu sheet.
const KPI_18_1A_COL_WIDTHS = [6, 26.33];
for (let i = 0; i < 6; i++) KPI_18_1A_COL_WIDTHS.push(9.66, 9.66, 9.66, 12);

const DBL = { style: 'double', color: { argb: 'FF000000' } };
const KPI_18_1A_DATA_ROW_H = 39.75;

function levelSumurMonthCols(i) { const base = 3 + i * 4; return { angg: base, real: base + 1, pm: base + 2, pct: base + 3 }; }

// Header 3 baris (persis template): baris 1 nama bulan (Calibri 12 tebal,
// garis ganda), baris 2 ANGG/REAL/RATIO EFFISIENSI, baris 3 ±/%. Semua garis
// antar-sel header memakai 'double' -- ciri khas lampiran 18.1A.
function styleLevelSumurHeader(ws, H1, H2, H3, monthCount) {
  const setBox = (col, row, b) => { ws.getCell(`${col}${row}`).border = b; };

  // NO & URAIAN (merged H1:H3)
  setBox('A', H1, { top: DBL, bottom: DBL, left: THIN, right: DBL });
  setBox('B', H1, { top: DBL, bottom: DBL, left: DBL, right: DBL });

  for (let m = 0; m < monthCount; m++) {
    const base = 3 + m * 4;
    const anggC = colLetter(base), realC = colLetter(base + 1), pmC = colLetter(base + 2), pctC = colLetter(base + 3);
    // Nama bulan (baris H1, merged 4 kolom)
    setBox(anggC, H1, { top: DBL, bottom: DBL, left: DBL, right: DBL });
    // ANGG & REAL (merged H2:H3)
    setBox(anggC, H2, { top: DBL, bottom: DBL, left: DBL, right: DBL });
    setBox(realC, H2, { top: DBL, bottom: DBL, left: DBL, right: DBL });
    // RATIO EFFISIENSI (baris H2, merged 2 kolom)
    setBox(pmC, H2, { top: DBL, bottom: DBL, left: DBL, right: DBL });
    // ± dan % (baris H3, sel tunggal)
    setBox(pmC, H3, { top: DBL, bottom: DBL, left: DBL, right: DBL });
    setBox(pctC, H3, { top: DBL, bottom: DBL, left: DBL, right: DBL });
  }
}

function buildLevelSumurExcelBlock(ws, rowOffset, monthNames, monthBase, judulBulan, data) {
  const R = r => r + rowOffset;

  ws.getCell(`A${R(1)}`).value = 'PERUSAHAAN UMUM DAERAH TIRTA MANUNTUNG';
  ws.getCell(`A${R(1)}`).font = { bold: true, size: 12, name: 'Arial' };
  ws.getCell(`A${R(2)}`).value = 'KOTA BALIKPAPAN';
  ws.getCell(`A${R(2)}`).font = { bold: true, size: 12, name: 'Arial' };

  ws.mergeCells(`A${R(3)}:Z${R(3)}`);
  ws.getCell(`A${R(3)}`).value = '18.1a PENGUKURAN LEVEL SUMUR  PRODUKSI';
  ws.getCell(`A${R(3)}`).font = { bold: true, size: 14, name: 'Calibri' };
  ws.getCell(`A${R(3)}`).alignment = { horizontal: 'center' };
  ws.getRow(R(3)).height = 18;

  ws.mergeCells(`A${R(4)}:Z${R(4)}`);
  ws.getCell(`A${R(4)}`).value = judulBulan;
  ws.getCell(`A${R(4)}`).font = { bold: true, size: 14, name: 'Calibri' };
  ws.getCell(`A${R(4)}`).alignment = { horizontal: 'center' };
  ws.getRow(R(4)).height = 18;

  // Header 3 baris (baris 6,7,8)
  const H1 = R(6), H2 = R(7), H3 = R(8);
  ws.mergeCells(`A${H1}:A${H3}`);
  ws.getCell(`A${H1}`).value = 'NO';
  ws.mergeCells(`B${H1}:B${H3}`);
  ws.getCell(`B${H1}`).value = 'URAIAN';

  monthNames.forEach((mn, i) => {
    const { angg, real, pm, pct } = levelSumurMonthCols(i);
    const c1 = colLetter(angg), c2 = colLetter(real), c3 = colLetter(pm), c4 = colLetter(pct);
    ws.mergeCells(`${c1}${H1}:${c4}${H1}`);
    ws.getCell(`${c1}${H1}`).value = mn;
    ws.mergeCells(`${c1}${H2}:${c1}${H3}`);
    ws.getCell(`${c1}${H2}`).value = 'ANGG';
    ws.mergeCells(`${c2}${H2}:${c2}${H3}`);
    ws.getCell(`${c2}${H2}`).value = 'REAL';
    ws.mergeCells(`${c3}${H2}:${c4}${H2}`);
    ws.getCell(`${c3}${H2}`).value = 'RATIO EFFISIENSI';
    ws.getCell(`${c3}${H3}`).value = '±';
    ws.getCell(`${c4}${H3}`).value = '%';
  });

  // Font header (persis template): nama bulan Calibri 12 tebal, ANGG/REAL &
  // ±/% Calibri 11 tebal, RATIO EFFISIENSI Calibri 10 tebal, NO/URAIAN
  // Calibri 11 tebal.
  for (let c = 1; c <= 26; c++) {
    const cell = ws.getRow(H1).getCell(c);
    if (cell.value === 'NO' || cell.value === 'URAIAN') cell.font = { bold: true, size: 11, name: 'Calibri' };
    else cell.font = { bold: true, size: 12, name: 'Calibri' };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  }
  for (let c = 1; c <= 26; c++) {
    const cellH2 = ws.getRow(H2).getCell(c);
    const cellH3 = ws.getRow(H3).getCell(c);
    if (cellH2.value === 'RATIO EFFISIENSI') cellH2.font = { bold: true, size: 10, name: 'Calibri' };
    else cellH2.font = { bold: true, size: 11, name: 'Calibri' };
    cellH2.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cellH3.font = { bold: true, size: 11, name: 'Calibri' };
    cellH3.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  }
  styleLevelSumurHeader(ws, H1, H2, H3, monthNames.length);
  ws.getRow(H1).height = 16.8;
  ws.getRow(H2).height = 15.6;
  ws.getRow(H3).height = 15.6;

  // Data: 5 instalasi. ANGG konstan per instalasi, REAL per bulan.
  let r = R(9);
  const firstDataRow = r;
  data.groups.forEach((g, gi) => {
    ws.getCell(`A${r}`).value = gi + 1;
    ws.getCell(`B${r}`).value = g.label;
    monthNames.forEach((mn, i) => {
      const { angg, real, pm, pct } = levelSumurMonthCols(i);
      const ac = colLetter(angg), rc = colLetter(real), pmc = colLetter(pm), pctc = colLetter(pct);
      const anggCell = ws.getCell(`${ac}${r}`);
      const realVal = g.real[monthBase + i];
      // Bulan tanpa data (null) DIKOSONGKAN: ANGG & REAL tidak ditulis, dan
      // formula ±/% otomatis kembali "" karena selnya kosong. Persis permintaan
      // user -- jangan isi 0 atau angka untuk bulan yang belum ada isian.
      const hasData = realVal !== null && realVal !== undefined;
      if (hasData && g.angg !== null && g.angg !== undefined) anggCell.value = g.angg;
      const realCell = ws.getCell(`${rc}${r}`);
      if (hasData) realCell.value = realVal;
      ws.getCell(`${pmc}${r}`).value = { formula: `IF(OR(${rc}${r}="",${ac}${r}=""),"",${rc}${r}-${ac}${r})` };
      ws.getCell(`${pctc}${r}`).value = { formula: `IF(OR(${rc}${r}="",${ac}${r}=""),"",${rc}${r}/${ac}${r}*100)` };
    });
    ws.getRow(r).height = KPI_18_1A_DATA_ROW_H;
    r++;
  });
  const lastDataRow = r - 1;

  for (let rr = firstDataRow; rr <= lastDataRow; rr++) {
    for (let c = 1; c <= 26; c++) {
      const cell = ws.getRow(rr).getCell(c);
      cell.font = { size: 12, name: 'Calibri' };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = GRID;
    }
  }

  // RATA - RATA = PENJUMLAHAN ANGG/REAL per bulan; ± dikosongkan persis
  // contoh (yang terisi cuma ANGG, REAL, %).
  const rataRow = r;
  ws.getCell(`A${rataRow}`).border = GRID;
  ws.getCell(`B${rataRow}`).value = 'RATA - RATA';
  ws.getCell(`B${rataRow}`).font = { bold: true, size: 12, name: 'Calibri' };
  ws.getCell(`B${rataRow}`).alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(rataRow).height = KPI_18_1A_DATA_ROW_H;
  monthNames.forEach((mn, i) => {
    const { angg, real, pm, pct } = levelSumurMonthCols(i);
    const ac = colLetter(angg), rc = colLetter(real), pmc = colLetter(pm), pctc = colLetter(pct);
    let sumAngg = 0, sumReal = 0, any = false;
    data.groups.forEach(g => {
      const rv = g.real[monthBase + i];
      if (rv !== null && rv !== undefined) { sumReal += rv; sumAngg += (g.angg || 0); any = true; }
    });
    const anggCell = ws.getCell(`${ac}${rataRow}`);
    const realCell = ws.getCell(`${rc}${rataRow}`);
    const pctCell = ws.getCell(`${pctc}${rataRow}`);
    // Bulan kosong (tidak ada satu pun grup yang punya data): sel RATA - RATA
    // ikut dikosongkan, bukan diisi 0.
    if (any) {
      anggCell.value = { formula: `SUM(${ac}${firstDataRow}:${ac}${lastDataRow})`, result: sumAngg };
      anggCell.numFmt = '#,##0';
      realCell.value = { formula: `SUM(${rc}${firstDataRow}:${rc}${lastDataRow})`, result: sumReal };
      realCell.numFmt = '#,##0';
      pctCell.value = { formula: `IF(SUM(${ac}${firstDataRow}:${ac}${lastDataRow})=0,"",SUM(${rc}${firstDataRow}:${rc}${lastDataRow})/SUM(${ac}${firstDataRow}:${ac}${lastDataRow})*100)`, result: sumAngg > 0 ? Math.round(sumReal / sumAngg * 10000) / 100 : '' };
      pctCell.numFmt = '0.00';
    }
  });
  // Garis bawah RATA - RATA double (penutup tabel), atas tipis.
  for (let c = 1; c <= 26; c++) {
    const cell = ws.getRow(rataRow).getCell(c);
    cell.font = cell.font || { size: 12, name: 'Calibri' };
    cell.alignment = cell.alignment || { horizontal: 'center', vertical: 'middle' };
    const base = cell.border || {};
    cell.border = {
      top: THIN, bottom: DBL,
      left: base.left || THIN, right: base.right || THIN
    };
  }
  r++;

  // Keterangan (baris-baris meta.keterangan, tanda bintang di kolom A) dan
  // tanggal tanda tangan (kanan, sebaris baris keterangan terakhir).
  const meta = data.meta || {};
  const ketHeaderRow = r;
  ws.getCell(`B${ketHeaderRow}`).value = 'Keterangan :';
  ws.getCell(`B${ketHeaderRow}`).font = { size: 12, name: 'Calibri' };
  ws.getCell(`B${ketHeaderRow}`).alignment = { horizontal: 'center' };
  r++;
  (meta.keterangan || []).forEach(k => {
    ws.getCell(`A${r}`).value = '*';
    ws.getCell(`A${r}`).font = { size: 12, name: 'Calibri' };
    ws.getCell(`A${r}`).alignment = { horizontal: 'right' };
    ws.getCell(`B${r}`).value = k;
    ws.getCell(`B${r}`).font = { size: 12, name: 'Calibri' };
    r++;
  });
  const lastKetRow = r - 1;

  ws.mergeCells(`V${lastKetRow}:Y${lastKetRow}`);
  ws.getCell(`V${lastKetRow}`).value = meta.signPlaceDate || '';
  ws.getCell(`V${lastKetRow}`).font = { size: 12, name: 'Calibri' };
  ws.getCell(`V${lastKetRow}`).alignment = { horizontal: 'center' };

  // Tanda tangan: kiri "Mengetahui/Menyetujui :", kanan "Di buat oleh :".
  const labelRow = lastKetRow + 2;
  ws.mergeCells(`C${labelRow}:G${labelRow}`);
  ws.getCell(`C${labelRow}`).value = meta.labelLeft || KPI_18_1A_LABEL_LEFT;
  ws.getCell(`C${labelRow}`).font = { size: 12, name: 'Calibri' };
  ws.getCell(`C${labelRow}`).alignment = { horizontal: 'center' };
  ws.mergeCells(`V${labelRow}:Y${labelRow}`);
  ws.getCell(`V${labelRow}`).value = meta.labelRight || KPI_18_1A_LABEL_RIGHT;
  ws.getCell(`V${labelRow}`).font = { size: 12, name: 'Calibri' };
  ws.getCell(`V${labelRow}`).alignment = { horizontal: 'center' };

  const roleRow = labelRow + 1;
  ws.mergeCells(`C${roleRow}:G${roleRow}`);
  ws.getCell(`C${roleRow}`).value = meta.roleLeft || '';
  ws.getCell(`C${roleRow}`).font = { size: 12, name: 'Calibri' };
  ws.getCell(`C${roleRow}`).alignment = { horizontal: 'center' };
  ws.mergeCells(`V${roleRow}:Y${roleRow}`);
  ws.getCell(`V${roleRow}`).value = meta.roleRight || '';
  ws.getCell(`V${roleRow}`).font = { size: 12, name: 'Calibri' };
  ws.getCell(`V${roleRow}`).alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };

  const nameRow = roleRow + 4;
  ws.mergeCells(`C${nameRow}:G${nameRow + 1}`);
  ws.getCell(`C${nameRow}`).value = meta.nameLeft || '';
  ws.getCell(`C${nameRow}`).font = { bold: true, size: 12, name: 'Calibri' };
  ws.getCell(`C${nameRow}`).alignment = { horizontal: 'center', vertical: 'top' };
  ws.mergeCells(`V${nameRow}:Y${nameRow}`);
  ws.getCell(`V${nameRow}`).value = meta.nameRight || '';
  ws.getCell(`V${nameRow}`).font = { bold: true, size: 12, name: 'Calibri' };
  ws.getCell(`V${nameRow}`).alignment = { horizontal: 'center' };

  return nameRow + 2;
}

async function buildKpiLevelSumurExcelWorkbook(data) {
  const wb = new ExcelJS.Workbook();
  wb.calcProperties.fullCalcOnLoad = true;
  const ws = wb.addWorksheet('18.1A LEVEL SUMUR', {
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 1, paperSize: 5, horizontalCentered: true, showGridLines: false, showRowColHeaders: false }
  });
  ws.pageSetup.margins = { left: 0.25, right: 0.25, top: 0.75, bottom: 0.75, header: 0.3, footer: 0.3 };
  KPI_18_1A_COL_WIDTHS.forEach((w, i) => { ws.getColumn(i + 1).width = w; });

  // buildLevelSumurExcelBlock mengembalikan baris kosong PERTAMA setelah blok
  // (blok 1: baris 1-26, kembali 27). Blok 2 dimulai di baris berikutnya (28),
  // persis jarak 1 baris kosong di file contoh.
  const nextRow = buildLevelSumurExcelBlock(ws, 0, MONTHS_ID.slice(0, 6), 0, `BULAN : Januari - Juni ${data.year}`, data);
  buildLevelSumurExcelBlock(ws, nextRow, MONTHS_ID.slice(6, 12), 6, `BULAN : Juli - Desember ${data.year}`, data);

  return wb.xlsx.writeBuffer();
}

// ===========================================================================
// KPI 18.1b Pengukuran Statis-Dinamis (apps/kpi-sab/statis-dinamis.html).
// Laporan nilai level air per sumur per bulan: SWL = Statis, DWL = Dinamis
// (unit (M) = meter). Data langsung dari sumur_level_readings (tidak disimpan
// sendiri). Daftar sumur = sumur AKTIF di 18.1a (sumur_wells active=true,
// category 'level') -- sumur nonaktif tidak tampil. Nama sumur memakai label
// dari file 18.1B Pengukuran Statis Dinamis.xlsx (BUKAN nama di database),
// dicocokkan lewat URUTAN (sort_order) supaya tetap benar walau ada sumur
// yang ditandai nonaktif di tengah (nama "reservoar"/"telaga sari"/"martadinata"
// tidak bergeser ke sumur lain).
// ===========================================================================

const KPI_18_1B_SECTIONS = [
  { installation: 'gunung_sari', label: 'I. GUNUNG SARI', names: ['Instalasi Gunung Sari', 'Instalasi Gunung Sari', 'Instalasi Gunung Sari', 'Instalasi Gunung Sari', 'Reservoar Lama', 'Waduk Telaga Sari', 'Martadinata'] },
  { installation: 'kampung_damai', label: 'II. KAMPUNG DAMAI', names: ['Parkiran IPA', 'Belakang Gas chlor', 'Terminal Tangki', 'Penggalang'] },
  { installation: 'prapatan', label: 'III. PRAPATAN', names: ['Samping PUSKESMAS', 'Inst Prapatan', 'Jl Pahala'] },
  { installation: 'zamp', label: 'IV. ZAMP', names: ['Jalan Belibis', 'Koperasi PDAM'] },
  { installation: 'kampung_baru_ulu', label: 'V. KAMPUNG BARU', names: ['Dalam Instalasi', 'Bawah SMA 3 BPP', 'Kantor LPM Kp Baru'] }
];

const KPI_18_1B_META_KEY = 'global';
const KPI_18_1B_LABEL_LEFT = 'Mengetahui/ Menyetujui';
const KPI_18_1B_LABEL_RIGHT = 'Dibuat oleh';
// Catatan default persis baris-baris di file contoh 18.1B (bisa diedit admin).
const DEFAULT_18_1B_META = {
  keterangan: [
    'Sumur no 1,2,3,4 Gunung Sari tidak ada casing pzometer nya',
    'Sumur No 5,6,7 Gn sari Tidak Dimatikan Karna Akan Mengganggu Produksi',
    'Sumur no 2 dan 6 Kampung damai Casing Pzometer nya rusak',
    'Sumur no 2 Kp Baru Casing Pzometer rusak'
  ],
  roleLeft: 'Manajer Produksi',
  nameLeft: '',
  roleRight: 'Supervisor Sumber Air Baku',
  nameRight: ''
};

async function loadGlobalLevelStatisDinamisMeta() {
  const { rows } = await pool.query('SELECT * FROM kpi_18_1b_meta WHERE period_key = $1', [KPI_18_1B_META_KEY]);
  if (!rows[0]) return null;
  const r = rows[0];
  return {
    keterangan: r.keterangan || [],
    roleLeft: r.role_left || '',
    nameLeft: r.name_left || '',
    roleRight: r.role_right || '',
    nameRight: r.name_right || ''
  };
}

async function saveLevelStatisDinamisMeta(m) {
  await pool.query(
    `INSERT INTO kpi_18_1b_meta (period_key, keterangan, role_left, name_left, role_right, name_right, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, now())
     ON CONFLICT (period_key) DO UPDATE SET
       keterangan = EXCLUDED.keterangan,
       role_left = EXCLUDED.role_left, name_left = EXCLUDED.name_left,
       role_right = EXCLUDED.role_right, name_right = EXCLUDED.name_right,
       updated_at = now()`,
    [KPI_18_1B_META_KEY, JSON.stringify(m.keterangan || []), m.roleLeft || '', m.nameLeft || '', m.roleRight || '', m.nameRight || '']
  );
}

// Baris pengukuran (statis/dinamis) satu instalasi dalam satu tahun.
async function fetchLevelStatisDinamisRows(installation, year) {
  const { rows } = await pool.query(
    `SELECT to_char(bulan, 'YYYY-MM') AS bulan, well_name, statis, dinamis
     FROM sumur_level_readings
     WHERE installation = $1 AND EXTRACT(YEAR FROM bulan) = $2
     ORDER BY bulan, well_name`,
    [installation, year]
  );
  return rows;
}

// Peta well_name -> { statis:[12], dinamis:[12] } untuk satu instalasi/tahun.
function levelWellMonthValues(rows, year) {
  const map = {};
  rows.forEach(r => {
    if (r.bulan.slice(0, 4) !== String(year)) return;
    const mi = Number(r.bulan.slice(5, 7)) - 1;
    if (!map[r.well_name]) map[r.well_name] = { statis: new Array(12).fill(null), dinamis: new Array(12).fill(null) };
    if (r.statis !== null && r.statis !== undefined) map[r.well_name].statis[mi] = Number(r.statis);
    if (r.dinamis !== null && r.dinamis !== undefined) map[r.well_name].dinamis[mi] = Number(r.dinamis);
  });
  return map;
}

// Pengunjung tanpa akses TIDAK menyentuh database: nama sumur tetap ditampilkan
// (label 18.1B, tidak sensitif), nilai statis/dinamis dibuat DUMMY.
async function getKpiLevelStatisDinamisData(access, tahunQuery) {
  const currentYear = String(new Date().getFullYear());
  if (!access.granted) {
    const year = tahunQuery || currentYear;
    return {
      locked: true, availableYears: [], year,
      groups: KPI_18_1B_SECTIONS.map(section => ({
        installation: section.installation, label: section.label,
        wells: section.names.map((nama, i) => ({
          no: i + 1, nama,
          statis: new Array(12).fill(null).map((_, mi) => 8 + (i % 5) + (mi % 3)),
          dinamis: new Array(12).fill(null).map((_, mi) => 8 + (i % 5) + (mi % 3) + 4)
        }))
      })),
      meta: { ...DEFAULT_18_1B_META, labelLeft: KPI_18_1B_LABEL_LEFT, labelRight: KPI_18_1B_LABEL_RIGHT, signPlaceDate: todaySignDate() }
    };
  }

  const { rows: yearRows } = await pool.query(
    `SELECT DISTINCT EXTRACT(YEAR FROM bulan)::int AS thn FROM sumur_level_readings ORDER BY thn`
  );
  // Urut menurun -- tahun terbaru di paling atas pemilih (pola sama KPI lain).
  const availableYears = Array.from(new Set([...yearRows.map(r => String(r.thn)), currentYear])).sort((a, b) => b.localeCompare(a));
  let year = (typeof tahunQuery === 'string' && /^\d{4}$/.test(tahunQuery)) ? tahunQuery : null;
  if (!year || !availableYears.includes(year)) year = availableYears[0];

  const [wellData, ...readings] = await Promise.all([
    fetchLevelWellData(),
    ...KPI_18_1B_SECTIONS.map(s => fetchLevelStatisDinamisRows(s.installation, year))
  ]);

  const groups = KPI_18_1B_SECTIONS.map((section, si) => {
    const allWells = (wellData[section.installation] || []).slice().sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    const valuesByWell = levelWellMonthValues(readings[si], year);
    let no = 0;
    const wells = [];
    allWells.forEach((w, idx) => {
      if (!w.active) return; // cuma sumur aktif di 18.1a
      const v = valuesByWell[w.well_name] || { statis: new Array(12).fill(null), dinamis: new Array(12).fill(null) };
      no++;
      wells.push({
        no,
        nama: section.names[idx] || w.well_name,
        statis: v.statis,
        dinamis: v.dinamis
      });
    });
    return { installation: section.installation, label: section.label, wells };
  });

  const meta = { ...(await loadGlobalLevelStatisDinamisMeta() || DEFAULT_18_1B_META), labelLeft: KPI_18_1B_LABEL_LEFT, labelRight: KPI_18_1B_LABEL_RIGHT, signPlaceDate: todaySignDate() };
  await logViewerAction(access, 'kpi_18_1b', 'view');

  return { locked: false, availableYears, year, groups, meta };
}

// --- Unduh Excel 18.1B -- exceljs di server (alasan sama KPI lain). Meniru
// file 18.1B Pengukuran Statis Dinamis.xlsx: kop Arial 12, judul Calibri 11
// tebal, header 3 baris (NAMA INSTALASI / nama bulan, lalu BULAN/SWL/DWL),
// sumur per instalasi (I-V) dengan SWL = Statis & DWL = Dinamis per bulan,
// Catatan, lalu tanda tangan. Dua blok semester (Jan-Jun & Jul-Des).
const KPI_18_1B_COL_WIDTHS = [3.66, 23.66];
for (let i = 0; i < 6; i++) KPI_18_1B_COL_WIDTHS.push(16, 8.66, 8.66); // 20 kolom A-T

function levelStatisDinamisMonthCols(i) { const base = 3 + i * 3; return { bulan: base, swl: base + 1, dwl: base + 2 }; }

function buildLevelStatisDinamisExcelBlock(ws, rowOffset, monthNames, monthBase, judulBulan, data, year) {
  const R = r => r + rowOffset;

  ws.getCell(`A${R(1)}`).value = 'PERUSAHAAN UMUM DAERAH TIRTA MANUNTUNG';
  ws.getCell(`A${R(1)}`).font = { bold: true, size: 12, name: 'Arial' };
  ws.getCell(`A${R(2)}`).value = 'KOTA BALIKPAPAN';
  ws.getCell(`A${R(2)}`).font = { bold: true, size: 12, name: 'Arial' };

  ws.mergeCells(`A${R(4)}:T${R(4)}`);
  ws.getCell(`A${R(4)}`).value = '18.1 B PENGUKURAN LEVEL SUMUR STATIS DAN DINAMIS';
  ws.getCell(`A${R(4)}`).font = { bold: true, size: 11, name: 'Calibri' };
  ws.getCell(`A${R(4)}`).alignment = { horizontal: 'center' };
  ws.mergeCells(`A${R(5)}:T${R(5)}`);
  ws.getCell(`A${R(5)}`).value = judulBulan;
  ws.getCell(`A${R(5)}`).font = { bold: true, size: 11, name: 'Calibri' };
  ws.getCell(`A${R(5)}`).alignment = { horizontal: 'center' };

  // Header 3 baris (7,8,9): NAMA INSTALASI + nama bulan (baris 7), BULAN/SWL/
  // DWL (baris 8, BULAN di-merge ke baris 9), NO/LOKASI SUMUR + satuan (M)
  // (baris 9). Semua Calibri 11; NAMA INSTALASI, NO, LOKASI SUMUR tebal.
  const H1 = R(7), H2 = R(8), H3 = R(9);
  ws.mergeCells(`A${H1}:B${H1}`);
  ws.getCell(`A${H1}`).value = 'NAMA INSTALASI';
  ws.getCell(`A${H1}`).font = { bold: true, size: 11, name: 'Calibri' };
  ws.getCell(`A${H1}`).alignment = { horizontal: 'center' };
  monthNames.forEach((mn, i) => {
    const { bulan, swl, dwl } = levelStatisDinamisMonthCols(i);
    const bc = colLetter(bulan), sc = colLetter(swl), dc = colLetter(dwl);
    ws.mergeCells(`${bc}${H1}:${dc}${H1}`);
    ws.getCell(`${bc}${H1}`).value = mn;
    ws.getCell(`${bc}${H1}`).font = { size: 11, name: 'Calibri' };
    ws.getCell(`${bc}${H1}`).alignment = { horizontal: 'center' };
    ws.mergeCells(`${bc}${H2}:${bc}${H3}`);
    ws.getCell(`${bc}${H2}`).value = 'BULAN';
    ws.getCell(`${bc}${H2}`).font = { size: 11, name: 'Calibri' };
    ws.getCell(`${bc}${H2}`).alignment = { horizontal: 'center' };
    ws.getCell(`${sc}${H2}`).value = 'SWL';
    ws.getCell(`${sc}${H2}`).font = { size: 11, name: 'Calibri' };
    ws.getCell(`${sc}${H2}`).alignment = { horizontal: 'center' };
    ws.getCell(`${dc}${H2}`).value = 'DWL';
    ws.getCell(`${dc}${H2}`).font = { size: 11, name: 'Calibri' };
    ws.getCell(`${dc}${H2}`).alignment = { horizontal: 'center' };
    ws.getCell(`${sc}${H3}`).value = '(M)';
    ws.getCell(`${sc}${H3}`).font = { size: 11, name: 'Calibri' };
    ws.getCell(`${sc}${H3}`).alignment = { horizontal: 'center' };
    ws.getCell(`${dc}${H3}`).value = '(M)';
    ws.getCell(`${dc}${H3}`).font = { size: 11, name: 'Calibri' };
    ws.getCell(`${dc}${H3}`).alignment = { horizontal: 'center' };
  });
  ws.getCell(`A${H3}`).value = 'NO';
  ws.getCell(`A${H3}`).font = { bold: true, size: 11, name: 'Calibri' };
  ws.getCell(`A${H3}`).alignment = { horizontal: 'center' };
  ws.getCell(`B${H3}`).value = 'LOKASI SUMUR';
  ws.getCell(`B${H3}`).font = { bold: true, size: 11, name: 'Calibri' };
  ws.getCell(`B${H3}`).alignment = { horizontal: 'center' };
  for (let rr = H1; rr <= H3; rr++) {
    for (let c = 1; c <= 20; c++) {
      const cell = ws.getRow(rr).getCell(c);
      cell.border = GRID;
      if (!cell.font) cell.font = { size: 11, name: 'Calibri' };
    }
  }
  ws.getRow(H1).height = 15.75;
  ws.getRow(H2).height = 15.75;
  ws.getRow(H3).height = 15.75;

  // Bagian per instalasi: baris judul (I. GUNUNG SARI, dll) lalu baris sumur.
  let r = R(11);
  data.groups.forEach(group => {
    ws.mergeCells(`A${r}:B${r}`);
    ws.getCell(`A${r}`).value = group.label;
    ws.getCell(`A${r}`).font = { bold: true, size: 11, name: 'Calibri' };
    ws.getCell(`A${r}`).alignment = { horizontal: 'left' };
    for (let c = 1; c <= 20; c++) ws.getRow(r).getCell(c).border = GRID;
    r++;

    group.wells.forEach(well => {
      ws.getCell(`A${r}`).value = well.no;
      ws.getCell(`A${r}`).font = { size: 11, name: 'Calibri' };
      ws.getCell(`A${r}`).alignment = { horizontal: 'center' };
      ws.getCell(`B${r}`).value = well.nama;
      ws.getCell(`B${r}`).font = { size: 11, name: 'Calibri' };
      ws.getCell(`B${r}`).alignment = { horizontal: 'left' };
      monthNames.forEach((mn, i) => {
        const { bulan, swl, dwl } = levelStatisDinamisMonthCols(i);
        const bc = colLetter(bulan), sc = colLetter(swl), dc = colLetter(dwl);
        const mi = monthBase + i;
        const s = well.statis[mi];
        const d = well.dinamis[mi];
        // Bulan tanpa data (statis & dinamis sama-sama kosong) dikosongkan;
        // kalau ada datanya, BULAN diisi otomatis dan nilai yang kosong (-).
        if (s !== null || d !== null) {
          ws.getCell(`${bc}${r}`).value = `${MONTHS_TITLE[mi]} ${year}`;
          ws.getCell(`${sc}${r}`).value = s !== null ? s : '-';
          ws.getCell(`${dc}${r}`).value = d !== null ? d : '-';
        }
        [bc, sc, dc].forEach(c => {
          const cell = ws.getCell(`${c}${r}`);
          cell.font = { size: 11, name: 'Calibri' };
          cell.alignment = { horizontal: 'center' };
          cell.numFmt = '0.00';
        });
      });
      for (let c = 1; c <= 20; c++) ws.getRow(r).getCell(c).border = GRID;
      r++;
    });
  });

  // Catatan (meta.keterangan, tanda bintang di kolom A) lalu tanda tangan.
  const meta = data.meta || {};
  const ketHeaderRow = r;
  ws.getCell(`B${ketHeaderRow}`).value = 'Catatan :';
  ws.getCell(`B${ketHeaderRow}`).font = { size: 11, name: 'Calibri' };
  r++;
  (meta.keterangan || []).forEach(k => {
    ws.getCell(`A${r}`).value = '*';
    ws.getCell(`A${r}`).font = { size: 11, name: 'Calibri' };
    ws.getCell(`A${r}`).alignment = { horizontal: 'right' };
    ws.getCell(`B${r}`).value = k;
    ws.getCell(`B${r}`).font = { size: 11, name: 'Calibri' };
    r++;
  });
  const lastKetRow = r - 1;

  const labelRow = lastKetRow + 2;
  ws.mergeCells(`A${labelRow}:D${labelRow}`);
  ws.getCell(`A${labelRow}`).value = meta.labelLeft || KPI_18_1B_LABEL_LEFT;
  ws.getCell(`A${labelRow}`).font = { size: 11, name: 'Calibri' };
  ws.getCell(`A${labelRow}`).alignment = { horizontal: 'center' };
  ws.mergeCells(`N${labelRow}:T${labelRow}`);
  ws.getCell(`N${labelRow}`).value = meta.signPlaceDate || '';
  ws.getCell(`N${labelRow}`).font = { size: 11, name: 'Calibri' };
  ws.getCell(`N${labelRow}`).alignment = { horizontal: 'center' };

  const roleRow = labelRow + 1;
  ws.mergeCells(`A${roleRow}:D${roleRow}`);
  ws.getCell(`A${roleRow}`).value = meta.roleLeft || '';
  ws.getCell(`A${roleRow}`).font = { size: 11, name: 'Calibri' };
  ws.getCell(`A${roleRow}`).alignment = { horizontal: 'center' };
  ws.mergeCells(`N${roleRow}:T${roleRow}`);
  ws.getCell(`N${roleRow}`).value = meta.labelRight || KPI_18_1B_LABEL_RIGHT;
  ws.getCell(`N${roleRow}`).font = { size: 11, name: 'Calibri' };
  ws.getCell(`N${roleRow}`).alignment = { horizontal: 'center' };

  ws.mergeCells(`N${roleRow + 1}:T${roleRow + 1}`);
  ws.getCell(`N${roleRow + 1}`).value = meta.roleRight || '';
  ws.getCell(`N${roleRow + 1}`).font = { size: 11, name: 'Calibri' };
  ws.getCell(`N${roleRow + 1}`).alignment = { horizontal: 'center', wrapText: true };

  const nameLeftRow = roleRow + 4;
  ws.mergeCells(`A${nameLeftRow}:D${nameLeftRow}`);
  ws.getCell(`A${nameLeftRow}`).value = meta.nameLeft || '';
  ws.getCell(`A${nameLeftRow}`).font = { bold: true, size: 12, name: 'Calibri' };
  ws.getCell(`A${nameLeftRow}`).alignment = { horizontal: 'center' };

  const nameRightRow = nameLeftRow + 1;
  ws.mergeCells(`N${nameRightRow}:T${nameRightRow}`);
  ws.getCell(`N${nameRightRow}`).value = meta.nameRight || '';
  ws.getCell(`N${nameRightRow}`).font = { bold: true, size: 12, name: 'Calibri' };
  ws.getCell(`N${nameRightRow}`).alignment = { horizontal: 'center' };

  return nameRightRow + 1;
}

async function buildKpiLevelStatisDinamisExcelWorkbook(data) {
  const wb = new ExcelJS.Workbook();
  wb.calcProperties.fullCalcOnLoad = true;
  const ws = wb.addWorksheet('18.1B STATIS DINAMIS', {
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 1, paperSize: 5, horizontalCentered: true, showGridLines: false }
  });
  ws.pageSetup.margins = { left: 0.25, right: 0.25, top: 0.75, bottom: 0.75, header: 0.3, footer: 0.3 };
  KPI_18_1B_COL_WIDTHS.forEach((w, i) => { ws.getColumn(i + 1).width = w; });

  // Nama bulan di header 18.1B memakai huruf kecil ("Januari", bukan "JANUARI"
  // seperti KPI lain) -- persis file contoh.
  const nextRow = buildLevelStatisDinamisExcelBlock(ws, 0, MONTHS_TITLE.slice(0, 6), 0, `BULAN : Januari - Juni ${data.year}`, data, data.year);
  buildLevelStatisDinamisExcelBlock(ws, nextRow, MONTHS_TITLE.slice(6, 12), 6, `BULAN : Juli - Desember ${data.year}`, data, data.year);

  return wb.xlsx.writeBuffer();
}

// ===========================================================================
// KPI 18.5 Monitoring Kondisi Peralatan (apps/kpi-sab/peralatan.html).
// BEDA dari KPI lain -- laporan ini TIDAK mengambil angka dari tabel sumber:
// ANGG (anggaran jumlah alat ukur) & REAL (jumlah alat yang terpantau) diisi
// MANUAL oleh admin, disimpan per bulan (periode 'YYYY-MM') per item di tabel
// kpi_18_5_monitoring. ± = REAL-ANGG, % = REAL/ANGG*100 dihitung otomatis.
// Tahun laporan MENGIKUTI TEMPLATE (tahun fiskal Juli-Juni): user memilih
// tahun, blok 1 = Juli-Desember tahun itu, blok 2 = Januari-Juni tahun
// berikutnya. 5 item tetap (CURAH HUJAN, LEVEL MUKA AIR WADUK, SPEED BOAT,
// ULTRASONIC FLOWMETER FLEXIM, DEEP METER). Excel meniru file 18.5 Monitoring
// Kondisi Peralatan.xlsx: dua blok BERSANDINGAN (A-Z dan AA-BA).
// ===========================================================================

const KPI_18_5_ITEMS = ['CURAH HUJAN', 'LEVEL MUKA AIR WADUK', 'SPEED BOAT', 'ULTRASONIC FLOWMETER FLEXIM', 'DEEP METER'];

// Indeks fiskal 0-11: 0=Juli, 1=Agustus, ..., 11=Juni. Bulan >= Juli masuk
// tahun fiskal = tahun itu; Januari-Juni masuk tahun fiskal = tahun - 1.
function kpi18_5FiscalYear(date) {
  return date.getMonth() >= 6 ? date.getFullYear() : date.getFullYear() - 1;
}
// Nama bulan (huruf kapital, persis header Excel) untuk indeks fiskal.
function kpi18_5MonthName(mi) { return MONTHS_ID[(mi + 6) % 12]; }
// Periode kalender 'YYYY-MM' untuk indeks fiskal mi pada tahun fiskal.
function kpi18_5Period(tahun, mi) {
  const y = mi < 6 ? Number(tahun) : Number(tahun) + 1;
  return `${y}-${pad2((mi + 6) % 12 + 1)}`;
}
// Label bulan untuk web, mis. "Juli 2026".
function kpi18_5MonthTitle(tahun, mi) {
  const y = mi < 6 ? Number(tahun) : Number(tahun) + 1;
  return `${MONTHS_TITLE[(mi + 6) % 12]} ${y}`;
}

const KPI_18_5_META_KEY = 'global';
const KPI_18_5_LABEL_LEFT = 'Mengetahui/Menyetujui :';
const KPI_18_5_LABEL_RIGHT = 'Direkap Oleh';
// Keterangan & penandatangan default persis file contoh 18.5. "Manajer
// Produksi" sengaja dibetulkan ejaannya (contoh menulis "Manajer produsi").
const DEFAULT_18_5_META = {
  keterangan: [
    'Anggaran adalah jumlah alat ukur yang harus dimonitor',
    'Speed boat rusak'
  ],
  roleLeft: 'Manajer Produksi',
  nameLeft: '',
  roleRight: 'Supervisor Sumber Air Baku & Lingkungan',
  nameRight: ''
};

async function loadGlobalKpi18_5Meta() {
  const { rows } = await pool.query('SELECT * FROM kpi_18_5_meta WHERE period_key = $1', [KPI_18_5_META_KEY]);
  if (!rows[0]) return null;
  const r = rows[0];
  return {
    keterangan: r.keterangan || [],
    roleLeft: r.role_left || '',
    nameLeft: r.name_left || '',
    roleRight: r.role_right || '',
    nameRight: r.name_right || ''
  };
}

async function saveKpi18_5Meta(m) {
  await pool.query(
    `INSERT INTO kpi_18_5_meta (period_key, keterangan, role_left, name_left, role_right, name_right, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, now())
     ON CONFLICT (period_key) DO UPDATE SET
       keterangan = EXCLUDED.keterangan,
       role_left = EXCLUDED.role_left, name_left = EXCLUDED.name_left,
       role_right = EXCLUDED.role_right, name_right = EXCLUDED.name_right,
       updated_at = now()`,
    [KPI_18_5_META_KEY, JSON.stringify(m.keterangan || []), m.roleLeft || '', m.nameLeft || '', m.roleRight || '', m.nameRight || '']
  );
}

// Pengunjung tanpa akses: data contoh (semua 1, persis isi file contoh) --
// TIDAK menyentuh database.
async function getKpi18_5Data(access, tahunQuery) {
  const currentFiscal = kpi18_5FiscalYear(new Date());
  let tahun = (typeof tahunQuery === 'string' && /^\d{4}$/.test(tahunQuery)) ? tahunQuery : String(currentFiscal);

  if (!access.granted) {
    return {
      locked: true, availableYears: [], tahun,
      groups: KPI_18_5_ITEMS.map((label, i) => ({
        no: i + 1, label,
        angg: new Array(12).fill(1),
        real: new Array(12).fill(1)
      })),
      meta: { ...DEFAULT_18_5_META, labelLeft: KPI_18_5_LABEL_LEFT, labelRight: KPI_18_5_LABEL_RIGHT, signPlaceDate: todaySignDate() }
    };
  }

  const periods = Array.from({ length: 12 }, (_, mi) => kpi18_5Period(tahun, mi));
  const { rows } = await pool.query(
    'SELECT periode, item_no, angg, real FROM kpi_18_5_monitoring WHERE periode = ANY($1)',
    [periods]
  );
  const byKey = new Map();
  rows.forEach(r => byKey.set(`${r.periode}_${r.item_no}`, r));

  const groups = KPI_18_5_ITEMS.map((label, i) => {
    const angg = new Array(12).fill(null), real = new Array(12).fill(null);
    periods.forEach((p, mi) => {
      const rec = byKey.get(`${p}_${i + 1}`);
      if (rec) {
        angg[mi] = rec.angg !== null && rec.angg !== undefined ? Number(rec.angg) : null;
        real[mi] = rec.real !== null && rec.real !== undefined ? Number(rec.real) : null;
      }
    });
    return { no: i + 1, label, angg, real };
  });

  const { rows: yr } = await pool.query('SELECT DISTINCT periode FROM kpi_18_5_monitoring');
  const fiscalSet = new Set([String(currentFiscal)]);
  yr.forEach(r => {
    const [y, m] = r.periode.split('-').map(Number);
    fiscalSet.add(String(m >= 7 ? y : y - 1));
  });
  const availableYears = Array.from(fiscalSet).sort((a, b) => b.localeCompare(a));

  const meta = { ...(await loadGlobalKpi18_5Meta() || DEFAULT_18_5_META), labelLeft: KPI_18_5_LABEL_LEFT, labelRight: KPI_18_5_LABEL_RIGHT, signPlaceDate: todaySignDate() };
  await logViewerAction(access, 'kpi_18_5', 'view');

  return { locked: false, availableYears, tahun, groups, meta };
}

// Simpan satu sel ANGG/REAL (per periode + item). Admin mengisi manual.
async function saveKpi18_5Values(periode, itemNo, angg, real) {
  const toNumOrNull = v => (v === null || v === undefined || v === '' || isNaN(Number(v))) ? null : Number(v);
  await pool.query(
    `INSERT INTO kpi_18_5_monitoring (periode, item_no, angg, real, updated_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (periode, item_no) DO UPDATE SET angg = EXCLUDED.angg, real = EXCLUDED.real, updated_at = now()`,
    [periode, itemNo, toNumOrNull(angg), toNumOrNull(real)]
  );
}

// --- Unduh Excel 18.5 -- exceljs di server (alasan sama KPI lain). Meniru
// file 18.5 Monitoring Kondisi Peralatan.xlsx: dua blok BERSANDINGAN (blok 1
// A-Z = Juli-Desember, blok 2 AA-BA = Januari-Juni tahun berikutnya), header
// 3 baris (NO/URAIAN + nama bulan, lalu ANGG/REAL/RATIO EFFISIENSI, lalu ±/%),
// 5 item, RATA-RATA (SUM ANGG/REAL/±, AVERAGE %), Keterangan, tanda tangan
// ("Mengetahui/Menyetujui :" / "Direkap Oleh"). Satu sheet, baris sama untuk
// kedua blok.
const KPI_18_5_COL_WIDTHS = [4.33, 33.66];
for (let i = 0; i < 6; i++) KPI_18_5_COL_WIDTHS.push(7.55, 7.55, 10.66, 10.66);
KPI_18_5_COL_WIDTHS.push(8.66); // kolom pemisah antar blok
KPI_18_5_COL_WIDTHS.push(4.33, 33.66);
for (let i = 0; i < 6; i++) KPI_18_5_COL_WIDTHS.push(7.55, 7.55, 10.66, 10.66);

function kpi18_5BlockCols(mi) { const base = 3 + mi * 4; return { angg: base, real: base + 1, pm: base + 2, pct: base + 3 }; }

function buildKpi18_5Block(ws, base, monthIdx, judulBulan, data, meta, tahun) {
  const c = i => colLetter(base + i);
  const C = (rel, row) => `${c(rel)}${row}`;

  // Kop (Arial 12 tebal) & judul (Calibri 14/12 tebal), di-merge per blok.
  ws.getCell(C(1, 2)).value = 'PERUSAHAAN UMUM DAERAH TIRTA MANUNTUNG';
  ws.getCell(C(1, 2)).font = { bold: true, size: 12, name: 'Arial' };
  ws.getCell(C(1, 3)).value = 'KOTA BALIKPAPAN';
  ws.getCell(C(1, 3)).font = { bold: true, size: 12, name: 'Arial' };
  ws.mergeCells(C(1, 5) + ':' + C(26, 5));
  ws.getCell(C(1, 5)).value = '18.5 MONITORING KONDISI PERALATAN';
  ws.getCell(C(1, 5)).font = { bold: true, size: 14, name: 'Calibri' };
  ws.getCell(C(1, 5)).alignment = { horizontal: 'center' };
  ws.getRow(5).height = 18;
  ws.mergeCells(C(1, 6) + ':' + C(26, 6));
  ws.getCell(C(1, 6)).value = judulBulan;
  ws.getCell(C(1, 6)).font = { bold: true, size: 12, name: 'Calibri' };
  ws.getCell(C(1, 6)).alignment = { horizontal: 'center' };
  ws.getRow(6).height = 18;

  // Header 3 baris (9,10,11): NO/URAIAN (merge 9-11), nama bulan (baris 9,
  // merge 4 kolom), ANGG/REAL (baris 10, merge 10-11), RATIO EFFISIENSI
  // (baris 10, merge 2 kolom), ±/% (baris 11).
  const H1 = 9, H2 = 10, H3 = 11;
  ws.mergeCells(C(1, H1) + ':' + C(1, H3)); ws.getCell(C(1, H1)).value = 'NO';
  ws.mergeCells(C(2, H1) + ':' + C(2, H3)); ws.getCell(C(2, H1)).value = 'URAIAN';
  monthIdx.forEach((mi, i) => {
    const { angg, real, pm, pct } = kpi18_5BlockCols(i);
    ws.mergeCells(C(angg, H1) + ':' + C(pct, H1));
    ws.getCell(C(angg, H1)).value = kpi18_5MonthName(mi);
    ws.mergeCells(C(angg, H2) + ':' + C(angg, H3)); ws.getCell(C(angg, H2)).value = 'ANGG';
    ws.mergeCells(C(real, H2) + ':' + C(real, H3)); ws.getCell(C(real, H2)).value = 'REAL';
    ws.mergeCells(C(pm, H2) + ':' + C(pct, H2)); ws.getCell(C(pm, H2)).value = 'RATIO EFFISIENSI';
    ws.getCell(C(pm, H3)).value = '±';
    ws.getCell(C(pct, H3)).value = '%';
  });
  for (let rr = H1; rr <= H3; rr++) {
    for (let i = 1; i <= 26; i++) {
      const cell = ws.getCell(C(i, rr));
      cell.font = { bold: true, size: 11, name: 'Calibri' };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = GRID;
    }
  }
  ws.getRow(H1).height = 16.8;
  ws.getRow(H2).height = 16.5;
  ws.getRow(H3).height = 16.5;

  // Data: 5 item. ANGG/REAL nilai manual; ± & % formula.
  let r = 12;
  data.groups.forEach(g => {
    ws.getCell(C(1, r)).value = g.no;
    ws.getCell(C(1, r)).font = { size: 11, name: 'Calibri' };
    ws.getCell(C(1, r)).alignment = { horizontal: 'center' };
    ws.getCell(C(1, r)).border = GRID;
    ws.getCell(C(2, r)).value = g.label;
    ws.getCell(C(2, r)).font = { size: 11, name: 'Calibri' };
    ws.getCell(C(2, r)).alignment = { horizontal: 'left' };
    ws.getCell(C(2, r)).border = GRID;
    monthIdx.forEach((mi, i) => {
      const { angg, real, pm, pct } = kpi18_5BlockCols(i);
      const a = g.angg[mi], rel = g.real[mi];
      if (a !== null && a !== undefined) ws.getCell(C(angg, r)).value = a;
      if (rel !== null && rel !== undefined) ws.getCell(C(real, r)).value = rel;
      ws.getCell(C(pm, r)).value = { formula: `IF(OR(${C(real, r)}="",${C(angg, r)}=""),"",${C(real, r)}-${C(angg, r)})` };
      ws.getCell(C(pct, r)).value = { formula: `IF(OR(${C(real, r)}="",${C(angg, r)}=""),"",${C(real, r)}/${C(angg, r)}*100)` };
      [C(angg, r), C(real, r), C(pm, r), C(pct, r)].forEach(addr => {
        const cell = ws.getCell(addr);
        cell.font = { size: 11, name: 'Calibri' };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.border = GRID;
      });
    });
    ws.getRow(r).height = 30.75;
    r++;
  });
  const firstDataRow = 12, lastDataRow = 16;

  // RATA-RATA (row 17): SUM ANGG/REAL/±, AVERAGE %; bulan kosong ikut kosong.
  const rataRow = 17;
  ws.getCell(C(2, rataRow)).value = 'RATA-RATA';
  ws.getCell(C(2, rataRow)).font = { bold: true, size: 11, name: 'Calibri' };
  ws.getCell(C(2, rataRow)).alignment = { horizontal: 'center' };
  monthIdx.forEach((mi, i) => {
    const { angg, real, pm, pct } = kpi18_5BlockCols(i);
    let sumA = 0, sumR = 0, sumPm = 0, pcts = [], any = false;
    data.groups.forEach(g => {
      const a = g.angg[mi], rv = g.real[mi];
      if (a !== null && a !== undefined) sumA += a;
      if (rv !== null && rv !== undefined) sumR += rv;
      if (a !== null && rv !== null) { sumPm += (rv - a); pcts.push(rv / a * 100); }
      if (a !== null || rv !== null) any = true;
    });
    if (any) {
      ws.getCell(C(angg, rataRow)).value = { formula: `SUM(${C(angg, firstDataRow)}:${C(angg, lastDataRow)})`, result: sumA };
      ws.getCell(C(real, rataRow)).value = { formula: `SUM(${C(real, firstDataRow)}:${C(real, lastDataRow)})`, result: sumR };
      ws.getCell(C(pm, rataRow)).value = { formula: `SUM(${C(pm, firstDataRow)}:${C(pm, lastDataRow)})`, result: sumPm };
      ws.getCell(C(pct, rataRow)).value = { formula: `IF(COUNT(${C(pct, firstDataRow)}:${C(pct, lastDataRow)})=0,"",AVERAGE(${C(pct, firstDataRow)}:${C(pct, lastDataRow)}))`, result: pcts.length ? Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length * 100) / 100 : '' };
    }
    [C(angg, rataRow), C(real, rataRow), C(pm, rataRow), C(pct, rataRow)].forEach(addr => {
      const cell = ws.getCell(addr);
      cell.font = { bold: true, size: 11, name: 'Calibri' };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = GRID;
      cell.numFmt = '#,##0';
    });
  });
  ws.getCell(C(1, rataRow)).border = GRID;
  ws.getCell(C(2, rataRow)).border = GRID;
  ws.getRow(rataRow).height = 30.75;

  // Keterangan (baris 19-21): "Keterangan :" lalu baris-baris meta.keterangan
  // dengan "~" di kolom A.
  const ketHeaderRow = 19;
  ws.getCell(C(2, ketHeaderRow)).value = 'Keterangan :';
  ws.getCell(C(2, ketHeaderRow)).font = { size: 11, name: 'Calibri' };
  let kr = ketHeaderRow + 1;
  (meta.keterangan || []).forEach(k => {
    ws.getCell(C(1, kr)).value = '~';
    ws.getCell(C(1, kr)).font = { size: 11, name: 'Calibri' };
    ws.getCell(C(2, kr)).value = k;
    ws.getCell(C(2, kr)).font = { size: 11, name: 'Calibri' };
    kr++;
  });
  const lastKetRow = kr - 1;

  // Tanda tangan: kiri (kolom 5-8) "Mengetahui/Menyetujui :", kanan (22-26)
  // "Direkap Oleh". Tanggal di baris label kanan.
  const labelRow = 23;
  ws.mergeCells(C(5, labelRow) + ':' + C(8, labelRow));
  ws.getCell(C(5, labelRow)).value = meta.labelLeft || KPI_18_5_LABEL_LEFT;
  ws.getCell(C(5, labelRow)).font = { size: 11, name: 'Calibri' };
  ws.getCell(C(5, labelRow)).alignment = { horizontal: 'center' };
  ws.mergeCells(C(22, labelRow) + ':' + C(26, labelRow));
  ws.getCell(C(22, labelRow)).value = meta.signPlaceDate || '';
  ws.getCell(C(22, labelRow)).font = { size: 11, name: 'Calibri' };
  ws.getCell(C(22, labelRow)).alignment = { horizontal: 'center' };

  const roleRow = labelRow + 1;
  ws.mergeCells(C(5, roleRow) + ':' + C(8, roleRow));
  ws.getCell(C(5, roleRow)).value = meta.roleLeft || '';
  ws.getCell(C(5, roleRow)).font = { size: 11, name: 'Calibri' };
  ws.getCell(C(5, roleRow)).alignment = { horizontal: 'center' };
  ws.mergeCells(C(22, roleRow) + ':' + C(26, roleRow));
  ws.getCell(C(22, roleRow)).value = meta.labelRight || KPI_18_5_LABEL_RIGHT;
  ws.getCell(C(22, roleRow)).font = { size: 11, name: 'Calibri' };
  ws.getCell(C(22, roleRow)).alignment = { horizontal: 'center' };

  ws.mergeCells(C(22, roleRow + 1) + ':' + C(26, roleRow + 1));
  ws.getCell(C(22, roleRow + 1)).value = meta.roleRight || '';
  ws.getCell(C(22, roleRow + 1)).font = { size: 11, name: 'Calibri' };
  ws.getCell(C(22, roleRow + 1)).alignment = { horizontal: 'center', wrapText: true };

  const nameRow = roleRow + 4;
  ws.mergeCells(C(5, nameRow) + ':' + C(8, nameRow + 1));
  ws.getCell(C(5, nameRow)).value = meta.nameLeft || '';
  ws.getCell(C(5, nameRow)).font = { bold: true, size: 12, name: 'Calibri' };
  ws.getCell(C(5, nameRow)).alignment = { horizontal: 'center', vertical: 'top' };
  ws.mergeCells(C(22, nameRow) + ':' + C(26, nameRow));
  ws.getCell(C(22, nameRow)).value = meta.nameRight || '';
  ws.getCell(C(22, nameRow)).font = { bold: true, size: 12, name: 'Calibri' };
  ws.getCell(C(22, nameRow)).alignment = { horizontal: 'center' };
}

async function buildKpi18_5ExcelWorkbook(data) {
  const wb = new ExcelJS.Workbook();
  wb.calcProperties.fullCalcOnLoad = true;
  const ws = wb.addWorksheet('18.5 INSTRUMEN_OK', {
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 1, paperSize: 5, horizontalCentered: true, showGridLines: false }
  });
  ws.pageSetup.margins = { left: 0.25, right: 0.25, top: 0.75, bottom: 0.75, header: 0.3, footer: 0.3 };
  KPI_18_5_COL_WIDTHS.forEach((w, i) => { ws.getColumn(i + 1).width = w; });

  const meta = data.meta || {};
  buildKpi18_5Block(ws, 0, [0, 1, 2, 3, 4, 5], `BULAN : Juli - Desember ${data.tahun}`, data, meta, data.tahun);
  buildKpi18_5Block(ws, 27, [6, 7, 8, 9, 10, 11], `BULAN : Januari - Juni ${Number(data.tahun) + 1}`, data, meta, data.tahun);

  return wb.xlsx.writeBuffer();
}

// ===========================================================================
// KPI 18.6 Jadwal PM Terkendali (apps/kpi-sab/jadwal-pm.html). Menampilkan,
// per bulan, tanggal RENCANA dan REALISASI untuk item monitoring yang SAMA
// dengan 19.2 (pipa transmisi & service sumur) -- data dihitung ulang dari
// 19.2, tidak disimpan sendiri:
//   - RENCANA = tanggal jadwal rutin (Selasa/Senin minggu ke-2/4, lihat
//     kpi192Tanggal).
//   - REALISASI = tanggal jadwal KALAU ada berita acara (baris pekerjaan,
//     bidang transmisi/service-sumur) di rentang bulan itu, "-" kalau belum.
// Tahun mengikuti TEMPLATE (fiskal): blok 1 = Januari-Juni tahun terpilih,
// blok 2 = Juli-Desember tahun SEBELUMNYA. Tiga kelompok item: 1 & 2 pipa
// transmisi (minggu ke-2 & ke-4), 3 service sumur (minggu ke-2 & ke-4).
// ===========================================================================

// Indeks 0-11 untuk 18.6 = bulan KALENDER (0=Januari..11=Desember), semua
// dalam TAHUN yang sama (0-5 = Januari-Juni, 6-11 = Juli-Desember) -- dua
// blok satu tahun, persis KPI lain (18.3b).
function kpi18_6Calendar(tahun, mi) {
  return { year: Number(tahun), monthIndex: mi };
}
function kpi18_6MonthName(mi) { return MONTHS_ID[mi]; }
function kpi18_6MonthTitle(tahun, mi) {
  return `${MONTHS_TITLE[mi]} ${tahun}`;
}

// Kelompok item persis file 18.6 yang DIEDIT user: satu label URAIAN per
// kelompok (di-merge sepanjang kelompok), dan tiap kelompok punya daftar
// jadwal (`defs` menunjuk indeks KPI_19_2_DEFS 0-3). Tiap jadwal tampil
// sebagai 2 sub-baris: Rencana & Realisasi.
//   NO 1 = Pipa Transmisi minggu ke-2 (def 0)
//   NO 2 = Pipa Transmisi minggu ke-4 (def 1)
//   NO 3 = Service Sumur minggu ke-2 (def 2) & ke-4 (def 3), satu label.
const KPI_18_6_GROUPS = [
  { no: 1, label: 'Jalur Pipa Transmisi Km12 - km8', defs: [0] },
  { no: 2, label: 'Jalur Pipa Transmisi Km 8 - Kampung Damai', defs: [1] },
  { no: 3, label: 'Jalur Pipa Sumur dan Perawatan Sumur-sumur', defs: [2, 3] }
];

const KPI_18_6_META_KEY = 'global';
const KPI_18_6_LABEL_LEFT = 'Mengetahui/ Menyetujui';
const DEFAULT_18_6_META = {
  keterangan: [],
  roleLeft: 'Manajer Produksi',
  nameLeft: 'DEDY HERMAWAN, S.M',
  roleRight: 'Supervisor Sumber Air Baku & Lingkungan',
  nameRight: 'DARTO'
};

async function loadGlobalKpi18_6Meta() {
  const { rows } = await pool.query('SELECT * FROM kpi_18_6_meta WHERE period_key = $1', [KPI_18_6_META_KEY]);
  if (!rows[0]) return null;
  const r = rows[0];
  return {
    keterangan: r.keterangan || [],
    roleLeft: r.role_left || '',
    nameLeft: r.name_left || '',
    roleRight: r.role_right || '',
    nameRight: r.name_right || ''
  };
}

async function saveKpi18_6Meta(m) {
  await pool.query(
    `INSERT INTO kpi_18_6_meta (period_key, keterangan, role_left, name_left, role_right, name_right, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, now())
     ON CONFLICT (period_key) DO UPDATE SET
       keterangan = EXCLUDED.keterangan,
       role_left = EXCLUDED.role_left, name_left = EXCLUDED.name_left,
       role_right = EXCLUDED.role_right, name_right = EXCLUDED.name_right,
       updated_at = now()`,
    [KPI_18_6_META_KEY, JSON.stringify(m.keterangan || []), m.roleLeft || '', m.nameLeft || '', m.roleRight || '', m.nameRight || '']
  );
}

// Semua tanggal berita acara satu bidang dalam satu tahun (dipakai mengecek
// apakah bulan itu "sudah direalisasikan" -- ada BA di rentang jadwalnya).
async function fetchPekerjaanBaForYear(bidang, year) {
  const { rows } = await pool.query(
    `SELECT to_char(tanggal, 'YYYY-MM-DD') AS tanggal FROM pekerjaan
     WHERE deleted_at IS NULL AND status = 'final' AND bidang = $1
       AND EXTRACT(YEAR FROM tanggal) = $2`,
    [bidang, year]
  );
  return rows.map(r => r.tanggal);
}

function hasBaInRange(dates, year, monthIndex, paruh) {
  const d = day => `${year}-${pad2(monthIndex + 1)}-${pad2(day)}`;
  const start = paruh === 'awal' ? d(1) : d(15);
  const end = paruh === 'awal' ? d(14) : d(daysInMonth(year, monthIndex));
  return dates.some(t => t >= start && t <= end);
}

// Pengunjung tanpa akses: tanggal RENCANA tetap dihitung (hanya turunan
// jadwal, tidak sensitif), REALISASI dummy "-" (isi BA data vital) --
// TIDAK menyentuh database.
async function getKpi18_6Data(access, tahunQuery) {
  const currentYear = String(new Date().getFullYear());
  let tahun = (typeof tahunQuery === 'string' && /^\d{4}$/.test(tahunQuery)) ? tahunQuery : currentYear;

  // Bulan & tahun berjalan (zona server) -- dipakai mengosongkan bulan yang
  // belum tiba.
  const curYear = new Date().getFullYear();
  const curMonth = new Date().getMonth();

  const buildBlock = (defIndex, baDates) => {
    const def = KPI_19_2_DEFS[defIndex];
    const rencDates = [], realDates = [];
    for (let mi = 0; mi < 12; mi++) {
      const { year, monthIndex } = kpi18_6Calendar(tahun, mi);
      // Bulan yang BELUM TIBA (di atas bulan berjalan) dikosongkan -- permintaan
      // user: kalau belum waktunya, jangan tampilkan isinya.
      if (year > curYear || (year === curYear && monthIndex > curMonth)) {
        rencDates.push(''); realDates.push(''); continue;
      }
      const t = kpi192Tanggal(year, monthIndex, def.hari, def.minggu);
      const has = baDates ? hasBaInRange(baDates, year, monthIndex, def.paruh) : false;
      rencDates.push(t ? formatTanggalId(t) : '');
      realDates.push(has ? (t ? formatTanggalId(t) : '-') : '-');
    }
    return { rencDates, realDates };
  };

  if (!access.granted) {
    return {
      locked: true, availableYears: [], tahun,
      groups: KPI_18_6_GROUPS.map(g => ({ no: g.no, label: g.label, blocks: g.defs.map(d => buildBlock(d, null)) })),
      meta: { ...DEFAULT_18_6_META, labelLeft: KPI_18_6_LABEL_LEFT, signPlaceDate: todaySignDate() }
    };
  }

  // Ambil tanggal BA untuk kedua tahun kalender yang tercakup (tahun & tahun-1).
  const years = [Number(tahun), Number(tahun) - 1];
  const baByDef = {};
  await Promise.all(KPI_19_2_DEFS.map(async (def, di) => {
    const all = [];
    for (const y of years) all.push(...(await fetchPekerjaanBaForYear(def.bidang, y)));
    baByDef[di] = all;
  }));

  const groups = KPI_18_6_GROUPS.map(g => ({
    no: g.no,
    label: g.label,
    blocks: g.defs.map(d => buildBlock(d, baByDef[d] || []))
  }));

  const { rows: yr } = await pool.query(
    `SELECT DISTINCT EXTRACT(YEAR FROM tanggal)::int AS y FROM pekerjaan
     WHERE deleted_at IS NULL AND status = 'final' AND bidang IN ('transmisi','service-sumur')`
  );
  const availableYears = Array.from(new Set([...yr.map(r => String(r.y)), currentYear])).sort((a, b) => b.localeCompare(a));

  const meta = { ...(await loadGlobalKpi18_6Meta() || DEFAULT_18_6_META), labelLeft: KPI_18_6_LABEL_LEFT, signPlaceDate: todaySignDate() };
  await logViewerAction(access, 'kpi_18_6', 'view');

  return { locked: false, availableYears, tahun, groups, meta };
}

// --- Unduh Excel 18.6 -- exceljs di server (alasan sama KPI lain). Meniru
// file 18.6 Jadwal PM Terkendali.xlsx: kop Arial 12, judul Calibri 14 tebal,
// header 2 baris (NO | URAIAN | 6 nama bulan), lalu tiap kelompok item =
// baris Rencana + baris Realisasi (kolom "Renc"/"Real"), tanggal jadwal per
// bulan. Dua blok bertumpuk: Januari-Juni tahun terpilih & Juli-Desember
// tahun sebelumnya. Tanda tangan ("Mengetahui/ Menyetujui" kiri, tanggal
// kanan, tanpa Keterangan).
const KPI_18_6_COL_WIDTHS = [4.55, 6.66, 6.66, 8.55, 8.66, 15.66, 15.66, 16.66, 15.66, 17.33, 19.44];

function buildKpi18_6Block(ws, rowOffset, monthIdx, judulBulan, data, meta, tahun) {
  const R = r => r + rowOffset;

  ws.getCell(`A${R(1)}`).value = 'PERUSAHAAN UMUM DAERAH TIRTA MANUNTUNG';
  ws.getCell(`A${R(1)}`).font = { bold: true, size: 12, name: 'Arial' };
  ws.getCell(`A${R(2)}`).value = 'KOTA BALIKPAPAN';
  ws.getCell(`A${R(2)}`).font = { bold: true, size: 12, name: 'Arial' };

  ws.mergeCells(`A${R(3)}:K${R(3)}`);
  ws.getCell(`A${R(3)}`).value = ' 18.6 JADWAL PM TERKENDALI SUMBER AIR & LINGKUNGAN';
  ws.getCell(`A${R(3)}`).font = { bold: true, size: 14, name: 'Calibri' };
  ws.getCell(`A${R(3)}`).alignment = { horizontal: 'center' };
  ws.mergeCells(`A${R(4)}:K${R(4)}`);
  ws.getCell(`A${R(4)}`).value = judulBulan;
  ws.getCell(`A${R(4)}`).font = { bold: true, size: 12, name: 'Calibri' };
  ws.getCell(`A${R(4)}`).alignment = { horizontal: 'center' };
  // Tinggi baris kop/judul/bulan 12.45 -- persis file contoh yang diedit.
  ws.getRow(R(1)).height = 12.45;
  ws.getRow(R(2)).height = 12.45;
  ws.getRow(R(3)).height = 12.45;
  ws.getRow(R(4)).height = 12.45;

  // Header 2 baris (5-6) di-merge: NO | URAIAN | 6 nama bulan.
  const H1 = R(5), H2 = R(6);
  ws.mergeCells(`A${H1}:A${H2}`); ws.getCell(`A${H1}`).value = 'NO';
  ws.mergeCells(`B${H1}:D${H2}`); ws.getCell(`B${H1}`).value = 'URAIAN';
  monthIdx.forEach((mi, i) => {
    const c = colLetter(6 + i);
    ws.mergeCells(`${c}${H1}:${c}${H2}`);
    ws.getCell(`${c}${H1}`).value = kpi18_6MonthName(mi);
  });
  for (let rr = H1; rr <= H2; rr++) {
    for (let c = 1; c <= 11; c++) {
      const cell = ws.getRow(rr).getCell(c);
      cell.font = { bold: true, size: 11, name: 'Calibri' };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = GRID;
    }
  }

  // Data -- persis file contoh yang diedit: tiap kelompok punya SATU label
  // URAIAN (B:D) di-merge sepanjang kelompok, NO (A) di-merge sepanjang
  // kelompok, dan tiap jadwal (`block`) tampil sebagai 2 sub-baris Rencana +
  // Realisasi, masing-masing 3 BARIS di-merge vertikal (E dan tiap bulan F-K).
  let r = R(7);
  data.groups.forEach(g => {
    const firstRow = r;
    const subRows = g.blocks.length * 2;
    const totalRows = subRows * 3;
    ws.mergeCells(`A${firstRow}:A${firstRow + totalRows - 1}`);
    ws.getCell(`A${firstRow}`).value = g.no;
    ws.getCell(`A${firstRow}`).font = { size: 11, name: 'Calibri' };
    ws.getCell(`A${firstRow}`).alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getCell(`A${firstRow}`).border = GRID;
    ws.mergeCells(`B${firstRow}:D${firstRow + totalRows - 1}`);
    ws.getCell(`B${firstRow}`).value = g.label;
    ws.getCell(`B${firstRow}`).font = { size: 11, name: 'Calibri' };
    ws.getCell(`B${firstRow}`).alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
    // Baris pertama tiap kelompok 14.4 -- persis contoh.
    ws.getRow(firstRow).height = 14.4;

    g.blocks.forEach(block => {
      [['Renc', block.rencDates], ['Real', block.realDates]].forEach(([kind, dates]) => {
        ws.mergeCells(`E${r}:E${r + 2}`);
        ws.getCell(`E${r}`).value = kind;
        ws.getCell(`E${r}`).font = { size: 11, name: 'Calibri' };
        ws.getCell(`E${r}`).alignment = { horizontal: 'center', vertical: 'middle' };
        monthIdx.forEach((mi, i) => {
          const c = colLetter(6 + i);
          ws.mergeCells(`${c}${r}:${c}${r + 2}`);
          const cell = ws.getCell(`${c}${r}`);
          cell.value = dates[mi];
          cell.font = { size: 11, name: 'Calibri' };
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
        });
        r += 3;
      });
    });

    for (let rr = firstRow; rr <= r - 1; rr++) {
      for (let c = 1; c <= 11; c++) ws.getRow(rr).getCell(c).border = GRID;
    }
  });
  const lastDataRow = r - 1;

  // Tanda tangan (tanpa Keterangan): kiri (A-F) label & jabatan, kanan (I-K)
  // tanggal & jabatan; nama di bawah (kiri A-F merge 2 baris, kanan I-K).
  const signTop = lastDataRow + 2;
  ws.mergeCells(`A${signTop}:F${signTop}`);
  ws.getCell(`A${signTop}`).value = meta.labelLeft || KPI_18_6_LABEL_LEFT;
  ws.getCell(`A${signTop}`).font = { size: 11, name: 'Calibri' };
  ws.getCell(`A${signTop}`).alignment = { horizontal: 'center' };
  ws.mergeCells(`I${signTop}:K${signTop}`);
  ws.getCell(`I${signTop}`).value = meta.signPlaceDate || '';
  ws.getCell(`I${signTop}`).font = { size: 11, name: 'Calibri' };
  ws.getCell(`I${signTop}`).alignment = { horizontal: 'center' };

  const roleRow = signTop + 1;
  ws.mergeCells(`A${roleRow}:F${roleRow}`);
  ws.getCell(`A${roleRow}`).value = meta.roleLeft || '';
  ws.getCell(`A${roleRow}`).font = { size: 11, name: 'Calibri' };
  ws.getCell(`A${roleRow}`).alignment = { horizontal: 'center' };
  ws.mergeCells(`I${roleRow}:K${roleRow}`);
  ws.getCell(`I${roleRow}`).value = meta.roleRight || '';
  ws.getCell(`I${roleRow}`).font = { size: 11, name: 'Calibri' };
  ws.getCell(`I${roleRow}`).alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };

  const nameRow = roleRow + 4;
  ws.getRow(nameRow).height = 15.6; // persis contoh
  ws.mergeCells(`A${nameRow}:F${nameRow + 1}`);
  ws.getCell(`A${nameRow}`).value = meta.nameLeft || '';
  ws.getCell(`A${nameRow}`).font = { bold: true, size: 12, name: 'Calibri' };
  ws.getCell(`A${nameRow}`).alignment = { horizontal: 'center', vertical: 'top' };
  ws.mergeCells(`I${nameRow}:K${nameRow}`);
  ws.getCell(`I${nameRow}`).value = meta.nameRight || '';
  ws.getCell(`I${nameRow}`).font = { bold: true, size: 12, name: 'Calibri' };
  ws.getCell(`I${nameRow}`).alignment = { horizontal: 'center' };

  // nameRow terakhir dipakai = nameRow+1 (merge kiri 2 baris). Kembalikan
  // nameRow+4 supaya ada 3 baris kosong sebelum blok berikutnya -- blok 2
  // mulai di baris 42 persis file contoh.
  return nameRow + 4;
}

async function buildKpi18_6ExcelWorkbook(data) {
  const wb = new ExcelJS.Workbook();
  wb.calcProperties.fullCalcOnLoad = true;
  const ws = wb.addWorksheet('18.6 PM TERKENDALI', {
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 1, paperSize: 5, horizontalCentered: true, showGridLines: false }
  });
  ws.pageSetup.margins = { left: 0.25, right: 0.25, top: 0.75, bottom: 0.75, header: 0.3, footer: 0.3 };
  KPI_18_6_COL_WIDTHS.forEach((w, i) => { ws.getColumn(i + 1).width = w; });

  const meta = data.meta || {};
  const nextRow = buildKpi18_6Block(ws, 0, [0, 1, 2, 3, 4, 5], `BULAN : Januari - Juni ${data.tahun}`, data, meta, data.tahun);
  buildKpi18_6Block(ws, nextRow, [6, 7, 8, 9, 10, 11], `BULAN : Juli - Desember ${data.tahun}`, data, meta, data.tahun);

  return wb.xlsx.writeBuffer();
}

module.exports = {
  KPI_INSTALLATIONS, getKpiUkurDebitData, saveDebitAwal, saveMeta, buildKpiExcelWorkbook,
  getKpiApatdData, saveApatdMeta, buildKpiApatdExcelWorkbook,
  getKpiPengambilanData, savePengambilanTarget, savePengambilanMeta, buildKpiPengambilanExcelWorkbook,
  getKpiKualitasData, saveKualitasElevasi, saveKualitasMeta, buildKpiKualitasExcelWorkbook,
  getKpi192Data, saveKpi192Meta, buildKpi192ExcelWorkbook,
  getKpiLevelSumurData, saveLevelSumurMeta, buildKpiLevelSumurExcelWorkbook,
  getKpiLevelStatisDinamisData, saveLevelStatisDinamisMeta, buildKpiLevelStatisDinamisExcelWorkbook,
  getKpi18_5Data, saveKpi18_5Values, saveKpi18_5Meta, buildKpi18_5ExcelWorkbook,
  getKpi18_6Data, saveKpi18_6Meta, buildKpi18_6ExcelWorkbook
};
