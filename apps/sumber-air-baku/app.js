// ===========================================================================
// Daftar Sumber Air Baku — apps/sumber-air-baku
// ---------------------------------------------------------------------------
// Dua menu: Waduk & Sumur. Daftar sumber (nama + koordinat) diambil dari
// apps/peta-ipa-sumur/data/lokasi.json (satu sumber kebenaran untuk peta &
// daftar), lalu digabung dengan detail yang disimpan di DB (lihat
// ?action=sumber di admin-library.js). Detailnya terkunci: tanpa akses
// visitor cuma lihat nama + gerbang "Minta Akses"; admin dapat mengisi.
// ===========================================================================

const DATA_URL = '/api/visualization/data';
const ADMIN_URL = '/api/visualization/admin-library';
const LOKASI_URL = '../peta-ipa-sumur/data/lokasi.json';

const INSTALLASI_LABEL = {
  gunung_sari: 'IPA Gunung Sari',
  kampung_damai: 'IPA Kampung Damai',
  teritip: 'IPA Teritip',
  gunung_tembak: 'IPA Gunung Tembak',
  prapatan: 'IPA Prapatan',
  zamp: 'IPA Zamp',
  kampung_baru_ulu: 'IPA Kampung Baru Ulu'
};
const INSTALLASI_URUTAN = Object.keys(INSTALLASI_LABEL);

const state = {
  lokasi: { waduk: [], sumur: [] },
  detailWaduk: {},          // id -> record detail
  detailSumur: {},          // id -> record detail
  lockedWaduk: true,
  lockedSumur: true,
  menu: 'waduk',
  isAdmin: false,
  pollTimer: null
};

// Status modal edit yang sedang terbuka (jenis, id, attachment lama & baru).
let edit = null;

const $ = id => document.getElementById(id);

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function currentAccessToken() {
  return localStorage.getItem('token') || localStorage.getItem('vizAccessToken') || '';
}

function authHeaders(extra) {
  const t = currentAccessToken();
  return Object.assign({ 'Content-Type': 'application/json' }, t ? { 'Authorization': 'Bearer ' + t } : {}, extra || {});
}

// ---------------------------------------------------------------------------
// Muat data
// ---------------------------------------------------------------------------
async function loadJSON(url, fallback) {
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } catch (e) { return fallback; }
}

async function muatDetail(jenis) {
  const dataType = jenis === 'waduk' ? 'sumber_waduk' : 'sumber_sumur';
  const target = jenis === 'waduk' ? 'detailWaduk' : 'detailSumur';
  try {
    const res = await fetch(DATA_URL + '?dataType=' + dataType, { headers: authHeaders() });
    const d = await res.json().catch(() => ({}));
    if (d.locked) {
      if (jenis === 'waduk') state.lockedWaduk = true; else state.lockedSumur = true;
      state[target] = {};
      return;
    }
    if (jenis === 'waduk') state.lockedWaduk = false; else state.lockedSumur = false;
    const map = {};
    (d.rows || []).forEach(r => map[r.waduk_id || r.sumur_id] = r);
    state[target] = map;
  } catch (e) {
    if (jenis === 'waduk') state.lockedWaduk = true; else state.lockedSumur = true;
    state[target] = {};
  }
}

