/* ==========================================================================
   Library — Sumber Air Baku
   --------------------------------------------------------------------------
   Semua data TIDAK ditulis langsung di file ini. Data diambil (fetch) dari
   file-file CSV di folder /data. Untuk mengubah/menambah data historis,
   cukup edit file CSV yang bersangkutan (bisa dibuka & diedit di Excel),
   TIDAK perlu menyentuh file .js atau .html ini.

   Struktur menu sekarang 2 tingkat:
     Menu utama  -> Waduk Manggar / Waduk Teritip / Sumur Dalam
     Sub menu    -> dataset per menu utama (lihat GROUPS di bawah)

   Rentang data (untuk grafik/tabel/unduhan) dipilih lewat tombol
   Tahun -> Bulan (bukan lagi input tanggal bebas), supaya simple & efisien.
   ========================================================================== */

// ---------------------------------------------------------------------------
// KONFIGURASI MENU (menu utama -> sub menu)
// ---------------------------------------------------------------------------
const GROUPS = [
  { key: 'manggar', label: 'Waduk Manggar', tabs: ['manggar_level', 'manggar_ntu', 'manggar_ph', 'manggar_hujan'] },
  { key: 'teritip', label: 'Waduk Teritip', tabs: ['teritip_level', 'teritip_ntu', 'teritip_ph'] },
  { key: 'sumur', label: 'Sumur Dalam', subgroups: [
      { key: 'debit', label: 'Debit Sumur', tabs: [
          'sumur_debit_gunung_sari', 'sumur_debit_kampung_damai', 'sumur_debit_teritip',
          'sumur_debit_gunung_tembak', 'sumur_debit_prapatan', 'sumur_debit_zamp',
          'sumur_debit_kp_baru_ulu'
        ] },
      { key: 'level', label: 'Statis Dinamis Sumur', tabs: [
          'sumur_level_gunung_sari', 'sumur_level_kampung_damai', 'sumur_level_teritip',
          'sumur_level_gunung_tembak', 'sumur_level_prapatan', 'sumur_level_zamp',
          'sumur_level_kampung_baru_ulu'
        ] }
    ] }
];

function groupAllTabs(group) {
  return group.subgroups ? group.subgroups.flatMap(s => s.tabs) : group.tabs;
}

function activeSubgroup(group) {
  if (!group.subgroups) return null;
  return group.subgroups.find(s => s.key === currentCategory) || group.subgroups.find(s => s.tabs.some(k => datasets[k]));
}

function activeTabs() {
  const group = GROUPS.find(g => g.key === currentGroup);
  const sub = activeSubgroup(group);
  return sub ? sub.tabs : group.tabs;
}

// ---------------------------------------------------------------------------
// KONFIGURASI SUMBER DATA — dataset harian (level, NTU, PH, curah hujan)
// Nama file & nama kolom CSV TIDAK berubah dari versi sebelumnya, supaya
// file data yang sudah ada di server tidak perlu diganti.
// ---------------------------------------------------------------------------
const DATA_SOURCES = [
  {
    file: 'data/manggar_level_curahhujan.csv',
    dateColumn: 'Tanggal',
    columns: {
      Level_Waduk_Manggar_m: {
        key: 'manggar_level', label: 'Level Waduk Manggar', unit: 'm',
        type: 'daily', color: 'primary', hasGauge: true
      },
      Curah_Hujan_mm: {
        key: 'manggar_hujan', label: 'Curah Hujan Waduk Manggar', unit: 'mm',
        type: 'daily-bar', color: 'rain'
      }
    }
  },
  {
    file: 'data/kualitas_air_manggar_teritip.csv',
    dateColumn: 'Tanggal',
    columns: {
      NTU_Manggar: { key: 'manggar_ntu', label: 'Kekeruhan (NTU) Waduk Manggar', unit: 'NTU', type: 'daily', color: 'rain' },
      PH_Manggar: { key: 'manggar_ph', label: 'PH Air Baku Waduk Manggar', unit: 'pH', type: 'daily', color: 'primary' },
      NTU_Teritip: { key: 'teritip_ntu', label: 'Kekeruhan (NTU) Waduk Teritip', unit: 'NTU', type: 'daily', color: 'rain' },
      PH_Teritip: { key: 'teritip_ph', label: 'PH Air Baku Waduk Teritip', unit: 'pH', type: 'daily', color: 'primary' }
    }
  },
  {
    file: 'data/teritip_level.csv',
    dateColumn: 'Tanggal',
    columns: {
      Level_Waduk_Teritip_m: {
        key: 'teritip_level', label: 'Level Waduk Teritip', unit: 'm',
        type: 'daily', color: 'primary', hasGauge: true
      }
    }
  }
];

