// Registry semua dataset yang dilayani /api/visualization/*. Dipakai bersama
// oleh migrasi CSV, data.js, export-pdf.js, dan endpoint admin-input.
//
// Tiap entry punya:
//   kind        - 'wide' (tabel kolom tetap, 1 baris per tanggal/bulan,
//                  dipakai air baku ap/atd), 'wide-single' (tabel kolom
//                  tetap tapi cuma 1 kolom nilai yang relevan buat key ini,
//                  dipakai Manggar/Teritip harian), 'sumur-debit' /
//                  'sumur-level' (data ternormalisasi per sumur per bulan,
//                  jumlah sumur per instalasi dinamis lewat tabel sumur_wells)
//   accessGroup - grup halaman/konteks (dipakai client buat label modal
//                 "Minta Akses" & field dataType di request.js). Akses viewer
//                 sekarang site-wide (lihat checkVizAccess di viz-auth.js),
//                 jadi field ini cuma informasi konteks, bukan pembatas akses.
//   dummyMax    - batas atas nilai acak kalau data terkunci (lihat dummy.js)

const AP_COLUMNS = [
  { csv: 'Teritip', db: 'teritip', label: 'Teritip' },
  { csv: 'Kampung_Damai', db: 'kampung_damai', label: 'Kampung Damai' },
  { csv: 'Batu_Ampar', db: 'batu_ampar', label: 'Batu Ampar' },
  { csv: 'Km_12', db: 'km_12', label: 'Kilometer 12' },
  { csv: 'Gunung_Tembak', db: 'gunung_tembak', label: 'Gunung Tembak' }
];

const ATD_COLUMNS = [
  { csv: 'Kampung_Damai', db: 'kampung_damai', label: 'Kampung Damai' },
  { csv: 'Gunung_Sari', db: 'gunung_sari', label: 'Gunung Sari' },
  { csv: 'Prapatan', db: 'prapatan', label: 'Prapatan' },
  { csv: 'Zamp', db: 'zamp', label: 'Zamp' },
  { csv: 'Kampung_Baru_Ulu', db: 'kampung_baru_ulu', label: 'Kampung Baru Ulu' }
];

const DATASETS = {
  ap: {
    kind: 'wide', accessGroup: 'ap', table: 'air_permukaan', dateCol: 'bulan', dateGranularity: 'month',
    columns: AP_COLUMNS, label: 'Air Permukaan (AP)', dummyMax: 1400000
  },
  atd: {
    kind: 'wide', accessGroup: 'atd', table: 'air_tanah_dalam', dateCol: 'bulan', dateGranularity: 'month',
    columns: ATD_COLUMNS, label: 'Air Tanah Dalam (ATD)', dummyMax: 420000
  },

  // --- Waduk Manggar (harian, sejak 2014) ---
  manggar_level: {
    kind: 'wide-single', accessGroup: 'manggar', table: 'manggar_level_curahhujan', dateCol: 'tanggal', dateGranularity: 'day',
    col: 'level_waduk_manggar_m', csvCol: 'Level_Waduk_Manggar_m', unit: 'm',
    label: 'Level Waduk Manggar', dummyMax: 14, hasGauge: true
  },
  manggar_hujan: {
    kind: 'wide-single', accessGroup: 'manggar', table: 'manggar_level_curahhujan', dateCol: 'tanggal', dateGranularity: 'day',
    col: 'curah_hujan_mm', csvCol: 'Curah_Hujan_mm', unit: 'mm',
    label: 'Curah Hujan Waduk Manggar', dummyMax: 120
  },
  manggar_ntu: {
    kind: 'wide-single', accessGroup: 'manggar', table: 'kualitas_air_manggar_teritip', dateCol: 'tanggal', dateGranularity: 'day',
    col: 'ntu_manggar', csvCol: 'NTU_Manggar', unit: 'NTU',
    label: 'Kekeruhan (NTU) Waduk Manggar', dummyMax: 40
  },
  manggar_ph: {
    kind: 'wide-single', accessGroup: 'manggar', table: 'kualitas_air_manggar_teritip', dateCol: 'tanggal', dateGranularity: 'day',
    col: 'ph_manggar', csvCol: 'PH_Manggar', unit: 'pH',
    label: 'PH Air Baku Waduk Manggar', dummyMax: 9
  },

  // --- Waduk Teritip (harian, tanpa curah hujan) ---
  teritip_level: {
    kind: 'wide-single', accessGroup: 'teritip', table: 'teritip_level', dateCol: 'tanggal', dateGranularity: 'day',
    col: 'level_waduk_teritip_m', csvCol: 'Level_Waduk_Teritip_m', unit: 'm',
    label: 'Level Waduk Teritip', dummyMax: 8, hasGauge: true
  },
  teritip_ntu: {
    kind: 'wide-single', accessGroup: 'teritip', table: 'kualitas_air_manggar_teritip', dateCol: 'tanggal', dateGranularity: 'day',
    col: 'ntu_teritip', csvCol: 'NTU_Teritip', unit: 'NTU',
    label: 'Kekeruhan (NTU) Waduk Teritip', dummyMax: 40
  },
  teritip_ph: {
    kind: 'wide-single', accessGroup: 'teritip', table: 'kualitas_air_manggar_teritip', dateCol: 'tanggal', dateGranularity: 'day',
    col: 'ph_teritip', csvCol: 'PH_Teritip', unit: 'pH',
    label: 'PH Air Baku Waduk Teritip', dummyMax: 9
  }
};

