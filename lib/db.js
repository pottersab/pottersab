const { Pool } = require('pg');

// Vercel Postgres (via Neon Marketplace) otomatis inject DATABASE_URL.
// Jika nama env variable di dashboard Anda berbeda (misal POSTGRES_URL),
// tambahkan DATABASE_URL secara manual di Vercel dengan value yang sama.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

let initialized = false;

async function ensureTable() {
  if (initialized) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS history (
      id BIGINT PRIMARY KEY,
      document_type TEXT NOT NULL,
      document_name TEXT NOT NULL,
      details JSONB,
      created_by TEXT NOT NULL,
      role TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  initialized = true;
}

let usersInitialized = false;

// Tabel akun admin (multi-admin: Potter, Darto, Jarot, dst). Diisi lewat
// scripts/seed-admin.js, bukan lewat API publik -- tidak ada endpoint
// "register" supaya tidak ada yang bisa bikin akun admin sendiri dari luar.
async function ensureUsersTable() {
  if (usersInitialized) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      username TEXT PRIMARY KEY,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL,
      avatar_initial TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'admin',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  usersInitialized = true;
}

let vizInitialized = false;

// Tabel untuk data visualisasi Air Baku (apps/riwayat-air-baku). Data asli
// dipindah kesini dari CSV statis supaya tidak bisa diakses langsung lewat
// URL file, dan hanya dikeluarkan oleh api/visualization/data.js kalau ada
// token akses (viz-access) atau JWT admin yang valid.
async function ensureVizTables() {
  if (vizInitialized) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS access_requests (
      id BIGSERIAL PRIMARY KEY,
      requested_by TEXT NOT NULL,
      data_type TEXT,
      reason TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      approve_secret TEXT NOT NULL,
      poll_secret TEXT,
      token TEXT,
      token_expires_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      approved_at TIMESTAMPTZ
    );

    -- poll_secret menyusul belakangan, jadi tabel yang sudah terlanjur dibuat
    -- perlu ditambal juga -- CREATE TABLE IF NOT EXISTS di atas tidak menyentuh
    -- tabel yang sudah ada. Kolomnya NULLABLE: baris permintaan lama tidak
    -- punya nilai ini, dan memang tidak boleh bisa dipantau lagi (lihat
    -- api/visualization/status.js).
    ALTER TABLE access_requests ADD COLUMN IF NOT EXISTS poll_secret TEXT;

    CREATE TABLE IF NOT EXISTS air_permukaan (
      bulan DATE PRIMARY KEY,
      teritip NUMERIC,
      kampung_damai NUMERIC,
      batu_ampar NUMERIC,
      km_12 NUMERIC,
      gunung_tembak NUMERIC
    );

    CREATE TABLE IF NOT EXISTS air_tanah_dalam (
      bulan DATE PRIMARY KEY,
      kampung_damai NUMERIC,
      gunung_sari NUMERIC,
      prapatan NUMERIC,
      zamp NUMERIC,
      kampung_baru_ulu NUMERIC
    );

    CREATE TABLE IF NOT EXISTS manggar_level_curahhujan (
      tanggal DATE PRIMARY KEY,
      level_waduk_manggar_m NUMERIC,
      curah_hujan_mm NUMERIC
    );

    CREATE TABLE IF NOT EXISTS kualitas_air_manggar_teritip (
      tanggal DATE PRIMARY KEY,
      ntu_manggar NUMERIC,
      ph_manggar NUMERIC,
      ntu_teritip NUMERIC,
      ph_teritip NUMERIC
    );

    CREATE TABLE IF NOT EXISTS teritip_level (
      tanggal DATE PRIMARY KEY,
      level_waduk_teritip_m NUMERIC
    );

    -- Status ON/OFF pintu air elevasi 3/5/7, Waduk Manggar & Teritip (KPI 18.4
    -- Laporan Kualitas Air Baku, apps/kpi-sab/kualitas.html). BUKAN tabel per
    -- hari (dense) -- ini LOG PERUBAHAN status: satu baris cuma ditulis kalau
    -- admin benar-benar mengubah status pintu itu di tanggal itu (klik toggle
    -- di halaman laporan). Status pintu di tanggal MANAPUN dihitung dengan
    -- mencari baris tanggal_mulai <= tanggal itu yang PALING BARU (forward-
    -- fill) -- sekali di-ON kan, tetap ON terus (termasuk bulan/tahun
    -- berikutnya) sampai ada baris baru yang meng-OFF-kannya, TIDAK reset
    -- tiap hari/bulan. Lihat buildElevasiDailyForYear di
    -- lib/visualization/kpi.js. Klik ulang di tanggal yang sama menimpa baris
    -- yang sama (PRIMARY KEY lokasi+elevasi+tanggal_mulai), bukan menumpuk.
    CREATE TABLE IF NOT EXISTS kualitas_elevasi_log (
      lokasi TEXT NOT NULL,
      elevasi INTEGER NOT NULL,
      tanggal_mulai DATE NOT NULL,
      status BOOLEAN NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (lokasi, elevasi, tanggal_mulai)
    );

    -- Daftar sumur aktif per instalasi. Ternormalisasi (bukan kolom tetap)
    -- karena admin bisa tambah/hapus sumur kapan saja lewat
    -- apps/input-data-historis.html tanpa perlu ALTER TABLE.
    -- category ('debit'/'level') dipisah karena data historis asli memakai
    -- penomoran sumur yang tidak selalu sama persis antara file debit dan
    -- level (mis. "Sumur_01" di debit vs "Sumur_1" di level) untuk instalasi
    -- yang sama -- dipisah per kategori supaya tidak memaksakan penyamaan
    -- yang belum tentu benar.
    CREATE TABLE IF NOT EXISTS sumur_wells (
      installation TEXT NOT NULL,
      category TEXT NOT NULL,
      well_name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      PRIMARY KEY (installation, category, well_name)
    );
    -- Kolom active menyusul belakangan, jadi tabel yang sudah terlanjur
    -- dibuat perlu ditambal -- CREATE TABLE IF NOT EXISTS di atas tidak
    -- menyentuh tabel yang sudah ada. Default TRUE: sumur yang sudah terdaftar
    -- tetap dianggap aktif sampai admin menandainya nonaktif (mis. lewat panel
    -- di KPI 18.1a). active TIDAK dipakai untuk menyembunyikan sumur dari
    -- grafik Data Waduk & Sumur -- cuma dipakai KPI 18.1a untuk menentukan
    -- ANGG (anggaran = jumlah sumur AKTIF).
    ALTER TABLE sumur_wells ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;

    CREATE TABLE IF NOT EXISTS sumur_debit_readings (
      installation TEXT NOT NULL,
      well_name TEXT NOT NULL,
      bulan DATE NOT NULL,
      value NUMERIC,
      PRIMARY KEY (installation, well_name, bulan)
    );

    CREATE TABLE IF NOT EXISTS sumur_level_readings (
      installation TEXT NOT NULL,
      well_name TEXT NOT NULL,
      bulan DATE NOT NULL,
      statis NUMERIC,
      dinamis NUMERIC,
      PRIMARY KEY (installation, well_name, bulan)
    );

    -- Log aktivitas viewer yang SUDAH di-approve (lihat data asli / unduh
    -- PDF), supaya admin tahu siapa buka/unduh data apa dan kapan. Tidak ada
    -- FK ke access_requests (konsisten dengan gaya tabel lain di project ini
    -- yang tidak pakai FK, mis. history) -- request_id dicocokkan manual saat
    -- query. Tidak pernah diisi untuk akses admin (JWT admin), cuma viewer
    -- yang pakai token viz-access hasil approve email.
    CREATE TABLE IF NOT EXISTS access_logs (
      id BIGSERIAL PRIMARY KEY,
      request_id BIGINT NOT NULL,
      data_type TEXT NOT NULL,
      action TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_access_logs_request_id ON access_logs(request_id);
  `);
  vizInitialized = true;
}

let signersInitialized = false;

// Data Nama 2 (penandatangan) -> Jabatan & Tindak Lanjut baku untuk
// apps/berita-acara.html. Dikelola admin lewat panel CRUD di halaman itu
// sendiri (bukan lewat script terpisah) supaya bisa ditambah/diedit tanpa
// deploy ulang.
async function ensureSignersTable() {
  if (signersInitialized) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS berita_acara_signers (
      nama TEXT PRIMARY KEY,
      jabatan TEXT,
      tindak_lanjut TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  signersInitialized = true;
}

let spdInitialized = false;

// Template SPD untuk mode admin di apps/spd.html.
//
// spd_templates menampung tiga jenis baris, dibedakan kolom `jenis`:
//   'kode_perk'     -> data { label, kode, uraian }
//   'penandatangan' -> data { nama, manajerNama, manajerJabatan, ... }
//   'kop'           -> data { kodeUnit, nomorTengah, nomorSuffix, footerCode }
//                      (selalu id 'kop', satu baris saja -- bagian surat yang
//                      hampir tidak pernah berubah)
// Isinya JSONB supaya bentuk tiap jenis bisa berkembang tanpa migrasi kolom.
//
// Nomor SPD TIDAK disimpan di sini: nomor berikutnya selalu dihitung dari
// nomor terakhir di riwayat surat (tabel history) -- lihat handleSpd di
// api/visualization/admin-library.js. Jadi tidak ada counter yang bisa
// melenceng dari riwayat, dan menghapus entri riwayat otomatis
// mengembalikan nomornya.
async function ensureSpdTables() {
  if (spdInitialized) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS spd_templates (
      id TEXT PRIMARY KEY,
      jenis TEXT NOT NULL,
      urutan INTEGER NOT NULL DEFAULT 0,
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_spd_templates_jenis ON spd_templates(jenis);
  `);
  spdInitialized = true;
}

let pekerjaanInitialized = false;

// Tabel kanonik seluruh pekerjaan Sub Divisi Sumber Air Baku (apps/
// riwayat-pekerjaan). Menggantikan rekap manual di Word/Google Sheet.
//
// Catatan rancangan:
// - no_ba sengaja TIDAK unique: satu berita acara bisa mencakup beberapa
//   titik pekerjaan sekaligus (di data historis ada 33 kasus, sampai 7 baris
//   dalam satu nomor).
// - lokasi_teks dipakai data historis (nama titik apa adanya, tidak pernah
//   diseragamkan). Pekerjaan baru dari Formulir SAB tidak mengisi ini --
//   lokasinya cuma koordinat GPS, ditampilkan sebagai tautan Google Maps.
// - diameter dipisah nilai + satuan karena pipa transmisi memakai mm
//   sedangkan pipa sumur memakai inch.
// - instalasi menyimpan nama baku (10 nama tanpa prefiks "IPA n"), sedangkan
//   instalasi_asli menyimpan tulisan asli dari rekap lama supaya penyeragaman
//   saat impor tetap bisa ditelusuri.
// - keterangan cuma terisi untuk data historis bidang "lainnya"; tidak ada
//   input barunya di formulir mana pun.
// - deleted_at: soft delete. Semua admin punya hak yang sama (tidak ada role
//   terpisah), jadi rekap 12 tahun ini tidak boleh bisa hilang karena salah
//   klik.
async function ensurePekerjaanTable() {
  if (pekerjaanInitialized) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pekerjaan (
      id BIGSERIAL PRIMARY KEY,
      tanggal DATE NOT NULL,
      no_ba TEXT,

      bidang TEXT NOT NULL,
      jenis TEXT,
      instalasi TEXT,
      instalasi_asli TEXT,

      lokasi_teks TEXT,
      gps_lat NUMERIC,
      gps_lng NUMERIC,
      gps_akurasi NUMERIC,

      material TEXT,
      diameter_nilai NUMERIC,
      diameter_satuan TEXT,

      uraian TEXT,
      keterangan TEXT,
      kontraktor TEXT,
      jam_mulai TIME,
      jam_selesai TIME,
      barang_pengadaan TEXT,
      barang_gudang TEXT,
      foto_urls TEXT[] NOT NULL DEFAULT '{}',

      status TEXT NOT NULL DEFAULT 'draft',
      sumber TEXT NOT NULL,
      history_id BIGINT,
      created_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_by TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_at TIMESTAMPTZ
    );

    CREATE INDEX IF NOT EXISTS idx_pekerjaan_tanggal ON pekerjaan(tanggal);
    CREATE INDEX IF NOT EXISTS idx_pekerjaan_bidang ON pekerjaan(bidang);
    CREATE INDEX IF NOT EXISTS idx_pekerjaan_status ON pekerjaan(status);
    CREATE INDEX IF NOT EXISTS idx_pekerjaan_no_ba ON pekerjaan(no_ba);
  `);
  pekerjaanInitialized = true;
}

let galeriInitialized = false;

// Foto galeri di halaman about.html. Yang disimpan di tabel ini CUMA alamat
// filenya -- gambarnya sendiri ada di Vercel Blob (CDN).
//
// Sengaja BEDA dengan foto lapangan di tabel `pekerjaan`, yang ditaruh sebagai
// base64 di dalam kolom. Foto pekerjaan cuma dibuka admin sesekali sebagai
// lampiran berita acara, sedangkan galeri dibuka pengunjung umum: kalau
// gambarnya ikut disimpan di Neon, tiap kali halaman About dimuat semua
// fotonya harus ditarik lewat Serverless Function dan menghabiskan kuota
// database 0,5 GB. Lewat Blob, gambarnya dilayani CDN dan di-cache browser.
//
// pathname disimpan terpisah dari url karena penghapusan berkas di Vercel Blob
// memakai pathname, sedangkan <img src> memakai url lengkap.
//
// urutan: makin kecil makin depan, diberi jarak 10 antar foto supaya
// penyisipan di tengah tidak memaksa penomoran ulang seluruh baris.
async function ensureGaleriTable() {
  if (galeriInitialized) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS galeri (
      id BIGSERIAL PRIMARY KEY,
      url TEXT NOT NULL,
      pathname TEXT NOT NULL,
      keterangan TEXT,
      urutan INTEGER NOT NULL DEFAULT 0,
      created_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS idx_galeri_urutan ON galeri(urutan, id);
  `);
  galeriInitialized = true;
}