// -- Sumur Dalam: dua dataset bulanan, per-sumur (kolom dinamis) --
// FILE INI MASIH DATA CONTOH/DUMMY — ganti isinya dengan data asli kapan
// saja. Struktur kolom (Bulan, Sumur_01, Sumur_02, ... / atau
// Sumur_01_Statis, Sumur_01_Dinamis, ...) tetap harus dipertahankan.
const SUMUR_SOURCES = [
  {
    file: 'data/sumur_debit_gunung_sari.csv',
    monthColumn: 'Bulan',
    key: 'sumur_debit_gunung_sari',
    label: 'Debit Sumur — IPA Gunung Sari',
    unit: 'm³/jam',
    mode: 'single',
    isDummy: false
  },
  {
    file: 'data/sumur_debit_kampung_damai.csv',
    monthColumn: 'Bulan',
    key: 'sumur_debit_kampung_damai',
    label: 'Debit Sumur — IPA Kampung Damai',
    unit: 'm³/jam',
    mode: 'single',
    isDummy: false
  },
  {
    file: 'data/sumur_debit_teritip.csv',
    monthColumn: 'Bulan',
    key: 'sumur_debit_teritip',
    label: 'Debit Sumur — IPA Teritip',
    unit: 'm³/jam',
    mode: 'single',
    isDummy: false
  },
  {
    file: 'data/sumur_debit_gunung_tembak.csv',
    monthColumn: 'Bulan',
    key: 'sumur_debit_gunung_tembak',
    label: 'Debit Sumur — IPA Gunung Tembak',
    unit: 'm³/jam',
    mode: 'single',
    isDummy: false
  },
  {
    file: 'data/sumur_debit_prapatan.csv',
    monthColumn: 'Bulan',
    key: 'sumur_debit_prapatan',
    label: 'Debit Sumur — IPA Prapatan',
    unit: 'm³/jam',
    mode: 'single',
    isDummy: false
  },
  {
    file: 'data/sumur_debit_zamp.csv',
    monthColumn: 'Bulan',
    key: 'sumur_debit_zamp',
    label: 'Debit Sumur — IPA Zamp',
    unit: 'm³/jam',
    mode: 'single',
    isDummy: false
  },
  {
    file: 'data/sumur_debit_kp_baru_ulu.csv',
    monthColumn: 'Bulan',
    key: 'sumur_debit_kp_baru_ulu',
    label: 'Debit Sumur — IPA Kampung Baru Ulu',
    unit: 'm³/jam',
    mode: 'single',
    isDummy: false
  },
  {
    file: 'data/sumur_level_gunung_sari.csv',
    monthColumn: 'Bulan',
    key: 'sumur_level_gunung_sari',
    label: 'Level Statis & Dinamis — IPA Gunung Sari',
    unit: 'm',
    mode: 'pair',
    isDummy: false
  },
  {
    file: 'data/sumur_level_kampung_damai.csv',
    monthColumn: 'Bulan',
    key: 'sumur_level_kampung_damai',
    label: 'Level Statis & Dinamis — IPA Kampung Damai',
    unit: 'm',
    mode: 'pair',
    isDummy: false
  },
  {
    file: 'data/sumur_level_teritip.csv',
    monthColumn: 'Bulan',
    key: 'sumur_level_teritip',
    label: 'Level Statis & Dinamis — IPA Teritip',
    unit: 'm',
    mode: 'pair',
    isDummy: false
  },
  {
    file: 'data/sumur_level_gunung_tembak.csv',
    monthColumn: 'Bulan',
    key: 'sumur_level_gunung_tembak',
    label: 'Level Statis & Dinamis — IPA Gunung Tembak',
    unit: 'm',
    mode: 'pair',
    isDummy: false
  },
  {
    file: 'data/sumur_level_prapatan.csv',
    monthColumn: 'Bulan',
    key: 'sumur_level_prapatan',
    label: 'Level Statis & Dinamis — IPA Prapatan',
    unit: 'm',
    mode: 'pair',
    isDummy: false
  },
  {
    file: 'data/sumur_level_zamp.csv',
    monthColumn: 'Bulan',
    key: 'sumur_level_zamp',
    label: 'Level Statis & Dinamis — IPA Zamp',
    unit: 'm',
    mode: 'pair',
    isDummy: false
  },
  {
    file: 'data/sumur_level_kampung_baru_ulu.csv',
    monthColumn: 'Bulan',
    key: 'sumur_level_kampung_baru_ulu',
    label: 'Level Statis & Dinamis — IPA Kampung Baru Ulu',
    unit: 'm',
    mode: 'pair',
    isDummy: false
  }
];

