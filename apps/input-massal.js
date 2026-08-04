/* =============================================================================
   INPUT MASSAL — tab tambahan di apps/input-data-historis.html
   =============================================================================

   Alasan ada: sumber datanya spreadsheet sub-divisi lain, dan sebelum ini
   angkanya diketik ulang satu per satu ke form harian (1 tanggal = 1 siklus
   pilih tanggal -> isi -> Simpan -> tunggu). Di sini cukup Ctrl+V satu blok
   dari Excel.

   Sengaja BERDIRI SENDIRI, tidak mengubah apa pun dari form lama: form
   satu-per-satu tetap jadi cara input yang sah (lebih enak buat 1-2 angka
   susulan), tab ini buat borongan. Sentuhan ke input-data-historis.html cuma
   tiga baris: satu <script>, satu entri di GROUPS, satu cabang di renderAll().

   Aturan yang paling penting dipegang di sini: SEL KOSONG TIDAK MENGHAPUS
   APA PUN. Level & Curah Hujan Manggar diisi orang lain lebih dulu, NTU & PH
   menyusul di tanggal yang sama -- jadi tempelan yang cuma berisi kolom
   NTU/PH harus membiarkan Level & Curah Hujan hari itu utuh. Dipaksakan dua
   lapis: di sini sel kosong tidak pernah ikut dikirim, dan di server pakai
   COALESCE (lihat action=bulk di api/visualization/admin-library.js).
   ========================================================================== */
