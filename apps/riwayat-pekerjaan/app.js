/* ===========================================================================
   RIWAYAT PEKERJAAN SAB
   ---------------------------------------------------------------------------
   Rekap seluruh pekerjaan Sub Divisi Sumber Air Baku dalam satu halaman:
   pipa transmisi, pipa sumur, service sumur, dan pekerjaan lainnya.

   Data diambil dari /api/pekerjaan. Tiga tingkat akses, mekanismenya sama
   persis dengan apps/riwayat-air-baku dan apps/library -- token viz-access
   dipakai bersama (localStorage key vizAccessToken), jadi sekali admin
   menyetujui permintaan dari halaman mana pun, halaman ini ikut terbuka:

     publik  -> data CONTOH + banner "Minta Akses"
     viewer  -> token viz-access hasil approve email -> data asli
     admin   -> JWT login.html -> data asli + tombol Unduh CSV
   =========================================================================== */

const MONO = "'IBM Plex Mono', monospace";
const PALETTE = ['#0B5566', '#1C8CA0', '#8FC6CC', '#3E9B6F', '#D9A03B', '#4C6870', '#C6553D', '#A9C7CE'];

const BIDANG_LABEL = {
  transmisi: 'Pipa Transmisi',
  'pipa-sumur': 'Pipa Sumur',
  'service-sumur': 'Service Sumur',
  lainnya: 'Pekerjaan Lainnya'
};

const PER = 25;

let REC = [];
let isAdmin = false;
let locked = true;
let curBid = 'ringkasan';
let curGrp = '';
let page = 1;
let colorMap = {};
let charts = [];

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
const fmtDate = s => new Date(s + 'T00:00:00').toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
const cnt = (arr, f) => arr.reduce((m, r) => { const k = f(r); if (k || k === 0) m[k] = (m[k] || 0) + 1; return m; }, {});
const topN = (o, n) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n);

// ---------------------------------------------------------------------------
// KONFIGURASI PER BIDANG
// ---------------------------------------------------------------------------
// katOf menentukan kolom mana yang "ditonjolkan" di grafik komposisi & tren --
// beda per bidang karena yang menarik memang beda: material untuk pekerjaan
// pipa, jenis pekerjaan untuk service sumur & pekerjaan lainnya.
const BID = {
  ringkasan: {
    label: 'Ringkasan', match: null,
    katLabel: 'Bidang', katOf: r => BIDANG_LABEL[r.bidang] || r.bidang,
    diaLabel: null, du: null,
    stats: ['total', 'tahun', 'kat', 'lok'],
    cols: ['tahun', 'tanggal', 'no_ba', 'bidang', 'lokasi', 'kat'],
    caption: 'Seluruh pekerjaan dari empat bidang dalam satu daftar.'
  },
  transmisi: {
    label: 'Pipa Transmisi', match: 'transmisi',
    katLabel: 'Jenis Pipa', katOf: r => r.material || 'Tidak Dicatat',
    diaLabel: 'Diameter Pipa', du: 'mm',
    stats: ['total', 'tahun', 'kat', 'lok'],
    cols: ['tahun', 'tanggal', 'no_ba', 'instalasi', 'lokasi', 'dia', 'kat'],
    caption: 'Perbaikan jalur pipa transmisi air baku menuju instalasi pengolahan.'
  },
  'pipa-sumur': {
    label: 'Pipa Sumur', match: 'pipa-sumur',
    katLabel: 'Material Pipa', katOf: r => r.material || 'Tidak Dicatat',
    diaLabel: 'Diameter Pipa', du: 'inch',
    stats: ['total', 'tahun', 'kat', 'lok'],
    cols: ['tahun', 'tanggal', 'no_ba', 'instalasi', 'lokasi', 'dia', 'uraian'],
    caption: 'Pekerjaan pipa pada sumur dalam — pengelasan, penggantian, dan penyambungan pipa.'
  },
  'service-sumur': {
    label: 'Service Sumur', match: 'service-sumur',
    katLabel: 'Jenis Pekerjaan', katOf: r => r.jenis || 'Tidak Dicatat',
    diaLabel: null, du: null,
    stats: ['total', 'tahun', 'kat', 'lok'],
    cols: ['tahun', 'tanggal', 'no_ba', 'instalasi', 'lokasi', 'kat', 'uraian'],
    caption: 'Pekerjaan pompa, service, dan sarana penunjang pada sumur dalam.'
  },
  lainnya: {
    label: 'Pekerjaan Lainnya', match: 'lainnya',
    katLabel: 'Kategori', katOf: r => r.jenis || 'Tidak Dicatat',
    diaLabel: null, du: null,
    stats: ['total', 'tahun', 'kat'],
    cols: ['tahun', 'tanggal', 'no_ba', 'kat', 'lokasi', 'uraian', 'keterangan'],
    caption: 'Pekerjaan waduk, intake, instalasi pengolahan, valve, dan sarana penunjang lainnya.'
  }
};