function lockedFor(jenis) { return jenis === 'waduk' ? state.lockedWaduk : state.lockedSumur; }

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------
function render() {
  document.querySelectorAll('.menu-btn').forEach(b => b.classList.toggle('active', b.dataset.menu === state.menu));
  const jenis = state.menu;
  const locked = lockedFor(jenis);
  const app = $('app');

  let html = '';
  if (locked) {
    html += `<div class="lock-banner">
      <span><b>Detail ${jenis === 'waduk' ? 'waduk' : 'sumur'} terkunci.</b> Data ini dilindungi — minta akses dulu untuk melihat &amp; mengisi detail.</span>
      <button class="btn-primary" id="btnMintaAkses">Minta Akses</button>
    </div>`;
  }
  if (state.isAdmin) {
    html += `<div class="toolbar">
      <span class="count">${jenis === 'waduk' ? 'Waduk' : 'Sumur'} · ${(jenis === 'waduk' ? state.lokasi.waduk : state.lokasi.sumur).length} titik</span>
      <button class="mini-btn" id="btnTambah">+ Tambah Data ${jenis === 'waduk' ? 'Waduk' : 'Sumur'}</button>
    </div>`;
  } else {
    html += `<div class="toolbar">
      <span class="count">${jenis === 'waduk' ? 'Waduk' : 'Sumur'} · ${(jenis === 'waduk' ? state.lokasi.waduk : state.lokasi.sumur).length} titik</span>
    </div>`;
  }
  html += jenis === 'waduk' ? renderWaduk() : renderSumur();

  app.innerHTML = html;

  const minta = $('btnMintaAkses');
  if (minta) minta.addEventListener('click', bukaModalAkses);
  const tambah = $('btnTambah');
  if (tambah) tambah.addEventListener('click', bukaModalTambah);
  if (!locked) bindCardTools();
}

function gmapsBlok(lat, lng) {
  const lihat = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
  const rute = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
  return `<div class="gmaps-aksi">
    <a class="gm-btn ghost" target="_blank" rel="noopener" href="${lihat}">Lihat di Maps</a>
    <a class="gm-btn solid" target="_blank" rel="noopener" href="${rute}">Rute ke sini</a>
  </div>`;
}

function bindCardTools() {
  document.querySelectorAll('[data-edit]').forEach(b =>
    b.addEventListener('click', () => editSumber(b.dataset.edit, b.dataset.id)));
  document.querySelectorAll('[data-hapus]').forEach(b =>
    b.addEventListener('click', () => hapusSumber(b.dataset.hapus, b.dataset.id)));
}

// --- Waduk ---
function renderWaduk() {
  const rows = state.lokasi.waduk;
  if (!rows.length) return '<div class="loading-note">Belum ada data waduk.</div>';
  return `<div class="sumber-grid">${rows.map(w => kartuWaduk(w)).join('')}</div>`;
}

function kartuWaduk(w) {
  const d = state.detailWaduk[w.id];
  const locked = state.lockedWaduk;
  const foto = (d && d.foto_url)
    ? `<img class="card-foto" src="${esc(d.foto_url)}" alt="${esc(w.nama)}">`
    : `<div class="card-foto-empty">${locked ? 'Foto terkunci' : 'Belum ada foto'}</div>`;

  let detailHtml;
  if (locked) {
    detailHtml = `<div class="placeholder">Detail terkunci — minta akses.</div>`;
  } else if (d) {
    const items = [['Luas', d.luas], ['Kapasitas', d.kapasitas], ['Limpasan', d.limpasan]];
    detailHtml = `<div class="detail-grid">${items.map(i =>
      i[1] ? `<span class="k">${i[0]}</span><span class="v">${esc(i[1])}</span>` : '').join('')}
      ${d.keterangan ? `<div class="keterangan">${esc(d.keterangan)}</div>` : ''}</div>`;
  } else {
    detailHtml = `<div class="placeholder">Belum ada data detail.</div>`;
  }

  const koordinat = `${w.lat.toFixed(5)}, ${w.lng.toFixed(5)}`;
  const tools = (state.isAdmin && !locked)
    ? `<div class="card-tools">
        ${d
          ? `<button class="mini-btn" data-edit="waduk" data-id="${w.id}">Edit</button><button class="mini-btn danger" data-hapus="waduk" data-id="${w.id}">Hapus</button>`
          : `<button class="mini-btn" data-edit="waduk" data-id="${w.id}">Isi Data</button>`}
      </div>`
    : '';

  return `<div class="sumber-card">
    <div class="card-head"><div><h3>${esc(w.nama)}</h3><div class="sub">${koordinat}</div></div></div>
    ${foto}
    ${gmapsBlok(w.lat, w.lng)}
    ${detailHtml}
    ${tools}
  </div>`;
}

