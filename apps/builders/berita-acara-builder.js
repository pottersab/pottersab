// Builder Berita Acara (.docx) -- diekstrak dari apps/berita-acara.html
// supaya bisa dipakai ulang dari admin-dashboard.html (fitur "Unduh Ulang"
// di Riwayat Surat). berita-acara.html sendiri tetap generate langsung dari
// form (fungsi-fungsi di bawah ini juga masih ada versi aslinya di sana).
//
// Dibungkus IIFE supaya nama internal (crc32, createZip, run, para, dst)
// tidak bentrok dengan builder jenis surat lain yang di-load bersamaan di
// admin-dashboard.html.
window.BeritaAcaraBuilder = (function () {
const KOP_IMAGE_B64 = window.KopAssets.KOP;
const HEADER1_XML = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<w:hdr xmlns:wpc=\"http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas\" xmlns:cx=\"http://schemas.microsoft.com/office/drawing/2014/chartex\" xmlns:cx1=\"http://schemas.microsoft.com/office/drawing/2015/9/8/chartex\" xmlns:cx2=\"http://schemas.microsoft.com/office/drawing/2015/10/21/chartex\" xmlns:cx3=\"http://schemas.microsoft.com/office/drawing/2016/5/9/chartex\" xmlns:cx4=\"http://schemas.microsoft.com/office/drawing/2016/5/10/chartex\" xmlns:cx5=\"http://schemas.microsoft.com/office/drawing/2016/5/11/chartex\" xmlns:cx6=\"http://schemas.microsoft.com/office/drawing/2016/5/12/chartex\" xmlns:cx7=\"http://schemas.microsoft.com/office/drawing/2016/5/13/chartex\" xmlns:cx8=\"http://schemas.microsoft.com/office/drawing/2016/5/14/chartex\" xmlns:mc=\"http://schemas.openxmlformats.org/markup-compatibility/2006\" xmlns:aink=\"http://schemas.microsoft.com/office/drawing/2016/ink\" xmlns:am3d=\"http://schemas.microsoft.com/office/drawing/2017/model3d\" xmlns:o=\"urn:schemas-microsoft-com:office:office\" xmlns:oel=\"http://schemas.microsoft.com/office/2019/extlst\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\" xmlns:m=\"http://schemas.openxmlformats.org/officeDocument/2006/math\" xmlns:v=\"urn:schemas-microsoft-com:vml\" xmlns:wp14=\"http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing\" xmlns:wp=\"http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing\" xmlns:w10=\"urn:schemas-microsoft-com:office:word\" xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\" xmlns:w14=\"http://schemas.microsoft.com/office/word/2010/wordml\" xmlns:w15=\"http://schemas.microsoft.com/office/word/2012/wordml\" xmlns:w16cex=\"http://schemas.microsoft.com/office/word/2018/wordml/cex\" xmlns:w16cid=\"http://schemas.microsoft.com/office/word/2016/wordml/cid\" xmlns:w16=\"http://schemas.microsoft.com/office/word/2018/wordml\" xmlns:w16du=\"http://schemas.microsoft.com/office/word/2023/wordml/word16du\" xmlns:w16sdtdh=\"http://schemas.microsoft.com/office/word/2020/wordml/sdtdatahash\" xmlns:w16sdtfl=\"http://schemas.microsoft.com/office/word/2024/wordml/sdtformatlock\" xmlns:w16se=\"http://schemas.microsoft.com/office/word/2015/wordml/symex\" xmlns:wpg=\"http://schemas.microsoft.com/office/word/2010/wordprocessingGroup\" xmlns:wpi=\"http://schemas.microsoft.com/office/word/2010/wordprocessingInk\" xmlns:wne=\"http://schemas.microsoft.com/office/word/2006/wordml\" xmlns:wps=\"http://schemas.microsoft.com/office/word/2010/wordprocessingShape\" mc:Ignorable=\"w14 w15 w16se w16cid w16 w16cex w16sdtdh w16sdtfl w16du wp14\"><w:p w14:paraId=\"279CFFD4\" w14:textId=\"77777777\" w:rsidR=\"00E51BB2\" w:rsidRDefault=\"00E51BB2\"><w:pPr><w:pBdr><w:top w:val=\"nil\"/><w:left w:val=\"nil\"/><w:bottom w:val=\"nil\"/><w:right w:val=\"nil\"/><w:between w:val=\"nil\"/></w:pBdr><w:tabs><w:tab w:val=\"center\" w:pos=\"4680\"/><w:tab w:val=\"right\" w:pos=\"9360\"/></w:tabs><w:spacing w:after=\"0\" w:line=\"240\" w:lineRule=\"auto\"/><w:rPr><w:color w:val=\"000000\"/></w:rPr></w:pPr><w:r><w:rPr><w:noProof/><w:color w:val=\"000000\"/></w:rPr><w:drawing><wp:inline distT=\"0\" distB=\"0\" distL=\"0\" distR=\"0\" wp14:anchorId=\"5E012F67\" wp14:editId=\"6E845A75\"><wp:extent cx=\"888365\" cy=\"854075\"/><wp:effectExtent l=\"0\" t=\"0\" r=\"0\" b=\"0\"/><wp:docPr id=\"2\" name=\"image1.png\" descr=\"Description: pdam_color\"/><wp:cNvGraphicFramePr/><a:graphic xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\"><a:graphicData uri=\"http://schemas.openxmlformats.org/drawingml/2006/picture\"><pic:pic xmlns:pic=\"http://schemas.openxmlformats.org/drawingml/2006/picture\"><pic:nvPicPr><pic:cNvPr id=\"0\" name=\"image1.png\" descr=\"Description: pdam_color\"/><pic:cNvPicPr preferRelativeResize=\"0\"/></pic:nvPicPr><pic:blipFill><a:blip r:embed=\"rId1\"/><a:srcRect/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x=\"0\" y=\"0\"/><a:ext cx=\"888365\" cy=\"854075\"/></a:xfrm><a:prstGeom prst=\"rect\"><a:avLst/></a:prstGeom><a:ln/></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r><w:r><w:rPr><w:color w:val=\"000000\"/></w:rPr><w:t xml:space=\"preserve\"> </w:t></w:r><w:r><w:rPr><w:noProof/></w:rPr><mc:AlternateContent><mc:Choice Requires=\"wps\"><w:drawing><wp:anchor distT=\"0\" distB=\"0\" distL=\"114300\" distR=\"114300\" simplePos=\"0\" relativeHeight=\"251658240\" behindDoc=\"0\" locked=\"0\" layoutInCell=\"1\" hidden=\"0\" allowOverlap=\"1\" wp14:anchorId=\"668F24C0\" wp14:editId=\"1C81C978\"><wp:simplePos x=\"0\" y=\"0\"/><wp:positionH relativeFrom=\"column\"><wp:posOffset>657226</wp:posOffset></wp:positionH><wp:positionV relativeFrom=\"paragraph\"><wp:posOffset>-28564</wp:posOffset></wp:positionV><wp:extent cx=\"5627370\" cy=\"880110\"/><wp:effectExtent l=\"0\" t=\"0\" r=\"0\" b=\"0\"/><wp:wrapNone/><wp:docPr id=\"1\" name=\"Rectangle 1\"/><wp:cNvGraphicFramePr/><a:graphic xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\"><a:graphicData uri=\"http://schemas.microsoft.com/office/word/2010/wordprocessingShape\"><wps:wsp><wps:cNvSpPr/><wps:spPr><a:xfrm><a:off x=\"2560890\" y=\"3368520\"/><a:ext cx=\"5570220\" cy=\"822960\"/></a:xfrm><a:prstGeom prst=\"rect\"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></wps:spPr><wps:txbx><w:txbxContent><w:p w14:paraId=\"3A1AD3C4\" w14:textId=\"77777777\" w:rsidR=\"00E51BB2\" w:rsidRDefault=\"00E51BB2\"><w:pPr><w:spacing w:after=\"0\" w:line=\"240\" w:lineRule=\"auto\"/><w:jc w:val=\"center\"/><w:textDirection w:val=\"btLr\"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii=\"Arial\" w:eastAsia=\"Arial\" w:hAnsi=\"Arial\" w:cs=\"Arial\"/><w:color w:val=\"000000\"/><w:sz w:val=\"52\"/></w:rPr><w:t xml:space=\"preserve\">PERUSAHAAN UMUM DAERAH </w:t></w:r></w:p><w:p w14:paraId=\"323AD182\" w14:textId=\"77777777\" w:rsidR=\"00E51BB2\" w:rsidRDefault=\"00E51BB2\"><w:pPr><w:spacing w:after=\"0\" w:line=\"240\" w:lineRule=\"auto\"/><w:jc w:val=\"center\"/><w:textDirection w:val=\"btLr\"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii=\"Arial\" w:eastAsia=\"Arial\" w:hAnsi=\"Arial\" w:cs=\"Arial\"/><w:color w:val=\"000000\"/><w:sz w:val=\"52\"/></w:rPr><w:t>TIRTA MANUNTUNG</w:t></w:r></w:p></w:txbxContent></wps:txbx><wps:bodyPr spcFirstLastPara=\"1\" wrap=\"square\" lIns=\"91425\" tIns=\"45700\" rIns=\"91425\" bIns=\"45700\" anchor=\"t\" anchorCtr=\"0\"><a:noAutofit/></wps:bodyPr></wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing></mc:Choice><mc:Fallback><w:pict><v:rect w14:anchorId=\"668F24C0\" id=\"Rectangle 1\" o:spid=\"_x0000_s1026\" style=\"position:absolute;margin-left:51.75pt;margin-top:-2.25pt;width:443.1pt;height:69.3pt;z-index:251658240;visibility:visible;mso-wrap-style:square;mso-wrap-distance-left:9pt;mso-wrap-distance-top:0;mso-wrap-distance-right:9pt;mso-wrap-distance-bottom:0;mso-position-horizontal:absolute;mso-position-horizontal-relative:text;mso-position-vertical:absolute;mso-position-vertical-relative:text;v-text-anchor:top\" o:gfxdata=\"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&#xA;\" filled=\"f\" stroked=\"f\"><v:textbox inset=\"2.53958mm,1.2694mm,2.53958mm,1.2694mm\"><w:txbxContent><w:p w14:paraId=\"3A1AD3C4\" w14:textId=\"77777777\" w:rsidR=\"00E51BB2\" w:rsidRDefault=\"00E51BB2\"><w:pPr><w:spacing w:after=\"0\" w:line=\"240\" w:lineRule=\"auto\"/><w:jc w:val=\"center\"/><w:textDirection w:val=\"btLr\"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii=\"Arial\" w:eastAsia=\"Arial\" w:hAnsi=\"Arial\" w:cs=\"Arial\"/><w:color w:val=\"000000\"/><w:sz w:val=\"52\"/></w:rPr><w:t xml:space=\"preserve\">PERUSAHAAN UMUM DAERAH </w:t></w:r></w:p><w:p w14:paraId=\"323AD182\" w14:textId=\"77777777\" w:rsidR=\"00E51BB2\" w:rsidRDefault=\"00E51BB2\"><w:pPr><w:spacing w:after=\"0\" w:line=\"240\" w:lineRule=\"auto\"/><w:jc w:val=\"center\"/><w:textDirection w:val=\"btLr\"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii=\"Arial\" w:eastAsia=\"Arial\" w:hAnsi=\"Arial\" w:cs=\"Arial\"/><w:color w:val=\"000000\"/><w:sz w:val=\"52\"/></w:rPr><w:t>TIRTA MANUNTUNG</w:t></w:r></w:p></w:txbxContent></v:textbox></v:rect></w:pict></mc:Fallback></mc:AlternateContent></w:r></w:p><w:p w14:paraId=\"4D0F1F50\" w14:textId=\"77777777\" w:rsidR=\"00E51BB2\" w:rsidRDefault=\"00E51BB2\"><w:pPr><w:pBdr><w:top w:val=\"nil\"/><w:left w:val=\"nil\"/><w:bottom w:val=\"single\" w:sz=\"24\" w:space=\"4\" w:color=\"000000\"/><w:right w:val=\"nil\"/><w:between w:val=\"nil\"/></w:pBdr><w:tabs><w:tab w:val=\"center\" w:pos=\"4680\"/><w:tab w:val=\"right\" w:pos=\"9360\"/></w:tabs><w:spacing w:after=\"0\" w:line=\"240\" w:lineRule=\"auto\"/><w:rPr><w:color w:val=\"000000\"/></w:rPr></w:pPr></w:p></w:hdr>";
const HEADER1_RELS_XML = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/image\" Target=\"media/image1.png\"/></Relationships>";

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

/* =============== Util: tanggal & terbilang bahasa Indonesia =============== */
const HARI=['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'];
const BULAN=['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
const ROMAWI=['I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII'];

function terbilang(n){
  n=Math.floor(Math.abs(n));
  const satuan=["","Satu","Dua","Tiga","Empat","Lima","Enam","Tujuh","Delapan","Sembilan","Sepuluh","Sebelas"];
  if(n<12) return satuan[n];
  if(n<20) return terbilang(n-10)+" Belas";
  if(n<100) return terbilang(Math.floor(n/10))+" Puluh"+(n%10?" "+terbilang(n%10):"");
  if(n<200) return "Seratus"+(n%100?" "+terbilang(n%100):"");
  if(n<1000) return terbilang(Math.floor(n/100))+" Ratus"+(n%100?" "+terbilang(n%100):"");
  if(n<2000) return "Seribu"+(n%1000?" "+terbilang(n%1000):"");
  if(n<1000000) return terbilang(Math.floor(n/1000))+" Ribu"+(n%1000?" "+terbilang(n%1000):"");
  if(n<1000000000) return terbilang(Math.floor(n/1000000))+" Juta"+(n%1000000?" "+terbilang(n%1000000):"");
  return String(n);
}
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
function formatTanggalTerbilang(dstr){
  const d=parseDateLocal(dstr);
  if(!d) return {hari:'...',tanggal:'...',bulan:'...',tahun:'...'};
  return {
    hari: HARI[d.getDay()],
    tanggal: terbilang(d.getDate()),
    bulan: BULAN[d.getMonth()],
    tahun: terbilang(d.getFullYear())
  };
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
function escXml(s){
  return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

const EXAMPLE_TEXT = {
  judul: 'BERITA ACARA PEMERIKSAAN LAPANGAN',
  nama1: 'DARTO',
  jabatan1: 'Supervisor Sumber Air Baku & Lingkungan Perumda Tirta Manuntung Balikpapan',
  nama2: 'M RAHMAD HIDAYAT',
  jabatan2: 'Staff Sumber Air Baku & Lingkungan Perumda Tirta Manuntung Balikpapan',
  periksaPada: 'Jaringan Layanan Jalur Pipa Transmisi Air Baku :\nPipa 600mm Steel arah IPA Batu Ampar\nPipa 600mm Steel arah IPA Kampung Damai',
  alasan: 'Jalur Pipa transmisi air baku terkena proyek pengecoran jalan di Jl Mukmin Faisal Kilometer 8.',
  tindakLanjut: 'Dianggap Perlu untuk segera dilakukan persiapan material, peralatan dan tenaga kerja untuk menunjang pekerjaan ...',
  diperiksaNama: 'DEDY HERMAWAN, S.M',
  diperiksaJabatan: 'Manajer Produksi',
  mengetahuiNama: 'Ir. ALI RACHMAN AS, S.T., M.T.',
  mengetahuiJabatan: 'Direktur Operasional',
};

function nomorLengkap(src){
  src = src || {};
  const urut = src.nomorUrut || '...';
  const k1 = src.kodeTetap1 || '';
  const k2 = src.kodeTetap2 || '';
  const rom = romawiBulan(src.tanggalSurat);
  const th = tahunSurat(src.tanggalSurat);
  return `${urut}/${k1}/${k2}/${rom}/${th}-Q`;
}

function run(text,{bold=false,underline=false,size=24}={}){
  return `<w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:eastAsia="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/>${bold?'<w:b/><w:bCs/>':''}${underline?'<w:u w:val="single"/>':''}<w:color w:val="000000"/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr><w:t xml:space="preserve">${escXml(text)}</w:t></w:r>`;
}
function tabRun(){
  return `<w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:sz w:val="24"/></w:rPr><w:tab/></w:r>`;
}
function multilineRuns(text,{size=24}={}){
  const lines = String(text||'').split(/\r?\n/);
  const rPr = `<w:rPr><w:rFonts w:ascii="Times New Roman" w:eastAsia="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/><w:color w:val="000000"/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr>`;
  const inner = lines.map((l,i)=> (i>0?'<w:br/>':'') + `<w:t xml:space="preserve">${escXml(l)}</w:t>`).join('');
  return `<w:r>${rPr}${inner}</w:r>`;
}
function para(runsXml,{align=null,after=120,indent=0,hanging=0,tabs=[]}={}){
  const tabsXml = tabs.length ? `<w:tabs>${tabs.map(t=>`<w:tab w:val="${t.val||'left'}" w:pos="${t.pos}"/>`).join('')}</w:tabs>` : '';
  const indXml = indent ? `<w:ind w:left="${indent}"${hanging?` w:hanging="${hanging}"`:''}/>` : '';
  return `<w:p><w:pPr>${tabsXml}<w:spacing w:after="${after}" w:line="240" w:lineRule="auto"/>${indXml}${align?`<w:jc w:val="${align}"/>`:''}</w:pPr>${runsXml}</w:p>`;
}
function emptyPara(after=120,{indent=0}={}){
  const indXml = indent ? `<w:ind w:left="${indent}"/>` : '';
  return `<w:p><w:pPr><w:spacing w:after="${after}" w:line="240" w:lineRule="auto"/>${indXml}</w:pPr></w:p>`;
}
function fieldPara(label,value){
  return para(run(label)+tabRun()+tabRun()+run(': '+value),{after:0});
}
// Nomor + Nama (bold) + Jabatan, indented further than the "Pada hari..." paragraph.
const NAMA_JABATAN_INDENT = 720; // 0.5in - lebih masuk daripada paragraf "Pada hari"
const NAMA_JABATAN_COLON_TAB = 1550; // titik tab kedua tempat ":" dimulai, sejajar antar baris
function personBlock(nomorUrutItem, nama, jabatan){
  let out = '';
  out += para(
    run(nomorUrutItem+'.')+tabRun()+run('Nama')+tabRun()+run(': ')+run(nama,{bold:true}),
    {after:0, indent:NAMA_JABATAN_INDENT, hanging:300, align:'both', tabs:[{pos:NAMA_JABATAN_INDENT},{pos:NAMA_JABATAN_COLON_TAB}]}
  );
  out += para(
    run('Jabatan',{size:20})+tabRun()+run(': '+jabatan,{size:20}),
    {after:0, indent:NAMA_JABATAN_INDENT, align:'both', tabs:[{pos:NAMA_JABATAN_COLON_TAB}]}
  );
  return out;
}
function pageBreakPara(){
  return `<w:p><w:r><w:br w:type="page"/></w:r></w:p>`;
}

function shortenJabatanForSignature(text){
  if(!text) return text;
  // Buang akhiran nama perusahaan/kota yang membuat baris jabatan di tabel tanda tangan jadi panjang & tidak rapi.
  return text.replace(/\s*,?\s*Perumda\s+Tirta\s+Manuntung\s+Balikpapan\s*$/i,'').trim();
}
function buildSignatureTable(d){
  const cw=[3073,600,1847,296,3022];
  function cell(w,content,{span=1,align=null,bold=false,underline=false,vAlign='center',size=24}={}){
    const spanTag = span>1 ? `<w:gridSpan w:val="${span}"/>` : '';
    return `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/>${spanTag}<w:tcBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/></w:tcBorders><w:vAlign w:val="${vAlign}"/></w:tcPr><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/>${align?`<w:jc w:val="${align}"/>`:''}</w:pPr>${content?run(content,{bold,underline,size}):''}</w:p></w:tc>`;
  }
  function row(cellsXml){ return `<w:tr>${cellsXml}</w:tr>`; }
  function blankRow(h){
    return `<w:tr><w:trPr><w:trHeight w:val="${h}"/></w:trPr>${cw.map(w=>cell(w,'')).join('')}</w:tr>`;
  }
  let rows='';
  rows += row(cell(cw[0]+cw[1]+cw[2]+cw[3],'',{span:4}) + cell(cw[4],'Dibuat Oleh :'));
  rows += blankRow(120);
  rows += row(cell(cw[0],'Diperiksa Oleh :',{align:'center'}) + cell(cw[1],'1.') + cell(cw[2],'Nama') + cell(cw[3],':') + cell(cw[4],d.nama1,{bold:true}));
  rows += row(cell(cw[0],d.diperiksaJabatan,{align:'center'}) + cell(cw[1],'') + cell(cw[2],'Jabatan') + cell(cw[3],':') + cell(cw[4],shortenJabatanForSignature(d.jabatan1),{size:18}));
  rows += blankRow(700);
  rows += row(cell(cw[0],d.diperiksaNama,{bold:true,underline:true,align:'center'}) + cell(cw[1],'') + cell(cw[2],'T. Tangan') + cell(cw[3],':') + cell(cw[4],'.................................'));
  rows += blankRow(120);
  rows += row(cell(cw[0],'') + cell(cw[1],'2.') + cell(cw[2],'Nama') + cell(cw[3],':') + cell(cw[4],d.nama2,{bold:true}));
  rows += row(cell(cw[0],'') + cell(cw[1],'') + cell(cw[2],'Jabatan') + cell(cw[3],':') + cell(cw[4],shortenJabatanForSignature(d.jabatan2),{size:18}));
  rows += blankRow(700);
  rows += row(cell(cw[0],'') + cell(cw[1],'') + cell(cw[2],'T. Tangan') + cell(cw[3],':') + cell(cw[4],'.................................'));
  const total = cw.reduce((a,b)=>a+b,0);
  return `<w:tbl><w:tblPr><w:tblW w:w="${total}" w:type="dxa"/><w:tblInd w:w="349" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblLook w:val="0400" w:firstRow="0" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr><w:tblGrid>${cw.map(w=>`<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>${rows}</w:tbl>`;
}
function buildApprovalTable(d){
  const w = 8838;
  function crow(text,{bold=true,underline=false}={}){
    return `<w:tr>${`<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/><w:tcBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/></w:tcBorders></w:tcPr><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/><w:jc w:val="center"/></w:pPr>${text?run(text,{bold,underline}):''}</w:p></w:tc>`}</w:tr>`;
  }
  function blank(h){
    return `<w:tr><w:trPr><w:trHeight w:val="${h}"/></w:trPr><w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/><w:tcBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/></w:tcBorders></w:tcPr><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:p></w:tc></w:tr>`;
  }
  return `<w:tbl><w:tblPr><w:tblW w:w="${w}" w:type="dxa"/><w:tblInd w:w="349" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblLook w:val="0400" w:firstRow="0" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr><w:tblGrid><w:gridCol w:w="${w}"/></w:tblGrid>` +
    crow('Mengetahui / Menyetujui',{bold:false}) + crow(d.mengetahuiJabatan,{bold:false}) + blank(800) + crow(d.mengetahuiNama,{bold:true,underline:true}) +
    `</w:tbl>`;
}

function buildFooterCodeBox(text){
  const w = 4595; // ~52% of 8838 dxa content width, matches preview's .doc-footer-code
  return `<w:tbl><w:tblPr><w:tblW w:w="${w}" w:type="dxa"/><w:jc w:val="right"/><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="000000"/><w:left w:val="single" w:sz="4" w:space="0" w:color="000000"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="000000"/><w:right w:val="single" w:sz="4" w:space="0" w:color="000000"/></w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="40" w:type="dxa"/><w:bottom w:w="40" w:type="dxa"/><w:left w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="${w}"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/></w:tcPr><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/><w:jc w:val="center"/></w:pPr>${run(text)}</w:p></w:tc></w:tr></w:tbl>`;
}
// Fit image (px) into a target box (EMU), returns {w,h} in EMU, preserving aspect ratio.
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
  // mediaRefs: array aligned with photoList of {rId}
  const t = formatTanggalTerbilang(d.tanggalSurat);
  const tglTtdPanjang = formatTanggalPanjang(d.tanggalSurat);

  let body = '';
  body += emptyPara(0);
  body += para(run(d.judul || EXAMPLE_TEXT.judul,{bold:true,underline:true}),{align:'center',after:0});
  if(d.subjudul){
    body += para(run('('+d.subjudul+')',{bold:true,underline:true}),{align:'center',after:0});
  }
  body += para(run('Nomor : '+nomorLengkap(d)),{align:'center',after:150});
  body += para(run(`Pada hari ini ${t.hari} Tanggal ${t.tanggal} Bulan ${t.bulan} Tahun ${t.tahun} kami yang bertandatangan dibawah ini masing \u2013 masing :`),{after:120});
  body += personBlock(1,d.nama1,d.jabatan1);
  body += emptyPara(100,{indent:NAMA_JABATAN_INDENT});
  body += personBlock(2,d.nama2,d.jabatan2);
  body += emptyPara(100);
  body += para(run('Telah melakukan Pemeriksaan Pada :',{bold:true}),{after:80});
  body += para(multilineRuns(d.periksaPada),{after:120, indent:NAMA_JABATAN_INDENT});
  body += para(run('Alasan :',{bold:true}),{after:80});
  body += para(multilineRuns(d.alasan),{after:120, indent:NAMA_JABATAN_INDENT});
  body += para(run('Tindak Lanjut :',{bold:true}),{after:80});
  body += para(multilineRuns(d.tindakLanjut),{after:120, indent:NAMA_JABATAN_INDENT});
  body += emptyPara(100);
  body += para(run('Demikian Berita acara ini dibuat dengan benar dalam rangkap 2 (dua) untuk dipergunakan sebagaimana mestinya'),{after:200});
  body += para(run('Balikpapan, '+tglTtdPanjang),{align:'right',after:120});
  body += buildSignatureTable(d);
  body += emptyPara(100);
  body += buildApprovalTable(d);
  body += emptyPara(150);
  body += buildFooterCodeBox('PTMBPP-IR-PRD.SAB/01-06');

  // Photo pages
  const pages = groupPhotosIntoPages(photoList);
  // Map foto -> indeks di photoList (mediaRefs sejajar dengan photoList).
  // Sebelumnya tiap foto dicari lewat photoList.indexOf() -- O(n) per foto
  // di dalam loop O(n) => O(n²) untuk banyak foto.
  const photoIndex = new Map(photoList.map((p,i)=>[p,i]));
  let refIdx = 0;
  const CONTENT_W_EMU = 5943600; // 6.5in
  pages.forEach(pg=>{
    body += pageBreakPara();
    body += emptyPara(200);
    if(pg.orientation==='portrait'){
      const cellW = Math.floor(4419/1) ; // half of 8838 dxa
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
  const sectPr = `<w:sectPr><w:headerReference w:type="default" r:id="${HEADER_ID}"/><w:pgSz w:w="12240" w:h="20160"/><w:pgMar w:top="1361" w:right="1440" w:bottom="900" w:left="1440" w:header="720" w:footer="1440" w:gutter="0"/><w:pgNumType w:start="1"/><w:cols w:space="720"/></w:sectPr>`;

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}${sectPr}</w:body></w:document>`;
}

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
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Berita Acara</dc:title><dc:creator>Generator Berita Acara</dc:creator></cp:coreProperties>`;
const APP_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Generator Berita Acara</Application></Properties>`;
const ROOT_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`;

function buildDocxRels(photoRels){
  let rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/><Relationship Id="rId6" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/fontTable" Target="fontTable.xml"/><Relationship Id="rIdHeader1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>`;
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
  const overrides = `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/><Override PartName="/word/fontTable.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.fontTable+xml"/><Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>`;
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
  // Prepare media relationships for photos (start numbering after core rIds)
  const mediaRefs = photoList.map((p,i)=>({
    rId: 'rIdImg'+(i+1),
    fileName: 'photo'+(i+1)+'.'+extFromMime(p.mime)
  }));
  const extSet = new Set(mediaRefs.map(r=>r.fileName.split('.').pop()));

  const documentXml = buildDocumentXml(d, photoList, mediaRefs);
  const docxRels = buildDocxRels(mediaRefs);
  const contentTypes = buildContentTypes(extSet);

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
    {name:'word/header1.xml', data: new Uint8Array(strToBytes(HEADER1_XML))},
    {name:'word/_rels/header1.xml.rels', data: new Uint8Array(strToBytes(HEADER1_RELS_XML))},
    {name:'word/media/image1.png', data: b64ToBytes(KOP_IMAGE_B64)},
  ];
  photoList.forEach((p,i)=>{
    files.push({name:'word/media/'+mediaRefs[i].fileName, data: dataUrlToBytes(p.dataUrl)});
  });

  return createZip(files);
}

function filename(d){
  return `Berita_Acara_${d.nomorUrut}_${d.tanggalSurat}.docx`;
}

return { generateBytes: generateDocxBytes, filename: filename };
})();