// 7 instalasi Sumur Dalam. Key harus SAMA PERSIS dengan yang sudah dipakai
// apps/library/app.js (termasuk quirk "kp_baru_ulu" vs "kampung_baru_ulu"
// yang sudah ada sejak sebelum migrasi ini) supaya tab submenu yang lama
// tidak perlu diubah. `installation` adalah id kanonik yang dipakai di
// tabel sumur_wells/sumur_*_readings (konsisten debit & level).
const SUMUR_INSTALLATIONS = [
  { installation: 'gunung_sari', label: 'IPA Gunung Sari', debitKey: 'sumur_debit_gunung_sari', levelKey: 'sumur_level_gunung_sari' },
  { installation: 'kampung_damai', label: 'IPA Kampung Damai', debitKey: 'sumur_debit_kampung_damai', levelKey: 'sumur_level_kampung_damai' },
  { installation: 'teritip', label: 'IPA Teritip', debitKey: 'sumur_debit_teritip', levelKey: 'sumur_level_teritip' },
  { installation: 'gunung_tembak', label: 'IPA Gunung Tembak', debitKey: 'sumur_debit_gunung_tembak', levelKey: 'sumur_level_gunung_tembak' },
  { installation: 'prapatan', label: 'IPA Prapatan', debitKey: 'sumur_debit_prapatan', levelKey: 'sumur_level_prapatan' },
  { installation: 'zamp', label: 'IPA Zamp', debitKey: 'sumur_debit_zamp', levelKey: 'sumur_level_zamp' },
  { installation: 'kampung_baru_ulu', label: 'IPA Kampung Baru Ulu', debitKey: 'sumur_debit_kp_baru_ulu', levelKey: 'sumur_level_kampung_baru_ulu' }
];

SUMUR_INSTALLATIONS.forEach(inst => {
  DATASETS[inst.debitKey] = {
    kind: 'sumur-debit', accessGroup: 'sumur_debit', installation: inst.installation,
    label: `Debit Sumur — ${inst.label}`, unit: 'm³/jam', dummyMax: 80
  };
  DATASETS[inst.levelKey] = {
    kind: 'sumur-level', accessGroup: 'sumur_level', installation: inst.installation,
    label: `Level Statis & Dinamis — ${inst.label}`, unit: 'm', dummyMax: 60
  };
});

function isValidDataType(dataType) {
  return Object.prototype.hasOwnProperty.call(DATASETS, dataType);
}

// Grup halaman/konteks (dipakai access_requests.data_type / request.js /
// approve.js) -- cuma buat admin tahu dari mana permintaan datang (mis.
// 'manggar' mencakup manggar_level, manggar_hujan, manggar_ntu, manggar_ph).
// TIDAK membatasi akses lagi -- 1 approval dari grup mana pun membuka SEMUA
// data viewer site-wide (lihat checkVizAccess di viz-auth.js).
const ACCESS_GROUP_LABELS = {
  ap: 'Air Permukaan (AP)',
  atd: 'Air Tanah Dalam (ATD)',
  manggar: 'Waduk Manggar (Level, Curah Hujan, Kekeruhan, PH)',
  teritip: 'Waduk Teritip (Level, Kekeruhan, PH)',
  sumur_debit: 'Debit Sumur Dalam (semua instalasi)',
  sumur_level: 'Level Statis & Dinamis Sumur Dalam (semua instalasi)',
  spd: 'Generator Surat Penyediaan Dana (SPD)',
  berita_acara: 'Generator Berita Acara',
  surat_permohonan: 'Generator Surat Permohonan',
  laporan_p2k3: 'Generator Laporan P2K3'
};

function isValidAccessGroup(group) {
  return Object.prototype.hasOwnProperty.call(ACCESS_GROUP_LABELS, group);
}

module.exports = { DATASETS, SUMUR_INSTALLATIONS, isValidDataType, ACCESS_GROUP_LABELS, isValidAccessGroup };
