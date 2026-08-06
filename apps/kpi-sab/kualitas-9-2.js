(function () {
  "use strict";

  var MONTHS_TITLE = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

  var state = null;      // respons terakhir dari /api/visualization/data?dataType=kpi_9_2
  var printMode = true;
  var isAdmin = false;

  // --- akses data asli: token JWT admin (localStorage) atau token viz-access
  // hasil approve email -- pola & fungsi sama persis dengan kualitas.js. ---
  var vizToken = null, vizTokenExpiresAt = null, vizRequestId = null, vizRequestSecret = null;
  var pollTimer = null, expiryTimer = null;

  function currentAccessToken() { return localStorage.getItem('token') || vizToken || null; }

  function fmt(n, d) {
    if (n === null || n === undefined || isNaN(n)) return "";
    return n.toLocaleString("id-ID", { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  function monthLabel(ym) {
    var p = ym.split('-'); return MONTHS_TITLE[Number(p[1]) - 1] + ' ' + p[0];
  }

  // ------------------------------------------------------------------
  // MUAT DATA
  // ------------------------------------------------------------------
  async function fetchApiData(bulan) {
    var headers = {};
    var token = currentAccessToken();
    if (token) headers['Authorization'] = 'Bearer ' + token;
    var url = '/api/visualization/data?dataType=kpi_9_2' + (bulan ? ('&bulan=' + encodeURIComponent(bulan)) : '');
    var res = await fetch(url, { headers: headers });
    if (!res.ok) throw new Error('Gagal memuat data (HTTP ' + res.status + ')');
    return res.json();
  }

  function showLoadingState() {
    document.getElementById('locTables').innerHTML = '<div style="padding:20px;color:var(--ink-faint);font-size:13px;">Memuat data…</div>';
  }
  function showErrorState(err) {
    document.getElementById('locTables').innerHTML = '<div style="padding:20px;color:var(--low);font-size:13px;">Gagal memuat data: ' + err.message + ' — coba muat ulang halaman.</div>';
  }

  async function loadMonth(bulan) {
    showLoadingState();
    try {
      state = await fetchApiData(bulan);
    } catch (err) {
      showErrorState(err);
      return;
    }
    renderAll();
  }

  async function reloadSameMonth() {
    try {
      state = await fetchApiData(state.bulan);
    } catch (err) {
      showErrorState(err);
      return;
    }
    renderAll();
  }

  // ------------------------------------------------------------------
  // RENDER TABEL PER LOKASI (harian) -- sama persis 18.4
  // ------------------------------------------------------------------
  function numCell(v, dec) {
    var hasData = v !== null && v !== undefined;
    var val = hasData ? fmt(v, dec) : "";
    var cls = hasData ? "web" : "empty";
    var hidePrint = (!hasData && printMode);
    return '<td class="real"><div class="cellwrap ' + cls + '">' +
      '<span class="cellnum">' + (hasData ? val : (hidePrint ? '' : '—')) + '</span></div></td>';
  }

  function elevCell(row, loc, elevasi, on) {
    if (isAdmin) {
      return '<td class="elev-cell"><button type="button" class="elev-btn ' + (on ? 'on' : 'off') + '" ' +
        'data-date="' + row.tanggal + '" data-loc="' + loc + '" data-e="' + elevasi + '">' + (on ? 'ON' : 'OFF') + '</button></td>';
    }
    return '<td class="elev-cell"><span class="elev-tag ' + (on ? 'on' : 'off') + '">' + (on ? 'ON' : 'OFF') + '</span></td>';
  }

  function buildLocTable(locData) {
    var html = '<div class="tablecard loc-card">';
    html += '<div class="loc-head">' + locData.title + '</div>';
    html += '<div class="scrollx"><table class="kpi kual-table"><thead>' +
      '<tr class="r1">' +
        '<th rowspan="2" style="min-width:70px;">TANGGAL</th>' +
        '<th rowspan="2" style="min-width:74px;">LEVEL<br><span class="unit">(m)</span></th>' +
        '<th colspan="3">ELEVASI</th>' +
        '<th rowspan="2" style="min-width:64px;">NTU</th>' +
        '<th rowspan="2" style="min-width:64px;">PH</th>' +
      '</tr>' +
      '<tr class="r2"><th>3</th><th>5</th><th>7</th></tr>' +
      '</thead><tbody>';

    locData.rows.forEach(function (row) {
      html += '<tr>';
      html += '<td class="no">' + row.d + '</td>';
      html += numCell(row.level, 2);
      html += elevCell(row, locData.key, 3, row.e3);
      html += elevCell(row, locData.key, 5, row.e5);
      html += elevCell(row, locData.key, 7, row.e7);
      html += numCell(row.ntu, 2);
      html += numCell(row.ph, 2);
      html += '</tr>';
    });

    var s = locData.summary;
    function sumRow(label, key) {
      return '<tr class="avg"><td>' + label + '</td>' +
        '<td><div class="cellwrap"><span class="cellnum">' + (s.level[key] !== null ? fmt(s.level[key], 2) : '') + '</span></div></td>' +
        '<td></td><td></td><td></td>' +
        '<td><div class="cellwrap"><span class="cellnum">' + (s.ntu[key] !== null ? fmt(s.ntu[key], 2) : '') + '</span></div></td>' +
        '<td><div class="cellwrap"><span class="cellnum">' + (s.ph[key] !== null ? fmt(s.ph[key], 2) : '') + '</span></div></td></tr>';
    }
    html += sumRow('Rata rata', 'avg');
    html += sumRow('Tertinggi', 'max');
    html += sumRow('Terendah', 'min');

    html += '</tbody></table></div></div>';
    return html;
  }

  function renderTables() {
    var wrap = document.getElementById('locTables');
    wrap.innerHTML = state.locations.map(buildLocTable).join('');

    if (!isAdmin) return;
    wrap.querySelectorAll('.elev-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        toggleElevasi(btn.dataset.date, btn.dataset.loc, Number(btn.dataset.e), btn.classList.contains('on'));
      });
    });
  }

  function renderStats() {
    var stat = document.getElementById("statRow");
    var html = '';
    state.locations.forEach(function (loc) {
      html += '<div class="stat"><div class="k">Level ' + loc.label + '</div><div class="v">' +
        (loc.summary.level.avg !== null ? fmt(loc.summary.level.avg, 2) + ' m' : '–') + '</div></div>';
      html += '<div class="stat"><div class="k">NTU ' + loc.label + '</div><div class="v">' +
        (loc.summary.ntu.avg !== null ? fmt(loc.summary.ntu.avg, 1) : '–') + '</div></div>';
    });
    stat.innerHTML = html;
  }

  function renderElevHint() {
    var el = document.getElementById('elevHint');
    if (isAdmin) {
      el.innerHTML = '💡 Klik status <b>ON/OFF</b> di kolom Elevasi untuk mengubah pintu air mulai tanggal itu — status <b>berlaku terus sampai diubah lagi</b> (termasuk bulan berikutnya), bukan hanya hari itu. Bisa lebih dari satu elevasi ON bersamaan.';
      el.style.display = '';
    } else {
      el.style.display = 'none';
    }
  }

  // ------------------------------------------------------------------
  // TOGGLE STATUS ELEVASI (carry-forward) -- data sama dengan 18.4.
  // ------------------------------------------------------------------
  async function saveElevasiToggle(dateStr, loc, elevasi, on) {
    var token = currentAccessToken();
    var res = await fetch('/api/visualization/admin-input', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ kind: 'kualitas_elevasi', tanggal: dateStr, lokasi: loc, elevasi: elevasi, on: on })
    });
    if (!res.ok) { var d = await res.json().catch(function () { return {}; }); throw new Error(d.error || ('HTTP ' + res.status)); }
  }

  async function toggleElevasi(dateStr, loc, elevasi, currentlyOn) {
    if (!isAdmin) return;
    var newVal = !currentlyOn;
    try {
      await saveElevasiToggle(dateStr, loc, elevasi, newVal);
      await reloadSameMonth();
      toast('Elevasi ' + elevasi + ' ' + (loc === 'manggar' ? 'Manggar' : 'Teritip') + ' ' + (newVal ? 'ON' : 'OFF') +
        ' mulai ' + dateStr + ' — berlaku terus sampai diubah lagi.');
    } catch (err) {
      toast('Gagal menyimpan: ' + err.message);
    }
  }

  // ------------------------------------------------------------------
  // PENANDATANGAN 3 KOLOM & KODE DOKUMEN (global, tabel kpi_9_2_meta)
  // ------------------------------------------------------------------
  async function saveMeta() {
    var token = currentAccessToken();
    var body = {
      kind: 'kpi_9_2_meta',
      roleDiketahui: document.getElementById('role1').value,
      nameDiketahui: document.getElementById('name1').value,
      roleMengetahui: document.getElementById('role2').value,
      nameMengetahui: document.getElementById('name2').value,
      namePelaksana: document.getElementById('name3').value,
      footerCode: document.getElementById('footerCode').value
    };
    var res = await fetch('/api/visualization/admin-input', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify(body)
    });
    if (!res.ok) { var d = await res.json().catch(function () { return {}; }); throw new Error(d.error || ('HTTP ' + res.status)); }
    state.meta.roleDiketahui = body.roleDiketahui; state.meta.nameDiketahui = body.nameDiketahui;
    state.meta.roleMengetahui = body.roleMengetahui; state.meta.nameMengetahui = body.nameMengetahui;
    state.meta.namePelaksana = body.namePelaksana; state.meta.footerCode = body.footerCode;
  }

  function renderSign() {
    var meta = state.meta;
    document.getElementById('role1').value = meta.roleDiketahui || '';
    document.getElementById('name1').value = meta.nameDiketahui || '';
    document.getElementById('role2').value = meta.roleMengetahui || '';
    document.getElementById('name2').value = meta.nameMengetahui || '';
    document.getElementById('name3').value = meta.namePelaksana || '';
    document.getElementById('footerCode').value = meta.footerCode || '';
    ['role1', 'name1', 'role2', 'name2', 'name3', 'footerCode'].forEach(function (id) {
      document.getElementById(id).readOnly = !isAdmin;
    });
  }

  function wireSignatureControls() {
    ['role1', 'name1', 'role2', 'name2', 'name3', 'footerCode'].forEach(function (id) {
      document.getElementById(id).addEventListener('change', async function () {
        if (!isAdmin) return;
        try { await saveMeta(); toast('Penandatangan disimpan.'); }
        catch (err) { toast('Gagal menyimpan: ' + err.message); }
      });
    });
  }

  function renderMonthSelect() {
    var sel = document.getElementById("monthSelect");
    var months = state.availableMonths && state.availableMonths.length ? state.availableMonths : [state.bulan];
    sel.innerHTML = months.map(function (ym) {
      return '<option value="' + ym + '"' + (ym === state.bulan ? ' selected' : '') + '>' + monthLabel(ym) + '</option>';
    }).join("");
  }

  function renderStatusBadge() {
    var badge = document.getElementById('statusBadge');
    if (state.locked) {
      badge.innerHTML = '<span class="status-pill warn">Data Contoh (Terkunci)</span>';
      return;
    }
    badge.innerHTML = '<span class="status-pill good">Data Asli — ' + monthLabel(state.bulan) + '</span>';
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
    renderMonthSelect();
    renderStatusBadge();
    updateLockBanner();
    updateDownloadButton();
    renderElevHint();
    renderStats();
    renderTables();
    renderSign();
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
  document.getElementById("monthSelect").addEventListener("change", function (e) {
    loadMonth(e.target.value);
  });

  var printSwitch = document.getElementById("printSwitch");
  printSwitch.addEventListener("click", function () {
    printMode = !printMode;
    printSwitch.classList.toggle("on", printMode);
    renderTables();
  });

  var fetching = false;
  document.getElementById("fetchBtn").addEventListener("click", async function () {
    if (fetching) return;
    fetching = true;
    var btn = document.getElementById("fetchBtn");
    var oldHtml = btn.innerHTML;
    btn.innerHTML = '<span class="spin"></span> Menarik dari Data Air Baku…';
    btn.disabled = true;
    await reloadSameMonth();
    btn.innerHTML = oldHtml;
    btn.disabled = false;
    fetching = false;
    toast("Data terbaru dari Data Air Baku berhasil ditarik.");
  });

  // ------------------------------------------------------------------
  // UNDUH EXCEL -- dibangun di SERVER (exceljs), lihat catatan di
  // lib/visualization/kpi.js.
  // ------------------------------------------------------------------
  document.getElementById("downloadBtn").addEventListener("click", async function () {
    if (!isAdmin) {
      alert('Unduh Excel khusus admin. Silakan login admin terlebih dahulu.');
      window.location.href = '../../login.html?redirect=' + encodeURIComponent('apps/kpi-sab/kualitas-9-2.html');
      return;
    }
    var btn = document.getElementById('downloadBtn');
    var oldText = btn.textContent;
    btn.disabled = true; btn.textContent = 'Menyiapkan Excel...';
    try {
      var token = currentAccessToken();
      if (isAdmin) { try { await saveMeta(); } catch (e) {} }
      var apiUrl = '/api/visualization/data?dataType=kpi_9_2_xlsx&bulan=' + encodeURIComponent(state.bulan);
      var res = await fetch(apiUrl, { headers: { 'Authorization': 'Bearer ' + token } });
      if (!res.ok) {
        var d = await res.json().catch(function () { return {}; });
        throw new Error(d.error || ('HTTP ' + res.status));
      }
      var blob = await res.blob();
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = '9.2 Laporan Kualitas Air Baku ' + monthLabel(state.bulan) + '.xlsx';
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
  // AKSES DATA VITAL -- modal "Minta Akses" + polling + auto-unlock, disalin
  // dari kualitas.js.
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
    var message = 'Halo, saya' + namaPart + ' baru saja mengirim permintaan akses data 9.2 Laporan Kualitas Air Baku di website, mohon persetujuannya.';
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
        body: JSON.stringify({ requestedBy: nama, dataType: 'kpi_9_2', reason: alasan || undefined })
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
        await reloadSameMonth();
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
      reloadSameMonth();
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
    wireSignatureControls();
    restoreVizSession();
    await loadMonth(null);
  }

  init();
})();
