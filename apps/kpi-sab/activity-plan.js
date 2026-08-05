(function () {
  "use strict";

  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun"];

  var state = null;      // respons terakhir dari /api/visualization/data?dataType=kpi_activity_plan
  var isAdmin = false;

  // --- akses data asli: token JWT admin (localStorage) atau token viz-access
  // hasil approve email -- pola & fungsi sama persis dengan KPI lain. ---
  var vizToken = null, vizTokenExpiresAt = null, vizRequestId = null, vizRequestSecret = null;
  var pollTimer = null, expiryTimer = null;

  function currentAccessToken() { return localStorage.getItem('token') || vizToken || null; }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // ------------------------------------------------------------------
  // MUAT DATA
  // ------------------------------------------------------------------
  async function fetchApiData(tahun) {
    var headers = {};
    var token = currentAccessToken();
    if (token) headers['Authorization'] = 'Bearer ' + token;
    var url = '/api/visualization/data?dataType=kpi_activity_plan' + (tahun ? ('&tahun=' + encodeURIComponent(tahun)) : '');
    var res = await fetch(url, { headers: headers });
    if (!res.ok) throw new Error('Gagal memuat data (HTTP ' + res.status + ')');
    return res.json();
  }

  function showLoadingState() {
    document.getElementById('mainTable').innerHTML = '';
    document.getElementById('tableFoot').textContent = 'Memuat data...';
  }
  function showErrorState(err) {
    document.getElementById('tableFoot').textContent = 'Gagal memuat data: ' + err.message + ' — coba muat ulang halaman.';
  }

  async function loadYear(tahun) {
    showLoadingState();
    try {
      state = await fetchApiData(tahun);
    } catch (err) {
      showErrorState(err);
      return;
    }
    renderAll();
  }

  async function reloadSameYear() {
    try {
      state = await fetchApiData(state.tahun);
    } catch (err) {
      showErrorState(err);
      return;
    }
    renderAll();
  }

  // ------------------------------------------------------------------
  // RENDER TABEL
  // ------------------------------------------------------------------
  function buildHead() {
    return '<thead><tr>' +
      '<th style="min-width:36px;">NO</th>' +
      '<th style="min-width:230px;">Key Result Area / Action plan &amp; Strategy</th>' +
      '<th style="min-width:58px;">Target</th>' +
      '<th style="min-width:84px;">Check Timing</th>' +
      MONTHS.map(function (m) { return '<th style="min-width:64px;">' + m + '</th>'; }).join('') +
      '<th style="min-width:56px;">Status</th>' +
      '<th style="min-width:50px;">Trend</th>' +
      '<th style="min-width:150px;">Problem</th>' +
      '<th style="min-width:170px;">Corrective Action</th>' +
      '<th style="min-width:76px;">PIC</th>' +
      '<th style="min-width:88px;">Due Date</th>' +
      '<th style="min-width:64px;">Progres</th>' +
      '</tr></thead>';
  }

  function rowHtml(r) {
    var indent = r.level === 0 ? 0 : r.level === 1 ? 14 : 30;
    var isGroup = !!r.isGroup;
    var valuesEditable = isAdmin && r.editable && !isGroup;
    var editable = isAdmin;
    var html = '<tr class="' + (isGroup ? 'act-group' : '') + '" data-key="' + esc(r.key) + '" data-valsed="' + (valuesEditable ? 1 : 0) + '">';
    html += '<td class="no">' + (isGroup ? esc(r.key) : '') + '</td>';
    html += '<td class="name" style="padding-left:' + (10 + indent) + 'px;">' + esc(r.label) + '</td>';
    html += '<td class="meta"><input class="cell" data-k="target" value="' + esc(r.target) + '"' + (editable ? '' : ' readonly') + '></td>';
    html += '<td class="meta"><input class="cell" data-k="timing" value="' + esc(r.timing) + '"' + (editable ? '' : ' readonly') + '></td>';
    MONTHS.forEach(function (_, i) {
      var v = r.values[i];
      var has = v !== null && v !== undefined;
      if (valuesEditable) {
        html += '<td class="actval"><input class="cell" type="text" inputmode="decimal" data-m="' + i + '" value="' + (has ? esc(v) : '') + '"></td>';
      } else {
        html += '<td class="actval ' + (has ? 'auto' : 'empty') + '">' + (has ? esc(v) : '—') + '</td>';
      }
    });
    html += '<td class="meta"><input class="cell" data-k="status" value="' + esc(r.status) + '"' + (editable ? '' : ' readonly') + '></td>';
    html += '<td class="meta"><input class="cell" data-k="trend" value="' + esc(r.trend) + '"' + (editable ? '' : ' readonly') + '></td>';
    html += '<td class="meta"><input class="cell" data-k="problem" value="' + esc(r.problem) + '"' + (editable ? '' : ' readonly') + '></td>';
    html += '<td class="meta"><input class="cell" data-k="corrective" value="' + esc(r.corrective) + '"' + (editable ? '' : ' readonly') + '></td>';
    html += '<td class="meta"><input class="cell" data-k="pic" value="' + esc(r.pic) + '"' + (editable ? '' : ' readonly') + '></td>';
    html += '<td class="meta"><input class="cell" data-k="due_date" value="' + esc(r.due_date) + '"' + (editable ? '' : ' readonly') + '></td>';
    html += '<td class="meta"><input class="cell" data-k="progres" value="' + esc(r.progres) + '"' + (editable ? '' : ' readonly') + '></td>';
    html += '</tr>';
    return html;
  }

  function renderTable() {
    var table = document.getElementById("mainTable");
    var html = buildHead() + "<tbody>";
    state.groups.forEach(function (g) {
      html += rowHtml(g.group);
      g.rows.forEach(function (r) { html += rowHtml(r); });
    });
    html += '</tbody>';
    table.innerHTML = html;

    document.getElementById("tableFoot").innerHTML =
      'Progres <b>Jan-Jun</b> · ' + (state.periode || '') + ' · ' +
      'Status <b>TCP</b> jika Progres ≥ target, <b>TDTCP</b> jika &lt; target. ' +
      'Kolom kuning bisa diedit admin (nilai manual &amp; metadata).';
  }

  // ------------------------------------------------------------------
  // SIMPAN BARIS (item/grup) -- saat salah satu sel berubah
  // ------------------------------------------------------------------
  async function saveRow(tr) {
    var key = tr.dataset.key;
    var values = {};
    tr.querySelectorAll('input[data-m]').forEach(function (x) { values[x.dataset.m] = x.value; });
    var body = { kind: 'kpi_activity_plan_row', item_key: key, values: values };
    tr.querySelectorAll('input[data-k]').forEach(function (x) { body[x.dataset.k] = x.value; });
    var res = await fetch('/api/visualization/admin-input', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + currentAccessToken() },
      body: JSON.stringify(body)
    });
    if (!res.ok) { var d = await res.json().catch(function () { return {}; }); throw new Error(d.error || ('HTTP ' + res.status)); }
  }

  // ------------------------------------------------------------------
  // UI UMUM
  // ------------------------------------------------------------------
  function renderYearSelect() {
    var sel = document.getElementById("yearSelect");
    var years = state.availableYears && state.availableYears.length ? state.availableYears : [state.tahun];
    sel.innerHTML = years.map(function (y) {
      return '<option value="' + y + '"' + (String(y) === String(state.tahun) ? ' selected' : '') + '>' + y + '</option>';
    }).join("");
  }

  function renderStatusBadge() {
    var badge = document.getElementById('statusBadge');
    if (state.locked) {
      badge.innerHTML = '<span class="status-pill warn">Data Contoh (Terkunci)</span>';
      return;
    }
    badge.innerHTML = '<span class="status-pill good">Data Asli — ' + state.tahun + '</span>';
  }

  function updateLockBanner() {
    var banner = document.getElementById('lockBanner');
    if (!state.locked || isAdmin) { banner.style.display = 'none'; return; }
    banner.style.display = 'flex';
    document.getElementById('lockStatusText').textContent = pollTimer ? 'Menunggu persetujuan admin lewat email...' : '';
  }

  function updateDownloadButton() {
    var btn = document.getElementById('downloadBtn');
    if (isAdmin) { btn.textContent = 'Unduh Excel'; btn.classList.add('enabled'); }
    else { btn.textContent = '🔒 Unduh Excel (Admin)'; btn.classList.remove('enabled'); }
  }

  function renderAll() {
    renderYearSelect();
    renderStatusBadge();
    updateLockBanner();
    updateDownloadButton();
    renderTable();
  }

  function toast(msg) {
    var t = document.getElementById("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(t._h);
    t._h = setTimeout(function () { t.classList.remove("show"); }, 2800);
  }

  // ------------------------------------------------------------------
  // EVENTS
  // ------------------------------------------------------------------
  document.getElementById("yearSelect").addEventListener("change", function (e) {
    loadYear(e.target.value);
  });

  document.getElementById("mainTable").addEventListener("change", async function (e) {
    var inp = e.target.closest('input');
    if (!inp || !isAdmin) return;
    var tr = inp.closest('tr');
    var key = tr.dataset.key;
    try {
      await saveRow(tr);
      // Muat ulang supaya rata-rata grup & status TCP/TDTCP ikut ter-update.
      await reloadSameYear();
      toast('Baris ' + key + ' disimpan.');
    } catch (err) {
      toast('Gagal menyimpan: ' + err.message);
    }
  });

  // ------------------------------------------------------------------
  // UNDUH EXCEL -- dibangun di SERVER (exceljs), lihat catatan di
  // lib/visualization/kpi.js.
  // ------------------------------------------------------------------
  document.getElementById("downloadBtn").addEventListener("click", async function () {
    if (!isAdmin) {
      alert('Unduh Excel khusus admin. Silakan login admin terlebih dahulu.');
      window.location.href = '../../login.html?redirect=' + encodeURIComponent('apps/kpi-sab/activity-plan.html');
      return;
    }
    var btn = document.getElementById('downloadBtn');
    var oldText = btn.textContent;
    btn.disabled = true; btn.textContent = 'Menyiapkan Excel...';
    try {
      var token = currentAccessToken();
      var apiUrl = '/api/visualization/data?dataType=kpi_activity_plan_xlsx&tahun=' + encodeURIComponent(state.tahun);
      var res = await fetch(apiUrl, { headers: { 'Authorization': 'Bearer ' + token } });
      if (!res.ok) {
        var d = await res.json().catch(function () { return {}; });
        throw new Error(d.error || ('HTTP ' + res.status));
      }
      var blob = await res.blob();
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = 'Activity Plan SAB ' + state.tahun + '.xlsx';
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast('Gagal mengunduh Excel: ' + err.message);
    }
    btn.disabled = false; btn.textContent = oldText;
  });

  // ------------------------------------------------------------------
  // STATUS ADMIN
  // ------------------------------------------------------------------
  function checkAdminStatus() {
    var token = localStorage.getItem('token');
    var role = localStorage.getItem('role');
    isAdmin = !!(token && role === 'admin');
  }

  // ------------------------------------------------------------------
  // AKSES DATA VITAL — modal "Minta Akses" + polling + auto-unlock, disalin
  // dari KPI lain.
  // ------------------------------------------------------------------
  function openAccessModal() {
    var overlay = document.getElementById('accessModalOverlay');
    if (!overlay) return;
    overlay.style.display = 'flex';
    var status = document.getElementById('accessModalStatus');
    status.textContent = ''; status.className = 'status-msg';
  }
  function closeAccessModal() {
    var overlay = document.getElementById('accessModalOverlay');
    if (overlay) overlay.style.display = 'none';
  }
  function setAccessModalStatus(msg, cls) {
    var el = document.getElementById('accessModalStatus');
    if (!el) return;
    el.textContent = msg; el.className = 'status-msg ' + (cls || '');
  }

  var ADMIN_WHATSAPP_NUMBER = '6281381146320';
  function openWhatsappChat() {
    var win = window.open('', '_blank');
    var nama = document.getElementById('accessNamaInput').value.trim();
    var namaPart = nama ? (' ' + nama) : '';
    var message = 'Halo, saya' + namaPart + ' baru saja mengirim permintaan akses data Activity Plan SAB di website, mohon persetujuannya.';
    var url = 'https://wa.me/' + ADMIN_WHATSAPP_NUMBER + '?text=' + encodeURIComponent(message);
    if (win) win.location.href = url; else window.open(url, '_blank');
  }

  async function submitAccessRequest() {
    var nama = document.getElementById('accessNamaInput').value.trim();
    var alasan = document.getElementById('accessAlasanInput').value.trim();
    if (!nama) { setAccessModalStatus('Isi nama dulu ya.', 'error'); return; }
    var btn = document.getElementById('accessModalSubmit');
    btn.disabled = true;
    setAccessModalStatus('Mengirim permintaan...', 'pending');
    try {
      var res = await fetch('/api/visualization/request', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestedBy: nama, dataType: 'kpi_pengambilan', reason: alasan || undefined })
      });
      var data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Gagal mengirim permintaan.');
      vizRequestId = data.requestId; vizRequestSecret = data.pollSecret;
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
    updateLockBanner();
    pollTimer = setInterval(checkAccessStatus, 4000);
    checkAccessStatus();
  }

  async function checkAccessStatus() {
    if (!vizRequestId || !vizRequestSecret) return;
    try {
      var res = await fetch('/api/visualization/status?id=' + vizRequestId + '&secret=' + encodeURIComponent(vizRequestSecret || ''));
      var data = await res.json();
      if (data.status === 'approved') {
        clearInterval(pollTimer); pollTimer = null;
        vizToken = data.token; vizTokenExpiresAt = data.expiresAt;
        try {
          localStorage.setItem('vizAccessToken', vizToken);
          localStorage.setItem('vizAccessExpiresAt', vizTokenExpiresAt);
          localStorage.removeItem('vizRequestId'); localStorage.removeItem('vizRequestSecret');
        } catch (e) {}
        scheduleTokenExpiry();
        setAccessModalStatus('Akses disetujui! Memuat data asli...', 'ok');
        await loadYear(state.tahun);
        closeAccessModal();
      } else if (data.status === 'expired' || data.status === 'not_found') {
        clearInterval(pollTimer); pollTimer = null;
        vizRequestId = null; vizRequestSecret = null;
        try { localStorage.removeItem('vizRequestId'); localStorage.removeItem('vizRequestSecret'); } catch (e) {}
        updateLockBanner();
      }
    } catch (err) { console.warn('Gagal cek status akses:', err); }
  }

  function scheduleTokenExpiry() {
    if (expiryTimer) clearTimeout(expiryTimer);
    var ms = new Date(vizTokenExpiresAt).getTime() - Date.now();
    expiryTimer = setTimeout(function () {
      vizToken = null; vizTokenExpiresAt = null;
      try { localStorage.removeItem('vizAccessToken'); localStorage.removeItem('vizAccessExpiresAt'); } catch (e) {}
      loadYear(state.tahun);
    }, Math.max(ms, 0));
  }

  function restoreVizSession() {
    try {
      var token = localStorage.getItem('vizAccessToken');
      var expiresAt = localStorage.getItem('vizAccessExpiresAt');
      if (token && expiresAt && new Date(expiresAt).getTime() > Date.now()) {
        vizToken = token; vizTokenExpiresAt = expiresAt;
        scheduleTokenExpiry();
        return;
      }
      var pendingId = localStorage.getItem('vizRequestId');
      var pendingSecret = localStorage.getItem('vizRequestSecret');
      if (pendingId && pendingSecret) {
        vizRequestId = pendingId; vizRequestSecret = pendingSecret;
        startPolling();
      }
    } catch (e) {}
  }

  function wireAccessControls() {
    var requestBtn = document.getElementById('requestAccessBtn');
    var cancelBtn = document.getElementById('accessModalCancel');
    var submitBtn = document.getElementById('accessModalSubmit');
    var whatsappBtn = document.getElementById('accessModalWhatsapp');
    if (requestBtn) requestBtn.addEventListener('click', openAccessModal);
    if (cancelBtn) cancelBtn.addEventListener('click', closeAccessModal);
    if (submitBtn) submitBtn.addEventListener('click', submitAccessRequest);
    if (whatsappBtn) whatsappBtn.addEventListener('click', openWhatsappChat);
  }

  // ------------------------------------------------------------------
  // INIT
  // ------------------------------------------------------------------
  async function init() {
    checkAdminStatus();
    wireAccessControls();
    restoreVizSession();
    await loadYear(null);
  }

  init();
})();
