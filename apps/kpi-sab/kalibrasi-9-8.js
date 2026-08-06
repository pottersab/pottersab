(function () {
  "use strict";

  var MONTHS_TITLE = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

  var state = null;   // respons /api/visualization/data?dataType=kpi_9_8
  var isAdmin = false;

  function currentAccessToken() { return localStorage.getItem('token') || null; }
  function monthLabel(ym) {
    var p = ym.split('-'); return MONTHS_TITLE[Number(p[1]) - 1] + ' ' + p[0];
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ------------------------------------------------------------------
  // MUAT DATA
  // ------------------------------------------------------------------
  async function fetchApiData(bulan) {
    var url = '/api/visualization/data?dataType=kpi_9_8' + (bulan ? ('&bulan=' + encodeURIComponent(bulan)) : '');
    var res = await fetch(url);
    if (!res.ok) throw new Error('Gagal memuat data (HTTP ' + res.status + ')');
    return res.json();
  }

  async function loadMonth(bulan) {
    try { state = await fetchApiData(bulan); }
    catch (err) { toast('Gagal memuat data: ' + err.message); return; }
    renderAll();
  }
  async function reloadSameMonth() {
    try { state = await fetchApiData(state.bulan); }
    catch (err) { toast('Gagal memuat data: ' + err.message); return; }
    renderAll();
  }

  // ------------------------------------------------------------------
  // RENDER
  // ------------------------------------------------------------------
  function rowHtml(r, idx) {
    var ro = !isAdmin ? ' readonly disabled' : '';
    var no = (r.no !== null && r.no !== undefined && r.no !== '') ? esc(r.no) : String(idx + 1);
    return '<tr>' +
      '<td><input class="f-no" value="' + no + '"' + ro + '></td>' +
      '<td><input class="f-nama" value="' + esc(r.namaAlat) + '" placeholder="Nama alat"' + ro + '></td>' +
      '<td><input class="f-seri" value="' + esc(r.noSeri) + '" placeholder="No. seri"' + ro + '></td>' +
      '<td><input class="f-kode" value="' + esc(r.kodeInventaris) + '" placeholder="Kode inventaris"' + ro + '></td>' +
      '<td><input class="f-terakhir" value="' + esc(r.terakhir) + '" placeholder="mis. Oktober 2024"' + ro + '></td>' +
      '<td><input class="f-berikutnya" value="' + esc(r.berikutnya) + '" placeholder="mis. Oktober 2026"' + ro + '></td>' +
      '<td class="keterangan"><input class="f-ket" value="' + esc(r.keterangan) + '" placeholder="mis. Tidak DiKalibrasi"' + ro + '></td>' +
      '<td>' + (isAdmin ? '<button type="button" class="del-row" title="Hapus baris">✕</button>' : '') + '</td>' +
      '</tr>';
  }

  function renderRows() {
    var tbody = document.getElementById('rowsBody');
    var items = (state.items || []).length ? state.items : [{ no: '1', namaAlat: '', noSeri: '', kodeInventaris: '', terakhir: '', berikutnya: '', keterangan: '' }];
    tbody.innerHTML = items.map(rowHtml).join('');
  }

  function renderMonthSelect() {
    var sel = document.getElementById('monthSelect');
    var months = state.availableMonths && state.availableMonths.length ? state.availableMonths : [state.bulan];
    sel.innerHTML = months.map(function (ym) {
      return '<option value="' + ym + '"' + (ym === state.bulan ? ' selected' : '') + '>' + monthLabel(ym) + '</option>';
    }).join('');
  }

  function renderStatusBadge() {
    document.getElementById('statusBadge').innerHTML = '<span class="status-pill good">' + monthLabel(state.bulan) + '</span>';
  }

  function renderSign() {
    var meta = state.meta;
    document.getElementById('role1').value = meta.roleMenyetujui || '';
    document.getElementById('name1').value = meta.nameMenyetujui || '';
    document.getElementById('role2').value = meta.roleDibuat || '';
    document.getElementById('name2').value = meta.nameDibuat || '';
    document.getElementById('footerCode').value = meta.footerCode || '';
    document.getElementById('lokasiInput').value = meta.lokasi || 'Waduk Manggar';
    document.getElementById('halInput').value = meta.halaman || '1';
    document.getElementById('dariInput').value = meta.totalHalaman || '1';
    ['role1', 'name1', 'role2', 'name2', 'footerCode', 'lokasiInput', 'halInput', 'dariInput'].forEach(function (id) {
      document.getElementById(id).readOnly = !isAdmin;
    });
  }

  function updateDownloadButton() {
    var btn = document.getElementById('downloadBtn');
    if (isAdmin) { btn.textContent = 'Unduh Excel'; btn.classList.add('enabled'); }
    else { btn.textContent = '🔒 Unduh Excel (Admin)'; btn.classList.remove('enabled'); }
  }

  function renderAll() {
    renderMonthSelect();
    renderStatusBadge();
    renderRows();
    renderSign();
    updateDownloadButton();
  }

  function toast(msg) {
    var t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._h);
    t._h = setTimeout(function () { t.classList.remove('show'); }, 2800);
  }

  // ------------------------------------------------------------------
  // SIMPAN
  // ------------------------------------------------------------------
  function collectItems() {
    var rows = [];
    document.querySelectorAll('#rowsBody tr').forEach(function (tr) {
      var val = function (cls) { var el = tr.querySelector(cls); return el ? el.value.trim() : ''; };
      rows.push({
        no: val('.f-no'),
        namaAlat: val('.f-nama'),
        noSeri: val('.f-seri'),
        kodeInventaris: val('.f-kode'),
        terakhir: val('.f-terakhir'),
        berikutnya: val('.f-berikutnya'),
        keterangan: val('.f-ket')
      });
    });
    return rows;
  }

  async function saveItems() {
    if (!isAdmin) return;
    var btn = document.getElementById('saveItemsBtn');
    var status = document.getElementById('itemsStatus');
    btn.disabled = true;
    status.textContent = 'Menyimpan...';
    try {
      var res = await fetch('/api/visualization/admin-input', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + currentAccessToken() },
        body: JSON.stringify({ kind: 'kpi_9_8_items', bulan: state.bulan, rows: collectItems() })
      });
      if (!res.ok) { var d = await res.json().catch(function () { return {}; }); throw new Error(d.error || ('HTTP ' + res.status)); }
      status.textContent = 'Tersimpan ✓';
    } catch (err) {
      status.textContent = 'Gagal menyimpan: ' + err.message;
    }
    btn.disabled = false;
    setTimeout(function () { if (status) status.textContent = ''; }, 2500);
  }

  async function saveMeta() {
    if (!isAdmin) return;
    var btn = document.getElementById('saveMetaBtn');
    var status = document.getElementById('metaStatus');
    btn.disabled = true;
    status.textContent = 'Menyimpan...';
    try {
      var body = {
        kind: 'kpi_9_8_meta',
        roleMenyetujui: document.getElementById('role1').value,
        nameMenyetujui: document.getElementById('name1').value,
        roleDibuat: document.getElementById('role2').value,
        nameDibuat: document.getElementById('name2').value,
        footerCode: document.getElementById('footerCode').value,
        lokasi: document.getElementById('lokasiInput').value.trim() || 'Waduk Manggar',
        halaman: document.getElementById('halInput').value.trim() || '1',
        totalHalaman: document.getElementById('dariInput').value.trim() || '1'
      };
      var res = await fetch('/api/visualization/admin-input', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + currentAccessToken() },
        body: JSON.stringify(body)
      });
      if (!res.ok) { var d = await res.json().catch(function () { return {}; }); throw new Error(d.error || ('HTTP ' + res.status)); }
      status.textContent = 'Tersimpan ✓';
    } catch (err) {
      status.textContent = 'Gagal menyimpan: ' + err.message;
    }
    btn.disabled = false;
    setTimeout(function () { if (status) status.textContent = ''; }, 2500);
  }

  // ------------------------------------------------------------------
  // EVENTS
  // ------------------------------------------------------------------
  document.getElementById('monthSelect').addEventListener('change', function (e) {
    loadMonth(e.target.value);
  });
  document.getElementById('fetchBtn').addEventListener('click', function () {
    reloadSameMonth();
    toast('Data dimuat ulang.');
  });
  document.getElementById('saveItemsBtn').addEventListener('click', saveItems);
  document.getElementById('saveMetaBtn').addEventListener('click', saveMeta);

  document.getElementById('addRowBtn').addEventListener('click', function () {
    var tbody = document.getElementById('rowsBody');
    var tr = document.createElement('tr');
    tr.innerHTML = '<td><input class="f-no" value="' + (tbody.children.length + 1) + '"></td>' +
      '<td><input class="f-nama" placeholder="Nama alat"></td>' +
      '<td><input class="f-seri" placeholder="No. seri"></td>' +
      '<td><input class="f-kode" placeholder="Kode inventaris"></td>' +
      '<td><input class="f-terakhir" placeholder="mis. Oktober 2024"></td>' +
      '<td><input class="f-berikutnya" placeholder="mis. Oktober 2026"></td>' +
      '<td class="keterangan"><input class="f-ket" placeholder="mis. Tidak DiKalibrasi"></td>' +
      '<td><button type="button" class="del-row" title="Hapus baris">✕</button></td>';
    tbody.appendChild(tr);
    var first = tr.querySelector('input');
    if (first) first.focus();
  });

  document.getElementById('rowsBody').addEventListener('click', function (e) {
    var btn = e.target.closest('.del-row');
    if (!btn) return;
    var tr = btn.closest('tr');
    if (tr) tr.remove();
  });

  // ------------------------------------------------------------------
  // UNDUH EXCEL -- dibangun di SERVER (exceljs), lihat lib/visualization/kpi.js.
  // ------------------------------------------------------------------
  document.getElementById('downloadBtn').addEventListener('click', async function () {
    if (!isAdmin) {
      alert('Unduh Excel khusus admin. Silakan login admin terlebih dahulu.');
      window.location.href = '../../login.html?redirect=' + encodeURIComponent('apps/kpi-sab/kalibrasi-9-8.html');
      return;
    }
    var btn = this;
    var oldText = btn.textContent;
    btn.disabled = true; btn.textContent = 'Menyiapkan Excel...';
    try {
      if (isAdmin) { try { await saveMeta(); } catch (e) {} }
      var apiUrl = '/api/visualization/data?dataType=kpi_9_8_xlsx&bulan=' + encodeURIComponent(state.bulan);
      var res = await fetch(apiUrl, { headers: { 'Authorization': 'Bearer ' + currentAccessToken() } });
      if (!res.ok) { var d = await res.json().catch(function () { return {}; }); throw new Error(d.error || ('HTTP ' + res.status)); }
      var blob = await res.blob();
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = '9.8 Laporan Jadwal Kalibrasi ' + monthLabel(state.bulan) + '.xlsx';
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast('Gagal mengunduh Excel: ' + err.message);
    }
    btn.disabled = false; btn.textContent = oldText;
  });

  // ------------------------------------------------------------------
  // INIT
  // ------------------------------------------------------------------
  function checkAdminStatus() {
    var token = localStorage.getItem('token');
    var role = localStorage.getItem('role');
    isAdmin = !!(token && role === 'admin');
  }

  async function init() {
    checkAdminStatus();
    await loadMonth(null);
  }

  init();
})();