// --- Sumur (dikelompokkan per instalasi) ---
function renderSumur() {
  const sumur = state.lokasi.sumur;
  if (!sumur.length) return '<div class="loading-note">Belum ada data sumur.</div>';
  const groups = {};
  sumur.forEach(s => { (groups[s.installation] = groups[s.installation] || []).push(s); });
  const order = Object.keys(groups).sort((a, b) =>
    (INSTALLASI_URUTAN.indexOf(a) === -1 ? 99 : INSTALLASI_URUTAN.indexOf(a)) -
    (INSTALLASI_URUTAN.indexOf(b) === -1 ? 99 : INSTALLASI_URUTAN.indexOf(b)));
  return order.map(inst => {
    const label = INSTALLASI_LABEL[inst] || inst;
    return `<div class="install-group">
      <h2><span class="dot"></span>${esc(label)} <span class="sub">· ${groups[inst].length} sumur</span></h2>
      <div class="sumber-grid">${groups[inst].map(s => kartuSumur(s)).join('')}</div>
    </div>`;
  }).join('');
}

function kartuSumur(s) {
  const d = state.detailSumur[s.id];
  const locked = state.lockedSumur;

  let detailHtml;
  if (locked) {
    detailHtml = `<div class="placeholder">Detail terkunci — minta akses.</div>`;
  } else if (d) {
    const items = [
      ['Tahun Dibuat', d.tahun_dibuat], ['Pipa Hisap', d.pipa_hisap],
      ['Kedalaman', d.kedalaman], ['Panjang Pipa', d.panjang_pipa],
      ['Statis', d.statis ? d.statis + ' m' : null], ['Dinamis', d.dinamis ? d.dinamis + ' m' : null],
      ['Jenis Pompa', d.jenis_pompa]
    ];
    detailHtml = `<div class="detail-grid">${items.map(i =>
      i[1] ? `<span class="k">${i[0]}</span><span class="v">${esc(i[1])}</span>` : '').join('')}
      ${d.keterangan ? `<div class="keterangan">${esc(d.keterangan)}</div>` : ''}</div>
      <div class="lampiran-row">
        <span class="lbl">Lampiran</span>
        ${d.lampiran_logging_url
          ? `<a class="attach-link" href="${esc(d.lampiran_logging_url)}" target="_blank" rel="noopener">Data Logging ↗</a>`
          : `<span class="attach-empty">Belum ada data logging</span>`}
        ${d.lampiran_pumping_url
          ? `<a class="attach-link" href="${esc(d.lampiran_pumping_url)}" target="_blank" rel="noopener">Pumping Test ↗</a>`
          : `<span class="attach-empty">Belum ada pumping test</span>`}
      </div>`;
  } else {
    detailHtml = `<div class="placeholder">Belum ada data detail.</div>`;
  }

  const koordinat = `${s.lat.toFixed(5)}, ${s.lng.toFixed(5)}`;
  const tools = (state.isAdmin && !locked)
    ? `<div class="card-tools">
        ${d
          ? `<button class="mini-btn" data-edit="sumur" data-id="${s.id}">Edit</button><button class="mini-btn danger" data-hapus="sumur" data-id="${s.id}">Hapus</button>`
          : `<button class="mini-btn" data-edit="sumur" data-id="${s.id}">Isi Data</button>`}
      </div>`
    : '';

  return `<div class="sumber-card">
    <div class="card-head"><div><h3>${esc(s.nama)}</h3><div class="sub">${koordinat}</div></div></div>
    ${gmapsBlok(s.lat, s.lng)}
    ${detailHtml}
    ${tools}
  </div>`;
}

