(function () {
  "use strict";

  var MONTHS_TITLE = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
  var SHORT = { gunung_sari: 'Gunung Sari', prapatan: 'Prapatan', kampung_damai: 'Kp Damai', zamp: 'Zamp', kampung_baru_ulu: 'Kampung Baru' };

  var state = null;       // respons /api/visualization/data?dataType=kpi_9_7
  var isAdmin = false;
  var activeInst = null;

  // --- akses data asli: token JWT admin (localStorage) atau token viz-access
  // hasil approve email -- pola sama dengan kondisi-9-3.js. ---
  var vizToken = null, vizTokenExpiresAt = null, vizRequestId = null, vizRequestSecret = null;
  var pollTimer = null, expiryTimer = null;

  function currentAccessToken() { return localStorage.getItem('token') || vizToken || null; }

  function monthLabel(ym) {
    var p = ym.split('-'); return MONTHS_TITLE[Number(p[1]) - 1] + ' ' + p[0];
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function fmtNum(n) {
    if (n === null || n === undefined || isNaN(n)) return '—';
    return (Math.round(Number(n) * 100) / 100).toLocaleString('id-ID');
  }

  // ------------------------------------------------------------------
  // MUAT DATA
  // ------------------------------------------------------------------
  async function fetchApiData(bulan) {
    var url = '/api/visualization/data?dataType=kpi_9_7' + (bulan ? ('&bulan=' + encodeURIComponent(bulan)) : '');
    var headers = {};
    var token = currentAccessToken();
    if (token) headers['Authorization'] = 'Bearer ' + token;
    var res = await fetch(url, { headers: headers });
    if (!res.ok) throw new Error('Gagal memuat data (HTTP ' + res.status + ')');
    return res.json();
  }

  async function loadMonth(bulan) {
    try { state = await fetchApiData(bulan); }
    catch (err) { toast('Gagal memuat data: ' + err.message); return; }
    if (!activeInst || !state.ipas.some(function (i) { return i.installation === activeInst; })) {
      activeInst = state.ipas[0].installation;
    }
    renderAll();
  }
  async function reloadSameMonth() {
    try { state = await fetchApiData(state.bulan); }
    catch (err) { toast('Gagal memuat data: ' + err.message); return; }
    renderAll();
  }

  // ------------------------------------------------------------------
  // RENDER: tab sub-menu + panel tiap IPA
  // ------------------------------------------------------------------
  function renderTabs() {
    var el = document.getElementById('ipaTabs');
    el.innerHTML = state.ipas.map(function (ipa) {
      var cls = ipa.installation === activeInst ? 'tab active' : 'tab';
      return '<button type="button" class="' + cls + '" data-inst="' + ipa.installation + '">' + esc(SHORT[ipa.installation] || ipa.installation) + '</button>';
    }).join('');
  }

  function rowHtml(r) {
    var ro = !isAdmin ? ' readonly disabled' : '';
    return '<tr>' +
      '<td><input class="f-no" value="' + esc(r.no) + '"' + ro + '></td>' +
      '<td><input class="f-merk" value="' + esc(r.merk) + '"' + ro + '></td>' +
      '<td><input class="f-type" value="' + esc(r.type) + '"' + ro + '></td>' +
      '<td class="web lvl">' + fmtNum(r.levelLaluStatis) + '</td>' +
      '<td class="web lvl">' + fmtNum(r.levelLaluDinamis) + '</td>' +
      '<td class="web lvl">' + fmtNum(r.levelIniStatis) + '</td>' +
      '<td class="web lvl">' + fmtNum(r.levelIniDinamis) + '</td>' +
      '<td><input class="f-np" value="' + esc(r.namePlate) + '"' + ro + '></td>' +
      '<td class="web real">' + fmtNum(r.realLalu) + '</td>' +
      '<td class="web real">' + fmtNum(r.realIni) + '</td>' +
      '<td class="keterangan"><input class="f-ket" value="' + esc(r.keterangan) + '"' + ro + '></td>' +
      '<td>' + (isAdmin ? '<button type="button" class="del-row" title="Hapus baris">✕</button>' : '') + '</td>' +
      '</tr>';
  }

  function ipaPanelHtml(ipa) {
    var meta = state.meta || {};
    var halNo = (meta.halaman || {})[ipa.installation] || ipa.halDefault;
    var totalHalaman = meta.totalHalaman || '5';
    var ro = !isAdmin ? ' readonly disabled' : '';
    var rowsHtml = (ipa.rows || []).map(rowHtml).join('');
    var isLast = ipa.installation === 'kampung_baru_ulu';

    var html = '<div class="tablecard loc-card">' +
      '<div class="loc-head">' + esc(ipa.lokasi) + ' — <span class="k97-tanggal">' + esc(ipa.tanggal) + '</span></div>' +
      '<div class="k97-meta-grid">' +
        '<div class="field"><label>Lokasi</label><input value="' + esc(ipa.lokasi) + '" readonly></div>' +
        '<div class="field"><label>Tanggal (otomatis)</label><input value="' + esc(ipa.tanggal) + '" readonly></div>' +
        '<div class="field"><label>Hal</label><input class="f-hal" value="' + esc(halNo) + '"' + ro + '></div>' +
        '<div class="field"><label>Dari</label><input class="f-dari" value="' + esc(totalHalaman) + '"' + ro + '></div>' +
      '</div>' +
      '<div class="scrollx"><table class="kpi k97-edit">' +
        '<thead>' +
        '<tr><th>NO</th><th>MERK</th><th>TYPE</th><th colspan="2">LEVEL BULAN LALU (m)</th><th colspan="2">LEVEL BULAN INI (m)</th><th>NAME PLATE</th><th>REALITA BLN.LALU</th><th>REALITA BLN.INI</th><th>KETERANGAN</th><th style="width:44px;"></th></tr>' +
        '<tr><th></th><th></th><th></th><th>STATIS</th><th>DYNAMIS</th><th>STATIS</th><th>DYNAMIS</th><th></th><th>(m3/h)</th><th>(m3/h)</th><th></th><th></th></tr>' +
        '</thead><tbody>' + rowsHtml + '</tbody></table></div>' +
      '<div class="edit-actions">' +
        (isAdmin ? '<button type="button" class="dl-btn dl-btn-ghost add-row">＋ Tambah Baris</button>' : '') +
        '<button type="button" class="dl-btn dl-btn-admin save-ipa"' + (isAdmin ? '' : ' disabled') + '>💾 Simpan</button>' +
        '<span class="hint save-status"></span>' +
      '</div>' +
      '<div class="k97-catatan"><label>Catatan (satu baris per butir)</label>' +
        '<textarea class="catatan-input" rows="3" spellcheck="false"' + (isAdmin ? '' : ' disabled') + '>' + esc(ipa.catatan) + '</textarea></div>' +
      '</div>';

    if (isLast) {
      html += '<div class="card k97-sign-card">' +
        '<h3>Penandatangan — Hal 5 (IPA Kampung Baru)</h3>' +
        '<div class="jk-signs">' +
          '<div class="signitem"><div class="fixed-label">Diketahui</div><input class="role-input" id="sigRole1" placeholder="Jabatan"'+ro+'><div class="signature-space"></div><input class="name" id="sigName1"'+ro+'></div>' +
          '<div class="signitem"><div class="fixed-label">Mengetahui / Menyetujui</div><input class="role-input" id="sigRole2" placeholder="Jabatan"'+ro+'><div class="signature-space"></div><input class="name" id="sigName2"'+ro+'></div>' +
          '<div class="signitem"><div class="fixed-label">Pelaksana</div><div class="signature-space"></div><input class="name" id="sigName3" placeholder="Nama pelaksana"'+ro+'></div>' +
        '</div>' +
        '<div class="jk-footer-row"><label>Kode dokumen</label><input type="text" id="sigCode"'+ro+'></div>' +
        '<div class="edit-actions"><button type="button" class="dl-btn dl-btn-admin save-meta"' + (isAdmin ? '' : ' disabled') + '>💾 Simpan Penandatangan</button><span class="hint meta-status"></span></div>' +
        '</div>';
    }

    return '<div class="ipa-panel" data-inst="' + ipa.installation + '" style="' + (ipa.installation === activeInst ? '' : 'display:none') + '">' + html + '</div>';
  }

  function renderPanels() {
    var wrap = document.getElementById('ipaView');
    wrap.innerHTML = state.ipas.map(ipaPanelHtml).join('');
    // isi meta penandatangan
    var meta = state.meta || {};
    var s = function (id, v) { var el = document.getElementById(id); if (el) el.value = v == null ? '' : v; };
    s('sigRole1', meta.roleDiketahui); s('sigName1', meta.nameDiketahui);
    s('sigRole2', meta.roleMengetahui); s('sigName2', meta.nameMengetahui);
    s('sigName3', meta.namePelaksana); s('sigCode', meta.footerCode);
  }

  function renderStatusBadge() {
    var badge = document.getElementById('statusBadge');
    if (state.locked) {
      badge.innerHTML = '<span class="status-pill warn">Data Contoh (Terkunci)</span>';
      return;
    }
    badge.innerHTML = '<span class="status-pill good">Data Asli — ' + monthLabel(state.bulan) + '</span>';
  }

  function renderMonthSelect() {
    var sel = document.getElementById('monthSelect');
    var months = state.availableMonths && state.availableMonths.length ? state.availableMonths : [state.bulan];
    sel.innerHTML = months.map(function (ym) {
      return '<option value="' + ym + '"' + (ym === state.bulan ? ' selected' : '') + '>' + monthLabel(ym) + '</option>';
    }).join('');
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
    renderTabs();
    renderPanels();
  }

  function toast(msg) {
    var t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._h);
    t._h = setTimeout(function () { t.classList.remove('show'); }, 2800);
  }

  // ------------------------------------------------------------------
  // KOLEKSI & SIMPAN per IPA + meta
  // ------------------------------------------------------------------
  function collectIpa(panel) {
    var rows = [];
    panel.querySelectorAll('tbody tr').forEach(function (tr) {
      rows.push({
        no: (tr.querySelector('.f-no') || {}).value || '',
        merk: (tr.querySelector('.f-merk') || {}).value || '',
        type: (tr.querySelector('.f-type') || {}).value || '',
        namePlate: (tr.querySelector('.f-np') || {}).value || '',
        keterangan: (tr.querySelector('.f-ket') || {}).value || ''
      });
    });
    var cat = panel.querySelector('.catatan-input');
    return { rows: rows, catatan: cat ? cat.value : '' };
  }

  async function saveIpa(panel, inst) {
    if (!isAdmin) return;
    var btn = panel.querySelector('.save-ipa');
    var status = panel.querySelector('.save-status');
    btn.disabled = true; status.textContent = 'Menyimpan...';
    try {
      var data = collectIpa(panel);
      var res = await fetch('/api/visualization/admin-input', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + currentAccessToken() },
        body: JSON.stringify({ kind: 'kpi_9_7_items', bulan: state.bulan, installation: inst, rows: data.rows, catatan: data.catatan })
      });
      if (!res.ok) { var d = await res.json().catch(function () { return {}; }); throw new Error(d.error || ('HTTP ' + res.status)); }
      // Simpan per IPA -- TIDAK reload ulang supaya isian di tab lain yang
      // belum disimpan tidak hilang.
      status.textContent = 'Tersimpan ✓';
    } catch (err) {
      status.textContent = 'Gagal menyimpan: ' + err.message;
    }
    btn.disabled = false;
    setTimeout(function () { if (status) status.textContent = ''; }, 2500);
  }

  function collectMeta() {
    var halaman = {};
    document.querySelectorAll('.ipa-panel').forEach(function (panel) {
      var inst = panel.getAttribute('data-inst');
      var hal = panel.querySelector('.f-hal');
      if (hal) halaman[inst] = hal.value.trim();
    });
    // "Dari" (total halaman) dibaca dari panel yang sedang aktif.
    var activePanel = document.querySelector('.ipa-panel[data-inst="' + activeInst + '"]');
    var dari = activePanel ? activePanel.querySelector('.f-dari') : null;
    var val = function (id) { var el = document.getElementById(id); return el ? el.value : ''; };
    return {
      kind: 'kpi_9_7_meta',
      roleDiketahui: val('sigRole1'), nameDiketahui: val('sigName1'),
      roleMengetahui: val('sigRole2'), nameMengetahui: val('sigName2'),
      namePelaksana: val('sigName3'), footerCode: val('sigCode'),
      totalHalaman: dari ? dari.value.trim() : '',
      halaman: halaman
    };
  }

  async function saveMeta() {
    if (!isAdmin) return;
    var btn = document.querySelector('.save-meta');
    var status = document.querySelector('.meta-status');
    if (btn) { btn.disabled = true; }
    if (status) status.textContent = 'Menyimpan...';
    try {
      var res = await fetch('/api/visualization/admin-input', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + currentAccessToken() },
        body: JSON.stringify(collectMeta())
      });
      if (!res.ok) { var d = await res.json().catch(function () { return {}; }); throw new Error(d.error || ('HTTP ' + res.status)); }
      if (status) status.textContent = 'Tersimpan ✓';
    } catch (err) {
      if (status) status.textContent = 'Gagal menyimpan: ' + err.message;
    }
    if (btn) btn.disabled = false;
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

  document.getElementById('ipaTabs').addEventListener('click', function (e) {
    var btn = e.target.closest('.tab');
    if (!btn) return;
    activeInst = btn.getAttribute('data-inst');
    document.querySelectorAll('#ipaTabs .tab').forEach(function (t) { t.classList.remove('active'); });
    btn.classList.add('active');
    document.querySelectorAll('.ipa-panel').forEach(function (panel) {
      panel.style.display = panel.getAttribute('data-inst') === activeInst ? '' : 'none';
    });
  });

  document.getElementById('ipaView').addEventListener('click', function (e) {
    var panel = e.target.closest('.ipa-panel');
    if (!panel) return;
    var inst = panel.getAttribute('data-inst');
    if (e.target.closest('.add-row')) {
      var tbody = panel.querySelector('tbody');
      var tr = document.createElement('tr');
      tr.innerHTML = '<td><input class="f-no"></td>' +
        '<td><input class="f-merk" placeholder="Merk"></td>' +
        '<td><input class="f-type" placeholder="Type"></td>' +
        '<td class="web lvl">—</td><td class="web lvl">—</td><td class="web lvl">—</td><td class="web lvl">—</td>' +
        '<td><input class="f-np" placeholder="Name plate"></td>' +
        '<td class="web real">—</td><td class="web real">—</td>' +
        '<td class="keterangan"><input class="f-ket" placeholder="Keterangan"></td>' +
        '<td><button type="button" class="del-row" title="Hapus baris">✕</button></td>';
      tbody.appendChild(tr);
      var first = tr.querySelector('input');
      if (first) first.focus();
    } else if (e.target.closest('.del-row')) {
      var r = e.target.closest('tr');
      if (r) r.remove();
    } else if (e.target.closest('.save-ipa')) {
      saveIpa(panel, inst);
    } else if (e.target.closest('.save-meta')) {
      saveMeta();
    }
  });

  // ------------------------------------------------------------------
  // UNDUH EXCEL -- dibangun di SERVER (exceljs), lihat lib/visualization/kpi.js.
  // ------------------------------------------------------------------
  document.getElementById('downloadBtn').addEventListener('click', async function () {
    if (!isAdmin) {
      alert('Unduh Excel khusus admin. Silakan login admin terlebih dahulu.');
      window.location.href = '../../login.html?redirect=' + encodeURIComponent('apps/kpi-sab/kondisi-sumur-9-7.html');
      return;
    }
    var btn = this;
    var oldText = btn.textContent;
    btn.disabled = true; btn.textContent = 'Menyiapkan Excel...';
    try {
      if (isAdmin) { try { await saveMeta(); } catch (e) {} }
      var apiUrl = '/api/visualization/data?dataType=kpi_9_7_xlsx&bulan=' + encodeURIComponent(state.bulan);
      var res = await fetch(apiUrl, { headers: { 'Authorization': 'Bearer ' + currentAccessToken() } });
      if (!res.ok) { var d = await res.json().catch(function () { return {}; }); throw new Error(d.error || ('HTTP ' + res.status)); }
      var blob = await res.blob();
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = '9.7 Laporan Kondisi Air Sumur ' + monthLabel(state.bulan) + '.xlsx';
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast('Gagal mengunduh Excel: ' + err.message);
    }
    btn.disabled = false; btn.textContent = oldText;
  });

  // ------------------------------------------------------------------
  // AKSES DATA VITAL -- modal "Minta Akses" + polling + auto-unlock (pola
  // kondisi-9-3.js / kualitas.js).
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
    var message = 'Halo, saya' + namaPart + ' baru saja mengirim permintaan akses data 9.7 Laporan Kondisi Air Sumur di website, mohon persetujuannya.';
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
        body: JSON.stringify({ requestedBy: nama, dataType: 'kpi_9_7', reason: alasan || undefined })
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
  function checkAdminStatus() {
    var token = localStorage.getItem('token');
    var role = localStorage.getItem('role');
    isAdmin = !!(token && role === 'admin');
  }

  async function init() {
    checkAdminStatus();
    wireAccessControls();
    restoreVizSession();
    await loadMonth(null);
  }

  init();
})();
