const { ensureVizTables } = require('../../lib/db');
const { DATASETS, isValidDataType } = require('../../lib/visualization/columns');
const { checkVizAccess } = require('../../lib/visualization/viz-auth');
const { fetchRealRows, fetchWideSingleRows, fetchSumurDebitRows, fetchSumurLevelRows } = require('../../lib/visualization/repo');
const { buildTablePdf } = require('../../lib/visualization/pdf-table');
const { logViewerAction } = require('../../lib/visualization/access-log');

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

function fmtNum(v) {
  return v !== null && v !== undefined ? Math.round(v).toLocaleString('id-ID') : '-';
}

function monthLabel(bulanStr) {
  const [y, m] = bulanStr.split('-').map(Number);
  return `${MONTHS_SHORT[m - 1]} ${y}`;
}

function dailyLabel(dateStr) {
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
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

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

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
      pdfBytes = await buildTablePdf({
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
      pdfBytes = await buildTablePdf({
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
      const years = yearsInRows(allRows, 'Bulan');
      const activeYear = pickYear(years, year);
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
      pdfBytes = await buildTablePdf({
        landscape: true,
        sections: [{
          title: 'Data Historis Pengambilan Air Baku — Rekapitulasi',
          subtitle: `Perumda Tirta Manuntung — Sumber Air Baku  |  ${source.label}  |  Tahun ${activeYear}  |  Satuan m³`,
          columns: [{ header: 'Instalasi', weight: 1.6 }, ...MONTHS_SHORT.map(m => ({ header: m, weight: 1 }))],
          rows: tableRows,
          totalRowIndex: tableRows.length - 1
        }]
      });
      filename = `rekapitulasi_${dataType}_${activeYear}.pdf`;
    }
  } else if (source.kind === 'wide-single') {
    const { dateKey, rows: allRows } = await fetchWideSingleRows(source);
    const rows = filterByYear(allRows, year, dateKey);
    const labelFn = dateKey === 'Tanggal' ? dailyLabel : monthLabel;
    const tableRows = rows.map(r => [labelFn(r[dateKey]), fmtNum(r[source.csvCol])]);
    pdfBytes = await buildTablePdf({
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
    const activeYear = pickYear(years, year);
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
        return fmtNum(v);
      });
      return [w.replace(/_/g, ' '), ...values];
    });
    const totalRow = monthTotals.map((t, i) => fmtNum(monthHas[i] ? t : null));
    tableRows.push(['Jumlah', ...totalRow]);
    pdfBytes = await buildTablePdf({
      landscape: true,
      sections: [{
        title: 'Data Waduk dan Sumur — Rekapitulasi',
        subtitle: `${source.label}  |  Tahun ${activeYear}  |  Satuan ${source.unit}`,
        columns: [{ header: 'Sumur', weight: 1.8 }, ...MONTHS_SHORT.map(m => ({ header: m, weight: 1 }))],
        rows: tableRows,
        totalRowIndex: tableRows.length - 1
      }]
    });
    filename = `${dataType}_${activeYear}.pdf`;
  } else if (source.kind === 'sumur-level') {
    const { wells, rows: allRows } = await fetchSumurLevelRows(source);
    const years = yearsInRows(allRows, 'Bulan');
    const activeYear = pickYear(years, year);
    const yearRows = allRows.filter(r => r.Bulan.startsWith(`${activeYear}-`));
    const byMonth = {};
    yearRows.forEach(r => { byMonth[Number(r.Bulan.slice(5, 7))] = r; });

    function buildVariantSection(variant) {
      const tableRows = wells.map(w => {
        const values = MONTHS_SHORT.map((_, i) => {
          const r = byMonth[i + 1];
          const v = r ? r[w + '_' + variant] : null;
          return fmtNum(v);
        });
        return [w.replace(/_/g, ' '), ...values];
      });
      return {
        title: 'Data Waduk dan Sumur — Rekapitulasi',
        subtitle: `${source.label} — ${variant}  |  Tahun ${activeYear}  |  Satuan m`,
        columns: [{ header: 'Sumur', weight: 1.8 }, ...MONTHS_SHORT.map(m => ({ header: m, weight: 1 }))],
        rows: tableRows
      };
    }

    pdfBytes = await buildTablePdf({
      landscape: true,
      sections: [buildVariantSection('Statis'), buildVariantSection('Dinamis')]
    });
    filename = `${dataType}_${activeYear}.pdf`;
  } else {
    return res.status(500).json({ error: 'Kind dataset tidak dikenal' });
  }

  await logViewerAction(access, dataType, 'download_pdf');

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
  return res.status(200).send(Buffer.from(pdfBytes));
};
