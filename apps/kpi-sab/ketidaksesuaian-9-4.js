(function () {
  "use strict";

  var MONTHS_TITLE = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

  var state = null;   // respons /api/visualization/data?dataType=kpi_9_4
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
    var headers = {};
    var token = currentAccessToken();
    if (token) headers['Authorization'] = 'Bearer ' + token;
    var url = '/api/visualization/data?dataType=kpi_9_4' + (bulan ? ('&bulan=' + encodeURIComponent(bulan)) : '');
    var res = await fetch(url, { headers: headers });
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
  // RENDER TABEL ISIAN (admin) / TAMPILAN (viewer)
  // ------------------------------------------------------------------
  function renderItems() {
    var card = document.getElementById('itemsCard');
    if (!isAdmin) {
      card.style.display = 'none';
      renderViewTable();
      return;
    }
    card.style.display = '';
    document.getElementById('itemsMonthLabel').textContent = monthLabel(state.bulan);
    var tbody = document.getElementById('itemsBody');
    var items = state.items || [];
    tbody.innerHTML = items.map(function (it, i) {
      return '<tr data-i="' + i + '">' +
        '<td class="no">' + (i + 1) + '</td>' +
        '<td><input data-k="ds" value="' + esc(it.ds) + '" placeholder="mis. 33.902 m3"></td>' +
        '<td><input data-k="di" value="' + esc(it.di) + '" placeholder="mis. 31.161 m3"></td>' +
        '<td class="keterangan"><input data-k="ket" value="' + esc(it.ket) + '" placeholder="Keterangan kejadian"></td>' +
        '<td><button type="button" class="del-row" title="Hapus baris">✕</button></td>' +
        '</tr>';
    }).join('');
    tbody.querySelectorAll('.del-row').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var tr = btn.closest('tr');
        if (tr) tr.remove();
        renumber();
      });
    });
  }

  function renumber() {
    var rows = document.querySelectorAll('#itemsBody tr');
    rows.forEach(function (tr, i) { var n = tr.querySelector('.no'); if (n) n.textContent = i + 1; });
  }

  function collectItems() {
    var rows = document.querySelectorAll('#itemsBody tr');
    return Array.prototype.map.call(rows, function (tr) {
      return {
        ds: (tr.querySelector('[data-k="ds"]') || { value: '' }).value.trim(),
        di: (tr.querySelector('[data-k="di"]') || { value: '' }).value.trim(),
        ket: (tr.querySelector('[data-k="ket"]') || { value: '' }).value.trim()
      };
    });
  }

  function renderViewTable() {
    var wrap = document.getElementById('viewTables');
    var items = state.items || [];
    if (!items.length) {
      wrap.innerHTML = '<div class="tablecard loc-card"><div class="loc-head">9.4 Laporan Ketidaksesuaian Debit — ' + monthLabel(state.bulan) + '</div><div class="hint" style="padding:14px 16px;">Belum ada data ketidaksesuaian untuk bulan ini.</div></div>';
      return;
    }
    var html = '<div class="tablecard loc-card"><div class="loc-head">9.4 Laporan Ketidaksesuaian Debit — ' + monthLabel(state.bulan) + '</div><div class="scrollx"><table class="kpi kual-table"><thead>' +
      '<tr class="r1"><th style="min-width:46px;">NO</th><th style="min-width:120px;">DEBIT SEBELUMNYA</th><th style="min-width:120px;">DEBIT HARI INI</th><th>KETERANGAN</th></tr>' +
      '</thead><tbody>';
    items.forEach(function (it, i) {
      html += '<tr><td class="no">' + (i + 1) + '</td>' +
        '<td><div class="cellwrap web"><span class="cellnum">' + esc(it.ds) + '</span></div></td>' +
        '<td><div class="cellwrap web"><span class="cellnum">' + esc(it.di) + '</span></div></td>' +
        '<td><div class="cellwrap"><span class="cellnum">' + esc(it.ket) + '</span></div></td></tr>';
    });
    html += '</tbody></table></div></div>';
    wrap.innerHTML = html;
  }

  // ------------------------------------------------------------------
  // PENANDATANGAN & KODE DOKUMEN (global, kpi_9_4_meta)
  // ------------------------------------------------------------------
  async function saveMeta() {
    var token = currentAccessToken();
    var body = {
      kind: 'kpi_9_4_meta',
      roleMenyetujui: document.getElementById('roleLeft').value,
      nameMenyetujui: document.getElementById('nameLeft').value,
      roleDiketahui: document.getElementById('roleRight').value,
      nameDiketahui: document.getElementById('nameRight').value,
      footerCode: document.getElementById('footerCode').value
    };
    var res = await fetch('/api/visualization/admin-input', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify(body)
    });
    if (!res.ok) { var d = await res.json().catch(function () { return {}; }); throw new Error(d.error || ('HTTP ' + res.status)); }
    state.meta.roleMenyetujui = body.roleMenyetujui; state.meta.nameMenyetujui = body.nameMenyetujui;
    state.meta.roleDiketahui = body.roleDiketahui; state.meta.nameDiketahui = body.nameDiketahui;
    state.meta.footerCode = body.footerCode;
  }

  function renderSign() {
    var meta = state.meta;
    document.getElementById('roleLeft').value = meta.roleMenyetujui || '';
    document.getElementById('nameLeft').value = meta.nameMenyetujui || '';
    document.getElementById('roleRight').value = meta.roleDiketahui || '';
    document.getElementById('nameRight').value = meta.nameDiketahui || '';
    document.getElementById('footerCode').value = meta.footerCode || '';
    ['roleLeft', 'nameLeft', 'roleRight', 'nameRight', 'footerCode'].forEach(function (id) {
      document.getElementById(id).readOnly = !isAdmin;
    });
  }

  function wireSignatureControls() {
    ['roleLeft', 'nameLeft', 'roleRight', 'nameRight', 'footerCode'].forEach(function (id) {
      document.getElementById(id).addEventListener('change', async function () {
        if (!isAdmin) return;
        try { await saveMeta(); toast('Penandatangan disimpan.'); }
        catch (err) { toast('Gagal menyimpan: ' + err.message); }
      });
    });
  }

  // ------------------------------------------------------------------
  // SIMPAN ITEMS (admin)
  // ------------------------------------------------------------------
  function wireItemsControls() {
    document.getElementById('addRowBtn').addEventListener('click', function () {
      var tbody = document.getElementById('itemsBody');
      var tr = document.createElement('tr');
      tr.innerHTML = '<td class="no">' + (tbody.children.length + 1) + '</td>' +
        '<td><input data-k="ds" placeholder="mis. 33.902 m3"></td>' +
        '<td><input data-k="di" placeholder="mis. 31.161 m3"></td>' +
        '<td class="keterangan"><input data-k="ket" placeholder="Keterangan kejadian"></td>' +
        '<td><button type="button" class="del-row" title="Hapus baris">✕</button></td>';
      tbody.appendChild(tr);
      tr.querySelector('.del-row').addEventListener('click', function () { tr.remove(); renumber(); });
      var first = tr.querySelector('input');
      if (first) first.focus();
    });
    document.getElementById('saveItemsBtn').addEventListener('click', async function () {
      if (!isAdmin) return;
      var btn = this;
      var status = document.getElementById('itemsStatus');
      btn.disabled = true;
      status.textContent = 'Menyimpan...';
      try {
        var res = await fetch('/api/visualization/admin-input', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + currentAccessToken() },
          body: JSON.stringify({ kind: 'kpi_9_4_items', bulan: state.bulan, items: collectItems() })
        });
        if (!res.ok) { var d = await res.json().catch(function () { return {}; }); throw new Error(d.error || ('HTTP ' + res.status)); }
        status.textContent = 'Tersimpan ✓';
        await reloadSameMonth();
      } catch (err) {
        status.textContent = 'Gagal menyimpan: ' + err.message;
      }
      btn.disabled = false;
      setTimeout(function () { if (status) status.textContent = ''; }, 2500);
    });
  }

  // ------------------------------------------------------------------
  // RENDER BERSAMA
  // ------------------------------------------------------------------
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

  function renderAll() {
    renderMonthSelect();
    renderStatusBadge();
    renderItems();
    renderSign();
    updateDownloadButton();
  }

  function updateDownloadButton() {
    var btn = document.getElementById('downloadBtn');
    if (isAdmin) { btn.textContent = 'Unduh Excel'; btn.classList.add('enabled'); }
    else { btn.textContent = '🔒 Unduh Excel (Admin)'; btn.classList.remove('enabled'); }
  }

  function toast(msg) {
    var t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._h);
    t._h = setTimeout(function () { t.classList.remove('show'); }, 2800);
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

  // ------------------------------------------------------------------
  // UNDUH EXCEL -- dibangun di SERVER (exceljs), lihat lib/visualization/kpi.js.
  // ------------------------------------------------------------------
  document.getElementById('downloadBtn').addEventListener('click', async function () {
    if (!isAdmin) {
      alert('Unduh Excel khusus admin. Silakan login admin terlebih dahulu.');
      window.location.href = '../../login.html?redirect=' + encodeURIComponent('apps/kpi-sab/ketidaksesuaian-9-4.html');
      return;
    }
    var btn = this;
    var oldText = btn.textContent;
    btn.disabled = true; btn.textContent = 'Menyiapkan Excel...';
    try {
      if (isAdmin) { try { await saveMeta(); } catch (e) {} }
      var apiUrl = '/api/visualization/data?dataType=kpi_9_4_xlsx&bulan=' + encodeURIComponent(state.bulan);
      var res = await fetch(apiUrl, { headers: { 'Authorization': 'Bearer ' + currentAccessToken() } });
      if (!res.ok) { var d = await res.json().catch(function () { return {}; }); throw new Error(d.error || ('HTTP ' + res.status)); }
      var blob = await res.blob();
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = '9.4 Laporan Ketidaksesuaian Debit ' + monthLabel(state.bulan) + '.xlsx';
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
    wireSignatureControls();
    wireItemsControls();
    await loadMonth(null);
  }

  init();
})();
