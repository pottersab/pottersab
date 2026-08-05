(function () {
  "use strict";

  var MONTHS = ["JANUARI", "FEBRUARI", "MARET", "APRIL", "MEI", "JUNI", "JULI", "AGUSTUS", "SEPTEMBER", "OKTOBER", "NOVEMBER", "DESEMBER"];
  var ELEVASI_LIST = [3, 5, 7];

  var state = null;      // respons terakhir dari /api/visualization/data?dataType=kpi_kualitas
  var currentPeriod = 0; // 0 = Jan-Jun, 1 = Jul-Des (potongan tampilan dari 12 bulan yg sudah dimuat)
  var currentElevasiMonth = new Date().getMonth(); // index bulan yang sedang ditampilkan di panel harian
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
  function monthIndexesFor(period) { return period === 0 ? [0, 1, 2, 3, 4, 5] : [6, 7, 8, 9, 10, 11]; }
  function daysInMonth(year, monthIndex) { return new Date(Number(year), monthIndex + 1, 0).getDate(); }
  function pad2(n) { return n < 10 ? "0" + n : "" + n; }

  // ------------------------------------------------------------------
  // MUAT DATA
  // ------------------------------------------------------------------
  async function fetchApiData(tahun) {
    var headers = {};
    var token = currentAccessToken();
    if (token) headers['Authorization'] = 'Bearer ' + token;
    var url = '/api/visualization/data?dataType=kpi_kualitas' + (tahun ? ('&tahun=' + encodeURIComponent(tahun)) : '');
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
    rebuildElevasiIndex();
    currentPeriod = 0;
    document.querySelectorAll('.tab').forEach(function (t, i) { t.classList.toggle('active', i === 0); });
    var thisRealYear = String(new Date().getFullYear());
    currentElevasiMonth = (String(state.year) === thisRealYear) ? new Date().getMonth() : 0;
    renderAll();
  }

  async function reloadSameYear() {
    try {
      state = await fetchApiData(state.year);
    } catch (err) {
      showErrorState(err);
      return;
    }
    rebuildElevasiIndex();
    renderAll();
  }

  // ------------------------------------------------------------------
  // TABEL UTAMA (ringkasan bulanan per lokasi)
  // ------------------------------------------------------------------
  function itemsForGroup(group) {
    return [
      { label: 'Level Waduk (m)', values: group.level, dec: 2 },
      { label: 'Kekeruhan / NTU (rata-rata)', values: group.ntu, dec: 1 },
      { label: 'PH Air Baku (rata-rata)', values: group.ph, dec: 2 },
      { label: 'Elevasi 3 — Hari ON', values: group.elevasiHari[3], dec: 0, isHari: true },
      { label: 'Elevasi 5 — Hari ON', values: group.elevasiHari[5], dec: 0, isHari: true },
      { label: 'Elevasi 7 — Hari ON', values: group.elevasiHari[7], dec: 0, isHari: true }
    ];
  }

  function buildHead(period) {
    var idxs = monthIndexesFor(period);
    var html = '<tr><th style="min-width:34px;">NO</th><th style="min-width:220px;">URAIAN</th>';
    idxs.forEach(function (mi) { html += '<th class="month">' + MONTHS[mi] + '</th>'; });
    return html + '</tr>';
  }

  function cellVal(item, mi) {
    var v = item.values[mi];
    var hasData = v !== null && v !== undefined;
    var cls = hasData ? "web" : "empty";
    var val = hasData ? fmt(v, item.dec) : "";
    var hidePrint = (!hasData && printMode);
    return '<td class="real"><div class="cellwrap ' + cls + '">' +
      '<input class="cell" type="text" value="' + val + '" readonly placeholder="' + (hidePrint ? '' : '—') + '"></div></td>';
  }

  function renderGroup(html, group, idxs) {
    var span = 2 + idxs.length - 1;
    html += '<tr class="grouphead"><td colspan="' + (span + 1) + '" class="tag">' + group.label + '</td></tr>';
    itemsForGroup(group).forEach(function (item, i) {
      html += '<tr><td class="no">' + (i + 1) + '</td><td class="name">' + item.label + '</td>';
      idxs.forEach(function (mi) { html += cellVal(item, mi); });
      html += '</tr>';
    });
    return html;
  }

  function renderTable() {
    var table = document.getElementById("mainTable");
    var idxs = monthIndexesFor(currentPeriod);
    var html = "<thead>" + buildHead(currentPeriod) + "</thead><tbody>";

    state.groups.forEach(function (g) { html = renderGroup(html, g, idxs); });

    html += '</tbody>';
    table.innerHTML = html;

    document.getElementById("tableFoot").innerHTML =
      'Level/NTU/PH: <b>rata-rata harian</b> bulan itu, otomatis dari Data &amp; Visualisasi → Data Air Baku (Waduk Manggar/Teritip) · ' +
      'Hari ON elevasi: jumlah hari pintu itu dibuka bulan itu, dihitung dari panel Status Pintu Air di bawah tabel.';
  }

  function renderStats() {
    var idxs = monthIndexesFor(currentPeriod);

    // Level & rata-rata NTU bulan TERAKHIR yang sudah ada datanya di periode
    // yang sedang ditampilkan, per lokasi (sama pola dengan app.js/apatd.js).
    var stat = document.getElementById("statRow");
    var html = '';
    state.groups.forEach(function (g) {
      var lastMonth = null;
      for (var k = idxs.length - 1; k >= 0; k--) {
        var mi = idxs[k];
        if (g.level[mi] !== null || g.ntu[mi] !== null || g.ph[mi] !== null) { lastMonth = mi; break; }
      }
      html += '<div class="stat"><div class="k">Level ' + g.label + (lastMonth !== null ? ' (' + MONTHS[lastMonth] + ')' : '') + '</div><div class="v">' +
        (lastMonth !== null && g.level[lastMonth] !== null ? fmt(g.level[lastMonth], 2) + ' m' : '–') + '</div></div>';
      html += '<div class="stat"><div class="k">NTU ' + g.label + (lastMonth !== null ? ' (' + MONTHS[lastMonth] + ')' : '') + '</div><div class="v">' +
        (lastMonth !== null && g.ntu[lastMonth] !== null ? fmt(g.ntu[lastMonth], 1) : '–') + '</div></div>';
    });
    stat.innerHTML = html;
  }

  // ------------------------------------------------------------------
  // PANEL STATUS PINTU AIR (ELEVASI, HARIAN) -- diedit langsung di sini,
  // BUKAN lewat Input Massal. Bisa lebih dari satu elevasi ON bersamaan.
  //
  // state.elevasiDaily dari server SUDAH forward-fill: klik ON di suatu
  // tanggal membuat status itu "menempel" ke semua tanggal berikutnya
  // (termasuk bulan/tahun depan) sampai di-OFF-kan lagi -- BUKAN status
  // per-hari yang berdiri sendiri. Karena satu klik bisa mengubah banyak
  // bulan sekaligus, sesudah toggle kita muat ulang data (reloadSameYear)
  // supaya tabel utama & panel ini konsisten dengan hasil forward-fill
  // yang sebenarnya dihitung di server -- bukan disimulasikan di client.
  // ------------------------------------------------------------------
  var elevasiByDate = {};

  function rebuildElevasiIndex() {
    elevasiByDate = {};
    (state.elevasiDaily || []).forEach(function (r) { elevasiByDate[r.Tanggal] = r; });
  }

  async function saveElevasiToggle(dateStr, loc, elevasi, on) {
    var token = currentAccessToken();
    var res = await fetch('/api/visualization/admin-input', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ kind: 'kualitas_elevasi', tanggal: dateStr, lokasi: loc, elevasi: elevasi, on: on })
    });
    if (!res.ok) { var d = await res.json().catch(function () { return {}; }); throw new Error(d.error || ('HTTP ' + res.status)); }
  }

  async function toggleElevasi(dateStr, loc, elevasi) {
    if (!isAdmin) return;
    var row = elevasiByDate[dateStr];
    var currentVal = row ? !!row[loc][elevasi] : false;
    var newVal = !currentVal;
    try {
      await saveElevasiToggle(dateStr, loc, elevasi, newVal);
      await reloadSameYear();
      toast('Elevasi ' + elevasi + ' ' + (loc === 'manggar' ? 'Manggar' : 'Teritip') + ' ' + (newVal ? 'ON' : 'OFF') +
        ' mulai ' + dateStr + ' — berlaku terus sampai diubah lagi.');
    } catch (err) {
      toast('Gagal menyimpan: ' + err.message);
    }
  }

  function renderElevasiMonthSelect() {
    var sel = document.getElementById('elevasiMonthSelect');
    sel.innerHTML = MONTHS.map(function (mn, i) {
      return '<option value="' + i + '"' + (i === currentElevasiMonth ? ' selected' : '') + '>' + mn + ' ' + state.year + '</option>';
    }).join('');
  }

  function elevasiCell(dateStr, loc, elevasi) {
    var row = elevasiByDate[dateStr];
    var on = row ? !!row[loc][elevasi] : false;
    var cls = 'switch small' + (on ? ' on' : '');
    if (isAdmin) {
      return '<td class="elevasi-cell"><div class="' + cls + '" data-date="' + dateStr + '" data-loc="' + loc + '" data-e="' + elevasi + '" role="button" aria-label="Toggle elevasi ' + elevasi + '"></div></td>';
    }
    return '<td class="elevasi-cell"><span class="pill ' + (on ? 'good' : 'dim') + '">' + (on ? 'ON' : 'OFF') + '</span></td>';
  }

  function renderElevasiTable() {
    var table = document.getElementById('elevasiTable');
    var days = daysInMonth(state.year, currentElevasiMonth);

    var head = '<thead><tr><th rowspan="2" style="min-width:70px;">TANGGAL</th>' +
      '<th colspan="3">WADUK MANGGAR</th><th colspan="3">WADUK TERITIP</th></tr>' +
      '<tr>' + ELEVASI_LIST.map(function (e) { return '<th>E' + e + '</th>'; }).join('') +
      ELEVASI_LIST.map(function (e) { return '<th>E' + e + '</th>'; }).join('') + '</tr></thead>';

    var body = '<tbody>';
    for (var d = 1; d <= days; d++) {
      var dateStr = state.year + '-' + pad2(currentElevasiMonth + 1) + '-' + pad2(d);
      body += '<tr><td class="no">' + d + '</td>';
      ELEVASI_LIST.forEach(function (e) { body += elevasiCell(dateStr, 'manggar', e); });
      ELEVASI_LIST.forEach(function (e) { body += elevasiCell(dateStr, 'teritip', e); });
      body += '</tr>';
    }
    body += '</tbody>';

    table.innerHTML = head + body;

    if (!isAdmin) return;
    table.querySelectorAll('.switch[data-date]').forEach(function (sw) {
      sw.addEventListener('click', function () {
        toggleElevasi(sw.dataset.date, sw.dataset.loc, Number(sw.dataset.e));
      });
    });
  }

  // ------------------------------------------------------------------
  // KETERANGAN & PENANDATANGAN (global, sama pola dengan app.js/apatd.js)
  // ------------------------------------------------------------------
  async function saveMeta() {
    var token = currentAccessToken();
    var body = {
      kind: 'kualitas_meta',
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
    // disimpan ke database. Lihat catatan yang sama di apps/kpi-sab/app.js.
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
    state.groups.forEach(function (g) {
      ['level', 'ntu', 'ph'].forEach(function (k) { g[k].forEach(function (v) { if (v !== null) filled++; }); });
    });
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
    renderElevasiMonthSelect();
    renderElevasiTable();
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

  document.getElementById("elevasiMonthSelect").addEventListener("change", function (e) {
    currentElevasiMonth = +e.target.value;
    renderElevasiTable();
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
      window.location.href = '../../login.html?redirect=' + encodeURIComponent('apps/kpi-sab/kualitas.html');
      return;
    }
    var btn = document.getElementById('downloadBtn');
    var oldText = btn.textContent;
    btn.disabled = true; btn.textContent = 'Menyiapkan Excel...';
    try {
      var token = currentAccessToken();
      var tanggalTtd = document.getElementById('signDate').value;
      var apiUrl = '/api/visualization/data?dataType=kpi_kualitas_xlsx&tahun=' + encodeURIComponent(state.year) +
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
      a.href = url; a.download = '18.4 Laporan Kualitas Air Baku ' + state.year + '.xlsx';
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
    var message = 'Halo, saya' + namaPart + ' baru saja mengirim permintaan akses data KPI 18.4 Laporan Kualitas Air Baku di website, mohon persetujuannya.';
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
        body: JSON.stringify({ requestedBy: nama, dataType: 'kpi_kualitas', reason: alasan || undefined })
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