(function () {
  'use strict';

  // --- Definisi tujuan input -------------------------------------------------
  // key field harian = key DATASETS di lib/visualization/columns.js (dipakai
  // apa adanya oleh endpoint bulk); histKey = key pendek yang dipakai
  // action=daily-history, dipakai buat membandingkan dengan data lama.
  // `wajar` = rentang yang masuk akal untuk besaran itu. Di luar rentang
  // TIDAK ditolak (data lapangan memang kadang ekstrem), cuma ditandai --
  // gunanya menangkap kesalahan yang mahal: kolom pH tertempel ke slot NTU,
  // atau angka level yang kelebihan satu digit.
  var TARGETS = {
    manggar: {
      label: 'Waduk Manggar', jenis: 'harian', group: 'manggar',
      fields: [
        { key: 'manggar_level', histKey: 'level', label: 'Level', unit: 'm', wajar: [0, 20],
          sinonim: ['level', 'levelwadukmanggarm', 'levelwaduk', 'tma', 'elevasi', 'tinggimukaair'] },
        { key: 'manggar_hujan', histKey: 'hujan', label: 'Curah Hujan', unit: 'mm', wajar: [0, 500],
          sinonim: ['hujan', 'curahhujan', 'curahhujanmm', 'ch', 'rainfall'] },
        { key: 'manggar_ntu',   histKey: 'ntu',   label: 'Kekeruhan', unit: 'NTU', wajar: [0, 2000],
          sinonim: ['ntu', 'ntumanggar', 'kekeruhan', 'turbidity'] },
        { key: 'manggar_ph',    histKey: 'ph',    label: 'pH', unit: 'pH', wajar: [0, 14],
          sinonim: ['ph', 'phmanggar', 'phairbaku', 'derajatkeasaman'] }
      ]
    },
    teritip: {
      label: 'Waduk Teritip', jenis: 'harian', group: 'teritip',
      fields: [
        { key: 'teritip_level', histKey: 'level', label: 'Level', unit: 'm', wajar: [0, 15],
          sinonim: ['level', 'levelwadukteritipm', 'levelwaduk', 'tma', 'elevasi', 'tinggimukaair'] },
        { key: 'teritip_ntu',   histKey: 'ntu',   label: 'Kekeruhan', unit: 'NTU', wajar: [0, 2000],
          sinonim: ['ntu', 'ntuteritip', 'kekeruhan', 'turbidity'] },
        { key: 'teritip_ph',    histKey: 'ph',    label: 'pH', unit: 'pH', wajar: [0, 14],
          sinonim: ['ph', 'phteritip', 'phairbaku', 'derajatkeasaman'] }
      ]
    },
    sumur: { label: 'Sumur Dalam', jenis: 'sumur' }
  };

  var WAJAR_SUMUR = { debit: [0, 500], statis: [0, 200], dinamis: [0, 200] };

  function diLuarWajar(rentang, nilai) {
    return !!rentang && (nilai < rentang[0] || nilai > rentang[1]);
  }

  var SUMUR_LOCATIONS = [
    { key: 'gunung_sari',      label: 'IPA Gunung Sari' },
    { key: 'kampung_damai',    label: 'IPA Kampung Damai' },
    { key: 'teritip',          label: 'IPA Teritip' },
    { key: 'gunung_tembak',    label: 'IPA Gunung Tembak' },
    { key: 'prapatan',         label: 'IPA Prapatan' },
    { key: 'zamp',             label: 'IPA Zamp' },
    { key: 'kampung_baru_ulu', label: 'IPA Kampung Baru Ulu' }
  ];

  var CHUNK = 300; // baris per kiriman; server membatasi 500

  // --- State modul (bertahan saat pindah tab lalu balik lagi) ---------------
  var state = {
    target: 'manggar',
    installation: 'gunung_sari',
    category: 'debit',
    grid: [],          // isi tabel, satu larik per baris (tanpa baris judul)
    adaJudul: false,
    mapping: [],       // arti tiap kolom: '' | 'tanggal' | 'bulan' | <fieldKey> | 'well:<nama>:<statis|dinamis|->'
    wells: [],
    existing: null,    // Map tanggal/bulan -> nilai lama
    periode: '',       // 'YYYY-MM' untuk harian, 'YYYY' untuk sumur
    adaSuntingan: false, // ada ketikan/tempelan yang belum disimpan
    pesan: ''
  };

  // ==========================================================================
  // PARSER
  // ==========================================================================

  // Pemisah kolom SELALU tab, tidak pernah ditebak. Satu-satunya sumber data
  // di sini adalah papan klip, dan Excel/Sheets/LibreOffice semuanya menaruh
  // TSV di papan klip. Penebakan pemisah justru berbahaya untuk angka gaya
  // Indonesia: menempel satu kolom berisi "9,63" akan terbaca berpemisah koma
  // dan pecah jadi 9 dan 63, diam-diam, tanpa tanda apa pun.
  var PEMISAH = '\t';

  // TSV dengan dukungan tanda kutip -- sel teks yang mengandung tab akan
  // terbungkus kutip oleh Excel, tanpa ini kolomnya bergeser.
  function parseDelimited(teks, sep) {
    var rows = [], row = [], cell = '', dalamKutip = false, i = 0;
    teks = teks.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    while (i < teks.length) {
      var c = teks[i];
      if (dalamKutip) {
        if (c === '"') {
          if (teks[i + 1] === '"') { cell += '"'; i += 2; continue; }
          dalamKutip = false; i++; continue;
        }
        cell += c; i++; continue;
      }
      if (c === '"' && cell === '') { dalamKutip = true; i++; continue; }
      if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i++; continue; }
      if (teks.substr(i, sep.length) === sep) { row.push(cell); cell = ''; i += sep.length; continue; }
      cell += c; i++;
    }
    row.push(cell);
    rows.push(row);
    return rows
      .map(function (r) { return r.map(function (c) { return c.trim(); }); })
      .filter(function (r) { return r.some(function (c) { return c !== ''; }); });
  }

  // Angka gaya Indonesia ikut diterima: "10,42" (desimal koma) dan "1.234,5"
  // (titik ribuan). Titik sendirian selalu dibaca sebagai desimal -- semua
  // besaran di sini (level ~10 m, NTU ~9, debit ~60) tidak pernah menyentuh
  // ribuan, jadi "1.234" jauh lebih mungkin berarti 1,234.
  function parseAngka(mentah) {
    if (mentah === null || mentah === undefined) return null;
    var s = String(mentah).trim();
    if (s === '' || s === '-' || s === '–' || s === '—' || /^n\/?a$/i.test(s)) return null;

    // Ambil angka HANYA kalau selnya memang diawali angka, dan sisanya cuma
    // satuan ("9,63 NTU", "10.42 m", "12%"). Tanpa syarat ini, judul kolom
    // seperti "Sumur_01_Dalam_IPA" ikut terbaca sebagai angka 1 -- yang bikin
    // baris judul disangka baris data.
    var m = s.match(/^[+-]?[\d.,]+/);
    if (!m) return null;
    if (/\d/.test(s.slice(m[0].length))) return null;
    s = m[0];

    var adaKoma = s.indexOf(',') >= 0, adaTitik = s.indexOf('.') >= 0;
    if (adaKoma && adaTitik) {
      if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.');
      else s = s.replace(/,/g, '');
    } else if (adaKoma) {
      s = s.replace(',', '.');
    }
    s = s.replace(/[^0-9.\-]/g, '');
    if (s === '' || s === '-' || s === '.') return null;
    var n = Number(s);
    return isFinite(n) ? n : null;
  }

  var BULAN_PANJANG = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
                       'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

  var BULAN_NAMA = {
    jan: 1, feb: 2, peb: 2, mar: 3, apr: 4, mei: 5, may: 5, jun: 6, jul: 7,
    agu: 8, ags: 8, aug: 8, sep: 9, okt: 10, oct: 10, nov: 11, des: 12, dec: 12
  };

  function pad2(n) { return String(n).padStart(2, '0'); }

  function tanggalValid(y, m, d) {
    if (!(y >= 1900 && y <= 2100) || !(m >= 1 && m <= 12) || !(d >= 1 && d <= 31)) return false;
    var dt = new Date(y, m - 1, d);
    return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
  }

  // Serial Excel (angka hari sejak 1899-12-30) -- muncul kalau kolom tanggal
  // ditempel dari sel yang formatnya "General".
  function dariSerialExcel(n) {
    if (!(n > 20000 && n < 80000)) return null;
    var dt = new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400000);
    return dt.getUTCFullYear() + '-' + pad2(dt.getUTCMonth() + 1) + '-' + pad2(dt.getUTCDate());
  }

  // Urutan hari/bulan: "05/03/2026" dibaca 5 Maret (gaya Indonesia), kecuali
  // angka pertama > 12 sehingga cuma satu tafsiran yang mungkin.
  function parseTanggal(mentah) {
    if (mentah === null || mentah === undefined) return null;
    var s = String(mentah).trim();
    if (s === '') return null;

    var m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
    if (m) {
      var y = +m[1], bl = +m[2], d = +m[3];
      return tanggalValid(y, bl, d) ? y + '-' + pad2(bl) + '-' + pad2(d) : null;
    }

    m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
    if (m) {
      var a = +m[1], b = +m[2], th = +m[3];
      if (th < 100) th += th < 70 ? 2000 : 1900;
      var hari = a, bul = b;
      if (a <= 12 && b > 12) { hari = b; bul = a; } // jelas gaya Amerika
      return tanggalValid(th, bul, hari) ? th + '-' + pad2(bul) + '-' + pad2(hari) : null;
    }

    m = s.match(/^(\d{1,2})[\s-]+([A-Za-z]+)[\s-]+(\d{2,4})/);
    if (m) {
      var nb = BULAN_NAMA[m[2].slice(0, 3).toLowerCase()];
      var thn = +m[3];
      if (thn < 100) thn += thn < 70 ? 2000 : 1900;
      if (nb && tanggalValid(thn, nb, +m[1])) return thn + '-' + pad2(nb) + '-' + pad2(+m[1]);
      return null;
    }

    if (/^\d+(\.\d+)?$/.test(s)) return dariSerialExcel(Number(s));
    return null;
  }

  function parseBulan(mentah) {
    if (mentah === null || mentah === undefined) return null;
    var s = String(mentah).trim();
    if (s === '') return null;

    var m = s.match(/^(\d{4})[-/.](\d{1,2})$/);
    if (m && +m[2] >= 1 && +m[2] <= 12) return m[1] + '-' + pad2(+m[2]);

    m = s.match(/^(\d{1,2})[-/.](\d{4})$/);
    if (m && +m[1] >= 1 && +m[1] <= 12) return m[2] + '-' + pad2(+m[1]);

    m = s.match(/^([A-Za-z]+)[\s-]*(\d{2,4})$/);
    if (m) {
      var nb = BULAN_NAMA[m[1].slice(0, 3).toLowerCase()];
      var th = +m[2];
      if (th < 100) th += th < 70 ? 2000 : 1900;
      if (nb && th >= 1900 && th <= 2100) return th + '-' + pad2(nb);
    }

    var tgl = parseTanggal(s); // tanggal lengkap juga diterima, diambil bulannya
    return tgl ? tgl.slice(0, 7) : null;
  }

  // ==========================================================================
  // PENCOCOKAN JUDUL KOLOM
  // ==========================================================================
  function norm(s) { return String(s === null || s === undefined ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, ''); }

  // Samakan penomoran sumur yang beda zero-pad antara berkas debit
  // ("Sumur_01_Dalam_IPA") dan berkas level ("Sumur_1_Dalam_IPA").
  function kunciSumur(s) { return norm(s).replace(/sumur0*(\d+)/, function (_, d) { return 'sumur' + Number(d); }); }

  function pisahStatisDinamis(judul) {
    var m = String(judul).match(/^(.*?)[\s_\-]*(statis|dinamis)$/i);
    if (m) return { dasar: m[1], bagian: m[2].toLowerCase() };
    return { dasar: judul, bagian: null };
  }

  function nomorSumur(nama) {
    var m = String(nama).match(/(\d+)/);
    return m ? Number(m[1]) : null;
  }

  // Tebak arti tiap kolom dari baris judul. Hasilnya cuma usulan -- semua
  // dropdown tetap bisa diubah tangan, jadi salah tebak bukan jalan buntu.
  function tebakMapping(judul) {
    var t = TARGETS[state.target];
    var hasil = judul.map(function () { return ''; });
    var sudah = {};

    judul.forEach(function (h, i) {
      var n = norm(h);
      if (n === '') return;

      if (t.jenis === 'harian') {
        if (!sudah.tanggal && /^(tanggal|tgl|date|hari|waktu|periode)/.test(n)) { hasil[i] = 'tanggal'; sudah.tanggal = 1; return; }

        // Berkas kualitas air memuat Manggar DAN Teritip dalam satu tabel
        // ("NTU_Manggar, PH_Manggar, NTU_Teritip, PH_Teritip"). Tanpa
        // penjagaan ini, "NTU_Manggar" ikut tercocok ke slot NTU saat tab
        // yang aktif Teritip -- angka waduk yang satu masuk ke waduk yang
        // lain, kesalahan yang tidak akan kelihatan sampai grafiknya aneh.
        // Jadi: judul yang menyebut waduk LAIN langsung dilewati.
        var wadukLain = ['manggar', 'teritip'].filter(function (g) { return g !== t.group; });
        if (wadukLain.some(function (g) { return n.indexOf(g) >= 0; })) return;

        for (var f = 0; f < t.fields.length; f++) {
          var fld = t.fields[f];
          if (sudah[fld.key]) continue;
          if (fld.sinonim.indexOf(n) >= 0 || fld.sinonim.some(function (s) { return n.indexOf(s) === 0 || s.indexOf(n) === 0; })) {
            hasil[i] = fld.key; sudah[fld.key] = 1; return;
          }
        }
        return;
      }

      // Sumur: kolom pertama biasanya bulan, sisanya nama sumur.
      if (!sudah.bulan && /^(bulan|periode|month|tanggal|tgl|date)/.test(n)) { hasil[i] = 'bulan'; sudah.bulan = 1; return; }

      var pecah = state.category === 'level' ? pisahStatisDinamis(h) : { dasar: h, bagian: null };
      var kunci = kunciSumur(pecah.dasar);
      var cocok = state.wells.find(function (w) { return kunciSumur(w) === kunci; });
      if (!cocok && /^\d+$/.test(String(pecah.dasar).trim())) {
        var no = Number(pecah.dasar);
        cocok = state.wells.find(function (w) { return nomorSumur(w) === no; });
      }
      if (!cocok) return;

      if (state.category === 'debit') hasil[i] = 'well:' + cocok + ':-';
      else if (pecah.bagian) hasil[i] = 'well:' + cocok + ':' + pecah.bagian;
      else hasil[i] = 'well:' + cocok + ':statis'; // tanpa keterangan: anggap statis, bisa diubah
    });

    return hasil;
  }

  // Baris pertama dianggap judul kalau isinya bukan angka/tanggal semua.
  function deteksiAdaJudul(grid) {
    if (grid.length === 0) return true;
    var b = grid[0];
    var berisi = b.filter(function (c) { return c !== ''; });
    if (berisi.length === 0) return true;
    var angka = berisi.filter(function (c) { return parseAngka(c) !== null || parseTanggal(c) !== null; });
    return angka.length < berisi.length / 2;
  }

  // ==========================================================================
  // PENYUSUNAN BARIS SIAP KIRIM + PERBANDINGAN DENGAN DATA LAMA
  // ==========================================================================
  function samaAngka(a, b) {
    if (a === null || a === undefined || b === null || b === undefined) return false;
    return Math.abs(Number(a) - Number(b)) < 1e-9;
  }

  // Tabel selalu menyisakan baris kosong di bawah supaya enak diketik --
  // baris itu tidak ikut dinilai, kalau tidak pratinjau akan penuh "baris
  // ditolak" palsu. Nomor baris asli dibawa serta supaya pesan penolakan
  // menunjuk ke baris yang benar-benar terlihat di tabel.
  function barisTerisi() {
    var out = [];
    state.grid.forEach(function (r, i) {
      if (r.some(function (c) { return String(c === undefined ? '' : c).trim() !== ''; })) {
        out.push({ sel: r, no: i + 1 });
      }
    });
    return out;
  }

  function susunHarian() {
    var t = TARGETS[state.target];
    var idxTanggal = state.mapping.indexOf('tanggal');
    var kolomField = [];
    state.mapping.forEach(function (m, i) {
      var fld = t.fields.find(function (f) { return f.key === m; });
      if (fld) kolomField.push({ i: i, fld: fld });
    });

    var baris = [];
    barisTerisi().forEach(function (x) {
      var r = x.sel;
      var tgl = idxTanggal >= 0 ? parseTanggal(r[idxTanggal]) : null;
      var nilai = {}, adaIsi = false;
      kolomField.forEach(function (k) {
        var v = parseAngka(r[k.i]);
        if (v !== null) { nilai[k.fld.key] = v; adaIsi = true; }
      });

      // Baris yang cuma berisi tanggal (bawaan periode, belum diisi angka)
      // dilewati diam-diam -- bukan kesalahan, memang belum ada datanya.
      if (!adaIsi) return;

      var alasan = null;
      if (idxTanggal < 0) alasan = 'Kolom tanggal belum ditentukan';
      else if (!tgl) alasan = 'Tanggal tidak terbaca: "' + (r[idxTanggal] || '') + '"';

      baris.push({ no: x.no, kunci: tgl, mentahKunci: idxTanggal >= 0 ? r[idxTanggal] : '', nilai: nilai, alasan: alasan });
    });
    return { baris: baris, kolomField: kolomField };
  }

  function susunSumur() {
    var idxBulan = state.mapping.indexOf('bulan');
    var kolomWell = [];
    state.mapping.forEach(function (m, i) {
      if (typeof m === 'string' && m.indexOf('well:') === 0) {
        var p = m.split(':');
        kolomWell.push({ i: i, well: p[1], bagian: p[2] });
      }
    });

    var baris = [];
    barisTerisi().forEach(function (x) {
      var r = x.sel;
      var bln = idxBulan >= 0 ? parseBulan(r[idxBulan]) : null;
      var nilai = {}, adaIsi = false;
      kolomWell.forEach(function (k) {
        var v = parseAngka(r[k.i]);
        if (v === null) return;
        if (state.category === 'debit') { nilai[k.well] = v; adaIsi = true; }
        else {
          if (!nilai[k.well]) nilai[k.well] = { statis: null, dinamis: null };
          nilai[k.well][k.bagian === 'dinamis' ? 'dinamis' : 'statis'] = v;
          adaIsi = true;
        }
      });

      if (!adaIsi) return;

      var alasan = null;
      if (idxBulan < 0) alasan = 'Kolom bulan belum ditentukan';
      else if (!bln) alasan = 'Bulan tidak terbaca: "' + (r[idxBulan] || '') + '"';

      baris.push({ no: x.no, kunci: bln, mentahKunci: idxBulan >= 0 ? r[idxBulan] : '', nilai: nilai, alasan: alasan });
    });
    return { baris: baris, kolomWell: kolomWell };
  }

  // ==========================================================================
  // AMBIL DATA LAMA (untuk pratinjau)
  // ==========================================================================
  function authHeaders() {
    var token = localStorage.getItem('token');
    return token ? { Authorization: 'Bearer ' + token } : {};
  }

  async function muatExisting() {
    state.existing = null;
    var t = TARGETS[state.target];
    try {
      if (t.jenis === 'harian') {
        var res = await fetch('/api/visualization/admin-library?action=daily-history&group=' + t.group, { headers: authHeaders() });
        var data = await res.json();
        if (!res.ok) throw new Error(data.error || 'HTTP ' + res.status);
        var peta = new Map();
        (data.rows || []).forEach(function (r) { peta.set(r.tanggal, r.values); });
        state.existing = peta;
      } else {
        var params = new URLSearchParams({ installation: state.installation, category: state.category });
        var r2 = await fetch('/api/visualization/admin-library?action=sumur-history&' + params.toString(), { headers: authHeaders() });
        var d2 = await r2.json();
        if (!r2.ok) throw new Error(d2.error || 'HTTP ' + r2.status);
        var peta2 = new Map();
        (d2.rows || []).forEach(function (r) { peta2.set(r.bulan, r.values); });
        state.existing = peta2;
      }
    } catch (err) {
      state.existing = null; // pratinjau tetap jalan, cuma tanpa penanda "timpa"
    }
  }

  async function muatWells() {
    var params = new URLSearchParams({ installation: state.installation, category: state.category });
    var res = await fetch('/api/visualization/admin-library?action=wells&' + params.toString(), { headers: authHeaders() });
    var data = await res.json();
    if (!res.ok) throw new Error(data.error || 'HTTP ' + res.status);
    state.wells = data.wells || [];
  }

  // ==========================================================================
  // GAYA (disuntik sekali, tidak menyentuh <style> halaman)
  // ==========================================================================
  function pasangGaya() {
    if (document.getElementById('imStyle')) return;
    var s = document.createElement('style');
    s.id = 'imStyle';
    s.textContent = [
      '.im-step{margin-bottom:20px}',
      '.im-step-title{font-family:"Space Grotesk",sans-serif;font-size:13px;font-weight:700;color:var(--primary);margin-bottom:8px;display:flex;align-items:center;gap:8px}',
      '.im-step-num{display:inline-grid;place-items:center;width:20px;height:20px;border-radius:50%;background:var(--primary);color:#fff;font-size:11px}',
      '.im-target-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px}',
      '.im-target-row select{padding:8px 10px;border:1px solid var(--line-muted);border-radius:9px;font-size:13px;font-family:"Inter",sans-serif;background:#fff;color:var(--ink)}',
      '.im-hint{font-size:12.5px;color:var(--ink-soft);margin:0 0 10px;line-height:1.55}',
      '.im-periode-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}',
      '.im-periode-row input,.im-periode-row select{padding:9px 11px;border:1px solid var(--line-muted);border-radius:9px;font-size:14px;font-family:"IBM Plex Mono",monospace;font-weight:600;color:var(--primary);background:#fff}',
      '.im-periode-info{font-size:12.5px;color:var(--ink-soft);margin:8px 0 0;line-height:1.55}',

      // Tabel isian. Judul kolomnya berupa menu pilihan, jadi kolom bisa
      // ditukar artinya tanpa langkah terpisah.
      '.im-grid-wrap{border:1px solid var(--line-muted);border-radius:10px;overflow:auto;max-height:460px;background:#fff}',
      '.im-grid{border-collapse:separate;border-spacing:0;width:100%}',
      '.im-grid thead th{position:sticky;top:0;z-index:2;background:var(--primary-pale);padding:6px;border-bottom:1px solid var(--line-muted);white-space:nowrap}',
      '.im-grid thead th select{width:100%;min-width:130px;padding:6px 7px;border:1px solid var(--line-muted);border-radius:7px;font-size:12px;font-family:"Space Grotesk",sans-serif;font-weight:600;background:#fff;color:var(--primary)}',
      '.im-grid th.im-rownum,.im-grid td.im-rownum{width:34px;min-width:34px;text-align:right;padding:0 8px;background:#F4F9FA;color:var(--ink-soft);font-size:10.5px;font-family:"IBM Plex Mono",monospace;position:sticky;left:0;z-index:1;border-right:1px solid var(--line-muted)}',
      '.im-grid thead th.im-rownum{z-index:3}',
      '.im-grid td{padding:0;border-bottom:1px solid #EDF3F4}',
      '.im-cell{width:100%;min-width:110px;border:none;padding:7px 9px;font-family:"IBM Plex Mono",monospace;font-size:12.5px;color:var(--ink);background:transparent}',
      '.im-cell:focus{outline:2px solid var(--primary-light);outline-offset:-2px;background:#F7FDFD}',
      '.im-cell:disabled{background:#F4F6F7;color:var(--ink-soft)}',
      '.im-summary{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px}',
      '.im-badge{font-family:"Space Grotesk",sans-serif;font-size:12px;font-weight:700;padding:6px 12px;border-radius:999px}',
      '.im-badge.baru{background:#E3F5EA;color:#1E6E45}',
      '.im-badge.timpa{background:#FBF1DE;color:#8A6314}',
      '.im-badge.tolak{background:#FBE4DA;color:#B5502E}',
      '.im-badge.sama{background:#EEF3F4;color:var(--ink-soft)}',
      '.im-badge.aneh{background:#F3EAFB;color:#6B3FA0}',
      '.im-cell-aneh{outline:1.5px dashed #B07ED8;outline-offset:-2px}',
      '.im-prev-wrap{border:1px solid var(--line-muted);border-radius:10px;overflow:auto;max-height:420px}',
      '.im-prev{width:100%;border-collapse:collapse;font-size:12px}',
      '.im-prev thead th{position:sticky;top:0;text-align:left;font-family:"Space Grotesk",sans-serif;font-size:10px;text-transform:uppercase;letter-spacing:.03em;color:var(--ink-soft);background:var(--primary-pale);padding:7px 9px;white-space:nowrap;z-index:1}',
      '.im-prev tbody td{padding:6px 9px;border-top:1px solid var(--line-muted);white-space:nowrap;font-family:"IBM Plex Mono",monospace}',
      '.im-prev tbody td.key{font-weight:600;color:var(--primary);font-family:"IBM Plex Mono",monospace}',
      '.im-prev tbody tr.row-tolak{background:#FDF3EF}',
      '.im-prev tbody tr.row-tolak td{color:#B5502E}',
      '.im-cell-baru{background:#EEF9F2;color:#1E6E45}',
      '.im-cell-timpa{background:#FDF6E7;color:#8A6314}',
      '.im-cell-sama{color:var(--ink-soft)}',
      '.im-cell-lama{font-size:10px;opacity:.75;margin-right:4px;text-decoration:line-through}',
      '.im-note{font-size:11.5px;color:var(--ink-soft);background:var(--primary-pale);border-radius:8px;padding:9px 11px;line-height:1.55;margin-top:10px}',
      '.im-alert{font-size:12.5px;border-radius:9px;padding:10px 12px;margin-bottom:10px;line-height:1.5}',
      '.im-alert.warn{background:#FBF1DE;color:#8A6314;border:1px solid #EFDCB4}',
      '.im-alert.err{background:#FBE4DA;color:#B5502E;border:1px solid #F3C9AE}',
      '.im-alert.ok{background:#E3F5EA;color:#1E6E45;border:1px solid #B8E0C8}',
      '.im-progress{font-size:12px;color:var(--ink-soft);font-family:"Space Grotesk",sans-serif;font-weight:600}'
    ].join('\n');
    document.head.appendChild(s);
  }

  // ==========================================================================
  // RENDER
  // ==========================================================================
  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function fmtTanggalID(iso) {
    var M = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
    var p = iso.split('-');
    return Number(p[2]) + ' ' + M[Number(p[1]) - 1] + ' ' + p[0];
  }
  function fmtBulanID(ym) {
    var p = ym.split('-');
    return BULAN_PANJANG[Number(p[1]) - 1] + ' ' + p[0];
  }

  // "pH" satuannya juga "pH" -- jangan sampai keluar "pH (pH)".
  function judulField(f) { return f.label === f.unit ? f.label : f.label + ' (' + f.unit + ')'; }

  function opsiTujuan() {
    return Object.keys(TARGETS).map(function (k) {
      return '<option value="' + k + '"' + (state.target === k ? ' selected' : '') + '>' + esc(TARGETS[k].label) + '</option>';
    }).join('');
  }

  // ==========================================================================
  // GRID — kolomnya sudah berlabel sesuai tujuan, jadi tidak ada lagi langkah
  // "cocokkan kolom" tersendiri: judul tiap kolom ITU SENDIRI menu pilihannya.
  // Yang perlu dilakukan cuma klik satu sel lalu Ctrl+V.
  //
  // Jumlah barisnya dikunci persis sebanyak tanggal di periode yang dipilih --
  // tidak ada baris cadangan, tidak ada tombol tambah baris. Setiap baris
  // selalu punya tanggal yang sah, jadi tidak mungkin ada data nyasar ke
  // tanggal yang tidak ada.
  // ==========================================================================
  function kolomBawaan() {
    var t = TARGETS[state.target];
    if (t.jenis === 'harian') {
      return ['tanggal'].concat(t.fields.map(function (f) { return f.key; }));
    }
    var out = ['bulan'];
    state.wells.forEach(function (w) {
      if (state.category === 'debit') out.push('well:' + w + ':-');
      else { out.push('well:' + w + ':statis'); out.push('well:' + w + ':dinamis'); }
    });
    return out;
  }

  function barisKosong(n) {
    var r = [];
    for (var i = 0; i < n; i++) r.push('');
    return r;
  }

  function periodeSekarang() {
    var d = new Date();
    return TARGETS[state.target].jenis === 'harian'
      ? d.getFullYear() + '-' + pad2(d.getMonth() + 1)
      : String(d.getFullYear());
  }

  function jumlahHari(tahun, bulan) { return new Date(tahun, bulan, 0).getDate(); }

  // Semua kunci baris untuk periode yang dipilih: tanggal 1..akhir bulan untuk
  // data harian, Januari..Desember untuk data sumur yang memang bulanan.
  function kunciPeriode() {
    var out = [];
    if (TARGETS[state.target].jenis === 'harian') {
      var p = state.periode.split('-').map(Number);
      var n = jumlahHari(p[0], p[1]);
      for (var d = 1; d <= n; d++) out.push(state.periode + '-' + pad2(d));
    } else {
      for (var m = 1; m <= 12; m++) out.push(state.periode + '-' + pad2(m));
    }
    return out;
  }

  // Satu baris tabel untuk satu tanggal/bulan, sudah terisi nilai yang ADA di
  // database. Inilah yang membuat memilih bulan lampau berarti "muat data":
  // yang sudah tersimpan langsung kelihatan dan bisa dikoreksi di tempat.
  function barisDariExisting(kunci) {
    var t = TARGETS[state.target];
    var row = barisKosong(state.mapping.length);
    var lama = state.existing ? state.existing.get(kunci) : null;

    state.mapping.forEach(function (m, c) {
      if (m === 'tanggal' || m === 'bulan') { row[c] = kunci; return; }
      if (!lama) return;
      var v = null;
      if (t.jenis === 'harian') {
        var fld = t.fields.find(function (f) { return f.key === m; });
        if (fld) v = lama[fld.histKey];
      } else if (typeof m === 'string' && m.indexOf('well:') === 0) {
        var p = m.split(':');
        var isi = lama[p[1]];
        if (isi !== undefined && isi !== null) {
          // Debit menyimpan satu angka per sumur, level sepasang {statis,
          // dinamis}. Kalau bentuknya tidak seperti yang diharapkan kategori
          // ini, lebih baik selnya dibiarkan kosong daripada menulis
          // "[object Object]" ke tabel yang bisa ikut terkirim.
          v = state.category === 'debit'
            ? (typeof isi === 'object' ? null : isi)
            : (typeof isi === 'object' ? isi[p[2]] : null);
        }
      }
      if (v !== null && v !== undefined && typeof v !== 'object') row[c] = String(v);
    });
    return row;
  }

  function muatPeriode() {
    state.grid = kunciPeriode().map(barisDariExisting);
    state.adaSuntingan = false;
    state.pesan = '';
  }

  function siapkanGrid() {
    state.mapping = kolomBawaan();
    state.adaJudul = false; // grid tidak pernah menyimpan baris judul
    if (!state.periode) state.periode = periodeSekarang();
    muatPeriode();
  }

  // --- Salin dari bulan sebelumnya (khusus Statis & Dinamis) ---------------
  // Muka air statis/dinamis sumur nyaris tidak bergeser dari bulan ke bulan;
  // yang tercatat sering angka yang sama persis. Jadi mengetik ulang 16 kolom
  // tiap bulan cuma menyalin pekerjaan bulan lalu. Tombol ini yang
  // menyalinnya, tinggal ubah yang memang berbeda.
  //
  // Batasan yang dipegang, supaya tidak pernah mengarang data:
  //   - hanya mengisi sel yang KOSONG, tidak pernah menimpa angka yang ada
  //   - berhenti di bulan berjalan, tidak mengisi bulan yang belum terjadi
  //   - hasilnya cuma masuk tabel, bukan database -- semuanya tetap muncul
  //     sebagai "nilai baru" di pratinjau dan baru tersimpan kalau ditekan
  //     tombol simpan
  function bulanBerjalan() {
    var d = new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1);
  }

  function barisPunyaNilai(r) {
    var row = state.grid[r];
    return state.mapping.some(function (m, c) {
      return m && m !== 'bulan' && m !== 'tanggal' && String(row[c] === undefined ? '' : row[c]).trim() !== '';
    });
  }

  function salinDariBulanSebelumnya() {
    var idx = state.mapping.indexOf('bulan');
    if (idx < 0) return;

    var batas = bulanBerjalan();
    var selTerisi = 0, bulanTersentuh = 0;

    for (var r = 0; r < state.grid.length; r++) {
      var kunci = state.grid[r][idx];
      if (!kunci || kunci > batas) break;

      // Sumbernya baris di atasnya kalau sudah ada isinya -- termasuk isi yang
      // baru saja disalin, jadi rantainya menurun dari bulan terakhir yang
      // benar-benar tercatat. Untuk baris Januari, bulan sebelumnya ada di
      // tahun lain, jadi diambil langsung dari data yang termuat.
      var sumber = (r > 0 && barisPunyaNilai(r - 1))
        ? state.grid[r - 1]
        : barisDariExisting(tambahBulan(kunci, -1));

      var adaDisalin = false;
      state.mapping.forEach(function (m, c) {
        if (c === idx || !m) return;
        if (String(state.grid[r][c] === undefined ? '' : state.grid[r][c]).trim() !== '') return;
        var v = sumber[c];
        if (v === undefined || String(v).trim() === '') return;
        state.grid[r][c] = String(v);
        selTerisi++;
        adaDisalin = true;
      });
      if (adaDisalin) bulanTersentuh++;
    }

    if (selTerisi === 0) {
      state.pesan = 'Tidak ada yang bisa disalin — sel yang kosong tidak punya angka bulan sebelumnya, atau semuanya sudah terisi.';
      return;
    }
    state.adaSuntingan = true;
    state.pesan = selTerisi + ' nilai disalin dari bulan sebelumnya ke ' + bulanTersentuh +
      ' bulan. Ubah yang memang berbeda, lalu tekan simpan — belum ada yang masuk database.';
  }

  // Jumlah tanggal/bulan dalam periode ini yang SUDAH punya isi di database --
  // ditampilkan sebagai keterangan supaya jelas apakah bulan itu masih kosong
  // atau sedang menampilkan data lama.
  function jumlahTerisiDiPeriode() {
    if (!state.existing) return null;
    var n = 0;
    kunciPeriode().forEach(function (k) {
      var v = state.existing.get(k);
      if (!v) return;
      var adaNilai = Object.keys(v).some(function (kk) {
        var x = v[kk];
        if (x === null || x === undefined) return false;
        if (typeof x === 'object') return x.statis !== null || x.dinamis !== null;
        return true;
      });
      if (adaNilai) n++;
    });
    return n;
  }

  function gantiPeriode(baru, panel) {
    // Di luar rentang tahun yang tersedia di dropdown: batalkan, kalau tidak
    // dropdown tahun akan kosong dan periodenya jadi tidak terbaca.
    var th = Number(String(baru).slice(0, 4));
    if (th < 2014 || th > new Date().getFullYear() + 1) { render(panel); return; }

    // render(panel) saat dibatalkan bukan sekadar hiasan: dropdown sudah
    // terlanjur menampilkan pilihan baru, harus dikembalikan ke periode lama.
    if (state.adaSuntingan && !confirm('Ganti periode? Isian yang belum disimpan di tabel akan hilang.')) {
      render(panel);
      return;
    }
    state.periode = baru;
    muatPeriode();
    render(panel);
  }

  function geserPeriode(arah) {
    if (TARGETS[state.target].jenis === 'harian') return tambahBulan(state.periode, arah);
    return String(Number(state.periode) + arah);
  }

  function barisKosongSemua(r) {
    return state.grid[r].every(function (c) { return String(c).trim() === ''; });
  }

  function adaIsi() {
    return state.grid.some(function (_, r) { return !barisKosongSemua(r); });
  }

  function tambahBulan(ym, n) {
    var p = ym.split('-').map(Number);
    var d = new Date(p[0], p[1] - 1 + n, 1);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1);
  }

  // Tempelkan satu blok sel (hasil parse) ke grid mulai dari (r0, c0).
  function tempelBlok(r0, c0, blok) {
    if (!blok || blok.length === 0) return;

    // Kalau baris pertama tempelan ternyata judul kolom, pakai untuk menyetel
    // ulang arti kolom -- supaya urutan kolom di Excel yang berbeda dari
    // urutan bawaan tabel tetap mendarat di tempat yang benar -- lalu baris
    // itu dibuang, bukan ditulis sebagai data.
    if (deteksiAdaJudul(blok)) {
      var tebakan = tebakMapping(blok[0]);
      tebakan.forEach(function (m, i) {
        var c = c0 + i;
        if (!m || c >= state.mapping.length) return;
        // Satu arti cuma boleh dipakai satu kolom.
        state.mapping = state.mapping.map(function (lama, j) { return (lama === m && j !== c) ? '' : lama; });
        state.mapping[c] = m;
      });
      blok = blok.slice(1);
    }

    var lebarTerpakai = 0;
    blok.forEach(function (r) { lebarTerpakai = Math.max(lebarTerpakai, r.length); });
    var lebihLebar = Math.max(0, c0 + lebarTerpakai - state.mapping.length);

    // Tabel TIDAK ikut memanjang: jumlah barisnya dikunci sebanyak tanggal di
    // periode yang dipilih. Tempelan yang lebih panjang dipotong dan
    // dilaporkan -- baris di luar bulan itu tidak punya tanggal yang sah,
    // jadi lebih baik ditolak terang-terangan daripada diam-diam masuk.
    var lebihPanjang = Math.max(0, r0 + blok.length - state.grid.length);

    blok.forEach(function (baris, i) {
      var r = r0 + i;
      if (r >= state.grid.length) return;
      baris.forEach(function (sel, j) {
        var c = c0 + j;
        if (c < state.mapping.length) state.grid[r][c] = sel;
      });
    });

    var keluhan = [];
    if (lebihPanjang > 0) keluhan.push(lebihPanjang + ' baris melebihi jumlah tanggal di periode ini');
    if (lebihLebar > 0) keluhan.push(lebihLebar + ' kolom melebihi lebar tabel');
    state.pesan = keluhan.length
      ? 'Tempelan dipotong: ' + keluhan.join(' dan ') + '. Periksa apakah baris awal tempelan sudah pas dengan tanggalnya.'
      : '';
  }

  // 2014 = tahun data tertua yang ada (lihat berkas CSV arsip Waduk Manggar).
  function opsiTahun(terpilih) {
    var kini = new Date().getFullYear();
    var out = [];
    for (var y = kini + 1; y >= 2014; y--) {
      out.push('<option value="' + y + '"' + (String(y) === String(terpilih) ? ' selected' : '') + '>' + y + '</option>');
    }
    return out.join('');
  }

  function renderPeriode() {
    var harian = TARGETS[state.target].jenis === 'harian';
    var terisi = jumlahTerisiDiPeriode();
    var jml = kunciPeriode().length;

    // Sengaja TIDAK memakai <input type="month">: kotak bawaan peramban
    // menampilkan nama bulan mengikuti bahasa peramban ("July 2026"), tidak
    // bisa dipaksa Indonesia. Dua dropdown sendiri selalu tampil "Juli 2026".
    var pemilih;
    if (harian) {
      var bl = Number(state.periode.slice(5, 7));
      var opsiBulan = BULAN_PANJANG.map(function (nama, i) {
        return '<option value="' + pad2(i + 1) + '"' + (i + 1 === bl ? ' selected' : '') + '>' + nama + '</option>';
      }).join('');
      pemilih = '<select id="imBulan">' + opsiBulan + '</select>' +
                '<select id="imTahun">' + opsiTahun(state.periode.slice(0, 4)) + '</select>';
    } else {
      pemilih = '<select id="imTahun">' + opsiTahun(state.periode) + '</select>';
    }

    var ket;
    if (terisi === null) ket = 'Memuat data lama…';
    else if (terisi === 0) ket = jml + ' baris disiapkan. Belum ada data tersimpan untuk periode ini.';
    else ket = jml + ' baris disiapkan. <b>' + terisi + '</b> ' + (harian ? 'tanggal' : 'bulan') +
      ' sudah ada isinya dan langsung dimuat ke tabel di bawah — tinggal dikoreksi atau dilengkapi.';

    // Khusus Statis & Dinamis: angkanya jarang berubah antar bulan, jadi
    // menyalin bulan sebelumnya jauh lebih cepat daripada mengetik ulang.
    // Tidak ditawarkan untuk Debit -- debit memang berubah tiap bulan, dan
    // menyalinnya justru menghasilkan angka yang salah.
    var salin = (!harian && state.category === 'level')
      ? '<button class="tbtn" id="imSalin" title="Isi bulan yang masih kosong dengan angka bulan sebelumnya">⧉ Salin dari bulan sebelumnya</button>'
      : '';

    return '<div class="im-periode-row">' +
      '<button class="tbtn" id="imPrev" title="Periode sebelumnya">◀</button>' +
      pemilih +
      '<button class="tbtn" id="imNext" title="Periode berikutnya">▶</button>' +
      '<button class="tbtn" id="imReload" title="Muat ulang dari database, buang isian di tabel">↻ Muat ulang</button>' +
      salin +
      '</div>' +
      '<p class="im-periode-info">' + ket + '</p>';
  }

  function render(panel) {
    pasangGaya();
    var t = TARGETS[state.target];

    panel.innerHTML =
      '<h2>Input Massal — tempel langsung dari Excel</h2>' +
      '<p class="sub">Untuk memasukkan banyak tanggal/bulan sekaligus. Form input satu-per-satu di tab lain tetap bisa dipakai seperti biasa — dua-duanya menulis ke tabel yang sama.</p>' +

      '<div class="im-step">' +
        '<div class="im-step-title"><span class="im-step-num">1</span> Pilih tujuan</div>' +
        '<div class="im-target-row">' +
          '<select id="imTarget">' + opsiTujuan() + '</select>' +
          (t.jenis === 'sumur'
            ? '<select id="imInst">' + SUMUR_LOCATIONS.map(function (l) {
                return '<option value="' + l.key + '"' + (state.installation === l.key ? ' selected' : '') + '>' + esc(l.label) + '</option>';
              }).join('') + '</select>' +
              '<select id="imCat">' +
                '<option value="debit"' + (state.category === 'debit' ? ' selected' : '') + '>Debit Sumur</option>' +
                '<option value="level"' + (state.category === 'level' ? ' selected' : '') + '>Statis &amp; Dinamis</option>' +
              '</select>'
            : '') +
        '</div>' +
      '</div>' +

      '<div class="im-step">' +
        '<div class="im-step-title"><span class="im-step-num">2</span> Pilih periode</div>' +
        renderPeriode() +
      '</div>' +

      '<div class="im-step">' +
        '<div class="im-step-title"><span class="im-step-num">3</span> Isi tabel</div>' +
        '<p class="im-hint">Blok sel di Excel → <b>Ctrl+C</b> → klik satu sel di bawah → <b>Ctrl+V</b>. Boleh sekolom saja, boleh sebagian kolom — kolom yang tidak diisi tidak akan tersentuh. Bisa juga diketik langsung; Enter turun satu baris, Tab pindah ke kanan.</p>' +
        '<div class="im-grid-wrap" id="imGridWrap"></div>' +
      '</div>' +

      '<div id="imAfter"></div>';

    document.getElementById('imTarget').onchange = function (e) {
      state.target = e.target.value;
      gantiTujuan(panel);
    };
    if (t.jenis === 'sumur') {
      document.getElementById('imInst').onchange = function (e) { state.installation = e.target.value; gantiTujuan(panel); };
      document.getElementById('imCat').onchange = function (e) { state.category = e.target.value; gantiTujuan(panel); };
    }

    document.getElementById('imPrev').onclick = function () { gantiPeriode(geserPeriode(-1), panel); };
    document.getElementById('imNext').onclick = function () { gantiPeriode(geserPeriode(1), panel); };

    var selBulan = document.getElementById('imBulan');
    var selTahun = document.getElementById('imTahun');
    function dariDropdown() {
      return selBulan ? selTahun.value + '-' + selBulan.value : selTahun.value;
    }
    if (selBulan) selBulan.onchange = function () { gantiPeriode(dariDropdown(), panel); };
    selTahun.onchange = function () { gantiPeriode(dariDropdown(), panel); };
    var btnSalin = document.getElementById('imSalin');
    if (btnSalin) btnSalin.onclick = function () {
      salinDariBulanSebelumnya();
      renderGrid(panel);
      renderAfter(panel);
    };

    document.getElementById('imReload').onclick = async function () {
      if (state.adaSuntingan && !confirm('Muat ulang dari database? Isian yang belum disimpan di tabel akan hilang.')) return;
      state.existing = null;
      render(panel);
      await muatExisting();
      muatPeriode();
      render(panel);
    };

    renderGrid(panel);
    renderAfter(panel);
  }

  // --- Tabel isian ----------------------------------------------------------
  function renderGrid(panel) {
    var wrap = document.getElementById('imGridWrap');
    if (!wrap) return;

    var head = '<tr><th class="im-rownum"></th>' + state.mapping.map(function (m, c) {
      return '<th><select class="im-colsel" data-c="' + c + '">' + opsiUntukKolom(m) + '</select></th>';
    }).join('') + '</tr>';

    var body = state.grid.map(function (row, r) {
      return '<tr><td class="im-rownum">' + (r + 1) + '</td>' + state.mapping.map(function (m, c) {
        return '<td><input class="im-cell" data-r="' + r + '" data-c="' + c + '" value="' +
          esc(row[c] === undefined ? '' : row[c]) + '"' + (m === '' ? ' disabled' : '') + '></td>';
      }).join('') + '</tr>';
    }).join('');

    wrap.innerHTML = '<table class="im-grid"><thead>' + head + '</thead><tbody>' + body + '</tbody></table>';

    wrap.querySelectorAll('.im-colsel').forEach(function (sel) {
      sel.onchange = function () {
        var c = Number(sel.getAttribute('data-c'));
        var v = sel.value;
        if (v) state.mapping = state.mapping.map(function (m, j) { return (m === v && j !== c) ? '' : m; });
        state.mapping[c] = v;
        renderGrid(panel);
        renderAfter(panel);
      };
    });

    // Pendengar dipasang SEKALI di pembungkusnya (bukan di tiap sel), karena
    // isi tabel digambar ulang berkali-kali -- kalau dipasang tiap render,
    // satu ketukan tombol akan terproses berulang kali.
    if (wrap.dataset.terpasang) return;
    wrap.dataset.terpasang = '1';

    // Mengetik cuma memperbarui state + pratinjau; tabelnya sendiri TIDAK
    // digambar ulang, supaya kursor tidak lompat di tengah pengetikan.
    wrap.addEventListener('input', function (ev) {
      var el = ev.target;
      if (!el.classList.contains('im-cell')) return;
      var r = Number(el.getAttribute('data-r')), c = Number(el.getAttribute('data-c'));
      state.grid[r][c] = el.value;
      state.adaSuntingan = true;
      renderAfter(panel);
    });

    wrap.addEventListener('keydown', function (ev) {
      var el = ev.target;
      if (!el.classList.contains('im-cell')) return;
      if (ev.key !== 'Enter' && ev.key !== 'ArrowDown' && ev.key !== 'ArrowUp') return;
      ev.preventDefault();
      var r = Number(el.getAttribute('data-r')), c = Number(el.getAttribute('data-c'));
      var tujuan = wrap.querySelector('.im-cell[data-r="' + (ev.key === 'ArrowUp' ? r - 1 : r + 1) + '"][data-c="' + c + '"]');
      if (tujuan) { tujuan.focus(); tujuan.select(); }
    });

    wrap.addEventListener('paste', function (ev) {
      var el = ev.target;
      if (!el.classList.contains('im-cell')) return;
      var teks = (ev.clipboardData || window.clipboardData).getData('text');
      if (!teks || !teks.trim()) return;
      ev.preventDefault();
      var blok = parseDelimited(teks, PEMISAH);
      terimaBlok(Number(el.getAttribute('data-r')), Number(el.getAttribute('data-c')), blok, panel);
    });
  }

  function terimaBlok(r0, c0, blok, panel) {
    state.adaSuntingan = true;
    tempelBlok(r0, c0, blok);
    renderGrid(panel);
    renderAfter(panel);
  }

  async function gantiTujuan(panel) {
    state.existing = null;
    if (TARGETS[state.target].jenis === 'sumur') {
      state.wells = [];
      try { await muatWells(); } catch (err) { state.pesan = 'Gagal memuat daftar sumur: ' + err.message; }
    }
    // Harian memakai periode 'YYYY-MM', sumur 'YYYY' -- bentuknya beda, jadi
    // periode disetel ulang saat pindah antar keduanya.
    var harian = TARGETS[state.target].jenis === 'harian';
    if (harian !== (state.periode.length === 7)) state.periode = '';
    siapkanGrid();
    render(panel);
    await muatExisting();
    if (!state.adaSuntingan) muatPeriode();
    render(panel);
  }

  // --- Langkah 4: pratinjau & simpan ---------------------------------------
  function renderAfter(panel) {
    var after = document.getElementById('imAfter');
    if (!after) return;

    var alert = state.pesan ? '<div class="im-alert warn">' + esc(state.pesan) + '</div>' : '';

    var t = TARGETS[state.target];
    if (t.jenis === 'sumur' && state.wells.length === 0) {
      after.innerHTML = alert + '<div class="im-alert warn">Belum ada sumur terdaftar untuk instalasi ini. Daftarkan dulu lewat tab <b>Sumur Dalam</b> di menu utama, baru datanya bisa diisi di sini.</div>';
      return;
    }

    if (!adaIsi()) {
      after.innerHTML = alert;
      return;
    }

    after.innerHTML = alert + renderPratinjau();

    var btn = document.getElementById('imBtnSimpan');
    if (btn) btn.onclick = function () { simpan(panel); };
  }

  function opsiUntukKolom(nilaiTerpilih) {
    var t = TARGETS[state.target];
    var opsi = ['<option value="">— abaikan kolom ini —</option>'];
    if (t.jenis === 'harian') {
      opsi.push('<option value="tanggal"' + (nilaiTerpilih === 'tanggal' ? ' selected' : '') + '>Tanggal</option>');
      t.fields.forEach(function (f) {
        opsi.push('<option value="' + f.key + '"' + (nilaiTerpilih === f.key ? ' selected' : '') + '>' + esc(judulField(f)) + '</option>');
      });
    } else {
      opsi.push('<option value="bulan"' + (nilaiTerpilih === 'bulan' ? ' selected' : '') + '>Bulan</option>');
      state.wells.forEach(function (w) {
        if (state.category === 'debit') {
          var v = 'well:' + w + ':-';
          opsi.push('<option value="' + esc(v) + '"' + (nilaiTerpilih === v ? ' selected' : '') + '>' + esc(w) + '</option>');
        } else {
          ['statis', 'dinamis'].forEach(function (b) {
            var v2 = 'well:' + w + ':' + b;
            opsi.push('<option value="' + esc(v2) + '"' + (nilaiTerpilih === v2 ? ' selected' : '') + '>' + esc(w) + ' — ' + (b === 'statis' ? 'Statis' : 'Dinamis') + '</option>');
          });
        }
      });
    }
    return opsi.join('');
  }

  function renderPratinjau() {
    var t = TARGETS[state.target];
    var hasil = t.jenis === 'harian' ? susunHarian() : susunSumur();
    var baris = hasil.baris;

    var siap = baris.filter(function (b) { return !b.alasan; });
    var tolak = baris.filter(function (b) { return b.alasan; });

    var kolomTampil = t.jenis === 'harian'
      ? hasil.kolomField.map(function (k) { return { judul: judulField(k.fld), key: k.fld.key, fld: k.fld }; })
      : ringkasKolomSumur(hasil.kolomWell);

    // Satu tempat untuk menjawab "sel ini nilainya berapa, statusnya apa,
    // dan wajar tidak" -- dipakai dua kali: sekali buat menghitung ringkasan,
    // sekali lagi buat menggambar tabel, supaya angka di badge dan warna di
    // tabel tidak mungkin berbeda.
    function bacaSel(b, k) {
      var v, lama, wajar;
      if (t.jenis === 'harian') {
        v = b.nilai[k.key];
        lama = lamaHarian(b.kunci, k.fld.histKey);
        wajar = k.fld.wajar;
      } else if (state.category === 'debit') {
        v = b.nilai[k.well];
        lama = lamaSumur(b.kunci, k.well, null);
        wajar = WAJAR_SUMUR.debit;
      } else {
        var pasangan = b.nilai[k.well];
        v = pasangan ? pasangan[k.bagian] : undefined;
        lama = lamaSumur(b.kunci, k.well, k.bagian);
        wajar = WAJAR_SUMUR[k.bagian];
      }
      if (v === undefined || v === null) return null;
      var st = (state.existing === null || lama === null || lama === undefined)
        ? 'baru'
        : (samaAngka(lama, v) ? 'sama' : 'timpa');
      return { nilai: v, lama: lama, status: st, aneh: diLuarWajar(wajar, v) };
    }

    var nBaru = 0, nTimpa = 0, nSama = 0, nAneh = 0;
    siap.forEach(function (b) {
      kolomTampil.forEach(function (k) {
        var s = bacaSel(b, k);
        if (!s) return;
        if (s.status === 'baru') nBaru++; else if (s.status === 'timpa') nTimpa++; else nSama++;
        if (s.aneh) nAneh++;
      });
    });

    var thead = '<tr><th>' + (t.jenis === 'harian' ? 'Tanggal' : 'Bulan') + '</th>' +
      kolomTampil.map(function (k) { return '<th>' + esc(k.judul) + '</th>'; }).join('') + '</tr>';

    var tbody = baris.map(function (b) {
      if (b.alasan) {
        return '<tr class="row-tolak"><td class="key">' + esc(b.mentahKunci || '—') + '</td>' +
          '<td colspan="' + kolomTampil.length + '">' + esc(b.alasan) + '</td></tr>';
      }
      var sel = kolomTampil.map(function (k) {
        var s = bacaSel(b, k);
        return s ? selHtml(s) : '<td class="im-cell-sama">·</td>';
      }).join('');
      var labelKunci = t.jenis === 'harian' ? fmtTanggalID(b.kunci) : fmtBulanID(b.kunci);
      return '<tr><td class="key">' + esc(labelKunci) + '</td>' + sel + '</tr>';
    }).join('');

    var bisaSimpan = siap.length > 0 && (nBaru + nTimpa) > 0;

    return '<div class="im-step">' +
      '<div class="im-step-title"><span class="im-step-num">4</span> Periksa lalu simpan</div>' +
      '<div class="im-summary">' +
        '<span class="im-badge baru">' + nBaru + ' nilai baru</span>' +
        '<span class="im-badge timpa">' + nTimpa + ' menimpa nilai lama</span>' +
        '<span class="im-badge sama">' + nSama + ' sudah sama</span>' +
        (tolak.length > 0 ? '<span class="im-badge tolak">' + tolak.length + ' baris ditolak</span>' : '') +
        (nAneh > 0 ? '<span class="im-badge aneh">' + nAneh + ' di luar rentang wajar</span>' : '') +
      '</div>' +
      (nAneh > 0
        ? '<div class="im-alert warn">Ada ' + nAneh + ' nilai di luar rentang yang biasa (bertanda garis putus-putus di tabel). Paling sering penyebabnya kolom tertukar — periksa langkah 3. Kalau angkanya memang benar, simpan saja.</div>'
        : '') +
      (state.existing === null
        ? '<div class="im-alert warn">Data lama gagal dimuat, jadi penanda "menimpa" tidak bisa ditampilkan. Data tetap bisa disimpan — nilai yang sudah ada akan tergantikan kalau tanggalnya sama.</div>'
        : '') +
      '<div class="im-prev-wrap"><table class="im-prev"><thead>' + thead + '</thead><tbody>' + tbody + '</tbody></table></div>' +
      '<div class="actions-row" style="margin-top:14px">' +
        '<button class="save-btn" id="imBtnSimpan"' + (bisaSimpan ? '' : ' disabled') + '>Simpan ' + (nBaru + nTimpa) + ' nilai ke database</button>' +
        '<span class="im-progress" id="imProgress"></span>' +
      '</div>' +
      '<div class="im-note"><b>Sel kosong tidak menghapus apa pun.</b> Kalau tempelan ini cuma berisi kolom NTU &amp; pH, nilai Level dan Curah Hujan pada tanggal yang sama tetap utuh — begitu juga sebaliknya. Untuk mengosongkan nilai yang salah, pakai tombol 🗑️ di tab input biasa.</div>' +
    '</div>';
  }

  function lamaHarian(kunci, histKey) {
    var e = state.existing && state.existing.get(kunci);
    return e ? e[histKey] : null;
  }
  function lamaSumur(kunci, well, bagian) {
    var e = state.existing && state.existing.get(kunci);
    if (!e || e[well] === undefined || e[well] === null) return null;
    return bagian ? e[well][bagian] : e[well];
  }

  function selHtml(s) {
    var kelas = s.status === 'timpa' ? 'im-cell-timpa' : (s.status === 'sama' ? 'im-cell-sama' : 'im-cell-baru');
    if (s.aneh) kelas += ' im-cell-aneh';
    var isi = s.status === 'timpa'
      ? '<span class="im-cell-lama">' + esc(s.lama) + '</span>' + esc(s.nilai)
      : esc(s.nilai);
    return '<td class="' + kelas + '"' + (s.aneh ? ' title="Di luar rentang yang biasa untuk kolom ini"' : '') + '>' + isi + '</td>';
  }

  // Untuk sumur, satu kolom pratinjau = satu (sumur, bagian) yang benar-benar
  // dipetakan -- bukan seluruh daftar sumur, supaya tabelnya tidak melebar
  // sia-sia saat yang ditempel cuma 2-3 sumur.
  function ringkasKolomSumur(kolomWell) {
    var terlihat = [];
    var sudah = {};
    kolomWell.forEach(function (k) {
      var id = k.well + '|' + k.bagian;
      if (sudah[id]) return;
      sudah[id] = 1;
      terlihat.push({
        well: k.well,
        bagian: state.category === 'debit' ? null : (k.bagian === 'dinamis' ? 'dinamis' : 'statis'),
        judul: state.category === 'debit' ? k.well : k.well + ' — ' + (k.bagian === 'dinamis' ? 'Dinamis' : 'Statis')
      });
    });
    return terlihat;
  }

  // ==========================================================================
  // SIMPAN
  // ==========================================================================
  async function simpan(panel) {
    var t = TARGETS[state.target];
    var hasil = t.jenis === 'harian' ? susunHarian() : susunSumur();
    var siap = hasil.baris.filter(function (b) { return !b.alasan; });
    if (siap.length === 0) return;

    var btn = document.getElementById('imBtnSimpan');
    var prog = document.getElementById('imProgress');
    btn.disabled = true;

    var kirim = siap.map(function (b) {
      return t.jenis === 'harian'
        ? { tanggal: b.kunci, values: b.nilai }
        : { bulan: b.kunci, values: b.nilai };
    });

    var url = t.jenis === 'harian'
      ? '/api/visualization/admin-library?action=bulk&kind=daily'
      : '/api/visualization/admin-library?action=bulk&kind=sumur&' +
        new URLSearchParams({ installation: state.installation, category: state.category }).toString();

    var terkirim = 0, gagal = null, takDikenal = [];
    for (var i = 0; i < kirim.length; i += CHUNK) {
      var potong = kirim.slice(i, i + CHUNK);
      prog.textContent = 'Menyimpan ' + Math.min(i + potong.length, kirim.length) + '/' + kirim.length + '…';
      try {
        var res = await fetch(url, {
          method: 'POST',
          headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders()),
          body: JSON.stringify({ rows: potong })
        });
        var data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error || 'HTTP ' + res.status);
        terkirim += potong.length;
        if (data.takDikenal && data.takDikenal.length) takDikenal = takDikenal.concat(data.takDikenal);
      } catch (err) {
        gagal = err.message;
        break;
      }
    }

    prog.textContent = '';
    btn.disabled = false;

    // Muat ulang data lama supaya pratinjau langsung berubah jadi "sudah sama"
    // -- bukti visual bahwa datanya benar-benar masuk, tanpa perlu buka tab
    // lain untuk memeriksa.
    await muatExisting();

    var pesan = gagal
      ? '<div class="im-alert err">Berhenti setelah ' + terkirim + ' baris tersimpan. ' + esc(gagal) + '</div>'
      : '<div class="im-alert ok">Berhasil menyimpan ' + terkirim + ' baris' +
        (takDikenal.length ? '. Nama sumur yang dilewati karena belum terdaftar: <b>' + esc(Array.from(new Set(takDikenal)).join(', ')) + '</b>' : '') +
        '.</div>';

    // Kalau semuanya masuk, tabel diisi ulang dari database: yang tampil
    // sesudahnya adalah apa yang BENAR-BENAR tersimpan, bukan apa yang tadi
    // diketik. Kalau ada yang gagal, isian dibiarkan supaya tidak hilang.
    if (!gagal) muatPeriode();
    render(panel);

    var after = document.getElementById('imAfter');
    if (after) after.insertAdjacentHTML('afterbegin', pesan);
  }

  // ==========================================================================
  // API MODUL — dipanggil renderAll() di input-data-historis.html
  // ==========================================================================
  window.InputMassal = {
    render: async function (panel) {
      panel.innerHTML = '<div class="empty-note">Menyiapkan…</div>';
      if (TARGETS[state.target].jenis === 'sumur' && state.wells.length === 0) {
        try { await muatWells(); } catch (err) { state.pesan = 'Gagal memuat daftar sumur: ' + err.message; }
      }
      // Isi tabel dipertahankan saat pindah tab lalu balik lagi -- tabel baru
      // cuma disiapkan kalau memang belum pernah ada.
      var pertamaKali = state.grid.length === 0;
      if (pertamaKali) siapkanGrid();
      render(panel);
      if (state.existing === null) {
        await muatExisting();
        // Data lama baru sampai setelah tabel tergambar; isi ulang tabel
        // supaya nilai yang sudah tersimpan ikut muncul -- kecuali kalau
        // sudah terlanjur ada yang diketik.
        if (!state.adaSuntingan) muatPeriode();
        render(panel);
      }
    }
  };
})();
