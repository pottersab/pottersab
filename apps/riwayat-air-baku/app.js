/* ==========================================================================
   Data Historis Pengambilan Air Baku
   --------------------------------------------------------------------------
   Pola & tampilan sengaja dibuat sama persis dengan app "Library" yang
   sudah jalan (apps/library) — menu utama -> sub menu -> grafik+gauge ->
   stat cards -> tabel. Bedanya: sumbernya monthly (bukan harian), ada
   submenu "Rekapitulasi" (tabel pivot instalasi x bulan per tahun), dan
   dua tombol unduh (PDF untuk tamu, Excel khusus admin).

   Sumber data (sementara): file CSV di folder ./data. Untuk mengubah data
   historis, edit file CSV yang bersangkutan.

   NANTI: kalau aplikasi input data sudah jadi, ganti fungsi loadAllData()
   supaya fetch dari API-mu alih-alih file CSV statis. Struktur `datasets`
   dan `REKAP_TABLES` yang dipakai render() dkk sebaiknya dipertahankan sama.

   PENTING soal tombol "Unduh Excel (Admin)":
   Saya tidak punya isi login.html / api/verify.js yang sebenarnya, jadi
   fungsi checkAdminStatus() di bawah saya buat dengan asumsi:
     - Token admin disimpan di localStorage dengan key "adminToken"
     - GET /api/verify dengan header Authorization: Bearer <token>
       membalas JSON { valid: true } atau { role: "admin" } kalau sah
   Sesuaikan fungsi checkAdminStatus() saja kalau ternyata beda.
   ========================================================================== */

// ---------------------------------------------------------------------------
// KONFIGURASI MENU (menu utama -> sub menu)
// ---------------------------------------------------------------------------
const GROUPS = [
  { key: 'ap', label: 'Air Permukaan (AP)', wellTabs: ['ap_teritip', 'ap_kampung_damai', 'ap_batu_ampar', 'ap_km12', 'ap_gunung_tembak'], aggTabs: ['ap_total', 'ap_rekap'] },
  { key: 'atd', label: 'Air Tanah Dalam (ATD)', wellTabs: ['atd_kampung_damai', 'atd_gunung_sari', 'atd_prapatan', 'atd_zamp', 'atd_kampung_baru_ulu'], aggTabs: ['atd_total', 'atd_rekap'] }
];

function allTabsOf(group) {
  return [...group.wellTabs, ...group.aggTabs];
}

function keyIsAvailable(k) {
  return !!(datasets[k] || REKAP_TABLES[k]);
}

// ---------------------------------------------------------------------------
// KONFIGURASI SUMBER DATA
// ---------------------------------------------------------------------------
const DATA_SOURCES = [
  {
    file: 'https://script.google.com/macros/s/AKfycbz_7JO5J0KybOq0eUXAquUEJv204tuv8C-oQdHWU--YShiG7UxQGXtHHUerem9qhFZCzA/exec?sheet=AP',
    dateColumn: 'Bulan',
    totalKey: 'ap_total',
    totalLabel: 'Jumlah — Air Permukaan (AP)',
    rekapKey: 'ap_rekap',
    rekapCategoryLabel: 'Air Permukaan (AP)',
    columns: {
      Teritip: { key: 'ap_teritip', label: 'Debit AP — Teritip', unit: 'm³', color: 'primary', hasGauge: true },
      Kampung_Damai: { key: 'ap_kampung_damai', label: 'Debit AP — Kampung Damai', unit: 'm³', color: 'primary', hasGauge: true },
      Batu_Ampar: { key: 'ap_batu_ampar', label: 'Debit AP — Batu Ampar', unit: 'm³', color: 'primary', hasGauge: true },
      Km_12: { key: 'ap_km12', label: 'Debit AP — Kilometer 12', unit: 'm³', color: 'primary', hasGauge: true },
      Gunung_Tembak: { key: 'ap_gunung_tembak', label: 'Debit AP — Gunung Tembak', unit: 'm³', color: 'primary', hasGauge: true }
    }
  },
  {
    file: 'https://script.google.com/macros/s/AKfycbz_7JO5J0KybOq0eUXAquUEJv204tuv8C-oQdHWU--YShiG7UxQGXtHHUerem9qhFZCzA/exec?sheet=ATD',
    dateColumn: 'Bulan',
    totalKey: 'atd_total',
    totalLabel: 'Jumlah — Air Tanah Dalam (ATD)',
    rekapKey: 'atd_rekap',
    rekapCategoryLabel: 'Air Tanah Dalam (ATD)',
    columns: {
      Kampung_Damai: { key: 'atd_kampung_damai', label: 'Debit ATD — Kampung Damai', unit: 'm³', color: 'primary', hasGauge: true },
      Gunung_Sari: { key: 'atd_gunung_sari', label: 'Debit ATD — Gunung Sari', unit: 'm³', color: 'primary', hasGauge: true },
      Prapatan: { key: 'atd_prapatan', label: 'Debit ATD — Prapatan', unit: 'm³', color: 'primary', hasGauge: true },
      Zamp: { key: 'atd_zamp', label: 'Debit ATD — Zamp', unit: 'm³', color: 'primary', hasGauge: true },
      Kampung_Baru_Ulu: { key: 'atd_kampung_baru_ulu', label: 'Debit ATD — Kampung Baru Ulu', unit: 'm³', color: 'primary', hasGauge: true }
    }
  }
];

