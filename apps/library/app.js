/* ==========================================================================
   Library — Sumber Air Baku
   --------------------------------------------------------------------------
   Data asli disimpan di Postgres (bukan lagi CSV statis / Google Sheets), dan
   hanya dikeluarkan oleh /api/visualization/data kalau ada akses valid (JWT
   admin situs, atau token viz-access hasil approve email -- lihat bagian
   AKSES DATA VITAL di bawah). Tanpa akses, endpoint itu mengembalikan data
   CONTOH (dummy) dengan bentuk yang sama, supaya seluruh pipeline render di
   bawah (chart, gauge, tiles sumur, tabel) tetap jalan tanpa perlu tahu
   apakah datanya asli atau contoh.

   Akses SITE-WIDE: begitu satu permintaan disetujui admin (dari halaman
   mana pun -- air baku atau di sini), token yang dihasilkan berlaku untuk
   SEMUA data viewer di apps/riwayat-air-baku maupun apps/library sekaligus.
   Disimpan di localStorage dengan key yang sama dengan
   apps/riwayat-air-baku/app.js supaya kalau viewer sudah di-approve di satu
   halaman, halaman satunya otomatis ikut kebuka juga.

   Struktur menu tetap 2-3 tingkat seperti sebelumnya:
     Menu utama  -> Waduk Manggar / Waduk Teritip / Sumur Dalam
     Kategori    -> (khusus Sumur Dalam) Debit / Statis-Dinamis
     Sub menu    -> dataset per menu utama/kategori (lihat GROUPS di bawah)

   Data juga di-LAZY LOAD per key -- saat halaman dibuka cuma dataset yang
   sedang aktif yang di-fetch, dataset lain baru di-fetch saat tab-nya
   diklik.
   ========================================================================== */

// ---------------------------------------------------------------------------
// KONFIGURASI MENU (menu utama -> sub menu) -- tidak berubah dari versi lama
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
// KONFIGURASI DATASET per key (label/unit/gauge/mode) -- dipakai untuk
// merender hasil fetch API jadi bentuk yang sama seperti `datasets[key]`
// versi lama (CSV). Nama key & label SAMA PERSIS dengan sebelumnya.
// ---------------------------------------------------------------------------
const DAILY_KEYS = {
  manggar_level: { label: 'Level Waduk Manggar', unit: 'm', color: 'primary', hasGauge: true },
  manggar_hujan: { label: 'Curah Hujan Waduk Manggar', unit: 'mm', color: 'rain', isBar: true },
  manggar_ntu: { label: 'Kekeruhan (NTU) Waduk Manggar', unit: 'NTU', color: 'rain' },
  manggar_ph: { label: 'PH Air Baku Waduk Manggar', unit: 'pH', color: 'primary' },
  teritip_level: { label: 'Level Waduk Teritip', unit: 'm', color: 'primary', hasGauge: true },
  teritip_ntu: { label: 'Kekeruhan (NTU) Waduk Teritip', unit: 'NTU', color: 'rain' },
  teritip_ph: { label: 'PH Air Baku Waduk Teritip', unit: 'pH', color: 'primary' }
};

const SUMUR_KEYS = {
  sumur_debit_gunung_sari: { label: 'Debit Sumur — IPA Gunung Sari', unit: 'm³/jam', mode: 'single' },
  sumur_debit_kampung_damai: { label: 'Debit Sumur — IPA Kampung Damai', unit: 'm³/jam', mode: 'single' },
  sumur_debit_teritip: { label: 'Debit Sumur — IPA Teritip', unit: 'm³/jam', mode: 'single' },
  sumur_debit_gunung_tembak: { label: 'Debit Sumur — IPA Gunung Tembak', unit: 'm³/jam', mode: 'single' },
  sumur_debit_prapatan: { label: 'Debit Sumur — IPA Prapatan', unit: 'm³/jam', mode: 'single' },
  sumur_debit_zamp: { label: 'Debit Sumur — IPA Zamp', unit: 'm³/jam', mode: 'single' },
  sumur_debit_kp_baru_ulu: { label: 'Debit Sumur — IPA Kampung Baru Ulu', unit: 'm³/jam', mode: 'single' },
  sumur_level_gunung_sari: { label: 'Level Statis & Dinamis — IPA Gunung Sari', unit: 'm', mode: 'pair' },
  sumur_level_kampung_damai: { label: 'Level Statis & Dinamis — IPA Kampung Damai', unit: 'm', mode: 'pair' },
  sumur_level_teritip: { label: 'Level Statis & Dinamis — IPA Teritip', unit: 'm', mode: 'pair' },
  sumur_level_gunung_tembak: { label: 'Level Statis & Dinamis — IPA Gunung Tembak', unit: 'm', mode: 'pair' },
  sumur_level_prapatan: { label: 'Level Statis & Dinamis — IPA Prapatan', unit: 'm', mode: 'pair' },
  sumur_level_zamp: { label: 'Level Statis & Dinamis — IPA Zamp', unit: 'm', mode: 'pair' },
  sumur_level_kampung_baru_ulu: { label: 'Level Statis & Dinamis — IPA Kampung Baru Ulu', unit: 'm', mode: 'pair' }
};

