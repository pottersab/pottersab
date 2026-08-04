/* ==========================================================================
   Data Historis Pengambilan Air Baku
   --------------------------------------------------------------------------
   Pola & tampilan sama dengan app "Library" (apps/library) — menu utama ->
   sub menu -> grafik+gauge -> stat cards -> tabel. Bedanya: sumbernya
   monthly (bukan harian), ada submenu "Rekapitulasi" (grafik jumlah + tabel
   pivot instalasi x bulan per tahun), dan dua tombol unduh (PDF untuk tamu,
   Excel khusus admin).

   Dulu "Jumlah (Total)" adalah tab tersendiri di sebelah Rekapitulasi, dengan
   seri sendiri lintas tahun. Tab itu sudah dihapus: angkanya memang baris
   "Jumlah" di tabel pivot, jadi yang tersisa cuma diagram batang 12 bulan di
   atas tabel itu — satu halaman untuk grafik, statistik, dan tabel. Periodenya
   ikut chip tahun, sama seperti grafik di tampilan seri per instalasi.

   Data asli disimpan di Postgres (bukan lagi CSV statis / Google Sheets),
   dan hanya dikeluarkan oleh /api/visualization/data kalau ada akses valid
   (JWT admin situs, atau token viz-access hasil approve email). Tanpa akses,
   endpoint itu mengembalikan data CONTOH (dummy) dengan bentuk yang sama
   supaya seluruh pipeline render di bawah ini (chart, gauge, rekap, stat)
   tetap jalan tanpa perlu tahu apakah datanya asli atau contoh.

   Akses SITE-WIDE: begitu satu permintaan disetujui admin (dari halaman
   mana pun -- di sini atau apps/library), token yang dihasilkan berlaku
   untuk SEMUA data viewer di kedua halaman sekaligus. Disimpan di
   localStorage dengan key yang sama dengan apps/library/app.js supaya
   viewer yang sudah di-approve di satu halaman otomatis ikut kebuka juga
   di halaman satunya.

   Data juga di-LAZY LOAD per grup (AP / ATD) -- saat halaman dibuka cuma
   grup yang sedang aktif yang di-fetch, grup lain baru di-fetch saat
   tab-nya diklik.
   ========================================================================== */

// ---------------------------------------------------------------------------
// KONFIGURASI MENU (menu utama -> sub menu)
// ---------------------------------------------------------------------------
const GROUPS = [
  { key: 'ap', label: 'Air Permukaan (AP)', wellTabs: ['ap_teritip', 'ap_kampung_damai', 'ap_batu_ampar', 'ap_km12', 'ap_gunung_tembak'], aggTabs: ['ap_rekap'] },
  { key: 'atd', label: 'Air Tanah Dalam (ATD)', wellTabs: ['atd_kampung_damai', 'atd_gunung_sari', 'atd_prapatan', 'atd_zamp', 'atd_kampung_baru_ulu'], aggTabs: ['atd_rekap'] }
];

function allTabsOf(group) {
  return [...group.wellTabs, ...group.aggTabs];
}

// ---------------------------------------------------------------------------
// KONFIGURASI SUMBER DATA (groupKey harus sama dengan dataType di API)
// ---------------------------------------------------------------------------
const DATA_SOURCES = [
  {
    groupKey: 'ap',
    dateColumn: 'Bulan',
    rekapKey: 'ap_rekap',
    rekapCategoryLabel: 'Air Permukaan (AP)',
    // Jarak antar garis bantu sumbu Y di grafik rekap. Disetel per kategori,
    // bukan dihitung otomatis, karena besaran AP dan ATD beda jauh dan angka
    // yang enak dibaca ditentukan kebiasaan orang yang memakainya.
    rekapTickStep: 250000,
    columns: {
      Teritip: { key: 'ap_teritip', label: 'Debit AP — Teritip', unit: 'm³', color: 'primary', hasGauge: true },
      Kampung_Damai: { key: 'ap_kampung_damai', label: 'Debit AP — Kampung Damai', unit: 'm³', color: 'primary', hasGauge: true },
      Batu_Ampar: { key: 'ap_batu_ampar', label: 'Debit AP — Batu Ampar', unit: 'm³', color: 'primary', hasGauge: true },
      Km_12: { key: 'ap_km12', label: 'Debit AP — Kilometer 12', unit: 'm³', color: 'primary', hasGauge: true },
      Gunung_Tembak: { key: 'ap_gunung_tembak', label: 'Debit AP — Gunung Tembak', unit: 'm³', color: 'primary', hasGauge: true }
    }
  },
  {
    groupKey: 'atd',
    dateColumn: 'Bulan',
    rekapKey: 'atd_rekap',
    rekapCategoryLabel: 'Air Tanah Dalam (ATD)',
    rekapTickStep: 25000,
    columns: {
      Kampung_Damai: { key: 'atd_kampung_damai', label: 'Debit ATD — Kampung Damai', unit: 'm³', color: 'primary', hasGauge: true },
      Gunung_Sari: { key: 'atd_gunung_sari', label: 'Debit ATD — Gunung Sari', unit: 'm³', color: 'primary', hasGauge: true },
      Prapatan: { key: 'atd_prapatan', label: 'Debit ATD — Prapatan', unit: 'm³', color: 'primary', hasGauge: true },
      Zamp: { key: 'atd_zamp', label: 'Debit ATD — Zamp', unit: 'm³', color: 'primary', hasGauge: true },
      Kampung_Baru_Ulu: { key: 'atd_kampung_baru_ulu', label: 'Debit ATD — Kampung Baru Ulu', unit: 'm³', color: 'primary', hasGauge: true }
    }
  }
];

// ---------------------------------------------------------------------------
// LOOKUP KEY -> GRUP & LABEL STATIS (dipakai untuk lazy-load & buat menu
// TANPA nunggu data selesai di-fetch)
// ---------------------------------------------------------------------------
const SOURCE_BY_GROUP = {};
DATA_SOURCES.forEach(source => { SOURCE_BY_GROUP[source.groupKey] = source; });

const KEY_TO_GROUP = {};
GROUPS.forEach(g => { allTabsOf(g).forEach(k => { KEY_TO_GROUP[k] = g.key; }); });