// Lokasi data lama berupa nama titik; pekerjaan baru dari Formulir SAB cuma
// punya koordinat GPS, ditampilkan sebagai tautan Google Maps.
function lokasiCell(r) {
  if (r.lokasi_teks) return esc(r.lokasi_teks);
  if (r.gps_lat !== null && r.gps_lng !== null) {
    const koor = r.gps_lat.toFixed(5) + ', ' + r.gps_lng.toFixed(5);
    return `<a class="maps-link" target="_blank" rel="noopener"
      href="https://www.google.com/maps?q=${r.gps_lat},${r.gps_lng}">${koor} 📍</a>`;
  }
  return '—';
}

const COLDEF = {
  tahun: { h: 'Tahun', cls: 'mono', v: r => r.tahun },
  tanggal: { h: 'Tanggal', v: r => fmtDate(r.tanggal) },
  no_ba: { h: 'No. BA', cls: 'mono', v: r => esc(r.no_ba || '—') },
  bidang: { h: 'Bidang', v: r => esc(BIDANG_LABEL[r.bidang] || r.bidang) },
  instalasi: { h: 'Instalasi', v: r => esc(r.instalasi || '—') },
  lokasi: { h: 'Lokasi', v: lokasiCell },
  dia: { h: 'Ø', cls: 'mono', v: r => r.diameter_nilai ? esc(r.diameter_nilai + ' ' + (r.diameter_satuan || '')) : '—' },
  kat: { h: 'Jenis', badge: true, v: r => cfg().katOf(r) },
  uraian: { h: 'Uraian Pekerjaan', cls: 'wide', v: r => esc(r.uraian || '—') },
  keterangan: { h: 'Keterangan / Penyebab', cls: 'wide', v: r => esc(r.keterangan || '—') }
};

const cfg = () => BID[curBid];
const bidPool = key => (BID[key].match ? REC.filter(r => r.bidang === BID[key].match) : REC);
const pool = () => {
  const p = bidPool(curBid);
  return curGrp ? p.filter(r => (r.instalasi || '') === curGrp) : p;
};

// ---------------------------------------------------------------------------
// PEMILIH BIDANG & INSTALASI
// ---------------------------------------------------------------------------
let YRS = [];

function renderTabs() {
  $('tabRow').innerHTML = Object.keys(BID).map(k => {
    const rs = bidPool(k);
    const per = YRS.map(y => rs.filter(r => r.tahun === y).length);
    const mx = Math.max(...per, 1);
    return `<button class="bidang-card${k === curBid ? ' on' : ''}" role="tab" aria-selected="${k === curBid}" data-bid="${k}">
      <div class="lb">${esc(BID[k].label)}</div>
      <div class="nm">${rs.length.toLocaleString('id-ID')}</div>
      <div class="spark">${per.map(v => `<i style="height:${Math.round(v / mx * 100)}%"></i>`).join('')}</div>
    </button>`;
  }).join('');
  $('tabRow').querySelectorAll('.bidang-card').forEach(b => b.onclick = () => {
    curBid = b.dataset.bid; curGrp = ''; page = 1; renderAll();
  });
}

// Filter instalasi cuma ditampilkan kalau bidang ini memang punya datanya.
// Data historis bidang "Pekerjaan Lainnya" tidak mencatat instalasi sama
// sekali, tapi pekerjaan baru dari Formulir SAB selalu mengisinya -- jadi
// filternya muncul sendiri begitu ada data yang relevan.
function renderSubs() {
  const groups = topN(cnt(bidPool(curBid), r => r.instalasi || ''), 99).filter(([g]) => g !== '');
  if (!groups.length) { $('subRow').innerHTML = ''; return; }
  $('subRow').innerHTML =
    `<label for="grpSel">Instalasi</label>
     <select id="grpSel" aria-label="Pilih instalasi">
       <option value=""${curGrp === '' ? ' selected' : ''}>Semua instalasi (${bidPool(curBid).length.toLocaleString('id-ID')})</option>
       ${groups.map(([g, n]) => `<option value="${esc(g)}"${curGrp === g ? ' selected' : ''}>${esc(g)} (${n})</option>`).join('')}
     </select>
     <span class="hint">${groups.length} instalasi tersedia</span>`;
  $('grpSel').onchange = e => { curGrp = e.target.value; page = 1; renderAll(false); };
}