const MONTHS_ID = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

// ---------------------------------------------------------------------------
// CSV PARSER (sederhana, cukup untuk data numerik + tanggal seperti ini)
// ---------------------------------------------------------------------------
function parseCSV(text) {
  const lines = text.replace(/\r/g, '').split('\n').filter(l => l.length > 0);
  const header = lines[0].split(',').map(h => h.trim());
  const rows = lines.slice(1).map(line => {
    const cells = line.split(',');
    const row = {};
    header.forEach((h, i) => { row[h] = (cells[i] !== undefined ? cells[i].trim() : ''); });
    return row;
  });
  return { header, rows };
}

function toNum(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

function minMax(arr) {
  const vals = arr.map(r => r.value).filter(v => v !== null && v !== undefined);
  return [Math.min(...vals), Math.max(...vals)];
}

// Format tampilan untuk grafik & tabel: DD/MM/YYYY
function dateStrDisplay(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${day}/${m}/${y}`;
}

function monthLabel(d) {
  return d.toLocaleDateString('id-ID', { month: 'short', year: 'numeric' });
}

function monthLabelLong(d) {
  return d.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
}

// ---------------------------------------------------------------------------
// LOAD DATA
// ---------------------------------------------------------------------------
async function fetchCSV(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Gagal memuat ${path} (HTTP ${res.status})`);
  return parseCSV(await res.text());
}

function buildSumurDataset(source, header, rows) {
  if (source.mode === 'single') {
    const wellColumns = header.filter(h => h !== source.monthColumn);
    const data = rows.map(r => {
      const row = { date: new Date(r[source.monthColumn] + '-01T00:00:00') };
      wellColumns.forEach(w => { row[w] = toNum(r[w]); });
      return row;
    }).filter(r => !isNaN(r.date.getTime()));
    return {
      label: source.label, unit: source.unit, type: 'monthly-multi', mode: 'single',
      color: 'primary', real: !source.isDummy, sourceFile: source.file,
      data, wellColumns
    };
  }

  // mode === 'pair' -> kolom bernama <Sumur>_Statis / <Sumur>_Dinamis
  const wellSet = [];
  header.forEach(h => {
    if (h === source.monthColumn) return;
    const m = h.match(/^(.*)_(Statis|Dinamis)$/i);
    if (m && !wellSet.includes(m[1])) wellSet.push(m[1]);
  });
  const data = rows.map(r => {
    const row = { date: new Date(r[source.monthColumn] + '-01T00:00:00') };
    wellSet.forEach(w => {
      row[w + '_Statis'] = toNum(r[w + '_Statis']);
      row[w + '_Dinamis'] = toNum(r[w + '_Dinamis']);
    });
    return row;
  }).filter(r => !isNaN(r.date.getTime()));
  return {
    label: source.label, unit: source.unit, type: 'monthly-multi', mode: 'pair',
    color: 'primary', real: !source.isDummy, sourceFile: source.file,
    data, wellColumns: wellSet
  };
}