// key -> grup akses (dipakai checkVizAccess di server & lock banner di sini).
const KEY_TO_ACCESSGROUP = {};
Object.keys(DAILY_KEYS).forEach(k => { KEY_TO_ACCESSGROUP[k] = k.startsWith('manggar') ? 'manggar' : 'teritip'; });
Object.keys(SUMUR_KEYS).forEach(k => { KEY_TO_ACCESSGROUP[k] = k.startsWith('sumur_debit') ? 'sumur_debit' : 'sumur_level'; });

const ACCESS_GROUP_LABELS = {
  manggar: 'Waduk Manggar',
  teritip: 'Waduk Teritip',
  sumur_debit: 'Debit Sumur Dalam',
  sumur_level: 'Level Statis & Dinamis Sumur Dalam'
};

const KEY_LABEL_LOOKUP = {};
Object.entries(DAILY_KEYS).forEach(([k, cfg]) => { KEY_LABEL_LOOKUP[k] = cfg.label; });
Object.entries(SUMUR_KEYS).forEach(([k, cfg]) => { KEY_LABEL_LOOKUP[k] = cfg.label; });

const MONTHS_ID = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

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

function monthLabelLong(d) {
  return d.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
}

// ---------------------------------------------------------------------------
// AKSES — site-wide: token yang dipakai untuk minta data asli ke API adalah
// JWT admin situs (localStorage 'token', dari login.html -- selalu lolos)
// ATAU satu token viz-access GLOBAL hasil approve email (bukan per grup lagi).
// Disimpan di localStorage dengan KEY YANG SAMA dengan
// apps/riwayat-air-baku/app.js (lihat bagian AKSES DATA VITAL di bawah).
// ---------------------------------------------------------------------------
function currentAccessToken() {
  return localStorage.getItem('token') || vizToken || null;
}

function activeAccessGroup() {
  return KEY_TO_ACCESSGROUP[currentKey];
}

async function fetchApiData(key) {
  const headers = {};
  const token = currentAccessToken();
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const res = await fetch(`/api/visualization/data?dataType=${key}`, { headers });
  if (!res.ok) throw new Error(`Gagal memuat data (HTTP ${res.status})`);
  return res.json(); // { locked, header, rows }
}

// Bangun `datasets[key]` dari hasil fetchApiData, bentuknya sama seperti
// versi lama (CSV): { label, unit, type, mode, color, real, data, wellColumns }.
function buildDatasetFromApi(key, header, rows, locked) {
  const dailyCfg = DAILY_KEYS[key];
  if (dailyCfg) {
    const dateField = header[0];
    const valueField = header[1];
    const series = rows
      .map(r => ({ date: new Date(r[dateField] + 'T00:00:00'), value: toNum(r[valueField]) }))
      .filter(r => !isNaN(r.date.getTime()));
    const ds = {
      label: dailyCfg.label, unit: dailyCfg.unit, type: dailyCfg.isBar ? 'daily-bar' : 'daily',
      color: dailyCfg.color, mode: 'single', real: !locked, data: series
    };
    if (dailyCfg.hasGauge) {
      const [mn, mx] = minMax(series);
      ds.minHist = Math.floor(mn - 0.5);
      ds.maxHist = Math.ceil(mx + 0.5);
    }
    datasets[key] = ds;
    return;
  }

  const sumurCfg = SUMUR_KEYS[key];
  const wellColumns = sumurCfg.mode === 'single'
    ? header.slice(1)
    : [...new Set(header.slice(1).map(h => h.replace(/_(Statis|Dinamis)$/, '')))];

  const data = rows.map(r => {
    const row = { date: new Date(r.Bulan + '-01T00:00:00') };
    if (sumurCfg.mode === 'single') {
      wellColumns.forEach(w => { row[w] = toNum(r[w]); });
    } else {
      wellColumns.forEach(w => {
        row[w + '_Statis'] = toNum(r[w + '_Statis']);
        row[w + '_Dinamis'] = toNum(r[w + '_Dinamis']);
      });
    }
    return row;
  }).filter(r => !isNaN(r.date.getTime()));

  datasets[key] = {
    label: sumurCfg.label, unit: sumurCfg.unit, type: 'monthly-multi', mode: sumurCfg.mode,
    color: 'primary', real: !locked, data, wellColumns
  };
}

