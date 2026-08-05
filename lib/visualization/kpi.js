// Logika KPI 18.2 Ukur Debit (apps/kpi-sab/ukur-debit.html). Sengaja bukan
// berkas api/ tersendiri -- proyek ini di paket Hobby Vercel, dibatasi 12
// Serverless Function per deployment, dan sudah pas 12 sebelum fitur ini ada.
// GET-nya digabung ke api/visualization/data.js (dataType 'kpi_ukur_debit'),
// POST-nya digabung ke api/visualization/admin-input.js (body.kind
// 'debit_awal' / 'meta') supaya jumlah berkas di api/ tidak nambah.
const ExcelJS = require('exceljs');
const { pool } = require('../db');
const { fetchSumurWells, fetchSumurDebitRows, fetchRealRows } = require('./repo');
const { buildDummySumurDebitRows, buildDummyRows } = require('./dummy');
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
const PENGAMBILAN_COL_WIDTHS = [4.33, 22]
  .concat(Array(6).fill([12, 12, 11, 9.5]).flat());

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

module.exports = {
  KPI_INSTALLATIONS, getKpiUkurDebitData, saveDebitAwal, saveMeta, buildKpiExcelWorkbook,
  getKpiApatdData, saveApatdMeta, buildKpiApatdExcelWorkbook,
  getKpiPengambilanData, savePengambilanTarget, savePengambilanMeta, buildKpiPengambilanExcelWorkbook
};
