/* ===========================================================================
   GRAFIK NATIF DI BERKAS EXCEL
   ---------------------------------------------------------------------------
   SheetJS versi Community yang dipakai situs ini tidak bisa menyisipkan apa
   pun ke dalam sheet selain sel -- gambar maupun grafik dibuang diam-diam
   waktu berkas ditulis (fitur berbayar). Jadi grafiknya dirakit sendiri di
   sini: berkas .xlsx sebenarnya cuma ZIP berisi XML, dan bagian grafiknya
   ditambahkan setelah SheetJS selesai menulis datanya.

   Yang dihasilkan GRAFIK EXCEL ASLI -- bukan gambar. Bisa diklik, diubah
   jenisnya, diganti warnanya, dan ikut berubah kalau angkanya diedit, karena
   serinya menunjuk ke sel (=SERIES(...)), bukan menyalin nilainya.

   Bagian yang ditambahkan ke dalam ZIP:
     xl/charts/chart1.xml               definisi grafiknya
     xl/drawings/drawing1.xml           tempat & ukurannya di atas sheet
     xl/drawings/_rels/drawing1.xml.rels    drawing -> chart
     xl/worksheets/_rels/sheet1.xml.rels    sheet   -> drawing
   ditambah <drawing/> di sheet1.xml dan dua Override di [Content_Types].xml.

   PENTING: urutan elemen di XML OOXML itu wajib (schema sequence), bukan
   sekadar rapi. Salah urut = Excel menolak berkasnya dan menawarkan
   "repair". Urutan di bawah mengikuti CT_Chart, CT_PlotArea, CT_LineChart,
   CT_LineSer, CT_CatAx, dan CT_ValAx di ECMA-376. Jangan ditukar-tukar tanpa
   menguji ulang dengan membuka hasilnya di Excel sungguhan.

   Butuh JSZip. Kalau JSZip tidak termuat, pemanggilnya harus jatuh balik ke
   XLSX.writeFile biasa -- lebih baik Excel tanpa grafik daripada gagal unduh.
   =========================================================================== */

