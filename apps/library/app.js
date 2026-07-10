/* ==========================================================================
   Library — Sumber Air Baku
   --------------------------------------------------------------------------
   Data grafik sekarang GABUNGAN dari 2 sumber:
     1. File CSV lokal di apps/library/data/ -> data historis 2014 s/d
        terakhir kali file ini diperbarui (tidak berubah lagi, jadi aman
        untuk arsip lama).
     2. Google Sheets lewat Apps Script Web App (SHEETS_BASE) -> data baru
        yang diinput lewat apps/input-data-historis.html mulai sekarang.

   Kedua sumber digabung per tanggal/bulan (lihat fetchMergedCSV & mergeRows
   di bawah). Kalau ada tanggal yang sama di kedua sumber, nilai dari Google
   Sheets yang dipakai (dianggap paling baru/terkoreksi); tanggal yang cuma
   ada di salah satu sumber tetap ikut tampil. Jadi grafik akan tetap utuh
   dari 2014 sampai terus berjalan, walau salah satu sumber gagal dimuat
   (mis. Google Sheets belum diisi untuk tab tertentu -> tetap tampil data
   lokal; internet/Apps Script down -> tetap tampil data lokal, tidak blank).

   Ganti SHEETS_BASE di bawah dengan URL Web App hasil deploy dari
   google-sheets-backend.gs (Deploy -> New deployment -> Web app -> Anyone).
   Nama tab di parameter ?sheet=... harus sama persis dengan nama tab di
   spreadsheet (lihat daftar tab di google-sheets-backend.gs). Nama file CSV
   lokal (localFile) juga harus sama isinya (nama kolom) dengan tab terkait.

   Struktur menu sekarang 2 tingkat:
     Menu utama  -> Waduk Manggar / Waduk Teritip / Sumur Dalam
     Sub menu    -> dataset per menu utama (lihat GROUPS di bawah)

   Rentang data (untuk grafik/tabel/unduhan) dipilih lewat tombol
   Tahun -> Bulan (bukan lagi input tanggal bebas), supaya simple & efisien.
   ========================================================================== */

// Ganti dengan URL Web App Google Apps Script hasil deploy (lihat
// google-sheets-backend.gs). Formatnya diakhiri "/exec", tanpa parameter.
const SHEETS_BASE = 'https://script.google.com/macros/s/AKfycbz7R-A6amPcX5Wac-a1VMzrsWlLyJNt5D_3qGCPazngPv8iOq80zdMsCbBUz6-dEC4r/exec';


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

