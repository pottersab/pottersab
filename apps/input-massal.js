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
    grid: [],          // hasil parse mentah, termasuk baris judul
    adaJudul: true,
    mapping: [],       // per indeks kolom: '' | 'tanggal' | 'bulan' | <fieldKey> | 'well:<nama>:<statis|dinamis|->'
    wells: [],
    existing: null,    // Map tanggal/bulan -> nilai lama
    memuat: false,
    pesan: ''
  };

  // ==========================================================================
  // PARSER
  // ==========================================================================

  // Tempelan dari Excel = TSV. Tapi orang juga sering menempel dari Word/PDF
  // atau mengetik ulang, jadi pemisahnya ditebak: tab kalau ada, kalau tidak
  // titik-koma, kalau tidak koma, terakhir spasi ganda.
  function tebakPemisah(teks) {
    var baris = teks.split(/\r?\n/).filter(function (b) { return b.trim() !== ''; }).slice(0, 5);
    if (baris.length === 0) return '\t';
    var kandidat = ['\t', ';', ',', '  '];
    var terbaik = '\t', skorTerbaik = 0;
    kandidat.forEach(function (sep) {
      var jml = baris.map(function (b) { return b.split(sep).length; });
      var min = Math.min.apply(null, jml);
      if (min > skorTerbaik) { skorTerbaik = min; terbaik = sep; }
    });
    return skorTerbaik > 1 ? terbaik : '\t';
  }

  // CSV/TSV dengan dukungan tanda kutip -- kolom teks dari Excel yang
  // mengandung pemisah akan terbungkus kutip, tanpa ini kolomnya bergeser.
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

  function transpose(grid) {
    var maks = Math.max.apply(null, grid.map(function (r) { return r.length; }));
    var out = [];
    for (var c = 0; c < maks; c++) {
      out.push(grid.map(function (r) { return r[c] === undefined ? '' : r[c]; }));
    }
    return out;
  }

  // ==========================================================================
  // PENYUSUNAN BARIS SIAP KIRIM + PERBANDINGAN DENGAN DATA LAMA
  // ==========================================================================
  function samaAngka(a, b) {
    if (a === null || a === undefined || b === null || b === undefined) return false;
    return Math.abs(Number(a) - Number(b)) < 1e-9;
  }

  function susunHarian() {
    var t = TARGETS[state.target];
    var idxTanggal = state.mapping.indexOf('tanggal');
    var kolomField = [];
    state.mapping.forEach(function (m, i) {
      var fld = t.fields.find(function (f) { return f.key === m; });
      if (fld) kolomField.push({ i: i, fld: fld });
    });

    var isi = state.adaJudul ? state.grid.slice(1) : state.grid.slice();
    var baris = [];
    isi.forEach(function (r, n) {
      var tgl = idxTanggal >= 0 ? parseTanggal(r[idxTanggal]) : null;
      var nilai = {}, adaIsi = false;
      kolomField.forEach(function (k) {
        var v = parseAngka(r[k.i]);
        if (v !== null) { nilai[k.fld.key] = v; adaIsi = true; }
      });

      var alasan = null;
      if (idxTanggal < 0) alasan = 'Kolom tanggal belum ditentukan';
      else if (!tgl) alasan = 'Tanggal tidak terbaca: "' + (r[idxTanggal] || '') + '"';
      else if (!adaIsi) alasan = 'Semua nilai kosong';

      baris.push({ no: n + 1, kunci: tgl, mentahKunci: idxTanggal >= 0 ? r[idxTanggal] : '', nilai: nilai, alasan: alasan });
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

    var isi = state.adaJudul ? state.grid.slice(1) : state.grid.slice();
    var baris = [];
    isi.forEach(function (r, n) {
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

      var alasan = null;
      if (idxBulan < 0) alasan = 'Kolom bulan belum ditentukan';
      else if (!bln) alasan = 'Bulan tidak terbaca: "' + (r[idxBulan] || '') + '"';
      else if (!adaIsi) alasan = 'Semua nilai kosong';

      baris.push({ no: n + 1, kunci: bln, mentahKunci: idxBulan >= 0 ? r[idxBulan] : '', nilai: nilai, alasan: alasan });
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
      '.im-paste{width:100%;min-height:130px;padding:12px;border:1.5px dashed var(--line-muted);border-radius:12px;font-family:"IBM Plex Mono",monospace;font-size:12.5px;line-height:1.5;color:var(--ink);background:#FCFEFE;resize:vertical}',
      '.im-paste:focus{outline:none;border-color:var(--primary-light);background:#fff}',
      '.im-tools{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:8px}',
      '.im-check{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--ink-soft)}',
      '.im-map-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:10px}',
      '.im-map-item{border:1px solid var(--line-muted);border-radius:10px;padding:9px 11px;background:#fff}',
      '.im-map-item .im-head{font-family:"IBM Plex Mono",monospace;font-size:11.5px;color:var(--primary);font-weight:600;margin-bottom:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.im-map-item .im-contoh{font-size:10.5px;color:var(--ink-soft);margin-bottom:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.im-map-item select{width:100%;padding:7px 8px;border:1px solid var(--line-muted);border-radius:8px;font-size:12.5px;font-family:"Inter",sans-serif;background:#fff;color:var(--ink)}',
      '.im-map-item.im-off{opacity:.55}',
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
    var M = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
    var p = ym.split('-');
    return M[Number(p[1]) - 1] + ' ' + p[0];
  }

  // "pH" satuannya juga "pH" -- jangan sampai keluar "pH (pH)".
  function judulField(f) { return f.label === f.unit ? f.label : f.label + ' (' + f.unit + ')'; }

  function opsiTujuan() {
    return Object.keys(TARGETS).map(function (k) {
      return '<option value="' + k + '"' + (state.target === k ? ' selected' : '') + '>' + esc(TARGETS[k].label) + '</option>';
    }).join('');
  }

  function contohHeader() {
    var t = TARGETS[state.target];
    if (t.jenis === 'harian') {
      return 'Tanggal\t' + t.fields.map(function (f) { return f.label; }).join('\t');
    }
    if (state.wells.length === 0) return 'Bulan\t…';
    if (state.category === 'debit') return 'Bulan\t' + state.wells.join('\t');
    return 'Bulan\t' + state.wells.map(function (w) { return w + '_Statis\t' + w + '_Dinamis'; }).join('\t');
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
        '<div class="im-step-title"><span class="im-step-num">2</span> Tempel data (Ctrl+V) atau unggah berkas</div>' +
        '<textarea class="im-paste" id="imPaste" spellcheck="false" placeholder="Blok sel di Excel → Ctrl+C → klik di sini → Ctrl+V.&#10;&#10;Bisa juga langsung diketik, satu baris per tanggal, kolom dipisah Tab.&#10;&#10;Contoh susunan kolom:&#10;' + esc(contohHeader()) + '"></textarea>' +
        '<div class="im-tools">' +
          '<button class="tbtn" id="imBtnFile">Unggah CSV / XLSX…</button>' +
          '<input type="file" id="imFile" accept=".csv,.tsv,.txt,.xlsx,.xls" style="display:none">' +
          '<button class="tbtn" id="imBtnTranspose" title="Tukar baris dan kolom">Putar tabel ⇄</button>' +
          '<button class="tbtn danger" id="imBtnClear">Bersihkan</button>' +
          '<label class="im-check"><input type="checkbox" id="imHeader"' + (state.adaJudul ? ' checked' : '') + '> Baris pertama = judul kolom</label>' +
        '</div>' +
      '</div>' +

      '<div id="imAfter"></div>';

    document.getElementById('imTarget').onchange = function (e) {
      state.target = e.target.value;
      resetData();
      gantiTujuan(panel);
    };
    if (t.jenis === 'sumur') {
      document.getElementById('imInst').onchange = function (e) { state.installation = e.target.value; resetData(); gantiTujuan(panel); };
      document.getElementById('imCat').onchange = function (e) { state.category = e.target.value; resetData(); gantiTujuan(panel); };
    }

    var ta = document.getElementById('imPaste');
    ta.addEventListener('paste', function (ev) {
      // Ambil teks tempelan langsung supaya bisa diproses seketika tanpa
      // menunggu textarea ter-update, dan supaya tab di dalam sel tidak
      // memindahkan fokus.
      var teks = (ev.clipboardData || window.clipboardData).getData('text');
      if (!teks) return;
      ev.preventDefault();
      ta.value = teks;
      terimaTeks(teks, panel);
    });
    ta.addEventListener('change', function () { terimaTeks(ta.value, panel); });
    ta.addEventListener('blur', function () { if (ta.value.trim() && state.grid.length === 0) terimaTeks(ta.value, panel); });

    document.getElementById('imBtnFile').onclick = function () { document.getElementById('imFile').click(); };
    document.getElementById('imFile').onchange = function (e) { if (e.target.files[0]) bacaBerkas(e.target.files[0], panel); };
    document.getElementById('imBtnTranspose').onclick = function () {
      if (state.grid.length === 0) return;
      state.grid = transpose(state.grid);
      state.adaJudul = deteksiAdaJudul(state.grid);
      state.mapping = tebakMapping(state.grid[0] || []);
      renderAfter(panel);
    };
    document.getElementById('imBtnClear').onclick = function () {
      resetData();
      document.getElementById('imPaste').value = '';
      renderAfter(panel);
    };
    document.getElementById('imHeader').onchange = function (e) {
      state.adaJudul = e.target.checked;
      // Cuma tebak ulang saat baris pertama BARU dinyatakan sebagai judul.
      // Kalau centang dilepas, baris pertama itu data -- menebak arti kolom
      // dari deretan angka cuma akan mengacak pilihan yang sudah benar.
      if (state.adaJudul) state.mapping = tebakMapping(state.grid[0] || []);
      renderAfter(panel);
    };

    renderAfter(panel);
  }

  function resetData() {
    state.grid = [];
    state.mapping = [];
    state.pesan = '';
  }

  async function gantiTujuan(panel) {
    state.existing = null;
    if (TARGETS[state.target].jenis === 'sumur') {
      state.wells = [];
      try { await muatWells(); } catch (err) { state.pesan = 'Gagal memuat daftar sumur: ' + err.message; }
    }
    render(panel);
    await muatExisting();
    renderAfter(panel);
  }

  function terimaTeks(teks, panel) {
    if (!teks || !teks.trim()) { resetData(); renderAfter(panel); return; }
    var sep = tebakPemisah(teks);
    state.grid = parseDelimited(teks, sep);
    state.adaJudul = deteksiAdaJudul(state.grid);
    state.mapping = tebakMapping(state.grid[0] || []);
    state.pesan = '';
    renderAfter(panel);
  }

  function bacaBerkas(file, panel) {
    var nama = file.name.toLowerCase();
    if (/\.xlsx?$/.test(nama)) {
      if (typeof XLSX === 'undefined') {
        state.pesan = 'Pembaca XLSX belum termuat. Coba muat ulang halaman, atau simpan berkasnya sebagai CSV.';
        renderAfter(panel);
        return;
      }
      var fr = new FileReader();
      fr.onload = function (e) {
        try {
          var wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
          var ws = wb.Sheets[wb.SheetNames[0]];
          // raw:false -> tanggal keluar sudah terformat, tidak jadi serial.
          var rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
          state.grid = rows
            .map(function (r) { return r.map(function (c) { return String(c === null || c === undefined ? '' : c).trim(); }); })
            .filter(function (r) { return r.some(function (c) { return c !== ''; }); });
          state.adaJudul = deteksiAdaJudul(state.grid);
          state.mapping = tebakMapping(state.grid[0] || []);
          state.pesan = '';
          document.getElementById('imPaste').value = '(dari berkas: ' + file.name + ')';
        } catch (err) {
          state.pesan = 'Gagal membaca berkas: ' + err.message;
        }
        renderAfter(panel);
      };
      fr.readAsArrayBuffer(file);
      return;
    }

    var fr2 = new FileReader();
    fr2.onload = function (e) {
      document.getElementById('imPaste').value = '(dari berkas: ' + file.name + ')';
      terimaTeks(e.target.result, panel);
    };
    fr2.readAsText(file);
  }

  // --- Langkah 3 & 4 --------------------------------------------------------
  function renderAfter(panel) {
    var after = document.getElementById('imAfter');
    if (!after) return;

    var alert = state.pesan ? '<div class="im-alert err">' + esc(state.pesan) + '</div>' : '';

    if (state.grid.length === 0) {
      after.innerHTML = alert;
      return;
    }

    var t = TARGETS[state.target];
    if (t.jenis === 'sumur' && state.wells.length === 0) {
      after.innerHTML = alert + '<div class="im-alert warn">Belum ada sumur terdaftar untuk instalasi ini. Daftarkan dulu lewat tab <b>Sumur Dalam</b> di menu utama, baru datanya bisa diimpor.</div>';
      return;
    }

    after.innerHTML = alert + renderMapping() + renderPratinjau();
    pasangHandlerMapping(panel);

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

  function renderMapping() {
    var judul = state.grid[0] || [];
    var contohBaris = state.adaJudul ? (state.grid[1] || []) : (state.grid[0] || []);
    var jmlKolom = Math.max.apply(null, state.grid.map(function (r) { return r.length; }));

    var items = [];
    for (var i = 0; i < jmlKolom; i++) {
      var namaKolom = state.adaJudul && judul[i] ? judul[i] : 'Kolom ' + (i + 1);
      var terpilih = state.mapping[i] || '';
      items.push(
        '<div class="im-map-item' + (terpilih === '' ? ' im-off' : '') + '">' +
          '<div class="im-head" title="' + esc(namaKolom) + '">' + esc(namaKolom) + '</div>' +
          '<div class="im-contoh">contoh: ' + esc(contohBaris[i] || '—') + '</div>' +
          '<select data-kolom="' + i + '">' + opsiUntukKolom(terpilih) + '</select>' +
        '</div>'
      );
    }

    var takTerpetakan = state.adaJudul
      ? judul.filter(function (h, i) { return h && !state.mapping[i]; })
      : [];

    return '<div class="im-step">' +
      '<div class="im-step-title"><span class="im-step-num">3</span> Cocokkan kolom</div>' +
      (takTerpetakan.length > 0
        ? '<div class="im-alert warn">Kolom yang belum dikenali dan akan dilewati: <b>' + esc(takTerpetakan.join(', ')) + '</b>. Tentukan sendiri lewat menu di bawah kalau memang perlu diimpor.</div>'
        : '') +
      '<div class="im-map-grid">' + items.join('') + '</div>' +
    '</div>';
  }

  function pasangHandlerMapping(panel) {
    document.querySelectorAll('.im-map-item select').forEach(function (sel) {
      sel.onchange = function () {
        var i = Number(sel.getAttribute('data-kolom'));
        var v = sel.value;
        // Satu arti cuma boleh dipakai satu kolom -- kalau dipilih ulang di
        // kolom lain, yang lama otomatis dilepas supaya tidak ada dua kolom
        // "Tanggal" yang saling menimpa diam-diam.
        if (v) {
          state.mapping = state.mapping.map(function (m) { return m === v ? '' : m; });
        }
        state.mapping[i] = v;
        renderAfter(panel);
      };
    });
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

    var after = document.getElementById('imAfter');
    var pesan = gagal
      ? '<div class="im-alert err">Berhenti setelah ' + terkirim + ' baris tersimpan. ' + esc(gagal) + '</div>'
      : '<div class="im-alert ok">Berhasil menyimpan ' + terkirim + ' baris' +
        (takDikenal.length ? '. Nama sumur yang dilewati karena belum terdaftar: <b>' + esc(Array.from(new Set(takDikenal)).join(', ')) + '</b>' : '') +
        '.</div>';

    renderAfter(panel);
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
      render(panel);
      if (state.existing === null) {
        await muatExisting();
        renderAfter(panel);
      }
    }
  };
})();
