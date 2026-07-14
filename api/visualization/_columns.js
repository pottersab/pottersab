// Konfigurasi kolom untuk data Air Baku, dipakai bersama oleh migrasi CSV,
// data.js, export-pdf.js, dan admin-input.js. Mencerminkan struktur kolom
// CSV asli (air_permukaan.csv / air_tanah_dalam.csv) dan nama kolom Postgres.
// Kalau kolom instalasi berubah, cukup ubah di sini.

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
  ap: { table: 'air_permukaan', columns: AP_COLUMNS, label: 'Air Permukaan (AP)', dummyMax: 1400000 },
  atd: { table: 'air_tanah_dalam', columns: ATD_COLUMNS, label: 'Air Tanah Dalam (ATD)', dummyMax: 420000 }
};

function isValidDataType(dataType) {
  return Object.prototype.hasOwnProperty.call(DATASETS, dataType);
}

module.exports = { DATASETS, isValidDataType };
