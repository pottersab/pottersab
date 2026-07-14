const { ensureVizTables } = require('../_db');
const { DATASETS, isValidDataType } = require('./_columns');
const { checkVizAccess } = require('./_viz-auth');
const { buildDummyRows, buildDummyWideSingleRows, buildDummySumurDebitRows, buildDummySumurLevelRows } = require('./_dummy');
const { fetchRealRows, fetchWideSingleRows, fetchSumurWells, fetchSumurDebitRows, fetchSumurLevelRows } = require('./_repo');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  await ensureVizTables();

  const { dataType } = req.query;
  if (!isValidDataType(dataType)) {
    return res.status(400).json({ error: 'dataType tidak dikenal' });
  }
  const source = DATASETS[dataType];
  const access = await checkVizAccess(req, source.accessGroup);

  if (source.kind === 'wide') {
    const header = ['Bulan', ...source.columns.map(c => c.csv)];
    if (!access.granted) {
      return res.status(200).json({ locked: true, header, rows: buildDummyRows(source) });
    }
    const rows = await fetchRealRows(source);
    return res.status(200).json({ locked: false, header, rows });
  }

  if (source.kind === 'wide-single') {
    if (!access.granted) {
      const { dateKey, rows } = buildDummyWideSingleRows(source);
      return res.status(200).json({ locked: true, header: [dateKey, source.csvCol], rows });
    }
    const { dateKey, rows } = await fetchWideSingleRows(source);
    return res.status(200).json({ locked: false, header: [dateKey, source.csvCol], rows });
  }

  if (source.kind === 'sumur-debit') {
    if (access.granted) {
      const { wells, rows } = await fetchSumurDebitRows(source);
      return res.status(200).json({ locked: false, header: ['Bulan', ...wells], rows });
    }
    const wells = await fetchSumurWells(source.installation, 'debit');
    return res.status(200).json({ locked: true, header: ['Bulan', ...wells], rows: buildDummySumurDebitRows(wells, source.dummyMax) });
  }

  if (source.kind === 'sumur-level') {
    if (access.granted) {
      const { wells, rows } = await fetchSumurLevelRows(source);
      const header = ['Bulan', ...wells.flatMap(w => [w + '_Statis', w + '_Dinamis'])];
      return res.status(200).json({ locked: false, header, rows });
    }
    const wells = await fetchSumurWells(source.installation, 'level');
    const header = ['Bulan', ...wells.flatMap(w => [w + '_Statis', w + '_Dinamis'])];
    return res.status(200).json({ locked: true, header, rows: buildDummySumurLevelRows(wells, source.dummyMax) });
  }

  return res.status(500).json({ error: 'Kind dataset tidak dikenal' });
};
