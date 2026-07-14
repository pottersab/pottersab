const { pool } = require('../_db');

// Ambil data asli dari Postgres untuk satu source (ap/atd), bentuknya sama
// dengan shape lama (Bulan 'YYYY-MM' + kolom per instalasi bernama sesuai
// CSV asli) supaya konsumen (data.js, export-pdf.js) tidak perlu tahu nama
// kolom database.
async function fetchRealRows(source) {
  const dbCols = source.columns.map(c => c.db);
  const { rows: dbRows } = await pool.query(
    `SELECT to_char(bulan, 'YYYY-MM') as bulan, ${dbCols.join(', ')} FROM ${source.table} ORDER BY bulan`
  );

  return dbRows.map(r => {
    const row = { Bulan: r.bulan };
    source.columns.forEach(c => {
      row[c.csv] = r[c.db] !== null && r[c.db] !== undefined ? Number(r[c.db]) : null;
    });
    return row;
  });
}

module.exports = { fetchRealRows };
