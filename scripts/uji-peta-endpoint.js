/* Uji sambungan endpoint peta TANPA database.
   ---------------------------------------------------------------------------
   Menguji bagian yang paling gampang salah dan tidak kelihatan sampai dipakai:
   apakah ?action=map-lokasi benar-benar PUBLIK (tidak ikut kena requireAdmin
   seperti action lain), dan apakah action=peta menolak masukan yang jelas
   salah sebelum menyentuh database.

   lib/db dan lib/auth di-stub, jadi tidak perlu DATABASE_URL. Jalankan:
     node scripts/uji-peta-endpoint.js
   =========================================================================== */

const path = require('path');
const Module = require('module');

const ROOT = path.join(__dirname, '..');
const API = path.join(ROOT, 'api', 'visualization', 'admin-library.js');

// --- Stub modul ----------------------------------------------------------
function stub(request, fromDir, exports) {
  const resolved = require.resolve(request, { paths: [fromDir] });
  const m = new Module(resolved, null);
  m.filename = resolved;
  m.loaded = true;
  m.exports = exports;
  require.cache[resolved] = m;
}

let queryTerakhir = null;
let adminAktif = true;
const rowsPeta = [
  { jenis: 'sumur', lokasi_id: 'teritip_19', nama: 'Sumur 19 — Teritip', installation: 'teritip', lat: -1.163, lng: 117.005, keterangan: null }
];

stub('../../lib/db', path.dirname(API), {
  pool: { query: async (sql, params) => { queryTerakhir = { sql, params }; return { rows: rowsPeta }; } },
  ensureVizTables: async () => {},
  ensureSignersTable: async () => {},
  ensureSpdTables: async () => {},
  ensureSumberTables: async () => {},
  ensurePetaTables: async () => {},
  ensureTable: async () => {}
});

stub('../../lib/auth', path.dirname(API), {
  requireAdmin: (req, res) => {
    if (adminAktif) return { username: 'potter' };
    res.status(401).json({ error: 'Butuh login admin.' });
    return null;
  }
});

const handler = require(API);

// --- Alat bantu ----------------------------------------------------------
function buatRes() {
  return {
    kode: null, body: null,
    status(c) { this.kode = c; return this; },
    json(o) { this.body = o; return this; },
    setHeader() {}, send(o) { this.body = o; }
  };
}
async function panggil({ method = 'GET', query = {}, body = null }) {
  const res = buatRes();
  await handler({ method, query, body, headers: {} }, res);
  return res;
}

let lulus = 0, gagal = 0;
function cek(nama, syarat, info) {
  if (syarat) { lulus++; console.log('  OK    ' + nama); }
  else { gagal++; console.log('  GAGAL ' + nama + (info ? '  -> ' + JSON.stringify(info) : '')); }
}

(async () => {
  console.log('\n1) map-lokasi harus PUBLIK (tanpa login admin)');
  adminAktif = false;   // belum login sama sekali
  let r = await panggil({ query: { action: 'map-lokasi' } });
  cek('tanpa token tetap 200', r.kode === 200, r);
  cek('mengembalikan rows', r.body && Array.isArray(r.body.rows), r.body);
  cek('tidak membocorkan created_by',
    r.body && r.body.rows.every(x => x.created_by === undefined), r.body && r.body.rows[0]);
  adminAktif = true;

  console.log('\n2) action lain tetap terkunci tanpa admin');
  adminAktif = false;
  r = await panggil({ query: { action: 'peta' } });
  cek('action=peta ditolak 401', r.kode === 401, r);
  adminAktif = true;

  console.log('\n3) action=peta menolak masukan salah (sebelum ke database)');
  queryTerakhir = null;
  r = await panggil({ method: 'POST', query: { action: 'peta' }, body: { jenis: 'kantor', lokasi_id: 'x', nama: 'X', lat: 1, lng: 2 } });
  cek('jenis tak dikenal -> 400', r.kode === 400, r);
  cek('tidak menyentuh database', queryTerakhir === null, queryTerakhir);

  r = await panggil({ method: 'POST', query: { action: 'peta' }, body: { jenis: 'ipa', lokasi_id: 'a', nama: 'A', lat: 200, lng: 2 } });
  cek('lat di luar rentang -> 400', r.kode === 400, r);

  r = await panggil({ method: 'POST', query: { action: 'peta' }, body: { jenis: 'ipa', lokasi_id: 'a', nama: 'A', lat: 'bukan angka', lng: 2 } });
  cek('lat bukan angka -> 400', r.kode === 400, r);

  r = await panggil({ method: 'POST', query: { action: 'peta' }, body: { jenis: 'sumur', lokasi_id: 'teritip_19', nama: 'S', lat: -1.1, lng: 117 } });
  cek('sumur tanpa instalasi -> 400', r.kode === 400, r);

  r = await panggil({ method: 'POST', query: { action: 'peta' }, body: { jenis: 'ipa', lokasi_id: '', nama: 'A', lat: -1.1, lng: 117 } });
  cek('id kosong -> 400', r.kode === 400, r);

  console.log('\n4) action=peta menyimpan masukan yang benar');
  queryTerakhir = null;
  r = await panggil({ method: 'POST', query: { action: 'peta' }, body: { jenis: 'sumur', lokasi_id: 'teritip_19', nama: 'Sumur 19 — Teritip', installation: 'teritip', lat: '-1.163', lng: '117.005', keterangan: 'bor baru' } });
  cek('200', r.kode === 200 && r.body.success === true, r.body);
  cek('memakai ON CONFLICT (upsert)', /ON CONFLICT \(jenis, lokasi_id\)/.test(queryTerakhir.sql), queryTerakhir.sql);
  cek('lat/lng jadi angka', queryTerakhir.params[4] === -1.163 && queryTerakhir.params[5] === 117.005, queryTerakhir.params);
  cek('installation sumur tersimpan', queryTerakhir.params[3] === 'teritip', queryTerakhir.params);

  queryTerakhir = null;
  r = await panggil({ method: 'POST', query: { action: 'peta' }, body: { jenis: 'ipa', lokasi_id: 'ipa_baru', nama: 'IPA Baru', lat: -1.2, lng: 116.9 } });
  cek('installation diabaikan untuk non-sumur', queryTerakhir.params[3] === null, queryTerakhir.params);

  console.log('\n5) DELETE');
  r = await panggil({ method: 'DELETE', query: { action: 'peta', jenis: 'sumur' } });
  cek('tanpa id -> 400', r.kode === 400, r);
  queryTerakhir = null;
  r = await panggil({ method: 'DELETE', query: { action: 'peta', jenis: 'sumur', id: 'teritip_19' } });
  cek('200 + hapus per (jenis, id)', r.kode === 200 && /WHERE jenis = \$1 AND lokasi_id = \$2/.test(queryTerakhir.sql), queryTerakhir.sql);
  cek('parameter urut jenis lalu id', queryTerakhir.params[0] === 'sumur' && queryTerakhir.params[1] === 'teritip_19', queryTerakhir.params);

  console.log('\n6) method tidak didukung');
  r = await panggil({ method: 'PUT', query: { action: 'peta' } });
  cek('PUT -> 405', r.kode === 405, r);

  console.log('\n' + (gagal === 0 ? 'SEMUA LULUS' : 'ADA YANG GAGAL') + ' — lulus ' + lulus + ', gagal ' + gagal + '\n');
  process.exit(gagal === 0 ? 0 : 1);
})();
