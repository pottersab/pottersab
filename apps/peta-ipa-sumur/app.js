/* ==========================================================================
   Peta Interaktif — IPA, Sumur & Waduk (Sub Divisi Sumber Air Baku)
   --------------------------------------------------------------------------
   data/lokasi.json  -> nama + koordinat BAWAAN per titik, statis.
   ?action=map-lokasi -> titik BARU & koreksi koordinat yang dipegang admin
     (tabel peta_lokasi, lihat ensurePetaTables di lib/db.js). Baris di sini
     MENANG atas lokasi.json untuk id yang sama -- itulah cara "perbaiki
     koordinat" bekerja, dan menghapus barisnya mengembalikan titik ke
     koordinat asli.
   ?action=map-latest -> angka terbaru (AP/ATD/debit/statis/dinamis/level/dll)
     + tanggal data terbaru, dari Postgres yang sama dipakai grafik existing
     (api/visualization/admin-library.js). Digabung di sini berdasarkan `id`
     yang sama di kedua sumber.
   ========================================================================== */

const MAP_LATEST_URL = '/api/visualization/admin-library?action=map-latest';
const MAP_LOKASI_URL = '/api/visualization/admin-library?action=map-lokasi';
const PETA_URL = '/api/visualization/admin-library?action=peta';

const JENIS = ['ipa', 'sumur', 'waduk'];

const BULAN_PANJANG = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const BULAN_SINGKAT = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

// AP/ATD & Sumur diinput bulanan -> "Juli 2026". Waduk diinput harian -> "20 Jul 2026".
function fmtBulanTahun(iso) {
  if (!iso) return null;
  const [y, m] = iso.split('-');
  return BULAN_PANJANG[Number(m) - 1] + ' ' + y;
}
function fmtTanggalLengkap(iso) {
  if (!iso) return null;
  const [y, m, d] = iso.split('-');
  return Number(d) + ' ' + BULAN_SINGKAT[Number(m) - 1] + ' ' + y;
}
function dataPerHtml(label) {
  return label ? `<div class="popup-date"><span>Data per ${label}</span></div>` : '';
}

// Nama titik & keterangan sekarang datang dari input admin (bukan lagi
// berkas statis yang kami tulis sendiri), jadi wajib di-escape sebelum
// ditempel ke innerHTML popup.
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Status TIDAK PERNAH diisi manual -- selalu dihitung dari ADA/TIDAKNYA data
// debit (null = tidak dilaporkan = non-aktif), bukan dari nilainya, jadi debit
// 0 tetap terhitung aktif. Sama seperti hitungan "Sumur Aktif" di beranda
// (api/home-summary.js).
//
// Jendela waktunya ditentukan di query, bukan di sini: map-latest cuma
// mengirim debit dari 12 bulan terakhir, jadi sumur yang berhenti dilaporkan
// lebih dari setahun sampai ke sini sebagai null dan jatuh ke non-aktif.
function statusFromDebit(debit) {
  return (debit === null || debit === undefined) ? 'non-aktif' : 'aktif';
}

// Format angka gaya Indonesia: koma buat desimal, titik buat ribuan,
// maksimal 2 angka di belakang koma (mis. 363131.67 -> "363.131,67").
function fmtID(v) {
  return Number(v).toLocaleString('id-ID', { maximumFractionDigits: 2 });
}
// Khusus AP/ATD: bilangan bulat saja, tanpa koma/angka desimal (mis.
// 363131.67 -> "363.131").
function fmtIDInt(v) {
  return Math.round(Number(v)).toLocaleString('id-ID');
}
// opts.applicable === false -> field ini memang TIDAK ADA buat instalasi ini
// (beda dari null biasa yang berarti BELUM ADA/belum diisi bulan ini).
function statBox(label, v, satuan, opts) {
  opts = opts || {};
  const formatter = opts.formatter || fmtID;
  let value;
  if (opts.applicable === false) value = 'Tidak ada';
  else if (v === null || v === undefined) value = 'Belum ada';
  else value = formatter(v) + (satuan ? ' ' + satuan : '');
  return `<div class="stat-box"><span class="stat-label">${label}</span><span class="stat-value">${value}</span></div>`;
}

function popupHeader(avatarClass, iconSrc, nama, tanggalLabel) {
  return `
    <div class="popup-header">
      <span class="popup-avatar ${avatarClass}"><img src="${iconSrc}" alt=""></span>
      <div>
        <div class="popup-title">${esc(nama)}</div>
        ${dataPerHtml(tanggalLabel)}
      </div>
    </div>
  `;
}

// ---- Buka titik di Google Maps ------------------------------------------
// Pakai format resmi Google Maps URLs API supaya pin jatuh PERSIS di
// koordinat -- bukan hasil pencarian nama yang bisa meleset ke tempat lain
// dengan nama mirip. Di HP link ini otomatis membuka aplikasi Google Maps
// kalau terpasang; di desktop kebuka di tab baru.
function gmapsLihatUrl(lat, lng) {
  return 'https://www.google.com/maps/search/?api=1&query=' + lat + ',' + lng;
}
// Sekalian rute: Maps langsung menghitung arah dari posisi pengguna ke titik
// ini, jadi tim lapangan tidak perlu menekan "Rute" lagi di dalam Maps.
function gmapsRuteUrl(lat, lng) {
  return 'https://www.google.com/maps/dir/?api=1&destination=' + lat + ',' + lng;
}

const GM_PIN_SVG = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/></svg>';
const GM_NAV_SVG = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>';
const GM_EDIT_SVG = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>';

