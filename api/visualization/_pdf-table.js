const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

const MARGIN = 40;
const ROW_HEIGHT = 16;
const HEADER_FILL = rgb(11 / 255, 85 / 255, 102 / 255);
const TOTAL_FILL = rgb(220 / 255, 238 / 255, 241 / 255);

// Bangun PDF sederhana: judul + subjudul + tabel (dengan header berulang
// tiap halaman baru kalau baris meluap). Dipakai untuk export-pdf.js
// supaya PDF digenerate langsung dari data asli di server, bukan file statis.
async function buildTablePdf({ title, subtitle, columns, rows, totalRowIndex, landscape }) {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const pageSize = landscape ? [841.89, 595.28] : [595.28, 841.89];
  const contentWidth = pageSize[0] - MARGIN * 2;

  const totalWeight = columns.reduce((s, c) => s + c.weight, 0);
  const colWidths = columns.map(c => (c.weight / totalWeight) * contentWidth);

  let page = pdfDoc.addPage(pageSize);
  let y = pageSize[1] - MARGIN;

  function drawTitle() {
    page.drawText(title, { x: MARGIN, y, size: 13, font: boldFont, color: rgb(0.05, 0.16, 0.2) });
    y -= 16;
    if (subtitle) {
      page.drawText(subtitle, { x: MARGIN, y, size: 9, font, color: rgb(0.3, 0.4, 0.44) });
      y -= 18;
    } else {
      y -= 6;
    }
  }

  function drawHeaderRow() {
    page.drawRectangle({ x: MARGIN, y: y - ROW_HEIGHT + 4, width: contentWidth, height: ROW_HEIGHT, color: HEADER_FILL });
    let x = MARGIN;
    columns.forEach((c, i) => {
      page.drawText(String(c.header), { x: x + 4, y: y - ROW_HEIGHT + 8, size: 8.5, font: boldFont, color: rgb(1, 1, 1) });
      x += colWidths[i];
    });
    y -= ROW_HEIGHT;
  }

  function newPage() {
    page = pdfDoc.addPage(pageSize);
    y = pageSize[1] - MARGIN;
    drawHeaderRow();
  }

  drawTitle();
  drawHeaderRow();

  rows.forEach((rowCells, rowIdx) => {
    if (y - ROW_HEIGHT < MARGIN) newPage();
    if (rowIdx === totalRowIndex) {
      page.drawRectangle({ x: MARGIN, y: y - ROW_HEIGHT + 4, width: contentWidth, height: ROW_HEIGHT, color: TOTAL_FILL });
    }
    let x = MARGIN;
    rowCells.forEach((cell, i) => {
      const useFont = rowIdx === totalRowIndex ? boldFont : font;
      page.drawText(String(cell), { x: x + 4, y: y - ROW_HEIGHT + 8, size: 8.5, font: useFont, color: rgb(0.05, 0.16, 0.2) });
      x += colWidths[i];
    });
    y -= ROW_HEIGHT;
  });

  return pdfDoc.save();
}

module.exports = { buildTablePdf };