let kpiInitialized = false;

// KPI 18.2 Ukur Debit (apps/kpi-sab/ukur-debit.html). Real per sumur per bulan
// datang langsung dari sumur_debit_readings (tabel yang sama dipakai apps/
// library) -- yang disimpan di sini cuma dua hal yang TIDAK ada di sana:
//
// - kpi_debit_awal: kapasitas pompa per sumur. Nyaris tidak pernah berubah,
//   jadi disimpan per (installation, well_name) -- bukan per bulan/tahun --
//   supaya sekali diedit admin, berlaku terus untuk tahun-tahun berikutnya.
// - kpi_ukur_debit_meta: Keterangan & Penandatangan, yang di file Excel asli
//   memang beda tiap blok 6 bulan (kadang tanggal tanda tangan beda). Disimpan
//   per period_key ('<tahun>-1' untuk Jan-Jun, '<tahun>-2' untuk Jul-Des) supaya
//   tiap blok punya catatan sendiri, tapi tahun baru otomatis mulai kosong
//   (bukan mewarisi keterangan tahun lama yang mungkin sudah tidak relevan).
//
// INSERT seed di bawah pakai nama sumur PERSIS seperti yang sudah ada di
// sumur_wells (dicek manual dari data asli, bukan ditebak) -- kalau nanti ada
// sumur baru/berganti nama, baris itu otomatis TIDAK dapat nilai awal (NULL)
// dan admin tinggal isi sekali lewat halaman KPI, tidak perlu migrasi lagi.
async function ensureKpiTables() {
  if (kpiInitialized) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS kpi_debit_awal (
      installation TEXT NOT NULL,
      well_name TEXT NOT NULL,
      debit_awal NUMERIC NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (installation, well_name)
    );

    CREATE TABLE IF NOT EXISTS kpi_ukur_debit_meta (
      period_key TEXT PRIMARY KEY,
      keterangan JSONB NOT NULL DEFAULT '[]',
      sign_place_date TEXT,
      role_left TEXT,
      name_left TEXT,
      role_right TEXT,
      name_right TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- KPI 18.3a Monitoring Debit AP & ATD (apps/kpi-sab/apatd.html). Beda
    -- dengan kpi_ukur_debit_meta di atas -- laporan ini tidak punya angka
    -- yang perlu diedit admin sama sekali (Real-nya langsung dari
    -- air_permukaan/air_tanah_dalam, diisi lewat apps/input-air-baku.html
    -- yang sudah ada), jadi cuma perlu tabel meta sendiri (Keterangan &
    -- Penandatangan beda kata: "Mengetahui" / "Direkap oleh", bukan
    -- "Mengetahui/Menyetujui :" / "Dibuat oleh" seperti 18.2).
    CREATE TABLE IF NOT EXISTS kpi_apatd_meta (
      period_key TEXT PRIMARY KEY,
      keterangan JSONB NOT NULL DEFAULT '[]',
      role_left TEXT,
      name_left TEXT,
      role_right TEXT,
      name_right TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- KPI 18.3b Pengambilan Air Baku (apps/kpi-sab/pengambilan.html). Realisasi
    -- per bulan = total AP / total ATD, sama seperti JUMLAH di 18.3a APATD
    -- (dihitung ulang dari air_permukaan/air_tanah_dalam, bukan disimpan
    -- sendiri di sini). Anggaran-nya BEDA dari 18.2/18.3a -- bukan angka tetap
    -- per baris, tapi aturan "jumlah hari dalam bulan itu -> nilai anggaran",
    -- jadi disimpan per day_count (31/30/29/28), BUKAN per bulan/tahun --
    -- sekali admin isi 4 nilai ini (untuk AP & ATD), berlaku otomatis untuk
    -- semua bulan & tahun ke depan yang punya jumlah hari sama. Sengaja SATU
    -- set nilai untuk sepanjang tahun (bukan beda per semester Jan-Jun/Jul-Des
    -- seperti di file Excel lama) -- pilihan user waktu fitur ini dibuat.
    CREATE TABLE IF NOT EXISTS kpi_pengambilan_target (
      day_count INTEGER PRIMARY KEY,
      ap_value NUMERIC,
      atd_value NUMERIC,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS kpi_pengambilan_meta (
      period_key TEXT PRIMARY KEY,
      keterangan JSONB NOT NULL DEFAULT '[]',
      role_left TEXT,
      name_left TEXT,
      role_right TEXT,
      name_right TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- KPI 18.4 Laporan Kualitas Air Baku (apps/kpi-sab/kualitas.html). Level/
    -- NTU/PH bulanan dihitung ulang dari manggar_level_curahhujan/
    -- kualitas_air_manggar_teritip/teritip_level (rata-rata harian per bulan),
    -- status pintu elevasi dari kualitas_pintu_elevasi -- keduanya TIDAK
    -- disimpan di sini. Cuma Keterangan & Penandatangan (global, pola sama
    -- persis kpi_apatd_meta/kpi_pengambilan_meta).
    CREATE TABLE IF NOT EXISTS kpi_kualitas_meta (
      period_key TEXT PRIMARY KEY,
      keterangan JSONB NOT NULL DEFAULT '[]',
      role_left TEXT,
      name_left TEXT,
      role_right TEXT,
      name_right TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- KPI 19.2 Evaluasi Hasil Monitoring (apps/kpi-sab/monitoring.html).
    -- Beda dari KPI lain -- laporan ini tidak menyimpan angka apa pun: isi
    -- KETERANGAN-nya diambil OTOMATIS dari tabel pekerjaan (berita acara,
    -- bidang transmisi / service-sumur) sesuai rentang tanggal tiap bulan.
    -- Cuma Keterangan & Penandatangan (global, pola sama persis
    -- kpi_apatd_meta/kpi_kualitas_meta). Labelnya beda: "Mengetahui/
    -- Menyetujui" (kiri) & "Dibuat Oleh" (kanan) -- lihat kpi.js.
    CREATE TABLE IF NOT EXISTS kpi_192_meta (
      period_key TEXT PRIMARY KEY,
      keterangan JSONB NOT NULL DEFAULT '[]',
      role_left TEXT,
      name_left TEXT,
      role_right TEXT,
      name_right TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- KPI 18.1a Pengukuran Level Sumur (apps/kpi-sab/level-sumur.html). Beda
    -- dari 18.2 -- laporan ini cuma MENGHITUNG jumlah sumur: ANGG (anggaran)
    -- = jumlah sumur aktif (sumur_wells, category 'level'), REAL = jumlah
    -- sumur yang terukur (punya data statis ATAU dinamis di bulan itu, dari
    -- sumur_level_readings). Keduanya dihitung ulang dari tabel sumber, TIDAK
    -- disimpan di sini. Cuma Keterangan & Penandatangan (global, pola sama
    -- persis KPI lain). Labelnya: "Mengetahui/Menyetujui :" (kiri) &
    -- "Di buat oleh :" (kanan) -- lihat kpi.js.
    CREATE TABLE IF NOT EXISTS kpi_18_1a_meta (
      period_key TEXT PRIMARY KEY,
      keterangan JSONB NOT NULL DEFAULT '[]',
      role_left TEXT,
      name_left TEXT,
      role_right TEXT,
      name_right TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- KPI 18.1b Pengukuran Statis-Dinamis (apps/kpi-sab/statis-dinamis.html).
    -- Laporan nilai level statis (SWL) & dinamis (DWL) per sumur per bulan,
    -- langsung dari sumur_level_readings (data TIDAK disimpan di sini). Daftar
    -- sumurnya = sumur AKTIF di 18.1a (sumur_wells active=true, category
    -- 'level'), nama tampilannya memakai label dari file 18.1B. Cuma Catatan
    -- & Penandatangan (global). Label: "Mengetahui/ Menyetujui" (kiri) &
    -- "Dibuat oleh" (kanan).
    CREATE TABLE IF NOT EXISTS kpi_18_1b_meta (
      period_key TEXT PRIMARY KEY,
      keterangan JSONB NOT NULL DEFAULT '[]',
      role_left TEXT,
      name_left TEXT,
      role_right TEXT,
      name_right TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- KPI 18.5 Monitoring Kondisi Peralatan (apps/kpi-sab/peralatan.html).
    -- BEDA dari KPI lain -- laporan ini TIDAK mengambil angka dari tabel
    -- sumber: ANGG (anggaran jumlah alat) & REAL (jumlah alat terpantau) diisi
    -- MANUAL oleh admin lewat halaman ini, disimpan per bulan (periode
    -- 'YYYY-MM') per item (item_no 1-5). ± & % dihitung otomatis
    -- (REAL-ANGG, REAL/ANGG*100). Tahun laporan mengikuti TEMPLATE (tahun
    -- fiskal): blok 1 = Juli-Desember tahun terpilih, blok 2 = Januari-Juni
    -- tahun berikutnya. Keterangan & Penandatangan global (kpi_18_5_meta).
    CREATE TABLE IF NOT EXISTS kpi_18_5_monitoring (
      periode TEXT NOT NULL,
      item_no INTEGER NOT NULL,
      angg NUMERIC,
      real NUMERIC,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (periode, item_no)
    );

    CREATE TABLE IF NOT EXISTS kpi_18_5_meta (
      period_key TEXT PRIMARY KEY,
      keterangan JSONB NOT NULL DEFAULT '[]',
      role_left TEXT,
      name_left TEXT,
      role_right TEXT,
      name_right TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- KPI 18.6 Jadwal PM Terkendali (apps/kpi-sab/jadwal-pm.html). Laporan
    -- jadwal PM (pemeliharaan) per bulan: tanggal Rencana & Realisasi untuk
    -- item monitoring yang SAMA dengan 19.2 (pipa transmisi & service sumur).
    -- Datanya dihitung ulang dari 19.2 (lihat kpi.js): Renc = tanggal jadwal
    -- (Selasa/Senin minggu ke-2/4), Real = tanggal jadwal kalau ada berita
    -- acara di bulan itu, "-" kalau belum ada. Tahun fiskal mengikuti template:
    -- blok 1 = Januari-Juni tahun terpilih, blok 2 = Juli-Desember tahun
    -- sebelumnya. Cuma Penandatangan (global) -- laporan ini tanpa blok
    -- Keterangan.
    CREATE TABLE IF NOT EXISTS kpi_18_6_meta (
      period_key TEXT PRIMARY KEY,
      keterangan JSONB NOT NULL DEFAULT '[]',
      role_left TEXT,
      name_left TEXT,
      role_right TEXT,
      name_right TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- Activity Plan SAB (apps/kpi-sab/activity-plan.html) -- dashboard tahunan
    -- rekap KPI Sub Divisi Sumber Air Baku (mengikuti Activity Plan SAB.xlsx).
    -- Nilai Progres per bulan: untuk 18.1a/18.2/18.3b otomatis dihitung dari
    -- laporan KPI terkait, untuk lainnya manual (default 100), grup 18/19
    -- rata-rata dari itemnya. Yang disimpan di sini cuma kolom manual per item:
    -- target, check_timing, status (bisa di-override; default TCP/TDTCP dihitung
    -- dari % vs target), trend, problem, corrective, pic, due_date, progres, dan
    -- values (JSON per indeks bulan 0-11: 0-5 = Jan-Jun, 6-11 = Jul-Des, untuk
    -- item manual).
    CREATE TABLE IF NOT EXISTS kpi_activity_plan (
      item_key TEXT PRIMARY KEY,
      target TEXT,
      check_timing TEXT,
      status TEXT,
      trend TEXT,
      problem TEXT,
      corrective TEXT,
      pic TEXT,
      due_date TEXT,
      progres TEXT,
      values JSONB,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- Nama pejabat penandatangan Activity Plan SAB (Approved / Checked /
    -- Prepared). Disimpan per period_key ('<tahun>-1' untuk Jan-Jun,
    -- '<tahun>-2' untuk Jul-Des) supaya tiap periode punya catatan sendiri,
    -- pola sama dengan tabel meta KPI lain (kpi_ukur_debit_meta, dst.).
    CREATE TABLE IF NOT EXISTS kpi_activity_plan_meta (
      period_key TEXT PRIMARY KEY,
      approved TEXT,
      checked TEXT,
      prepared TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- Jadwal Kegiatan (apps/kpi-sab/jadwal-kegiatan.html). Beda dari KPI lain --
    -- dokumen ini TIDAK menyimpan angka apa pun: kolom tanggal/hari kerja dan
    -- tanda √ dihitung OTOMATIS dari kalender bulan yang dipilih (lihat kpi.js).
    -- Yang disimpan di sini cuma nilai yang diedit manual & berlaku global:
    -- Keterangan tiap baris kegiatan (6 item, default mengikuti file contoh
    -- "01. Jadwal Kegiatan.xlsx": baris 5 "Perawatan Sumur Kondisional", baris
    -- 6 "Per 3 bulan"), pejabat penandatangan TIGA kolom (Mengetahui / Menyetujui,
    -- Diketahui / Disetujui, Dibuat Oleh), dan kode dokumen footer (default
    -- "PTMBPP-IP-PRD.SAB/01-01"). Tanggal tanda tangan TIDAK disimpan -- selalu
    -- dihitung ulang ke tanggal hari ini, pola sama seperti KPI lain.
    CREATE TABLE IF NOT EXISTS kpi_jadwal_kegiatan_meta (
      period_key TEXT PRIMARY KEY,
      keterangan JSONB NOT NULL DEFAULT '[]',
      role_left TEXT,
      name_left TEXT,
      role_mid TEXT,
      name_mid TEXT,
      role_right TEXT,
      name_right TEXT,
      footer_code TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    INSERT INTO kpi_debit_awal (installation, well_name, debit_awal) VALUES
      ('gunung_sari', 'SUMUR 01 DALAM IPA', 21),
      ('gunung_sari', 'SUMUR 02 DALAM IPA', 77),
      ('gunung_sari', 'SUMUR 03 DALAM IPA', 95),
      ('gunung_sari', 'SUMUR 04 DALAM IPA', 95),
      ('gunung_sari', 'SUMUR 05 RESERVOAR LAMA', 60),
      ('gunung_sari', 'SUMUR 06 TELAGA SARI', 95),
      ('gunung_sari', 'SUMUR 07 MARTHADINATA', 95),
      ('kampung_damai', 'SUMUR 01 PARKIRAN IPA', 46),
      ('kampung_damai', 'SUMUR 02 GAS CHLOR', 60),
      ('kampung_damai', 'SUMUR 03 TERMINAL TANGKI', 46),
      ('kampung_damai', 'SUMUR 05 PENGGALANG', 77),
      ('prapatan', 'SUMUR 01 PUSKESMAS', 95),
      ('prapatan', 'SUMUR 02 DALAM IPA', 95),
      ('prapatan', 'SUMUR 03 JL PAHALA', 60),
      ('zamp', 'SUMUR 02 JL BELIBIS V', 10),
      ('zamp', 'SUMUR 03 KOPERASI PTMB', 30),
      ('kampung_baru_ulu', 'SUMUR 01 DALAM AREA IPA', 60),
      ('kampung_baru_ulu', 'SUMUR 02 SMA 3', 10),
      ('kampung_baru_ulu', 'SUMUR 03 KANTOR LPM', 46)
    ON CONFLICT (installation, well_name) DO NOTHING;
  `);
  kpiInitialized = true;
}

module.exports = { pool, ensureTable, ensureUsersTable, ensureVizTables, ensureSignersTable, ensureSpdTables, ensurePekerjaanTable, ensureGaleriTable, ensureKpiTables };