// Blok tombol di bagian bawah popup. Koordinatnya sendiri sengaja tidak
// ditampilkan supaya popup tetap pendek -- popup sumur sudah punya badge +
// stat 3 kolom.
function gmapsBlok(lat, lng) {
  return `
    <div class="gmaps-aksi">
      <a class="gm-btn solid" href="${gmapsLihatUrl(lat, lng)}" target="_blank" rel="noopener">${GM_PIN_SVG} Google Maps</a>
      <a class="gm-btn ghost" href="${gmapsRuteUrl(lat, lng)}" target="_blank" rel="noopener">${GM_NAV_SVG} Rute ke sini</a>
    </div>
  `;
}

// Tombol "Koreksi titik" cuma untuk admin (localStorage token+role, pola sama
// apps/sumber-air-baku). Tombolnya ditaruh di baris sendiri di atas blok
// Google Maps supaya lebar minimum popup tidak ikut melar.
function tombolKoreksiHtml(jenis, id) {
  if (!state.isAdmin) return '';
  return `<button type="button" class="gm-btn koreksi" data-koreksi-jenis="${jenis}" data-koreksi-id="${esc(id)}">${GM_EDIT_SVG} Koreksi titik</button>`;
}

// Penanda asal-usul titik, supaya kelihatan mana yang bukan dari lokasi.json
// -- penting waktu koordinat hasil koreksi berbeda jauh dari data lama.
function asalHtml(loc) {
  if (loc.baru) return '<div class="popup-asal baru">Titik baru — ditambahkan dari halaman ini</div>';
  if (loc.dikoreksi) return '<div class="popup-asal koreksi">Koordinat sudah dikoreksi admin</div>';
  return '';
}

function makeImgIcon(src, ringClass, extraClass, size) {
  const s = size || 36;
  return L.divIcon({
    className: '',
    html: `<div class="pin-img ${ringClass} ${extraClass || ''}"><img src="${src}" alt=""></div>`,
    iconSize: [s, s],
    iconAnchor: [s / 2, s - 2],
    popupAnchor: [0, -(s - 4)]
  });
}