(function () {
  const NS_C = 'http://schemas.openxmlformats.org/drawingml/2006/chart';
  const NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
  const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const NS_XDR = 'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing';
  const XD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n';

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // Nama sheet di dalam rumus selalu dikutip tunggal; apostrof di dalam
  // namanya sendiri digandakan, sama seperti aturan rumus Excel biasa.
  function sheetRef(nama) {
    return "'" + String(nama).replace(/'/g, "''") + "'";
  }

  function chartXml(o) {
    const sh = sheetRef(o.namaSheet);
    const akhir = o.jumlahBaris + 1; // +1 karena baris 1 dipakai header
    return XD +
      `<c:chartSpace xmlns:c="${NS_C}" xmlns:a="${NS_A}" xmlns:r="${NS_R}">` +
      '<c:chart>' +
        '<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/>' +
          '<a:p><a:pPr><a:defRPr sz="1200"/></a:pPr>' +
          `<a:r><a:rPr lang="id-ID" sz="1200"/><a:t>${esc(o.judul)}</a:t></a:r></a:p>` +
          '</c:rich></c:tx><c:overlay val="0"/></c:title>' +
        '<c:autoTitleDeleted val="0"/>' +
        '<c:plotArea><c:layout/>' +
          '<c:lineChart>' +
            '<c:grouping val="standard"/><c:varyColors val="0"/>' +
            '<c:ser>' +
              '<c:idx val="0"/><c:order val="0"/>' +
              `<c:tx><c:strRef><c:f>${sh}!$B$1</c:f></c:strRef></c:tx>` +
              `<c:spPr><a:ln w="19050"><a:solidFill><a:srgbClr val="${o.warna || '0B5566'}"/></a:solidFill></a:ln></c:spPr>` +
              '<c:marker><c:symbol val="none"/></c:marker>' +
              `<c:cat><c:strRef><c:f>${sh}!$A$2:$A$${akhir}</c:f></c:strRef></c:cat>` +
              `<c:val><c:numRef><c:f>${sh}!$B$2:$B$${akhir}</c:f></c:numRef></c:val>` +
              '<c:smooth val="0"/>' +
            '</c:ser>' +
            '<c:marker val="1"/>' +
            '<c:axId val="111111111"/><c:axId val="222222222"/>' +
          '</c:lineChart>' +
          '<c:catAx>' +
            '<c:axId val="111111111"/>' +
            '<c:scaling><c:orientation val="minMax"/></c:scaling>' +
            '<c:delete val="0"/><c:axPos val="b"/>' +
            '<c:tickLblPos val="nextTo"/>' +
            '<c:crossAx val="222222222"/><c:crosses val="autoZero"/><c:auto val="1"/>' +
            '<c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/>' +
          '</c:catAx>' +
          '<c:valAx>' +
            '<c:axId val="222222222"/>' +
            '<c:scaling><c:orientation val="minMax"/></c:scaling>' +
            '<c:delete val="0"/><c:axPos val="l"/>' +
            '<c:majorGridlines/>' +
            '<c:numFmt formatCode="General" sourceLinked="1"/>' +
            '<c:tickLblPos val="nextTo"/>' +
            '<c:crossAx val="111111111"/><c:crosses val="autoZero"/><c:crossBetween val="between"/>' +
          '</c:valAx>' +
        '</c:plotArea>' +
        '<c:legend><c:legendPos val="b"/><c:overlay val="0"/></c:legend>' +
        '<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/>' +
      '</c:chart>' +
      '</c:chartSpace>';
  }

  // Grafik ditaruh di sebelah kanan data (mulai kolom D) supaya tidak
  // menutupi angkanya, dan cukup besar untuk langsung terbaca.
  function drawingXml() {
    return XD +
      `<xdr:wsDr xmlns:xdr="${NS_XDR}" xmlns:a="${NS_A}" xmlns:r="${NS_R}">` +
      '<xdr:twoCellAnchor>' +
        '<xdr:from><xdr:col>3</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>1</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>' +
        '<xdr:to><xdr:col>15</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>24</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>' +
        '<xdr:graphicFrame macro="">' +
          '<xdr:nvGraphicFramePr><xdr:cNvPr id="2" name="Grafik 1"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>' +
          '<xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm>' +
          `<a:graphic><a:graphicData uri="${NS_C}">` +
            `<c:chart xmlns:c="${NS_C}" r:id="rId1"/>` +
          '</a:graphicData></a:graphic>' +
        '</xdr:graphicFrame>' +
        '<xdr:clientData/>' +
      '</xdr:twoCellAnchor>' +
      '</xdr:wsDr>';
  }

  function rels(target, tipe) {
    return XD +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      `<Relationship Id="rId1" Type="${tipe}" Target="${target}"/>` +
      '</Relationships>';
  }

  /**
   * @param {ArrayBuffer|Uint8Array} bufferXlsx keluaran XLSX.write(..., {type:'array'})
   * @param {{namaSheet:string, judul:string, jumlahBaris:number, warna?:string}} opsi
   * @returns {Promise<Blob>} xlsx yang sudah bergrafik
   */
  async function tempelGrafikGaris(bufferXlsx, opsi) {
    if (typeof JSZip === 'undefined') throw new Error('JSZip tidak termuat');
    if (!opsi.jumlahBaris || opsi.jumlahBaris < 2) throw new Error('data terlalu sedikit untuk digrafikkan');

    const zip = await JSZip.loadAsync(bufferXlsx);

    const SHEET = 'xl/worksheets/sheet1.xml';
    if (!zip.file(SHEET)) throw new Error('sheet1.xml tidak ditemukan');

    zip.file('xl/charts/chart1.xml', chartXml(opsi));
    zip.file('xl/drawings/drawing1.xml', drawingXml());
    zip.file('xl/drawings/_rels/drawing1.xml.rels',
      rels('../charts/chart1.xml', NS_R + '/chart'));

    // Sheet dari SheetJS tidak punya berkas rels sendiri untuk kasus ini;
    // kalau suatu saat punya (mis. ada hyperlink), jangan ditimpa.
    const relSheet = 'xl/worksheets/_rels/sheet1.xml.rels';
    if (zip.file(relSheet)) throw new Error('sheet1 sudah punya rels, penambahan grafik dilewati');
    zip.file(relSheet, rels('../drawings/drawing1.xml', NS_R + '/drawing'));

    // <drawing/> letaknya paling belakang dalam urutan CT_Worksheet (setelah
    // ignoredErrors), jadi tepat sebelum penutup </worksheet>.
    let sheetXml = await zip.file(SHEET).async('string');
    sheetXml = sheetXml.replace('</worksheet>', '<drawing r:id="rId1"/></worksheet>');
    zip.file(SHEET, sheetXml);

    let ct = await zip.file('[Content_Types].xml').async('string');
    if (ct.indexOf('Extension="rels"') === -1) {
      ct = ct.replace('<Types ', '<Types ').replace(/(<Types[^>]*>)/,
        '$1<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>');
    }
    ct = ct.replace('</Types>',
      '<Override PartName="/xl/drawings/drawing1.xml" ' +
      'ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>' +
      '<Override PartName="/xl/charts/chart1.xml" ' +
      'ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>' +
      '</Types>');
    zip.file('[Content_Types].xml', ct);

    return zip.generateAsync({
      type: 'blob',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      compression: 'DEFLATE'
    });
  }

  function unduhBlob(blob, namaBerkas) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = namaBerkas;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  window.XlsxGrafik = { tempelGrafikGaris, unduhBlob };
})();
