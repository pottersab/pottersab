const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

const MARGIN = 40;
const ROW_HEIGHT = 16;
const HEADER_FILL = rgb(11 / 255, 85 / 255, 102 / 255);
const TOTAL_FILL = rgb(220 / 255, 238 / 255, 241 / 255);

// Bangun PDF sederhana dari 1 atau lebih "section" (tiap section = judul +
// subjudul + tabel sendiri, selalu mulai di halaman baru). Header tabel
// berulang tiap kali baris meluap ke halaman baru dalam section yang sama.
// Dipakai export-pdf.js supaya PDF digenerate langsung dari data asli di
// server, bukan file statis.
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

  function newPage(columns, colWidths) {
    page = pdfDoc.addPage(pageSize);
    y = pageSize[1] - MARGIN;
    drawHeaderRow(columns, colWidths);
  }

  sections.forEach(section => {
    const totalWeight = section.columns.reduce((s, c) => s + c.weight, 0);
    const colWidths = section.columns.map(c => (c.weight / totalWeight) * contentWidth);

    page = pdfDoc.addPage(pageSize);
    y = pageSize[1] - MARGIN;

    page.drawText(section.title, { x: MARGIN, y, size: 13, font: boldFont, color: rgb(0.05, 0.16, 0.2) });
    y -= 16;
    if (section.subtitle) {
      page.drawText(section.subtitle, { x: MARGIN, y, size: 9, font, color: rgb(0.3, 0.4, 0.44) });
      y -= 18;
    } else {
      y -= 6;
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
  });

  return pdfDoc.save();
}

module.exports = { buildTablePdf };
