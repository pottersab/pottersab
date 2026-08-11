const { ensureVizTables } = require('../../lib/db');
const { DATASETS, isValidDataType } = require('../../lib/visualization/columns');
const { checkVizAccess } = require('../../lib/visualization/viz-auth');
const { fetchRealRows, fetchWideSingleRows, fetchSumurDebitRows, fetchSumurLevelRows } = require('../../lib/visualization/repo');
const { buildTablePdf } = require('../../lib/visualization/pdf-table');
const { logViewerAction } = require('../../lib/visualization/access-log');

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

// Ditulis eksplisit, bukan lewat toLocaleDateString('id-ID'), supaya hasilnya
// tidak bergantung pada data lokal yang tersedia di runtime server.
const MONTHS_LONG = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

// Untuk angka besar yang pecahannya tidak berarti apa-apa: volume air dalam m³
// dan rekapitulasi bulanan. Dibulatkan supaya tabelnya tidak penuh nol.
function fmtNum(v) {
  return v !== null && v !== undefined ? Math.round(v).toLocaleString('id-ID') : '-';
}

// Untuk semua PEMBACAAN ALAT: level/kekeruhan/pH/curah hujan Manggar &
// Teritip, dan debit maupun level statis-dinamis Sumur Dalam. Di sini
// pecahannya justru inti datanya -- level 6,42 m tidak sama dengan 6 m, dan
// pH 7,15 tidak sama dengan 7. Dulu semuanya lewat fmtNum dan dibulatkan jadi
// bilangan bulat, jadi angka di belakang koma hilang dari PDF padahal ada di
// layar. Kolom-kolomnya di basis data memang NUMERIC, bukan INTEGER.
//
// Dua angka di belakang koma, sama dengan tabel di layar. Pemisah desimalnya
// koma karena seluruh angka di PDF ini memang sudah berformat Indonesia
// (fmtNum menulis 121.896, bukan 121,896).
function fmtDesimal(v) {
  return v !== null && v !== undefined
    ? Number(v).toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : '-';
}

function monthLabel(bulanStr) {
  const [y, m] = bulanStr.split('-').map(Number);
  return `${MONTHS_SHORT[m - 1]} ${y}`;
}

// "2025-01-01" -> "1 Januari 2025". Angka harinya tanpa nol di depan, seperti
// cara orang menulis tanggal, bukan seperti kunci basis data.
function dailyLabel(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return `${d} ${MONTHS_LONG[m - 1]} ${y}`;
}

function filterByYear(rows, year, dateField) {
  if (!year) return rows;
  return rows.filter(r => r[dateField].startsWith(`${year}-`));
}

function yearsInRows(rows, dateField) {
  return [...new Set(rows.map(r => r[dateField].slice(0, 4)))].sort();
}

function pickYear(years, requestedYear) {
  return (requestedYear && years.includes(String(requestedYear))) ? String(requestedYear) : years[years.length - 1];
}

// Grafiknya digambar Chart.js di browser, jadi tidak ada gunanya server
// menggambar ulang -- client tinggal mengirim hasil canvas-nya sebagai PNG.
// GET tetap dilayani supaya tautan lama (dan unduhan tanpa grafik) tidak
// rusak; POST dipakai kalau ada gambar yang ikut dikirim.
//
// Batasnya 3 MB: grafik biasa cuma puluhan KB, jadi apa pun yang jauh lebih
// besar dari itu lebih mungkin salah kirim daripada grafik sungguhan. Body
// request di Vercel sendiri dibatasi 4,5 MB.
const CHART_PNG_MAX_BYTES = 3 * 1024 * 1024;

function bacaChartPng(req) {
  if (req.method !== 'POST') return null;
  const v = req.body && req.body.chartPng;
  if (typeof v !== 'string') return null;
  if (!v.startsWith('data:image/png;base64,')) return null;
  if (v.length > CHART_PNG_MAX_BYTES) return null;
  return v;
}

