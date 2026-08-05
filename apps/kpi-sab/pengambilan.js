(function () {
  "use strict";

  var MONTHS = ["JANUARI", "FEBRUARI", "MARET", "APRIL", "MEI", "JUNI", "JULI", "AGUSTUS", "SEPTEMBER", "OKTOBER", "NOVEMBER", "DESEMBER"];
  var DAY_COUNTS = [31, 30, 29, 28];

  var state = null;      // respons terakhir dari /api/visualization/data?dataType=kpi_pengambilan
  var currentPeriod = 0; // 0 = Jan-Jun, 1 = Jul-Des (potongan tampilan dari 12 bulan yg sudah dimuat)
  var printMode = true;
  var isAdmin = false;

  // --- akses data asli: token JWT admin (localStorage) atau token viz-access
  // hasil approve email -- pola & fungsi sama persis dengan apps/kpi-sab/app.js. ---
  var vizToken = null, vizTokenExpiresAt = null, vizRequestId = null, vizRequestSecret = null;
  var pollTimer = null, expiryTimer = null;

  function currentAccessToken() { return localStorage.getItem('token') || vizToken || null; }

  function fmt(n, d) {
    if (n === null || n === undefined || isNaN(n)) return "";
    return n.toLocaleString("id-ID", { minimumFractionDigits: d, maximumFractionDigits: d });
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
    var url = '/api/visualization/data?dataType=kpi_pengambilan' + (tahun ? ('&tahun=' + encodeURIComponent(tahun)) : '');
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
  // RENDER TABEL
  // ------------------------------------------------------------------
  function buildHead(period) {
    var idxs = monthIndexesFor(period);
    var r1 = '<tr class="r1"><th rowspan="3" style="min-width:34px;">NO</th><th rowspan="3" style="min-width:150px;">URAIAN</th>';
    idxs.forEach(function (mi) { r1 += '<th class="month" colspan="4">' + MONTHS[mi] + '</th>'; });
    r1 += '</tr>';
    var r2 = '<tr class="r2">';
    idxs.forEach(function () { r2 += '<th>ANGG</th><th>REAL</th><th colspan="2">RATIO EFFISIENSI</th>'; });
    r2 += '</tr>';
    var r3 = '<tr class="r3">';
    idxs.forEach(function () { r3 += '<th>m&sup3;</th><th>m&sup3;</th><th>±</th><th>%</th>'; });
    r3 += '</tr>';
    return r1 + r2 + r3;
  }

  function cellAngg(group, mi) {
    var v = group.angg[mi];
    var hasData = v !== null && v !== undefined;
    var val = hasData ? fmt(v, 0) : "";
    var hidePrint = (!hasData && printMode);
    return '<td class="angg"><div class="cellwrap"><input class="cell" type="text" value="' + val + '" readonly ' +
      'title="Diatur lewat panel Pengaturan Anggaran di bawah tabel" placeholder="' + (hidePrint ? '' : '—') + '"></div></td>';
  }

  function cellReal(group, mi) {
    var v = group.real[mi];
    var hasData = v !== null && v !== undefined;
    var cls = hasData ? "web" : "empty";
    var val = hasData ? fmt(v, 2) : "";
    var hidePrint = (!hasData && printMode);
    return '<td class="real"><div class="cellwrap ' + cls + '">' +
      '<input class="cell" type="text" value="' + val + '" readonly placeholder="' + (hidePrint ? '' : '—') + '"></div></td>';
  }

  function cellRatio(group, mi, kind) {
    var real = group.real[mi];
    var angg = group.angg[mi];
    var hasData = real !== null && real !== undefined && angg !== null && angg !== undefined && angg !== 0;
    var pm = hasData ? (real - angg) : null;
    var pct = hasData ? (real / angg * 100) : null;
    var val = kind === "pm" ? pm : pct;
    var text = hasData ? (kind === "pm" ? (val >= 0 ? "+" : "") + fmt(val, 2) : fmt(val, 1) + "%") : "–";
    var cls = ratioClass(hasData ? pct : null);
    var hidePrint = (!hasData && printMode);
    return '<td class="ratio"><div class="cellwrap"><span class="pill ' + (hidePrint ? "" : cls) + '" ' +
      (hidePrint ? 'style="color:var(--bg);background:var(--bg);"' : '') +
      '>' + text + '</span></div></td>';
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

    html += '</tbody>';
    table.innerHTML = html;

    document.getElementById("tableFoot").innerHTML =
      'Realisasi: <b>total Air Permukaan (AP) / Air Tanah Dalam (ATD)</b> bulan itu, otomatis dari Data &amp; Visualisasi → Data Pengambilan Air Baku · ' +
      'Anggaran: mengikuti jumlah hari dalam bulan, diatur lewat panel Pengaturan Anggaran di bawah tabel.';
  }

  function renderStats() {
    var idxs = monthIndexesFor(currentPeriod);

    // Bulan TERAKHIR yang sudah ada Realisasi-nya di periode yang sedang
    // ditampilkan (gabungan AP+ATD, sama pola dengan app.js/apatd.js).
    var lastMonth = null, totals = {};
    state.groups.forEach(function (g) { totals[g.key] = { real: 0, angg: 0 }; });
    for (var k = idxs.length - 1; k >= 0; k--) {
      var mi = idxs[k];
      var any = state.groups.some(function (g) { return g.real[mi] !== null; });
      if (any) {
        lastMonth = mi;
        state.groups.forEach(function (g) {
          if (g.real[mi] !== null) totals[g.key].real += g.real[mi];
          if (g.angg[mi] !== null) totals[g.key].angg += g.angg[mi];
        });
        break;
      }
    }
    var grandReal = state.groups.reduce(function (s, g) { return s + (totals[g.key].real || 0); }, 0);
    var grandAngg = state.groups.reduce(function (s, g) { return s + (totals[g.key].angg || 0); }, 0);
    var grandPct = (lastMonth !== null && grandAngg > 0) ? (grandReal / grandAngg * 100) : null;
    var cls = grandPct === null ? "" : (grandPct >= 95 ? "good" : (grandPct >= 85 ? "warn" : ""));

    var stat = document.getElementById("statRow");
    var html = '';
    state.groups.forEach(function (g) {
      html += '<div class="stat"><div class="k">Realisasi ' + g.label + (lastMonth !== null ? ' (' + MONTHS[lastMonth] + ')' : '') + '</div><div class="v">' +
        (lastMonth !== null ? fmt(totals[g.key].real, 0) + ' m³' : '–') + '</div></div>';
    });
    html += '<div class="stat"><div class="k">Total AP + ATD' + (lastMonth !== null ? ' (' + MONTHS[lastMonth] + ')' : '') + '</div><div class="v">' +
      (lastMonth !== null ? fmt(grandReal, 0) + ' m³' : '–') + '</div></div>';
    html += '<div class="stat"><div class="k">Efisiensi Gabungan' + (lastMonth !== null ? ' (' + MONTHS[lastMonth] + ')' : '') + '</div><div class="v ' + cls + '">' +
      (grandPct !== null ? fmt(grandPct, 1) + '%' : '–') + '</div></div>';
    stat.innerHTML = html;
  }

  // ------------------------------------------------------------------
  // PENGATURAN ANGGARAN (per jumlah hari dalam bulan)
  // ------------------------------------------------------------------
  async function saveTarget(dayCount, apValue, atdValue) {
    var token = currentAccessToken();
    var res = await fetch('/api/visualization/admin-input', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ kind: 'pengambilan_target', day_count: dayCount, ap_value: apValue, atd_value: atdValue })
    });
    if (!res.ok) { var d = await res.json().catch(function () { return {}; }); throw new Error(d.error || ('HTTP ' + res.status)); }
  }

  function renderTargets() {
    var grid = document.getElementById('targetGrid');
    var targets = state.targets || {};
    var html = '<div class="th"></div><div class="th">Air Permukaan (m&sup3;)</div><div class="th">Air Tanah Dalam (m&sup3;)</div>';
    DAY_COUNTS.forEach(function (dc) {
      var t = targets[dc] || { ap: null, atd: null };
      html += '<div class="dc">' + dc + ' Hari</div>' +
        '<input type="text" inputmode="decimal" data-dc="' + dc + '" data-src="ap" value="' + (t.ap !== null && t.ap !== undefined ? t.ap : '') + '" placeholder="belum diisi"' + (isAdmin ? '' : ' readonly') + '>' +
        '<input type="text" inputmode="decimal" data-dc="' + dc + '" data-src="atd" value="' + (t.atd !== null && t.atd !== undefined ? t.atd : '') + '" placeholder="belum diisi"' + (isAdmin ? '' : ' readonly') + '>';
    });
    grid.innerHTML = html;

    if (!isAdmin) return;
    grid.querySelectorAll('input').forEach(function (inp) {
      inp.addEventListener('change', async function () {
        var dc = +inp.dataset.dc;
        var raw = inp.value.replace(",", ".").trim();
        var n = raw === "" ? null : parseFloat(raw);
        if (raw !== "" && isNaN(n)) { renderTargets(); return; }
        var apInp = grid.querySelector('input[data-dc="' + dc + '"][data-src="ap"]');
        var atdInp = grid.querySelector('input[data-dc="' + dc + '"][data-src="atd"]');
        var apRaw = apInp.value.replace(",", ".").trim();
        var atdRaw = atdInp.value.replace(",", ".").trim();
        var apVal = apRaw === "" ? null : parseFloat(apRaw);
        var atdVal = atdRaw === "" ? null : parseFloat(atdRaw);
        try {
          await saveTarget(dc, apVal, atdVal);
          if (!state.targets[dc]) state.targets[dc] = {};
          state.targets[dc].ap = apVal;
          state.targets[dc].atd = atdVal;
          // Anggaran tabel utama ikut berubah untuk semua bulan yang jumlah
          // harinya sama dengan dc -- muat ulang tahun ini supaya konsisten.
          await reloadSameYear();
          toast('Anggaran ' + dc + ' hari disimpan.');
        } catch (err) {
          toast('Gagal menyimpan: ' + err.message);
          renderTargets();
        }
      });
    });
  }

  // ------------------------------------------------------------------
  // KETERANGAN & PENANDATANGAN (global, sama pola dengan app.js/apatd.js)
  // ------------------------------------------------------------------
  async function saveMeta() {
    var token = currentAccessToken();
    var body = {
      kind: 'pengambilan_meta',
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
    var filled = 0;
    state.groups.forEach(function (g) { g.real.forEach(function (v) { if (v !== null) filled++; }); });
    var cls = filled > 0 ? 'good' : 'warn';
    badge.innerHTML = '<span class="status-pill ' + cls + '">Data Asli — Tahun ' + state.year + '</span>';
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
    renderTargets();
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

  var printSwitch = document.getElementById("printSwitch");
  printSwitch.addEventListener("click", function () {
    printMode = !printMode;
    printSwitch.classList.toggle("on", printMode);
    renderTable();
  });

  document.getElementById("addKet").addEventListener("click", function () {
    if (!isAdmin) return;
    state.meta.keterangan.push("");
    renderKet();
  });

  var fetching = false;
  document.getElementById("fetchBtn").addEventListener("click", async function () {
    if (fetching) return;
    fetching = true;
    var btn = document.getElementById("fetchBtn");
    var oldHtml = btn.innerHTML;
    btn.innerHTML = '<span class="spin"></span> Menarik dari Data Air Baku…';
    btn.disabled = true;
    await reloadSameYear();
    btn.innerHTML = oldHtml;
    btn.disabled = false;
    fetching = false;
    toast("Data terbaru dari Data Air Baku berhasil ditarik.");
  });

  // ------------------------------------------------------------------
  // UNDUH EXCEL -- dibangun di SERVER (exceljs), lihat catatan di
  // lib/visualization/kpi.js dan apps/kpi-sab/app.js.
  // ------------------------------------------------------------------
  document.getElementById("downloadBtn").addEventListener("click", async function () {
    if (!isAdmin) {
      alert('Unduh Excel khusus admin. Silakan login admin terlebih dahulu.');
      window.location.href = '../../login.html?redirect=' + encodeURIComponent('apps/kpi-sab/pengambilan.html');
      return;
    }
    var btn = document.getElementById('downloadBtn');
    var oldText = btn.textContent;
    btn.disabled = true; btn.textContent = 'Menyiapkan Excel...';
    try {
      var token = currentAccessToken();
      var tanggalTtd = document.getElementById('signDate').value;
      var apiUrl = '/api/visualization/data?dataType=kpi_pengambilan_xlsx&tahun=' + encodeURIComponent(state.year) +
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
      a.href = url; a.download = '18.3B Pengambilan Air Baku ' + state.year + '.xlsx';
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
  // dari apps/kpi-sab/app.js supaya token yang sama berlaku di sini.
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
    var message = 'Halo, saya' + namaPart + ' baru saja mengirim permintaan akses data KPI 18.3b Pengambilan Air Baku di website, mohon persetujuannya.';
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
