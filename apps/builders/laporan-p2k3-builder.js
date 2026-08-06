// Builder Laporan P2K3 (.docx) -- diekstrak dari apps/laporan-p2k3.html
// supaya bisa dipakai ulang dari admin-dashboard.html (fitur "Unduh Ulang"
// di Riwayat Surat). laporan-p2k3.html sendiri tetap generate langsung dari
// form (fungsi-fungsi di bawah ini juga masih ada versi aslinya di sana).
//
// Dibungkus IIFE supaya nama internal (crc32, createZip, run, para, dst)
// tidak bentrok dengan builder jenis surat lain yang di-load bersamaan di
// admin-dashboard.html. jmlTotal()/personilLineText() di file asli membaca
// variabel global `state` langsung (bukan parameter) -- di sini disimulasikan
// dengan variabel module-scoped `state` yang di-sinkronkan tiap generateBytes
// dipanggil (lihat generateDocxBytes di bawah).
window.LaporanP2k3Builder = (function () {
  let state = null;

const PERSONIL_GROUPS = [
  { key:'ahliK3', section:'personil', label:'Ahli K3/Ahli Muda K3 Konstruksi', exampleJumlah:1, exampleNama:['Darto'] },
  { key:'ohc',    section:'personil', label:'Operator Overhead Crane/Mobil Crane', exampleJumlah:0, exampleNama:[] },
  { key:'kebakaran',      section:'kelembagaan', label:'Unit Penanggulangan Kebakaran', exampleJumlah:1, exampleNama:['Jarot Hadi Wibowo'] },
  { key:'tanggapDarurat', section:'kelembagaan', label:'Unit Tanggap Darurat', exampleJumlah:0, exampleNama:[] },
  { key:'p3k',            section:'kelembagaan', label:'Unit P3K', exampleJumlah:1, exampleNama:['Jarot Hadi Wibowo'] },
  { key:'limaR',          section:'kelembagaan', label:'5R', exampleJumlah:1, exampleNama:['M Rahmad Hidayat'] },
];

function escXml(s){
  return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function jmlTotal(){
  const l = parseInt(state.jmlLaki,10)||0;
  const w = parseInt(state.jmlWanita,10)||0;
  const t = parseInt(state.jmlTka,10)||0;
  return l+w+t;
}

/* =============== Logo kop surat (tidak diganti) =============== */
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

const LS = 360; /* line spacing 1.5x (240=single) */
const NUM_HANG = 360, NUM_IND = 720;
const LETTER_HANG = 360, LETTER_IND = 1080;
const CONT_IND = 1080;
const DASH_IND = 1440;
const COLON_TAB = 4300; /* posisi tab tempat titik dua sejajar, cukup untuk label terpanjang (Pelaporan Kecelakaan Kerja) */
const TENAGA_COLON_TAB = COLON_TAB + 900; /* posisi titik dua untuk Wanita/TKA/Jumlah/Shift, sejajar di bawah nilai Laki-laki */
const LETTER_COLON_TAB = 6050; /* titik dua sejajar untuk butir 4a/4b (label lebih panjang) */
const DASH_COLON_TAB = 6300; /* titik dua sejajar untuk butir dash "-" di bagian 6 */

function numLine(num, text){
  return para(run(num+'.')+tabRun()+run(text), {after:140, indent:NUM_IND, hanging:NUM_HANG, tabs:[{pos:NUM_IND}], line:LS});
}
/* Baris "1. Label : value" dengan titik dua sejajar antar baris, tak peduli panjang label */
function numLineLV(num, label, value){
  return para(
    run(num+'.')+tabRun()+run(label)+tabRun()+run(': '+value),
    {after:140, indent:NUM_HANG, hanging:0, tabs:[{pos:NUM_IND},{pos:COLON_TAB}], line:LS}
  );
}
function letterLine(letter, textPrefix, valueText){
  return para(run(letter+'.')+tabRun()+run(textPrefix)+run(valueText||''), {after:70, indent:LETTER_IND, hanging:LETTER_HANG, tabs:[{pos:LETTER_IND}], line:LS});
}
/* Baris "a. Label : value" dengan titik dua sejajar antar sesama butir huruf (dipakai di bagian 4) */
function letterLineLV(letter, label, value){
  return para(
    run(letter+'.')+tabRun()+run(label)+tabRun()+run(': '+value),
    {after:70, indent:LETTER_HANG, hanging:0, tabs:[{pos:LETTER_IND},{pos:LETTER_COLON_TAB}], line:LS}
  );
}
function contLine(text){
  return para(run(text), {after:40, indent:CONT_IND, line:LS});
}
/* Baris "Label : value" sejenis contLine tapi titik dua sejajar antar sesama pasangan (dipakai untuk Jumlah APAR/Hydrant) */
function contLineLV(label, value, colonTab){
  return para(run(label)+tabRun()+run(': '+value), {after:40, indent:CONT_IND, tabs:[{pos:colonTab}], line:LS});
}
const APAR_COLON_TAB = CONT_IND + 2100; /* cukup untuk label "Jumlah Hydrant" */
/* Baris Wanita/TKA/Jumlah/Shift: dimulai sejajar dengan nilai "Laki-laki" di atasnya, titik dua juga sejajar antar baris */
function tenagaSubLine(label, value){
  return para(run(label)+tabRun()+run(': '+value), {after:40, indent:COLON_TAB, tabs:[{pos:TENAGA_COLON_TAB}], line:LS});
}
function dashLine(text){
  return para(run('-  '+text), {after:40, indent:DASH_IND, line:LS});
}
/* Baris "-  Label : value" dengan titik dua sejajar antar sesama butir dash (dipakai di bagian 6) */
function dashLineLV(label, value){
  return para(
    run('-  '+label)+tabRun()+run(': '+value),
    {after:40, indent:DASH_IND, tabs:[{pos:DASH_COLON_TAB}], line:LS}
  );
}
function headingPara(text){
  return para(run(text,{bold:true}), {after:100, line:LS});
}
function titlePara(text){
  return para(run(text,{bold:true}), {after:200, align:'center', line:LS});
}


/* =============== Tabel statistik berbingkai =============== */
function tcBordered(w, text, {bold=false, align=null}={}){
  return `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/><w:tcBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="000000"/><w:left w:val="single" w:sz="4" w:space="0" w:color="000000"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="000000"/><w:right w:val="single" w:sz="4" w:space="0" w:color="000000"/></w:tcBorders><w:vAlign w:val="center"/></w:tcPr>${para(run(text,{bold}),{after:40, align, line:240})}</w:tc>`;
}
function buildStatTable(rows){
  const cw = [700,5800,3080];
  const total = cw.reduce((a,b)=>a+b,0);
  const trH = `<w:trPr><w:trHeight w:val="520" w:hRule="atLeast"/></w:trPr>`;
  let trs = `<w:tr>${trH}${tcBordered(cw[0],'NO',{bold:true,align:'center'})}${tcBordered(cw[1],'ITEM',{bold:true,align:'center'})}${tcBordered(cw[2],'KETERANGAN',{bold:true,align:'center'})}</w:tr>`;
  rows.forEach(r=>{
    trs += `<w:tr>${trH}${tcBordered(cw[0],r[0],{align:'center'})}${tcBordered(cw[1],r[1])}${tcBordered(cw[2],r[2])}</w:tr>`;
  });
  return `<w:tbl><w:tblPr><w:tblW w:w="${total}" w:type="dxa"/><w:tblInd w:w="120" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="80" w:type="dxa"/><w:bottom w:w="80" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar><w:tblLook w:val="0000" w:firstRow="0" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr><w:tblGrid>${cw.map(w=>`<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>${trs}</w:tbl>`;
}

/* =============== Blok tanda tangan dua kolom =============== */
function buildSignBlockP2K3(d, tglPanjang){
  const w = 4700, total = 9400;
  const cell1 = para(run('Mengetahui'),{after:0,align:'center'})
    + para(run(d.mengetahuiJabatan||''),{after:0,align:'center'})
    + emptyPara(900)
    + para(run((d.mengetahuiNama||'').toUpperCase(),{bold:true,underline:true}),{after:0,align:'center'});
  const cell2 = para(run('Balikpapan, '+tglPanjang),{after:0,align:'center'})
    + para(run(d.dibuatJabatan||''),{after:0,align:'center'})
    + emptyPara(900)
    + para(run((d.dibuatNama||'').toUpperCase(),{bold:true,underline:true}),{after:0,align:'center'});
  const noBorder = `<w:tcBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/></w:tcBorders>`;
  const tc1 = `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/>${noBorder}</w:tcPr>${cell1}</w:tc>`;
  const tc2 = `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/>${noBorder}</w:tcPr>${cell2}</w:tc>`;
  return `<w:tbl><w:tblPr><w:tblW w:w="${total}" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblLook w:val="0000" w:firstRow="0" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr><w:tblGrid><w:gridCol w:w="${w}"/><w:gridCol w:w="${w}"/></w:tblGrid><w:tr>${tc1}${tc2}</w:tr></w:tbl>`;
}

/* =============== Tembusan =============== */
function tembusanLine(num, text){
  return para(run(num+'.')+tabRun()+run(text), {after:40, indent:NUM_IND, hanging:NUM_HANG, tabs:[{pos:NUM_IND}], line:240});
}

function personilLineText(key){
  const g = PERSONIL_GROUPS.find(x=>x.key===key);
  const jumlahRaw = state[key+'Jumlah'];
  const namaArr = (state[key+'Nama']||[]).filter(Boolean);
  if(jumlahRaw===''||jumlahRaw===undefined){
    return '-';
  }
  const n = parseInt(jumlahRaw,10);
  if(n===0) return '-';
  const namesText = namaArr.length ? ' ('+namaArr.join(', ')+')' : '';
  return n+' Orang'+namesText;
}
function valOrDash(v){ return (v!==undefined && v!==null && v!=='') ? v : '-'; }

function buildDocumentXml(d){
  const t = jmlTotal();
  const tglPanjang = formatTanggalPanjang(d.tanggalLaporan);
  const letters = ['a','b','c','d'];

  let body = '';
  body += titlePara('L A P O R A N   P 2 K 3');
  body += emptyPara(60);

  body += headingPara('A. DATA UMUM LOKASI');
  body += numLineLV('1', 'Nama Instalasi', valOrDash(d.namaInstalasi));
  body += numLineLV('2', 'Alamat', valOrDash(d.alamat));
  body += numLineLV('3', 'Jumlah tenaga kerja', 'Laki-laki = ' + valOrDash(d.jmlLaki) + ' orang');
  body += tenagaSubLine('Wanita', valOrDash(d.jmlWanita) + ' orang');
  body += tenagaSubLine('TKA', valOrDash(d.jmlTka) + ' orang');
  body += tenagaSubLine('Jumlah', t + ' orang');
  body += tenagaSubLine('Shift', valOrDash(d.shift));

  body += numLine('4', 'Data Personil K3 (jenis/klasifikasi, jumlah dan masa berlaku)');
  PERSONIL_GROUPS.filter(g=>g.section==='personil').forEach((g,i)=>{
    body += letterLineLV(letters[i], g.label, personilLineText(g.key));
  });

  body += numLine('5', 'Data Kelembagaan/Unit/Organisasi (selain P2K3)');
  PERSONIL_GROUPS.filter(g=>g.section==='kelembagaan').forEach((g,i)=>{
    body += letterLine(letters[i], g.label, '');
    body += contLine('Jumlah Anggota : ' + personilLineText(g.key));
  });

  body += numLine('6', 'Data Sarana dan Prasarana K3 (jenis/klasifikasi, jumlah dan masa berlaku)');
  body += letterLine('a', 'Peralatan/Mesin/Pesawat/Instalasi Peralatan', '');
  body += dashLineLV('Pesawat Angkat (Overhead Crane)', valOrDash(d.pesawatAngkat));
  body += dashLineLV('Bejana Tekan', valOrDash(d.bejanaTekan));
  body += dashLine('Penanggulangan Kebakaran');
  body += contLineLV('Jumlah APAR', valOrDash(d.jumlahApar), APAR_COLON_TAB);
  body += contLineLV('Jumlah Hydrant', valOrDash(d.jumlahHydrant), APAR_COLON_TAB);
  body += dashLineLV('Alat Pelindung Diri dan Perlengkapan', valOrDash(d.apd));

  body += pageBreakPara();
  body += numLine('7', 'Data Kecelakaan Kerja & Penyakit Akibat Kerja');
  body += letterLine('a', 'Statistik', '');
  body += buildStatTable([
    ['1','Jumlah Tenaga Kerja Saat ini', t+' Orang'],
    ['2','Jumlah Fatality', valOrDash(d.statFatality)],
    ['3','Jumlah Kerusakan Alat (karena Kecelakaan Kerja)', valOrDash(d.statKerusakanAlat)],
    ['4','Jumlah Kasus P3K', valOrDash(d.statKasusP3K)],
    ['5','Jumlah Kasus MTC (Perawatan Medis)', valOrDash(d.statKasusMTC)],
    ['6','Jumlah Hilang Hari Kerja', valOrDash(d.statHilangHari)],
    ['7','Jumlah Kecelakaan Lalu Lintas (Dalam Jam Kerja)', valOrDash(d.statKecelakaanLalin)],
  ]);
  body += emptyPara(60);
  body += numLineLV('8', 'Patrol Bulanan K3', valOrDash(d.patrolBulanan));
  body += numLineLV('9', 'Pelaporan Kecelakaan Kerja', valOrDash(d.pelaporanKecelakaan));

  body += emptyPara(60);
  body += headingPara('B. HAMBATAN');
  body += para(run(valOrDash(d.hambatan)), {after:120, line:LS});
  body += headingPara('C. SARAN');
  body += para(run(valOrDash(d.saran)), {after:120, line:LS});

  body += emptyPara(400);
  body += buildSignBlockP2K3(d, tglPanjang);

  body += emptyPara(300);
  body += para(run('Tembusan Kepada Yth :',{bold:true}),{after:80, line:240});
  d.tembusan.forEach((v,i)=>{ body += tembusanLine(i+1, v||''); });

  const sectPr = `<w:sectPr><w:headerReference w:type="default" r:id="rIdHeader1"/><w:footerReference w:type="default" r:id="rIdFooter1"/><w:pgSz w:w="12240" w:h="20160"/><w:pgMar w:top="2500" w:right="1080" w:bottom="1900" w:left="1080" w:header="200" w:footer="250" w:gutter="0"/><w:pgNumType w:start="1"/><w:cols w:space="720"/></w:sectPr>`;

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
<w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:eastAsia="Arial" w:hAnsi="Arial" w:cs="Arial"/><w:color w:val="000000"/><w:sz w:val="48"/></w:rPr><w:t>TIRTA MANUNTUNG BALIKPAPAN</w:t></w:r></w:p>
</w:txbxContent></wps:txbx><wps:bodyPr wrap="square" lIns="0" tIns="0" rIns="0" bIns="0" anchor="t"><a:noAutofit/></wps:bodyPr></wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>
</w:p>
<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="24" w:space="1" w:color="000000"/></w:pBdr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:p>
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
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Laporan P2K3</dc:title><dc:creator>Generator Laporan P2K3</dc:creator></cp:coreProperties>`;
const APP_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Generator Laporan P2K3</Application></Properties>`;
const ROOT_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`;
const CONTENT_TYPES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/><Override PartName="/word/fontTable.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.fontTable+xml"/><Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`;

const DOCX_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/><Relationship Id="rId6" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/fontTable" Target="fontTable.xml"/><Relationship Id="rIdHeader1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/><Relationship Id="rIdFooter1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/></Relationships>`;


function generateDocxBytesInner(d){
  const documentXml = buildDocumentXml(d);
  const headerXml = buildHeaderXml();
  const footerXml = buildFooterXml();

  const files = [
    {name:'[Content_Types].xml', data: new Uint8Array(strToBytes(CONTENT_TYPES_XML))},
    {name:'_rels/.rels', data: new Uint8Array(strToBytes(ROOT_RELS_XML))},
    {name:'docProps/core.xml', data: new Uint8Array(strToBytes(CORE_XML))},
    {name:'docProps/app.xml', data: new Uint8Array(strToBytes(APP_XML))},
    {name:'word/document.xml', data: new Uint8Array(strToBytes(documentXml))},
    {name:'word/_rels/document.xml.rels', data: new Uint8Array(strToBytes(DOCX_RELS_XML))},
    {name:'word/styles.xml', data: new Uint8Array(strToBytes(STYLES_XML))},
    {name:'word/settings.xml', data: new Uint8Array(strToBytes(SETTINGS_XML))},
    {name:'word/fontTable.xml', data: new Uint8Array(strToBytes(FONTTABLE_XML))},
    {name:'word/header1.xml', data: new Uint8Array(strToBytes(headerXml))},
    {name:'word/_rels/header1.xml.rels', data: new Uint8Array(strToBytes(HEADER_RELS_XML))},
    {name:'word/footer1.xml', data: new Uint8Array(strToBytes(footerXml))},
    {name:'word/_rels/footer1.xml.rels', data: new Uint8Array(strToBytes(FOOTER_RELS_XML))},
    {name:'word/media/logo.png', data: b64ToBytes(LOGO_B64)},
  ];
  return createZip(files);
}

function generateDocxBytes(d){
  state = d;
  return generateDocxBytesInner(d);
}
function filename(d){
  // Format yang dipakai kantor: "P2K3_<Bulan>-<tahun>.docx" (mis.
  // "P2K3_Agustus-2026.docx"), diambil dari tanggal laporan.
  const [y, m] = String(d.tanggalLaporan || '').split('-').map(Number);
  const bln = (y && m && BULAN[m-1]) ? `${BULAN[m-1]}-${y}` : (d.tanggalLaporan || '');
  return bln ? `P2K3_${bln}.docx` : `P2K3_tanpa-tanggal.docx`;
}

return { generateBytes: generateDocxBytes, filename: filename };
})();