async function loadJSON(url, fallback, opts) {
  try {
    const res = await fetch(url, opts);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } catch (err) {
    console.error('Gagal memuat ' + url, err);
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// Sesi & hak admin
// ---------------------------------------------------------------------------
function currentAccessToken() {
  return localStorage.getItem('token') || localStorage.getItem('vizAccessToken') || '';
}
function authHeaders(extra) {
  const t = currentAccessToken();
  return Object.assign({ 'Content-Type': 'application/json' }, t ? { 'Authorization': 'Bearer ' + t } : {}, extra || {});
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------
const state = {
  lokasi: { ipa: [], sumur: [], waduk: [] },  // hasil gabungan: bawaan + database
  latest: { ipa: {}, sumur: {}, waduk: {} },
  isAdmin: false,
  filter: 'all',
  map: null,
  layers: null,
  markersById: {},   // "jenis:id" -> marker Leaflet
  form: null,        // status panel tambah/edit yang sedang terbuka
  pickMarker: null   // marker sementara yang bisa digeser di panel tambah/edit
};

// Kunci marker/daftar pakai "jenis:id", BUKAN id saja: id "teritip" dipakai
// IPA Teritip DAN Waduk Teritip sekaligus, jadi dengan kunci id saja salah
// satunya menimpa yang lain (dropdown IPA Teritip jadi meloncat ke waduk).
function kunci(jenis, id) { return jenis + ':' + id; }

// ---------------------------------------------------------------------------
// Gabungkan lokasi.json (bawaan) dengan baris peta_lokasi (titik baru +
// koreksi koordinat). Aturannya cuma satu: baris dari database MENANG untuk
// (jenis, id) yang sama. Sisanya jadi titik baru.
// ---------------------------------------------------------------------------
function gabungLokasi(bawaan, rows) {
  const hasil = { ipa: [], sumur: [], waduk: [] };
  const posisi = {};   // "jenis:id" -> index di hasil[jenis]

  JENIS.forEach(j => {
    (bawaan[j] || []).forEach(loc => {
      posisi[kunci(j, loc.id)] = hasil[j].length;
      hasil[j].push(Object.assign({}, loc, { baru: false, dikoreksi: false }));
    });
  });

  (rows || []).forEach(r => {
    const j = r.jenis;
    if (!hasil[j]) return;   // jenis tak dikenal: lewati, jangan bikin layer baru
    const k = kunci(j, r.lokasi_id);
    const data = {
      id: r.lokasi_id,
      nama: r.nama,
      lat: Number(r.lat),
      lng: Number(r.lng),
      baru: posisi[k] === undefined,
      dikoreksi: posisi[k] !== undefined
    };
    // Cuma pasang kalau ada isinya -- kalau di-set undefined, Object.assign
    // di bawah justru menimpa nilai asli dari lokasi.json dengan undefined.
    if (r.installation) data.installation = r.installation;
    if (r.keterangan) data.keterangan = r.keterangan;

    if (posisi[k] === undefined) {
      posisi[k] = hasil[j].length;
      hasil[j].push(data);
    } else {
      hasil[j][posisi[k]] = Object.assign({}, hasil[j][posisi[k]], data);
    }
  });

  return hasil;
}

async function muatData() {
  const [bawaan, db, latest] = await Promise.all([
    loadJSON('data/lokasi.json', { ipa: [], sumur: [], waduk: [] }),
    loadJSON(MAP_LOKASI_URL, { rows: [] }),
    loadJSON(MAP_LATEST_URL, { ipa: {}, sumur: {}, waduk: {} })
  ]);
  state.lokasi = gabungLokasi(bawaan, db.rows);
  state.latest = latest;
}

// ---------------------------------------------------------------------------
// Gambar marker
// ---------------------------------------------------------------------------
function ikonJenis() {
  return {
    ipa: makeImgIcon('assets/icon-ipa.png', 'ring-ipa'),
    sumurAktif: makeImgIcon('assets/icon-sumur.png', 'ring-aktif pin-sumur', '', 42),
    sumurNonaktif: makeImgIcon('assets/icon-sumur.png', 'ring-nonaktif pin-sumur', 'nonaktif', 42),
    waduk: makeImgIcon('assets/icon-waduk.png', 'ring-waduk', '', 44)
  };
}

function popupIpa(loc) {
  const d = (state.latest.ipa && state.latest.ipa[loc.id]) || { ap: null, atd: null, apApplicable: true, atdApplicable: true, tanggal: null };
  return `
    ${popupHeader('a-ipa', 'assets/icon-ipa.png', loc.nama, fmtBulanTahun(d.tanggal))}
    ${asalHtml(loc)}
    <div class="stat-grid cols-2">
      ${statBox('AP', d.ap, 'm3', { applicable: d.apApplicable, formatter: fmtIDInt })}
      ${statBox('ATD', d.atd, 'm3', { applicable: d.atdApplicable, formatter: fmtIDInt })}
    </div>
    ${keteranganHtml(loc)}
    ${tombolKoreksiHtml('ipa', loc.id)}
    ${gmapsBlok(loc.lat, loc.lng)}
  `;
}

function popupSumur(loc) {
  const d = (state.latest.sumur && state.latest.sumur[loc.id]) || { statis: null, dinamis: null, debit: null, tanggal: null };
  const status = statusFromDebit(d.debit);
  const badgeClass = status === 'aktif' ? 'badge-aktif' : 'badge-nonaktif';
  return `
    ${popupHeader(status === 'aktif' ? 'a-sumur' : 'a-sumur-non', 'assets/icon-sumur.png', loc.nama, fmtBulanTahun(d.tanggal))}
    <span class="badge ${badgeClass}">${status === 'aktif' ? 'Aktif' : 'Non-aktif'}</span>
    ${asalHtml(loc)}
    <div class="stat-grid cols-3">
      ${statBox('Statis', d.statis, 'm')}
      ${statBox('Dinamis', d.dinamis, 'm')}
      ${statBox('Debit', d.debit, 'm3/jam')}
    </div>
    ${keteranganHtml(loc)}
    ${tombolKoreksiHtml('sumur', loc.id)}
    ${gmapsBlok(loc.lat, loc.lng)}
  `;
}

function popupWaduk(loc) {
  const d = (state.latest.waduk && state.latest.waduk[loc.id]) || { level: null, curahHujan: null, ntu: null, ph: null, tanggal: null };
  const levelDisplay = (d.level === null || d.level === undefined) ? 'Belum ada' : fmtID(d.level) + ' m';
  return `
    ${popupHeader('a-waduk', 'assets/icon-waduk.png', loc.nama, fmtTanggalLengkap(d.tanggal))}
    ${asalHtml(loc)}
    <div class="hero-box"><span class="hero-label">Level waduk</span><span class="hero-value">${levelDisplay}</span></div>
    <div class="stat-grid cols-3">
      ${statBox('Hujan', d.curahHujan, 'mm')}
      ${statBox('NTU', d.ntu, '')}
      ${statBox('pH', d.ph, '')}
    </div>
    ${keteranganHtml(loc)}
    ${tombolKoreksiHtml('waduk', loc.id)}
    ${gmapsBlok(loc.lat, loc.lng)}
  `;
}

function keteranganHtml(loc) {
  return loc.keterangan ? `<div class="popup-ket">${esc(loc.keterangan)}</div>` : '';
}

function gambarMarker() {
  const ic = ikonJenis();
  state.markersById = {};
  JENIS.forEach(j => state.layers[j].clearLayers());

  (state.lokasi.ipa || []).forEach(loc => {
    state.markersById[kunci('ipa', loc.id)] = L.marker([loc.lat, loc.lng], { icon: ic.ipa })
      .bindPopup(popupIpa(loc))
      .bindTooltip(esc(loc.nama), { permanent: true, direction: 'right', offset: [8, -8], className: 'marker-label' })
      .addTo(state.layers.ipa);
  });

  (state.lokasi.sumur || []).forEach(loc => {
    const d = (state.latest.sumur && state.latest.sumur[loc.id]) || { debit: null };
    const icon = statusFromDebit(d.debit) === 'aktif' ? ic.sumurAktif : ic.sumurNonaktif;
    state.markersById[kunci('sumur', loc.id)] = L.marker([loc.lat, loc.lng], { icon })
      .bindPopup(popupSumur(loc))
      .bindTooltip(esc(loc.nama), { direction: 'right', offset: [8, -8], className: 'marker-label' })
      .addTo(state.layers.sumur);
  });

  (state.lokasi.waduk || []).forEach(loc => {
    state.markersById[kunci('waduk', loc.id)] = L.marker([loc.lat, loc.lng], { icon: ic.waduk })
      .bindPopup(popupWaduk(loc))
      .bindTooltip(esc(loc.nama), { permanent: true, direction: 'right', offset: [8, -8], className: 'marker-label' })
      .addTo(state.layers.waduk);
  });

  terapkanFilter();
}

// Filter grid: layer yang tampil harus tetap sama setelah marker digambar
// ulang (mis. sehabis simpan koreksi), makanya statusnya disimpan di state.
function terapkanFilter() {
  const map = state.map;
  JENIS.forEach(j => map.removeLayer(state.layers[j]));
  if (state.filter === 'all') JENIS.forEach(j => state.layers[j].addTo(map));
  else if (state.layers[state.filter]) state.layers[state.filter].addTo(map);
}

// ---------------------------------------------------------------------------
// Panel tambah / koreksi titik
// ---------------------------------------------------------------------------
const $ = id => document.getElementById(id);

function normalId(s) {
  return String(s || '').trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
}

// Saran id sumur: nomor TERKECIL yang belum terpakai di instalasi itu, 2 digit.
// Formatnya WAJIB sama dengan wellIdFromName di api/visualization/
// admin-library.js ({installation}_{NN}) -- kalau beda, sumur barunya tidak
// akan pernah dapat data debit/statis/dinamis walau datanya sudah diinput,
// karena penggabungan di sana memakai id.
//
// Dulu sarannya "nomor terakhir + 1", dan itu yang bikin masalah 2026-10-07:
// Teritip sudah punya nomor sampai 18, jadi sarannya teritip_19 -- padahal
// yang ditambahkan justru sumur nomor 1, 2, 3. Terpaksa ketik manual, dan di
// situ format 2 digitnya lepas. Nomor terkecil mengisi lubang lebih dulu, jadi
// sarannya selalu masuk akal. Untuk instalasi yang nomornya sudah rapat (5 IPA
// di KPI 18.2), hasilnya tetap nomor terakhir + 1 -- jadi urutan kolom 18.2
// tidak ikut bergeser.
//
// Pencocokan lewat PREFIX ID, bukan field installation: titik lama bisa saja
// belum punya field itu, sedangkan id selalu ada dan itulah yang mengikat.
function saranIdSumur(installation) {
  const dipakai = new Set();
  (state.lokasi.sumur || []).forEach(s => {
    const id = String(s.id || '');
    if (id.replace(/_\d+$/, '') !== installation) return;
    const m = id.match(/_(\d+)$/);
    if (m) dipakai.add(Number(m[1]));
  });

  let nomor = 1;
  while (dipakai.has(nomor)) nomor++;
  return installation + '_' + String(nomor).padStart(2, '0');
}

function isiPilihanInstallation() {
  const sel = $('fInstallation');
  const daftar = (state.lokasi.ipa || []).slice()
    .sort((a, b) => a.nama.localeCompare(b.nama, 'id'));
  sel.innerHTML = daftar.map(ipa =>
    `<option value="${esc(ipa.id)}">${esc(ipa.nama.replace(/^IPA\s+/i, ''))}</option>`
  ).join('');
}

// Marker sementara di panel: bisa digeser, dan ketukan di peta juga
// memindahkannya. Di HP mengetuk peta jauh lebih gampang daripada menarik
// pin kecil, jadi dua-duanya disediakan.
const PICK_ICON_SVG = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/><circle cx="12" cy="12" r="4"/></svg>';

function pickIcon() {
  return L.divIcon({
    className: '',
    html: `<div class="pin-pick">${PICK_ICON_SVG}</div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17]
  });
}

function pindahPickMarker(lat, lng) {
  $('fLat').value = Number(lat).toFixed(6);
  $('fLng').value = Number(lng).toFixed(6);
  if (!state.pickMarker) {
    state.pickMarker = L.marker([lat, lng], { icon: pickIcon(), draggable: true, zIndexOffset: 1000 }).addTo(state.map);
    state.pickMarker.on('dragend', () => {
      const p = state.pickMarker.getLatLng();
      $('fLat').value = p.lat.toFixed(6);
      $('fLng').value = p.lng.toFixed(6);
      // Tanpa digeser: titiknya sudah kelihatan, dia baru saja menggesernya.
      perbaruiFasePanel();
    });
  } else {
    state.pickMarker.setLatLng([lat, lng]);
  }
}

// Panel menutupi bagian bawah peta. Tanpa digeser, titik yang baru ditaruh
// (atau yang sedang dikoreksi) jatuh persis di balik panel dan tidak
// kelihatan -- padahal itu justru yang perlu diperiksa.
function pusatkanDiAreaTerlihat(latlng) {
  const map = state.map;
  const panel = $('petaPanel');
  const tinggiPanel = panel ? panel.getBoundingClientRect().height : 0;
  const z = Math.max(map.getZoom(), 15);

  map.setView(latlng, z, { animate: false });

  // Sisa ruang peta yang tidak tertutup panel itulah tempat titiknya harus
  // berada, jadi pandangan digeser dari tengah sejauh setengah tinggi panel.
  // Dipakai latLngToContainerPoint + containerPointToLatLng (bukan panBy)
  // supaya arah geserannya tidak bergantung pada tafsir tanda offset.
  const geser = Math.min(tinggiPanel, map.getSize().y * 0.7) / 2;
  if (geser <= 0) return;
  const titikLayar = map.latLngToContainerPoint(latlng);
  map.setView(map.containerPointToLatLng(titikLayar.add([0, geser])), z, { animate: false });
}

// Dua fase panel (lihat aturan [data-fase] di index.html): selama koordinat
// belum ada, field identitas disembunyikan supaya panel pendek dan peta di
// belakangnya masih bisa diketuk untuk menaruh titik.
function perbaruiFasePanel(lihatLatLng) {
  if (!state.form) return;
  const adaKoordinat = $('fLat').value.trim() !== '' && $('fLng').value.trim() !== '';
  $('petaPanel').dataset.fase = adaKoordinat ? 'isi' : 'pilih';
  if (adaKoordinat && lihatLatLng) pusatkanDiAreaTerlihat(lihatLatLng);
}

function hapusPickMarker() {
  if (state.pickMarker) { state.map.removeLayer(state.pickMarker); state.pickMarker = null; }
}

function bukaPanel(mode, jenis, id) {
  const loc = mode === 'koreksi'
    ? (state.lokasi[jenis] || []).find(l => l.id === id) || null
    : null;

  state.form = { mode: mode, jenis: jenis, id: id || null, asal: loc };
  hapusPickMarker();

  $('panelTitle').textContent = mode === 'koreksi' ? 'Koreksi titik' : 'Tambah titik baru';
  $('panelHint').innerHTML = 'Ketuk peta untuk menaruh titik, geser tanda <b>+</b>, atau pakai tombol lokasi saya.';

  // Form selalu mulai dari kosong; kalau tidak, id sumur dari panel
  // sebelumnya ikut terbawa (jenisnya sama-sama "sumur", jadi setJenis tidak
  // menganggapnya berubah dan tidak membersihkan apa pun).
  $('fId').value = '';
  $('fId').dataset.auto = '1';
  $('fNamaKolom').value = '';

  // Instalasi induk HARUS diisi ulang dari titik yang dibuka. Dulu tidak, dan
  // akibatnya dropdown masih memegang nilai terakhir -- pada halaman yang baru
  // dibuka itu "IPA Batu Ampar" (opsi pertama, hasil urut nama). Kalau admin
  // tidak sadar menggantinya, `installation` titik itu tertulis batu_ampar dan
  // titiknya pindah grup. Server sekarang juga menurunkan instalasi dari prefix
  // id, jadi dua-duanya menutup celah yang sama.
  if (loc) {
    $('fInstallation').value = loc.installation || String(loc.id).replace(/_\d+$/, '');
  }

  setJenis(jenis);

  // Jenis tidak boleh diubah saat mengoreksi: id titik terikat ke jenisnya
  // (kunci barisnya (jenis, id)), jadi memindahkannya ke jenis lain sama
  // dengan membuat titik baru sekaligus meninggalkan baris lama menggantung.
  // Instalasi induk alasannya sama: id sumur berprefix instalasinya
  // ({installation}_{NN}), jadi mengganti instalasi berarti mengganti id.
  document.querySelectorAll('#jenisSeg .seg-btn').forEach(b => { b.disabled = mode === 'koreksi'; });
  $('fInstallation').disabled = mode === 'koreksi';

  $('fNama').value = loc ? loc.nama : '';
  $('fKet').value = loc ? (loc.keterangan || '') : '';
  $('fLat').value = loc ? Number(loc.lat).toFixed(6) : '';
  $('fLng').value = loc ? Number(loc.lng).toFixed(6) : '';
  if (loc) { $('fId').value = loc.id; $('fId').dataset.auto = '0'; }

  // Tombol hapus cuma muncul untuk yang sudah ada. Untuk titik bawaan
  // tombolnya "Kembalikan", bukan "Hapus" -- yang terjadi memang cuma
  // melepas koreksi, titiknya tetap ada di lokasi.json.
  $('btnHapus').style.display = mode === 'koreksi' ? '' : 'none';
  $('btnHapus').textContent = (mode === 'koreksi' && loc && !loc.baru) ? 'Kembalikan ke koordinat asli' : 'Hapus titik';

  if (loc) pindahPickMarker(Number(loc.lat), Number(loc.lng));

  $('panelBackdrop').classList.add('open');
  $('petaPanel').classList.add('open');
  // Baru setelah panelnya benar-benar terbuka, tinggi panel bisa diukur untuk
  // menggeser pandangan -- kalau diukur sebelum ini, fase/tingginya belum
  // mencerminkan isi yang tampil.
  perbaruiFasePanel(loc ? [Number(loc.lat), Number(loc.lng)] : null);
}

function tutupPanel() {
  state.form = null;
  hapusPickMarker();
  $('panelBackdrop').classList.remove('open');
  $('petaPanel').classList.remove('open');
}

// Jenis mengubah isi form: instalasi & pola id cuma relevan untuk sumur.
function setJenis(jenis) {
  if (!state.form) return;
  const berubah = state.form.jenis !== jenis;
  state.form.jenis = jenis;

  document.querySelectorAll('#jenisSeg .seg-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.jenis === jenis));
  $('fieldInstallation').style.display = jenis === 'sumur' ? '' : 'none';

  if (berubah) { $('fId').value = ''; $('fId').dataset.auto = '1'; }

  perbaruiSaranId();
  perbaruiFieldNamaKolom();
}

function perbaruiSaranId() {
  if (!state.form) return;
  const f = state.form;
  const idEl = $('fId');
  const note = $('idNote');

  // Koreksi titik: id tidak boleh berubah -- id itu kunci baris yang
  // dikoreksi, dan nilainya sudah dipegang state.form.id.
  if (f.mode === 'koreksi') {
    $('fieldId').style.display = 'none';
    return;
  }
  $('fieldId').style.display = '';

  // Nilai yang diisi otomatis ditandai dataset.auto; begitu admin mengetik
  // sendiri, tandanya dilepas dan saran tidak menimpanya lagi.
  if (!idEl.value || idEl.dataset.auto === '1') {
    idEl.value = f.jenis === 'sumur'
      ? ($('fInstallation').value ? saranIdSumur($('fInstallation').value) : '')
      : normalId($('fNama').value);
    idEl.dataset.auto = '1';
  }
  note.textContent = f.jenis === 'sumur'
    ? 'Dipakai mencocokkan data debit/statis/dinamis. Format {instalasi}_{NN} — biarkan seperti saran kecuali memang perlu diubah.'
    : 'ID ini jadi rujukan data. Untuk IPA, data AP/ATD hanya muncul kalau ID-nya cocok dengan yang dipakai input bulanan.';
}

// Nama instalasi untuk contoh nama kolom: "kampung_baru_ulu" -> "Kampung_Baru_Ulu".
// Sama persis dengan labelInstalasi() di lib/visualization/sumur-well.js --
// yang di sini cuma untuk contoh di catatan bantuan, bukan penentu data.
function labelInstalasi(installation) {
  return String(installation || '').split('_').filter(Boolean)
    .map(k => k.charAt(0).toUpperCase() + k.slice(1)).join('_');
}

// Field "Nama kolom data" cuma bermakna untuk sumur yang BARU: menyimpan titik
// sumur sekalian mendaftarkannya sebagai sumur yang bisa diisi data, dan kolom
// itu butuh nama. Saat mengoreksi titik, sumurnya sudah terdaftar -- dan
// mengganti nama kolomnya bukan urusan panel ini, karena data yang sudah
// tersimpan terikat ke nama lama. Server juga mengabaikannya di kasus itu.
function perbaruiFieldNamaKolom() {
  if (!state.form) return;
  const tampil = state.form.jenis === 'sumur' && state.form.mode !== 'koreksi';
  $('fieldNamaKolom').style.display = tampil ? '' : 'none';
  if (!tampil) return;

  // Contohnya mengikuti nomor yang sedang disarankan supaya admin yang tidak
  // tahu harus menulis apa cukup melihat catatannya.
  const instalasi = $('fInstallation').value;
  const nomor = $('fId').value.match(/_(\d+)$/);
  const contoh = (instalasi && nomor)
    ? 'Sumur_' + nomor[1].padStart(2, '0') + '_' + labelInstalasi(instalasi)
    : '';

  $('namaKolomNote').textContent =
    (contoh ? 'Dikosongkan → dipakai ' + contoh + '. ' : '')
    + 'Harus diawali "Sumur_" plus nomor sumurnya — kalau tidak, datanya tidak akan menempel ke titik ini.';
}

function pesanPanel(teks, jenis) {
  const el = $('panelPesan');
  el.textContent = teks || '';
  el.className = 'panel-pesan' + (jenis ? ' ' + jenis : '');
  el.style.display = teks ? '' : 'none';
}

async function simpanPanel() {
  if (!state.form) return;
  const f = state.form;
  const nama = $('fNama').value.trim();
  const id = f.mode === 'koreksi' ? f.id : normalId($('fId').value);
  const lat = Number($('fLat').value);
  const lng = Number($('fLng').value);
  const installation = f.jenis === 'sumur' ? ($('fInstallation').value || '') : '';

  if (!nama) return pesanPanel('Nama titik wajib diisi.', 'error');
  if (!id) return pesanPanel('ID titik wajib diisi.', 'error');
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || $('fLat').value === '' || $('fLng').value === '') {
    return pesanPanel('Koordinat belum ada. Ketuk peta atau pakai lokasi saya.', 'error');
  }
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return pesanPanel('Koordinat di luar rentang yang wajar. Periksa lagi — lat dan lng sering tertukar.', 'error');
  }
  if (f.jenis === 'sumur' && !installation) return pesanPanel('Instalasi induk wajib dipilih.', 'error');

  const btn = $('btnSimpan');
  btn.disabled = true;
  const teksAsli = btn.textContent;
  btn.textContent = 'Menyimpan…';
  pesanPanel('');

  try {
    const res = await fetch(PETA_URL, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        jenis: f.jenis, lokasi_id: id, nama: nama,
        installation: installation,
        lat: lat, lng: lng,
        keterangan: $('fKet').value.trim(),
        // Cuma dikirim untuk sumur baru -- server mengabaikannya kalau sumurnya
        // sudah terdaftar (lihat perbaruiFieldNamaKolom).
        namaKolom: (f.jenis === 'sumur' && f.mode !== 'koreksi') ? $('fNamaKolom').value.trim() : ''
      })
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || ('HTTP ' + res.status));

    // Id yang tersimpan bisa BEDA dari yang diketik: server merapikan nomor
    // jadi 2 digit ('teritip_1' -> 'teritip_01'), dan penggabungan data di
    // server memakai id yang sudah rapi itu. Jadi penanda marker & peta harus
    // memakai id dari balasan, bukan id kiriman.
    const idFinal = d.lokasi_id || id;

    // Kalau id-nya dirapikan, beri tahu -- kalau tidak, admin akan mencari
    // 'teritip_1' di daftar dan mengira titiknya tidak tersimpan. Panelnya
    // ditutup di bawah, jadi pesannya sempat dibaca dulu.
    if (idFinal !== id) {
      pesanPanel(`Tersimpan sebagai ${idFinal} — nomor sumur dirapikan jadi 2 digit.`, 'ok');
      await new Promise(r => setTimeout(r, 1400));
    }

    tutupPanel();
    await muatData();
    gambarMarker();
    // Titik yang baru disimpan langsung dibuka supaya admin bisa memastikan
    // hasilnya, tanpa mencari sendiri di peta.
    const marker = state.markersById[kunci(f.jenis, idFinal)];
    if (marker) { state.map.flyTo(marker.getLatLng(), 16); marker.openPopup(); }
  } catch (err) {
    pesanPanel('Gagal menyimpan: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = teksAsli;
  }
}

async function hapusPanel() {
  if (!state.form) return;
  const f = state.form;
  const asal = f.asal;
  const bawaan = asal && !asal.baru;

  const pesan = bawaan
    ? `Kembalikan "${asal.nama}" ke koordinat asli dari data bawaan?`
    : `Hapus titik "${asal ? asal.nama : f.id}" dari peta?`;
  if (!confirm(pesan)) return;

  const btn = $('btnHapus');
  btn.disabled = true;
  try {
    const res = await fetch(PETA_URL + '?jenis=' + encodeURIComponent(f.jenis) + '&id=' + encodeURIComponent(f.id), {
      method: 'DELETE',
      headers: authHeaders()
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || ('HTTP ' + res.status));

    tutupPanel();

    // Titiknya hilang dari peta, tapi sumurnya sengaja DIPERTAHANKAN server
    // karena sudah punya data debit. Kalau tidak diberitahukan, admin akan
    // mengira datanya ikut terhapus.
    if (d.sumurDipertahankan) {
      alert('Titiknya sudah dilepas dari peta, tapi sumurnya TETAP ada di daftar '
        + 'input data karena sudah punya data debit. Data yang sudah diisi tidak ikut hilang.');
    }

    await muatData();
    gambarMarker();
  } catch (err) {
    pesanPanel('Gagal menghapus: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

function pakaiLokasiSaya() {
  if (!navigator.geolocation) return pesanPanel('HP/browser ini tidak menyediakan lokasi.', 'error');
  pesanPanel('Mencari lokasi…');
  navigator.geolocation.getCurrentPosition(
    pos => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      pindahPickMarker(lat, lng);
      perbaruiFasePanel([lat, lng]);
      pesanPanel('Koordinat diisi dari lokasi kamu. Ketuk "Simpan" kalau sudah pas.', 'ok');
    },
    err => pesanPanel('Gagal ambil lokasi: ' + err.message + '. Isi manual atau ketuk peta.', 'error'),
    { enableHighAccuracy: true, timeout: 15000 }
  );
}

// ---------------------------------------------------------------------------
// Dropdown navigasi cepat
// ---------------------------------------------------------------------------
const CHEVRON_RIGHT_SVG = '<svg class="dd-row-chevron" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" width="14" height="14"><path d="M7.5 5l5 5-5 5"/></svg>';
const CHEVRON_LEFT_SVG = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" width="15" height="15"><path d="M12.5 5l-5 5 5 5"/></svg>';

function ddRow({ avatarClass, iconSrc, label, meta, chevron, statusHtml, dataAttrs }) {
  const avatar = iconSrc ? `<span class="dd-row-avatar ${avatarClass}"><img src="${iconSrc}" alt=""></span>` : '';
  const metaHtml = meta ? `<span class="dd-row-meta">${meta}</span>` : '';
  return `<div class="dd-row" ${dataAttrs}>${avatar}<span class="dd-row-label">${esc(label)}</span>${metaHtml}${statusHtml || ''}${chevron ? CHEVRON_RIGHT_SVG : ''}</div>`;
}

// Sumur: pilih instalasi dulu, baru muncul daftar sumur di instalasi itu
// (2 langkah) -- state-nya direset tiap dropdown Sumur dibuka ulang.
let sumurView = 'installations';
let sumurCurrentInstallation = null;

function ipaLabelMap() {
  const map = {};
  (state.lokasi.ipa || []).forEach(ipa => { map[ipa.id] = ipa.nama.replace(/^IPA\s+/i, ''); });
  return map;
}

function sumurPerInstalasi() {
  const grup = {};
  (state.lokasi.sumur || []).forEach(s => {
    if (!grup[s.installation]) grup[s.installation] = [];
    grup[s.installation].push(s);
  });
  return grup;
}

function renderSumurInstallationList() {
  const label = ipaLabelMap();
  const grup = sumurPerInstalasi();
  return Object.keys(grup).map(installation => ddRow({
    avatarClass: 'a-sumur', iconSrc: 'assets/icon-sumur.png',
    label: label[installation] || installation,
    meta: `${grup[installation].length} titik`, chevron: true,
    dataAttrs: `data-action="drill" data-installation="${esc(installation)}"`
  })).join('');
}

function renderSumurWellList(installation) {
  const label = ipaLabelMap();
  const wells = (sumurPerInstalasi()[installation] || []);
  const header = `
    <div class="dd-panel-header">
      <button type="button" class="dd-back" data-action="back">${CHEVRON_LEFT_SVG}</button>
      <span class="dd-panel-title">Sumur — ${esc(label[installation] || installation)}</span>
    </div>
  `;
  const rows = wells.map(s => {
    const debit = (state.latest.sumur && state.latest.sumur[s.id]) ? state.latest.sumur[s.id].debit : null;
    const status = statusFromDebit(debit);
    const statusHtml = `<span class="dd-status-dot ${status}"></span><span class="dd-status-text ${status}">${status === 'aktif' ? 'Aktif' : 'Non-aktif'}</span>`;
    return ddRow({
      label: s.nama.split('—')[0].trim(), statusHtml,
      dataAttrs: `data-action="select" data-jenis="sumur" data-id="${esc(s.id)}"`
    });
  }).join('');
  return header + rows;
}

function renderDropdownContent(category) {
  if (category === 'ipa') {
    return (state.lokasi.ipa || []).map(loc => ddRow({
      avatarClass: 'a-ipa', iconSrc: 'assets/icon-ipa.png', label: loc.nama.replace(/^IPA\s+/i, ''),
      dataAttrs: `data-action="select" data-jenis="ipa" data-id="${esc(loc.id)}"`
    })).join('');
  }
  if (category === 'waduk') {
    return (state.lokasi.waduk || []).map(loc => ddRow({
      avatarClass: 'a-waduk', iconSrc: 'assets/icon-waduk.png', label: loc.nama,
      dataAttrs: `data-action="select" data-jenis="waduk" data-id="${esc(loc.id)}"`
    })).join('');
  }
  if (category === 'sumur') {
    return (sumurView === 'wells' && sumurCurrentInstallation)
      ? renderSumurWellList(sumurCurrentInstallation)
      : renderSumurInstallationList();
  }
  return '';
}

// ---------------------------------------------------------------------------
// Inisialisasi
// ---------------------------------------------------------------------------
async function init() {
  state.isAdmin = !!(localStorage.getItem('token') && localStorage.getItem('role') === 'admin');
  await muatData();

  const map = L.map('map', { scrollWheelZoom: true }).setView([-1.205, 116.91], 11);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 19
  }).addTo(map);
  state.map = map;
  state.layers = { ipa: L.layerGroup(), sumur: L.layerGroup(), waduk: L.layerGroup() };

  gambarMarker();

  // Tombol "+ Tambah titik" cuma untuk admin.
  if (state.isAdmin) $('btnTambahTitik').style.display = '';

  // Ketuk peta saat panel terbuka = pindahkan titik. Saat panel tertutup,
  // ketukan dibiarkan seperti biasa (menutup popup).
  map.on('click', e => {
    if (!state.form) return;
    pindahPickMarker(e.latlng.lat, e.latlng.lng);
    // Ketukan di peta bikin panel bertambah tinggi (fase "isi"), jadi
    // pandangannya ikut digeser supaya titiknya tidak tertutup panel.
    perbaruiFasePanel([e.latlng.lat, e.latlng.lng]);
  });

  // Tombol "Koreksi titik" di dalam popup. Dipasang tiap popup dibuka, tapi
  // pakai onclick (penugasan), BUKAN addEventListener: elemen tombol dipakai
  // ulang tiap popup marker yang sama dibuka, jadi addEventListener akan
  // menumpuk listener (buka-tutup 3x -> bukaPanel jalan 3x). Penugasan
  // otomatis menggantikan handler sebelumnya.
  //
  // Sengaja tidak mengandalkan klik yang membubbling ke container peta:
  // popup Leaflet diberi disableClickPropagation, dan perilaku itu beda-beda
  // antar versi Leaflet.
  map.on('popupopen', e => {
    const btn = e.popup.getElement().querySelector('[data-koreksi-jenis]');
    if (!btn) return;
    btn.onclick = () => bukaPanel('koreksi', btn.dataset.koreksiJenis, btn.dataset.koreksiId);
  });

  const dropdownEl = $('categoryDropdown');
  const dropdownListEl = $('dropdownList');
  let openCategory = null;

  function closeDropdown() {
    openCategory = null;
    dropdownEl.classList.remove('open');
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('dropdown-open'));
  }

  function selectLocation(jenis, id) {
    const marker = state.markersById[kunci(jenis, id)];
    if (!marker) return;
    map.flyTo(marker.getLatLng(), 16);
    marker.openPopup();
    closeDropdown();
  }

  function openDropdownFor(category, btn) {
    openCategory = category;
    if (category === 'sumur') { sumurView = 'installations'; sumurCurrentInstallation = null; }
    dropdownListEl.innerHTML = renderDropdownContent(category);
    dropdownEl.classList.add('open');
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('dropdown-open'));
    btn.classList.add('dropdown-open');
  }

  dropdownListEl.addEventListener('click', e => {
    const row = e.target.closest('.dd-row, .dd-back');
    if (!row) return;
    const action = row.dataset.action;
    if (action === 'select') selectLocation(row.dataset.jenis, row.dataset.id);
    else if (action === 'drill') {
      sumurView = 'wells';
      sumurCurrentInstallation = row.dataset.installation;
      dropdownListEl.innerHTML = renderDropdownContent('sumur');
    } else if (action === 'back') {
      sumurView = 'installations';
      sumurCurrentInstallation = null;
      dropdownListEl.innerHTML = renderDropdownContent('sumur');
    }
  });

  // Capture phase (bukan bubble) -- klik "drill"/"select" di dalam dropdown
  // mengganti innerHTML-nya di tengah event yang sama, yang bikin elemen
  // e.target jadi terlepas dari DOM sebelum event ini sempat bubble ke sini.
  // Kalau dicek pas bubble, dropdownEl.contains(e.target) jadi salah (false)
  // walau kliknya memang di dalam dropdown -- jadi dropdown ketutup sendiri.
  // Dicek di capture phase supaya DOM masih utuh saat pengecekan ini jalan.
  document.addEventListener('click', e => {
    if (!dropdownEl.contains(e.target) && !e.target.closest('.filter-btn')) closeDropdown();
  }, true);

  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const f = btn.dataset.filter;
      state.filter = f;
      terapkanFilter();

      if (f === 'all') { closeDropdown(); }
      else if (openCategory === f) { closeDropdown(); }
      else { openDropdownFor(f, btn); }
    });
  });

  // ---- Panel tambah/koreksi (admin) -------------------------------------
  $('btnTambahTitik').addEventListener('click', () => bukaPanel('baru', 'sumur', null));
  $('panelClose').addEventListener('click', tutupPanel);
  $('panelBackdrop').addEventListener('click', tutupPanel);
  $('btnSimpan').addEventListener('click', simpanPanel);
  $('btnHapus').addEventListener('click', hapusPanel);
  $('btnGps').addEventListener('click', pakaiLokasiSaya);

  document.querySelectorAll('#jenisSeg .seg-btn').forEach(b =>
    b.addEventListener('click', () => setJenis(b.dataset.jenis)));

  $('fInstallation').addEventListener('change', () => {
    // Instalasi ganti = id sumur ikut menyesuaikan, kecuali admin sudah
    // mengetik id sendiri (dataset.auto dilepas di bawah).
    $('fId').dataset.auto = '1';
    perbaruiSaranId();
    perbaruiFieldNamaKolom();
  });
  $('fNama').addEventListener('input', () => {
    if (state.form && state.form.jenis !== 'sumur') perbaruiSaranId();
  });
  $('fId').addEventListener('input', () => {
    $('fId').dataset.auto = '0';
    perbaruiFieldNamaKolom();
  });

  // Koordinat yang diketik manual juga membuka fase "isi". Sengaja TIDAK
  // ikut menggeser pandangan: titiknya belum tentu ada, dan menggeser peta
  // tiap ketikan akan bikin layar melompat-lompat.
  ['fLat', 'fLng'].forEach(id => $(id).addEventListener('input', () => perbaruiFasePanel()));

  isiPilihanInstallation();
}

init();