function activeSubgroup(group) {
  if (!group.subgroups) return null;
  return group.subgroups.find(s => s.key === currentCategory) || group.subgroups[0];
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
// LOCAL_DATA_BASE = folder berisi CSV historis lama (arsip 2014 dst).
const LOCAL_DATA_BASE = 'data/';

const DATA_SOURCES = [
  {
    file: SHEETS_BASE + '?sheet=manggar_level_curahhujan',
    localFile: LOCAL_DATA_BASE + 'manggar_level_curahhujan.csv',
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
    file: SHEETS_BASE + '?sheet=kualitas_air_manggar_teritip',
    localFile: LOCAL_DATA_BASE + 'kualitas_air_manggar_teritip.csv',
    dateColumn: 'Tanggal',
    columns: {
      NTU_Manggar: { key: 'manggar_ntu', label: 'Kekeruhan (NTU) Waduk Manggar', unit: 'NTU', type: 'daily', color: 'rain' },
      PH_Manggar: { key: 'manggar_ph', label: 'PH Air Baku Waduk Manggar', unit: 'pH', type: 'daily', color: 'primary' },
      NTU_Teritip: { key: 'teritip_ntu', label: 'Kekeruhan (NTU) Waduk Teritip', unit: 'NTU', type: 'daily', color: 'rain' },
      PH_Teritip: { key: 'teritip_ph', label: 'PH Air Baku Waduk Teritip', unit: 'pH', type: 'daily', color: 'primary' }
    }
  },
  {
    file: SHEETS_BASE + '?sheet=teritip_level',
    localFile: LOCAL_DATA_BASE + 'teritip_level.csv',
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
// Struktur kolom (Bulan, Sumur_01, Sumur_02, ... / atau
// Sumur_01_Statis, Sumur_01_Dinamis, ...) tetap harus dipertahankan di
// masing-masing tab Google Sheets.
const SUMUR_SOURCES = [
  {
    file: SHEETS_BASE + '?sheet=sumur_debit_gunung_sari',
    monthColumn: 'Bulan',
    key: 'sumur_debit_gunung_sari',
    label: 'Debit Sumur — IPA Gunung Sari',
    unit: 'm³/jam',
    mode: 'single',
    isDummy: false
  },
  {
    file: SHEETS_BASE + '?sheet=sumur_debit_kampung_damai',
    monthColumn: 'Bulan',
    key: 'sumur_debit_kampung_damai',
    label: 'Debit Sumur — IPA Kampung Damai',
    unit: 'm³/jam',
    mode: 'single',
    isDummy: false
  },
  {
    file: SHEETS_BASE + '?sheet=sumur_debit_teritip',
    monthColumn: 'Bulan',
    key: 'sumur_debit_teritip',
    label: 'Debit Sumur — IPA Teritip',
    unit: 'm³/jam',
    mode: 'single',
    isDummy: false
  },
  {
    file: SHEETS_BASE + '?sheet=sumur_debit_gunung_tembak',
    monthColumn: 'Bulan',
    key: 'sumur_debit_gunung_tembak',
    label: 'Debit Sumur — IPA Gunung Tembak',
    unit: 'm³/jam',
    mode: 'single',
    isDummy: false
  },
  {
    file: SHEETS_BASE + '?sheet=sumur_debit_prapatan',
    monthColumn: 'Bulan',
    key: 'sumur_debit_prapatan',
    label: 'Debit Sumur — IPA Prapatan',
    unit: 'm³/jam',
    mode: 'single',
    isDummy: false
  },
  {
    file: SHEETS_BASE + '?sheet=sumur_debit_zamp',
    monthColumn: 'Bulan',
    key: 'sumur_debit_zamp',
    label: 'Debit Sumur — IPA Zamp',
    unit: 'm³/jam',
    mode: 'single',
    isDummy: false
  },
  {
    file: SHEETS_BASE + '?sheet=sumur_debit_kp_baru_ulu',
    monthColumn: 'Bulan',
    key: 'sumur_debit_kp_baru_ulu',
    label: 'Debit Sumur — IPA Kampung Baru Ulu',
    unit: 'm³/jam',
    mode: 'single',
    isDummy: false
  },
  {
    file: SHEETS_BASE + '?sheet=sumur_level_gunung_sari',
    monthColumn: 'Bulan',
    key: 'sumur_level_gunung_sari',
    label: 'Level Statis & Dinamis — IPA Gunung Sari',
    unit: 'm',
    mode: 'pair',
    isDummy: false
  },
  {
    file: SHEETS_BASE + '?sheet=sumur_level_kampung_damai',
    monthColumn: 'Bulan',
    key: 'sumur_level_kampung_damai',
    label: 'Level Statis & Dinamis — IPA Kampung Damai',
    unit: 'm',
    mode: 'pair',
    isDummy: false
  },
  {
    file: SHEETS_BASE + '?sheet=sumur_level_teritip',
    monthColumn: 'Bulan',
    key: 'sumur_level_teritip',
    label: 'Level Statis & Dinamis — IPA Teritip',
    unit: 'm',
    mode: 'pair',
    isDummy: false
  },
  {
    file: SHEETS_BASE + '?sheet=sumur_level_gunung_tembak',
    monthColumn: 'Bulan',
    key: 'sumur_level_gunung_tembak',
    label: 'Level Statis & Dinamis — IPA Gunung Tembak',
    unit: 'm',
    mode: 'pair',
    isDummy: false
  },
  {
    file: SHEETS_BASE + '?sheet=sumur_level_prapatan',
    monthColumn: 'Bulan',
    key: 'sumur_level_prapatan',
    label: 'Level Statis & Dinamis — IPA Prapatan',
    unit: 'm',
    mode: 'pair',
    isDummy: false
  },
  {
    file: SHEETS_BASE + '?sheet=sumur_level_zamp',
    monthColumn: 'Bulan',
    key: 'sumur_level_zamp',
    label: 'Level Statis & Dinamis — IPA Zamp',
    unit: 'm',
    mode: 'pair',
    isDummy: false
  },
  {
    file: SHEETS_BASE + '?sheet=sumur_level_kampung_baru_ulu',
    monthColumn: 'Bulan',
    key: 'sumur_level_kampung_baru_ulu',
    label: 'Level Statis & Dinamis — IPA Kampung Baru Ulu',
    unit: 'm',
    mode: 'pair',
    isDummy: false
  }
];

// Nama tab Google Sheets untuk semua dataset Sumur Dalam persis sama dengan
// nama file CSV lokalnya (mis. key 'sumur_debit_gunung_sari' ->
// data/sumur_debit_gunung_sari.csv), jadi localFile diisi otomatis di sini
// supaya tidak perlu ditulis manual 14x di atas.
SUMUR_SOURCES.forEach(source => {
  source.localFile = LOCAL_DATA_BASE + source.key + '.csv';
});

// ---------------------------------------------------------------------------
// LOOKUP KEY -> SUMBER (dipakai untuk lazy-load: cari tahu source mana yang
// perlu di-fetch untuk 1 dataset key, TANPA harus fetch semuanya dulu).
// ---------------------------------------------------------------------------
const DAILY_KEY_LOOKUP = {};   // key -> { source, colName, cfg }
DATA_SOURCES.forEach(source => {
  Object.entries(source.columns).forEach(([colName, cfg]) => {
    DAILY_KEY_LOOKUP[cfg.key] = { source, colName, cfg };
  });
});

const SUMUR_KEY_LOOKUP = {};   // key -> source
SUMUR_SOURCES.forEach(source => { SUMUR_KEY_LOOKUP[source.key] = source; });

// Label statis per key, dipakai untuk menampilkan tombol submenu SEBELUM
// datanya selesai di-fetch (jadi menu langsung muncul tanpa nunggu loading).
const KEY_LABEL_LOOKUP = {};
Object.values(DAILY_KEY_LOOKUP).forEach(({ cfg }) => { KEY_LABEL_LOOKUP[cfg.key] = cfg.label; });
Object.values(SUMUR_KEY_LOOKUP).forEach(source => { KEY_LABEL_LOOKUP[source.key] = source.label; });

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

// Gabungkan 1 baris data lokal + 1 baris data Sheets untuk key (tanggal/
// bulan) yang sama. Kolom dari Sheets menang HANYA kalau isinya tidak
// kosong -- kalau sel di Sheets kosong, nilai lokal yang lama tetap dipakai
// (supaya baris yang baru sebagian terisi di Sheets tidak menghapus kolom
// lain yang sudah ada nilainya di data lokal).
function mergeRowValues(localRow, sheetRow) {
  const merged = Object.assign({}, localRow);
  Object.keys(sheetRow).forEach(col => {
    const v = sheetRow[col];
    if (v !== undefined && v !== null && v !== '') merged[col] = v;
  });
  return merged;
}

// Gabungkan seluruh baris data lokal + Sheets berdasarkan kolom kunci
// (Tanggal untuk dataset harian, Bulan untuk dataset sumur). Baris dengan
// key yang sama di kedua sumber -> digabung (Sheets menang per-kolom).
// Baris yang cuma ada di salah satu sumber -> tetap ikut. Hasil diurutkan
// menaik berdasarkan key (aman karena formatnya ISO: YYYY-MM-DD / YYYY-MM).
function mergeRows(localRows, sheetRows, keyCol) {
  const map = new Map();
  localRows.forEach(r => { if (r[keyCol]) map.set(r[keyCol], r); });
  sheetRows.forEach(r => {
    if (!r[keyCol]) return;
    const existing = map.get(r[keyCol]);
    map.set(r[keyCol], existing ? mergeRowValues(existing, r) : r);
  });
  return Array.from(map.values()).sort((a, b) => (a[keyCol] < b[keyCol] ? -1 : a[keyCol] > b[keyCol] ? 1 : 0));
}

// Ambil data lokal (arsip lama) DAN Google Sheets (data baru) secara
// paralel, lalu gabung jadi satu tabel. Kalau salah satu sumber gagal
// dimuat (mis. tab Sheets belum ada, atau Apps Script sedang down), yang
// lain tetap dipakai -- jadi grafik tidak blank hanya karena satu sumber
// bermasalah. Cuma gagal total kalau KEDUA sumber gagal.
async function fetchMergedCSV(localPath, sheetUrl, keyCol) {
  const [localRes, sheetRes] = await Promise.allSettled([
    fetch(localPath).then(res => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.text();
    }),
    fetch(sheetUrl).then(res => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.text();
    })
  ]);

  let header = null, localRows = [], sheetRows = [];

  if (localRes.status === 'fulfilled') {
    const parsed = parseCSV(localRes.value);
    header = parsed.header;
    localRows = parsed.rows;
  } else {
    console.warn(`Gagal memuat data lokal ${localPath}:`, localRes.reason);
  }

  if (sheetRes.status === 'fulfilled') {
    const parsed = parseCSV(sheetRes.value);
    header = header ? Array.from(new Set([...header, ...parsed.header])) : parsed.header;
    sheetRows = parsed.rows;
  } else {
    console.warn(`Gagal memuat data Google Sheets ${sheetUrl}:`, sheetRes.reason);
  }

  if (!header) throw new Error(`Gagal memuat data lokal (${localPath}) maupun Google Sheets (${sheetUrl})`);

  return { header, rows: mergeRows(localRows, sheetRows, keyCol) };
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

// ---------------------------------------------------------------------------
// LAZY LOAD — fetch data hanya untuk dataset yang sedang dibuka, bukan
// semuanya di awal. Ini yang paling menentukan kecepatan loading pertama:
// sebelumnya halaman nunggu ~17 dataset selesai fetch sebelum apa pun
// tampil; sekarang cuma nunggu 1 dataset (yang lagi dibuka), dataset lain
// baru di-fetch saat user klik tab-nya. Hasil fetch di-cache per source,
// jadi kalau user bolak-balik ke tab yang sama, tidak fetch ulang.
// ---------------------------------------------------------------------------
const sourceLoadPromises = new Map(); // source object -> Promise (cache + dedupe fetch yang lagi jalan)

function loadDailySource(source) {
  if (sourceLoadPromises.has(source)) return sourceLoadPromises.get(source);
  const p = fetchMergedCSV(source.localFile, source.file, source.dateColumn).then(({ header, rows }) => {
    Object.entries(source.columns).forEach(([colName, cfg]) => {
      if (!header.includes(colName)) {
        console.warn(`Kolom "${colName}" tidak ditemukan di ${source.file}, dilewati.`);
        return;
      }
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
    });
  }).catch(err => {
    console.error(`Gagal memuat ${source.localFile} / ${source.file}:`, err);
    sourceLoadPromises.delete(source); // biar bisa dicoba lagi kalau user klik ulang
    throw err;
  });
  sourceLoadPromises.set(source, p);
  return p;
}

function loadSumurSource(source) {
  if (sourceLoadPromises.has(source)) return sourceLoadPromises.get(source);
  const p = fetchMergedCSV(source.localFile, source.file, source.monthColumn).then(({ header, rows }) => {
    datasets[source.key] = buildSumurDataset(source, header, rows);
  }).catch(err => {
    console.error(`Gagal memuat ${source.localFile} / ${source.file}:`, err);
    sourceLoadPromises.delete(source);
    throw err;
  });
  sourceLoadPromises.set(source, p);
  return p;
}

// Pastikan 1 dataset key sudah ter-fetch & tersedia di `datasets[key]`.
// Kalau sudah pernah (atau sedang) dimuat, tinggal nunggu promise yang sama
// (tidak fetch ulang). Melempar error kalau key tidak dikenal / gagal dimuat.
async function ensureDatasetLoaded(key) {
  if (datasets[key]) return datasets[key];
  const daily = DAILY_KEY_LOOKUP[key];
  if (daily) {
    await loadDailySource(daily.source);
    return datasets[key];
  }
  const sumur = SUMUR_KEY_LOOKUP[key];
  if (sumur) {
    await loadSumurSource(sumur);
    return datasets[key];
  }
  throw new Error(`Dataset "${key}" tidak dikenal.`);
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
// LOADING / ERROR STATE per dataset (dipakai selectDataset saat fetch)
// ---------------------------------------------------------------------------
function getStatusEl() {
  let el = document.getElementById('datasetStatus');
  if (!el) {
    el = document.createElement('div');
    el.id = 'datasetStatus';
    el.className = 'error-note';
    el.style.cssText = 'padding:24px;text-align:center;';
    document.querySelector('.panel').appendChild(el);
  }
  return el;
}

function showLoadingState() {
  document.getElementById('mainGrid').style.display = 'none';
  document.getElementById('statsRow').style.display = 'none';
  document.getElementById('tableWrap').style.display = 'none';
  document.getElementById('tilesWrap').style.display = 'none';
  const el = getStatusEl();
  el.style.display = 'block';
  el.textContent = 'Memuat data...';
}

function hideLoadingState() {
  const el = document.getElementById('datasetStatus');
  if (el) el.style.display = 'none';
}

function showLoadErrorState(err) {
  const el = getStatusEl();
  el.style.display = 'block';
  el.innerHTML = `Gagal memuat data untuk dataset ini.<br>${err.message}<br>Coba pilih ulang tab ini, atau muat ulang halaman.`;
}

// ---------------------------------------------------------------------------
// GANTI DATASET AKTIF — fetch (kalau belum ada di cache), lalu render.
// Ini titik masuk tunggal dipanggil dari semua tombol menu.
// ---------------------------------------------------------------------------
async function selectDataset(key) {
  currentKey = key;
  resetFilter();
  buildMenuMain();
  buildMenuCategory();
  buildMenuSub();
  showLoadingState();
  try {
    await ensureDatasetLoaded(key);
  } catch (err) {
    showLoadErrorState(err);
    return;
  }
  hideLoadingState();
  onDatasetChanged();
  render();
}

// ---------------------------------------------------------------------------
// MENU (utama -> kategori [opsional] -> sub)
// Menu dibangun langsung dari konfigurasi GROUPS/DATA_SOURCES/SUMUR_SOURCES
// (statis), TIDAK menunggu data selesai di-fetch -- supaya menu & tombol
// langsung muncul begitu halaman dibuka, baru isinya (grafik/tabel) yang
// nyusul saat datanya datang.
// ---------------------------------------------------------------------------
function buildMenuMain() {
  menuMainEl.innerHTML = '';
  GROUPS.forEach(g => {
    const btn = document.createElement('div');
    btn.className = 'menu-btn' + (g.key === currentGroup ? ' active' : '');
    btn.textContent = g.label;
    btn.dataset.key = g.key;
    btn.onclick = () => {
      if (g.key === currentGroup) return;
      currentGroup = g.key;
      const group = GROUPS.find(x => x.key === g.key);
      if (group.subgroups) {
        currentCategory = group.subgroups[0].key;
        selectDataset(group.subgroups[0].tabs[0]);
      } else {
        currentCategory = null;
        selectDataset(group.tabs[0]);
      }
    };
    menuMainEl.appendChild(btn);
  });
}

function buildMenuCategory() {
  menuCategoryEl.innerHTML = '';
  const group = GROUPS.find(g => g.key === currentGroup);
  if (!group.subgroups) { menuCategoryEl.style.display = 'none'; return; }
  menuCategoryEl.style.display = 'flex';
  group.subgroups.forEach(sub => {
    const btn = document.createElement('div');
    btn.className = 'category-pill' + (sub.key === currentCategory ? ' active' : '');
    btn.textContent = sub.label;
    btn.dataset.key = sub.key;
    btn.onclick = () => {
      if (sub.key === currentCategory) return;
      currentCategory = sub.key;
      selectDataset(sub.tabs[0]);
    };
    menuCategoryEl.appendChild(btn);
  });
}

function buildMenuSub() {
  menuSubEl.innerHTML = '';
  activeTabs().forEach(key => {
    const btn = document.createElement('div');
    btn.className = 'submenu-pill' + (key === currentKey ? ' active' : '');
    btn.textContent = KEY_LABEL_LOOKUP[key] || key;
    btn.dataset.key = key;
    btn.onclick = () => {
      if (key === currentKey) return;
      selectDataset(key);
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
  buildMenuMain();
  buildMenuCategory();
  buildMenuSub();
  wireControls();
  // Cuma dataset pertama (Level Waduk Manggar) yang di-fetch saat halaman
  // dibuka. Dataset lain baru di-fetch saat tab-nya diklik (lihat
  // selectDataset). Ini yang bikin loading pertama jauh lebih cepat
  // dibanding fetch semua 17 dataset sekaligus di awal.
  await selectDataset(currentKey);
}

init();
