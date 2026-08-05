(function () {
  "use strict";

  var MONTHS = ["JANUARI", "FEBRUARI", "MARET", "APRIL", "MEI", "JUNI", "JULI", "AGUSTUS", "SEPTEMBER", "OKTOBER", "NOVEMBER", "DESEMBER"];

  var state = null;      // respons terakhir dari /api/visualization/data?dataType=kpi_18_1a
  var currentPeriod = 0; // 0 = Jan-Jun, 1 = Jul-Des
  var isAdmin = false;

  // --- akses data asli: token JWT admin (localStorage) atau token viz-access
  // hasil approve email -- pola & fungsi sama persis dengan pengambilan.js. ---
  var vizToken = null, vizTokenExpiresAt = null, vizRequestId = null, vizRequestSecret = null;
  var pollTimer = null, expiryTimer = null;

  function currentAccessToken() { return localStorage.getItem('token') || vizToken || null; }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function fmt(n) {
    if (n === null || n === undefined || isNaN(n)) return "";
    return n.toLocaleString("id-ID", { maximumFractionDigits: 0 });
  }
  function ratioClass(pct) {
    if (pct === null) return "dim";
    if (pct >= 95) return "good";
    if (pct >= 85) return "warn";
    return "bad";
  }
  function monthIndexesFor(period) { return period === 0 ? [0, 1, 2, 3, 4, 5] : [6, 7, 8, 9, 10, 11]; }

  // ------------------------------------------------------------------
  // MUAT DATA
  // ------------------------------------------------------------------
  async function fetchApiData(tahun) {
    var headers = {};
    var token = currentAccessToken();
    if (token) headers['Authorization'] = 'Bearer ' + token;
    var url = '/api/visualization/data?dataType=kpi_18_1a' + (tahun ? ('&tahun=' + encodeURIComponent(tahun)) : '');
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
    currentPeriod = 0;
    document.querySelectorAll('.tab').forEach(function (t, i) { t.classList.toggle('active', i === 0); });
    renderAll();
  }

  async function reloadSameYear() {
    try {
      state = await fetchApiData(state.year);
    } catch (err) {
      showErrorState(err);
      return;
    }
    renderAll();
  }

  // ------------------------------------------------------------------
  // RENDER TABEL (format sama file 18.1A: ANGG/REAL/±/% per bulan)
  // ------------------------------------------------------------------
  function buildHead(period) {
    var idxs = monthIndexesFor(period);
    var r1 = '<tr class="r1"><th rowspan="3" style="min-width:34px;">NO</th><th rowspan="3" style="min-width:170px;">URAIAN</th>';
    idxs.forEach(function (mi) { r1 += '<th class="month" colspan="4">' + MONTHS[mi] + '</th>'; });
    r1 += '</tr>';
    var r2 = '<tr class="r2">';
    idxs.forEach(function () { r2 += '<th>ANGG</th><th>REAL</th><th colspan="2">RATIO EFFISIENSI</th>'; });
    r2 += '</tr>';
    var r3 = '<tr class="r3">';
    idxs.forEach(function () { r3 += '<th></th><th></th><th>±</th><th>%</th>'; });
    r3 += '</tr>';
    return r1 + r2 + r3;
  }

  // ANGG konstan per instalasi (jumlah sumur aktif), ditulis di tiap bulan
  // yang SUDAH ada datanya. Bulan kosong (real null) dikosongkan semua.
  function cellAngg(g, mi) {
    var has = g.real[mi] !== null && g.real[mi] !== undefined && g.angg > 0;
    var val = has ? fmt(g.angg) : "";
    return '<td class="angg"><div class="cellwrap"><span class="cellnum">' + val + '</span></div></td>';
  }

  function cellReal(g, mi) {
    var v = g.real[mi];
    var has = v !== null && v !== undefined && v > 0;
    var cls = has ? "web" : "empty";
    var val = has ? fmt(v) : "";
    return '<td class="real"><div class="cellwrap ' + cls + '"><span class="cellnum">' + val + '</span></div></td>';
  }

  function cellRatio(g, mi, kind) {
    var angg = g.angg, real = g.real[mi];
    var has = real !== null && real !== undefined && angg > 0 && real > 0;
    if (!has) return '<td class="ratio"><div class="cellwrap"></div></td>';
    var pm = real - angg;
    var pct = real / angg * 100;
    var val = kind === "pm" ? pm : pct;
    var text = kind === "pm" ? (pm >= 0 ? "+" : "") + fmt(pm) : fmt(pct, 1) + "%";
    var cls = ratioClass(pct);
    return '<td class="ratio"><div class="cellwrap"><span class="pill ' + cls + '">' + text + '</span></div></td>';
  }

  function renderTable() {
    var table = document.getElementById("mainTable");
    var idxs = monthIndexesFor(currentPeriod);
    var html = "<thead>" + buildHead(currentPeriod) + "</thead><tbody>";

    state.groups.forEach(function (g, gi) {
      html += '<tr><td class="no">' + (gi + 1) + '</td><td class="name">' + g.label + '</td>';
      idxs.forEach(function (mi) {
        html += cellAngg(g, mi) + cellReal(g, mi) + cellRatio(g, mi, "pm") + cellRatio(g, mi, "pct");
      });
      html += '</tr>';
    });

    // RATA - RATA = penjumlahan ANGG/REAL per bulan; ± dikosongkan persis file
    // contoh. Bulan kosong (belum ada data) ikut dikosongkan, bukan diisi 0.
    html += '<tr class="sum"><td class="no"></td><td class="name">RATA - RATA</td>';
    idxs.forEach(function (mi) {
      var sumAngg = 0, sumReal = 0, any = false;
      state.groups.forEach(function (g) {
        var rv = g.real[mi];
        if (rv !== null && rv !== undefined) { sumReal += rv; sumAngg += (g.angg || 0); any = true; }
      });
      if (!any) {
        html += '<td class="angg"></td><td class="real"></td><td class="ratio"></td><td class="ratio"></td>';
      } else {
        html += '<td class="angg"><div class="cellwrap"><span class="cellnum">' + fmt(sumAngg) + '</span></div></td>';
        html += '<td class="real"><div class="cellwrap web"><span class="cellnum">' + fmt(sumReal) + '</span></div></td>';
        html += '<td class="ratio"></td>';
        html += '<td class="ratio"><div class="cellwrap"><span class="pill ' + ratioClass(sumReal / sumAngg * 100) + '">' +
          fmt(sumReal / sumAngg * 100, 1) + '%</span></div></td>';
      }
    });
    html += '</tr>';

    html += '</tbody>';
    table.innerHTML = html;

    document.getElementById("tableFoot").innerHTML =
      'ANGG: <b>jumlah sumur aktif</b> per IPA (daftar sumur level, Data Waduk &amp; Sumur) · ' +
      'REAL: <b>jumlah sumur terukur</b> bulan itu — punya data statis <i>atau</i> dinamis dihitung 1 sumur, dua-duanya kosong baru dianggap 0.';
  }

  function renderStats() {
    var idxs = monthIndexesFor(currentPeriod);

    // Bulan TERAKHIR yang ada Realisasi-nya di periode yang ditampilkan.
    var lastMonth = null;
    for (var k = idxs.length - 1; k >= 0; k--) {
      var mi = idxs[k];
      var any = state.groups.some(function (g) { return g.real[mi] > 0; });
      if (any) { lastMonth = mi; break; }
    }
    var totalReal = state.groups.reduce(function (s, g) { return s + (lastMonth !== null ? (g.real[lastMonth] || 0) : 0); }, 0);
    var totalAngg = state.groups.reduce(function (s, g) { return s + (g.angg || 0); }, 0);
    var pct = (lastMonth !== null && totalAngg > 0) ? (totalReal / totalAngg * 100) : null;
    var cls = pct === null ? "" : (pct >= 95 ? "good" : (pct >= 85 ? "warn" : ""));

    var stat = document.getElementById("statRow");
    var html = '';
    state.groups.forEach(function (g) {
      html += '<div class="stat"><div class="k">Terukur ' + g.label + (lastMonth !== null ? ' (' + MONTHS[lastMonth] + ')' : '') + '</div><div class="v">' +
        (lastMonth !== null ? fmt(g.real[lastMonth]) + ' / ' + fmt(g.angg) + ' sumur' : '–') + '</div></div>';
    });
    html += '<div class="stat"><div class="k">Total' + (lastMonth !== null ? ' (' + MONTHS[lastMonth] + ')' : '') + '</div><div class="v">' +
      (lastMonth !== null ? fmt(totalReal) + ' / ' + fmt(totalAngg) + ' sumur' : '–') + '</div></div>';
    html += '<div class="stat"><div class="k">Capaian' + (lastMonth !== null ? ' (' + MONTHS[lastMonth] + ')' : '') + '</div><div class="v ' + cls + '">' +
      (pct !== null ? fmt(pct, 1) + '%' : '–') + '</div></div>';
    stat.innerHTML = html;
  }

  // ------------------------------------------------------------------
  // DAFTAR SUMUR & STATUS AKTIF -- panel di bawah tabel. Hanya sumur AKTIF
  // yang dihitung sebagai ANGG; toggle status khusus admin (disimpan di kolom
  // active tabel sumur_wells lewat admin-library action=wells).
  // ------------------------------------------------------------------
  function renderWells() {
    var wrap = document.getElementById('wellList');
    var html = '';
    state.groups.forEach(function (g) {
      html += '<div class="well-group"><div class="well-ipa">' + esc(g.label) +
        ' <span class="well-count">' + g.angg + ' aktif</span></div><div class="well-chips">';
      var list = g.wells || [];
      list.forEach(function (w) {
        var on = !!w.active;
        html += '<button type="button" class="well-chip ' + (on ? 'on' : 'off') + '"' +
          ' data-inst="' + esc(g.installation) + '" data-well="' + esc(w.well_name) + '"' +
          (isAdmin ? '' : ' disabled') + '>' + (on ? '✓ ' : '○ ') + esc(w.well_name) + '</button>';
      });
      if (!list.length) html += '<span class="well-empty">Belum ada sumur terdaftar.</span>';
      html += '</div></div>';
    });
    wrap.innerHTML = html;

    if (!isAdmin) return;
    wrap.querySelectorAll('.well-chip').forEach(function (btn) {
      btn.addEventListener('click', function () {
        toggleWellActive(btn.dataset.inst, btn.dataset.well, !btn.classList.contains('on'));
      });
    });
  }

  async function saveWellActive(installation, wellName, active) {
    var token = currentAccessToken();
    var res = await fetch('/api/visualization/admin-library?action=wells', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ action: 'set_active', installation: installation, category: 'level', wellName: wellName, active: active })
    });
    if (!res.ok) { var d = await res.json().catch(function () { return {}; }); throw new Error(d.error || ('HTTP ' + res.status)); }
  }

  async function toggleWellActive(installation, wellName, active) {
    try {
      await saveWellActive(installation, wellName, active);
      await reloadSameYear();
      toast('Sumur ' + wellName + ' ditandai ' + (active ? 'AKTIF' : 'NONAKTIF') + ' — ANGG diperbarui.');
    } catch (err) {
      toast('Gagal menyimpan: ' + err.message);
    }
  }

  // ------------------------------------------------------------------
  // KETERANGAN & PENANDATANGAN (global, pola sama pengambilan.js)
  // ------------------------------------------------------------------
  async function saveMeta() {
    var token = currentAccessToken();
    var body = {
      kind: 'kpi_18_1a_meta',
      keterangan: state.meta.keterangan,
      signPlaceDate: document.getElementById('signDate').value,
      roleLeft: document.getElementById('role1').value,
      nameLeft: document.getElementById('name1').value,
      roleRight: document.getElementById('role2').value,
      nameRight: document.getElementById('name2').value
    };
    var res = await fetch('/api/visualization/admin-input', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify(body)
    });
    if (!res.ok) { var d = await res.json().catch(function () { return {}; }); throw new Error(d.error || ('HTTP ' + res.status)); }
  }

  function renderKet() {
    var list = document.getElementById("ketList");
    var keterangan = state.meta.keterangan || [];
    list.innerHTML = keterangan.map(function (k, i) {
      return '<div class="kline"><span class="mark">~</span><input value="' + (k || '').replace(/"/g, '&quot;') + '" data-i="' + i + '"' + (isAdmin ? '' : ' readonly') + '>' +
        (isAdmin ? '<button data-del="' + i + '" title="Hapus">×</button>' : '') + '</div>';
    }).join("") || '<div style="font-size:12.5px;color:var(--ink-faint);">Belum ada keterangan.</div>';

    if (!isAdmin) return;
    list.querySelectorAll("input").forEach(function (inp) {
      inp.addEventListener("change", async function () {
        keterangan[+inp.dataset.i] = inp.value;
        try { await saveMeta(); toast("Keterangan disimpan."); }
        catch (err) { toast("Gagal menyimpan: " + err.message); }
      });
    });
    list.querySelectorAll("button[data-del]").forEach(function (btn) {
      btn.addEventListener("click", async function () {
        keterangan.splice(+btn.dataset.del, 1);
        renderKet();
        try { await saveMeta(); toast("Keterangan dihapus."); }
        catch (err) { toast("Gagal menyimpan: " + err.message); }
      });
    });
  }

  function renderSign() {
    var meta = state.meta;
    // Tanggal defaultnya hari ini (dari server), tapi tetap bisa diedit
    // manual -- perubahannya dipakai pas Unduh Excel, sengaja TIDAK
    // disimpan ke database. Lihat catatan yang sama di pengambilan.js.
    document.getElementById('signDate').value = meta.signPlaceDate || '';
    document.getElementById('role1').value = meta.roleLeft || '';
    document.getElementById('name1').value = meta.nameLeft || '';
    document.getElementById('role2').value = meta.roleRight || '';
    document.getElementById('name2').value = meta.nameRight || '';
    ['signDate', 'role1', 'name1', 'role2', 'name2'].forEach(function (id) {
      document.getElementById(id).readOnly = !isAdmin;
    });
  }

  function wireSignatureControls() {
    ['role1', 'name1', 'role2', 'name2'].forEach(function (id) {
      document.getElementById(id).addEventListener('change', async function () {
        if (!isAdmin) return;
        try { await saveMeta(); toast('Penandatangan disimpan.'); }
        catch (err) { toast('Gagal menyimpan: ' + err.message); }
      });
    });
  }

  function renderYearSelect() {
    var sel = document.getElementById("yearSelect");
    var years = state.availableYears && state.availableYears.length ? state.availableYears : [state.year];
    sel.innerHTML = years.map(function (y) {
      return '<option value="' + y + '"' + (String(y) === String(state.year) ? ' selected' : '') + '>' + y + '</option>';
    }).join("");
  }

  function renderStatusBadge() {
    var badge = document.getElementById('statusBadge');
    if (state.locked) {
      badge.innerHTML = '<span class="status-pill warn">Data Contoh (Terkunci)</span>';
      return;
    }
    badge.innerHTML = '<span class="status-pill good">Data Asli — Tahun ' + state.year + '</span>';
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
    renderStats();
    renderWells();
    renderKet();
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
  document.getElementById("yearSelect").addEventListener("change", function (e) {
    loadYear(e.target.value);
  });

  document.getElementById("periodTabs").addEventListener("click", function (e) {
    var b = e.target.closest(".tab"); if (!b) return;
    document.querySelectorAll(".tab").forEach(function (t) { t.classList.remove("active"); });
    b.classList.add("active");
    currentPeriod = +b.dataset.period;
    renderTable(); renderStats();
  });

  document.getElementById("addKet").addEventListener("click", function () {
    if (!isAdmin) return;
    state.meta.keterangan.push("");
    renderKet();
  });

  // ------------------------------------------------------------------
  // UNDUH EXCEL -- dibangun di SERVER (exceljs), lihat catatan di
  // lib/visualization/kpi.js.
  // ------------------------------------------------------------------
  document.getElementById("downloadBtn").addEventListener("click", async function () {
    if (!isAdmin) {
      alert('Unduh Excel khusus admin. Silakan login admin terlebih dahulu.');
      window.location.href = '../../login.html?redirect=' + encodeURIComponent('apps/kpi-sab/level-sumur.html');
      return;
    }
    var btn = document.getElementById('downloadBtn');
    var oldText = btn.textContent;
    btn.disabled = true; btn.textContent = 'Menyiapkan Excel...';
    try {
      var token = currentAccessToken();
      var tanggalTtd = document.getElementById('signDate').value;
      var apiUrl = '/api/visualization/data?dataType=kpi_18_1a_xlsx&tahun=' + encodeURIComponent(state.year) +
        (tanggalTtd ? '&tanggal=' + encodeURIComponent(tanggalTtd) : '');
      var res = await fetch(apiUrl, {
        headers: { 'Authorization': 'Bearer ' + token }
      });
      if (!res.ok) {
        var d = await res.json().catch(function () { return {}; });
        throw new Error(d.error || ('HTTP ' + res.status));
      }
      var blob = await res.blob();
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = '18.1A Pengukuran Level Sumur ' + state.year + '.xlsx';
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
  // dari pengambilan.js. Datanya dari Data Waduk & Sumur (level), jadi grup
  // akses yang dipakai 'sumur_level'.
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
    var message = 'Halo, saya' + namaPart + ' baru saja mengirim permintaan akses data KPI 18.1a Pengukuran Level Sumur di website, mohon persetujuannya.';
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
        body: JSON.stringify({ requestedBy: nama, dataType: 'sumur_level', reason: alasan || undefined })
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
        await reloadSameYear();
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
      reloadSameYear();
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
    await loadYear(null);
  }

  init();
})();