// ---------------------------------------------------------------------------
// KARTU STATISTIK
// ---------------------------------------------------------------------------
function renderStats() {
  const rs = pool(), c = cfg();
  if (!rs.length) { $('stats').innerHTML = ''; return; }
  const last = rs[rs.length - 1];
  const potong = (s, n) => s.length > n ? s.slice(0, n) + '…' : s;

  const cards = {
    total: () => `<div class="stat"><div class="lbl">Total Pekerjaan</div>
      <div class="val">${rs.length.toLocaleString('id-ID')}</div>
      <div class="note">${rs[0].tahun} – ${last.tahun} · terakhir ${fmtDate(last.tanggal)}</div></div>`,
    tahun: () => {
      const y = topN(cnt(rs, r => r.tahun), 1)[0];
      return `<div class="stat"><div class="lbl">Tahun Tersibuk</div>
        <div class="val">${y[0]}</div><div class="note">${y[1]} pekerjaan</div></div>`;
    },
    kat: () => {
      const k = topN(cnt(rs, r => c.katOf(r)), 1)[0];
      const t = potong(k[0], 18);
      return `<div class="stat"><div class="lbl">${esc(c.katLabel)} Dominan</div>
        <div class="val" style="font-size:${t.length > 12 ? '18px' : '24px'};line-height:1.3">${esc(t)}</div>
        <div class="note">${Math.round(k[1] / rs.length * 100)}% dari total</div></div>`;
    },
    lok: () => {
      const l = topN(cnt(rs.filter(r => r.lokasi_teks), r => r.lokasi_teks), 1)[0];
      if (!l) return '';
      return `<div class="stat"><div class="lbl">Lokasi Tersering</div>
        <div class="val" style="font-size:16px;line-height:1.35">${esc(potong(l[0], 36))}</div>
        <div class="note">${l[1]}× ditangani</div></div>`;
    }
  };
  $('stats').innerHTML = (c.stats || ['total', 'tahun', 'kat', 'lok']).map(k => cards[k]()).join('');
}

// ---------------------------------------------------------------------------
// GRAFIK
// ---------------------------------------------------------------------------
const chartOpt = extra => Object.assign({
  responsive: true, maintainAspectRatio: false,
  onHover: (e, el) => { e.native.target.style.cursor = el.length ? 'pointer' : 'default'; }
}, extra);

function barTopLokasi(canvasId, records, onPick) {
  const tl = topN(cnt(records.filter(r => r.lokasi_teks), r => r.lokasi_teks), 10);
  if (!tl.length || !$(canvasId)) return;
  charts.push(new Chart($(canvasId), {
    type: 'bar',
    data: {
      labels: tl.map(t => t[0].length > 46 ? t[0].slice(0, 46) + '…' : t[0]),
      datasets: [{ data: tl.map(t => t[1]), backgroundColor: '#0B5566', borderRadius: 6 }]
    },
    options: chartOpt({
      indexAxis: 'y',
      scales: { x: { ticks: { precision: 0, font: { family: MONO, size: 11 } } },
                y: { grid: { display: false }, ticks: { font: { size: 11.5 } } } },
      plugins: { legend: { display: false } },
      onClick: (e, el) => { if (el.length) onPick(tl[el[0].index][0]); }
    })
  }));
}

