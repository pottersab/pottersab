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

module.exports = { buildDummyRows };
