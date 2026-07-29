const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

const MARGIN = 40;
const ROW_HEIGHT = 16;
const HEADER_FILL = rgb(11 / 255, 85 / 255, 102 / 255);
const TOTAL_FILL = rgb(220 / 255, 238 / 255, 241 / 255);

// Grafik yang ikut disisipkan tidak boleh menghabiskan halaman pertama --
// tabelnya harus tetap kebagian tempat. 42% tinggi halaman sudah cukup besar
// untuk dibaca tanpa mengusir seluruh baris ke halaman berikutnya.
const CHART_MAX_HEIGHT_RATIO = 0.42;

// Penanda asal data di pojok kanan atas SETIAP halaman. Berkas PDF gampang
// beredar lepas dari halamannya -- diteruskan lewat WhatsApp, dicetak, ditaruh
// di folder bersama -- jadi keterangan dari mana angkanya berasal dan siapa
// yang merekapnya harus ikut menempel di berkasnya, bukan cuma di layar.
//
// Ditaruh di pita atas sendiri, tidak sebaris dengan judul: subjudul dataset
// bisa panjang (nama instalasi + rentang tahun + satuan) dan akan bertabrakan
// kalau penandanya dipasang sejajar.
const PENANDA = [
  'Data diambil dari web pottersab.com',
  'Data direkap oleh M Rahmad Hidayat',
  'Sub Divisi Sumber Air Baku'
];
const PENANDA_SIZE = 7.5;
const PENANDA_LEADING = 9.5;
const PENANDA_JEDA = 8; // jarak penanda ke judul di bawahnya
const PENANDA_TINGGI = PENANDA.length * PENANDA_LEADING + PENANDA_JEDA;

// Bangun PDF sederhana dari 1 atau lebih "section" (tiap section = judul +
// subjudul + tabel sendiri, selalu mulai di halaman baru). Header tabel
// berulang tiap kali baris meluap ke halaman baru dalam section yang sama.
// Dipakai export-pdf.js supaya PDF digenerate langsung dari data asli di
// server, bukan file statis.
//
// section.chartPng (opsional) berisi PNG grafik yang sedang tampil di layar,
// dikirim client sebagai data URL. Digambar di antara subjudul dan tabel.
async function buildTablePdf({ landscape, sections }) {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const pageSize = landscape ? [841.89, 595.28] : [595.28, 841.89];
  const contentWidth = pageSize[0] - MARGIN * 2;

  let page, y;

  function drawHeaderRow(columns, colWidths) {
    page.drawRectangle({ x: MARGIN, y: y - ROW_HEIGHT + 4, width: contentWidth, height: ROW_HEIGHT, color: HEADER_FILL });
    let x = MARGIN;
    columns.forEach((c, i) => {
      page.drawText(String(c.header), { x: x + 4, y: y - ROW_HEIGHT + 8, size: 8.5, font: boldFont, color: rgb(1, 1, 1) });
      x += colWidths[i];
    });
    y -= ROW_HEIGHT;
  }

  // Rata kanan, jadi lebarnya dihitung dari teksnya sendiri.
  function gambarPenanda() {
    let yy = pageSize[1] - MARGIN;
    PENANDA.forEach(teks => {
      const lebar = font.widthOfTextAtSize(teks, PENANDA_SIZE);
      page.drawText(teks, {
        x: pageSize[0] - MARGIN - lebar, y: yy,
        size: PENANDA_SIZE, font, color: rgb(0.55, 0.62, 0.65)
      });
      yy -= PENANDA_LEADING;
    });
  }

  // Semua halaman lewat sini, jadi penandanya tidak mungkin terlewat di
  // halaman lanjutan waktu tabelnya meluap.
  function tambahHalaman() {
    page = pdfDoc.addPage(pageSize);
    gambarPenanda();
    y = pageSize[1] - MARGIN - PENANDA_TINGGI;
  }

  function newPage(columns, colWidths) {
    tambahHalaman();
    drawHeaderRow(columns, colWidths);
  }

  for (const section of sections) {
    const totalWeight = section.columns.reduce((s, c) => s + c.weight, 0);
    const colWidths = section.columns.map(c => (c.weight / totalWeight) * contentWidth);

    tambahHalaman();

    page.drawText(section.title, { x: MARGIN, y, size: 13, font: boldFont, color: rgb(0.05, 0.16, 0.2) });
    y -= 16;
    if (section.subtitle) {
      page.drawText(section.subtitle, { x: MARGIN, y, size: 9, font, color: rgb(0.3, 0.4, 0.44) });
      y -= 18;
    } else {
      y -= 6;
    }

    // PNG yang rusak/terpotong tidak boleh menggagalkan seluruh unduhan --
    // lebih baik PDF-nya keluar dengan tabel saja daripada tombolnya error.
    if (section.chartPng) {
      try {
        const img = await pdfDoc.embedPng(section.chartPng);
        const maxHeight = pageSize[1] * CHART_MAX_HEIGHT_RATIO;
        let w = contentWidth;
        let h = (img.height / img.width) * w;
        if (h > maxHeight) { h = maxHeight; w = (img.width / img.height) * h; }
        page.drawImage(img, { x: MARGIN, y: y - h, width: w, height: h });
        y -= h + 14;
      } catch (err) {
        console.error('Grafik gagal disisipkan ke PDF, dilanjutkan tanpa grafik', err);
      }
    }

    drawHeaderRow(section.columns, colWidths);

    section.rows.forEach((rowCells, rowIdx) => {
      if (y - ROW_HEIGHT < MARGIN) newPage(section.columns, colWidths);
      if (rowIdx === section.totalRowIndex) {
        page.drawRectangle({ x: MARGIN, y: y - ROW_HEIGHT + 4, width: contentWidth, height: ROW_HEIGHT, color: TOTAL_FILL });
      }
      let x = MARGIN;
      rowCells.forEach((cell, i) => {
        const useFont = rowIdx === section.totalRowIndex ? boldFont : font;
        page.drawText(String(cell), { x: x + 4, y: y - ROW_HEIGHT + 8, size: 8.5, font: useFont, color: rgb(0.05, 0.16, 0.2) });
        x += colWidths[i];
      });
      y -= ROW_HEIGHT;
    });
  }

  return pdfDoc.save();
}

module.exports = { buildTablePdf };