// ---------------------------------------------------------------------------
// Gerbang "Minta Akses" (pola sama apps/library & apps/riwayat-air-baku)
// ---------------------------------------------------------------------------
function bukaModalAkses() {
  $('accessNama').value = '';
  $('accessAlasan').value = '';
  $('accessStatus').textContent = '';
  $('accessStatus').className = 'status-msg';
  $('accessBatal').textContent = 'Batal';
  $('accessKirim').disabled = false;
  $('accessModal').style.display = 'flex';
  $('accessNama').focus();
}

function restoreVizSession() {
  const token = localStorage.getItem('vizAccessToken');
  const exp = Number(localStorage.getItem('vizAccessExpiresAt') || 0);
  if (token && exp > Date.now()) {
    // token masih berlaku, biarkan
  } else {
    localStorage.removeItem('vizAccessToken');
    localStorage.removeItem('vizAccessExpiresAt');
  }
  const reqId = localStorage.getItem('vizRequestId');
  const reqSecret = localStorage.getItem('vizRequestSecret');
  if (reqId && reqSecret) mulaiPolling(reqId, reqSecret);
}

async function kirimPermintaanAkses() {
  const nama = $('accessNama').value.trim();
  const alasan = $('accessAlasan').value.trim();
  const msg = $('accessStatus');
  if (!nama) { msg.textContent = 'Isi nama dulu ya.'; msg.className = 'status-msg error'; return; }
  const dataType = state.menu === 'waduk' ? 'sumber_waduk' : 'sumber_sumur';
  $('accessKirim').disabled = true;
  msg.textContent = 'Mengirim…'; msg.className = 'status-msg';
  try {
    const res = await fetch('/api/visualization/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestedBy: nama, dataType, reason: alasan || undefined })
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok || !d.success) {
      msg.textContent = d.error || ('Gagal (' + res.status + ')');
      msg.className = 'status-msg error';
      $('accessKirim').disabled = false;
      return;
    }
    localStorage.setItem('vizRequestId', d.requestId);
    localStorage.setItem('vizRequestSecret', d.pollSecret);
    msg.textContent = 'Permintaan terkirim. Menunggu persetujuan admin…';
    msg.className = 'status-msg ok';
    $('accessBatal').textContent = 'Tutup';
    mulaiPolling(d.requestId, d.pollSecret);
  } catch (err) {
    msg.textContent = 'Gagal mengirim: ' + err.message;
    msg.className = 'status-msg error';
    $('accessKirim').disabled = false;
  }
}

function mulaiPolling(requestId, secret) {
  clearInterval(state.pollTimer);
  state.pollTimer = setInterval(() => cekStatusAkses(requestId, secret), 4000);
  cekStatusAkses(requestId, secret);
}

async function cekStatusAkses(requestId, secret) {
  try {
    const res = await fetch(`/api/visualization/status?id=${encodeURIComponent(requestId)}&secret=${encodeURIComponent(secret)}`);
    const d = await res.json().catch(() => ({}));
    if (d.status === 'approved' && d.token) {
      clearInterval(state.pollTimer);
      localStorage.setItem('vizAccessToken', d.token);
      localStorage.setItem('vizAccessExpiresAt', String(d.expiresAt || (Date.now() + 4 * 3600 * 1000)));
      localStorage.removeItem('vizRequestId');
      localStorage.removeItem('vizRequestSecret');
      $('accessModal').style.display = 'none';
      initData();
    } else if (d.status === 'expired') {
      clearInterval(state.pollTimer);
      localStorage.removeItem('vizRequestId');
      localStorage.removeItem('vizRequestSecret');
      $('accessStatus').textContent = 'Permintaan kedaluwarsa. Coba kirim ulang.';
      $('accessStatus').className = 'status-msg error';
    }
  } catch (e) { /* diam: coba lagi di polling berikutnya */ }
}

