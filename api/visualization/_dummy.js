// Generator data dummy — dipakai data.js kalau tidak ada token akses valid.
// Sengaja TIDAK menyentuh data asli sama sekali: rentang bulan pakai
// konstanta tetap (mencerminkan rentang arsip asli), nilainya random walk
// dalam batas atas per kategori (lihat dummyMax di _columns.js). Jadi
// bentuk grafik terlihat wajar (naik-turun halus) tapi angkanya bukan
// data asli sama sekali, dan tidak bisa dipakai menebak data asli.

const DUMMY_START = '2015-07';

function monthRange(startYYYYMM, endDate) {
  const [sy, sm] = startYYYYMM.split('-').map(Number);
  const months = [];
  let y = sy, m = sm;
  const endY = endDate.getFullYear(), endM = endDate.getMonth() + 1;
  while (y < endY || (y === endY && m <= endM)) {
    months.push(`${y}-${String(m).padStart(2, '0')}`);
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return months;
}

function randomWalkSeries(length, max) {
  const stepSize = max * 0.08;
  const series = [];
  let v = Math.random() * max;
  for (let i = 0; i < length; i++) {
    v += (Math.random() * 2 - 1) * stepSize;
    if (v < 0) v = Math.random() * max * 0.3;
    if (v > max) v = max - Math.random() * max * 0.3;
    series.push(Math.round(v));
  }
  return series;
}

function buildDummyRows(source) {
  const months = monthRange(DUMMY_START, new Date());
  const seriesByCol = source.columns.map(c => randomWalkSeries(months.length, source.dummyMax));

  const rows = months.map((bulan, i) => {
    const row = { Bulan: bulan };
    source.columns.forEach((c, ci) => { row[c.csv] = seriesByCol[ci][i]; });
    return row;
  });

  return rows;
}

// --- kind: 'wide-single' (Manggar/Teritip harian) --------------------------
const DUMMY_DAILY_START = '2014-01-01';

function dayRange(startISO, endDate) {
  const days = [];
  let d = new Date(startISO + 'T00:00:00');
  while (d <= endDate) {
    const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
    days.push(`${y}-${m}-${day}`);
    d.setDate(d.getDate() + 1);
  }
  return days;
}

function buildDummyWideSingleRows(source) {
  const dateKey = source.dateGranularity === 'day' ? 'Tanggal' : 'Bulan';
  const dates = source.dateGranularity === 'day'
    ? dayRange(DUMMY_DAILY_START, new Date())
    : monthRange(DUMMY_START, new Date());
  const series = randomWalkSeries(dates.length, source.dummyMax);

  const rows = dates.map((d, i) => ({ [dateKey]: d, [source.csvCol]: series[i] }));
  return { dateKey, rows };
}

// --- Sumur Dalam (ternormalisasi, tapi tampil ke client dalam bentuk lebar) -
// Nama sumur BUKAN data rahasia (cuma nama instalasi), jadi dipakai apa
// adanya -- yang diacak cuma nilainya.
const DUMMY_SUMUR_START = '2015-01';

function buildDummySumurDebitRows(wells, dummyMax) {
  const months = monthRange(DUMMY_SUMUR_START, new Date());
  const seriesByWell = wells.map(() => randomWalkSeries(months.length, dummyMax));
  const rows = months.map((bulan, i) => {
    const row = { Bulan: bulan };
    wells.forEach((w, wi) => { row[w] = seriesByWell[wi][i]; });
    return row;
  });
  return rows;
}

function buildDummySumurLevelRows(wells, dummyMax) {
  const months = monthRange(DUMMY_SUMUR_START, new Date());
  const statisByWell = wells.map(() => randomWalkSeries(months.length, dummyMax));
  const dinamisByWell = wells.map(() => randomWalkSeries(months.length, dummyMax));
  const rows = months.map((bulan, i) => {
    const row = { Bulan: bulan };
    wells.forEach((w, wi) => {
      row[w + '_Statis'] = statisByWell[wi][i];
      row[w + '_Dinamis'] = dinamisByWell[wi][i];
    });
    return row;
  });
  return rows;
}

module.exports = { buildDummyRows, buildDummyWideSingleRows, buildDummySumurDebitRows, buildDummySumurLevelRows };
