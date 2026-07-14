const { ensureVizTables } = require('../_db');
const { DATASETS, isValidDataType } = require('./_columns');
const { checkVizAccess } = require('./_viz-auth');
const { fetchRealRows } = require('./_repo');
const { buildTablePdf } = require('./_pdf-table');

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

function fmtNum(v) {
  return v !== null && v !== undefined ? Math.round(v).toLocaleString('id-ID') : '-';
}

function monthLabel(bulanStr) {
  const [y, m] = bulanStr.split('-').map(Number);
  return `${MONTHS_SHORT[m - 1]} ${y}`;
}

function filterByYear(rows, year) {
  if (!year) return rows;
  return rows.filter(r => r.Bulan.startsWith(`${year}-`));
}

function yearsInRows(rows) {
  return [...new Set(rows.map(r => r.Bulan.slice(0, 4)))].sort();
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  await ensureVizTables();

  const { dataType, mode, well, year } = req.query;
  if (!isValidDataType(dataType)) {
    return res.status(400).json({ error: 'dataType wajib diisi (ap/atd)' });
  }
  if (!['series', 'total', 'rekap'].includes(mode)) {
    return res.status(400).json({ error: 'mode wajib diisi (series/total/rekap)' });
  }

  const access = await checkVizAccess(req);
  if (!access.granted) {
    return res.status(403).json({ error: 'Akses ditolak. Minta akses dulu lewat tombol "Minta Akses" di halaman.' });
  }

  const source = DATASETS[dataType];
  const allRows = await fetchRealRows(source);

  let pdfBytes, filename;

  if (mode === 'series') {
    const col = source.columns.find(c => c.db === well);
    if (!col) return res.status(400).json({ error: 'well tidak dikenal' });

    const rows = filterByYear(allRows, year);
    const tableRows = rows.map(r => [monthLabel(r.Bulan), fmtNum(r[col.csv])]);

    pdfBytes = await buildTablePdf({
      title: 'Data Historis Pengambilan Air Baku',
      subtitle: `Perumda Tirta Manuntung — Sumber Air Baku  |  Debit ${source.label} — ${col.label}  |  ${year ? `Tahun ${year}` : 'Semua Data'}  (m³)`,
      columns: [{ header: 'Bulan', weight: 1 }, { header: 'Nilai (m³)', weight: 1 }],
      rows: tableRows
    });
    filename = `${dataType}_${col.db}_${year || 'semua-data'}.pdf`;
  }

  if (mode === 'total') {
    const rows = filterByYear(allRows, year);
    const tableRows = rows.map(r => {
      const sum = source.columns.reduce((s, c) => s + (r[c.csv] || 0), 0);
      return [monthLabel(r.Bulan), fmtNum(sum)];
    });

    pdfBytes = await buildTablePdf({
      title: 'Data Historis Pengambilan Air Baku',
      subtitle: `Perumda Tirta Manuntung — Sumber Air Baku  |  Jumlah — ${source.label}  |  ${year ? `Tahun ${year}` : 'Semua Data'}  (m³)`,
      columns: [{ header: 'Bulan', weight: 1 }, { header: 'Total (m³)', weight: 1 }],
      rows: tableRows
    });
    filename = `${dataType}_total_${year || 'semua-data'}.pdf`;
  }

  if (mode === 'rekap') {
    const years = yearsInRows(allRows);
    const activeYear = (year && years.includes(String(year))) ? String(year) : years[years.length - 1];
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
      title: 'Data Historis Pengambilan Air Baku — Rekapitulasi',
      subtitle: `Perumda Tirta Manuntung — Sumber Air Baku  |  ${source.label}  |  Tahun ${activeYear}  |  Satuan m³`,
      columns: [{ header: 'Instalasi', weight: 1.6 }, ...MONTHS_SHORT.map(m => ({ header: m, weight: 1 }))],
      rows: tableRows,
      totalRowIndex: tableRows.length - 1,
      landscape: true
    });
    filename = `rekapitulasi_${dataType}_${activeYear}.pdf`;
  }

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
  return res.status(200).send(Buffer.from(pdfBytes));
};