// ---------------------------------------------------------------------------
// LAZY LOAD — fetch data hanya untuk key yang sedang dibuka, bukan semuanya
// di awal. Di-cache per key (Promise) supaya tidak fetch ulang kalau user
// bolak-balik antar tab. Cache di-clear SELURUHNYA tiap kali status akses
// berubah (baru approved / token kedaluwarsa) lewat reloadAllData() --
// site-wide, jadi semua key ikut ter-refresh, bukan cuma satu grup.
// ---------------------------------------------------------------------------
const sourceLoadPromises = new Map(); // key -> Promise
const sourceLockStatus = {}; // accessGroup -> boolean (true = sedang locked/dummy)

function loadKeySource(key) {
  if (sourceLoadPromises.has(key)) return sourceLoadPromises.get(key);
  const p = fetchApiData(key).then(({ locked, header, rows }) => {
    sourceLockStatus[KEY_TO_ACCESSGROUP[key]] = locked;
    buildDatasetFromApi(key, header, rows, locked);
  }).catch(err => {
    console.error(`Gagal memuat data ${key}:`, err);
    sourceLoadPromises.delete(key);
    throw err;
  });
  sourceLoadPromises.set(key, p);
  return p;
}

async function ensureDatasetLoaded(key) {
  await loadKeySource(key);
  return datasets[key];
}