const MONTHS_ID = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

// ---------------------------------------------------------------------------
// CSV PARSER
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
// LOAD DATA
// ---------------------------------------------------------------------------
async function fetchCSV(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Gagal memuat ${path} (HTTP ${res.status})`);
  return parseCSV(await res.text());
}

async function loadAllData() {
  const datasets = {};
  const loadErrors = [];

  for (const source of DATA_SOURCES) {
    let header, rows;
    try {
      ({ header, rows } = await fetchCSV(source.file));
    } catch (err) {
      console.error(`Gagal memuat ${source.file}:`, err);
      loadErrors.push(source.file);
      continue;
    }

    const perColSeries = {};
    const wellsForRekap = [];
    for (const colName of Object.keys(source.columns)) {
      if (!header.includes(colName)) {
        console.warn(`Kolom "${colName}" tidak ditemukan di ${source.file}, dilewati.`);
        continue;
      }
      const cfg = source.columns[colName];
      const series = rows
        .map(r => ({ date: new Date(r[source.dateColumn] + '-01T00:00:00'), value: toNum(r[colName]) }))
        .filter(r => !isNaN(r.date.getTime()));
      const ds = {
        label: cfg.label, unit: cfg.unit, type: 'daily', color: cfg.color,
        real: true, sourceFile: source.file, data: series
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

    // Dataset "Jumlah" (total semua instalasi dalam kategori ini)
    if (source.totalKey) {
      const dateSet = new Map();
      Object.values(perColSeries).forEach(series => {
        series.forEach(r => {
          const t = r.date.getTime();
          if (!dateSet.has(t)) dateSet.set(t, { date: r.date, sum: 0, any: false });
          const entry = dateSet.get(t);
          if (r.value !== null && r.value !== undefined) { entry.sum += r.value; entry.any = true; }
        });
      });
      const totalSeries = [...dateSet.values()]
        .sort((a, b) => a.date - b.date)
        .map(e => ({ date: e.date, value: e.any ? e.sum : null }));
      const totalDs = {
        label: source.totalLabel, unit: 'm³', type: 'daily', color: 'rain',
        real: true, sourceFile: source.file, data: totalSeries
      };
      const [mn, mx] = minMax(totalSeries);
      if (isFinite(mn) && isFinite(mx)) {
        totalDs.minHist = Math.floor(mn - Math.abs(mn) * 0.02);
        totalDs.maxHist = Math.ceil(mx + Math.abs(mx) * 0.02);
      }
      datasets[source.totalKey] = totalDs;
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
        sourceFile: source.file,
        wells: wellsForRekap,
        data: rekapRows
      };
    }
  }

  datasets.__loadErrors = loadErrors;
  return datasets;
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
let isAdmin = false;

const menuMainEl = document.getElementById('menuMain');
const menuSubEl = document.getElementById('menuSub');
const menuAggEl = document.getElementById('menuAgg');
const yearRowEl = document.getElementById('yearRow');
const rangeLabelEl = document.getElementById('rangeLabel');

function currentDataset() { return datasets[currentKey]; }
function isRekapActive() { return !!REKAP_TABLES[currentKey]; }
function currentRekap() { return REKAP_TABLES[currentKey]; }

// ---------------------------------------------------------------------------
// MENU (utama -> sub)
// ---------------------------------------------------------------------------
function buildMenuMain() {
  menuMainEl.innerHTML = '';
  GROUPS.filter(g => allTabsOf(g).some(k => keyIsAvailable(k))).forEach(g => {
    const btn = document.createElement('div');
    btn.className = 'menu-btn' + (g.key === currentGroup ? ' active' : '');
    btn.textContent = g.label;
    btn.onclick = () => {
      currentGroup = g.key;
      const group = GROUPS.find(x => x.key === g.key);
      currentKey = allTabsOf(group).find(k => keyIsAvailable(k)) || currentKey;
      resetFilter();
      buildMenuMain();
      buildMenuSub();
      buildMenuAgg();
      onDatasetChanged();
      render();
    };
    menuMainEl.appendChild(btn);
  });
}

function subMenuLabel(key) {
  if (REKAP_TABLES[key]) return 'Rekapitulasi';
  return datasets[key].label.replace(/^Debit (AP|ATD) — /, '').replace(/^Jumlah — .*/, 'Jumlah (Total)');
}

function buildMenuSub() {
  menuSubEl.innerHTML = '';
  const group = GROUPS.find(g => g.key === currentGroup);
  group.wellTabs.filter(k => keyIsAvailable(k)).forEach(key => {
    const btn = document.createElement('div');
    btn.className = 'submenu-pill' + (key === currentKey ? ' active' : '');
    btn.textContent = subMenuLabel(key);
    btn.onclick = () => {
      currentKey = key;
      resetFilter();
      buildMenuSub();
      buildMenuAgg();
      onDatasetChanged();
      render();
    };
    menuSubEl.appendChild(btn);
  });
}

function buildMenuAgg() {
  menuAggEl.innerHTML = '';
  const group = GROUPS.find(g => g.key === currentGroup);
  group.aggTabs.filter(k => keyIsAvailable(k)).forEach(key => {
    const btn = document.createElement('div');
    btn.className = 'category-pill' + (key === currentKey ? ' active' : '');
    btn.textContent = subMenuLabel(key);
    btn.onclick = () => {
      currentKey = key;
      resetFilter();
      buildMenuSub();
      buildMenuAgg();
      onDatasetChanged();
      render();
    };
    menuAggEl.appendChild(btn);
  });
}

function onDatasetChanged() {
  const badge = document.getElementById('statusBadge');
  const note = document.getElementById('noteBox');
  badge.textContent = 'Data Asli';
  badge.style.background = 'var(--good)';

  if (isRekapActive()) {
    const rk = currentRekap();
    note.innerHTML = `Rekapitulasi bulanan (Januari—Desember) tiap instalasi ${rk.categoryLabel} dalam satu tahun, diambil dari <code>${rk.sourceFile}</code> (satuan ${rk.unit}). Sel kosong berarti data belum tercatat pada bulan tersebut. Pilih tahun di atas untuk berpindah periode.`;
  } else {
    const ds = currentDataset();
    note.innerHTML = `Data diambil dari <code>${ds.sourceFile}</code> (satuan ${ds.unit}/bulan). Sel kosong berarti data belum tercatat pada bulan tersebut, bukan nol. Untuk menambah/mengoreksi data, edit file CSV terkait lalu muat ulang halaman ini.`;
  }
  buildYearRow();
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

function renderRekapView() {
  setViewMode('rekap');
  const rk = currentRekap();
  const year = rekapActiveYear();
  rangeLabelEl.textContent = `Tahun ${year}` + (filterMode === 'all' ? ' (terbaru)' : '');

  const { wellRows, totalRow } = rekapPivotForYear(rk, year);

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
  XLSX.utils.book_append_sheet(wb, ws, ds.label.substring(0, 31));

  const rangePart = filterMode === 'all' ? 'semua-data' : `${selectedYear}`;
  XLSX.writeFile(wb, `${currentKey}_${rangePart}.xlsx`);
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
// UNDUH PDF (Tamu, via jsPDF + autotable)
// ---------------------------------------------------------------------------
function downloadPdf() {
  if (isRekapActive()) {
    downloadRekapPdf();
    return;
  }
  const { jsPDF } = window.jspdf;
  const ds = currentDataset();
  const rows = filteredData();
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text('Data Historis Pengambilan Air Baku', 40, 40);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(`Perumda Tirta Manuntung — Sumber Air Baku  |  ${ds.label}  |  Rentang: ${currentRangeLabel()}`, 40, 58);

  try {
    const chartImg = document.getElementById('mainChart').toDataURL('image/png', 1.0);
    doc.addImage(chartImg, 'PNG', 40, 72, 560, 220);
  } catch (e) {
    console.warn('Gagal menyisipkan grafik ke PDF:', e);
  }

  const head = [['Bulan', `${ds.label} (${ds.unit})`]];
  const body = rows.map(r => [
    dateStrDisplay(r.date),
    r.value !== null && r.value !== undefined ? r.value.toLocaleString('id-ID', { maximumFractionDigits: 0 }) : '-'
  ]);

  doc.autoTable({
    head, body,
    startY: 305,
    styles: { font: 'helvetica', fontSize: 8, cellPadding: 4 },
    headStyles: { fillColor: [11, 85, 102], textColor: 255 },
    margin: { left: 40, right: 40 }
  });

  const rangePart = filterMode === 'all' ? 'semua-data' : `${selectedYear}`;
  doc.save(`${currentKey}_${rangePart}.pdf`);
}

function downloadRekapPdf() {
  const { jsPDF } = window.jspdf;
  const rk = currentRekap();
  const years = yearsInData(rk.data);
  const yearsToExport = (filterMode === 'year' && selectedYear) ? [selectedYear] : years;

  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });

  yearsToExport.forEach((year, idx) => {
    if (idx > 0) doc.addPage();
    const { wellRows, totalRow } = rekapPivotForYear(rk, year);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text('Data Historis Pengambilan Air Baku — Rekapitulasi', 40, 40);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(`Perumda Tirta Manuntung — Sumber Air Baku  |  ${rk.categoryLabel}  |  Tahun ${year}  |  Satuan ${rk.unit}`, 40, 58);

    const head = [['Instalasi', ...MONTHS_ID]];
    const body = wellRows.map(row => [row.label, ...row.values.map(fmtNum)]);
    body.push(['Jumlah', ...totalRow.map(fmtNum)]);
    const totalRowIndex = body.length - 1;

    doc.autoTable({
      head, body,
      startY: 78,
      styles: { font: 'helvetica', fontSize: 8, cellPadding: 5, halign: 'right' },
      columnStyles: { 0: { halign: 'left', fontStyle: 'bold', cellWidth: 110 } },
      headStyles: { fillColor: [11, 85, 102], textColor: 255 },
      didParseCell: (data) => {
        if (data.row.index === totalRowIndex) {
          data.cell.styles.fillColor = [220, 238, 241];
          data.cell.styles.fontStyle = 'bold';
        }
      },
      margin: { left: 40, right: 40 }
    });
  });

  const rangePart = (filterMode === 'year' && selectedYear) ? `${selectedYear}` : 'semua-tahun';
  doc.save(`rekapitulasi_${currentKey.replace('_rekap', '')}_${rangePart}.pdf`);
}

// ---------------------------------------------------------------------------
// STATUS ADMIN (gating tombol Unduh Excel)
// --------------------------------------------------------------------------
// Disesuaikan persis dengan pola login.html/admin-dashboard.html asli:
// token disimpan di localStorage dengan key "token", role dengan key "role".
// Tidak ada endpoint /api/verify di project ini — admin-dashboard.html pun
// hanya mengecek localStorage langsung, jadi di sini disamakan.
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
// INIT
// ---------------------------------------------------------------------------
function wireControls() {
  document.getElementById('downloadPdfBtn').onclick = downloadPdf;
  document.getElementById('downloadExcelBtn').onclick = downloadExcel;
}

async function init() {
  try {
    datasets = await loadAllData();
  } catch (err) {
    console.error(err);
    document.querySelector('.panel').innerHTML =
      `<div class="error-note">Gagal memuat data: ${err.message}<br>Pastikan file ini diakses lewat web server, dan folder <code>data/</code> ada di lokasi yang sama.</div>`;
    return;
  }

  const loadErrors = datasets.__loadErrors || [];
  delete datasets.__loadErrors;

  const validGroup = GROUPS.find(g => allTabsOf(g).some(k => keyIsAvailable(k)));
  if (!validGroup) {
    document.querySelector('.panel').innerHTML =
      `<div class="error-note">Tidak ada file data yang berhasil dimuat.<br>File yang gagal: ${loadErrors.map(f => `<code>${f}</code>`).join(', ') || '(tidak diketahui)'}</div>`;
    return;
  }

  currentGroup = validGroup.key;
  currentKey = allTabsOf(validGroup).find(k => keyIsAvailable(k));

  buildMenuMain();
  buildMenuSub();
  buildMenuAgg();
  onDatasetChanged();
  wireControls();
  render();
  checkAdminStatus();

  if (loadErrors.length > 0) {
    const warn = document.createElement('div');
    warn.className = 'error-note';
    warn.style.cssText = 'padding:12px 16px;margin-top:16px;text-align:left;';
    warn.innerHTML = `Sebagian file data gagal dimuat dan dilewati: ${loadErrors.map(f => `<code>${f}</code>`).join(', ')}.`;
    document.querySelector('.panel').appendChild(warn);
  }
}

init();
