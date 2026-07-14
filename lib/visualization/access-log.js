const { pool } = require('../db');

const VIEW_DEBOUNCE_MS = 60 * 1000;

// Catat aktivitas viewer yang SUDAH di-approve (lihat data asli / unduh
// PDF) ke access_logs, supaya admin tahu siapa buka/unduh data apa dan
// kapan. SENGAJA tidak pernah log akses admin (JWT admin) -- itu bukan
// "viewer yang di-approve", cuma dicek lewat `access.kind` yang dikembalikan
// checkVizAccess (lib/visualization/viz-auth.js): 'admin' vs 'viz'.
//
// action 'view' di-debounce per (request_id, data_type): kalau baris log
// 'view' terakhir untuk kombinasi itu kurang dari 1 menit lalu, tidak
// dicatat lagi -- supaya polling/reload chart otomatis tidak membanjiri
// riwayat dengan entri duplikat. action lain (mis. 'download_pdf') selalu
// dicatat karena itu aksi eksplisit sekali klik, bukan hasil polling.
async function logViewerAction(access, dataType, action) {
  if (!access || access.kind !== 'viz' || !access.requestId) return;

  try {
    if (action === 'view') {
      const { rows } = await pool.query(
        `SELECT created_at FROM access_logs
         WHERE request_id = $1 AND data_type = $2 AND action = 'view'
         ORDER BY created_at DESC LIMIT 1`,
        [access.requestId, dataType]
      );
      if (rows[0] && Date.now() - new Date(rows[0].created_at).getTime() < VIEW_DEBOUNCE_MS) {
        return;
      }
    }

    await pool.query(
      `INSERT INTO access_logs (request_id, data_type, action) VALUES ($1, $2, $3)`,
      [access.requestId, dataType, action]
    );
  } catch (err) {
    // Gagal mencatat log tidak boleh menggagalkan response data/PDF ke viewer.
    console.error('Gagal mencatat access_logs:', err);
  }
}

module.exports = { logViewerAction };
