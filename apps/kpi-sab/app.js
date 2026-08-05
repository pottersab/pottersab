(function () {
  "use strict";

  var MONTHS = ["JANUARI", "FEBRUARI", "MARET", "APRIL", "MEI", "JUNI", "JULI", "AGUSTUS", "SEPTEMBER", "OKTOBER", "NOVEMBER", "DESEMBER"];

  var state = null;      // respons terakhir dari /api/visualization/data?dataType=kpi_ukur_debit
  var currentPeriod = 0; // 0 = Jan-Jun, 1 = Jul-Des (potongan tampilan dari 12 bulan yg sudah dimuat)
  var printMode = true;
  var isAdmin = false;

  // --- akses data asli: token JWT admin (localStorage) atau token viz-access
  // hasil approve email -- pola & fungsi sama persis dengan apps/riwayat-air-baku,
  // supaya sekali disetujui admin, berlaku juga di halaman KPI ini. ---
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
  function periodKeyFor(period) { return String(state.year) + '-' + (period === 0 ? '1' : '2'); }

  // ------------------------------------------------------------------
  // MUAT DATA
  // ------------------------------------------------------------------
  async function fetchApiData(tahun) {
    var headers = {};
    var token = currentAccessToken();
    if (token) headers['Authorization'] = 'Bearer ' + token;
    var url = '/api/visualization/data?dataType=kpi_ukur_debit' + (tahun ? ('&tahun=' + encodeURIComponent(tahun)) : '');
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
  // RENDER
  // ------------------------------------------------------------------
  function buildHead(period) {
    var idxs = monthIndexesFor(period);
    var r1 = '<tr class="r1"><th rowspan="3" style="min-width:34px;">NO</th><th rowspan="3" style="min-width:190px;">IPA / NO. SUMUR</th><th rowspan="3" style="min-width:84px;">DEBIT AWAL<br>(m&sup3;/jam)</th>';
    idxs.forEach(function (mi) { r1 += '<th class="month" colspan="3">' + MONTHS[mi] + '</th>'; });
    r1 += '</tr>';
    var r2 = '<tr class="r2">';
    idxs.forEach(function () { r2 += '<th>REAL</th><th colspan="2">RATIO EFFISIENSI</th>'; });
    r2 += '</tr>';
    var r3 = '<tr class="r3">';
    idxs.forEach(function () { r3 += '<th></th><th>±</th><th>%</th>'; });
    r3 += '</tr>';
    return r1 + r2 + r3;
  }

  function cellReal(well, mi) {
    var v = well.real[mi];
    var hasData = v !== null;
    var cls = hasData ? "web" : "empty";
    var val = hasData ? fmt(v, 2) : "";
    return '<td class="real"><div class="cellwrap ' + cls + '">' +
      '<input class="cell" type="text" value="' + val + '" readonly data-role="real" placeholder="—"></div></td>';
  }

  function cellRatio(well, mi, kind) {
    var real = well.real[mi];
    var awal = well.awal;
    var hasData = real !== null && awal !== null;
    var pm = hasData ? (real - awal) : null;
    var pct = hasData ? (real / awal * 100) : null;
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
    var no = 0;
    var groups = state.groups;

    groups.forEach(function (g) {
      no++;
      var span = 3 + idxs.length * 3 - 2;
      html += '<tr class="grouphead"><td>' + no + '</td><td colspan="' + span + '" class="tag">' + g.ipa + ' <span class="name-flag">Data Waduk &amp; Sumur</span></td></tr>';

      var sums = { awal: 0 }; idxs.forEach(function (mi) { sums[mi] = 0; });

      g.wells.forEach(function (w) {
        sums.awal += (w.awal || 0);
        html += '<tr><td class="no"></td><td class="name">' + w.name + '</td>';
        var awalVal = w.awal !== null ? fmt(w.awal, 0) : "";
        html += '<td class="awal"><div class="cellwrap"><input class="cell" type="text" value="' + awalVal + '" placeholder="isi" ' +
          'data-role="awal" data-inst="' + g.installation + '" data-well="' + w.name.replace(/"/g, '&quot;') + '"' +
          (isAdmin ? '' : ' readonly') + '></div></td>';
        idxs.forEach(function (mi) {
          if (w.real[mi] !== null) sums[mi] += w.real[mi];
          html += cellReal(w, mi) + cellRatio(w, mi, "pm") + cellRatio(w, mi, "pct");
        });
        html += '</tr>';
      });

      html += '<tr class="sum"><td></td><td>JUMLAH</td><td><div class="cellwrap" style="justify-content:flex-end;">' + fmt(sums.awal, 0) + '</div></td>';
      idxs.forEach(function (mi) {
        var anyData = g.wells.some(function (w) { return w.real[mi] !== null; });
        html += '<td><div class="cellwrap" style="justify-content:flex-end;">' + (anyData ? fmt(sums[mi], 2) : '') + '</div></td><td></td><td></td>';
      });
      html += '</tr>';
    });

    html += '<tr class="avg"><td></td><td>RATA-RATA EFISIENSI</td><td></td>';
    idxs.forEach(function (mi) {
      var vals = [];
      groups.forEach(function (g) { g.wells.forEach(function (w) {
        if (w.real[mi] !== null && w.awal !== null) vals.push(w.real[mi] / w.awal * 100);
      }); });
      var avg = vals.length ? vals.reduce(function (a, b) { return a + b; }, 0) / vals.length : null;
      html += '<td></td><td></td><td><div class="cellwrap" style="justify-content:center;">' + (avg !== null ? fmt(avg, 1) + '%' : '–') + '</div></td>';
    });
    html += '</tr></tbody>';
    table.innerHTML = html;

    document.getElementById("tableFoot").innerHTML =
      'Sumber Real: <b>Data &amp; Visualisasi → Data Waduk dan Sumur → Sumur Dalam → Debit Sumur</b> · ' +
      'Format unduhan mengikuti <b>18.2 Ukur Debit.xlsx</b> persis (dua blok 6 bulan, JUMLAH per IPA, RATA-RATA di bawah).';

    table.querySelectorAll('input[data-role="awal"]').forEach(function (inp) {
      inp.addEventListener("change", async function () {
        var n = parseFloat(inp.value.replace(",", "."));
        if (isNaN(n)) { renderTable(); return; }
        var inst = inp.dataset.inst, well = inp.dataset.well;
        try {
          await saveDebitAwal(inst, well, n);
          // update state lokal supaya tidak perlu fetch ulang
          state.groups.forEach(function (g) { if (g.installation === inst) g.wells.forEach(function (w) { if (w.name === well) w.awal = n; }); });
          renderTable(); renderStats();
          toast("Debit awal " + well + " diperbarui → " + fmt(n, 0) + " m³/jam");
        } catch (err) {
          toast("Gagal menyimpan: " + err.message);
          renderTable();
        }
      });
    });
  }

  async function saveDebitAwal(installation, well_name, debit_awal) {
    var token = currentAccessToken();
    var res = await fetch('/api/visualization/admin-input', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ kind: 'debit_awal', installation: installation, well_name: well_name, debit_awal: debit_awal })
    });
    if (!res.ok) { var d = await res.json().catch(function () { return {}; }); throw new Error(d.error || ('HTTP ' + res.status)); }
  }

  async function saveMeta() {
    var token = currentAccessToken();
    var keterangan = state.meta[currentPeriod === 0 ? '1' : '2'].keterangan;
    var body = {
      kind: 'meta',
      period_key: periodKeyFor(currentPeriod),
      keterangan: keterangan,
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

  function renderStats() {
    var totalWell = 0, pcts = [];
    var idxs = monthIndexesFor(currentPeriod);
    var groups = state.groups;
    groups.forEach(function (g) { g.wells.forEach(function (w) {
      totalWell++;
      idxs.forEach(function (mi) { if (w.real[mi] !== null && w.awal !== null) pcts.push(w.real[mi] / w.awal * 100); });
    }); });
    var avgPct = pcts.length ? pcts.reduce(function (a, b) { return a + b; }, 0) / pcts.length : 0;
    var cls = avgPct >= 95 ? "good" : (avgPct >= 85 ? "warn" : "");

    // Kapasitas Realisasi: total Real seluruh sumur untuk bulan TERAKHIR yang
    // sudah ada datanya di periode yang sedang ditampilkan -- bukan Debit Awal
    // (kapasitas pompa) yang selalu sama tiap bulan, tapi realisasi sesuai
    // bulan berjalan.
    var realisasiMonth = null, totalRealisasi = 0;
    for (var k = idxs.length - 1; k >= 0; k--) {
      var mi = idxs[k];
      var any = groups.some(function (g) { return g.wells.some(function (w) { return w.real[mi] !== null; }); });
      if (any) {
        realisasiMonth = mi;
        groups.forEach(function (g) { g.wells.forEach(function (w) { if (w.real[mi] !== null) totalRealisasi += w.real[mi]; }); });
        break;
      }
    }

    var stat = document.getElementById("statRow");
    stat.innerHTML =
      '<div class="stat"><div class="k">IPA</div><div class="v">' + groups.length + '</div></div>' +
      '<div class="stat"><div class="k">Total sumur</div><div class="v">' + totalWell + '</div></div>' +
      '<div class="stat"><div class="k">Kapasitas Realisasi' + (realisasiMonth !== null ? ' (' + MONTHS[realisasiMonth] + ')' : '') + '</div><div class="v">' +
        (realisasiMonth !== null ? fmt(totalRealisasi, 0) + ' m³/jam' : '–') + '</div></div>' +
      '<div class="stat"><div class="k">Rata-rata efisiensi</div><div class="v ' + cls + '">' + (pcts.length ? fmt(avgPct, 1) + '%' : '–') + '</div></div>';
  }

  function renderKet() {
    var list = document.getElementById("ketList");
    var meta = state.meta[currentPeriod === 0 ? '1' : '2'];
    var keterangan = meta.keterangan || [];
    list.innerHTML = keterangan.map(function (k, i) {
      return '<div class="kline"><span class="mark">~</span><input value="' + (k || '').replace(/"/g, '&quot;') + '" data-i="' + i + '"' + (isAdmin ? '' : ' readonly') + '>' +
        (isAdmin ? '<button data-del="' + i + '" title="Hapus">×</button>' : '') + '</div>';
    }).join("") || '<div style="font-size:12.5px;color:var(--ink-faint);">Belum ada keterangan untuk periode ini.</div>';

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
    var meta = state.meta[currentPeriod === 0 ? '1' : '2'];
    document.getElementById('signDate').value = meta.signPlaceDate || '';
    document.getElementById('role1').value = meta.roleLeft || '';
    document.getElementById('name1').value = meta.nameLeft || '';
    document.getElementById('role2').value = meta.roleRight || '';
    document.getElementById('name2').value = meta.nameRight || '';
    ['signDate', 'role1', 'name1', 'role2', 'name2'].forEach(function (id) {
      document.getElementById(id).readOnly = !isAdmin;
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
    state.groups.forEach(function (g) { g.wells.forEach(function (w) {
      w.real.forEach(function (v) { if (v !== null) filled++; });
    }); });
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
    renderTable(); renderStats(); renderKet(); renderSign();
  });

  var printSwitch = document.getElementById("printSwitch");
  printSwitch.addEventListener("click", function () {
    printMode = !printMode;
    printSwitch.classList.toggle("on", printMode);
    renderTable();
  });

  document.getElementById("addKet").addEventListener("click", function () {
    if (!isAdmin) return;
    var meta = state.meta[currentPeriod === 0 ? '1' : '2'];
    meta.keterangan.push("");
    renderKet();
  });

  var fetching = false;
  document.getElementById("fetchBtn").addEventListener("click", async function () {
    if (fetching) return;
    fetching = true;
    var btn = document.getElementById("fetchBtn");
    var oldHtml = btn.innerHTML;
    btn.innerHTML = '<span class="spin"></span> Menarik dari Debit Sumur…';
    btn.disabled = true;
    await reloadSameYear();
    btn.innerHTML = oldHtml;
    btn.disabled = false;
    fetching = false;
    toast("Data terbaru dari Debit Sumur berhasil ditarik.");
  });

  // ------------------------------------------------------------------
  // UNDUH EXCEL — dibangun di SERVER (exceljs), bukan di browser. Library
  // SheetJS gratis yang jalan di browser tidak bisa menulis border/font sama
  // sekali (sudah dicoba, hasilnya polos) -- garis kotak & Times New Roman
  // di file ini butuh exceljs, dan itu cuma jalan di Node, bukan di browser.
  // ------------------------------------------------------------------
  document.getElementById("downloadBtn").addEventListener("click", async function () {
    if (!isAdmin) {
      alert('Unduh Excel khusus admin. Silakan login admin terlebih dahulu.');
      window.location.href = '../../login.html?redirect=' + encodeURIComponent('apps/kpi-sab/ukur-debit.html');
      return;
    }
    var btn = document.getElementById('downloadBtn');
    var oldText = btn.textContent;
    btn.disabled = true; btn.textContent = 'Menyiapkan Excel...';
    try {
      var token = currentAccessToken();
      var res = await fetch('/api/visualization/data?dataType=kpi_ukur_debit_xlsx&tahun=' + encodeURIComponent(state.year), {
        headers: { 'Authorization': 'Bearer ' + token }
      });
      if (!res.ok) {
        var d = await res.json().catch(function () { return {}; });
        throw new Error(d.error || ('HTTP ' + res.status));
      }
      var blob = await res.blob();
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = '18.2 Ukur Debit ' + state.year + '.xlsx';
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
  // dari apps/riwayat-air-baku/app.js supaya token yang sama berlaku di sini.
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
    var message = 'Halo, saya' + namaPart + ' baru saja mengirim permintaan akses data KPI 18.2 Ukur Debit di website, mohon persetujuannya.';
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
        body: JSON.stringify({ requestedBy: nama, dataType: 'sumur_debit', reason: alasan || undefined })
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
    restoreVizSession();
    await loadYear(null);
  }

  init();
})();