// ---------------------------------------------------------------------------
// Admin: tambah / edit / hapus
// ---------------------------------------------------------------------------
function bukaModalTambah() {
  const jenis = state.menu;
  if (lockedFor(jenis)) { alert('Minta akses dulu untuk mengisi data.'); return; }
  const lokasiList = jenis === 'waduk' ? state.lokasi.waduk : state.lokasi.sumur;
  const existing = jenis === 'waduk' ? state.detailWaduk : state.detailSumur;
  const tersedia = lokasiList.filter(x => !existing[x.id]);
  if (!tersedia.length) {
    alert('Semua ' + jenis + ' sudah punya data. Gunakan tombol Edit pada kartu.');
    return;
  }
  $('tambahTitle').textContent = 'Tambah Data ' + (jenis === 'waduk' ? 'Waduk' : 'Sumur');
  const sel = $('tambahSelect');
  sel.innerHTML = tersedia.map(x => `<option value="${x.id}">${esc(x.nama)}</option>`).join('');
  sel.dataset.jenis = jenis;
  $('tambahModal').style.display = 'flex';
}

function editSumber(jenis, id) {
  if (lockedFor(jenis)) { alert('Minta akses dulu untuk mengisi data.'); return; }
  const lokasiList = jenis === 'waduk' ? state.lokasi.waduk : state.lokasi.sumur;
  const lok = lokasiList.find(x => x.id === id);
  const d = (jenis === 'waduk' ? state.detailWaduk : state.detailSumur)[id] || {};

  edit = {
    jenis, id,
    installation: (lok && lok.installation) ? lok.installation : '',
    fotoUrl: null, fotoPath: null, fotoDataUrl: null, hapusFoto: false,
    loggingUrl: null, loggingPath: null, loggingBytes: null, loggingName: null, loggingMime: null, hapusLogging: false,
    pumpingUrl: null, pumpingPath: null, pumpingBytes: null, pumpingName: null, pumpingMime: null, hapusPumping: false
  };

  $('editTitle').textContent = jenis === 'waduk' ? 'Detail Waduk' : 'Detail Sumur';
  $('editHint').textContent = lok ? lok.nama : '';
  $('fNama').value = lok ? lok.nama : '';
  $('fKoordinat').value = lok ? lok.lat.toFixed(6) + ', ' + lok.lng.toFixed(6) : '';
  $('wadukFields').style.display = jenis === 'waduk' ? 'block' : 'none';
  $('sumurFields').style.display = jenis === 'sumur' ? 'block' : 'none';

  if (jenis === 'waduk') {
    $('wLuas').value = d.luas || '';
    $('wKapasitas').value = d.kapasitas || '';
    $('wLimpasan').value = d.limpasan || '';
    $('wKeterangan').value = d.keterangan || '';
    edit.fotoUrl = d.foto_url || null;
    edit.fotoPath = d.foto_pathname || null;
    $('wFoto').value = '';
    $('wFotoNama').textContent = d.foto_url ? 'Foto tersimpan.' : 'Belum ada foto.';
  } else {
    $('sTahun').value = d.tahun_dibuat || '';
    $('sPipa').value = d.pipa_hisap || '';
    $('sKedalaman').value = d.kedalaman || '';
    $('sPanjang').value = d.panjang_pipa || '';
    $('sStatis').value = d.statis || '';
    $('sDinamis').value = d.dinamis || '';
    $('sJenisPompa').value = d.jenis_pompa || '';
    $('sKeterangan').value = d.keterangan || '';
    edit.loggingUrl = d.lampiran_logging_url || null;
    edit.loggingPath = d.lampiran_logging_pathname || null;
    edit.loggingBytes = null; edit.loggingName = null; edit.loggingMime = null;
    edit.pumpingUrl = d.lampiran_pumping_url || null;
    edit.pumpingPath = d.lampiran_pumping_pathname || null;
    edit.pumpingBytes = null; edit.pumpingName = null; edit.pumpingMime = null;
    $('sLogging').value = '';
    $('sPumping').value = '';
    $('sLoggingNama').textContent = d.lampiran_logging_url ? 'Lampiran tersimpan.' : 'Belum ada lampiran.';
    $('sPumpingNama').textContent = d.lampiran_pumping_url ? 'Lampiran tersimpan.' : 'Belum ada lampiran.';
    muatKonteksAuto(id); // isi statis/dinamis & jenis pompa dari data web
  }

  $('editStatus').textContent = '';
  $('editStatus').className = 'status-msg';
  // Reset tombol Simpan ke kondisi normal SETIAP modal edit dibuka. Sebelumnya,
  // setelah simpan BERHASIL tombol tidak pernah di-re-enable (tetap disabled
  // dengan spinner "Menyimpan…"), jadi saat membuka kartu berikutnya tombol
  // tidak bisa diklik -- terasa seperti "simpan muter terus tanpa henti".
  const btnSimpan = $('editSimpan');
  btnSimpan.disabled = false;
  btnSimpan.textContent = 'Simpan';
  $('editModal').style.display = 'flex';
}

