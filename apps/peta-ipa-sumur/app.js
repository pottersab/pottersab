/* ==========================================================================
   Peta Interaktif — IPA, Sumur & Waduk (Sub Divisi Sumber Air Baku)
   --------------------------------------------------------------------------
   data/lokasi.json  -> nama + koordinat per titik, statis (jarang berubah).
   ?action=map-latest -> angka terbaru (AP/ATD/debit/statis/dinamis/level/dll)
   dari Postgres yang sama dipakai grafik existing (api/visualization/admin-library.js).
   Digabung di sini berdasarkan `id` yang sama di kedua sumber.
   ========================================================================== */

const MAP_LATEST_URL = '/api/visualization/admin-library?action=map-latest';

// Status TIDAK PERNAH diisi manual -- selalu dihitung dari nilai debit.
function statusFromDebit(debit) {
  return (debit === null || debit === undefined || debit === 0) ? 'non-aktif' : 'aktif';
}

function fmtM3(v) {
  return v === null || v === undefined ? 'Data belum tersedia' : Number(v).toLocaleString('id-ID') + ' m3';
}
function fmtNum(v, satuan) {
  return v === null || v === undefined ? 'Data belum tersedia' : v + ' ' + satuan;
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

  (lokasi.ipa || []).forEach(loc => {
    const d = latest.ipa && latest.ipa[loc.id] ? latest.ipa[loc.id] : { ap: null, atd: null };
    const rows = [];
    if (d.ap !== null && d.ap !== undefined) rows.push(`<div class="popup-row">AP (Air Permukaan): ${fmtM3(d.ap)}</div>`);
    if (d.atd !== null && d.atd !== undefined) rows.push(`<div class="popup-row">ATD (Air Tanah Dalam): ${fmtM3(d.atd)}</div>`);
    if (rows.length === 0) rows.push('<div class="popup-row">Data AP/ATD belum tersedia</div>');
    L.marker([loc.lat, loc.lng], { icon: ipaIcon })
      .bindPopup(`<div class="popup-title">${loc.nama}</div>${rows.join('')}`)
      .bindTooltip(loc.nama, { permanent: true, direction: 'right', offset: [8, -8], className: 'marker-label' })
      .addTo(ipaLayer);
  });

  (lokasi.sumur || []).forEach(loc => {
    const d = latest.sumur && latest.sumur[loc.id] ? latest.sumur[loc.id] : { statis: null, dinamis: null, debit: null };
    const status = statusFromDebit(d.debit);
    const icon = status === 'aktif' ? sumurAktifIcon : sumurNonaktifIcon;
    const badgeClass = status === 'aktif' ? 'badge-aktif' : 'badge-nonaktif';
    L.marker([loc.lat, loc.lng], { icon })
      .bindPopup(`
        <div class="popup-title">${loc.nama}</div>
        <div class="popup-row">Level statis: ${fmtNum(d.statis, 'm')}</div>
        <div class="popup-row">Level dinamis: ${fmtNum(d.dinamis, 'm')}</div>
        <div class="popup-row">Debit: ${fmtNum(d.debit, 'm3/jam')}</div>
        <span class="badge ${badgeClass}">${status === 'aktif' ? 'Aktif' : 'Non-aktif'}</span>
      `)
      .bindTooltip(loc.nama, { direction: 'right', offset: [8, -8], className: 'marker-label' })
      .addTo(sumurLayer);
  });

  (lokasi.waduk || []).forEach(loc => {
    const d = latest.waduk && latest.waduk[loc.id] ? latest.waduk[loc.id] : { level: null, curahHujan: null, ntu: null, ph: null };
    const rows = [`<div class="popup-row">Level waduk: ${fmtNum(d.level, 'm')}</div>`];
    if (d.curahHujan !== null && d.curahHujan !== undefined) rows.push(`<div class="popup-row">Curah hujan: ${d.curahHujan} mm</div>`);
    rows.push(`<div class="popup-row">NTU: ${fmtNum(d.ntu, '')}</div>`);
    rows.push(`<div class="popup-row">pH: ${fmtNum(d.ph, '')}</div>`);
    L.marker([loc.lat, loc.lng], { icon: wadukIcon })
      .bindPopup(`<div class="popup-title">${loc.nama}</div>${rows.join('')}`)
      .bindTooltip(loc.nama, { permanent: true, direction: 'right', offset: [8, -8], className: 'marker-label' })
      .addTo(wadukLayer);
  });

  ipaLayer.addTo(map);
  sumurLayer.addTo(map);
  wadukLayer.addTo(map);

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
    });
  });
}

init();