async function loadAllData() {
  const datasets = {};
  const loadErrors = [];

  // -- dataset harian (level, ntu, ph, hujan) --
  for (const source of DATA_SOURCES) {
    let header, rows;
    try {
      ({ header, rows } = await fetchCSV(source.file));
    } catch (err) {
      console.error(`Gagal memuat ${source.file}:`, err);
      loadErrors.push(source.file);
      continue;
    }
    for (const colName of Object.keys(source.columns)) {
      if (!header.includes(colName)) {
        console.warn(`Kolom "${colName}" tidak ditemukan di ${source.file}, dilewati.`);
        continue;
      }
      const cfg = source.columns[colName];
      const series = rows
        .map(r => ({ date: new Date(r[source.dateColumn] + 'T00:00:00'), value: toNum(r[colName]) }))
        .filter(r => !isNaN(r.date.getTime()));
      const ds = {
        label: cfg.label, unit: cfg.unit, type: cfg.type, color: cfg.color, mode: 'single',
        real: true, sourceFile: source.file, data: series
      };
      if (cfg.hasGauge) {
        const [mn, mx] = minMax(series);
        ds.minHist = Math.floor(mn - 0.5);
        ds.maxHist = Math.ceil(mx + 0.5);
      }
      datasets[cfg.key] = ds;
    }
  }

  // -- dataset sumur (bulanan, per-sumur) --
  for (const source of SUMUR_SOURCES) {
    let header, rows;
    try {
      ({ header, rows } = await fetchCSV(source.file));
    } catch (err) {
      console.error(`Gagal memuat ${source.file}:`, err);
      loadErrors.push(source.file);
      continue;
    }
    datasets[source.key] = buildSumurDataset(source, header, rows);
  }

  datasets.__loadErrors = loadErrors;
  return datasets;
}

// ---------------------------------------------------------------------------
// APP STATE
// ---------------------------------------------------------------------------
let datasets = {};
let currentGroup = 'manggar';
let currentCategory = null; // hanya dipakai untuk grup yang punya subgroups (mis. 'sumur')
let currentKey = 'manggar_level';
let filterMode = 'all';   // 'all' | 'year' | 'month'
let selectedYear = null;
let selectedMonth = null;
let chart;

const menuMainEl = document.getElementById('menuMain');
const menuCategoryEl = document.getElementById('menuCategory');
const menuSubEl = document.getElementById('menuSub');
const yearRowEl = document.getElementById('yearRow');
const monthRowEl = document.getElementById('monthRow');
const rangeLabelEl = document.getElementById('rangeLabel');

function currentDataset() { return datasets[currentKey]; }

// ---------------------------------------------------------------------------
// MENU (utama -> kategori [opsional] -> sub)
// ---------------------------------------------------------------------------
function buildMenuMain() {
  menuMainEl.innerHTML = '';
  GROUPS.filter(g => groupAllTabs(g).some(k => datasets[k])).forEach(g => {
    const btn = document.createElement('div');
    btn.className = 'menu-btn' + (g.key === currentGroup ? ' active' : '');
    btn.textContent = g.label;
    btn.dataset.key = g.key;
    btn.onclick = () => {
      currentGroup = g.key;
      const group = GROUPS.find(x => x.key === g.key);
      if (group.subgroups) {
        const sub = group.subgroups.find(s => s.tabs.some(k => datasets[k]));
        currentCategory = sub ? sub.key : null;
        currentKey = sub.tabs.find(k => datasets[k]) || currentKey;
      } else {
        currentCategory = null;
        currentKey = group.tabs.find(k => datasets[k]) || currentKey;
      }
      resetFilter();
      buildMenuMain();
      buildMenuCategory();
      buildMenuSub();
      onDatasetChanged();
      render();
    };
    menuMainEl.appendChild(btn);
  });
}

function buildMenuCategory() {
  menuCategoryEl.innerHTML = '';
  const group = GROUPS.find(g => g.key === currentGroup);
  if (!group.subgroups) { menuCategoryEl.style.display = 'none'; return; }
  menuCategoryEl.style.display = 'flex';
  group.subgroups.filter(s => s.tabs.some(k => datasets[k])).forEach(sub => {
    const btn = document.createElement('div');
    btn.className = 'category-pill' + (sub.key === currentCategory ? ' active' : '');
    btn.textContent = sub.label;
    btn.dataset.key = sub.key;
    btn.onclick = () => {
      currentCategory = sub.key;
      currentKey = sub.tabs.find(k => datasets[k]) || currentKey;
      resetFilter();
      buildMenuCategory();
      buildMenuSub();
      onDatasetChanged();
      render();
    };
    menuCategoryEl.appendChild(btn);
  });
}

