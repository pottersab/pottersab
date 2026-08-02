// Builder LPJ Biaya Operasional (.xlsx) -- pola yang sama dengan
// builders/spd-builder.js: generate file .xlsx dari nol (zip + XML) tanpa
// library eksternal, dibungkus IIFE supaya nama internal (crc32, createZip,
// dst) tidak bentrok dengan builder surat lain yang ikut di-load di
// admin-dashboard.html.
//
// Selain generateBytes(), builder ini juga mengekspor groupItems() -- fungsi
// yang mengelompokkan item per klasifikasi (Konsumsi/BBM/Material) dan
// mengurutkannya per tanggal. apps/lpj.html memakai fungsi yang sama untuk
// pratinjau, jadi pratinjau dan file yang diunduh tidak mungkin beda urutan.
window.LpjBuilder = (function () {
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

  const BULAN_ID=['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
  const ROMAN=['I','II','III','IV','V','VI','VII','VIII','IX','X'];

  // Klasifikasi yang boleh dipakai + urutan tampilnya di surat. Urutan array
  // ini yang menentukan I / II / III, bukan urutan pengisian di form.
  const KLASIFIKASI=[
    {kode:'Konsumsi', judul:'Biaya Konsumsi'},
    {kode:'BBM',      judul:'Biaya BBM'},
    {kode:'Material', judul:'Biaya Material'},
  ];

  function formatTanggalIndo(dateStr){
    if(!dateStr) return '';
    const [y,m,d]=String(dateStr).split('-').map(Number);
    if(!y||!m||!d) return '';
    return `${d} ${BULAN_ID[m-1]} ${y}`;
  }
  function angka(v){
    const n=parseFloat(v);
    return isNaN(n)?0:n;
  }

  // Item dikelompokkan per klasifikasi lalu diurutkan per tanggal (item tanpa
  // tanggal ditaruh paling bawah supaya tidak menyelip di antara yang sudah
  // terisi). Bagian yang kosong tidak ikut dicetak, dan penomoran romawinya
  // ikut merapat -- jadi kalau tidak ada biaya BBM, Material tetap jadi "II".
  function groupItems(items){
    const out=[];
    KLASIFIKASI.forEach(k=>{
      const isi=(items||[])
        .filter(it=>it && it.jenis===k.kode && (it.kegiatan || angka(it.jumlah)))
        .slice()
        .sort((a,b)=>{
          const ta=a.tanggal||'9999-99-99', tb=b.tanggal||'9999-99-99';
          return ta<tb?-1:ta>tb?1:0;
        });
      if(!isi.length) return;
      out.push({
        kode:k.kode,
        judul:k.judul,
        romawi:ROMAN[out.length]||'',
        items:isi,
        subtotal:isi.reduce((s,it)=>s+angka(it.jumlah),0),
      });
    });
    return out;
  }
  function totalOperasional(items){
    return groupItems(items).reduce((s,g)=>s+g.subtotal,0);
  }
  // Tiga baris judul di kepala surat. Sub divisi dipisah supaya bisa diganti
  // (atau dikosongkan untuk pengguna umum) tanpa mengetik ulang seluruh
  // judulnya -- kalau kosong, kata "SUB DIVISI" ikut hilang supaya tidak
  // tertinggal menggantung.
  const JUDUL_DEFAULT = 'LAPORAN PERTANGGUNG JAWABAN';
  const SUB_DIVISI_DEFAULT = 'SUMBER AIR BAKU';
  function barisJudul(data){
    const sub = String(data.subDivisi || '').trim();
    return [
      String(data.judul == null ? JUDUL_DEFAULT : data.judul).trim(),
      sub ? `BIAYA OPERASIONAL SUB DIVISI ${sub}` : 'BIAYA OPERASIONAL',
      (data.periode || periodeOtomatis(data.items)) ? `BULAN ${data.periode || periodeOtomatis(data.items)}` : ''
    ];
  }

  function pisahRibu(n){
    const bulat = Math.round(Math.abs(angka(n)));
    const teks = String(bulat).replace(/\B(?=(\d{3})+(?!\d))/g,'.');
    return (angka(n) < 0 ? '(' + teks + ')' : teks);
  }

  // Lebar kolom dihitung dari isi yang benar-benar ada di surat, bukan angka
  // mati -- kegiatan panjang tidak kepotong, dan kalau isinya pendek kolomnya
  // ikut menyempit supaya tabelnya tidak melebar sia-sia. Satuan lebar Excel
  // di sini kira-kira satu karakter Times New Roman 12, jadi cukup dihitung
  // dari panjang teks terpanjang + sedikit ruang napas.
  //
  // TOTAL_MAKS menjaga tabel tetap muat satu halaman potrait (Legal, margin
  // kiri-kanan 0,7"): kalau kelebihan, kolom Kegiatan yang dipersempit karena
  // dia satu-satunya yang teksnya boleh dibungkus ke baris berikutnya.
  const TOTAL_MAKS = 93, MIN_KEGIATAN = 24;
  function lebarKolom(data){
    const gs = groupItems(data.items);
    const tanggal=['Tanggal'], kegiatan=['Kegiatan'], jenis=['Keterangan'], jumlah=['Jumlah'];
    let nomorMaks = 1, totalOps = 0;
    gs.forEach(g=>{
      nomorMaks = Math.max(nomorMaks, g.items.length);
      totalOps += g.subtotal;
      // Judul bagian ("Biaya Konsumsi") duduk di kolom Tanggal tanpa
      // penggabungan sel, jadi lebarnya ikut ditentukan judul terpanjang.
      tanggal.push(g.judul);
      g.items.forEach(it=>{
        tanggal.push(formatTanggalIndo(it.tanggal));
        kegiatan.push(it.kegiatan||'');
        jenis.push(it.jenis||'');
        jumlah.push(pisahRibu(it.jumlah));
      });
    });
    const permintaan = angka(data.permintaanDana);
    jumlah.push(pisahRibu(totalOps), pisahRibu(permintaan), pisahRibu(permintaan-totalOps));

    const panjang = arr => arr.reduce((m,s)=>Math.max(m, String(s==null?'':s).length), 0);

    let a = Math.max(4.44, String(nomorMaks).length + 3);
    let b = panjang(tanggal) + 3;
    let d = panjang(jenis) + 3;
    // Format akuntansi menyisakan ruang di kiri-kanan angka, jadi kolom
    // Jumlah perlu tambahan lebih banyak daripada kolom teks biasa.
    let e = Math.max(panjang(jumlah) + 5, 12);
    let c = Math.max(panjang(kegiatan) + 3, MIN_KEGIATAN);

    // Blok tanda tangan kanan memakai gabungan kolom D+E, dan sel gabungan
    // memotong teks yang kelebihan -- jadi lebarnya dijaga di sini.
    const kanan = panjang(['Dibuat Oleh', data.pembuatJabatan||'', data.pembuatNama||'']) + 2;
    if(d + e < kanan) e += kanan - (d + e);

    const sisa = TOTAL_MAKS - (a + b + d + e);
    if(c > sisa) c = Math.max(MIN_KEGIATAN, sisa);

    const bulat = n => Math.round(n*100)/100;
    return { a:bulat(a), b:bulat(b), c:bulat(c), d:bulat(d), e:bulat(e) };
  }

  // Periode surat ("JUNI - JULI 2025") dihitung dari tanggal item paling awal
  // dan paling akhir, jadi tidak perlu diketik ulang tiap bulan.
  function periodeOtomatis(items){
    const tgl=(items||[]).map(it=>it && it.tanggal).filter(Boolean).sort();
    if(!tgl.length) return '';
    const [y1,m1]=tgl[0].split('-').map(Number);
    const [y2,m2]=tgl[tgl.length-1].split('-').map(Number);
    const b1=BULAN_ID[m1-1].toUpperCase(), b2=BULAN_ID[m2-1].toUpperCase();
    if(y1===y2 && m1===m2) return `${b1} ${y1}`;
    if(y1===y2) return `${b1} - ${b2} ${y1}`;
    return `${b1} ${y1} - ${b2} ${y2}`;
  }

  // Gaya sel menirukan file LPJ yang dipakai kantor: seluruh isi Times New
  // Roman 12, judul & baris jumlah tebal, dan angka memakai format akuntansi
  // (numFmt 166 di file aslinya). Garis tabelnya juga sama polanya -- baris
  // header dan baris jumlah berkotak penuh, sedangkan baris item hanya
  // bergaris kiri-kanan, jadi tidak ada garis melintang antar item.
  const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="_(* #,##0_);_(* \\(#,##0\\);_(* &quot;-&quot;_);_(@_)"/></numFmts>
<fonts count="4">
<font><sz val="10"/><name val="Arial"/></font>
<font><sz val="12"/><name val="Times New Roman"/><family val="1"/></font>
<font><b/><sz val="12"/><name val="Times New Roman"/><family val="1"/></font>
<font><b/><u/><sz val="12"/><name val="Times New Roman"/><family val="1"/></font>
</fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
<borders count="3">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left style="thin"><color indexed="64"/></left><right style="thin"><color indexed="64"/></right><top style="thin"><color indexed="64"/></top><bottom style="thin"><color indexed="64"/></bottom><diagonal/></border>
<border><left style="thin"><color indexed="64"/></left><right style="thin"><color indexed="64"/></right><top/><bottom/><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="17">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center"/></xf>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="left"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center"/></xf>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="164" fontId="2" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="2" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="2" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
<xf numFmtId="0" fontId="1" fillId="0" borderId="2" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="1" fillId="0" borderId="2" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
<xf numFmtId="164" fontId="1" fillId="0" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="right"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="left"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="right"/></xf>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="left"/></xf>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="right"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

  // Blok tanda tangan: rata kiri untuk kolom kiri, rata kanan untuk kolom
  // kanan. Sebelumnya dua-duanya rata tengah di dalam sel gabungan, tapi
  // lebar kolom di sini mengikuti isi tabel (kolom Kegiatan hampir separuh
  // lebar surat), jadi titik tengah tiap gabungan jatuh di tempat yang tidak
  // beraturan dan blok tanda tangannya kelihatan berpencar.
  const S_RIGHT=12, S_BOLD_LEFT_PLAIN=13, S_BOLD_RIGHT=14, S_NAME_LEFT=15, S_NAME_RIGHT=16;
  const S_CENTER=1, S_LEFT_PLAIN=2, S_BOLD_CENTER=3, S_NAME=4,
        S_BOX_BOLD_CENTER=5, S_BOX_BOLD_MONEY=6,
        S_SIDE_BOLD_CENTER=7, S_SIDE_BOLD_LEFT=8,
        S_SIDE_CENTER=9, S_SIDE_LEFT=10, S_SIDE_MONEY=11;

  function buildWorkbookFiles(data){
    const groups = groupItems(data.items);
    const W = lebarKolom(data);
    const periode = data.periode || periodeOtomatis(data.items);
    const totalOps = groups.reduce((s,g)=>s+g.subtotal,0);
    const permintaan = angka(data.permintaanDana);
    const sisa = permintaan - totalOps;

    const rows=[];
    function addRow(rn,cells,height){rows.push({rn,cells,height});}
    function cell(col,style,opts){return Object.assign({col,style},opts);}
    const merges=[];

    const judul = barisJudul(Object.assign({}, data, { periode }));
    addRow(2,[cell(1,S_BOLD_CENTER,{type:'str',value:judul[0]})]);
    addRow(3,[cell(1,S_BOLD_CENTER,{type:'str',value:judul[1]})]);
    addRow(4,[cell(1,S_BOLD_CENTER,{type:'str',value:judul[2]})]);
    addRow(5,[cell(1,S_BOLD_CENTER,{type:'str',value:`Atas Voucher No. ${data.voucherNo||''}`})]);
    merges.push('A2:E2','A3:E3','A4:E4','A5:E5');

    const HEADER_ROW=7;
    addRow(HEADER_ROW,[
      cell(1,S_BOX_BOLD_CENTER,{type:'str',value:'No'}),
      cell(2,S_BOX_BOLD_CENTER,{type:'str',value:'Tanggal'}),
      cell(3,S_BOX_BOLD_CENTER,{type:'str',value:'Kegiatan'}),
      cell(4,S_BOX_BOLD_CENTER,{type:'str',value:'Keterangan'}),
      cell(5,S_BOX_BOLD_CENTER,{type:'str',value:'Jumlah'}),
    ]);

    // Baris item ditulis berurutan dari HEADER_ROW+1. Nomor baris tiap bagian
    // dicatat supaya rumus SUM di baris total menunjuk ke rentang yang benar.
    // Semua sel di area ini bergaris kiri-kanan saja -- garis penutup bawahnya
    // datang dari garis atas baris "Jumlah Biaya Operasional".
    let rn = HEADER_ROW + 1;
    const rentangItem = [];
    groups.forEach(g=>{
      // Judul bagian TIDAK menggabung B:C -- kalau digabung, garis pemisah
      // Tanggal|Kegiatan putus di baris ini dan tidak lurus dengan baris
      // item di bawahnya. Lebar kolom B sudah ikut memperhitungkan judul
      // bagian (lihat lebarKolom) supaya tetap muat tanpa penggabungan.
      addRow(rn,[
        cell(1,S_SIDE_BOLD_CENTER,{type:'str',value:g.romawi}),
        cell(2,S_SIDE_BOLD_LEFT,{type:'str',value:g.judul}),
        cell(3,S_SIDE_BOLD_LEFT,{type:'str',value:''}),
        cell(4,S_SIDE_CENTER,{type:'str',value:''}),
        cell(5,S_SIDE_MONEY,{type:'str',value:''}),
      ]);
      rn++;
      const awal = rn;
      g.items.forEach((it,i)=>{
        addRow(rn,[
          cell(1,S_SIDE_CENTER,{type:'num',value:i+1}),
          cell(2,S_SIDE_CENTER,{type:'str',value:formatTanggalIndo(it.tanggal)}),
          cell(3,S_SIDE_LEFT,{type:'str',value:it.kegiatan||''}),
          cell(4,S_SIDE_CENTER,{type:'str',value:it.jenis||''}),
          cell(5,S_SIDE_MONEY,{type:'num',value:angka(it.jumlah)}),
        ]);
        rn++;
      });
      rentangItem.push(`E${awal}:E${rn-1}`);
    });

    // Baris kosong pemisah, sama seperti format aslinya.
    addRow(rn,[
      cell(1,S_SIDE_CENTER,{type:'str',value:''}),
      cell(2,S_SIDE_CENTER,{type:'str',value:''}),
      cell(3,S_SIDE_LEFT,{type:'str',value:''}),
      cell(4,S_SIDE_CENTER,{type:'str',value:''}),
      cell(5,S_SIDE_MONEY,{type:'str',value:''}),
    ]);
    rn++;

    const rowOps = rn, rowMinta = rn+1, rowSisa = rn+2;
    const rumusTotal = rentangItem.length ? `SUM(${rentangItem.join(',')})` : '';
    // Kolom B-D ikut ditulis (kosong) walaupun nanti di-merge dengan A:
    // Excel menggambar garis kotak dari sel penyusunnya, kalau selnya tidak
    // ada garis kanan/bawah baris totalnya hilang sebagian.
    function barisTotal(rowNum, label, sel){
      addRow(rowNum,[
        cell(1,S_BOX_BOLD_CENTER,{type:'str',value:label}),
        cell(2,S_BOX_BOLD_CENTER,{type:'str',value:''}),
        cell(3,S_BOX_BOLD_CENTER,{type:'str',value:''}),
        cell(4,S_BOX_BOLD_CENTER,{type:'str',value:''}),
        sel,
      ]);
    }
    barisTotal(rowOps,'Jumlah Biaya Operasional', cell(5,S_BOX_BOLD_MONEY, rumusTotal
      ? {type:'formula',formula:rumusTotal,value:totalOps}
      : {type:'num',value:totalOps}));
    barisTotal(rowMinta,'Jumlah Permintaan Dana', cell(5,S_BOX_BOLD_MONEY,{type:'num',value:permintaan}));
    barisTotal(rowSisa,'Sisa Dana', cell(5,S_BOX_BOLD_MONEY,{type:'formula',formula:`E${rowMinta}-E${rowOps}`,value:sisa}));
    merges.push(`A${rowOps}:D${rowOps}`,`A${rowMinta}:D${rowMinta}`,`A${rowSisa}:D${rowSisa}`);

    // ---- blok tanda tangan ----
    const rTgl = rowSisa + 2;
    const rLabel = rTgl + 1;
    const rJabatan = rLabel + 1;
    const rNama = rJabatan + 4;          // ruang tanda tangan basah
    const rLabel2 = rNama + 3;
    const rJabatan2 = rLabel2 + 1;
    const rNama2 = rJabatan2 + 4;

    const koma = s => s ? s + ',' : '';
    // Kolom kiri dipatok ke tepi kiri kolom B, kolom kanan ke tepi kanan
    // kolom E, dan blok "Disetujui Oleh" digabung selebar tabel (A:E) supaya
    // benar-benar di tengah. Semuanya tidak bergantung pada lebar kolom yang
    // berubah-ubah mengikuti isi.
    addRow(rTgl,[cell(4,S_RIGHT,{type:'str',value:`Balikpapan, ${formatTanggalIndo(data.tanggalSurat)||''}`})]);
    merges.push(`C${rTgl}:E${rTgl}`);

    addRow(rLabel,[
      cell(1,S_BOLD_LEFT_PLAIN,{type:'str',value:'Diperiksa Oleh'}),
      cell(4,S_BOLD_RIGHT,{type:'str',value:'Dibuat Oleh'}),
    ]);
    addRow(rJabatan,[
      cell(1,S_LEFT_PLAIN,{type:'str',value:koma(data.pemeriksaJabatan)}),
      cell(4,S_RIGHT,{type:'str',value:koma(data.pembuatJabatan)}),
    ]);
    addRow(rNama,[
      cell(1,S_NAME_LEFT,{type:'str',value:data.pemeriksaNama||''}),
      cell(4,S_NAME_RIGHT,{type:'str',value:data.pembuatNama||''}),
    ]);
    merges.push(`A${rLabel}:C${rLabel}`,`D${rLabel}:E${rLabel}`,
                `A${rJabatan}:C${rJabatan}`,`D${rJabatan}:E${rJabatan}`,
                `A${rNama}:C${rNama}`,`D${rNama}:E${rNama}`);

    addRow(rLabel2,[cell(1,S_BOLD_CENTER,{type:'str',value:'Disetujui Oleh'})]);
    addRow(rJabatan2,[cell(1,S_CENTER,{type:'str',value:koma(data.penyetujuJabatan)})]);
    addRow(rNama2,[cell(1,S_NAME,{type:'str',value:data.penyetujuNama||''})]);
    merges.push(`A${rLabel2}:E${rLabel2}`,`A${rJabatan2}:E${rJabatan2}`,`A${rNama2}:E${rNama2}`);

    const LAST_ROW = rNama2 + 1;

    rows.sort((a,b)=>a.rn-b.rn);

    let sheetData='';
    for(const row of rows){
      const cellsXml=row.cells.map(c=>{
        const ref=`${colLetter(c.col)}${row.rn}`;
        if(c.type==='num') return `<c r="${ref}" s="${c.style}"><v>${c.value}</v></c>`;
        if(c.type==='formula') return `<c r="${ref}" s="${c.style}"><f>${xmlEscape(c.formula)}</f><v>${c.value}</v></c>`;
        return `<c r="${ref}" s="${c.style}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(c.value)}</t></is></c>`;
      }).join('');
      const heightAttr = row.height ? ` ht="${row.height}" customHeight="1"` : '';
      sheetData += `<row r="${row.rn}"${heightAttr}>${cellsXml}</row>`;
    }
    const mergeXml = merges.length
      ? `<mergeCells count="${merges.length}">${merges.map(m=>`<mergeCell ref="${m}"/>`).join('')}</mergeCells>`
      : '';

    const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>
<dimension ref="A1:E${LAST_ROW}"/>
<sheetViews><sheetView showGridLines="0" workbookViewId="0"/></sheetViews>
<sheetFormatPr defaultColWidth="9.109375" defaultRowHeight="15.6"/>
<cols>
<col min="1" max="1" width="${W.a}" customWidth="1"/>
<col min="2" max="2" width="${W.b}" customWidth="1"/>
<col min="3" max="3" width="${W.c}" customWidth="1"/>
<col min="4" max="4" width="${W.d}" customWidth="1"/>
<col min="5" max="5" width="${W.e}" customWidth="1"/>
</cols>
<sheetData>${sheetData}</sheetData>
${mergeXml}
<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>
<pageSetup paperSize="5" orientation="portrait" fitToWidth="1" fitToHeight="0"/>
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
<sheets><sheet name="LPJ" sheetId="1" r:id="rId1"/></sheets>
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
    const v = String(data.voucherNo||'').replace(/[^\w.-]+/g,'-') || 'tanpa-voucher';
    return `LPJ_${v}_${data.tanggalSurat||''}.xlsx`;
  }

  return {
    generateBytes: generateXlsxBytes,
    filename,
    groupItems,
    totalOperasional,
    periodeOtomatis,
    formatTanggalIndo,
    lebarKolom,
    barisJudul,
    KLASIFIKASI,
    JUDUL_DEFAULT,
    SUB_DIVISI_DEFAULT,
  };
})();
