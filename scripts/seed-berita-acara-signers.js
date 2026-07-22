// Isi awal tabel `berita_acara_signers` (Nama 2 -> Jabatan & Tindak Lanjut
// baku untuk apps/berita-acara.html) supaya tidak perlu ketik ulang manual
// lewat panel Admin di browser. Aman dijalankan berkali-kali -- pakai
// ON CONFLICT (nama) DO UPDATE, jadi menjalankan ulang cuma menimpa data
// yang sama, bukan bikin duplikat.
//
// Cara pakai (butuh DATABASE_URL sudah di-set di environment, sama seperti
// yang dipakai Vercel):
//   node scripts/seed-berita-acara-signers.js

const { pool, ensureSignersTable } = require('../lib/db');

const SIGNERS = [
  {
    nama: 'M TAUFIK MUSTOFA',
    jabatan: 'Supervisor Pengolahan Unit I Perumda Tirta Manuntung Balikpapan',
    tindakLanjut: 'Dianggap perlu untuk segera dilakukan persiapan material, peralatan dan tenaga kerja kerja untuk menunjang pekerjaan perbaikan pipa sumur agar pengiriman air baku ke IPA Kilometer 12 dapat normal kembali untuk meminimalisir gangguan pelayanan kepada pelanggan Perumda Tirta Manuntung Balikpapan.'
  },
  {
    nama: 'EDDIE SAPUTRA',
    jabatan: 'Supervisor Pengolahan Unit II Perumda Tirta Manuntung Balikpapan',
    tindakLanjut: 'Dianggap perlu untuk segera dilakukan persiapan material, peralatan dan tenaga kerja untuk menunjang pekerjaan perbaikan pipa transmisi air baku dan pengembalian area agar pengiriman air baku ke IPA Batu Ampar dapat normal kembali untuk meminimalisir gangguan pelayanan kepada pelanggan Perumda Tirta Manuntung Balikpapan.'
  },
  {
    nama: 'ERPAN',
    jabatan: 'Supervisor Pengolahan Unit III Perumda Tirta Manuntung Balikpapan',
    tindakLanjut: 'Dianggap perlu untuk segera dilakukan persiapan material, peralatan dan tenaga kerja kerja untuk menunjang pekerjaan perbaikan pipa transmisi air sumur dan pengembalian area agar pengiriman air baku ke IPA Gunung Sari dapat normal kembali untuk meminimalisir gangguan pelayanan kepada pelanggan Perumda Tirta Manuntung Balikpapan.'
  },
  {
    nama: 'PUJIANTO',
    jabatan: 'Supervisor Pengolahan Unit IV Perumda Tirta Manuntung Balikpapan',
    tindakLanjut: 'Dianggap perlu untuk segera dilakukan persiapan material, peralatan dan tenaga kerja untuk menunjang pekerjaan perbaikan pipa transmisi air baku dan pengembalian area agar pengiriman air baku ke IPA Kp Damai dapat normal kembali untuk meminimalisir gangguan pelayanan kepada pelanggan Perumda Tirta Manuntung Balikpapan.'
  },
  {
    nama: 'TORMAN NOVA L.',
    jabatan: 'Supervisor Pengolahan Unit V Perumda Tirta Manuntung Balikpapan',
    tindakLanjut: 'Dianggap perlu untuk segera dilakukan persiapan material, peralatan dan tenaga kerja untuk menunjang pekerjaan perbaikan pipa transmisi air baku dan pengembalian area agar pengiriman air baku ke IPA Gunung Tembak dapat normal kembali untuk meminimalisir gangguan pelayanan kepada pelanggan Perumda Tirta Manuntung Balikpapan.'
  }
];

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL belum di-set. Set dulu env variable ini (sama seperti di Vercel) sebelum menjalankan script ini.');
    process.exit(1);
  }

  await ensureSignersTable();

  for (const s of SIGNERS) {
    await pool.query(
      `INSERT INTO berita_acara_signers (nama, jabatan, tindak_lanjut, updated_at) VALUES ($1, $2, $3, now())
       ON CONFLICT (nama) DO UPDATE SET jabatan = EXCLUDED.jabatan, tindak_lanjut = EXCLUDED.tindak_lanjut, updated_at = now()`,
      [s.nama, s.jabatan, s.tindakLanjut]
    );
    console.log(`Tersimpan: ${s.nama}`);
  }

  console.log(`Selesai. ${SIGNERS.length} data siap dipakai di panel Admin Berita Acara.`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