function buildMenuSub() {
  menuSubEl.innerHTML = '';
  activeTabs().filter(k => datasets[k]).forEach(key => {
    const btn = document.createElement('div');
    btn.className = 'submenu-pill' + (key === currentKey ? ' active' : '');
    btn.textContent = datasets[key].label;
    btn.dataset.key = key;
    btn.onclick = () => {
      currentKey = key;
      resetFilter();
      buildMenuSub();
      onDatasetChanged();
      render();
    };
    menuSubEl.appendChild(btn);
  });
}

function onDatasetChanged() {
  const ds = currentDataset();
  const isSumurGroup = currentGroup === 'sumur';

  document.getElementById('mainGrid').style.display = isSumurGroup ? 'none' : 'grid';
  document.getElementById('statsRow').style.display = isSumurGroup ? 'none' : 'flex';
  document.getElementById('tableWrap').style.display = isSumurGroup ? 'none' : 'block';
  document.getElementById('tilesWrap').style.display = isSumurGroup ? 'block' : 'none';

  const badge = document.getElementById('statusBadge');
  const note = document.getElementById('noteBox');
  if (ds.real) {
    badge.textContent = 'Data Asli';
    badge.style.background = 'var(--good)';
    note.innerHTML = `Data diambil dari <code>${ds.sourceFile}</code>. Baris yang kosong di sumber (misal parameter tidak diperiksa hari itu) ditampilkan sebagai baris kosong, bukan diisi paksa. Untuk menambah/mengoreksi data, edit file CSV tersebut lalu muat ulang halaman ini.`;
  } else {
    badge.textContent = 'Data Contoh / Demo';
    badge.style.background = 'var(--warn)';
    note.innerHTML = `Dataset ini masih pakai <b>data acak/simulasi</b> (<code>${ds.sourceFile}</code>) untuk keperluan demo tampilan. Ganti isi file CSV tersebut dengan data asli kapan saja — struktur kolomnya sudah siap dipakai.`;
  }

  buildYearRow();
}

// ---------------------------------------------------------------------------
// FILTER TAHUN / BULAN
// ---------------------------------------------------------------------------
function resetFilter() {
  filterMode = 'all';
  selectedYear = null;
  selectedMonth = null;
}

function yearsInData(data) {
  return [...new Set(data.map(r => r.date.getFullYear()))].sort((a, b) => a - b);
}

function monthsInYear(data, year) {
  return [...new Set(data.filter(r => r.date.getFullYear() === year).map(r => r.date.getMonth() + 1))].sort((a, b) => a - b);
}

function buildYearRow() {
  const ds = currentDataset();
  const years = yearsInData(ds.data);
  yearRowEl.innerHTML = '';

  const allChip = document.createElement('div');
  allChip.className = 'chip' + (filterMode === 'all' ? ' active' : '');
  allChip.textContent = 'Semua Data';
  allChip.onclick = () => {
    filterMode = 'all'; selectedYear = null; selectedMonth = null;
    buildYearRow(); render();
  };
  yearRowEl.appendChild(allChip);

  years.forEach(y => {
    const chip = document.createElement('div');
    chip.className = 'chip' + ((filterMode !== 'all' && selectedYear === y) ? ' active' : '');
    chip.textContent = y;
    chip.onclick = () => {
      filterMode = 'year'; selectedYear = y; selectedMonth = null;
      buildYearRow(); render();
    };
    yearRowEl.appendChild(chip);
  });

  buildMonthRow();
}

function buildMonthRow() {
  const ds = currentDataset();
  monthRowEl.innerHTML = '';

  if (filterMode === 'all' || !selectedYear) {
    monthRowEl.style.display = 'none';
    return;
  }

  const months = monthsInYear(ds.data, selectedYear);
  if (months.length === 0) {
    monthRowEl.style.display = 'none';
    return;
  }
  monthRowEl.style.display = 'flex';

  const allChip = document.createElement('div');
  allChip.className = 'chip chip-sm' + (filterMode === 'year' ? ' active' : '');
  allChip.textContent = 'Semua Bulan';
  allChip.onclick = () => {
    filterMode = 'year'; selectedMonth = null;
    buildMonthRow(); render();
  };
  monthRowEl.appendChild(allChip);

  months.forEach(m => {
    const chip = document.createElement('div');
    chip.className = 'chip chip-sm' + ((filterMode === 'month' && selectedMonth === m) ? ' active' : '');
    chip.textContent = MONTHS_ID[m - 1];
    chip.onclick = () => {
      filterMode = 'month'; selectedMonth = m;
      buildMonthRow(); render();
    };
    monthRowEl.appendChild(chip);
  });
}

