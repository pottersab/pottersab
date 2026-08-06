(function () {
  "use strict";

  var state = null;      // respons terakhir dari /api/visualization/data?dataType=kpi_jadwal_kegiatan
  var isAdmin = false;

  function currentAccessToken() { return localStorage.getItem('token') || null; }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // ------------------------------------------------------------------
  // MUAT DATA
  // ------------------------------------------------------------------
  async function fetchApiData(bulan) {
    var headers = {};
    var token = currentAccessToken();
    if (token) headers['Authorization'] = 'Bearer ' + token;
    var url = '/api/visualization/data?dataType=kpi_jadwal_kegiatan' + (bulan ? ('&bulan=' + encodeURIComponent(bulan)) : '');
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

  // ------------------------------------------------------------------
  // RENDER TABEL (baris = kegiatan, kolom = hari kerja, + kolom KETERANGAN)
  // ------------------------------------------------------------------
  function buildHead() {
    var n = state.workingDays.length;
    var html = '<thead><tr>' +
      '<th rowspan="2" style="min-width:38px;">NO</th>' +
      '<th rowspan="2" style="min-width:250px;">KEGIATAN</th>' +
      '<th colspan="' + n + '" style="min-width:80px;">HARI / TANGGAL</th>' +
      '<th rowspan="2" style="min-width:200px;">KETERANGAN</th>' +
      '</tr><tr>';
    state.workingDays.forEach(function (wd) {
      html += '<th class="jk-day">' + esc(wd.d) + '<b>' + esc(wd.hari) + '</b></th>';
    });
    html += '</tr></thead>';
    return html;
  }

  function rowHtml(row, ri) {
    var editable = isAdmin;
    var html = '<tr>';
    html += '<td class="no">' + row.no + '</td>';
    html += '<td class="name">' + esc(row.uraian) + '</td>';
    if (row.merged) {
      // Baris pengambilan sampel: area tanggal di-merge selebar kolom tanggal.
      html += '<td class="jk-c" colspan="' + row.cells.length + '"></td>';
    } else {
      row.cells.forEach(function (c) {
        // Penanda = warna sel (kelas .on), bukan teks centang.
        html += '<td class="jk-c' + (c ? ' on' : '') + '"></td>';
      });
    }
    var ket = (state.meta.keterangan && state.meta.keterangan[ri]) || '';
    html += '<td class="jk-ke"><input class="cell" data-k="' + ri + '" value="' + esc(ket) + '"' + (editable ? '' : ' readonly') + '></td>';
    html += '</tr>';
    return html;
  }

  function renderTable() {
    var table = document.getElementById("mainTable");
    var html = buildHead() + '<tbody>';
    state.rows.forEach(function (row, ri) { html += rowHtml(row, ri); });
    html += '</tbody>';
    table.innerHTML = html;

    document.getElementById("tableFoot").innerHTML =
      '<b>' + esc(state.monthTitle) + '</b> · ' + state.workingDays.length + ' hari kerja · ' +
      'sel <b>berwarna</b> = kegiatan berjalan hari itu; Sabtu/Minggu libur tidak ditampilkan.';
  }

  // ------------------------------------------------------------------
  // PENANDATANGAN & KODE DOKUMEN (global, tabel kpi_jadwal_kegiatan_meta)
  // ------------------------------------------------------------------
  function collectKeterangan() {
    var arr = [];
    document.querySelectorAll('#mainTable input[data-k]').forEach(function (x) {
      arr[Number(x.dataset.k)] = x.value;
    });
    return arr;
  }

  async function saveMeta() {
    var body = {
      kind: 'kpi_jadwal_kegiatan_meta',
      keterangan: collectKeterangan(),
      roleLeft: document.getElementById('role1').value,
      nameLeft: document.getElementById('name1').value,
      roleMid: document.getElementById('role2').value,
      nameMid: document.getElementById('name2').value,
      roleRight: document.getElementById('role3').value,
      nameRight: document.getElementById('name3').value,
      footerCode: document.getElementById('footerCode').value
    };
    var res = await fetch('/api/visualization/admin-input', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + currentAccessToken() },
      body: JSON.stringify(body)
    });
    if (!res.ok) { var d = await res.json().catch(function () { return {}; }); throw new Error(d.error || ('HTTP ' + res.status)); }
    // Perbarui state lokal supaya re-render berikutnya memakai nilai terbaru.
    state.meta.keterangan = body.keterangan;
    state.meta.roleLeft = body.roleLeft; state.meta.nameLeft = body.nameLeft;
    state.meta.roleMid = body.roleMid; state.meta.nameMid = body.nameMid;
    state.meta.roleRight = body.roleRight; state.meta.nameRight = body.nameRight;
    state.meta.footerCode = body.footerCode;
  }

  function renderMeta() {
    var m = state.meta || {};
    // Tanggal tanda tangan: default "Balikpapan {tanggal}" dari server, kolom
    // isian cuma bagian tanggalnya (awalan "Balikpapan" tetap di kiri form).
    document.getElementById('signDate').value = String(m.signPlaceDate || '').replace(/^Balikpapan\s*/i, '');
    document.getElementById('role1').value = m.roleLeft || '';
    document.getElementById('name1').value = m.nameLeft || '';
    document.getElementById('role2').value = m.roleMid || '';
    document.getElementById('name2').value = m.nameMid || '';
    document.getElementById('role3').value = m.roleRight || '';
    document.getElementById('name3').value = m.nameRight || '';
    document.getElementById('footerCode').value = m.footerCode || '';
    ['signDate', 'role1', 'name1', 'role2', 'name2', 'role3', 'name3', 'footerCode'].forEach(function (id) {
      document.getElementById(id).readOnly = !isAdmin;
    });
  }

  function wireMetaControls() {
    ['role1', 'name1', 'role2', 'name2', 'role3', 'name3', 'footerCode'].forEach(function (id) {
      document.getElementById(id).addEventListener('change', async function () {
        if (!isAdmin) return;
        try { await saveMeta(); toast('Penandatangan disimpan.'); }
        catch (err) { toast('Gagal menyimpan: ' + err.message); }
      });
    });
    // Keterangan di dalam tabel -- delegasi event change.
    document.getElementById('mainTable').addEventListener('change', async function (e) {
      if (!e.target.closest || !e.target.closest('input[data-k]') || !isAdmin) return;
      try { await saveMeta(); toast('Keterangan disimpan.'); }
      catch (err) { toast('Gagal menyimpan: ' + err.message); }
    });
  }

  // ------------------------------------------------------------------
  // UI UMUM
  // ------------------------------------------------------------------
  function renderMonthSelect() {
    var sel = document.getElementById("monthSelect");
    var months = (state.availableMonths && state.availableMonths.length) ? state.availableMonths : [state.bulan];
    sel.innerHTML = months.map(function (ym) {
      return '<option value="' + ym + '"' + (ym === state.bulan ? ' selected' : '') + '>' + esc(ym) + '</option>';
    }).join("");
  }

  function renderStatusBadge() {
    var badge = document.getElementById('statusBadge');
    badge.innerHTML = '<span class="status-pill good">Bulan ' + esc(state.monthTitle) + '</span>';
  }

  function updateDownloadButton() {
    var btn = document.getElementById('downloadBtn');
    if (isAdmin) { btn.textContent = 'Unduh Excel'; btn.classList.add('enabled'); }
    else { btn.textContent = '🔒 Unduh Excel (Admin)'; btn.classList.remove('enabled'); }
  }

  function renderAll() {
    renderMonthSelect();
    renderStatusBadge();
    updateDownloadButton();
    renderTable();
    renderMeta();
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

  // ------------------------------------------------------------------
  // UNDUH EXCEL -- dibangun di SERVER (exceljs), lihat catatan di
  // lib/visualization/kpi.js.
  // ------------------------------------------------------------------
  document.getElementById("downloadBtn").addEventListener("click", async function () {
    if (!isAdmin) {
      alert('Unduh Excel khusus admin. Silakan login admin terlebih dahulu.');
      window.location.href = '../../login.html?redirect=' + encodeURIComponent('apps/kpi-sab/jadwal-kegiatan.html');
      return;
    }
    var btn = document.getElementById('downloadBtn');
    var oldText = btn.textContent;
    btn.disabled = true; btn.textContent = 'Menyiapkan Excel...';
    try {
      var token = currentAccessToken();
      // Pastikan keterangan/pejabat yang baru diketik ikut diunduh.
      if (isAdmin) { try { await saveMeta(); } catch (e) {} }
      var tglValue = document.getElementById('signDate').value.trim();
      var tanggalTtd = tglValue ? ('Balikpapan ' + tglValue) : '';
      var apiUrl = '/api/visualization/data?dataType=kpi_jadwal_kegiatan_xlsx&bulan=' + encodeURIComponent(state.bulan) +
        (tanggalTtd ? '&tanggal=' + encodeURIComponent(tanggalTtd) : '');
      var res = await fetch(apiUrl, { headers: { 'Authorization': 'Bearer ' + token } });
      if (!res.ok) {
        var d = await res.json().catch(function () { return {}; });
        throw new Error(d.error || ('HTTP ' + res.status));
      }
      var blob = await res.blob();
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = 'Jadwal Kegiatan ' + state.monthTitle + '.xlsx';
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
  // INIT
  // ------------------------------------------------------------------
  async function init() {
    checkAdminStatus();
    wireMetaControls();
    await loadMonth(null);
  }

  init();
})();
