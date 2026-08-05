const { ensureVizTables, ensureKpiTables } = require('../../lib/db');
const { requireAdmin } = require('../../lib/auth');
const { DATASETS, isValidDataType } = require('../../lib/visualization/columns');
const { checkVizAccess } = require('../../lib/visualization/viz-auth');
const { buildDummyRows, buildDummyWideSingleRows, buildDummySumurDebitRows, buildDummySumurLevelRows } = require('../../lib/visualization/dummy');
const { fetchRealRows, fetchWideSingleRows, fetchSumurWells, fetchSumurDebitRows, fetchSumurLevelRows } = require('../../lib/visualization/repo');
const { logViewerAction } = require('../../lib/visualization/access-log');
const { getKpiUkurDebitData, buildKpiExcelWorkbook, getKpiApatdData, buildKpiApatdExcelWorkbook, getKpiPengambilanData, buildKpiPengambilanExcelWorkbook } = require('../../lib/visualization/kpi');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  await ensureVizTables();

  const { dataType } = req.query;

  // KPI 18.2 Ukur Debit gabungan 5 instalasi -- bukan satu baris di DATASETS
  // (bentuknya bukan 'wide'/'sumur-debit' tunggal), jadi ditangani terpisah
  // di sini sebelum masuk jalur DATASETS biasa. Lihat lib/visualization/kpi.js
  // untuk alasan kenapa ini tidak jadi berkas api/ sendiri.
  if (dataType === 'kpi_ukur_debit') {
    await ensureKpiTables();
    const access = await checkVizAccess(req);
    const result = await getKpiUkurDebitData(access, req.query.tahun);
    return res.status(200).json(result);
  }

  // Unduh Excel -- admin-only (sama seperti tombol Unduh Excel di halaman viz
  // lain), dibangun di server dengan exceljs supaya border/font-nya benar-benar
  // tertulis (build SheetJS gratis yang jalan di browser tidak bisa menulis
  // gaya sel sama sekali, lihat catatan di lib/visualization/kpi.js).
  if (dataType === 'kpi_ukur_debit_xlsx') {
    await ensureKpiTables();
    const user = requireAdmin(req, res);
    if (!user) return;
    const result = await getKpiUkurDebitData({ granted: true, kind: 'admin' }, req.query.tahun);
    // Tanggal tanda tangan defaultnya hari ini, tapi boleh ditimpa manual dari
    // halaman (field-nya bisa diedit) -- meta['1'] & meta['2'] sama-sama
    // menunjuk objek yang sama, jadi cukup timpa sekali.
    if (req.query.tanggal) result.meta['1'].signPlaceDate = req.query.tanggal;
    const buffer = await buildKpiExcelWorkbook(result);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="18.2 Ukur Debit ${result.year}.xlsx"`);
    return res.status(200).send(Buffer.from(buffer));
  }

  // KPI 18.3a Monitoring Debit AP & ATD -- gabungan dua dataset ('ap' +
  // 'atd') dalam satu laporan, jadi ditangani terpisah juga, sama seperti
  // kpi_ukur_debit di atas. Lihat lib/visualization/kpi.js.
  if (dataType === 'kpi_apatd') {
    await ensureKpiTables();
    const access = await checkVizAccess(req);
    const result = await getKpiApatdData(access, req.query.tahun);
    return res.status(200).json(result);
  }

  if (dataType === 'kpi_apatd_xlsx') {
    await ensureKpiTables();
    const user = requireAdmin(req, res);
    if (!user) return;
    const result = await getKpiApatdData({ granted: true, kind: 'admin' }, req.query.tahun);
    if (req.query.tanggal) result.meta.signPlaceDate = req.query.tanggal;
    const buffer = await buildKpiApatdExcelWorkbook(result);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="18.3A APATD ${result.year}.xlsx"`);
    return res.status(200).send(Buffer.from(buffer));
  }

  // KPI 18.3b Pengambilan Air Baku -- Realisasi dihitung ulang dari 'ap' +
  // 'atd' (sama seperti kpi_apatd), Anggaran dari kpi_pengambilan_target.
  // Ditangani terpisah juga, sama seperti kpi_ukur_debit/kpi_apatd di atas.
  if (dataType === 'kpi_pengambilan') {
    await ensureKpiTables();
    const access = await checkVizAccess(req);
    const result = await getKpiPengambilanData(access, req.query.tahun);
    return res.status(200).json(result);
  }

  if (dataType === 'kpi_pengambilan_xlsx') {
    await ensureKpiTables();
    const user = requireAdmin(req, res);
    if (!user) return;
    const result = await getKpiPengambilanData({ granted: true, kind: 'admin' }, req.query.tahun);
    if (req.query.tanggal) result.meta.signPlaceDate = req.query.tanggal;
    const buffer = await buildKpiPengambilanExcelWorkbook(result);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="18.3B Pengambilan Air Baku ${result.year}.xlsx"`);
    return res.status(200).send(Buffer.from(buffer));
  }

  if (!isValidDataType(dataType)) {
    return res.status(400).json({ error: 'dataType tidak dikenal' });
  }
  const source = DATASETS[dataType];
  const access = await checkVizAccess(req);

  if (source.kind === 'wide') {
    const header = ['Bulan', ...source.columns.map(c => c.csv)];
    if (!access.granted) {
      return res.status(200).json({ locked: true, header, rows: buildDummyRows(source) });
    }
    const rows = await fetchRealRows(source);
    await logViewerAction(access, dataType, 'view');
    return res.status(200).json({ locked: false, header, rows });
  }

  if (source.kind === 'wide-single') {
    if (!access.granted) {
      const { dateKey, rows } = buildDummyWideSingleRows(source);
      return res.status(200).json({ locked: true, header: [dateKey, source.csvCol], rows });
    }
    const { dateKey, rows } = await fetchWideSingleRows(source);
    await logViewerAction(access, dataType, 'view');
    return res.status(200).json({ locked: false, header: [dateKey, source.csvCol], rows });
  }

  if (source.kind === 'sumur-debit') {
    if (access.granted) {
      const { wells, rows } = await fetchSumurDebitRows(source);
      await logViewerAction(access, dataType, 'view');
      return res.status(200).json({ locked: false, header: ['Bulan', ...wells], rows });
    }
    const wells = await fetchSumurWells(source.installation, 'debit');
    return res.status(200).json({ locked: true, header: ['Bulan', ...wells], rows: buildDummySumurDebitRows(wells, source.dummyMax) });
  }

  if (source.kind === 'sumur-level') {
    if (access.granted) {
      const { wells, rows } = await fetchSumurLevelRows(source);
      const header = ['Bulan', ...wells.flatMap(w => [w + '_Statis', w + '_Dinamis'])];
      await logViewerAction(access, dataType, 'view');
      return res.status(200).json({ locked: false, header, rows });
    }
    const wells = await fetchSumurWells(source.installation, 'level');
    const header = ['Bulan', ...wells.flatMap(w => [w + '_Statis', w + '_Dinamis'])];
    return res.status(200).json({ locked: true, header, rows: buildDummySumurLevelRows(wells, source.dummyMax) });
  }

  return res.status(500).json({ error: 'Kind dataset tidak dikenal' });
};