function renderCharts() {
  charts.forEach(c => c.destroy()); charts = [];
  const rs = pool(), c = cfg();
  const years = [...new Set(rs.map(r => r.tahun))].sort();
  const kats = topN(cnt(rs, r => c.katOf(r)), 99).map(e => e[0]);
  colorMap = {}; kats.forEach((k, i) => colorMap[k] = PALETTE[i % PALETTE.length]);
  const adaLokasi = rs.some(r => r.lokasi_teks);

  let html = `
   <div class="panel wide"><h2>Tren Pekerjaan per Tahun</h2>
     <p class="cap">Jumlah pekerjaan per tahun, dibedakan menurut ${esc(c.katLabel.toLowerCase())}. <strong>Klik batangnya</strong> untuk melihat daftarnya.</p>
     <div class="chart-box tall"><canvas id="cTrend"></canvas></div></div>
   <div class="panel"><h2>Komposisi ${esc(c.katLabel)}</h2>
     <p class="cap">Proporsi pekerjaan. Klik untuk memfilter daftar.</p>
     <div class="chart-box"><canvas id="cKat"></canvas></div></div>`;
  html += c.diaLabel
    ? `<div class="panel"><h2>${esc(c.diaLabel)}</h2><p class="cap">Sebaran menurut diameter (${c.du}). Klik untuk memfilter daftar.</p><div class="chart-box"><canvas id="cDia"></canvas></div></div>`
    : `<div class="panel"><h2>Sebaran per Tahun</h2><p class="cap">Total pekerjaan tiap tahun. Klik untuk memfilter daftar.</p><div class="chart-box"><canvas id="cTahun"></canvas></div></div>`;
  if (adaLokasi) {
    html += `<div class="panel wide"><h2>Lokasi Paling Sering Ditangani</h2>
      <p class="cap">10 lokasi dengan frekuensi pekerjaan tertinggi — kandidat prioritas peremajaan. Klik untuk melihat riwayatnya.</p>
      <div class="chart-box tall"><canvas id="cLok"></canvas></div></div>`;
  }
  $('charts').innerHTML = html;

  // Tren bertumpuk per jenis
  charts.push(new Chart($('cTrend'), {
    type: 'bar',
    data: {
      labels: years,
      datasets: kats.map(k => ({
        label: k, backgroundColor: colorMap[k], borderRadius: 4, stacked: true,
        data: years.map(y => rs.filter(r => r.tahun === y && c.katOf(r) === k).length)
      }))
    },
    options: chartOpt({
      scales: { x: { stacked: true, grid: { display: false }, ticks: { font: { family: MONO, size: 11 } } },
                y: { stacked: true, ticks: { precision: 0, font: { family: MONO, size: 11 } } } },
      plugins: { legend: { labels: { boxWidth: 12, boxHeight: 12 } } },
      onClick: (e, el) => { if (el.length) jump({ tahun: years[el[0].index], kat: kats[el[0].datasetIndex] }); }
    })
  }));

  // Komposisi jenis
  charts.push(new Chart($('cKat'), {
    type: 'doughnut',
    data: {
      labels: kats,
      datasets: [{ data: kats.map(k => rs.filter(r => c.katOf(r) === k).length),
        backgroundColor: kats.map(k => colorMap[k]), borderColor: '#fff', borderWidth: 3 }]
    },
    options: chartOpt({
      cutout: '62%', plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, boxHeight: 12 } } },
      onClick: (e, el) => { if (el.length) jump({ kat: kats[el[0].index] }); }
    })
  }));

  // Diameter, atau sebaran per tahun untuk bidang tanpa diameter
  if (c.diaLabel) {
    const dias = [...new Set(rs.map(r => r.diameter_nilai).filter(Boolean))].sort((a, b) => a - b);
    charts.push(new Chart($('cDia'), {
      type: 'bar',
      data: {
        labels: dias.map(d => c.du === 'inch' ? d + '"' : d + ' mm'),
        datasets: [{ data: dias.map(d => rs.filter(r => r.diameter_nilai === d).length), backgroundColor: '#1C8CA0', borderRadius: 6 }]
      },
      options: chartOpt({
        scales: { x: { grid: { display: false }, ticks: { font: { family: MONO, size: 11 } } },
                  y: { ticks: { precision: 0, font: { family: MONO, size: 11 } } } },
        plugins: { legend: { display: false } },
        onClick: (e, el) => { if (el.length) jump({ dia: dias[el[0].index] }); }
      })
    }));
  } else {
    charts.push(new Chart($('cTahun'), {
      type: 'bar',
      data: { labels: years, datasets: [{ data: years.map(y => rs.filter(r => r.tahun === y).length), backgroundColor: '#1C8CA0', borderRadius: 6 }] },
      options: chartOpt({
        scales: { x: { grid: { display: false }, ticks: { font: { family: MONO, size: 11 } } },
                  y: { ticks: { precision: 0, font: { family: MONO, size: 11 } } } },
        plugins: { legend: { display: false } },
        onClick: (e, el) => { if (el.length) jump({ tahun: years[el[0].index] }); }
      })
    }));
  }

  if (adaLokasi) barTopLokasi('cLok', rs, lok => jump({ cari: lok }));
}