module.exports = async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const chartPng = bacaChartPng(req);

  // Grafik selalu menempel di section pertama -- section berikutnya (mis.
  // Statis/Dinamis pada level sumur) tetap tabel polos.
  const bikinPdf = (opts) => {
    if (chartPng && opts.sections && opts.sections[0]) opts.sections[0].chartPng = chartPng;
    return buildTablePdf(opts);
  };

  await ensureVizTables();

  const { dataType, mode, well, year } = req.query;
  if (!isValidDataType(dataType)) {
    return res.status(400).json({ error: 'dataType tidak dikenal' });
  }
  const source = DATASETS[dataType];

  const access = await checkVizAccess(req);
  if (!access.granted) {
    return res.status(403).json({ error: 'Akses ditolak. Minta akses dulu lewat tombol "Minta Akses" di halaman.' });
  }

  let pdfBytes, filename;

  if (source.kind === 'wide') {
    if (!['series', 'total', 'rekap'].includes(mode)) {
      return res.status(400).json({ error: 'mode wajib diisi (series/total/rekap)' });
    }
    const allRows = await fetchRealRows(source);

    if (mode === 'series') {
      const col = source.columns.find(c => c.db === well);
      if (!col) return res.status(400).json({ error: 'well tidak dikenal' });
      const rows = filterByYear(allRows, year, 'Bulan');
      const tableRows = rows.map(r => [monthLabel(r.Bulan), fmtNum(r[col.csv])]);
      pdfBytes = await bikinPdf({
        sections: [{
          title: 'Data Historis Pengambilan Air Baku',
          subtitle: `Perumda Tirta Manuntung — Sumber Air Baku  |  Debit ${source.label} — ${col.label}  |  ${year ? `Tahun ${year}` : 'Semua Data'}  (m³)`,
          columns: [{ header: 'Bulan', weight: 1 }, { header: 'Nilai (m³)', weight: 1 }],
          rows: tableRows
        }]
      });
      filename = `${dataType}_${col.db}_${year || 'semua-data'}.pdf`;
    }

    if (mode === 'total') {
      const rows = filterByYear(allRows, year, 'Bulan');
      const tableRows = rows.map(r => {
        const sum = source.columns.reduce((s, c) => s + (r[c.csv] || 0), 0);
        return [monthLabel(r.Bulan), fmtNum(sum)];
      });
      pdfBytes = await bikinPdf({
        sections: [{
          title: 'Data Historis Pengambilan Air Baku',
          subtitle: `Perumda Tirta Manuntung — Sumber Air Baku  |  Jumlah — ${source.label}  |  ${year ? `Tahun ${year}` : 'Semua Data'}  (m³)`,
          columns: [{ header: 'Bulan', weight: 1 }, { header: 'Total (m³)', weight: 1 }],
          rows: tableRows
        }]
      });
      filename = `${dataType}_total_${year || 'semua-data'}.pdf`;
    }

    if (mode === 'rekap') {
      // Satu section = satu tahun = satu halaman (buildTablePdf selalu memulai
      // halaman baru tiap section).
      const bikinSectionTahun = (activeYear) => {
        const yearRows = allRows.filter(r => r.Bulan.startsWith(`${activeYear}-`));
        const byMonth = {};
        yearRows.forEach(r => { byMonth[Number(r.Bulan.slice(5, 7))] = r; });
        const monthTotals = new Array(12).fill(0);
        const monthHas = new Array(12).fill(false);
        const tableRows = source.columns.map(col => {
          const values = MONTHS_SHORT.map((_, i) => {
            const r = byMonth[i + 1];
            const v = r ? r[col.csv] : null;
            if (v !== null && v !== undefined) { monthTotals[i] += v; monthHas[i] = true; }
            return fmtNum(v);
          });
          return [col.label, ...values];
        });
        const totalRow = monthTotals.map((t, i) => fmtNum(monthHas[i] ? t : null));
        tableRows.push(['Jumlah', ...totalRow]);
        return {
          title: 'Data Historis Pengambilan Air Baku — Rekapitulasi',
          subtitle: `Perumda Tirta Manuntung — Sumber Air Baku  |  ${source.label}  |  Tahun ${activeYear}  |  Satuan m³`,
          columns: [{ header: 'Instalasi', weight: 1.6 }, ...MONTHS_SHORT.map(m => ({ header: m, weight: 1 }))],
          rows: tableRows,
          totalRowIndex: tableRows.length - 1
        };
      };

      const years = yearsInRows(allRows, 'Bulan');
      // year=all -> chip "Semua Data" di halaman: tabelnya ikut semua tahun,
      // bukan cuma tahun terbaru. Dulu parameter tahun selalu diisi satu tahun,
      // jadi PDF-nya cuma memuat satu halaman padahal grafiknya lintas tahun.
      const semuaTahun = String(year || '').toLowerCase() === 'all';
      const tahunDipakai = semuaTahun ? years : [pickYear(years, year)];

      // Dua tahun per halaman supaya berkasnya tidak jadi setebal jumlah
      // tahunnya. Kecuali halaman pertama: di situ sudah ada grafik, sisa
      // ruangnya cuma cukup untuk satu tahun. Jadi tahun ke-0 sendirian, lalu
      // berpasangan -- indeks ganjil membuka halaman, indeks genap menyambung.
      pdfBytes = await bikinPdf({
        landscape: true,
        sections: tahunDipakai.map((t, i) => ({
          ...bikinSectionTahun(t),
          sambung: i >= 2 && i % 2 === 0
        }))
      });
      filename = semuaTahun
        ? `rekapitulasi_${dataType}_semua-tahun.pdf`
        : `rekapitulasi_${dataType}_${tahunDipakai[0]}.pdf`;
    }
  } else if (source.kind === 'wide-single') {
    // Kalau ada tahun yang diminta, batasi fetch ke rentang tahun itu di SQL
    // (tabel harian besar) -- hasilnya sama dengan filterByYear di bawah,
    // tanpa menarik seluruh baris sejak 2014. Tanpa tahun (mode "Semua Data")
    // fetch tetap semua baris.
    const yearStart = String(year || '').match(/^\d{4}$/)
      ? `${year}-01-01`
      : null;
    const yearEnd = yearStart ? `${year}-12-31` : null;
    const { dateKey, rows: allRows } = await fetchWideSingleRows(
      source,
      yearStart ? { start: yearStart, end: yearEnd } : undefined
    );
    const rows = filterByYear(allRows, year, dateKey);
    const labelFn = dateKey === 'Tanggal' ? dailyLabel : monthLabel;
    const tableRows = rows.map(r => [labelFn(r[dateKey]), fmtDesimal(r[source.csvCol])]);
    pdfBytes = await bikinPdf({
      sections: [{
        title: 'Data Waduk dan Sumur',
        subtitle: `Perumda Tirta Manuntung — Sumber Air Baku  |  ${source.label}  |  ${year ? `Tahun ${year}` : 'Semua Data'}  (${source.unit})`,
        columns: [{ header: dateKey, weight: 1 }, { header: `Nilai (${source.unit})`, weight: 1 }],
        rows: tableRows
      }]
    });
    filename = `${dataType}_${year || 'semua-data'}.pdf`;
  } else if (source.kind === 'sumur-debit') {
    const { wells, rows: allRows } = await fetchSumurDebitRows(source);
    const years = yearsInRows(allRows, 'Bulan');
    // "Semua Data" (parameter tahun tidak dikirim / 'all') -> seluruh tahun
    // dimuat, bukan cuma tahun terbaru -- persis seperti mode rekap AP/ATD
    // (wide) di atas. Dua tahun per halaman lanskap: tabel debit per tahun
    // cuma 8 baris (7 sumur + Jumlah), jadi 2 muat dengan jeda antar-tahun.
    const semuaTahun = !year || String(year).toLowerCase() === 'all';
    const tahunDipakai = semuaTahun ? years : [pickYear(years, year)];

    const bikinSectionTahun = (activeYear) => {
      const yearRows = allRows.filter(r => r.Bulan.startsWith(`${activeYear}-`));
      const byMonth = {};
      yearRows.forEach(r => { byMonth[Number(r.Bulan.slice(5, 7))] = r; });
      const monthTotals = new Array(12).fill(0);
      const monthHas = new Array(12).fill(false);
      const tableRows = wells.map(w => {
        const values = MONTHS_SHORT.map((_, i) => {
          const r = byMonth[i + 1];
          const v = r ? r[w] : null;
          if (v !== null && v !== undefined) { monthTotals[i] += v; monthHas[i] = true; }
          return fmtDesimal(v);
        });
        return [w.replace(/_/g, ' '), ...values];
      });
      const totalRow = monthTotals.map((t, i) => fmtDesimal(monthHas[i] ? t : null));
      tableRows.push(['Jumlah', ...totalRow]);
      return {
        title: 'Data Waduk dan Sumur — Rekapitulasi',
        subtitle: `${source.label}  |  Tahun ${activeYear}  |  Satuan ${source.unit}`,
        columns: [{ header: 'Sumur', weight: 1.8 }, ...MONTHS_SHORT.map(m => ({ header: m, weight: 1 }))],
        rows: tableRows,
        totalRowIndex: tableRows.length - 1
      };
    };

    pdfBytes = await bikinPdf({
      landscape: true,
      sections: tahunDipakai.map((t, i) => ({
        ...bikinSectionTahun(t),
        sambung: i % 2 === 1
      }))
    });
    filename = semuaTahun ? `${dataType}_semua-tahun.pdf` : `${dataType}_${tahunDipakai[0]}.pdf`;
  } else if (source.kind === 'sumur-level') {
    const { wells, rows: allRows } = await fetchSumurLevelRows(source);
    const years = yearsInRows(allRows, 'Bulan');
    const semuaTahun = !year || String(year).toLowerCase() === 'all';
    const tahunDipakai = semuaTahun ? years : [pickYear(years, year)];

    // Satu tahun = dua tabel (Statis & Dinamis), sama seperti sebelumnya.
    // Tabel kedua tahun yang sama menumpang di halaman yang sama (sambung),
    // tahun berikutnya mulai di halaman baru -- dua tahun tidak muat karena
    // tiap tahun sudah memakai dua tabel. Ini yang paling rapi untuk level.
    const sections = [];
    tahunDipakai.forEach((t) => {
      const yearRows = allRows.filter(r => r.Bulan.startsWith(`${t}-`));
      const byMonth = {};
      yearRows.forEach(r => { byMonth[Number(r.Bulan.slice(5, 7))] = r; });
      ['Statis', 'Dinamis'].forEach((variant) => {
        const tableRows = wells.map(w => {
          const values = MONTHS_SHORT.map((_, i) => {
            const r = byMonth[i + 1];
            const v = r ? r[w + '_' + variant] : null;
            return fmtDesimal(v);
          });
          return [w.replace(/_/g, ' '), ...values];
        });
        sections.push({
          title: 'Data Waduk dan Sumur — Rekapitulasi',
          subtitle: `${source.label} — ${variant}  |  Tahun ${t}  |  Satuan m`,
          columns: [{ header: 'Sumur', weight: 1.8 }, ...MONTHS_SHORT.map(m => ({ header: m, weight: 1 }))],
          rows: tableRows
        });
      });
    });

    pdfBytes = await bikinPdf({
      landscape: true,
      sections: sections.map((s, i) => ({ ...s, sambung: i % 2 === 1 }))
    });
    filename = semuaTahun ? `${dataType}_semua-tahun.pdf` : `${dataType}_${tahunDipakai[0]}.pdf`;
  } else {
    return res.status(500).json({ error: 'Kind dataset tidak dikenal' });
  }

  await logViewerAction(access, dataType, 'download_pdf');

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
  return res.status(200).send(Buffer.from(pdfBytes));
};