async function reloadAllData() {
  sourceLoadPromises.clear();
  Object.keys(datasets).forEach(k => { delete datasets[k]; });
  try {
    await ensureDatasetLoaded(currentKey);
  } catch (err) {
    showLoadErrorState(err);
    return;
  }
  onDatasetChanged();
  render();
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
let isAdmin = false;

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
  const isSumurGroup = currentGroup === 'sumur';

  document.getElementById('mainGrid').style.display = isSumurGroup ? 'none' : 'grid';
  document.getElementById('statsRow').style.display = isSumurGroup ? 'none' : 'flex';
  document.getElementById('tableWrap').style.display = isSumurGroup ? 'none' : 'block';
  document.getElementById('tilesWrap').style.display = isSumurGroup ? 'block' : 'none';

  const group = activeAccessGroup();
  const locked = !!sourceLockStatus[group] && !isAdmin;
  const badge = document.getElementById('statusBadge');
  const note = document.getElementById('noteBox');

  if (locked) {
    badge.textContent = 'Data Contoh (Terkunci)';
    badge.style.background = 'var(--warn)';
    note.innerHTML = `<b>Nilai yang tampil sekarang adalah data CONTOH, bukan data asli.</b> Data ini vital bagi perusahaan — klik "Minta Akses" di atas untuk melihat data sebenarnya.`;
  } else {
    badge.textContent = 'Data Asli';
    badge.style.background = 'var(--good)';
    note.innerHTML = `Baris yang kosong (misal parameter tidak diperiksa hari itu) ditampilkan sebagai baris kosong, bukan diisi paksa.`;
  }

  buildYearRow();
  updateLockBanner();
  updatePdfButton();
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
// UNDUH EXCEL (.xlsx via SheetJS) -- tidak berubah dari versi lama
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
  if (!isAdmin) {
    alert('Unduh Excel khusus admin. Silakan login admin terlebih dahulu.');
    window.location.href = '../../login.html';
    return;
  }
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
// UNDUH PDF — digenerate di SERVER (pdf-lib) dari data asli, hanya kalau ada
// akses valid (JWT admin situs, atau token viz-access grup terkait). Server
// selalu mengekspor tabel lengkap (harian/bulanan untuk Manggar-Teritip,
// pivot sumur x bulan untuk Sumur Dalam); filter tahun (kalau dipilih) ikut
// dikirim, filter bulan tidak didukung server jadi diabaikan (tetap unduh
// satu tahun penuh).
// ---------------------------------------------------------------------------
function downloadPdf() {
  const token = currentAccessToken();
  if (!token) {
    alert('Unduh PDF perlu akses data asli dulu. Klik "Minta Akses" di atas untuk meminta persetujuan admin.');
    return;
  }

  const params = new URLSearchParams();
  params.set('dataType', currentKey);
  params.set('token', token);
  if (selectedYear) params.set('year', selectedYear);

  window.location.href = `/api/visualization/export-pdf?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// STATUS ADMIN (gating tombol Unduh Excel) -- tidak berubah dari versi lama
// ---------------------------------------------------------------------------
function checkAdminStatus() {
  const token = localStorage.getItem('token');
  const role = localStorage.getItem('role');
  isAdmin = !!(token && role === 'admin');
  updateAdminButton();
}

function updateAdminButton() {
  const btn = document.getElementById('downloadExcelBtn');
  if (isAdmin) {
    btn.textContent = 'Unduh Excel';
    btn.classList.add('enabled');
  } else {
    btn.textContent = '🔒 Unduh Excel (Admin)';
    btn.classList.remove('enabled');
  }
}

// ---------------------------------------------------------------------------
// AKSES DATA VITAL — banner "terkunci" + form "Minta Akses" + polling status
// + auto-unlock setelah admin approve lewat email + auto re-lock setelah
// token 1 jam habis. Site-wide: SATU token global (bukan per grup lagi),
// disimpan di localStorage dengan key yang sama dengan
// apps/riwayat-air-baku/app.js -- approval dari halaman itu otomatis
// dikenali di sini juga, dan sebaliknya.
// ---------------------------------------------------------------------------
let vizToken = null;
let vizTokenExpiresAt = null;
let vizRequestId = null;
let pollTimer = null;
let expiryTimer = null;
let modalGroup = null; // cuma label konteks buat modal & field dataType yang dikirim ke admin

function updateLockBanner() {
  const banner = document.getElementById('lockBanner');
  const statusText = document.getElementById('lockStatusText');
  if (!banner) return;
  const group = activeAccessGroup();
  const locked = !!sourceLockStatus[group] && !isAdmin;
  if (!locked) { banner.style.display = 'none'; return; }
  banner.style.display = 'flex';
  statusText.textContent = pollTimer ? 'Menunggu persetujuan admin lewat email...' : '';
}

function updatePdfButton() {
  const btn = document.getElementById('downloadPdfBtn');
  if (!btn) return;
  if (currentAccessToken()) {
    btn.textContent = 'Unduh PDF';
    btn.disabled = false;
  } else {
    btn.textContent = '🔒 Unduh PDF (Perlu Akses)';
    btn.disabled = true;
  }
}

function openAccessModal() {
  modalGroup = activeAccessGroup();
  const overlay = document.getElementById('accessModalOverlay');
  if (!overlay) return;
  const groupNameEl = document.getElementById('accessModalGroupName');
  if (groupNameEl) groupNameEl.textContent = ACCESS_GROUP_LABELS[modalGroup] || modalGroup;
  overlay.style.display = 'flex';
  setAccessModalStatus('', '');
}

function closeAccessModal() {
  const overlay = document.getElementById('accessModalOverlay');
  if (overlay) overlay.style.display = 'none';
}

// Tombol darurat: buka WhatsApp admin dengan pesan otomatis, tidak
// menyentuh database sama sekali (tidak wajib isi nama dulu).
const ADMIN_WHATSAPP_NUMBER = '6281381146320';

function openWhatsappChat() {
  const nama = document.getElementById('accessNamaInput').value.trim();
  const groupLabel = ACCESS_GROUP_LABELS[modalGroup] || modalGroup || 'ini';
  const namaPart = nama ? ` ${nama}` : '';
  const message = `Halo, saya${namaPart} baru saja mengirim permintaan akses data ${groupLabel} di website, mohon persetujuannya.`;
  window.open(`https://wa.me/${ADMIN_WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`, '_blank');
}

function setAccessModalStatus(msg, cls) {
  const el = document.getElementById('accessModalStatus');
  if (!el) return;
  el.textContent = msg;
  el.className = 'status-msg ' + (cls || '');
}

async function submitAccessRequest() {
  const nama = document.getElementById('accessNamaInput').value.trim();
  const alasan = document.getElementById('accessAlasanInput').value.trim();

  if (!nama) {
    setAccessModalStatus('Isi nama dulu ya.', 'error');
    return;
  }

  const btn = document.getElementById('accessModalSubmit');
  btn.disabled = true;
  setAccessModalStatus('Mengirim permintaan...', 'pending');

  try {
    const res = await fetch('/api/visualization/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestedBy: nama, dataType: modalGroup, reason: alasan || undefined })
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'Gagal mengirim permintaan.');

    vizRequestId = data.requestId;
    try { localStorage.setItem('vizRequestId', String(vizRequestId)); } catch (e) {}

    setAccessModalStatus('Permintaan terkirim. Menunggu admin menyetujui lewat email — halaman ini akan otomatis update.', 'pending');
    startPolling();
  } catch (err) {
    setAccessModalStatus(err.message, 'error');
  }
  btn.disabled = false;
}

function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  updateLockBanner();
  pollTimer = setInterval(checkAccessStatus, 4000);
  checkAccessStatus();
}