// Auto-fill: statis/dinamis dari pembacaan terbaru, jenis pompa dari KPI.
async function muatKonteksAuto(sumurId) {
  try {
    const res = await fetch(`${ADMIN_URL}?action=sumber&jenis=sumur&id=${encodeURIComponent(sumurId)}&context=1`, { headers: authHeaders() });
    const d = await res.json().catch(() => ({}));
    const auto = d.auto || {};
    if (auto.statis && !$('sStatis').value) $('sStatis').value = auto.statis;
    if (auto.dinamis && !$('sDinamis').value) $('sDinamis').value = auto.dinamis;
    if (auto.jenisPompa && !$('sJenisPompa').value) $('sJenisPompa').value = auto.jenisPompa;
  } catch (e) { /* abaikan */ }
}

function hapusSumber(jenis, id) {
  if (!confirm('Hapus data detail ' + jenis + ' ini? File lampirannya ikut dihapus dari penyimpanan.')) return;
  (async () => {
    try {
      const res = await fetch(`${ADMIN_URL}?action=sumber&jenis=${jenis}&id=${encodeURIComponent(id)}`, {
        method: 'DELETE', headers: authHeaders()
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.success) { alert(d.error || ('Gagal menghapus (' + res.status + ')')); return; }
      await muatDetail(jenis);
      render();
    } catch (err) { alert('Gagal menghapus: ' + err.message); }
  })();
}

async function simpanEdit() {
  const btn = $('editSimpan');
  const msg = $('editStatus');
  const j = edit.jenis;
  const body = { jenis: j, urutan: 0 };

  if (j === 'waduk') {
    Object.assign(body, {
      waduk_id: edit.id,
      nama: $('fNama').value.trim(),
      luas: $('wLuas').value, kapasitas: $('wKapasitas').value,
      limpasan: $('wLimpasan').value, keterangan: $('wKeterangan').value,
      foto_url: edit.fotoUrl, foto_pathname: edit.fotoPath,
      hapusFoto: !!edit.hapusFoto
    });
    if (edit.fotoDataUrl) body.foto_dataUrl = edit.fotoDataUrl;
  } else {
    // Lampiran PDF baru diunggah dulu sebagai file mentah (bukan base64 --
    // base64 menambah ±33% dan melewati batas body Vercel), baru url/pathname
    // hasilnya ikut di metadata. Lihat ?action=sumber&upload=1 di server.
    try {
      if (edit.loggingBytes) {
        const up = await unggahLampiranFile(edit.loggingBytes, edit.loggingMime, 'logging', edit.id);
        edit.loggingUrl = up.url; edit.loggingPath = up.pathname;
        edit.hapusLogging = false;
      }
      if (edit.pumpingBytes) {
        const up = await unggahLampiranFile(edit.pumpingBytes, edit.pumpingMime, 'pumping', edit.id);
        edit.pumpingUrl = up.url; edit.pumpingPath = up.pathname;
        edit.hapusPumping = false;
      }
    } catch (err) {
      msg.textContent = 'Gagal mengunggah lampiran: ' + err.message;
      msg.className = 'status-msg error';
      return;
    }
    Object.assign(body, {
      sumur_id: edit.id,
      installation: edit.installation,
      nama: $('fNama').value.trim(),
      tahun_dibuat: $('sTahun').value, pipa_hisap: $('sPipa').value,
      kedalaman: $('sKedalaman').value, panjang_pipa: $('sPanjang').value,
      statis: $('sStatis').value, dinamis: $('sDinamis').value,
      jenis_pompa: $('sJenisPompa').value, keterangan: $('sKeterangan').value,
      lampiran_logging_url: edit.loggingUrl, lampiran_logging_pathname: edit.loggingPath,
      lampiran_pumping_url: edit.pumpingUrl, lampiran_pumping_pathname: edit.pumpingPath,
      hapusLogging: !!edit.hapusLogging, hapusPumping: !!edit.hapusPumping
    });
  }

  if (!body.nama) { msg.textContent = 'Nama wajib diisi.'; msg.className = 'status-msg error'; return; }

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>Menyimpan…';
  msg.textContent = '';
  msg.className = 'status-msg';
  try {
    const res = await fetch(`${ADMIN_URL}?action=sumber`, {
      method: 'POST', headers: authHeaders(), body: JSON.stringify(body)
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok || !d.success) {
      msg.textContent = d.error || ('Gagal menyimpan (' + res.status + ')');
      msg.className = 'status-msg error';
      btn.disabled = false; btn.textContent = 'Simpan';
      return;
    }
    // Reset tombol ke "Simpan" normal (lihat komentar di editSumber):
    // sebelumnya tombol tertinggal disabled+spinner setelah simpan berhasil.
    btn.disabled = false;
    btn.textContent = 'Simpan';
    $('editModal').style.display = 'none';
    await muatDetail(j);
    render();
  } catch (err) {
    msg.textContent = 'Gagal menyimpan: ' + err.message;
    msg.className = 'status-msg error';
    btn.disabled = false; btn.textContent = 'Simpan';
  }
}

// --- File lampiran ---
function bacaFileDataUrl(file, maxBytes, cb) {
  if (!file) return;
  if (file.size > maxBytes) {
    alert('File terlalu besar. Maksimal ' + Math.round(maxBytes / 1024 / 1024) + ' MB.');
    return;
  }
  const fr = new FileReader();
  fr.onload = () => cb(fr.result);
  fr.readAsDataURL(file);
}

// Baca file PDF sebagai byte mentah (bukan dataURL): supaya bisa diunggah
// sebagai body biner dan muat di batas 4,5 MB Vercel walau base64-nya lebih
// besar. Batas file PDF = 4 MB (hasil kompresi umumnya muat).
function bacaFileBytes(file, maxBytes, cb) {
  if (!file) return;
  if (file.size > maxBytes) {
    alert('File terlalu besar. Maksimal ' + Math.round(maxBytes / 1024 / 1024) + ' MB.');
    return;
  }
  file.arrayBuffer().then(buf => cb(buf, file)).catch(e => alert('Gagal membaca file: ' + e.message));
}

// Unggah lampiran PDF mentah ke server -> Vercel Blob, dapat url/pathname.
async function unggahLampiranFile(bytes, mime, lampiran, sumurId) {
  const t = currentAccessToken();
  const res = await fetch(`${ADMIN_URL}?action=sumber&upload=1&jenis=sumur&lampiran=${lampiran}&id=${encodeURIComponent(sumurId)}`, {
    method: 'POST',
    headers: {
      'Content-Type': mime || 'application/octet-stream',
      ...(t ? { 'Authorization': 'Bearer ' + t } : {})
    },
    body: bytes
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok || !d.success) throw new Error(d.error || ('Gagal mengunggah (' + res.status + ')'));
  return { url: d.url, pathname: d.pathname };
}

function onFotoDipilih() {
  const f = $('wFoto').files[0];
  if (!f) return;
  edit.hapusFoto = false; // file baru mengalahkan flag "hapus"
  if (typeof kompresFoto === 'function') {
    kompresFoto(f).then(k => {
      edit.fotoDataUrl = k.dataUrl;
      $('wFotoNama').textContent = k.nama + ' (siap unggah)';
    }).catch(e => alert('Gagal memproses foto: ' + e.message));
  } else {
    bacaFileDataUrl(f, 4 * 1024 * 1024, url => {
      edit.fotoDataUrl = url;
      $('wFotoNama').textContent = f.name + ' (siap unggah)';
    });
  }
}

function onLoggingDipilih() {
  const f = $('sLogging').files[0];
  if (!f) return;
  edit.hapusLogging = false; // file baru mengalahkan flag "hapus"
  bacaFileBytes(f, 4 * 1024 * 1024, (buf) => {
    edit.loggingBytes = buf;
    edit.loggingName = f.name;
    edit.loggingMime = f.type || 'application/pdf';
    $('sLoggingNama').textContent = f.name + ' (siap unggah)';
  });
}

function onPumpingDipilih() {
  const f = $('sPumping').files[0];
  if (!f) return;
  edit.hapusPumping = false; // file baru mengalahkan flag "hapus"
  bacaFileBytes(f, 4 * 1024 * 1024, (buf) => {
    edit.pumpingBytes = buf;
    edit.pumpingName = f.name;
    edit.pumpingMime = f.type || 'application/pdf';
    $('sPumpingNama').textContent = f.name + ' (siap unggah)';
  });
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
function bindModalButtons() {
  $('accessBatal').addEventListener('click', () => { $('accessModal').style.display = 'none'; });
  $('accessKirim').addEventListener('click', kirimPermintaanAkses);
  $('tambahBatal').addEventListener('click', () => { $('tambahModal').style.display = 'none'; });
  $('tambahLanjut').addEventListener('click', () => {
    const sel = $('tambahSelect');
    editSumber(sel.dataset.jenis, sel.value);
    $('tambahModal').style.display = 'none';
  });
  $('editBatal').addEventListener('click', () => { $('editModal').style.display = 'none'; });
  $('editSimpan').addEventListener('click', simpanEdit);
  $('wFoto').addEventListener('change', onFotoDipilih);
  $('wFotoHapus').addEventListener('click', () => {
    edit.hapusFoto = true; edit.fotoDataUrl = null;
    $('wFotoNama').textContent = 'Foto akan dihapus.';
  });
  $('sLogging').addEventListener('change', onLoggingDipilih);
  $('sLoggingHapus').addEventListener('click', () => {
    edit.hapusLogging = true; edit.loggingDataUrl = null;
    $('sLoggingNama').textContent = 'Lampiran akan dihapus.';
  });
  $('sPumping').addEventListener('change', onPumpingDipilih);
  $('sPumpingHapus').addEventListener('click', () => {
    edit.hapusPumping = true; edit.pumpingDataUrl = null;
    $('sPumpingNama').textContent = 'Lampiran akan dihapus.';
  });
  document.querySelectorAll('.menu-btn').forEach(b =>
    b.addEventListener('click', () => { state.menu = b.dataset.menu; render(); }));
}

async function initData() {
  await Promise.all([muatDetail('waduk'), muatDetail('sumur')]);
  render();
}

async function init() {
  state.isAdmin = !!(localStorage.getItem('token') && localStorage.getItem('role') === 'admin');
  state.lokasi = await loadJSON(LOKASI_URL, { waduk: [], sumur: [] });
  restoreVizSession();
  bindModalButtons();
  await initData();
}

init();