function filteredData() {
  const ds = currentDataset();
  if (filterMode === 'all') return ds.data;
  if (filterMode === 'month') {
    return ds.data.filter(r => r.date.getFullYear() === selectedYear && r.date.getMonth() + 1 === selectedMonth);
  }
  return ds.data.filter(r => r.date.getFullYear() === selectedYear);
}

function currentRangeLabel() {
  if (filterMode === 'all') return 'Semua Data';
  if (filterMode === 'month') return `${MONTHS_ID[selectedMonth - 1]} ${selectedYear}`;
  return `Tahun ${selectedYear}`;
}

// ---------------------------------------------------------------------------
// RENDER
// ---------------------------------------------------------------------------
function statCardsHtml(label, values, unit) {
  const valid = values.filter(v => v !== null && v !== undefined);
  const min = valid.length ? Math.min(...valid) : NaN;
  const max = valid.length ? Math.max(...valid) : NaN;
  const avg = valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : NaN;
  const last = valid[valid.length - 1];
  const p = label ? label + ' — ' : '';
  return `
    <div class="stat"><div class="k">${p}Minimum</div><div class="v">${valid.length ? min.toFixed(2) : '-'} ${unit}</div></div>
    <div class="stat"><div class="k">${p}Maksimum</div><div class="v">${valid.length ? max.toFixed(2) : '-'} ${unit}</div></div>
    <div class="stat"><div class="k">${p}Rata-rata</div><div class="v">${valid.length ? avg.toFixed(2) : '-'} ${unit}</div></div>
    <div class="stat"><div class="k">${p}Terakhir</div><div class="v">${last !== undefined && last !== null ? last.toFixed(2) : '-'} ${unit}</div></div>
  `;
}

function sparklinePoints(vals) {
  const idxVals = vals.map((v, i) => ({ v, i })).filter(p => p.v !== null && p.v !== undefined);
  if (idxVals.length < 2) return '';
  const ys = idxVals.map(p => p.v);
  const min = Math.min(...ys), max = Math.max(...ys);
  const span = (max - min) || 1;
  const w = 100, h = 28;
  const lastIdx = vals.length - 1 || 1;
  return idxVals.map(p => {
    const x = (p.i / lastIdx) * w;
    const y = h - ((p.v - min) / span) * h;
    return x.toFixed(1) + ',' + y.toFixed(1);
  }).join(' ');
}

function lastValidPoint(vals) {
  for (let i = vals.length - 1; i >= 0; i--) {
    if (vals[i] !== null && vals[i] !== undefined) return { val: vals[i], idx: i };
  }
  return null;
}

function buildTiles() {
  const grid = document.getElementById('tilesGrid');
  const ds = currentDataset();
  const rows = filteredData();
  const isPair = ds.mode === 'pair';
  grid.innerHTML = '';

  ds.wellColumns.forEach(w => {
    const mainVals = isPair ? rows.map(r => r[w + '_Statis']) : rows.map(r => r[w]);
    const secVals = isPair ? rows.map(r => r[w + '_Dinamis']) : null;
    const lastMain = lastValidPoint(mainVals);
    const prevMain = lastMain ? lastValidPoint(mainVals.slice(0, lastMain.idx)) : null;
    const delta = (lastMain && prevMain) ? (lastMain.val - prevMain.val) : null;
    const lastSec = secVals ? lastValidPoint(secVals) : null;
    const pts = sparklinePoints(mainVals);

    let deltaTxt;
    if (delta === null) deltaTxt = 'data belum cukup';
    else if (Math.abs(delta) < 0.005) deltaTxt = 'stabil dari periode lalu';
    else deltaTxt = (delta > 0 ? '▲ ' : '▼ ') + Math.abs(delta).toFixed(2) + ' ' + ds.unit + ' dari periode lalu';

    const metricsHtml = isPair
      ? `<div class="tile-metrics">
           <div class="tile-metric"><span class="tile-metric-label">Statis</span><span class="tile-metric-value">${lastMain ? lastMain.val.toFixed(2) : '-'} ${ds.unit}</span></div>
           <div class="tile-metric"><span class="tile-metric-label">Dinamis</span><span class="tile-metric-value">${lastSec ? lastSec.val.toFixed(2) : '-'} ${ds.unit}</span></div>
         </div>`
      : `<div class="tile-metrics">
           <div class="tile-metric"><span class="tile-metric-label">${ds.label}</span><span class="tile-metric-value">${lastMain ? lastMain.val.toFixed(2) : '-'} ${ds.unit}</span></div>
         </div>`;

    const card = document.createElement('div');
    card.className = 'tile';
    card.innerHTML = `
      <div class="tile-name">${w.replace(/_/g, ' ')}</div>
      ${metricsHtml}
      <div class="tile-delta">${deltaTxt}</div>
      <svg viewBox="0 0 100 28" width="100%" height="28">${pts ? `<polyline points="${pts}" fill="none" stroke="var(--primary)" stroke-width="2"/>` : ''}</svg>
    `;
    grid.appendChild(card);
  });
}