const KEY_LABEL_LOOKUP = {};
const KEY_TO_COLNAME = {};
DATA_SOURCES.forEach(source => {
  Object.entries(source.columns).forEach(([colName, cfg]) => {
    KEY_LABEL_LOOKUP[cfg.key] = cfg.label.replace(/^Debit (AP|ATD) — /, '');
    KEY_TO_COLNAME[cfg.key] = colName;
  });
  if (source.rekapKey) KEY_LABEL_LOOKUP[source.rekapKey] = 'Rekapitulasi';
});

const MONTHS_ID = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

function toNum(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

function fmtNum(v) {
  return v !== null && v !== undefined && !Number.isNaN(v) ? v.toLocaleString('id-ID', { maximumFractionDigits: 0 }) : '-';
}

function minMax(arr) {
  const vals = arr.map(r => r.value).filter(v => v !== null && v !== undefined);
  return [Math.min(...vals), Math.max(...vals)];
}

// Format tampilan (bulanan): "Jul 2015"
function dateStrDisplay(d) {
  return d.toLocaleDateString('id-ID', { month: 'short', year: 'numeric' });
}
function monthLabelLong(d) {
  return d.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
}

// ---------------------------------------------------------------------------
// AKSES — token yang dipakai untuk minta data asli ke API: JWT admin situs
// (localStorage 'token', dari login.html) kalau ada, atau token viz-access
// hasil approve email (lihat bagian AKSES DATA VITAL di bawah).
// ---------------------------------------------------------------------------
function currentAccessToken() {
  return localStorage.getItem('token') || vizToken || null;
}

async function fetchApiData(dataType) {
  const headers = {};
  const token = currentAccessToken();
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const res = await fetch(`/api/visualization/data?dataType=${dataType}`, { headers });
  if (!res.ok) throw new Error(`Gagal memuat data (HTTP ${res.status})`);
  return res.json(); // { locked, header, rows }
}

// Isi `datasets` & `REKAP_TABLES` untuk SATU source (AP atau ATD) dari hasil
// fetchApiData. Dipisah dari loader supaya bisa dipanggil per grup, bukan
// harus muat AP+ATD sekaligus.
function buildSourceDatasets(source, header, rows) {
  const perColSeries = {};
  const wellsForRekap = [];
  for (const colName of Object.keys(source.columns)) {
    if (!header.includes(colName)) {
      console.warn(`Kolom "${colName}" tidak ditemukan di data ${source.groupKey}, dilewati.`);
      continue;
    }
    const cfg = source.columns[colName];
    const series = rows
      .map(r => ({ date: new Date(r[source.dateColumn] + '-01T00:00:00'), value: toNum(r[colName]) }))
      .filter(r => !isNaN(r.date.getTime()));
    const ds = {
      label: cfg.label, unit: cfg.unit, type: 'daily', color: cfg.color,
      real: true, data: series
    };
    if (cfg.hasGauge) {
      const [mn, mx] = minMax(series);
      ds.minHist = Math.floor(mn - Math.abs(mn) * 0.02);
      ds.maxHist = Math.ceil(mx + Math.abs(mx) * 0.02);
    }
    datasets[cfg.key] = ds;
    perColSeries[colName] = series;
    wellsForRekap.push({ colName, label: cfg.label.replace(/^Debit (AP|ATD) — /, '') });
  }

  // Tabel "Rekapitulasi" (pivot instalasi x bulan, per tahun)
  if (source.rekapKey) {
    const rekapRows = rows.map(r => {
      const date = new Date(r[source.dateColumn] + '-01T00:00:00');
      const values = {};
      wellsForRekap.forEach(w => { values[w.colName] = toNum(r[w.colName]); });
      return { date, values };
    }).filter(r => !isNaN(r.date.getTime()));

    REKAP_TABLES[source.rekapKey] = {
      label: 'Rekapitulasi',
      categoryLabel: source.rekapCategoryLabel,
      unit: 'm³',
      tickStep: source.rekapTickStep,
      wells: wellsForRekap,
      data: rekapRows
    };
  }
}

// ---------------------------------------------------------------------------
// LAZY LOAD — fetch data hanya untuk grup (AP/ATD) yang sedang dibuka, bukan
// keduanya di awal. Di-cache per source supaya tidak fetch ulang kalau user
// bolak-balik antar grup. Cache di-clear tiap kali status akses berubah
// (baru approved / token kedaluwarsa) lewat reloadAllGroupsData().
// ---------------------------------------------------------------------------
const sourceLoadPromises = new Map(); // source -> Promise
const sourceLockStatus = {}; // groupKey -> boolean (true = sedang locked/dummy)

function loadGroupSource(source) {
  if (sourceLoadPromises.has(source)) return sourceLoadPromises.get(source);
  const p = fetchApiData(source.groupKey).then(({ locked, header, rows }) => {
    sourceLockStatus[source.groupKey] = locked;
    buildSourceDatasets(source, header, rows);
  }).catch(err => {
    console.error(`Gagal memuat data ${source.groupKey}:`, err);
    sourceLoadPromises.delete(source);
    throw err;
  });
  sourceLoadPromises.set(source, p);
  return p;
}

// Pastikan grup (AP/ATD) dari 1 dataset key sudah ter-fetch.
async function ensureGroupLoaded(key) {
  const groupKey = KEY_TO_GROUP[key];
  const source = SOURCE_BY_GROUP[groupKey];
  if (!source) throw new Error(`Dataset "${key}" tidak dikenal.`);
  await loadGroupSource(source);
}

async function reloadAllGroupsData() {
  sourceLoadPromises.clear();
  try {
    await ensureGroupLoaded(currentKey);
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
let REKAP_TABLES = {};
let currentGroup = 'ap';
let currentKey = 'ap_teritip';
let filterMode = 'all';
let selectedYear = null;
let chart;
let rekapChart;
let isAdmin = false;

let vizToken = null;
let vizTokenExpiresAt = null;
let vizRequestId = null;
let vizRequestSecret = null;
let modalGroup = null; // grup yang sedang diminta saat modal "Minta Akses" dibuka (buat label & pesan WhatsApp)
let pollTimer = null;
let expiryTimer = null;

const menuMainEl = document.getElementById('menuMain');
const menuSubEl = document.getElementById('menuSub');
const menuAggEl = document.getElementById('menuAgg');
const yearRowEl = document.getElementById('yearRow');
const rangeLabelEl = document.getElementById('rangeLabel');

function currentDataset() { return datasets[currentKey]; }
function isRekapActive() { return !!REKAP_TABLES[currentKey]; }
function currentRekap() { return REKAP_TABLES[currentKey]; }

// ---------------------------------------------------------------------------
// LOADING / ERROR STATE per grup (dipakai selectDataset saat fetch)
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
  document.getElementById('rekapWrap').style.display = 'none';
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
  el.innerHTML = `Gagal memuat data untuk grup ini.<br>${err.message}<br>Coba pilih ulang tab ini, atau muat ulang halaman.`;
}

// ---------------------------------------------------------------------------
// GANTI DATASET AKTIF — fetch grup terkait (kalau belum di-cache), lalu
// render. Titik masuk tunggal dipanggil dari semua tombol menu.
// ---------------------------------------------------------------------------
async function selectDataset(key) {
  currentKey = key;
  currentGroup = KEY_TO_GROUP[key];
  resetFilter();
  buildMenuMain();
  buildMenuSub();
  buildMenuAgg();
  showLoadingState();
  try {
    await ensureGroupLoaded(key);
  } catch (err) {
    showLoadErrorState(err);
    return;
  }
  hideLoadingState();
  onDatasetChanged();
  render();
}

// ---------------------------------------------------------------------------
// MENU (utama -> sub) — dibangun langsung dari GROUPS/DATA_SOURCES (statis),
// tidak menunggu data selesai di-fetch.
// ---------------------------------------------------------------------------
function buildMenuMain() {
  menuMainEl.innerHTML = '';
  GROUPS.forEach(g => {
    const btn = document.createElement('div');
    btn.className = 'menu-btn' + (g.key === currentGroup ? ' active' : '');
    btn.textContent = g.label;
    btn.onclick = () => {
      if (g.key === currentGroup) return;
      selectDataset(g.wellTabs[0]);
    };
    menuMainEl.appendChild(btn);
  });
}

function subMenuLabel(key) {
  return KEY_LABEL_LOOKUP[key] || key;
}

function buildMenuSub() {
  menuSubEl.innerHTML = '';
  const group = GROUPS.find(g => g.key === currentGroup);
  group.wellTabs.forEach(key => {
    const btn = document.createElement('div');
    btn.className = 'submenu-pill' + (key === currentKey ? ' active' : '');
    btn.textContent = subMenuLabel(key);
    btn.onclick = () => {
      if (key === currentKey) return;
      selectDataset(key);
    };
    menuSubEl.appendChild(btn);
  });
}

function buildMenuAgg() {
  menuAggEl.innerHTML = '';
  const group = GROUPS.find(g => g.key === currentGroup);
  group.aggTabs.forEach(key => {
    const btn = document.createElement('div');
    btn.className = 'category-pill' + (key === currentKey ? ' active' : '');
    btn.textContent = subMenuLabel(key);
    btn.onclick = () => {
      if (key === currentKey) return;
      selectDataset(key);
    };
    menuAggEl.appendChild(btn);
  });
}

function onDatasetChanged() {
  const badge = document.getElementById('statusBadge');
  const note = document.getElementById('noteBox');
  const locked = !!sourceLockStatus[currentGroup];

  if (locked) {
    badge.textContent = 'Data Contoh (Terkunci)';
    badge.style.background = 'var(--warn)';
  } else {
    badge.textContent = 'Data Asli';
    badge.style.background = 'var(--good)';
  }

  if (isRekapActive()) {
    const rk = currentRekap();
    note.innerHTML = `Rekapitulasi bulanan (Januari—Desember) tiap instalasi ${rk.categoryLabel} dalam satu tahun (satuan ${rk.unit}). Sel kosong berarti data belum tercatat pada bulan tersebut. Pilih tahun di atas untuk berpindah periode. Grafik di atas tabel adalah baris <b>Jumlah</b> — angkanya sama persis.` +
      (locked ? ' <b>Nilai yang tampil sekarang adalah data CONTOH, bukan data asli.</b>' : '');
  } else {
    const ds = currentDataset();
    note.innerHTML = `Data bulanan (satuan ${ds.unit}). Sel kosong berarti data belum tercatat pada bulan tersebut, bukan nol.` +
      (locked ? ' <b>Nilai yang tampil sekarang adalah data CONTOH, bukan data asli.</b>' : '');
  }
  buildYearRow();
  updateLockBanner(locked);
  updatePdfButton();
}

// ---------------------------------------------------------------------------
// FILTER TAHUN
// ---------------------------------------------------------------------------
function resetFilter() {
  filterMode = 'all';
  selectedYear = null;
}

function yearsInData(data) {
  return [...new Set(data.map(r => r.date.getFullYear()))].sort((a, b) => a - b);
}

function currentYearsSource() {
  return isRekapActive() ? currentRekap().data : currentDataset().data;
}

function buildYearRow() {
  const years = yearsInData(currentYearsSource());
  yearRowEl.innerHTML = '';

  const allChip = document.createElement('div');
  allChip.className = 'chip' + (filterMode === 'all' ? ' active' : '');
  allChip.textContent = 'Semua Data';
  allChip.onclick = () => { filterMode = 'all'; selectedYear = null; buildYearRow(); render(); };
  yearRowEl.appendChild(allChip);

  years.forEach(y => {
    const chip = document.createElement('div');
    chip.className = 'chip' + ((filterMode !== 'all' && selectedYear === y) ? ' active' : '');
    chip.textContent = y;
    chip.onclick = () => { filterMode = 'year'; selectedYear = y; buildYearRow(); render(); };
    yearRowEl.appendChild(chip);
  });
}

function filteredData() {
  const ds = currentDataset();
  if (filterMode === 'all') return ds.data;
  return ds.data.filter(r => r.date.getFullYear() === selectedYear);
}

function currentRangeLabel() {
  if (filterMode === 'all') return 'Semua Data';
  return `Tahun ${selectedYear}`;
}

function rekapActiveYear() {
  const years = yearsInData(currentRekap().data);
  if (filterMode === 'year' && selectedYear && years.includes(selectedYear)) return selectedYear;
  return years[years.length - 1];
}

// ---------------------------------------------------------------------------
// RENDER — grafik + gauge (mode normal)
// ---------------------------------------------------------------------------
function statCardsHtml(label, values, unit) {
  const valid = values.filter(v => v !== null && v !== undefined);
  const min = valid.length ? Math.min(...valid) : NaN;
  const max = valid.length ? Math.max(...valid) : NaN;
  const avg = valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : NaN;
  const last = valid[valid.length - 1];
  const fmt = v => v !== undefined && !Number.isNaN(v) ? v.toLocaleString('id-ID', { maximumFractionDigits: 0 }) : '-';
  const p = label ? label + ' — ' : '';
  return `
    <div class="stat"><div class="k">${p}Minimum</div><div class="v">${fmt(min)} ${unit}</div></div>
    <div class="stat"><div class="k">${p}Maksimum</div><div class="v">${fmt(max)} ${unit}</div></div>
    <div class="stat"><div class="k">${p}Rata-rata</div><div class="v">${fmt(avg)} ${unit}</div></div>
    <div class="stat"><div class="k">${p}Terakhir</div><div class="v">${fmt(last)} ${unit}</div></div>
  `;
}

function setViewMode(mode) {
  document.getElementById('mainGrid').style.display = mode === 'chart' ? 'grid' : 'none';
  document.getElementById('statsRow').style.display = mode === 'chart' ? 'flex' : 'none';
  document.getElementById('tableWrap').style.display = mode === 'chart' ? 'block' : 'none';
  document.getElementById('rekapWrap').style.display = mode === 'rekap' ? 'block' : 'none';
  document.getElementById('rekapChartWrap').style.display = mode === 'rekap' ? 'block' : 'none';
}

function renderChartView() {
  setViewMode('chart');
  const ds = currentDataset();
  const rows = filteredData();
  rangeLabelEl.textContent = currentRangeLabel();

  const labels = rows.map(r => dateStrDisplay(r.date));

  const ctx = document.getElementById('mainChart').getContext('2d');
  if (chart) chart.destroy();
  const accent = ds.color === 'rain' ? '#D98F3E' : '#0B5566';

  const vals = rows.map(r => r.value);
  const chartDatasets = [{
    label: ds.label, data: vals, borderColor: accent,
    backgroundColor: accent + '22', fill: true, tension: 0.25,
    pointRadius: rows.length > 60 ? 0 : 2, borderWidth: 2, spanGaps: true
  }];

  chart = new Chart(ctx, {
    type: 'line',
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

  let statsHtml = `<div class="stat"><div class="k">Titik data</div><div class="v">${rows.length}</div></div>`;
  statsHtml += statCardsHtml('', vals, ds.unit);
  const valid = vals.filter(v => v !== null && v !== undefined);
  const lastForGauge = valid[valid.length - 1];
  document.getElementById('statsRow').innerHTML = statsHtml;

  const gaugeWrap = document.querySelector('.gauge-wrap');
  if (ds.minHist !== undefined && lastForGauge !== undefined && lastForGauge !== null) {
    gaugeWrap.style.display = 'flex';
    const pct = Math.min(1, Math.max(0, (lastForGauge - ds.minHist) / (ds.maxHist - ds.minHist)));
    document.getElementById('gaugeFill').style.height = (pct * 100) + '%';
    document.getElementById('gaugeValue').textContent = lastForGauge.toLocaleString('id-ID', { maximumFractionDigits: 0 }) + ' ' + ds.unit;
  } else {
    gaugeWrap.style.display = 'none';
  }

  const head = document.getElementById('tableHead');
  const body = document.getElementById('tableBody');
  head.innerHTML = `<th>Bulan</th><th>${ds.label} (${ds.unit})</th>`;
  body.innerHTML = rows.slice(-60).reverse().map(r => {
    const v = r.value;
    return `<tr><td>${dateStrDisplay(r.date)}</td><td>${v !== null && v !== undefined ? v.toLocaleString('id-ID', { maximumFractionDigits: 0 }) : '-'}</td></tr>`;
  }).join('');
}

// ---------------------------------------------------------------------------
// RENDER — Rekapitulasi (tabel pivot instalasi x bulan)
// ---------------------------------------------------------------------------
function rekapPivotForYear(rk, year) {
  const rowsOfYear = rk.data.filter(r => r.date.getFullYear() === year);
  const byMonth = {};
  rowsOfYear.forEach(r => { byMonth[r.date.getMonth() + 1] = r; });

  const monthTotals = new Array(12).fill(0);
  const monthHas = new Array(12).fill(false);

  const wellRows = rk.wells.map(w => {
    const values = MONTHS_ID.map((_, i) => {
      const r = byMonth[i + 1];
      const v = r ? r.values[w.colName] : null;
      if (v !== null && v !== undefined) { monthTotals[i] += v; monthHas[i] = true; }
      return v;
    });
    return { label: w.label, values };
  });

  const totalRow = monthTotals.map((t, i) => (monthHas[i] ? t : null));
  return { wellRows, totalRow };
}

// Grafik "Jumlah" di dalam Rekapitulasi: diagram batang 12 bulan tahun aktif,
// nilainya diambil LANGSUNG dari totalRow tabel pivot di bawahnya, jadi grafik
// dan tabel mustahil beda angka. Periodenya ikut chip tahun seperti grafik di
// tampilan lain -- tidak ada saklar lingkup sendiri.
//
// Sumbu Y grafik rekap sengaja TIDAK mulai dari nol. Total sebulan ada di
// kisaran jutaan m³ sementara selisih antar bulannya cuma ratusan ribu, jadi
// kalau dasarnya nol semua batang terlihat sama tinggi dan naik-turunnya
// hilang -- padahal justru itu yang dicari orang waktu membuka rekap.
//
// Konsekuensinya batang jadi terpotong, dan panjang batang tidak lagi
// sebanding dengan nilainya. Itu sebabnya keterangan di bawah judul grafik
// menyebutkan dasar sumbunya secara eksplisit: yang membaca harus tahu bahwa
// batang dua kali lebih tinggi bukan berarti airnya dua kali lebih banyak.
//
// Batas sumbu dibulatkan ke angka bulat, bukan ke nilai data mentah -- label
// sumbu seperti "1.213.947" tidak ada gunanya dibaca. Langkah pembulatannya
// satu tingkat di bawah besaran nilainya:
//
//   AP,  data 1.260.066 - 1.644.385 -> ratusan ribu -> 1.200.000 - 1.700.000
//   ATD, data   153.525 -   188.734 -> puluhan ribu ->   150.000 -   190.000
//
// Diturunkan dari jumlah digit, jadi aturan yang sama berlaku sendirinya untuk
// besaran lain kalau suatu saat ada instalasi yang jauh lebih kecil/besar.
function langkahPembulatan(acuan) {
  const n = Math.abs(acuan);
  if (!isFinite(n) || n === 0) return 1;
  return Math.pow(10, Math.max(Math.floor(Math.log10(n)) - 1, 0));
}

// `langkahDipaksa` = jarak garis bantu yang disetel di DATA_SOURCES
// (rekapTickStep). Kalau ada, dia yang jadi langkah pembulatan sekaligus,
// bukan sekadar dipasang sebagai stepSize di Chart.js. Harus begitu: Chart.js
// mengabaikan stepSize kalau rentangnya tidak habis dibagi angka itu, lalu
// diam-diam membagi rata sendiri -- batas 1.100.000-1.700.000 dengan step
// 250.000 keluarnya malah berjarak 300.000, dan 130.000-200.000 dengan step
// 25.000 keluar 23.333. Dengan batasnya ikut dibulatkan ke kelipatan step,
// tiap garis bantu dijamin jatuh di angka bulat dan jaraknya persis.
function rekapYRange(values, langkahDipaksa) {
  const valid = values.filter(v => v !== null && v !== undefined);
  if (!valid.length) return {};
  const dataMin = Math.min(...valid);
  const dataMax = Math.max(...valid);
  const langkah = langkahDipaksa || langkahPembulatan(dataMax);

  let min = Math.floor(dataMin / langkah) * langkah;
  let max = Math.ceil(dataMax / langkah) * langkah;

  // Pembulatan itu sendiri yang memberi ruang lega, jadi tidak perlu lagi
  // ditambah persentase. Tapi kalau nilainya kebetulan jatuh pas di kelipatan
  // -- termasuk kasus semua bulan sama persis, yang rentangnya nol -- batasnya
  // digeser satu langkah supaya batang terendah tidak rata dengan dasar dan
  // yang tertinggi tidak menempel atap.
  if (min === dataMin) min -= langkah;
  if (max === dataMax) max += langkah;

  return { min: Math.max(0, min), max };
}

// Seri yang digambar grafik rekap, mengikuti chip tahun persis seperti
// tampilan lain:
//   chip tahun     -> 12 bulan tahun itu, diambil dari totalRow tabel pivot
//                     di bawahnya, jadi grafik dan tabel mustahil beda angka.
//   "Semua Data"   -> seluruh bulan lintas tahun.
//
// Tabelnya sendiri tidak bisa ikut "Semua Data" -- bentuknya pivot instalasi
// x 12 bulan, jadi cuma muat satu tahun dan tetap menampilkan tahun terbaru.
// Keterangan di bawah judul grafik menyebutkan hal ini supaya tidak dikira
// tabelnya yang salah.
// Total seluruh instalasi per bulan untuk SEMUA tahun, urut waktu. Dipakai dua
// kali: sebagai seri "Semua Data", dan sebagai dasar rentang sumbu Y.
function rekapBarisTotal(rk) {
  return rk.data.slice().sort((a, b) => a.date - b.date).map(r => {
    let jumlah = 0;
    let ada = false;
    rk.wells.forEach(w => {
      const v = r.values[w.colName];
      if (v !== null && v !== undefined) { jumlah += v; ada = true; }
    });
    return { date: r.date, value: ada ? jumlah : null };
  });
}

function rekapSeries(rk, semuaBulan) {
  if (filterMode === 'all') {
    return {
      type: 'line',
      labels: semuaBulan.map(r => dateStrDisplay(r.date)),
      values: semuaBulan.map(r => r.value),
      lintasTahun: true
    };
  }
  const { totalRow } = rekapPivotForYear(rk, rekapActiveYear());
  return { type: 'bar', labels: MONTHS_ID.slice(), values: totalRow, lintasTahun: false };
}

// Batang untuk satu tahun (12 titik, tingginya enak dibandingkan antar bulan),
// garis untuk seluruh riwayat (puluhan titik -- kalau dibatangkan jadi terlalu
// rapat, dan yang dicari di situ trennya, bukan nilai per bulan).
//
// `skala` datang dari luar, bukan dihitung dari `values`, karena rentangnya
// dikunci sama untuk semua tahun -- lihat renderRekapChart.
// `judul` cuma dipakai versi PDF: keterangan itu ikut tercetak DI DALAM
// gambarnya, jadi tidak bisa terpisah dari grafiknya waktu berkasnya beredar.
function rekapChartConfig({ type, labels, values, label, skala, judul }, responsive) {
  const accent = '#0B5566';
  const garis = type === 'line';
  return {
    type,
    data: {
      labels,
      datasets: [{
        label,
        data: values,
        borderColor: accent,
        backgroundColor: garis ? accent + '22' : accent + 'CC',
        fill: garis,
        tension: garis ? 0.25 : 0,
        pointRadius: 0,
        spanGaps: garis,
        borderWidth: 2,
        borderRadius: garis ? 0 : 4
      }]
    },
    options: {
      responsive, maintainAspectRatio: false,
      animation: responsive ? undefined : false,
      plugins: {
        legend: { display: false },
        title: judul ? {
          display: true, text: judul, align: 'start',
          color: '#4C6870', font: { family: 'Inter', size: 13, weight: '500' },
          padding: { top: 0, bottom: 10 }
        } : { display: false }
      },
      scales: {
        x: { ticks: { maxTicksLimit: 12, font: { family: 'IBM Plex Mono', size: 10 } }, grid: { display: false } },
        y: {
          beginAtZero: false, min: skala.min, max: skala.max,
          ticks: {
            stepSize: skala.step,
            font: { family: 'IBM Plex Mono', size: 11 },
            callback: v => fmtNum(v)
          },
          grid: { color: '#E3EEF0' }
        }
      }
    }
  };
}

function renderRekapChart() {
  const rk = currentRekap();
  const year = rekapActiveYear();
  const semuaBulan = rekapBarisTotal(rk);
  const series = rekapSeries(rk, semuaBulan);
  const { values, lintasTahun } = series;

  // Rentang sumbu dihitung dari SELURUH tahun, bukan dari tahun yang sedang
  // tampil. Kalau tiap tahun punya sumbunya sendiri, batang setinggi setengah
  // grafik di 2021 dan di 2025 bisa mewakili angka yang jauh berbeda -- orang
  // membandingkan tinggi batang antar tab tanpa membaca ulang sumbunya. Dengan
  // dikunci, tinggi batang berarti hal yang sama di semua tahun.
  //
  // Harganya: tahun yang rentangnya sempit tidak dizoom sendiri, jadi
  // batangnya lebih rata daripada kalau sumbunya per tahun.
  const skala = { ...rekapYRange(semuaBulan.map(r => r.value), rk.tickStep), step: rk.tickStep };

  const periode = lintasTahun
    ? `seluruh riwayat (${rk.unit}) — tabel di bawah tetap menampilkan tahun ${year}, karena bentuknya cuma muat satu tahun.`
    : `tahun ${year} (${rk.unit}) — sama dengan baris "Jumlah" di tabel bawah.`;
  document.getElementById('rekapChartGroup').textContent = rk.categoryLabel;
  document.getElementById('rekapChartNote').textContent =
    `Total seluruh instalasi per bulan, ${periode}` +
    (skala.min ? ` Sumbu Y ${fmtNum(skala.min)}–${fmtNum(skala.max)}, dikunci sama untuk semua tahun (tidak mulai dari nol) supaya tinggi batang bisa dibandingkan antar tahun.` : '');

  const ctx = document.getElementById('rekapChart').getContext('2d');
  if (rekapChart) rekapChart.destroy();
  rekapChart = new Chart(ctx, rekapChartConfig(
    { ...series, skala, label: `Jumlah — ${rk.categoryLabel}` }, true
  ));

  const valid = values.filter(v => v !== null && v !== undefined);
  const jumlah = valid.reduce((a, b) => a + b, 0);
  const rata = valid.length ? Math.round(jumlah / valid.length) : null;
  document.getElementById('rekapStatsRow').innerHTML = `
    <div class="stat"><div class="k">${lintasTahun ? 'Total keseluruhan' : 'Total setahun'}</div><div class="v">${fmtNum(valid.length ? jumlah : null)} ${rk.unit}</div></div>
    <div class="stat"><div class="k">Rata-rata / bulan</div><div class="v">${fmtNum(rata)} ${rk.unit}</div></div>
    <div class="stat"><div class="k">Bulan tertinggi</div><div class="v">${fmtNum(valid.length ? Math.max(...valid) : null)} ${rk.unit}</div></div>
    <div class="stat"><div class="k">Bulan terendah</div><div class="v">${fmtNum(valid.length ? Math.min(...valid) : null)} ${rk.unit}</div></div>
    <div class="stat"><div class="k">Bulan tercatat</div><div class="v">${lintasTahun ? `${valid.length} bulan` : `${valid.length} / 12`}</div></div>
  `;
}

function renderRekapView() {
  setViewMode('rekap');
  const rk = currentRekap();
  const year = rekapActiveYear();
  // Saat "Semua Data": grafiknya lintas tahun, tabelnya tetap tahun terbaru.
  // Labelnya menyebut keduanya supaya tidak dikira tabelnya yang tidak ikut.
  rangeLabelEl.textContent = filterMode === 'all'
    ? `Semua Data (tabel: tahun ${year})`
    : `Tahun ${year}`;

  const { wellRows, totalRow } = rekapPivotForYear(rk, year);
  renderRekapChart();

  const head = document.getElementById('rekapHead');
  head.innerHTML = `<th>Instalasi</th>` + MONTHS_ID.map(m => `<th>${m}</th>`).join('');

  const body = document.getElementById('rekapBody');
  let html = wellRows.map(row => {
    const cells = row.values.map(v => `<td>${fmtNum(v)}</td>`).join('');
    return `<tr><td><b>${row.label}</b></td>${cells}</tr>`;
  }).join('');
  const totalCells = totalRow.map(v => `<td><b>${fmtNum(v)}</b></td>`).join('');
  html += `<tr class="rekap-total-row"><td><b>Jumlah</b></td>${totalCells}</tr>`;
  body.innerHTML = html;
}

function render() {
  if (isRekapActive()) {
    renderRekapView();
  } else {
    renderChartView();
  }
}

// ---------------------------------------------------------------------------
// UNDUH EXCEL (Admin, via SheetJS)
// ---------------------------------------------------------------------------
function downloadExcel() {
  if (!isAdmin) {
    alert('Unduh Excel khusus admin. Silakan login admin terlebih dahulu.');
    window.location.href = '../../login.html';
    return;
  }
  if (isRekapActive()) {
    downloadRekapExcel();
    return;
  }
  const ds = currentDataset();
  const rows = filteredData();
  const header = ['Bulan', `${ds.label} (${ds.unit})`];
  const body = rows.map(r => [monthLabelLong(r.date), r.value ?? '']);

  const ws = XLSX.utils.aoa_to_sheet([header, ...body]);
  ws['!cols'] = header.map((h, i) => ({ wch: Math.max(14, h.length + 2, i === 0 ? 18 : 10) }));
  const wb = XLSX.utils.book_new();
  const namaSheet = ds.label.substring(0, 31);
  XLSX.utils.book_append_sheet(wb, ws, namaSheet);

  const rangePart = filterMode === 'all' ? 'semua-data' : `${selectedYear}`;
  const namaBerkas = `${currentKey}_${rangePart}.xlsx`;

  // Sheet ini dua kolom (label di A, nilai di B), jadi bisa langsung
  // digrafikkan sebagai satu seri garis. Kalau perakitan grafiknya gagal --
  // JSZip tidak termuat, datanya cuma satu baris, dsb -- berkasnya tetap
  // diunduh apa adanya lewat SheetJS. Data lebih penting daripada grafik.
  tulisExcelBergrafik(wb, namaBerkas, {
    namaSheet,
    judul: `${ds.label} (${ds.unit})`,
    jumlahBaris: body.length
  });
}

function tulisExcelBergrafik(wb, namaBerkas, opsiGrafik) {
  if (!window.XlsxGrafik || typeof JSZip === 'undefined') {
    XLSX.writeFile(wb, namaBerkas);
    return;
  }
  let buf;
  try {
    buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  } catch (err) {
    XLSX.writeFile(wb, namaBerkas);
    return;
  }
  XlsxGrafik.tempelGrafikGaris(buf, opsiGrafik)
    .then(blob => XlsxGrafik.unduhBlob(blob, namaBerkas))
    .catch(err => {
      console.error('Grafik gagal dirakit, Excel diunduh tanpa grafik', err);
      XLSX.writeFile(wb, namaBerkas);
    });
}

function downloadRekapExcel() {
  const rk = currentRekap();
  const years = yearsInData(rk.data);
  const yearsToExport = (filterMode === 'year' && selectedYear) ? [selectedYear] : years;

  const wb = XLSX.utils.book_new();
  yearsToExport.forEach(year => {
    const { wellRows, totalRow } = rekapPivotForYear(rk, year);
    const header = ['Instalasi', ...MONTHS_ID];
    const body = wellRows.map(row => [row.label, ...row.values.map(v => v ?? '')]);
    body.push(['Jumlah', ...totalRow.map(v => v ?? '')]);
    const ws = XLSX.utils.aoa_to_sheet([header, ...body]);
    ws['!cols'] = header.map((h, i) => ({ wch: i === 0 ? 20 : 10 }));
    XLSX.utils.book_append_sheet(wb, ws, `${year}`.substring(0, 31));
  });

  const rangePart = (filterMode === 'year' && selectedYear) ? `${selectedYear}` : 'semua-tahun';
  XLSX.writeFile(wb, `rekapitulasi_${currentKey.replace('_rekap', '')}_${rangePart}.xlsx`);
}

// ---------------------------------------------------------------------------
// UNDUH PDF — digenerate di SERVER (pdf-lib) dari data asli, hanya kalau ada
// akses valid (JWT admin situs, atau token viz-access).
//
// Grafiknya ikut: Chart.js sudah menggambarnya di canvas halaman ini, jadi
// hasil canvas itu yang dikirim ke server sebagai PNG untuk disisipkan di
// atas tabel -- server tidak perlu menggambar ulang. Karena gambarnya harus
// ikut terkirim, unduhannya lewat POST + blob, bukan lagi mengarahkan alamat
// browser seperti dulu.
// ---------------------------------------------------------------------------
// Grafik rekap untuk PDF digambar ULANG di kanvas lepas, tidak mengambil yang
// di layar, walaupun ISINYA sama dengan yang tampil. Alasannya ukuran: kanvas
// lepas dipatok 3,4:1, sementara yang di layar ikut lebar jendela -- unduhan
// dari HP tanpa ini menghasilkan grafik jangkung yang memakan setengah halaman
// lanskap.
//
// Waktu chip-nya "Semua Data", grafiknya garis lintas tahun dan tabel di PDF
// dipecah jadi satu halaman per tahun. Grafiknya cuma menempel di halaman
// pertama, yang tabelnya tahun paling awal -- gampang dikira grafik tahun itu
// saja. Karena itu cakupannya ditulis DI DALAM gambar grafiknya: ikut ke mana
// pun berkasnya diteruskan, tidak bisa terpisah seperti kalau ditaruh di badan
// halaman.
const PDF_CHART_W = 1100;
const PDF_CHART_H = 320;

function grafikRekapPngPdf() {
  const rk = currentRekap();
  const semuaBulan = rekapBarisTotal(rk);
  const series = rekapSeries(rk, semuaBulan);
  const canvas = document.createElement('canvas');
  canvas.width = PDF_CHART_W;
  canvas.height = PDF_CHART_H;
  const c = new Chart(canvas.getContext('2d'), rekapChartConfig({
    ...series,
    // Sumbu terkunci yang sama dengan di layar, jadi PDF tahun yang berbeda
    // pun bisa ditaruh bersebelahan dan tinggi batangnya tetap sebanding.
    skala: { ...rekapYRange(semuaBulan.map(r => r.value), rk.tickStep), step: rk.tickStep },
    label: `Jumlah — ${rk.categoryLabel}`,
    judul: series.lintasTahun
      ? `Grafik: seluruh riwayat ${series.labels[0]} – ${series.labels[series.labels.length - 1]}  ·  tabel dipecah per tahun, satu halaman tiap tahun`
      : null
  }, false));
  try {
    c.update('none');
    c.draw();
    return c.toBase64Image('image/png', 1);
  } finally {
    c.destroy();
  }
}

function grafikPng() {
  // Dua tampilan sama-sama punya grafik sekarang: seri per instalasi
  // (#mainChart) dan Rekapitulasi (#rekapChart).
  if (isRekapActive()) {
    if (!rekapChart) return null;
    try {
      return grafikRekapPngPdf();
    } catch (err) {
      console.error('Grafik rekap gagal diambil, PDF diunduh tanpa grafik', err);
      return null;
    }
  }
  const c = chart;
  if (!c) return null;
  try {
    // Jangan langsung toBase64Image(). Chart.js menggambar lewat animation
    // frame, jadi isi canvas bisa belum ada (PNG putih polos) atau masih di
    // tengah animasi (garis datanya rata di nol) waktu tombol ditekan.
    //   update('none') -> tetapkan geometri elemen ke nilai akhir, tanpa animasi
    //   draw()         -> lukis nilai itu SEKARANG, tidak menunggu frame
    // Dua-duanya sinkron dan tidak mengubah data yang ditampilkan.
    c.update('none');
    c.draw();
    return c.toBase64Image('image/png', 1);
  } catch (err) {
    console.error('Grafik gagal diambil, PDF diunduh tanpa grafik', err);
    return null;
  }
}

function namaFileDariHeader(res, cadangan) {
  const cd = res.headers.get('content-disposition') || '';
  const m = cd.match(/filename=([^;]+)/i);
  return m ? m[1].trim().replace(/^"|"$/g, '') : cadangan;
}

async function downloadPdf() {
  const token = currentAccessToken();
  if (!token) {
    alert('Unduh PDF perlu akses data asli dulu. Klik "Minta Akses" di atas untuk meminta persetujuan admin.');
    return;
  }

  const params = new URLSearchParams();
  params.set('dataType', currentGroup);
  params.set('token', token);

  if (isRekapActive()) {
    params.set('mode', 'rekap');
    // "Semua Data" -> server mengeluarkan tabel SEMUA tahun, satu halaman per
    // tahun. Kalau di sini dikirim satu tahun saja (dulu begitu), PDF-nya cuma
    // memuat tahun terbaru padahal grafiknya lintas tahun.
    params.set('year', filterMode === 'all' ? 'all' : rekapActiveYear());
  } else {
    params.set('mode', 'series');
    params.set('well', (KEY_TO_COLNAME[currentKey] || '').toLowerCase());
    if (filterMode === 'year' && selectedYear) params.set('year', selectedYear);
  }

  const btn = document.getElementById('downloadPdfBtn');
  const labelAsli = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = 'Menyiapkan PDF...'; }

  try {
    const png = grafikPng();
    const res = await fetch(`/api/visualization/export-pdf?${params.toString()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(png ? { chartPng: png } : {})
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      throw new Error(d.error || `HTTP ${res.status}`);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = namaFileDariHeader(res, `${currentKey}.pdf`);
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    alert('Gagal menyiapkan PDF: ' + err.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = labelAsli; }
  }
}

// ---------------------------------------------------------------------------
// STATUS ADMIN (gating tombol Unduh Excel)
// --------------------------------------------------------------------------
// Disesuaikan persis dengan pola login.html/admin-dashboard.html asli:
// token disimpan di localStorage dengan key "token", role dengan key "role".
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
// token 4 jam habis. Site-wide: token disimpan di localStorage (key
// vizAccessToken/vizAccessExpiresAt/vizRequestId) supaya sama dan otomatis
// dikenali oleh apps/library/app.js juga.
// ---------------------------------------------------------------------------
function updateLockBanner(locked) {
  const banner = document.getElementById('lockBanner');
  const statusText = document.getElementById('lockStatusText');
  if (!banner) return;
  if (!locked || isAdmin) { banner.style.display = 'none'; return; }
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

function currentGroupLabel(group) {
  const g = GROUPS.find(x => x.key === group);
  return g ? g.label : (group || 'ini');
}

function openAccessModal() {
  modalGroup = currentGroup;
  const overlay = document.getElementById('accessModalOverlay');
  if (!overlay) return;
  const groupNameEl = document.getElementById('accessModalGroupName');
  if (groupNameEl) groupNameEl.textContent = currentGroupLabel(modalGroup);
  overlay.style.display = 'flex';
  const status = document.getElementById('accessModalStatus');
  status.textContent = '';
  status.className = 'status-msg';
}

function closeAccessModal() {
  const overlay = document.getElementById('accessModalOverlay');
  if (overlay) overlay.style.display = 'none';
}

function setAccessModalStatus(msg, cls) {
  const el = document.getElementById('accessModalStatus');
  if (!el) return;
  el.textContent = msg;
  el.className = 'status-msg ' + (cls || '');
}

// Tombol darurat: buka WhatsApp admin dengan pesan otomatis, tidak
// menyentuh database sama sekali (tidak wajib isi nama dulu).
const ADMIN_WHATSAPP_NUMBER = '6281381146320';

function openWhatsappChat() {
  // window.open() harus jadi statement PERTAMA yang jalan di handler ini --
  // dipanggil kosong dulu (tab blank langsung terbuka selagi masih dalam
  // konteks klik user), baru URL wa.me yang sebenarnya di-set belakangan.
  // Kalau window.open dipanggil belakangan dengan URL yang baru selesai
  // dirangkai (butuh baca DOM + encodeURIComponent dulu), sebagian browser/
  // popup blocker tidak lagi menganggapnya sebagai hasil klik langsung dan
  // diam-diam memblokirnya -- persis gejala "diklik tapi tidak terjadi apa-apa".
  const win = window.open('', '_blank');

  const nama = document.getElementById('accessNamaInput').value.trim();
  const groupLabel = currentGroupLabel(modalGroup);
  const namaPart = nama ? ` ${nama}` : '';
  const message = `Halo, saya${namaPart} baru saja mengirim permintaan akses data ${groupLabel} di website, mohon persetujuannya.`;
  // Format wa.me resmi (bukan skema whatsapp://) -- otomatis fallback ke
  // web.whatsapp.com kalau device tidak punya app WhatsApp terinstall.
  const url = `https://wa.me/${ADMIN_WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;

  if (win) win.location.href = url;
  else window.open(url, '_blank'); // fallback kalau tab pertama tetap diblokir
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
      body: JSON.stringify({ requestedBy: nama, dataType: currentGroup, reason: alasan || undefined })
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'Gagal mengirim permintaan.');

    vizRequestId = data.requestId;
    vizRequestSecret = data.pollSecret;
    try { localStorage.setItem('vizRequestId', String(vizRequestId)); localStorage.setItem('vizRequestSecret', String(vizRequestSecret || '')); } catch (e) {}

    setAccessModalStatus('Permintaan terkirim. Menunggu admin menyetujui lewat email — halaman ini akan otomatis update.', 'pending');
    startPolling();
  } catch (err) {
    setAccessModalStatus(err.message, 'error');
  }
  btn.disabled = false;
}

function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  updateLockBanner(true);
  pollTimer = setInterval(checkAccessStatus, 4000);
  checkAccessStatus();
}

async function checkAccessStatus() {
  if (!vizRequestId || !vizRequestSecret) return;
  try {
    const res = await fetch(`/api/visualization/status?id=${vizRequestId}&secret=${encodeURIComponent(vizRequestSecret || '')}`);
    const data = await res.json();

    if (data.status === 'approved') {
      clearInterval(pollTimer);
      pollTimer = null;
      vizToken = data.token;
      vizTokenExpiresAt = data.expiresAt;
      try {
        localStorage.setItem('vizAccessToken', vizToken);
        localStorage.setItem('vizAccessExpiresAt', vizTokenExpiresAt);
        localStorage.removeItem('vizRequestId'); localStorage.removeItem('vizRequestSecret');
      } catch (e) {}
      scheduleTokenExpiry();
      setAccessModalStatus('Akses disetujui! Memuat data asli...', 'ok');
      await reloadAllGroupsData();
      closeAccessModal();
    } else if (data.status === 'expired' || data.status === 'not_found') {
      clearInterval(pollTimer);
      pollTimer = null;
      vizRequestId = null; vizRequestSecret = null;
      try { localStorage.removeItem('vizRequestId'); localStorage.removeItem('vizRequestSecret'); } catch (e) {}
      updateLockBanner(true);
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
    reloadAllGroupsData();
  }, Math.max(ms, 0));
}

// Kalau ada token viz-access yang masih berlaku (dari sesi sebelumnya di tab
// yang sama), atau ada permintaan yang masih pending, lanjutkan otomatis
// tanpa perlu request baru.
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
    const pendingSecret = localStorage.getItem('vizRequestSecret');
    if (pendingId && pendingSecret) {
      vizRequestId = pendingId; vizRequestSecret = pendingSecret;
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
  buildMenuSub();
  buildMenuAgg();
  wireControls();
  checkAdminStatus();
  restoreVizSession();
  // Cuma grup pertama (Air Permukaan) yang di-fetch saat halaman dibuka.
  // Grup ATD baru di-fetch saat tab-nya diklik (lihat selectDataset). Ini
  // yang bikin loading pertama jauh lebih cepat dibanding fetch AP+ATD
  // sekaligus di awal.
  await selectDataset(currentKey);
}

init();
