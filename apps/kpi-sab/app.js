(function () {
  "use strict";

  var MONTHS = ["JANUARI", "FEBRUARI", "MARET", "APRIL", "MEI", "JUNI", "JULI", "AGUSTUS", "SEPTEMBER", "OKTOBER", "NOVEMBER", "DESEMBER"];

  // ---------------------------------------------------------------------
  // DATA per tahun. 2026: Jan-Jun dari lampiran 18.2 Ukur Debit.xlsx, Juli
  // dari data asli Portal SAB (Data Waduk & Sumur -> Sumur Dalam -> Debit
  // Sumur), Agustus-Desember sengaja kosong (menunggu bulan berjalan).
  // Tahun baru tinggal ditambah sebagai key baru di sini.
  // ---------------------------------------------------------------------
  var DATA_BY_YEAR = {
    "2026": {
      groups: [
        { no: 1, ipa: "IPA GUNUNG SARI", wells: [
          { name: "SUMUR 1", sub: "Dalam IPA", awal: 21, real: [21.5, 22, 21.5, 22.1, 21.47, 21.05, 21.00, null, null, null, null, null] },
          { name: "SUMUR 2", sub: "Dalam IPA", awal: 77, real: [77.63, 75.12, 78.41, 77.65, 76.12, 77.41, 77.22, null, null, null, null, null] },
          { name: "SUMUR 3", sub: "Dalam IPA", awal: 95, real: [110.36, 103.094, 110.36, 110.5, 108.55, 107.57, 106.52, null, null, null, null, null] },
          { name: "SUMUR 4", sub: "Dalam IPA", awal: 95, real: [85.12, 82.63, 88.6, 92.56, 91.68, 91.78, 91.26, null, null, null, null, null] },
          { name: "SUMUR 5", sub: "Reservoar Lama", awal: 60, real: [42.15, 40.14, 42.15, 41.23, 42.1, 42, 42.50, null, null, null, null, null] },
          { name: "SUMUR 6 ( TLGS 2 )", sub: "Telaga Sari", awal: 95, real: [83.074, 81.5, 84.3, 86.1, 86.5, 85.85, 86.02, null, null, null, null, null] },
          { name: "SUMUR 7 ( MTD )", sub: "Marthadinata", awal: 95, real: [80.52, 79.63, 80.59, 81.639, 80.678, 81.41, 81.98, null, null, null, null, null] }
        ]},
        { no: 2, ipa: "IPA KP. DAMAI", wells: [
          { name: "SUMUR 1", sub: "Parkiran IPA", awal: 46, real: [37.74193548, 39, 37.67234043, 37.58445441, 34.82288828, 36.35974304, 34.21, null, null, null, null, null] },
          { name: "SUMUR 2", sub: "Gas Chlor", awal: 60, real: [57.48387097, 57, 57, 56.73737374, 57, 78.26356589, 57.00, null, null, null, null, null] },
          { name: "SUMUR 3 (TNGKI)", sub: "Terminal Tangki", awal: 46, real: [32.73387097, 33, 33, 32.91304348, 38.32697548, 69.36416185, 50.00, null, null, null, null, null] },
          { name: "SUMUR 5 (PGG)", sub: "Penggalang", awal: 77, real: [75, 69.36607143, 74.5672043, 76.55057803, 80, 140.3884244, 76.00, null, null, null, null, null] }
        ]},
        { no: 3, ipa: "IPA PRAPATAN", wells: [
          { name: "SUMUR 1", sub: "Puskesmas", awal: 95, real: [94.25311203, 84.90771558, 78.35535185, 78.95416667, 78.07201087, 86.21426012, 91.27, null, null, null, null, null] },
          { name: "SUMUR 2", sub: "Dalam IPA", awal: 95, real: [81.30493577, 76.56030534, 70.29118361, 71.17361111, 72.22841604, 84.05159441, 89.54, null, null, null, null, null] },
          { name: "SUMUR 3", sub: "Jl Pahala", awal: 60, real: [52.00546822, 59.47806354, 56.93717983, 48.91551182, 40.21889871, 44.73463485, 46.63, null, null, null, null, null] }
        ]},
        { no: 4, ipa: "IPA ZAMP", wells: [
          { name: "SUMUR 2", sub: "Jl Belibis V", awal: 10, real: [9.920054201, 9.733931241, 9.429775281, 9.247552448, 11.26863572, 11.3125, 12.12, null, null, null, null, null] },
          { name: "SUMUR 3", sub: "Koperasi PTMB", awal: 30, real: [29.6504065, 29.95814649, 28.84831461, 28.55804196, 31.5952381, 7.578703704, 5.62, null, null, null, null, null] }
        ]},
        { no: 5, ipa: "IPA KP BARU ULU", wells: [
          { name: "SUMUR 1", sub: "Dalam Area IPA", awal: 60, real: [55.4516129, 56.06567164, 56.65860215, 57.28472222, 57.96370968, 50.81527778, 49.71, null, null, null, null, null] },
          { name: "SUMUR 2", sub: "SMA 3", awal: 10, real: [9.436827957, 10.21044776, 9.752688172, 9.940194715, 9.866935484, 7.522222222, 7.36, null, null, null, null, null] },
          { name: "SUMUR 3", sub: "Kantor LPM", awal: 46, real: [35.4574217, 40.04626866, 41.3243607, 39.79166667, 38.85887097, 38.00698324, 36.97, null, null, null, null, null] }
        ]}
      ],
      keterangan: [
        "Debit awal adalah Kapasitas Pompa",
        "Sumur no 5 Gunung Sari diatur debit agar air tidak keruh",
        "Sumur no 3 Kampung Baru diatur agar air tidak keruh",
        "Sumur no 1 Kampung Damai diatur agar air tidak keruh",
        "Sumur no 3 Prapatan dikurangi kapasitas pompa nya",
        "Sumur no 3 Zamp mengalami kerusakan konstruksi"
      ]
    }
  };

  var currentYear = "2026";
  var currentPeriod = 0; // 0 = Jan-Jun, 1 = Jul-Dec
  var printMode = true;

  function state() { return DATA_BY_YEAR[currentYear]; }

  function fmt(n, d) {
    if (n === null || n === undefined || isNaN(n)) return "";
    return n.toLocaleString("id-ID", { minimumFractionDigits: d, maximumFractionDigits: d });
  }

  function ratioClass(pct) {
    if (pct === null) return "dim";
    if (pct >= 95) return "good";
    if (pct >= 85) return "warn";
    return "bad";
  }

  function monthIndexesFor(period) {
    return period === 0 ? [0, 1, 2, 3, 4, 5] : [6, 7, 8, 9, 10, 11];
  }

  function buildHead(period) {
    var idxs = monthIndexesFor(period);
    var r1 = '<tr class="r1"><th rowspan="3" style="min-width:34px;">NO</th><th rowspan="3" style="min-width:168px;">IPA / NO. SUMUR</th><th rowspan="3" style="min-width:84px;">DEBIT AWAL<br>(m&sup3;/jam)</th>';
    idxs.forEach(function (mi) { r1 += '<th class="month" colspan="3">' + MONTHS[mi] + '</th>'; });
    r1 += '</tr>';
    var r2 = '<tr class="r2">';
    idxs.forEach(function () { r2 += '<th>REAL</th><th colspan="2">RATIO EFFISIENSI</th>'; });
    r2 += '</tr>';
    var r3 = '<tr class="r3">';
    idxs.forEach(function () { r3 += '<th></th><th>±</th><th>%</th>'; });
    r3 += '</tr>';
    return r1 + r2 + r3;
  }

  function cellReal(well, mi) {
    var v = well.real[mi];
    var hasData = v !== null;
    var cls = hasData ? "web" : "empty";
    var val = hasData ? fmt(v, 2) : "";
    var readonly = hasData ? "readonly" : "";
    return '<td class="real"><div class="cellwrap ' + cls + '">' +
      '<input class="cell" type="text" value="' + val + '" ' + readonly +
      ' data-role="real" placeholder="—"></div></td>';
  }

  function cellRatio(well, mi, kind) {
    var real = well.real[mi];
    var hasData = real !== null;
    var pm = hasData ? (real - well.awal) : null;
    var pct = hasData ? (real / well.awal * 100) : null;
    var val = kind === "pm" ? pm : pct;
    var text = hasData ? (kind === "pm" ? (val >= 0 ? "+" : "") + fmt(val, 2) : fmt(val, 1) + "%") : "–";
    var cls = ratioClass(hasData ? pct : null);
    var hidePrint = (!hasData && printMode);
    return '<td class="ratio"><div class="cellwrap"><span class="pill ' + (hidePrint ? "" : cls) + '" ' +
      (hidePrint ? 'style="color:var(--bg);background:var(--bg);"' : '') +
      '>' + text + '</span></div></td>';
  }

  function renderTable() {
    var table = document.getElementById("mainTable");
    var idxs = monthIndexesFor(currentPeriod);
    var html = "<thead>" + buildHead(currentPeriod) + "</thead><tbody>";
    var no = 0;
    var groups = state().groups;

    groups.forEach(function (g) {
      no++;
      var span = 3 + idxs.length * 3 - 2;
      html += '<tr class="grouphead"><td>' + no + '</td><td colspan="' + span + '" class="tag">' + g.ipa + ' <span class="name-flag">Data Waduk &amp; Sumur</span></td></tr>';

      var sums = { awal: 0 }; idxs.forEach(function (mi) { sums[mi] = 0; });

      g.wells.forEach(function (w) {
        sums.awal += w.awal;
        html += '<tr><td class="no"></td><td class="name">' + w.name + '<span class="sub">' + w.sub + '</span></td>';
        html += '<td class="awal"><div class="cellwrap"><input class="cell" type="text" value="' + fmt(w.awal, 0) + '" data-role="awal"></div></td>';
        idxs.forEach(function (mi) {
          if (w.real[mi] !== null) sums[mi] += w.real[mi];
          html += cellReal(w, mi) + cellRatio(w, mi, "pm") + cellRatio(w, mi, "pct");
        });
        html += '</tr>';
      });

      html += '<tr class="sum"><td></td><td>JUMLAH</td><td><div class="cellwrap" style="justify-content:flex-end;">' + fmt(sums.awal, 0) + '</div></td>';
      idxs.forEach(function (mi) {
        var anyData = g.wells.some(function (w) { return w.real[mi] !== null; });
        html += '<td><div class="cellwrap" style="justify-content:flex-end;">' + (anyData ? fmt(sums[mi], 2) : '') + '</div></td><td></td><td></td>';
      });
      html += '</tr>';
    });

    html += '<tr class="avg"><td></td><td>RATA-RATA EFISIENSI</td><td></td>';
    idxs.forEach(function (mi) {
      var vals = [];
      groups.forEach(function (g) { g.wells.forEach(function (w) {
        if (w.real[mi] !== null) vals.push(w.real[mi] / w.awal * 100);
      }); });
      var avg = vals.length ? vals.reduce(function (a, b) { return a + b; }, 0) / vals.length : null;
      html += '<td></td><td></td><td><div class="cellwrap" style="justify-content:center;">' + (avg !== null ? fmt(avg, 1) + '%' : '–') + '</div></td>';
    });
    html += '</tr></tbody>';
    table.innerHTML = html;

    document.getElementById("tableFoot").innerHTML =
      'Sumber Real: <b>Data &amp; Visualisasi → Data Waduk dan Sumur → Sumur Dalam → Debit Sumur</b> · ' +
      'Format unduhan mengikuti <b>18.2 Ukur Debit.xlsx</b> persis (dua blok 6 bulan, JUMLAH per IPA, RATA-RATA di bawah).';

    table.querySelectorAll('input[data-role="awal"]').forEach(function (inp, i) {
      inp.addEventListener("change", function () {
        var flat = [];
        groups.forEach(function (g) { g.wells.forEach(function (w) { flat.push(w); }); });
        var w = flat[i];
        var n = parseFloat(inp.value.replace(",", "."));
        if (!isNaN(n)) { w.awal = n; renderTable(); renderStats(); toast("Debit awal " + w.name + " diperbarui → " + fmt(n, 0) + " m³/jam"); }
        else { inp.value = fmt(w.awal, 0); }
      });
    });
  }

  function renderStats() {
    var totalWell = 0, totalAwal = 0, pcts = [];
    var idxs = monthIndexesFor(currentPeriod);
    var groups = state().groups;
    groups.forEach(function (g) { g.wells.forEach(function (w) {
      totalWell++; totalAwal += w.awal;
      idxs.forEach(function (mi) { if (w.real[mi] !== null) pcts.push(w.real[mi] / w.awal * 100); });
    }); });
    var avgPct = pcts.length ? pcts.reduce(function (a, b) { return a + b; }, 0) / pcts.length : 0;
    var cls = avgPct >= 95 ? "good" : (avgPct >= 85 ? "warn" : "");
    var stat = document.getElementById("statRow");
    stat.innerHTML =
      '<div class="stat"><div class="k">IPA</div><div class="v">' + groups.length + '</div></div>' +
      '<div class="stat"><div class="k">Total sumur</div><div class="v">' + totalWell + '</div></div>' +
      '<div class="stat"><div class="k">Kapasitas total</div><div class="v">' + fmt(totalAwal, 0) + ' m³/jam</div></div>' +
      '<div class="stat"><div class="k">Rata-rata efisiensi</div><div class="v ' + cls + '">' + (pcts.length ? fmt(avgPct, 1) + '%' : '–') + '</div></div>';
  }

  function renderKet() {
    var list = document.getElementById("ketList");
    var keterangan = state().keterangan;
    list.innerHTML = keterangan.map(function (k, i) {
      return '<div class="kline"><span class="mark">~</span><input value="' + k.replace(/"/g, '&quot;') + '" data-i="' + i + '"><button data-del="' + i + '" title="Hapus">×</button></div>';
    }).join("");
    list.querySelectorAll("input").forEach(function (inp) {
      inp.addEventListener("change", function () { keterangan[+inp.dataset.i] = inp.value; });
    });
    list.querySelectorAll("button[data-del]").forEach(function (btn) {
      btn.addEventListener("click", function () { keterangan.splice(+btn.dataset.del, 1); renderKet(); });
    });
  }

  function renderYearSelect() {
    var sel = document.getElementById("yearSelect");
    var years = Object.keys(DATA_BY_YEAR).sort();
    sel.innerHTML = years.map(function (y) {
      return '<option value="' + y + '"' + (y === currentYear ? ' selected' : '') + '>' + y + '</option>';
    }).join("");
    sel.addEventListener("change", function () {
      currentYear = sel.value;
      renderAll();
    });
  }

  function toast(msg) {
    var t = document.getElementById("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(t._h);
    t._h = setTimeout(function () { t.classList.remove("show"); }, 2800);
  }

  function renderAll() {
    renderTable();
    renderStats();
    renderKet();
  }

  document.getElementById("periodTabs").addEventListener("click", function (e) {
    var b = e.target.closest(".tab"); if (!b) return;
    document.querySelectorAll(".tab").forEach(function (t) { t.classList.remove("active"); });
    b.classList.add("active");
    currentPeriod = +b.dataset.period;
    renderTable(); renderStats();
  });

  var printSwitch = document.getElementById("printSwitch");
  printSwitch.addEventListener("click", function () {
    printMode = !printMode;
    printSwitch.classList.toggle("on", printMode);
    renderTable();
  });

  document.getElementById("addKet").addEventListener("click", function () {
    state().keterangan.push(""); renderKet();
  });

  document.getElementById("downloadBtn").addEventListener("click", function () {
    toast("Contoh saja untuk saat ini — export .xlsx dengan format identik seperti lampiran akan disambungkan di iterasi berikutnya.");
  });

  var fetching = false;
  document.getElementById("fetchBtn").addEventListener("click", function () {
    if (fetching) return;
    fetching = true;
    var btn = document.getElementById("fetchBtn");
    var oldHtml = btn.innerHTML;
    btn.innerHTML = '<span class="spin"></span> Menarik dari Debit Sumur…';
    btn.disabled = true;
    setTimeout(function () {
      state().groups.forEach(function (g) { g.wells.forEach(function (w) {
        for (var mi = 0; mi < 12; mi++) {
          if (w.real[mi] !== null) {
            var jitter = (Math.round((Math.random() - 0.5) * 10)) / 100;
            w.real[mi] = Math.round((w.real[mi] + jitter) * 1000) / 1000;
          }
        }
      }); });
      btn.innerHTML = oldHtml;
      btn.disabled = false;
      fetching = false;
      renderTable(); renderStats();
      toast("Data dari Debit Sumur berhasil ditarik ulang (simulasi).");
    }, 900);
  });

  renderYearSelect();
  renderAll();
})();
