(function () {
  "use strict";

  // Nama bulan sesuai TAHUN FISKAL (0-5 = Juli..Desember tahun terpilih,
  // 6-11 = Januari..Juni tahun berikutnya) -- persis urutan template 18.5.
  var MONTHS = ["JULI", "AGUSTUS", "SEPTEMBER", "OKTOBER", "NOVEMBER", "DESEMBER", "JANUARI", "FEBRUARI", "MARET", "APRIL", "MEI", "JUNI"];

  var state = null;      // respons terakhir dari /api/visualization/data?dataType=kpi_18_5
  var currentPeriod = 0; // 0 = Juli-Des, 1 = Jan-Jun
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
  function parseNum(s) {
    s = String(s == null ? '' : s).trim().replace(',', '.');
    if (s === '') return null;
    var n = Number(s);
    return isNaN(n) ? null : n;
  }
  function ratioClass(pct) {
    if (pct === null) return "dim";
    if (pct >= 95) return "good";
    if (pct >= 85) return "warn";
    return "bad";
  }
  function monthIndexesFor(period) { return period === 0 ? [0, 1, 2, 3, 4, 5] : [6, 7, 8, 9, 10, 11]; }
  function fiscalPeriod(mi) {
    var y = mi < 6 ? Number(state.tahun) : Number(state.tahun) + 1;
    var m = ((mi + 6) % 12) + 1;
    return y + '-' + (m < 10 ? '0' : '') + m;
  }
  function monthLabel(mi) {
    return MONTHS[mi] + ' ' + (mi < 6 ? state.tahun : (Number(state.tahun) + 1));
  }
  function miFromPeriode(p) {
    var parts = p.split('-');
    var y = Number(parts[0]), m = Number(parts[1]);
    return y === Number(state.tahun) ? m - 7 : m + 5;
  }

  // ------------------------------------------------------------------
  // MUAT DATA
  // ------------------------------------------------------------------
  async function fetchApiData(tahun) {
    var headers = {};
    var token = currentAccessToken();
    if (token) headers['Authorization'] = 'Bearer ' + token;
    var url = '/api/visualization/data?dataType=kpi_18_5' + (tahun ? ('&tahun=' + encodeURIComponent(tahun)) : '');
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
      state = await fetchApiData(state.tahun);
    } catch (err) {
      showErrorState(err);
      return;
    }
    renderAll();
  }

  // ------------------------------------------------------------------
  // RENDER TABEL (format sama file 18.5: ANGG/REAL manual + ±/% otomatis)
  // ------------------------------------------------------------------
  function buildHead(period) {
    var idxs = monthIndexesFor(period);
    var r1 = '<tr class="r1"><th rowspan="3" style="min-width:30px;">NO</th><th rowspan="3" style="min-width:160px;">URAIAN</th>';
    idxs.forEach(function (mi) { r1 += '<th class="month" colspan="4">' + monthLabel(mi) + '</th>'; });
    r1 += '</tr>';
    var r2 = '<tr class="r2">';
    idxs.forEach(function () { r2 += '<th>ANGG</th><th>REAL</th><th colspan="2">RATIO EFFISIENSI</th>'; });
    r2 += '</tr>';
    var r3 = '<tr class="r3">';
    idxs.forEach(function () { r3 += '<th></th><th></th><th>±</th><th>%</th>'; });
    r3 += '</tr>';
    return r1 + r2 + r3;
  }

  function cellInput(g, mi, kind) {
    var v = kind === 'angg' ? g.angg[mi] : g.real[mi];
    var val = v !== null && v !== undefined ? v : '';
    var p = fiscalPeriod(mi);
    return '<td class="' + (kind === 'angg' ? 'angg' : 'real') + '"><div class="cellwrap">' +
      '<input class="cell inpval" type="text" inputmode="decimal" value="' + val + '"' +
      ' data-p="' + p + '" data-i="' + g.no + '" data-k="' + kind + '"' + (isAdmin ? '' : ' readonly') +
      ' title="' + (kind === 'angg' ? 'Anggaran jumlah alat' : 'Realisasi jumlah alat terpantau') + '"></div></td>';
  }

  function cellRatio(g, mi, kind) {
    var a = g.angg[mi], r = g.real[mi];
    var has = a !== null && r !== null && a > 0;
    if (!has) return '<td class="ratio"><div class="cellwrap"></div></td>';
    var pm = r - a, pct = r / a * 100;
    var text = kind === "pm" ? (pm >= 0 ? "+" : "") + pm : pct.toFixed(1) + "%";
    var cls = ratioClass(pct);
    return '<td class="ratio"><div class="cellwrap"><span class="pill ' + cls + '">' + text + '</span></div></td>';
  }

  function renderTable() {
    var table = document.getElementById("mainTable");
    var idxs = monthIndexesFor(currentPeriod);
    var html = "<thead>" + buildHead(currentPeriod) + "</thead><tbody>";

    state.groups.forEach(function (g, gi) {
      html += '<tr><td class="no">' + g.no + '</td><td class="name">' + esc(g.label) + '</td>';
      idxs.forEach(function (mi) {
        html += cellInput(g, mi, "angg") + cellInput(g, mi, "real") + cellRatio(g, mi, "pm") + cellRatio(g, mi, "pct");
      });
      html += '</tr>';
    });

    // RATA-RATA: SUM ANGG/REAL per bulan, AVERAGE %; bulan kosong ikut kosong.
    html += '<tr class="sum"><td class="no"></td><td class="name">RATA-RATA</td>';
    idxs.forEach(function (mi) {
      var sumA = 0, sumR = 0, pcts = [], any = false;
      state.groups.forEach(function (g) {
        var a = g.angg[mi], r = g.real[mi];
        if (a !== null && a !== undefined) sumA += a;
        if (r !== null && r !== undefined) sumR += r;
        if (a !== null && a !== undefined && r !== null && r !== undefined) pcts.push(r / a * 100);
        if (a !== null || r !== null) any = true;
      });
      if (!any) {
        html += '<td class="angg"></td><td class="real"></td><td class="ratio"></td><td class="ratio"></td>';
      } else {
        var avg = pcts.length ? pcts.reduce(function (a, b) { return a + b; }, 0) / pcts.length : null;
        html += '<td class="angg"><div class="cellwrap"><span class="cellnum">' + sumA + '</span></div></td>';
        html += '<td class="real"><div class="cellwrap web"><span class="cellnum">' + sumR + '</span></div></td>';
        html += '<td class="ratio"></td>';
        html += '<td class="ratio"><div class="cellwrap"><span class="pill ' + (avg !== null ? ratioClass(avg) : 'dim') + '">' +
          (avg !== null ? avg.toFixed(1) + '%' : '') + '</span></div></td>';
      }
    });
    html += '</tr>';

    html += '</tbody>';
    table.innerHTML = html;

    document.getElementById("tableFoot").innerHTML =
      'ANGG &amp; REAL <b>diisi manual</b> oleh admin per bulan; ± &amp; % terhitung otomatis. Tahun fiskal: ' +
      'blok Juli–Desember ' + state.tahun + ' dan Januari–Juni ' + (Number(state.tahun) + 1) + '.';
  }

  // ------------------------------------------------------------------
  // SIMPAN NILAI MANUAL (per periode + item, saat ANGG/REAL diubah)
  // ------------------------------------------------------------------
  async function saveValues(periode, itemNo, angg, real) {
    var token = currentAccessToken();
    var res = await fetch('/api/visualization/admin-input', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ kind: 'kpi_18_5_values', periode: periode, item_no: itemNo, angg: angg, real: real })
    });
    if (!res.ok) { var d = await res.json().catch(function () { return {}; }); throw new Error(d.error || ('HTTP ' + res.status)); }
  }

  // ------------------------------------------------------------------
  // KETERANGAN & PENANDATANGAN (global, pola sama KPI lain)
  // ------------------------------------------------------------------
  async function saveMeta() {
    var token = currentAccessToken();
    var body = {
      kind: 'kpi_18_5_meta',
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
    // disimpan ke database. Lihat catatan yang sama di KPI lain.
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
    badge.innerHTML = '<span class="status-pill good">Data Asli — Tahun ' + state.tahun + '</span>';
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
    renderTable();
  });

  document.getElementById("addKet").addEventListener("click", function () {
    if (!isAdmin) return;
    state.meta.keterangan.push("");
    renderKet();
  });

  // Perubahan ANGG/REAL -> simpan, lalu render ulang supaya ±/% ikut update.
  document.getElementById("mainTable").addEventListener("change", async function (e) {
    var inp = e.target.closest('input.inpval');
    if (!inp || !isAdmin) return;
    var p = inp.dataset.p, it = Number(inp.dataset.i);
    var table = document.getElementById('mainTable');
    var anggInp = table.querySelector('input[data-p="' + p + '"][data-i="' + it + '"][data-k="angg"]');
    var realInp = table.querySelector('input[data-p="' + p + '"][data-i="' + it + '"][data-k="real"]');
    var angg = parseNum(anggInp.value), real = parseNum(realInp.value);
    var item = state.groups[it - 1];
    var mi = miFromPeriode(p);
    try {
      await saveValues(p, it, angg, real);
      if (item) { item.angg[mi] = angg; item.real[mi] = real; }
      renderTable();
      toast('Nilai ' + item.label + ' ' + MONTHS[mi] + ' disimpan.');
    } catch (err) {
      toast('Gagal menyimpan: ' + err.message);
      reloadSameYear();
    }
  });

  // ------------------------------------------------------------------
  // UNDUH EXCEL -- dibangun di SERVER (exceljs), lihat catatan di
  // lib/visualization/kpi.js.
  // ------------------------------------------------------------------
  document.getElementById("downloadBtn").addEventListener("click", async function () {
    if (!isAdmin) {
      alert('Unduh Excel khusus admin. Silakan login admin terlebih dahulu.');
      window.location.href = '../../login.html?redirect=' + encodeURIComponent('apps/kpi-sab/peralatan.html');
      return;
    }
    var btn = document.getElementById('downloadBtn');
    var oldText = btn.textContent;
    btn.disabled = true; btn.textContent = 'Menyiapkan Excel...';
    try {
      var token = currentAccessToken();
      var tanggalTtd = document.getElementById('signDate').value;
      var apiUrl = '/api/visualization/data?dataType=kpi_18_5_xlsx&tahun=' + encodeURIComponent(state.tahun) +
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
      a.href = url; a.download = '18.5 Monitoring Kondisi Peralatan ' + state.tahun + '.xlsx';
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
    var message = 'Halo, saya' + namaPart + ' baru saja mengirim permintaan akses data KPI 18.5 Monitoring Kondisi Peralatan di website, mohon persetujuannya.';
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