function render() {
  const ds = currentDataset();
  const rows = filteredData();
  const isSumurGroup = currentGroup === 'sumur';

  rangeLabelEl.textContent = currentRangeLabel();

  if (isSumurGroup) {
    buildTiles();
    return;
  }

  const labels = rows.map(r => dateStrDisplay(r.date));

  const ctx = document.getElementById('mainChart').getContext('2d');
  if (chart) chart.destroy();
  const isBar = ds.type === 'daily-bar';
  const accent = ds.color === 'rain' ? '#D98F3E' : '#0B5566';

  const vals = rows.map(r => r.value);
  const chartDatasets = [{ label: ds.label, data: vals, borderColor: accent, backgroundColor: isBar ? accent + '99' : accent + '22', fill: !isBar, tension: 0.25, pointRadius: 0, borderWidth: 2 }];

  chart = new Chart(ctx, {
    type: isBar ? 'bar' : 'line',
    data: { labels, datasets: chartDatasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { maxTicksLimit: 10, font: { family: 'IBM Plex Mono', size: 10 } }, grid: { display: false } },
        y: { ticks: { font: { family: 'IBM Plex Mono', size: 11 } }, grid: { color: '#E3EEF0' } }
      }
    }
  });

  // Stats
  let statsHtml = `<div class="stat"><div class="k">Titik data</div><div class="v">${rows.length}</div></div>`;
  statsHtml += statCardsHtml('', vals, ds.unit);
  const valid = vals.filter(v => v !== null && v !== undefined);
  const lastForGauge = valid[valid.length - 1];
  document.getElementById('statsRow').innerHTML = statsHtml;

  // Gauge (hanya untuk dataset dengan minHist/maxHist, mis. level waduk)
  const gaugeWrap = document.querySelector('.gauge-wrap');
  if (ds.minHist !== undefined && lastForGauge !== undefined && lastForGauge !== null) {
    gaugeWrap.style.display = 'flex';
    const pct = Math.min(1, Math.max(0, (lastForGauge - ds.minHist) / (ds.maxHist - ds.minHist)));
    document.getElementById('gaugeFill').style.height = (pct * 100) + '%';
    document.getElementById('gaugeValue').textContent = lastForGauge.toFixed(1) + ' ' + ds.unit;
  } else {
    gaugeWrap.style.display = 'none';
  }

  // Table
  const head = document.getElementById('tableHead');
  const body = document.getElementById('tableBody');
  head.innerHTML = `<th>Tanggal</th><th>${ds.label} (${ds.unit})</th>`;
  body.innerHTML = rows.slice(-60).reverse().map(r => {
    const v = r.value;
    return `<tr><td>${dateStrDisplay(r.date)}</td><td>${v !== null && v !== undefined ? v.toFixed(2) : '-'}</td></tr>`;
  }).join('');
}

