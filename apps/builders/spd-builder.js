// Builder SPD (.xlsx) -- diekstrak dari apps/spd.html supaya bisa dipakai
// ulang dari admin-dashboard.html (fitur "Unduh Ulang" di Riwayat Surat)
// tanpa menduplikasi logic generate file dari nol. Halaman spd.html sendiri
// tetap memanggil SpdBuilder.generateBytes(data) dengan data langsung dari
// form (lihat downloadBtn handler di spd.html).
//
// Dibungkus IIFE supaya nama-nama internal (crc32, createZip, dst) tidak
// bentrok dengan builder jenis surat lain yang di-load bersamaan di
// admin-dashboard.html.
window.SpdBuilder = (function () {
  function crc32(bytes) {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) {
      let c = (crc ^ bytes[i]) & 0xFF;
      for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      crc = (crc >>> 8) ^ c;
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }
  function u16(n){return [n&0xFF,(n>>8)&0xFF];}
  function u32(n){return [n&0xFF,(n>>>8)&0xFF,(n>>>16)&0xFF,(n>>>24)&0xFF];}
  function strToBytes(s){return Array.from(new TextEncoder().encode(s));}

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
    const eocdBytes=new Uint8Array(eocd);
    const totalLen=offset+centralSize+eocdBytes.length;
    const out=new Uint8Array(totalLen);
    let p=0;
    for(const part of localParts){out.set(part,p);p+=part.length;}
    for(const c of central){out.set(c,p);p+=c.length;}
    out.set(eocdBytes,p);
    return out;
  }
  function xmlEscape(s){
    return String(s==null?'':s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&apos;');
  }
  function colLetter(n){
    let s='';
    while(n>0){const m=(n-1)%26; s=String.fromCharCode(65+m)+s; n=Math.floor((n-1)/26);}
    return s;
  }
  const ROMAN=['I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII'];
  const BULAN_ID=['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
  function formatTanggalIndo(dateStr){
    const [y,m,d]=dateStr.split('-').map(Number);
    return `${d} ${BULAN_ID[m-1]} ${y}`;
  }

  const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="_(* #,##0_);_(* \\(#,##0\\);_(* &quot;-&quot;_);_(@_)"/></numFmts>
<fonts count="4">
<font><sz val="11"/><name val="Calibri"/></font>
<font><sz val="12"/><name val="Times New Roman"/></font>
<font><b/><sz val="12"/><name val="Times New Roman"/></font>
<font><b/><sz val="11"/><name val="Times New Roman"/></font>
</fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
<borders count="2">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left style="thin"><color indexed="64"/></left><right style="thin"><color indexed="64"/></right><top style="thin"><color indexed="64"/></top><bottom style="thin"><color indexed="64"/></bottom><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="9">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center"/></xf>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="left" wrapText="1"/></xf>
<xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
<xf numFmtId="164" fontId="1" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="164" fontId="2" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

  const S_CENTER=1, S_LEFT=2, S_BOX_CENTER=3, S_BOX_LEFT=4, S_BOX_CURRENCY=5,
        S_BOX_BOLD_CENTER=6, S_BOX_BOLD_CURRENCY=7, S_NAME_BOLD=8;

  function buildWorkbookFiles(data){
    const n=data.items.length;
    const HEADER_TOP=7, HEADER_BOTTOM=8, ITEM_START=9;
    const ITEM_END=ITEM_START+n-1;
    const JUMLAH_ROW=ITEM_END+1;
    const KR=JUMLAH_ROW+1;
    const r={
      ket:KR, tgl:KR+1, labels2:KR+2, jab2:KR+3,
      nama1:KR+6, nama2:KR+7, mengetahui:KR+10, jab3:KR+11, namaDir:KR+15, footer:KR+17,
    };
    const LAST_ROW=r.footer;

    const [yy,mm]=data.tanggal.split('-').map(Number);
    const romawi=ROMAN[mm-1];
    const nomorLengkap=`${data.nomorUrut}/${data.nomorTengah}/${romawi}/${yy}${data.nomorSuffix}`;

    let total=0;
    for(const it of data.items){
      const vol=parseFloat(it.volume);
      const harga=parseFloat(it.harga)||0;
      total += (vol && vol>0) ? vol*harga : harga;
    }

    const rows=[];
    function addRow(rn,cells,height){rows.push({rn,cells,height});}
    function cell(col,style,opts){return {col,style,...opts};}

    addRow(2,[cell(4,S_CENTER,{type:'str',value:`KODE UNIT : ${data.kodeUnit}`})]);
    addRow(4,[cell(1,S_CENTER,{type:'str',value:'SURAT PENYEDIAAN DANA (SPD)'})]);
    addRow(5,[cell(1,S_CENTER,{type:'str',value:`Nomor :    ${nomorLengkap}`})]);

    addRow(HEADER_TOP,[
      cell(1,S_BOX_CENTER,{type:'str',value:'NO'}),
      cell(2,S_BOX_CENTER,{type:'str',value:'URAIAN'}),
      cell(3,S_BOX_CENTER,{type:'str',value:'TAKSIRAN HARGA'}),
      cell(4,S_BOX_CENTER,{type:'str',value:'KODE PERK.'}),
    ]);
    addRow(HEADER_BOTTOM,[
      cell(1,S_BOX_CENTER,{type:'str',value:''}),
      cell(2,S_BOX_CENTER,{type:'str',value:''}),
      cell(3,S_BOX_CENTER,{type:'str',value:'(Nilai RAB)'}),
      cell(4,S_BOX_CENTER,{type:'str',value:''}),
    ]);

    data.items.forEach((it,idx)=>{
      const vol=parseFloat(it.volume);
      const harga=parseFloat(it.harga)||0;
      const subtotal=(vol && vol>0) ? vol*harga : harga;
      addRow(ITEM_START+idx,[
        cell(1,S_BOX_CENTER,{type:'num',value:idx+1}),
        cell(2,S_BOX_LEFT,{type:'str',value:it.uraian||''}),
        cell(3,S_BOX_CURRENCY,{type:'num',value:subtotal}),
        cell(4,S_BOX_CENTER,{type:'str',value:it.kodePerk||''}),
      ]);
    });

    addRow(JUMLAH_ROW,[
      cell(1,S_BOX_BOLD_CENTER,{type:'str',value:''}),
      cell(2,S_BOX_BOLD_CENTER,{type:'str',value:'Jumlah'}),
      cell(3,S_BOX_BOLD_CURRENCY,{type:'formula',formula:`SUM(C${ITEM_START}:C${ITEM_END})`,value:total}),
      cell(4,S_BOX_BOLD_CENTER,{type:'str',value:''}),
    ]);

    const ketVal = 'Keterangan :\n' + (data.keterangan||'');
    const ketContentLines = data.keterangan ? Math.ceil(data.keterangan.length/95) : 0;
    const ketLines = 1 + ketContentLines;
    addRow(r.ket,[cell(1,S_LEFT,{type:'str',value:ketVal})], Math.max(15.75, ketLines*15));
    addRow(r.tgl,[cell(4,S_CENTER,{type:'str',value:`Balikpapan, ${formatTanggalIndo(data.tanggal)}`})]);
    addRow(r.labels2,[
      cell(2,S_CENTER,{type:'str',value:'Diketahui Oleh :'}),
      cell(4,S_CENTER,{type:'str',value:'Dibuat Oleh :'}),
    ]);
    addRow(r.jab2,[
      cell(2,S_CENTER,{type:'str',value:data.manajerJabatan||''}),
      cell(4,S_CENTER,{type:'str',value:data.supervisorJabatan||''}),
    ]);
    addRow(r.nama1,[cell(2,S_NAME_BOLD,{type:'str',value:data.manajerNama||''})]);
    addRow(r.nama2,[cell(4,S_NAME_BOLD,{type:'str',value:data.supervisorNama||''})]);
    addRow(r.mengetahui,[cell(2,S_CENTER,{type:'str',value:'Mengetahui / Menyetujui :'})]);
    addRow(r.jab3,[cell(2,S_CENTER,{type:'str',value:data.direkturJabatan||''})]);
    addRow(r.namaDir,[cell(2,S_NAME_BOLD,{type:'str',value:data.direkturNama||''})]);
    addRow(r.footer,[
      cell(3,S_BOX_CENTER,{type:'str',value:data.footerCode||''}),
      cell(4,S_BOX_CENTER,{type:'str',value:''}),
    ]);

    rows.sort((a,b)=>a.rn-b.rn);

    const merges=[
      `A4:D4`,`A5:D5`,
      `A${HEADER_TOP}:A${HEADER_BOTTOM}`,`B${HEADER_TOP}:B${HEADER_BOTTOM}`,`D${HEADER_TOP}:D${HEADER_BOTTOM}`,
      `A${r.ket}:D${r.ket}`,
      `B${r.nama1}:B${r.nama2}`,
      `B${r.mengetahui}:D${r.mengetahui}`,
      `B${r.jab3}:D${r.jab3}`,
      `B${r.namaDir}:D${r.namaDir}`,
      `C${r.footer}:D${r.footer}`,
    ];

    let sheetData='';
    for(const row of rows){
      const cellsXml=row.cells.map(c=>{
        const ref=`${colLetter(c.col)}${row.rn}`;
        if(c.type==='str') return `<c r="${ref}" s="${c.style}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(c.value)}</t></is></c>`;
        if(c.type==='num') return `<c r="${ref}" s="${c.style}"><v>${c.value}</v></c>`;
        if(c.type==='formula') return `<c r="${ref}" s="${c.style}"><f>${xmlEscape(c.formula)}</f><v>${c.value}</v></c>`;
      }).join('');
      const heightAttr = row.height ? ` ht="${row.height}" customHeight="1"` : '';
      sheetData += `<row r="${row.rn}"${heightAttr}>${cellsXml}</row>`;
    }
    const mergeXml = merges.length ? `<mergeCells count="${merges.length}">${merges.map(m=>`<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : '';

    const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetPr/>
<dimension ref="A1:D${LAST_ROW}"/>
<sheetViews><sheetView showGridLines="0" workbookViewId="0"/></sheetViews>
<sheetFormatPr defaultRowHeight="15.75"/>
<cols>
<col min="1" max="1" width="4.5546875" customWidth="1"/>
<col min="2" max="2" width="56.109375" customWidth="1"/>
<col min="3" max="3" width="32.109375" customWidth="1"/>
<col min="4" max="4" width="29.109375" customWidth="1"/>
</cols>
<sheetData>${sheetData}</sheetData>
${mergeXml}
<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>
<pageSetup paperSize="5" orientation="portrait"/>
</worksheet>`;

    const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;

    const RELS_ROOT = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

    const WORKBOOK_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="SPD" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;

    const WORKBOOK_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

    function toBytes(s){return new Uint8Array(strToBytes(s));}

    return [
      {name:'[Content_Types].xml',data:toBytes(CONTENT_TYPES)},
      {name:'_rels/.rels',data:toBytes(RELS_ROOT)},
      {name:'xl/workbook.xml',data:toBytes(WORKBOOK_XML)},
      {name:'xl/_rels/workbook.xml.rels',data:toBytes(WORKBOOK_RELS)},
      {name:'xl/styles.xml',data:toBytes(STYLES_XML)},
      {name:'xl/worksheets/sheet1.xml',data:toBytes(sheetXml)},
    ];
  }
  function generateXlsxBytes(data){
    return createZip(buildWorkbookFiles(data));
  }
  function filename(data){
    return `SPD_${data.nomorUrut}_${data.tanggal}.xlsx`;
  }

  return { generateBytes: generateXlsxBytes, filename: filename };
})();