async function checkAccessStatus() {
  if (!vizRequestId) return;
  try {
    const res = await fetch(`/api/visualization/status?id=${vizRequestId}`);
    const data = await res.json();

    if (data.status === 'approved') {
      clearInterval(pollTimer);
      pollTimer = null;
      vizToken = data.token;
      vizTokenExpiresAt = data.expiresAt;
      try {
        localStorage.setItem('vizAccessToken', vizToken);
        localStorage.setItem('vizAccessExpiresAt', vizTokenExpiresAt);
        localStorage.removeItem('vizRequestId');
      } catch (e) {}
      scheduleTokenExpiry();
      setAccessModalStatus('Akses disetujui! Memuat data asli...', 'ok');
      await reloadAllData();
      closeAccessModal();
    } else if (data.status === 'expired' || data.status === 'not_found') {
      clearInterval(pollTimer);
      pollTimer = null;
      vizRequestId = null;
      try { localStorage.removeItem('vizRequestId'); } catch (e) {}
      updateLockBanner();
    }
  } catch (err) {
    console.warn('Gagal cek status akses:', err);
  }
}

function scheduleTokenExpiry() {
  if (expiryTimer) clearTimeout(expiryTimer);
  const ms = new Date(vizTokenExpiresAt).getTime() - Date.now();
  expiryTimer = setTimeout(() => {
    vizToken = null;
    vizTokenExpiresAt = null;
    try {
      localStorage.removeItem('vizAccessToken');
      localStorage.removeItem('vizAccessExpiresAt');
    } catch (e) {}
    reloadAllData();
  }, Math.max(ms, 0));
}

// Kalau ada token viz-access yang masih berlaku (dari approval di halaman
// ini ATAU apps/riwayat-air-baku -- sama-sama pakai localStorage key ini),
// atau ada permintaan yang masih pending, lanjutkan otomatis tanpa perlu
// request baru.
function restoreVizSession() {
  try {
    const token = localStorage.getItem('vizAccessToken');
    const expiresAt = localStorage.getItem('vizAccessExpiresAt');
    if (token && expiresAt && new Date(expiresAt).getTime() > Date.now()) {
      vizToken = token;
      vizTokenExpiresAt = expiresAt;
      scheduleTokenExpiry();
      return;
    }
    const pendingId = localStorage.getItem('vizRequestId');
    if (pendingId) {
      vizRequestId = pendingId;
      startPolling();
    }
  } catch (e) {}
}

// ---------------------------------------------------------------------------
// INIT
// ---------------------------------------------------------------------------
function wireControls() {
  document.getElementById('downloadPdfBtn').onclick = downloadPdf;
  document.getElementById('downloadExcelBtn').onclick = downloadExcel;
  const requestBtn = document.getElementById('requestAccessBtn');
  const cancelBtn = document.getElementById('accessModalCancel');
  const submitBtn = document.getElementById('accessModalSubmit');
  const whatsappBtn = document.getElementById('accessModalWhatsapp');
  if (requestBtn) requestBtn.addEventListener('click', openAccessModal);
  if (cancelBtn) cancelBtn.addEventListener('click', closeAccessModal);
  if (submitBtn) submitBtn.addEventListener('click', submitAccessRequest);
  if (whatsappBtn) whatsappBtn.addEventListener('click', openWhatsappChat);
}

async function init() {
  buildMenuMain();
  buildMenuCategory();
  buildMenuSub();
  wireControls();
  checkAdminStatus();
  restoreVizSession();
  // Cuma dataset pertama (Level Waduk Manggar) yang di-fetch saat halaman
  // dibuka. Dataset lain baru di-fetch saat tab-nya diklik (lihat
  // selectDataset).
  await selectDataset(currentKey);
}

init();