// ---------------------------------------------------------------------------
// UNDUH EXCEL (.xlsx via SheetJS)
//  - Waduk Manggar / Waduk Teritip : Tanggal, [Nama Parameter (satuan)]
//  - Sumur Dalam                   : Bulan, Nama Sumur, [nilai...]  (semua sumur)
// ---------------------------------------------------------------------------
function buildExportSheet() {
  const ds = currentDataset();
  const rows = filteredData();
  let header, body;

  if (currentGroup === 'sumur') {
    if (ds.mode === 'pair') {
      header = ['Bulan', 'Nama Sumur', `Statis (${ds.unit})`, `Dinamis (${ds.unit})`];
      body = [];
      rows.forEach(r => {
        ds.wellColumns.forEach(w => {
          body.push([monthLabelLong(r.date), w.replace(/_/g, ' '), r[w + '_Statis'] ?? '', r[w + '_Dinamis'] ?? '']);
        });
      });
    } else {
      header = ['Bulan', 'Nama Sumur', `${ds.label} (${ds.unit})`];
      body = [];
      rows.forEach(r => {
        ds.wellColumns.forEach(w => {
          body.push([monthLabelLong(r.date), w.replace(/_/g, ' '), r[w] ?? '']);
        });
      });
    }
  } else {
    header = ['Tanggal', `${ds.label} (${ds.unit})`];
    body = rows.map(r => [dateStrDisplay(r.date), r.value ?? '']);
  }

  return { header, body };
}

function downloadExcel() {
  const { header, body } = buildExportSheet();
  const ws = XLSX.utils.aoa_to_sheet([header, ...body]);
  ws['!cols'] = header.map((h, i) => ({ wch: Math.max(14, h.length + 2, i === 0 ? 16 : 10) }));
  const wb = XLSX.utils.book_new();
  const ds = currentDataset();
  const sheetName = ds.label.substring(0, 31);
  XLSX.utils.book_append_sheet(wb, ws, sheetName);

  const rangePart = filterMode === 'all' ? 'semua-data' : (filterMode === 'month' ? `${selectedYear}-${String(selectedMonth).padStart(2,'0')}` : `${selectedYear}`);
  const fname = `${currentKey}_${rangePart}.xlsx`;
  XLSX.writeFile(wb, fname);
}

// ---------------------------------------------------------------------------
// INIT
// ---------------------------------------------------------------------------
function wireControls() {
  document.getElementById('downloadBtn').onclick = downloadExcel;
}

async function init() {
  try {
    datasets = await loadAllData();
  } catch (err) {
    console.error(err);
    document.querySelector('.panel').innerHTML =
      `<div class="error-note">Gagal memuat data: ${err.message}<br>Pastikan file HTML ini diakses lewat web server (bukan dibuka langsung dari file), dan folder <code>data/</code> ada di lokasi yang sama.</div>`;
    return;
  }

  const loadErrors = datasets.__loadErrors || [];
  delete datasets.__loadErrors;

  const validGroup = GROUPS.find(g => groupAllTabs(g).some(k => datasets[k]));
  if (!validGroup) {
    document.querySelector('.panel').innerHTML =
      `<div class="error-note">Tidak ada file data yang berhasil dimuat.<br>File yang gagal: ${loadErrors.map(f => `<code>${f}</code>`).join(', ') || '(tidak diketahui)'}<br>Pastikan folder <code>data/</code> berisi semua file CSV yang diperlukan, lalu muat ulang halaman ini.</div>`;
    return;
  }

  currentGroup = validGroup.key;
  const startGroup = GROUPS.find(g => g.key === currentGroup);
  if (startGroup.subgroups) {
    const sub = startGroup.subgroups.find(s => s.tabs.some(k => datasets[k]));
    currentCategory = sub.key;
    currentKey = sub.tabs.find(k => datasets[k]);
  } else {
    currentKey = startGroup.tabs.find(k => datasets[k]);
  }

  buildMenuMain();
  buildMenuCategory();
  buildMenuSub();
  onDatasetChanged();
  wireControls();
  render();

  if (loadErrors.length > 0) {
    const warn = document.createElement('div');
    warn.className = 'error-note';
    warn.style.cssText = 'padding:12px 16px;margin-top:16px;text-align:left;';
    warn.innerHTML = `Sebagian file data gagal dimuat dan dilewati: ${loadErrors.map(f => `<code>${f}</code>`).join(', ')}. Dataset lain tetap tampil normal.`;
    document.querySelector('.panel').appendChild(warn);
  }
}

init();
