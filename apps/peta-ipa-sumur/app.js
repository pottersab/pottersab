/* ==========================================================================
   Peta Interaktif — IPA, Sumur & Waduk (Sub Divisi Sumber Air Baku)
   --------------------------------------------------------------------------
   data/lokasi.json  -> nama + koordinat per titik, statis (jarang berubah).
   ?action=map-latest -> angka terbaru (AP/ATD/debit/statis/dinamis/level/dll)
   + tanggal data terbaru, dari Postgres yang sama dipakai grafik existing
   (api/visualization/admin-library.js). Digabung di sini berdasarkan `id`
   yang sama di kedua sumber.
   ========================================================================== */

const MAP_LATEST_URL = '/api/visualization/admin-library?action=map-latest';

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

// Status TIDAK PERNAH diisi manual -- selalu dihitung dari ADA/TIDAKNYA data
// debit (null = belum pernah dilaporkan = non-aktif), bukan dari nilainya --
// sama seperti logika hitung "Sumur Aktif" di beranda (api/home-summary.js),
// yang menghitung sumur ber-debit IS NOT NULL tanpa peduli nilainya 0 atau bukan.
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
        <div class="popup-title">${nama}</div>
        ${dataPerHtml(tanggalLabel)}
      </div>
    </div>
  `;
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

async function loadJSON(url, fallback) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } catch (err) {
    console.error('Gagal memuat ' + url, err);
    return fallback;
  }
}

async function init() {
  const [lokasi, latest] = await Promise.all([
    loadJSON('data/lokasi.json', { ipa: [], sumur: [], waduk: [] }),
    loadJSON(MAP_LATEST_URL, { ipa: {}, sumur: {}, waduk: {} })
  ]);

  const map = L.map('map', { scrollWheelZoom: true }).setView([-1.205, 116.91], 11);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 19
  }).addTo(map);

  const ipaIcon = makeImgIcon('assets/icon-ipa.png', 'ring-ipa');
  const sumurAktifIcon = makeImgIcon('assets/icon-sumur.png', 'ring-aktif pin-sumur', '', 42);
  const sumurNonaktifIcon = makeImgIcon('assets/icon-sumur.png', 'ring-nonaktif pin-sumur', 'nonaktif', 42);
  const wadukIcon = makeImgIcon('assets/icon-waduk.png', 'ring-waduk', '', 44);

  const ipaLayer = L.layerGroup();
  const sumurLayer = L.layerGroup();
  const wadukLayer = L.layerGroup();

  // id -> marker Leaflet, dipakai dropdown navigasi cepat (klik nama lokasi
  // -> peta loncat + buka popup titik itu).
  const markersById = {};

  (lokasi.ipa || []).forEach(loc => {
    const d = (latest.ipa && latest.ipa[loc.id]) || { ap: null, atd: null, apApplicable: true, atdApplicable: true, tanggal: null };
    const html = `
      ${popupHeader('a-ipa', 'assets/icon-ipa.png', loc.nama, fmtBulanTahun(d.tanggal))}
      <div class="stat-grid cols-2">
        ${statBox('AP', d.ap, 'm3', { applicable: d.apApplicable, formatter: fmtIDInt })}
        ${statBox('ATD', d.atd, 'm3', { applicable: d.atdApplicable, formatter: fmtIDInt })}
      </div>
    `;
    markersById[loc.id] = L.marker([loc.lat, loc.lng], { icon: ipaIcon })
      .bindPopup(html)
      .bindTooltip(loc.nama, { permanent: true, direction: 'right', offset: [8, -8], className: 'marker-label' })
      .addTo(ipaLayer);
  });

  (lokasi.sumur || []).forEach(loc => {
    const d = (latest.sumur && latest.sumur[loc.id]) || { statis: null, dinamis: null, debit: null, tanggal: null };
    const status = statusFromDebit(d.debit);
    const icon = status === 'aktif' ? sumurAktifIcon : sumurNonaktifIcon;
    const badgeClass = status === 'aktif' ? 'badge-aktif' : 'badge-nonaktif';
    const html = `
      ${popupHeader(status === 'aktif' ? 'a-sumur' : 'a-sumur-non', 'assets/icon-sumur.png', loc.nama, fmtBulanTahun(d.tanggal))}
      <span class="badge ${badgeClass}">${status === 'aktif' ? 'Aktif' : 'Non-aktif'}</span>
      <div class="stat-grid cols-3">
        ${statBox('Statis', d.statis, 'm')}
        ${statBox('Dinamis', d.dinamis, 'm')}
        ${statBox('Debit', d.debit, 'm3/jam')}
      </div>
    `;
    markersById[loc.id] = L.marker([loc.lat, loc.lng], { icon })
      .bindPopup(html)
      .bindTooltip(loc.nama, { direction: 'right', offset: [8, -8], className: 'marker-label' })
      .addTo(sumurLayer);
  });

  (lokasi.waduk || []).forEach(loc => {
    const d = (latest.waduk && latest.waduk[loc.id]) || { level: null, curahHujan: null, ntu: null, ph: null, tanggal: null };
    const levelDisplay = (d.level === null || d.level === undefined) ? 'Belum ada' : fmtID(d.level) + ' m';
    const html = `
      ${popupHeader('a-waduk', 'assets/icon-waduk.png', loc.nama, fmtTanggalLengkap(d.tanggal))}
      <div class="hero-box"><span class="hero-label">Level waduk</span><span class="hero-value">${levelDisplay}</span></div>
      <div class="stat-grid cols-3">
        ${statBox('Hujan', d.curahHujan, 'mm')}
        ${statBox('NTU', d.ntu, '')}
        ${statBox('pH', d.ph, '')}
      </div>
    `;
    markersById[loc.id] = L.marker([loc.lat, loc.lng], { icon: wadukIcon })
      .bindPopup(html)
      .bindTooltip(loc.nama, { permanent: true, direction: 'right', offset: [8, -8], className: 'marker-label' })
      .addTo(wadukLayer);
  });

  ipaLayer.addTo(map);
  sumurLayer.addTo(map);
  wadukLayer.addTo(map);

  // ---- Dropdown navigasi cepat (klik nama lokasi -> peta loncat + buka
  // popup titik itu). Sumur dikelompokkan per instalasi IPA. --------------
  const ipaLabelByInstallation = {};
  (lokasi.ipa || []).forEach(ipa => { ipaLabelByInstallation[ipa.id] = ipa.nama.replace(/^IPA\s+/i, ''); });

  const sumurByInstallation = {};
  (lokasi.sumur || []).forEach(s => {
    if (!sumurByInstallation[s.installation]) sumurByInstallation[s.installation] = [];
    sumurByInstallation[s.installation].push(s);
  });

  function selectLocation(id) {
    const marker = markersById[id];
    if (!marker) return;
    map.flyTo(marker.getLatLng(), 16);
    marker.openPopup();
    closeDropdown();
  }

  function dropdownItemHtml(id, label) {
    return `<button type="button" class="dropdown-item" data-id="${id}">${label}</button>`;
  }

  function renderDropdownContent(category) {
    if (category === 'ipa') {
      return (lokasi.ipa || []).map(loc => dropdownItemHtml(loc.id, loc.nama.replace(/^IPA\s+/i, ''))).join('');
    }
    if (category === 'waduk') {
      return (lokasi.waduk || []).map(loc => dropdownItemHtml(loc.id, loc.nama)).join('');
    }
    if (category === 'sumur') {
      return Object.keys(sumurByInstallation).map(installation => {
        const groupLabel = ipaLabelByInstallation[installation] || installation;
        const items = sumurByInstallation[installation]
          .map(s => dropdownItemHtml(s.id, s.nama.split('—')[0].trim()))
          .join('');
        return `<span class="dropdown-group-label">${groupLabel}</span>${items}`;
      }).join('');
    }
    return '';
  }

  const dropdownEl = document.getElementById('categoryDropdown');
  const dropdownListEl = document.getElementById('dropdownList');
  let openCategory = null;

  function closeDropdown() {
    openCategory = null;
    dropdownEl.classList.remove('open');
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('dropdown-open'));
  }

  function openDropdownFor(category, btn) {
    openCategory = category;
    dropdownListEl.innerHTML = renderDropdownContent(category);
    dropdownEl.classList.add('open');
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('dropdown-open'));
    btn.classList.add('dropdown-open');
  }

  dropdownListEl.addEventListener('click', e => {
    const item = e.target.closest('.dropdown-item');
    if (item) selectLocation(item.dataset.id);
  });

  document.addEventListener('click', e => {
    if (!dropdownEl.contains(e.target) && !e.target.closest('.filter-btn')) closeDropdown();
  });

  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const f = btn.dataset.filter;
      map.removeLayer(ipaLayer); map.removeLayer(sumurLayer); map.removeLayer(wadukLayer);
      if (f === 'all') { ipaLayer.addTo(map); sumurLayer.addTo(map); wadukLayer.addTo(map); }
      else if (f === 'ipa') { ipaLayer.addTo(map); }
      else if (f === 'sumur') { sumurLayer.addTo(map); }
      else if (f === 'waduk') { wadukLayer.addTo(map); }

      if (f === 'all') { closeDropdown(); }
      else if (openCategory === f) { closeDropdown(); }
      else { openDropdownFor(f, btn); }
    });
  });
}

init();