// ---------------------------------------------------------------------------
// FILTER & TABEL
// ---------------------------------------------------------------------------
const filterState = { cari: '', tahun: '', kat: '', dia: '' };

function renderFilters() {
  const rs = pool(), c = cfg();
  const years = [...new Set(rs.map(r => r.tahun))].sort();
  const kats = topN(cnt(rs, r => c.katOf(r)), 99).map(e => e[0]);
  const dias = [...new Set(rs.map(r => r.diameter_nilai).filter(Boolean))].sort((a, b) => a - b);

  $('filters').innerHTML = `
    <input type="search" id="fCari" placeholder="Cari lokasi, uraian, atau nomor BA…" value="${esc(filterState.cari)}" aria-label="Cari">
    <select id="fTahun" aria-label="Filter tahun"><option value="">Semua tahun</option>
      ${years.map(y => `<option value="${y}"${String(filterState.tahun) === String(y) ? ' selected' : ''}>${y}</option>`).join('')}</select>
    <select id="fKat" aria-label="Filter ${esc(c.katLabel)}"><option value="">Semua ${esc(c.katLabel.toLowerCase())}</option>
      ${kats.map(k => `<option value="${esc(k)}"${filterState.kat === k ? ' selected' : ''}>${esc(k)}</option>`).join('')}</select>
    ${c.diaLabel ? `<select id="fDia" aria-label="Filter diameter"><option value="">Semua diameter</option>
      ${dias.map(d => `<option value="${d}"${String(filterState.dia) === String(d) ? ' selected' : ''}>${d} ${c.du}</option>`).join('')}</select>` : ''}`;

  $('fCari').oninput = e => { filterState.cari = e.target.value; page = 1; renderTable(); };
  $('fTahun').onchange = e => { filterState.tahun = e.target.value; page = 1; renderTable(); };
  $('fKat').onchange = e => { filterState.kat = e.target.value; page = 1; renderTable(); };
  if ($('fDia')) $('fDia').onchange = e => { filterState.dia = e.target.value; page = 1; renderTable(); };
}

