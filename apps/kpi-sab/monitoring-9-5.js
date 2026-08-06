(function () {
  "use strict";

  var MONTHS_TITLE = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

  var state = null;   // respons /api/visualization/data?dataType=kpi_9_5
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
    var url = '/api/visualization/data?dataType=kpi_9_5' + (bulan ? ('&bulan=' + encodeURIComponent(bulan)) : '');
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
  function renderRows() {
    var ro = !isAdmin ? ' readonly disabled' : '';
    var tbody = document.getElementById('rowsBody');
    tbody.innerHTML = (state.rows || []).map(function (r) {
      return '<tr>' +
        '<td class="no">' + esc(r.no) + '</td>' +
        '<td class="tgl"><div class="cellwrap web"><span class="cellnum">' + esc(r.tanggal) + '</span></div></td>' +
        '<td><input class="f-av" value="' + esc(r.airValve) + '" placeholder="mis. BAIK / BOCOR"' + ro + '></td>' +
        '<td><input class="f-wo" value="' + esc(r.valveWashOut) + '" placeholder="mis. BAIK / BOCOR"' + ro + '></td>' +
        '<td><input class="f-pp" value="' + esc(r.perpipaan) + '" placeholder="mis. BAIK / BOCOR"' + ro + '></td>' +
        '<td class="ket"><textarea class="f-ket" rows="3" spellcheck="false"' + ro + '>' + esc(r.keterangan) + '</textarea></td>' +
        '</tr>';
    }).join('');
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
    document.getElementById('role1').value = meta.roleMengetahui || '';
    document.getElementById('name1').value = meta.nameMengetahui || '';
    document.getElementById('role2').value = meta.roleMenyetujui || '';
    document.getElementById('name2').value = meta.nameMenyetujui || '';
    document.getElementById('pelaksana').value = meta.pelaksana || '';
    document.getElementById('footerCode').value = meta.footerCode || '';
    document.getElementById('halInput').value = meta.halaman || '1';
    document.getElementById('dariInput').value = meta.totalHalaman || '1';
    ['role1', 'name1', 'role2', 'name2', 'pelaksana', 'footerCode', 'halInput', 'dariInput'].forEach(function (id) {
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
      rows.push({
        no: (tr.querySelector('.no') || { textContent: '' }).textContent.trim(),
        airValve: (tr.querySelector('.f-av') || {}).value || '',
        valveWashOut: (tr.querySelector('.f-wo') || {}).value || '',
        perpipaan: (tr.querySelector('.f-pp') || {}).value || '',
        keterangan: (tr.querySelector('.f-ket') || {}).value || ''
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
        body: JSON.stringify({ kind: 'kpi_9_5_items', bulan: state.bulan, rows: collectItems() })
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
        kind: 'kpi_9_5_meta',
        roleMengetahui: document.getElementById('role1').value,
        nameMengetahui: document.getElementById('name1').value,
        roleMenyetujui: document.getElementById('role2').value,
        nameMenyetujui: document.getElementById('name2').value,
        pelaksana: document.getElementById('pelaksana').value,
        footerCode: document.getElementById('footerCode').value,
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

  // ------------------------------------------------------------------
  // UNDUH EXCEL -- dibangun di SERVER (exceljs), lihat lib/visualization/kpi.js.
  // ------------------------------------------------------------------
  document.getElementById('downloadBtn').addEventListener('click', async function () {
    if (!isAdmin) {
      alert('Unduh Excel khusus admin. Silakan login admin terlebih dahulu.');
      window.location.href = '../../login.html?redirect=' + encodeURIComponent('apps/kpi-sab/monitoring-9-5.html');
      return;
    }
    var btn = this;
    var oldText = btn.textContent;
    btn.disabled = true; btn.textContent = 'Menyiapkan Excel...';
    try {
      if (isAdmin) { try { await saveMeta(); } catch (e) {} }
      var apiUrl = '/api/visualization/data?dataType=kpi_9_5_xlsx&bulan=' + encodeURIComponent(state.bulan);
      var res = await fetch(apiUrl, { headers: { 'Authorization': 'Bearer ' + currentAccessToken() } });
      if (!res.ok) { var d = await res.json().catch(function () { return {}; }); throw new Error(d.error || ('HTTP ' + res.status)); }
      var blob = await res.blob();
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = '9.5 Laporan Monitoring Pipa Transmisi ' + monthLabel(state.bulan) + '.xlsx';
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
