// Builder Surat Permohonan (.docx) -- diekstrak dari apps/surat-permohonan.html
// supaya bisa dipakai ulang dari admin-dashboard.html (fitur "Unduh Ulang"
// di Riwayat Surat). surat-permohonan.html sendiri tetap generate langsung
// dari form (fungsi-fungsi di bawah ini juga masih ada versi aslinya di sana).
//
// Dibungkus IIFE supaya nama internal (crc32, createZip, run, para, dst)
// tidak bentrok dengan builder jenis surat lain yang di-load bersamaan di
// admin-dashboard.html.
window.SuratPermohonanBuilder = (function () {
const LOGO_B64 = window.KopAssets.LOGO;

/* =============== Util: ZIP (metode STORE, tanpa kompresi) =============== */
function crc32(bytes){
  let crc=0xFFFFFFFF;
  for(let i=0;i<bytes.length;i++){
    let c=(crc^bytes[i])&0xFF;
    for(let j=0;j<8;j++) c=(c&1)?(0xEDB88320^(c>>>1)):(c>>>1);
    crc=(crc>>>8)^c;
  }
  return (crc^0xFFFFFFFF)>>>0;
}
function u16(n){return [n&0xFF,(n>>8)&0xFF];}
function u32(n){return [n&0xFF,(n>>>8)&0xFF,(n>>>16)&0xFF,(n>>>24)&0xFF];}
function strToBytes(s){return new TextEncoder().encode(s);}
function b64ToBytes(b64){
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++) arr[i]=bin.charCodeAt(i);
  return arr;
}
function createZip(files){
  const localParts=[], central=[];
  let offset=0;
  const dosTime=0, dosDate=0x5821;
  for(const f of files){
    const nameBytes=strToBytes(f.name);
    const data=f.data;
    const crc=crc32(data);
    const size=data.length;
    let lh=[];
    lh.push(...u32(0x04034b50),...u16(20),...u16(0x0800),...u16(0),...u16(dosTime),...u16(dosDate),
      ...u32(crc),...u32(size),...u32(size),...u16(nameBytes.length),...u16(0),...nameBytes);
    const localHeaderBytes=new Uint8Array(lh);
    localParts.push(localHeaderBytes,data);
    let ch=[];
    ch.push(...u32(0x02014b50),...u16(20),...u16(20),...u16(0x0800),...u16(0),...u16(dosTime),...u16(dosDate),
      ...u32(crc),...u32(size),...u32(size),...u16(nameBytes.length),...u16(0),...u16(0),...u16(0),...u16(0),
      ...u32(0),...u32(offset),...nameBytes);
    central.push(new Uint8Array(ch));
    offset += localHeaderBytes.length + data.length;
  }
  const centralStart=offset;
  let centralSize=0;
  for(const c of central) centralSize+=c.length;
  let eocd=[];
  eocd.push(...u32(0x06054b50),...u16(0),...u16(0),...u16(files.length),...u16(files.length),
    ...u32(centralSize),...u32(centralStart),...u16(0));
  const parts=[...localParts,...central,new Uint8Array(eocd)];
  let total=0; for(const p of parts) total+=p.length;
  const out=new Uint8Array(total);
  let pos=0;
  for(const p of parts){ out.set(p,pos); pos+=p.length; }
  return out;
}

/* =============== Util: tanggal & romawi bahasa Indonesia =============== */
const BULAN=['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
const ROMAWI=['I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII'];

function parseDateLocal(dstr){
  if(!dstr) return null;
  const [y,m,d]=dstr.split('-').map(Number);
  return new Date(y,m-1,d);
}
function formatTanggalPanjang(dstr){
  const d=parseDateLocal(dstr);
  if(!d) return '...';
  return `${d.getDate()} ${BULAN[d.getMonth()]} ${d.getFullYear()}`;
}
function romawiBulan(dstr){
  const d=parseDateLocal(dstr);
  if(!d) return '...';
  return ROMAWI[d.getMonth()];
}
function tahunSurat(dstr){
  const d=parseDateLocal(dstr);
  return d ? d.getFullYear() : '....';
}
function todayStr(){
  const d=new Date();
  const m=String(d.getMonth()+1).padStart(2,'0');
  const day=String(d.getDate()).padStart(2,'0');
  return `${d.getFullYear()}-${m}-${day}`;
}
function escXml(s){
  return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* =============== Wrap teks otomatis (untuk Perihal & Kepada Yth) =============== */
const _wrapCanvas = document.createElement('canvas');
const _wrapCtx = _wrapCanvas.getContext('2d');
function wrapTextLines(text, maxWidthPx, font){
  _wrapCtx.font = font;
  const paras = String(text||'').split(/\r?\n/);
  const lines = [];
  paras.forEach(p=>{
    const words = p.split(/\s+/).filter(Boolean);
    if(!words.length){ lines.push(''); return; }
    let cur = '';
    words.forEach(w=>{
      const test = cur ? cur+' '+w : w;
      if(_wrapCtx.measureText(test).width > maxWidthPx && cur){
        lines.push(cur); cur = w;
      } else cur = test;
    });
    if(cur) lines.push(cur);
  });
  return lines.length ? lines : [''];
}
const PERIHAL_FONT = "bold 16px 'Times New Roman', Times, serif";
const PERIHAL_MAXW = 240;
const KEPADA_FONT = "bold 16px 'Times New Roman', Times, serif";
const KEPADA_MAXW = 220;

/* =============== Default isi =============== */
const DEFAULTS = {
  noUrut:'',
  kode1:'',
  kode2:'',
  kodeAkhir:'',
  tanggalSurat: todayStr(),
  lampiran:'1 (satu) Berkas',
  perihal:'',
  kepadaIsi:'',
  poin1:'',
  poin2:'',
  ttdNama:'',
  ttdJabatan:'',
  ttdPerusahaan:'Perumda Tirta Manuntung Balikpapan',
};
const POIN3_TEXT = 'Demikian surat permohonan ini kami sampaikan. Atas perhatian dan kerjasamanya kami ucapkan terima kasih.';
const TEMBUSAN_ITEMS = [
  'Direksi Perumda Tirta Manuntung Balikpapan',
  'Dewan Pengawas Perumda Tirta Manuntung Balikpapan.',
  'Arsip.'
];

function nomorLengkap(src){
  src = src || {};
  const urut = src.noUrut || '...';
  const k1 = src.kode1 || '';
  const k2 = src.kode2 || '';
  const rom = romawiBulan(src.tanggalSurat);
  const th = tahunSurat(src.tanggalSurat);
  const akhir = (src.kodeAkhir||'').trim();
  return `${urut}/${k1}/${k2}/${rom}/${th}${akhir ? '-'+akhir : ''}`;
}

function run(text,{bold=false,underline=false,size=24,font='Times New Roman'}={}){
  return `<w:r><w:rPr><w:rFonts w:ascii="${font}" w:eastAsia="${font}" w:hAnsi="${font}" w:cs="${font}"/>${bold?'<w:b/><w:bCs/>':''}${underline?'<w:u w:val="single"/>':''}<w:color w:val="000000"/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr><w:t xml:space="preserve">${escXml(text)}</w:t></w:r>`;
}
function brRun(size=24){
  return `<w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:sz w:val="${size}"/></w:rPr><w:br/></w:r>`;
}
function tabRun(){
  return `<w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:sz w:val="24"/></w:rPr><w:tab/></w:r>`;
}
function para(runsXml,{align=null,after=120,indent=0,hanging=0,tabs=[],line=240}={}){
  const tabsXml = tabs.length ? `<w:tabs>${tabs.map(t=>`<w:tab w:val="${t.val||'left'}" w:pos="${t.pos}"/>`).join('')}</w:tabs>` : '';
  const indXml = indent ? `<w:ind w:left="${indent}"${hanging?` w:hanging="${hanging}"`:''}/>` : '';
  return `<w:p><w:pPr>${tabsXml}<w:spacing w:after="${after}" w:line="${line}" w:lineRule="auto"/>${indXml}${align?`<w:jc w:val="${align}"/>`:''}</w:pPr>${runsXml}</w:p>`;
}
function emptyPara(after=120,{indent=0}={}){
  const indXml = indent ? `<w:ind w:left="${indent}"/>` : '';
  return `<w:p><w:pPr><w:spacing w:after="${after}" w:line="240" w:lineRule="auto"/>${indXml}</w:pPr></w:p>`;
}
function multilineParagraph(lines,{bold=false,size=24,underlineLast=false,align=null,after=0}={}){
  let runs = '';
  lines.forEach((ln,i)=>{
    if(i>0) runs += brRun(size);
    const isLast = i===lines.length-1;
    runs += run(ln, {bold, underline: underlineLast && isLast, size});
  });
  return para(runs, {align, after});
}
function pageBreakPara(){
  return `<w:p><w:r><w:br w:type="page"/></w:r></w:p>`;
}

/* --- Tabel Nomor / Lampiran / Perihal | Kepada Yth --- */
function tcCell(w, paragraphsXml, {span=1}={}){
  const spanTag = span>1 ? `<w:gridSpan w:val="${span}"/>` : '';
  return `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/>${spanTag}<w:tcBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/></w:tcBorders></w:tcPr>${paragraphsXml}</w:tc>`;
}
function buildInfoTable(d){
  const cw = [1500,389,3850,4187];
  const total = cw.reduce((a,b)=>a+b,0);

  // Kolom 1: label (Nomor / Lampiran / Perihal)
  const tc1 = tcCell(cw[0], para(run('Nomor')+brRun()+run('Lampiran')+brRun()+run('Perihal'),{after:0}));
  // Kolom 2: titik dua (Nomor tidak pakai titik dua, sesuai contoh asli)
  const tc2 = tcCell(cw[1], para(run(':')+brRun()+run(':')+brRun()+run(':'),{after:0,align:'center'}));
  // Kolom 3: nilai
  const perihalLines = wrapTextLines(d.perihal || DEFAULTS.perihal, PERIHAL_MAXW, PERIHAL_FONT);
  let tc3 = para(run(nomorLengkap(d)),{after:0});
  tc3 += para(run(d.lampiran || DEFAULTS.lampiran),{after:0});
  tc3 += multilineParagraph(perihalLines,{bold:true, underlineLast:true, after:0});
  const tc3xml = tcCell(cw[2], tc3);
  // Kolom 4: Kepada Yth
  const kepadaLines = wrapTextLines(d.kepadaIsi || '', KEPADA_MAXW, KEPADA_FONT);
  let tc4 = para(run('Kepada Yth :',{bold:true}),{after:0,indent:607});
  kepadaLines.forEach(l=>{
    tc4 += para(run(l,{bold:true}),{after:0,indent:607});
  });
  tc4 += para(run('di-',{bold:true}),{after:0,indent:607});
  tc4 += para(run('BALIKPAPAN',{bold:true,underline:true}),{after:0,indent:727});
  const tc4xml = tcCell(cw[3], tc4);

  const row = `<w:tr>${tc1}${tc2}${tc3xml}${tc4xml}</w:tr>`;
  return `<w:tbl><w:tblPr><w:tblW w:w="${total}" w:type="dxa"/><w:tblInd w:w="125" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblLook w:val="0000" w:firstRow="0" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr><w:tblGrid>${cw.map(w=>`<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>${row}</w:tbl>`;
}

/* --- Poin bernomor 1/2/3 --- */
const LIST_INDENT = 2046, LIST_HANGING = 266, LIST_TABPOS = 2051;
function numberedPara(num, text){
  return para(
    run(num+'.')+tabRun()+run(text),
    {after:120, indent:LIST_INDENT, hanging:LIST_HANGING, align:'both', tabs:[{pos:LIST_TABPOS}], line:360}
  );
}
const TEMBUSAN_INDENT = 432, TEMBUSAN_HANGING = 269;
function tembusanPara(num, text){
  return para(
    run(num+'.')+tabRun()+run(text),
    {after:80, indent:TEMBUSAN_INDENT, hanging:TEMBUSAN_HANGING, tabs:[{pos:TEMBUSAN_INDENT}], line:240}
  );
}

/* --- Gambar (foto lampiran) --- */
function fitBoxEmu(imgW,imgH,maxWEmu,maxHEmu){
  const wEmu = imgW*9525, hEmu = imgH*9525;
  const scale = Math.min(maxWEmu/wEmu, maxHEmu/hEmu);
  return { w: Math.round(wEmu*scale), h: Math.round(hEmu*scale) };
}
function imageParaXml(rId,wEmu,hEmu,docPrId){
  return `<w:p><w:pPr><w:spacing w:after="200" w:line="240" w:lineRule="auto"/><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:noProof/></w:rPr><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${wEmu}" cy="${hEmu}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="${docPrId}" name="Picture${docPrId}"/><wp:cNvGraphicFramePr/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="0" name="Picture${docPrId}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${wEmu}" cy="${hEmu}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
}
function borderlessTableCell(w,contentXml){
  return `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/><w:tcBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/></w:tcBorders><w:vAlign w:val="center"/></w:tcPr>${contentXml || '<w:p><w:pPr><w:spacing w:after="0"/></w:pPr></w:p>'}</w:tc>`;
}

function buildSignatureBlock(d){
  const w = 4300;
  const contentWidth = 10080;
  const tblInd = contentWidth - w;
  let cell = para(run(d.ttdJabatan||''),{align:'center',after:0});
  cell += para(run(d.ttdPerusahaan||''),{align:'center',after:0});
  cell += emptyPara(1200);
  cell += para(run(d.ttdNama||'',{bold:true,underline:true}),{align:'center',after:0});
  const tc = `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/><w:tcBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/></w:tcBorders></w:tcPr>${cell}</w:tc>`;
  return `<w:tbl><w:tblPr><w:tblW w:w="${w}" w:type="dxa"/><w:tblInd w:w="${tblInd}" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblLook w:val="0000" w:firstRow="0" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr><w:tblGrid><w:gridCol w:w="${w}"/></w:tblGrid><w:tr>${tc}</w:tr></w:tbl>`;
}

function groupPhotosIntoPages(list){
  const pages=[];
  let cur=null;
  for(const p of list){
    const cap = p.orientation==='portrait' ? 4 : 2;
    if(!cur || cur.orientation!==p.orientation || cur.items.length>=cap){
      cur = {orientation:p.orientation, items:[]};
      pages.push(cur);
    }
    cur.items.push(p);
  }
  return pages;
}
function buildDocumentXml(d, photoList, mediaRefs){
  const tglPanjang = formatTanggalPanjang(d.tanggalSurat);

  let body = '';
  body += emptyPara(0);
  body += para(run('Balikpapan, '+tglPanjang),{align:'right',after:180});
  body += buildInfoTable(d);
  body += emptyPara(140);
  body += emptyPara(60);
  body += numberedPara(1, 'Memperhatikan ' + (d.poin1||''));
  body += numberedPara(2, 'Berkenaan dengan hal tersebut, ' + (d.poin2||''));
  body += emptyPara(80,{indent:LIST_INDENT});
  body += numberedPara(3, POIN3_TEXT);
  body += emptyPara(120);
  body += emptyPara(1200);
  body += buildSignatureBlock(d);
  body += emptyPara(300);
  body += para(run('Tembusan Yth :',{bold:true}),{after:100});
  TEMBUSAN_ITEMS.forEach((t,i)=>{ body += tembusanPara(i+1, t); });

  // Halaman foto
  const pages = groupPhotosIntoPages(photoList);
  // Map foto -> indeks di photoList (mediaRefs sejajar dengan photoList).
  // Sebelumnya tiap foto dicari lewat photoList.indexOf() -- O(n) per foto
  // di dalam loop O(n) => O(n²) untuk banyak foto.
  const photoIndex = new Map(photoList.map((p,i)=>[p,i]));
  let refIdx = 0;
  pages.forEach(pg=>{
    body += pageBreakPara();
    body += emptyPara(200);
    if(pg.orientation==='portrait'){
      const boxW = 2800000, boxH = 5000000;
      const rowsCells = [];
      for(let r=0;r<2;r++){
        const c1 = pg.items[r*2];
        const c2 = pg.items[r*2+1];
        const xml1 = c1 ? (()=>{ const ref=mediaRefs[photoIndex.get(c1)]; const box=fitBoxEmu(c1.w,c1.h,boxW,boxH); return imageParaXml(ref.rId,box.w,box.h, ++refIdx+100); })() : '';
        const xml2 = c2 ? (()=>{ const ref=mediaRefs[photoIndex.get(c2)]; const box=fitBoxEmu(c2.w,c2.h,boxW,boxH); return imageParaXml(ref.rId,box.w,box.h, ++refIdx+100); })() : '';
        rowsCells.push(`<w:tr>${borderlessTableCell(4419,xml1)}${borderlessTableCell(4419,xml2)}</w:tr>`);
      }
      body += `<w:tbl><w:tblPr><w:tblW w:w="8838" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblLook w:val="0400" w:firstRow="0" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr><w:tblGrid><w:gridCol w:w="4419"/><w:gridCol w:w="4419"/></w:tblGrid>${rowsCells.join('')}</w:tbl>`;
    } else {
      const boxW = 5760000, boxH = 5000000;
      pg.items.forEach(p=>{
        const ref = mediaRefs[photoIndex.get(p)];
        const box = fitBoxEmu(p.w,p.h,boxW,boxH);
        body += imageParaXml(ref.rId, box.w, box.h, ++refIdx+100);
      });
    }
  });

  const HEADER_ID = 'rIdHeader1';
  const FOOTER_ID = 'rIdFooter1';
  const sectPr = `<w:sectPr><w:headerReference w:type="default" r:id="${HEADER_ID}"/><w:footerReference w:type="default" r:id="${FOOTER_ID}"/><w:pgSz w:w="12240" w:h="20160"/><w:pgMar w:top="2500" w:right="1080" w:bottom="1900" w:left="1080" w:header="200" w:footer="250" w:gutter="0"/><w:pgNumType w:start="1"/><w:cols w:space="720"/></w:sectPr>`;

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}${sectPr}</w:body></w:document>`;
}

/* =============== Header & Footer (asli, tidak berubah) =============== */
function buildHeaderXml(){
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">
<w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr>
<w:r><w:rPr><w:noProof/></w:rPr><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="885825" cy="885825"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="1" name="Logo"/><wp:cNvGraphicFramePr/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="Logo"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="885825" cy="885825"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>
<w:r><w:rPr><w:noProof/></w:rPr><w:drawing><wp:anchor distT="0" distB="0" distL="114300" distR="114300" simplePos="0" relativeHeight="1" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="column"><wp:posOffset>950000</wp:posOffset></wp:positionH><wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV><wp:extent cx="5450000" cy="880110"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/><wp:docPr id="2" name="JudulKop"/><wp:cNvGraphicFramePr/><a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"><wps:wsp><wps:cNvSpPr/><wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="5450000" cy="880110"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></wps:spPr><wps:txbx><w:txbxContent>
<w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:eastAsia="Arial" w:hAnsi="Arial" w:cs="Arial"/><w:color w:val="000000"/><w:sz w:val="48"/></w:rPr><w:t xml:space="preserve">PERUSAHAAN UMUM DAERAH</w:t></w:r></w:p>
<w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:eastAsia="Arial" w:hAnsi="Arial" w:cs="Arial"/><w:b/><w:color w:val="000000"/><w:sz w:val="48"/></w:rPr><w:t>TIRTA MANUNTUNG BALIKPAPAN</w:t></w:r></w:p>
</w:txbxContent></wps:txbx><wps:bodyPr wrap="square" lIns="0" tIns="0" rIns="0" bIns="0" anchor="t"><a:noAutofit/></wps:bodyPr></wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>
</w:p>
<w:p><w:pPr><w:pBdr><w:bottom w:val="double" w:sz="18" w:space="4" w:color="000000"/></w:pBdr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:p>
</w:hdr>`;
}
function buildFooterXml(){
  const p = (runs,after=20)=>`<w:p><w:pPr><w:spacing w:after="${after}" w:line="240" w:lineRule="auto"/><w:jc w:val="center"/></w:pPr>${runs}</w:p>`;
  const r = (t,{bold=false,size=16,color=null,underline=false}={})=>`<w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/>${bold?'<w:b/>':''}${underline?'<w:u w:val="single"/>':''}${color?`<w:color w:val="${color}"/>`:''}<w:sz w:val="${size}"/></w:rPr><w:t xml:space="preserve">${escXml(t)}</w:t></w:r>`;
  let body = '';
  body += p(r('GRAHA TIRTA PTMB',{bold:true}));
  body += p(r('Jl. Ruhui Rahayu I Kelurahan Sepinggan Baru, Kecamatan Balikpapan Selatan, Kalimantan Timur'));
  body += p(r('Telp. (0542) 7218831 - 7218832, Fax. (0542) 7218863'));
  const emailRun = `<w:hyperlink r:id="rIdEmail"><w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:color w:val="0000FF"/><w:u w:val="single"/><w:sz w:val="16"/></w:rPr><w:t>humas@tirtamanuntung.co.id</w:t></w:r></w:hyperlink>`;
  const webRun = `<w:hyperlink r:id="rIdWeb"><w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:b/><w:sz w:val="16"/></w:rPr><w:t>http://www.ptirtamanuntung.co.id</w:t></w:r></w:hyperlink>`;
  body += p(r('E-mail : ')+emailRun+r('  -  ')+webRun,0);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${body}</w:ftr>`;
}
const FOOTER_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdEmail" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="mailto:humas@tirtamanuntung.co.id" TargetMode="External"/><Relationship Id="rIdWeb" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="http://www.ptirtamanuntung.co.id/" TargetMode="External"/></Relationships>`;
const HEADER_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/logo.png"/></Relationships>`;

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:eastAsia="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:rPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
</w:styles>`;
const SETTINGS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:defaultTabStop w:val="708"/></w:settings>`;
const FONTTABLE_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:fonts xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:font w:name="Times New Roman"><w:family w:val="roman"/><w:pitch w:val="variable"/></w:font><w:font w:name="Arial"><w:family w:val="swiss"/><w:pitch w:val="variable"/></w:font></w:fonts>`;
const CORE_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Surat Permohonan</dc:title><dc:creator>Generator Surat Permohonan</dc:creator></cp:coreProperties>`;
const APP_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Generator Surat Permohonan</Application></Properties>`;
const ROOT_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`;

function buildDocxRels(photoRels){
  let rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/><Relationship Id="rId6" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/fontTable" Target="fontTable.xml"/><Relationship Id="rIdHeader1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/><Relationship Id="rIdFooter1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>`;
  photoRels.forEach(r=>{
    rels += `<Relationship Id="${r.rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${r.fileName}"/>`;
  });
  rels += `</Relationships>`;
  return rels;
}

function buildContentTypes(extSet){
  let defaults = `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>`;
  if(extSet.has('jpeg')) defaults += `<Default Extension="jpeg" ContentType="image/jpeg"/>`;
  if(extSet.has('jpg')) defaults += `<Default Extension="jpg" ContentType="image/jpeg"/>`;
  if(extSet.has('gif')) defaults += `<Default Extension="gif" ContentType="image/gif"/>`;
  if(extSet.has('webp')) defaults += `<Default Extension="webp" ContentType="image/webp"/>`;
  const overrides = `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/><Override PartName="/word/fontTable.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.fontTable+xml"/><Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">${defaults}${overrides}</Types>`;
}

function extFromMime(mime){
  if(!mime) return 'png';
  if(mime.includes('jpeg')||mime.includes('jpg')) return 'jpeg';
  if(mime.includes('png')) return 'png';
  if(mime.includes('gif')) return 'gif';
  if(mime.includes('webp')) return 'webp';
  return 'png';
}
function dataUrlToBytes(dataUrl){
  const b64 = dataUrl.split(',')[1];
  return b64ToBytes(b64);
}

function generateDocxBytes(d, photoList){
  const mediaRefs = photoList.map((p,i)=>({
    rId: 'rIdImg'+(i+1),
    fileName: 'photo'+(i+1)+'.'+extFromMime(p.mime)
  }));
  const extSet = new Set(mediaRefs.map(r=>r.fileName.split('.').pop()));

  const documentXml = buildDocumentXml(d, photoList, mediaRefs);
  const docxRels = buildDocxRels(mediaRefs);
  const contentTypes = buildContentTypes(extSet);
  const headerXml = buildHeaderXml();
  const footerXml = buildFooterXml();

  const files = [
    {name:'[Content_Types].xml', data: new Uint8Array(strToBytes(contentTypes))},
    {name:'_rels/.rels', data: new Uint8Array(strToBytes(ROOT_RELS_XML))},
    {name:'docProps/core.xml', data: new Uint8Array(strToBytes(CORE_XML))},
    {name:'docProps/app.xml', data: new Uint8Array(strToBytes(APP_XML))},
    {name:'word/document.xml', data: new Uint8Array(strToBytes(documentXml))},
    {name:'word/_rels/document.xml.rels', data: new Uint8Array(strToBytes(docxRels))},
    {name:'word/styles.xml', data: new Uint8Array(strToBytes(STYLES_XML))},
    {name:'word/settings.xml', data: new Uint8Array(strToBytes(SETTINGS_XML))},
    {name:'word/fontTable.xml', data: new Uint8Array(strToBytes(FONTTABLE_XML))},
    {name:'word/header1.xml', data: new Uint8Array(strToBytes(headerXml))},
    {name:'word/_rels/header1.xml.rels', data: new Uint8Array(strToBytes(HEADER_RELS_XML))},
    {name:'word/footer1.xml', data: new Uint8Array(strToBytes(footerXml))},
    {name:'word/_rels/footer1.xml.rels', data: new Uint8Array(strToBytes(FOOTER_RELS_XML))},
    {name:'word/media/logo.png', data: b64ToBytes(LOGO_B64)},
  ];
  photoList.forEach((p,i)=>{
    files.push({name:'word/media/'+mediaRefs[i].fileName, data: dataUrlToBytes(p.dataUrl)});
  });

  return createZip(files);
}

function filename(d){
  return `Surat_Permohonan_${(d.noUrut||'')}_${d.tanggalSurat}.docx`;
}

return { generateBytes: generateDocxBytes, filename: filename };
})();