// Daftar tabel diurutkan dari yang paling baru. REC sendiri tetap menaik
// karena grafik tren & kartu statistik ("terakhir ...") mengandalkan urutan
// itu -- yang dibalik cuma tampilan tabelnya.
function filtered() {
  const c = cfg();
  const q = filterState.cari.trim().toLowerCase();
  return pool().slice().sort((a, b) =>
    a.tanggal < b.tanggal ? 1 : a.tanggal > b.tanggal ? -1 : b.id - a.id
  ).filter(r => {
    if (filterState.tahun && String(r.tahun) !== String(filterState.tahun)) return false;
    if (filterState.kat && c.katOf(r) !== filterState.kat) return false;
    if (filterState.dia && String(r.diameter_nilai) !== String(filterState.dia)) return false;
    if (q) {
      const hay = [r.lokasi_teks, r.no_ba, r.uraian, r.keterangan, r.instalasi].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function renderTable() {
  const c = cfg();
  const rows = filtered();
  const maxPage = Math.max(1, Math.ceil(rows.length / PER));
  if (page > maxPage) page = maxPage;
  const slice = rows.slice((page - 1) * PER, page * PER);

  $('tblCap').textContent = c.caption;
  $('thead').innerHTML = '<tr>' + c.cols.map(k => `<th>${esc(COLDEF[k].h)}</th>`).join('') + '</tr>';

  if (!slice.length) {
    $('tbody').innerHTML = `<tr><td class="empty-note" colspan="${c.cols.length}">Tidak ada pekerjaan yang cocok dengan filter ini.</td></tr>`;
  } else {
    $('tbody').innerHTML = slice.map(r => '<tr>' + c.cols.map(k => {
      const d = COLDEF[k];
      const val = d.v(r);
      if (d.badge) {
        const warna = colorMap[val] || '#4C6870';
        return `<td><span class="badge" style="background:${warna}">${esc(val)}</span></td>`;
      }
      return `<td${d.cls ? ` class="${d.cls}"` : ''}>${val}</td>`;
    }).join('') + '</tr>').join('');
  }

  const dari = rows.length ? (page - 1) * PER + 1 : 0;
  const sampai = Math.min(page * PER, rows.length);
  $('pager').innerHTML = `
    <span class="count">${dari}–${sampai} dari ${rows.length.toLocaleString('id-ID')} pekerjaan</span>
    <span class="btns">
      <button id="pgPrev"${page <= 1 ? ' disabled' : ''}>← Sebelumnya</button>
      <button id="pgNext"${page >= maxPage ? ' disabled' : ''}>Berikutnya →</button>
    </span>`;
  if ($('pgPrev')) $('pgPrev').onclick = () => { if (page > 1) { page--; renderTable(); scrollKeTabel(); } };
  if ($('pgNext')) $('pgNext').onclick = () => { if (page < maxPage) { page++; renderTable(); scrollKeTabel(); } };
}

function scrollKeTabel() {
  $('tablePanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Dipanggil saat batang/irisan grafik diklik: set filter lalu lompat ke tabel.
function jump(f) {
  filterState.cari = f.cari !== undefined ? f.cari : '';
  filterState.tahun = f.tahun !== undefined ? f.tahun : '';
  filterState.kat = f.kat !== undefined ? f.kat : '';
  filterState.dia = f.dia !== undefined ? f.dia : '';
  page = 1;
  renderFilters();
  renderTable();
  scrollKeTabel();
}

// Tampilan saat database memang belum berisi apa-apa. Dipisah dari pesan
// "tidak ada yang cocok dengan filter" supaya tidak membingungkan: grafik
// kosong tanpa keterangan terlihat seperti halaman yang rusak, padahal
// datanya yang memang belum ada.
function renderKosong() {
  charts.forEach(c => c.destroy()); charts = [];
  $('stats').innerHTML = '';
  $('charts').innerHTML = `<div class="panel wide"><div class="empty-note">
      <b>Belum ada data pekerjaan tersimpan.</b>
      <span>Daftar ini akan terisi sendiri begitu ada pekerjaan baru yang dicatat lewat Formulir SAB dan dibuatkan berita acaranya.</span>
    </div></div>`;
  $('filters').innerHTML = '';
  $('thead').innerHTML = '';
  $('tbody').innerHTML = '';
  $('pager').innerHTML = '';
  $('tblCap').textContent = cfg().caption;
}

function renderAll(resetFilter = true) {
  if (resetFilter) { filterState.cari = ''; filterState.tahun = ''; filterState.kat = ''; filterState.dia = ''; }
  renderTabs();
  renderSubs();
  if (!REC.length) { renderKosong(); return; }
  renderStats();
  renderCharts();
  renderFilters();
  renderTable();
}

// ---------------------------------------------------------------------------
// PENGAMBILAN DATA
// ---------------------------------------------------------------------------
function currentAccessToken() {
  return localStorage.getItem('token') || vizToken || null;
}

async function loadData() {
  const headers = {};
  const token = currentAccessToken();
  if (token) headers['Authorization'] = 'Bearer ' + token;

  const res = await fetch('/api/pekerjaan', { headers });
  if (!res.ok) throw new Error('Gagal memuat data (HTTP ' + res.status + ')');
  const data = await res.json();

  locked = !!data.locked;
  REC = (data.rows || []).map(r => Object.assign({ tahun: Number(String(r.tanggal).slice(0, 4)) }, r));
  REC.sort((a, b) => (a.tanggal < b.tanggal ? -1 : a.tanggal > b.tanggal ? 1 : 0));
  YRS = [...new Set(REC.map(r => r.tahun))].sort();

  const badge = $('statusBadge');
  if (locked) {
    badge.textContent = 'Data Contoh';
    badge.style.display = '';
  } else {
    badge.textContent = '';
    badge.style.display = 'none';
  }
  updateLockBanner(locked);
  renderAll();
}

// ---------------------------------------------------------------------------
// STATUS ADMIN (gating tombol Unduh CSV)
// ---------------------------------------------------------------------------
function checkAdminStatus() {
  const token = localStorage.getItem('token');
  const role = localStorage.getItem('role');
  isAdmin = !!(token && role === 'admin');
  const btn = $('downloadCsvBtn');
  if (isAdmin) {
    btn.textContent = 'Unduh CSV';
    btn.classList.add('enabled');
  } else {
    btn.textContent = '🔒 Unduh CSV (Admin)';
    btn.classList.remove('enabled');
  }
}

function downloadCsv() {
  if (!isAdmin) return;
  // Unduhan lewat navigasi browser tidak bisa mengirim header Authorization,
  // jadi tokennya dikirim sebagai query param -- pola yang sama dipakai
  // tombol Unduh PDF di apps/riwayat-air-baku.
  const token = localStorage.getItem('token');
  window.location.href = `/api/pekerjaan?export=csv&token=${encodeURIComponent(token)}`;
}

// ---------------------------------------------------------------------------
// AKSES DATA VITAL — banner "terkunci" + "Minta Akses" + polling status
// ---------------------------------------------------------------------------
// Token viz-access dipakai bersama seluruh situs (localStorage key
// vizAccessToken/vizAccessExpiresAt/vizRequestId), sama dengan
// apps/riwayat-air-baku dan apps/library.
const ACCESS_GROUP = 'pekerjaan_sab';
const ADMIN_WHATSAPP_NUMBER = '6281381146320';

let vizToken = null;
let vizTokenExpiresAt = null;
let vizRequestId = null;
let pollTimer = null;
let expiryTimer = null;

function updateLockBanner(isLocked) {
  const banner = $('lockBanner');
  const statusText = $('lockStatusText');
  if (!banner) return;
  if (!isLocked || isAdmin) { banner.style.display = 'none'; return; }
  banner.style.display = 'flex';
  statusText.textContent = pollTimer ? 'Menunggu persetujuan admin lewat email...' : '';
}

function openAccessModal() {
  const overlay = $('accessModalOverlay');
  if (!overlay) return;
  overlay.style.display = 'flex';
  const status = $('accessModalStatus');
  status.textContent = '';
  status.className = 'status-msg';
}

function closeAccessModal() {
  const overlay = $('accessModalOverlay');
  if (overlay) overlay.style.display = 'none';
}

function setAccessModalStatus(msg, cls) {
  const el = $('accessModalStatus');
  if (!el) return;
  el.textContent = msg;
  el.className = 'status-msg ' + (cls || '');
}

function openWhatsappChat() {
  // window.open() harus jadi statement PERTAMA di handler ini supaya tidak
  // dianggap popup otomatis oleh browser (lihat catatan yang sama di
  // apps/riwayat-air-baku/app.js).
  const win = window.open('', '_blank');
  const nama = $('accessNamaInput').value.trim();
  const namaPart = nama ? ` ${nama}` : '';
  const message = `Halo, saya${namaPart} baru saja mengirim permintaan akses data Riwayat Pekerjaan SAB di website, mohon persetujuannya.`;
  const url = `https://wa.me/${ADMIN_WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
  if (win) win.location.href = url;
  else window.open(url, '_blank');
}

async function submitAccessRequest() {
  const nama = $('accessNamaInput').value.trim();
  const alasan = $('accessAlasanInput').value.trim();
  if (!nama) { setAccessModalStatus('Isi nama dulu ya.', 'error'); return; }

  const btn = $('accessModalSubmit');
  btn.disabled = true;
  setAccessModalStatus('Mengirim permintaan...', 'pending');

  try {
    const res = await fetch('/api/visualization/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestedBy: nama, dataType: ACCESS_GROUP, reason: alasan || undefined })
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
  updateLockBanner(true);
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
      await loadData();
      closeAccessModal();
    } else if (data.status === 'expired' || data.status === 'not_found') {
      clearInterval(pollTimer);
      pollTimer = null;
      vizRequestId = null;
      try { localStorage.removeItem('vizRequestId'); } catch (e) {}
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
    loadData();
  }, Math.max(ms, 0));
}

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
  $('requestAccessBtn').addEventListener('click', openAccessModal);
  $('accessModalCancel').addEventListener('click', closeAccessModal);
  $('accessModalSubmit').addEventListener('click', submitAccessRequest);
  $('accessModalWhatsapp').addEventListener('click', openWhatsappChat);
  $('downloadCsvBtn').addEventListener('click', downloadCsv);
}

async function init() {
  wireControls();
  checkAdminStatus();
  restoreVizSession();
  try {
    await loadData();
  } catch (err) {
    $('statusBadge').style.display = 'none';
    $('charts').innerHTML = `<div class="panel wide"><div class="error-note">${esc(err.message)}</div></div>`;
    console.error(err);
  }
}

init();
