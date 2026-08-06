const { ensureVizTables, ensureKpiTables, ensurePekerjaanTable } = require('../../lib/db');
const { requireAdmin } = require('../../lib/auth');
const { DATASETS, isValidDataType } = require('../../lib/visualization/columns');
const { checkVizAccess } = require('../../lib/visualization/viz-auth');
const { buildDummyRows, buildDummyWideSingleRows, buildDummySumurDebitRows, buildDummySumurLevelRows } = require('../../lib/visualization/dummy');
const { fetchRealRows, fetchWideSingleRows, fetchSumurWells, fetchSumurDebitRows, fetchSumurLevelRows } = require('../../lib/visualization/repo');
const { logViewerAction } = require('../../lib/visualization/access-log');
const { getKpiUkurDebitData, buildKpiExcelWorkbook, getKpiApatdData, buildKpiApatdExcelWorkbook, getKpiPengambilanData, buildKpiPengambilanExcelWorkbook, getKpiKualitasData, buildKpiKualitasExcelWorkbook, getKpi192Data, buildKpi192ExcelWorkbook, getKpiLevelSumurData, buildKpiLevelSumurExcelWorkbook, getKpiLevelStatisDinamisData, buildKpiLevelStatisDinamisExcelWorkbook, getKpi18_5Data, buildKpi18_5ExcelWorkbook, getKpi18_6Data, buildKpi18_6ExcelWorkbook, getKpiActivityPlanData, buildKpiActivityPlanExcelWorkbook, getKpiJadwalKegiatanData, buildKpiJadwalKegiatanExcelWorkbook, getKpi9_2Data, buildKpi9_2ExcelWorkbook, getKpi9_3Data, buildKpi9_3ExcelWorkbook, getKpi9_4Data, buildKpi9_4ExcelWorkbook, getKpi9_7Data, buildKpi9_7ExcelWorkbook, getKpi9_5Data, buildKpi9_5ExcelWorkbook } = require('../../lib/visualization/kpi');

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

  // KPI 18.4 Laporan Kualitas Air Baku -- Level/NTU/PH dihitung ulang dari
  // dataset manggar_*/teritip_* (sama seperti kpi_apatd/kpi_pengambilan di
  // atas), status pintu elevasi dari kualitas_pintu_elevasi. Ditangani
  // terpisah juga, sama seperti KPI lain. Lihat lib/visualization/kpi.js.
  if (dataType === 'kpi_kualitas') {
    await ensureKpiTables();
    const access = await checkVizAccess(req);
    const result = await getKpiKualitasData(access, req.query.bulan);
    return res.status(200).json(result);
  }

  if (dataType === 'kpi_kualitas_xlsx') {
    await ensureKpiTables();
    const user = requireAdmin(req, res);
    if (!user) return;
    const result = await getKpiKualitasData({ granted: true, kind: 'admin' }, req.query.bulan);
    if (req.query.tanggal) result.meta.signPlaceDate = req.query.tanggal;
    const buffer = await buildKpiKualitasExcelWorkbook(result);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="18.4 Laporan Kualitas Air Baku ${result.bulan}.xlsx"`);
    return res.status(200).send(Buffer.from(buffer));
  }

  // KPI 19.2 Evaluasi Hasil Monitoring -- daftar berita acara (pekerjaan)
  // per jadwal bulanan, bukan laporan angka. Ditangani terpisah juga, sama
  // seperti KPI lain; datanya dari tabel `pekerjaan` (lihat
  // lib/visualization/kpi.js). Lihat catatan tentang batas 12 Serverless
  // Function di kpi.js -- makanya digabung ke berkas ini.
  if (dataType === 'kpi_19_2') {
    await ensureKpiTables();
    await ensurePekerjaanTable();
    const access = await checkVizAccess(req);
    const result = await getKpi192Data(access, req.query.bulan);
    return res.status(200).json(result);
  }

  if (dataType === 'kpi_19_2_xlsx') {
    await ensureKpiTables();
    await ensurePekerjaanTable();
    const user = requireAdmin(req, res);
    if (!user) return;
    const result = await getKpi192Data({ granted: true, kind: 'admin' }, req.query.bulan);
    if (req.query.tanggal) result.meta.signPlaceDate = req.query.tanggal;
    const buffer = await buildKpi192ExcelWorkbook(result);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="19.2 Evaluasi Hasil Monitoring ${result.monthTitle}.xlsx"`);
    return res.status(200).send(Buffer.from(buffer));
  }

  // KPI 18.1a Pengukuran Level Sumur -- laporan JUMLAH sumur per instalasi
  // (ANGG = sumur aktif, REAL = sumur terukur), dihitung ulang dari
  // sumur_wells/sumur_level_readings. Ditangani terpisah juga, sama seperti
  // KPI lain (batas 12 Serverless Function -- lihat kpi.js).
  if (dataType === 'kpi_18_1a') {
    await ensureKpiTables();
    await ensureVizTables();
    const access = await checkVizAccess(req);
    const result = await getKpiLevelSumurData(access, req.query.tahun);
    return res.status(200).json(result);
  }

  if (dataType === 'kpi_18_1a_xlsx') {
    await ensureKpiTables();
    await ensureVizTables();
    const user = requireAdmin(req, res);
    if (!user) return;
    const result = await getKpiLevelSumurData({ granted: true, kind: 'admin' }, req.query.tahun);
    if (req.query.tanggal) result.meta.signPlaceDate = req.query.tanggal;
    const buffer = await buildKpiLevelSumurExcelWorkbook(result);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="18.1A Pengukuran Level Sumur ${result.year}.xlsx"`);
    return res.status(200).send(Buffer.from(buffer));
  }

  // KPI 18.1b Pengukuran Statis-Dinamis -- nilai SWL (statis) & DWL (dinamis)
  // per sumur per bulan, dari sumur_level_readings (lihat kpi.js). Ditangani
  // terpisah juga, sama seperti KPI lain (batas 12 Serverless Function).
  if (dataType === 'kpi_18_1b') {
    await ensureKpiTables();
    await ensureVizTables();
    const access = await checkVizAccess(req);
    const result = await getKpiLevelStatisDinamisData(access, req.query.tahun);
    return res.status(200).json(result);
  }

  if (dataType === 'kpi_18_1b_xlsx') {
    await ensureKpiTables();
    await ensureVizTables();
    const user = requireAdmin(req, res);
    if (!user) return;
    const result = await getKpiLevelStatisDinamisData({ granted: true, kind: 'admin' }, req.query.tahun);
    if (req.query.tanggal) result.meta.signPlaceDate = req.query.tanggal;
    const buffer = await buildKpiLevelStatisDinamisExcelWorkbook(result);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="18.1B Pengukuran Statis Dinamis ${result.year}.xlsx"`);
    return res.status(200).send(Buffer.from(buffer));
  }

  // KPI 18.5 Monitoring Kondisi Peralatan -- laporan INPUT MANUAL (ANGG/REAL
  // diisi admin, disimpan di kpi_18_5_monitoring), ±/% dihitung otomatis.
  // Ditangani terpisah juga, sama seperti KPI lain (lihat kpi.js).
  if (dataType === 'kpi_18_5') {
    await ensureKpiTables();
    await ensureVizTables();
    const access = await checkVizAccess(req);
    const result = await getKpi18_5Data(access, req.query.tahun);
    return res.status(200).json(result);
  }

  if (dataType === 'kpi_18_5_xlsx') {
    await ensureKpiTables();
    await ensureVizTables();
    const user = requireAdmin(req, res);
    if (!user) return;
    const result = await getKpi18_5Data({ granted: true, kind: 'admin' }, req.query.tahun);
    if (req.query.tanggal) result.meta.signPlaceDate = req.query.tanggal;
    const buffer = await buildKpi18_5ExcelWorkbook(result);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="18.5 Monitoring Kondisi Peralatan ${result.tahun}.xlsx"`);
    return res.status(200).send(Buffer.from(buffer));
  }

  // KPI 18.6 Jadwal PM Terkendali -- tanggal Rencana/Realisasi per bulan,
  // dihitung ulang dari 19.2 (lihat kpi.js). Ditangani terpisah juga.
  if (dataType === 'kpi_18_6') {
    await ensureKpiTables();
    await ensurePekerjaanTable();
    const access = await checkVizAccess(req);
    const result = await getKpi18_6Data(access, req.query.tahun);
    return res.status(200).json(result);
  }

  if (dataType === 'kpi_18_6_xlsx') {
    await ensureKpiTables();
    await ensurePekerjaanTable();
    const user = requireAdmin(req, res);
    if (!user) return;
    const result = await getKpi18_6Data({ granted: true, kind: 'admin' }, req.query.tahun);
    if (req.query.tanggal) result.meta.signPlaceDate = req.query.tanggal;
    const buffer = await buildKpi18_6ExcelWorkbook(result);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="18.6 Jadwal PM Terkendali ${result.tahun}.xlsx"`);
    return res.status(200).send(Buffer.from(buffer));
  }

  // Activity Plan SAB -- dashboard rekap KPI tahunan. % Progres otomatis dari
  // laporan KPI terkait (18.1a/18.2/18.3b) atau manual; grup 18/19 rata-rata.
  if (dataType === 'kpi_activity_plan') {
    await ensureKpiTables();
    const access = await checkVizAccess(req);
    const result = await getKpiActivityPlanData(access, req.query.tahun, req.query.periode);
    return res.status(200).json(result);
  }

  if (dataType === 'kpi_activity_plan_xlsx') {
    await ensureKpiTables();
    const user = requireAdmin(req, res);
    if (!user) return;
    const result = await getKpiActivityPlanData({ granted: true, kind: 'admin' }, req.query.tahun, req.query.periode);
    if (req.query.tanggal) result.signPlaceDate = req.query.tanggal;
    const buffer = await buildKpiActivityPlanExcelWorkbook(result);
    const apPeriodSuffix = result.periodeNum === 2 ? ' Jul-Des' : '';
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="Activity Plan SAB ${result.tahun}${apPeriodSuffix}.xlsx"`);
    return res.status(200).send(Buffer.from(buffer));
  }

  // Jadwal Kegiatan (apps/kpi-sab/jadwal-kegiatan.html). Beda dari KPI lain --
  // dokumen jadwal bulanan yang kolom tanggalnya (hari kerja) & tanda √ dihitung
  // otomatis dari kalender, jadi bisa dilihat siapa saja; cuma unduhan Excel
  // yang dibatasi admin. Lihat lib/visualization/kpi.js.
  if (dataType === 'kpi_jadwal_kegiatan') {
    await ensureKpiTables();
    const access = await checkVizAccess(req);
    const result = await getKpiJadwalKegiatanData(access, req.query.bulan);
    return res.status(200).json(result);
  }

  if (dataType === 'kpi_jadwal_kegiatan_xlsx') {
    await ensureKpiTables();
    const user = requireAdmin(req, res);
    if (!user) return;
    const result = await getKpiJadwalKegiatanData({ granted: true, kind: 'admin' }, req.query.bulan);
    if (req.query.tanggal) result.meta.signPlaceDate = req.query.tanggal;
    const buffer = await buildKpiJadwalKegiatanExcelWorkbook(result);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="Jadwal Kegiatan ${result.monthTitle}.xlsx"`);
    return res.status(200).send(Buffer.from(buffer));
  }

  // 9.2 Laporan Kualitas Air Baku -- data sama persis dengan 18.4 (Level/NTU/
  // PH harian + status pintu elevasi), beda cuma format unduhan Excel (border
  // hair, ttd 3 kolom, kode PTMBPP-IR-PRD.SAB/01-02). Lihat kpi.js.
  if (dataType === 'kpi_9_2') {
    await ensureKpiTables();
    const access = await checkVizAccess(req);
    const result = await getKpi9_2Data(access, req.query.bulan);
    return res.status(200).json(result);
  }

  if (dataType === 'kpi_9_2_xlsx') {
    await ensureKpiTables();
    const user = requireAdmin(req, res);
    if (!user) return;
    const result = await getKpi9_2Data({ granted: true, kind: 'admin' }, req.query.bulan);
    if (req.query.tanggal) result.meta.signPlaceDate = req.query.tanggal;
    const buffer = await buildKpi9_2ExcelWorkbook(result);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="9.2 Laporan Kualitas Air Baku ${result.monthTitle}.xlsx"`);
    return res.status(200).send(Buffer.from(buffer));
  }

  // 9.3 Laporan Kondisi Air Waduk -- Level & Curah Hujan harian dari data air
  // baku, Volume dari rumus, Air yang disadap dari AP (Kampung Damai + Batu
  // Ampar + Km 12), Volume setelah diambil = Volume - disadap. Unduhan Excel
  // persis contoh "9.3 Laporan Kondisi Air Waduk.xlsx" (sheet "03_OK").
  if (dataType === 'kpi_9_3') {
    await ensureKpiTables();
    const access = await checkVizAccess(req);
    const result = await getKpi9_3Data(access, req.query.bulan);
    return res.status(200).json(result);
  }

  if (dataType === 'kpi_9_3_xlsx') {
    await ensureKpiTables();
    const user = requireAdmin(req, res);
    if (!user) return;
    const result = await getKpi9_3Data({ granted: true, kind: 'admin' }, req.query.bulan);
    const buffer = await buildKpi9_3ExcelWorkbook(result);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="9.3 Laporan Kondisi Air Waduk ${result.monthTitle}.xlsx"`);
    return res.status(200).send(Buffer.from(buffer));
  }

  // 9.4 Laporan Ketidaksesuaian Debit -- semua isian manual admin (tidak ada
  // data vital, semua viewer bisa lihat). Unduhan Excel persis contoh
  // "9.4 Laporan Ketidaksesuaian debit.xlsx".
  if (dataType === 'kpi_9_4') {
    await ensureKpiTables();
    const result = await getKpi9_4Data({ granted: true }, req.query.bulan);
    return res.status(200).json(result);
  }

  if (dataType === 'kpi_9_4_xlsx') {
    await ensureKpiTables();
    const user = requireAdmin(req, res);
    if (!user) return;
    const result = await getKpi9_4Data({ granted: true, kind: 'admin' }, req.query.bulan);
    const buffer = await buildKpi9_4ExcelWorkbook(result);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="9.4 Laporan Ketidaksesuaian Debit ${result.monthTitle}.xlsx"`);
    return res.status(200).send(Buffer.from(buffer));
  }

  // 9.7 Laporan Kondisi Air Sumur -- 5 sheet (5 IPA). LEVEL statis/dinamis &
  // REALITA (debit) bulan lalu & bulan ini dari data web sumur_*_readings;
  // MERK/TYPE/NAME PLATE/KETERANGAN/catatan manual admin. Unduhan Excel persis
  // contoh "9.7 Laporan Kondisi Air Sumur.xlsx" (tanda tangan hanya di Hal 5).
  if (dataType === 'kpi_9_7') {
    await ensureKpiTables();
    const access = await checkVizAccess(req);
    const result = await getKpi9_7Data(access, req.query.bulan);
    return res.status(200).json(result);
  }

  if (dataType === 'kpi_9_7_xlsx') {
    await ensureKpiTables();
    const user = requireAdmin(req, res);
    if (!user) return;
    const result = await getKpi9_7Data({ granted: true, kind: 'admin' }, req.query.bulan);
    const buffer = await buildKpi9_7ExcelWorkbook(result);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="9.7 Laporan Kondisi Air Sumur ${result.monthTitle}.xlsx"`);
    return res.status(200).send(Buffer.from(buffer));
  }

  // 9.5 Laporan Monitoring Pipa Transmisi -- semua isian manual admin (tidak
  // ada data vital, semua viewer bisa lihat). Tanggal otomatis: Selasa minggu
  // ke-2 & ke-4 (logika 18.6). Unduhan Excel persis contoh
  // "9.5 Laporan Monitoring Pipa Transmisi.xlsx".
  if (dataType === 'kpi_9_5') {
    await ensureKpiTables();
    const result = await getKpi9_5Data({ granted: true }, req.query.bulan);
    return res.status(200).json(result);
  }

  if (dataType === 'kpi_9_5_xlsx') {
    await ensureKpiTables();
    const user = requireAdmin(req, res);
    if (!user) return;
    const result = await getKpi9_5Data({ granted: true, kind: 'admin' }, req.query.bulan);
    const buffer = await buildKpi9_5ExcelWorkbook(result);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="9.5 Laporan Monitoring Pipa Transmisi ${result.monthTitle}.xlsx"`);
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
