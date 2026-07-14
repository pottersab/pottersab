const { ensureVizTables } = require('../_db');
const { DATASETS, isValidDataType } = require('./_columns');
const { checkVizAccess } = require('./_viz-auth');
const { buildDummyRows } = require('./_dummy');
const { fetchRealRows } = require('./_repo');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  await ensureVizTables();

  const { dataType } = req.query;
  if (!isValidDataType(dataType)) {
    return res.status(400).json({ error: 'dataType wajib diisi (ap/atd)' });
  }
  const source = DATASETS[dataType];

  const access = await checkVizAccess(req);
  const header = ['Bulan', ...source.columns.map(c => c.csv)];

  if (!access.granted) {
    return res.status(200).json({ locked: true, header, rows: buildDummyRows(source) });
  }

  const rows = await fetchRealRows(source);
  return res.status(200).json({ locked: false, header, rows });
};
