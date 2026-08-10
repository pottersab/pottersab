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
  // Logo PERUMDA (image1.jpg) -- diisi oleh build-time script dari file
  // contoh LPJ Operasional.xlsx. Base64 supaya tetap jalan client-side.
  const LPJ_LOGO_B64 = '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';
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
  // TextEncoder.encode sudah mengembalikan Uint8Array -- tanpa Array.from
  // (yang membuat array JS perantara) supaya tidak ada alokasi ganda.
  function strToBytes(s){return new TextEncoder().encode(s);}

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
  // Judul kepala surat mengikuti contoh "LPJ Operasional.xlsx": SATU baris
  // judul (isi form "Judul surat" + "BIAYA OPERASIONAL SUB DIVISI X"), lalu
  // "BULAN ..." di baris berikutnya. Sub divisi dipisah supaya bisa diganti
  // (atau dikosongkan untuk pengguna umum) -- kalau kosong, kata "SUB DIVISI"
  // ikut hilang supaya tidak tertinggal menggantung.
  const JUDUL_DEFAULT = 'LAPORAN PERTANGGUNG JAWABAN';
  const SUB_DIVISI_DEFAULT = 'SUMBER AIR BAKU';
  function barisJudul(data){
    const sub = String(data.subDivisi || '').trim();
    // periodeOtomatis map+sort semua item -- dihitung sekali, dipakai dua kali
    // di ekspresi di bawah (sebelumnya dipanggil ganda tiap baris judul).
    const periode = data.periode || periodeOtomatis(data.items);
    const judulSurat = String(data.judul == null ? JUDUL_DEFAULT : data.judul).trim();
    const judulOps = sub ? `BIAYA OPERASIONAL SUB DIVISI ${sub}` : 'BIAYA OPERASIONAL';
    return [
      judulSurat ? `${judulSurat} ${judulOps}` : judulOps,
      periode ? `BULAN ${periode}` : ''
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
  const TOTAL_MAKS = 102, MIN_KEGIATAN = 24;
  function lebarKolom(data, gs){
    // gs = hasil groupItems() -- di-pass dari buildWorkbookFiles supaya
    // grouping yang mahal (filter+slice+sort+reduce) tidak dihitung dua kali
    // dalam satu generateBytes. Pratinjau memanggil tanpa gs, jadi dihitung
    // di sini kalau tidak dikirim.
    if(!gs) gs = groupItems(data.items);
    const tanggal=['Tanggal'], kegiatan=['Kegiatan'], jenis=['Keterangan'], nota=['Nota'], jumlah=['Jumlah'];
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
        nota.push('');
        jumlah.push(pisahRibu(it.jumlah));
      });
    });
    const permintaan = angka(data.permintaanDana);
    jumlah.push(pisahRibu(totalOps), pisahRibu(permintaan), pisahRibu(permintaan-totalOps));

    const panjang = arr => arr.reduce((m,s)=>Math.max(m, String(s==null?'':s).length), 0);

    let a = Math.max(4.44, String(nomorMaks).length + 3);
    let b = panjang(tanggal) + 3;
    let d = panjang(jenis) + 3;
    // Kolom Nota kosong (tidak ada isian di form) -- selebar kepala kolomnya.
    let e = Math.max(panjang(nota) + 3, 9);
    // Format akuntansi menyisakan ruang di kiri-kanan angka, jadi kolom
    // Jumlah perlu tambahan lebih banyak daripada kolom teks biasa.
    let f = Math.max(panjang(jumlah) + 5, 12);
    // Blok tanda tangan kanan memakai gabungan kolom D+E+F, dan sel gabungan
    // memotong teks yang kelebihan -- jadi lebarnya dijaga di sini.
    const kanan = panjang(['Dibuat Oleh', data.pembuatJabatan||'', data.pembuatNama||'']) + 2;
    if(d + e + f < kanan) f += kanan - (d + e + f);

    // Kegiatan selebar uraian terpanjangnya. Kalau sisa lebar halaman tidak
    // cukup, kolom ini yang dipersempit -- dia satu-satunya yang teksnya
    // boleh dibungkus ke baris berikutnya.
    const sisa = TOTAL_MAKS - (a + b + d + e + f);
    const c = Math.min(Math.max(panjang(kegiatan) + 3, MIN_KEGIATAN), Math.max(MIN_KEGIATAN, sisa));

    const bulat = n => Math.round(n*100)/100;
    return { a:bulat(a), b:bulat(b), c:bulat(c), d:bulat(d), e:bulat(e), f:bulat(f) };
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
<fonts count="6">
<font><sz val="10"/><name val="Arial"/></font>
<font><sz val="12"/><name val="Times New Roman"/><family val="1"/></font>
<font><b/><sz val="12"/><name val="Times New Roman"/><family val="1"/></font>
<font><b/><sz val="12"/><name val="Times New Roman"/><family val="1"/></font>
<font><sz val="11"/><name val="Times New Roman"/><family val="1"/></font>
<font><b/><sz val="12"/><name val="Arial"/></font>
</fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
<borders count="4">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left style="thin"><color indexed="64"/></left><right style="thin"><color indexed="64"/></right><top style="thin"><color indexed="64"/></top><bottom style="thin"><color indexed="64"/></bottom><diagonal/></border>
<border><left style="thin"><color indexed="64"/></left><right style="thin"><color indexed="64"/></right><top/><bottom/><diagonal/></border>
<border><top style="medium"><color indexed="64"/></top><left/><right/><bottom/><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="16">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center"/></xf>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="left"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="middle" wrapText="1"/></xf>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="middle" wrapText="1"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="164" fontId="2" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="2" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="2" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
<xf numFmtId="0" fontId="1" fillId="0" borderId="2" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="1" fillId="0" borderId="2" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
<xf numFmtId="164" fontId="1" fillId="0" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="right"/></xf>
<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="middle"/></xf>
<xf numFmtId="0" fontId="1" fillId="0" borderId="3" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="middle"/></xf>
<xf numFmtId="0" fontId="5" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="middle" wrapText="1"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

  const S_RIGHT=12;
  const S_CENTER=1, S_LEFT_PLAIN=2, S_BOLD_CENTER=3, S_NAME=4,
        S_BOX_BOLD_CENTER=5, S_BOX_BOLD_MONEY=6,
        S_SIDE_BOLD_CENTER=7, S_SIDE_BOLD_LEFT=8,
        S_SIDE_CENTER=9, S_SIDE_LEFT=10, S_SIDE_MONEY=11;
  const S_FOOTER=13; // footer alamat perusahaan (TNR 11, center)
  const S_LINE=14;   // garis horizontal header/footer (border atas medium)
  const S_KOP=15;    // nama perusahaan di kop (Arial 12 tebal, center, wrap)

  function buildWorkbookFiles(data){
    const groups = groupItems(data.items);
    // groups dihitung sekali di sini, dipakai untuk lebar kolom, total, dan
    // baris-baris tabel -- bukan dihitung ulang per fungsi.
    const W = lebarKolom(data, groups);
    const periode = data.periode || periodeOtomatis(data.items);
    const totalOps = groups.reduce((s,g)=>s+g.subtotal,0);
    const permintaan = angka(data.permintaanDana);
    const sisa = permintaan - totalOps;

    const rows=[];
    function addRow(rn,cells,height){rows.push({rn,cells,height});}
    function cell(col,style,opts){return Object.assign({col,style},opts);}
    const merges=[];

    const judul = barisJudul(Object.assign({}, data, { periode }));
    // Kop: nama perusahaan di baris 1 (logo PERUMDA digambar sebagai gambar,
    // lihat drawing1.xml di bawah), garis bawah kop di baris 2 (garis header).
    // Baris 3-6 disisakan untuk letterhead, judul mulai baris 7 seperti contoh.
    addRow(1,[cell(2,S_KOP,{type:'str',value:'PERUSAHAAN UMUM DAERAH\nTIRTA MANUNTUNG BALIKPAPAN'})], 30);
    merges.push('B1:F1');
    addRow(2,[
      cell(1,S_LINE,{type:'str',value:''}), cell(2,S_LINE,{type:'str',value:''}),
      cell(3,S_LINE,{type:'str',value:''}), cell(4,S_LINE,{type:'str',value:''}),
      cell(5,S_LINE,{type:'str',value:''}), cell(6,S_LINE,{type:'str',value:''}),
    ]);
    addRow(7,[cell(1,S_BOLD_CENTER,{type:'str',value:judul[0]})]);
    addRow(8,[cell(1,S_BOLD_CENTER,{type:'str',value:judul[1]})]);
    addRow(9,[cell(1,S_BOLD_CENTER,{type:'str',value:`Atas PDK No. ${data.voucherNo||''}`})]);
    merges.push('A7:F7','A8:F8','A9:F9');

    const HEADER_ROW=11;
    addRow(HEADER_ROW,[
      cell(1,S_BOX_BOLD_CENTER,{type:'str',value:'No'}),
      cell(2,S_BOX_BOLD_CENTER,{type:'str',value:'Tanggal'}),
      cell(3,S_BOX_BOLD_CENTER,{type:'str',value:'Kegiatan'}),
      cell(4,S_BOX_BOLD_CENTER,{type:'str',value:'Keterangan'}),
      cell(5,S_BOX_BOLD_CENTER,{type:'str',value:'Nota'}),
      cell(6,S_BOX_BOLD_CENTER,{type:'str',value:'Jumlah'}),
    ]);

    // Baris item ditulis berurutan dari HEADER_ROW+1. Nomor baris tiap bagian
    // dicatat supaya rumus SUM di baris total menunjuk ke rentang yang benar.
    // Semua sel di area ini bergaris kiri-kanan saja -- garis penutup bawahnya
    // datang dari garis atas baris "Jumlah Biaya Operasional".
    let rn = HEADER_ROW + 1;  // baris 12: pemisah di bawah kepala kolom (contoh)
    addRow(rn,[
      cell(1,S_SIDE_CENTER,{type:'str',value:''}),
      cell(2,S_SIDE_CENTER,{type:'str',value:''}),
      cell(3,S_SIDE_LEFT,{type:'str',value:''}),
      cell(4,S_SIDE_CENTER,{type:'str',value:''}),
      cell(5,S_SIDE_CENTER,{type:'str',value:''}),
      cell(6,S_SIDE_MONEY,{type:'str',value:''}),
    ]);
    rn++;
    const rentangItem = [];
    groups.forEach(g=>{
      // Judul bagian (I Biaya Konsumsi, dst) TIDAK di-merge B:C -- kalau
      // digabung, garis pemisah Tanggal|Kegiatan putus di baris ini dan tidak
      // lurus dengan baris item di bawahnya (permintaan user). Lebar kolom B
      // sudah memperhitungkan judul bagian (lihat lebarKolom).
      addRow(rn,[
        cell(1,S_SIDE_BOLD_CENTER,{type:'str',value:g.romawi}),
        cell(2,S_SIDE_BOLD_LEFT,{type:'str',value:g.judul}),
        cell(3,S_SIDE_BOLD_LEFT,{type:'str',value:''}),
        cell(4,S_SIDE_CENTER,{type:'str',value:''}),
        cell(5,S_SIDE_CENTER,{type:'str',value:''}),
        cell(6,S_SIDE_MONEY,{type:'str',value:''}),
      ]);
      rn++;
      const awal = rn;
      g.items.forEach((it,i)=>{
        addRow(rn,[
          cell(1,S_SIDE_CENTER,{type:'num',value:i+1}),
          cell(2,S_SIDE_CENTER,{type:'str',value:formatTanggalIndo(it.tanggal)}),
          cell(3,S_SIDE_LEFT,{type:'str',value:it.kegiatan||''}),
          cell(4,S_SIDE_CENTER,{type:'str',value:it.jenis||''}),
          cell(5,S_SIDE_CENTER,{type:'str',value:''}),   // Nota (tidak ada isian form)
          cell(6,S_SIDE_MONEY,{type:'num',value:angka(it.jumlah)}),
        ]);
        rn++;
      });
      rentangItem.push(`F${awal}:F${rn-1}`);
      // Baris kosong pemisah antar bagian (dan sebelum total) -- seperti contoh.
      addRow(rn,[
        cell(1,S_SIDE_CENTER,{type:'str',value:''}),
        cell(2,S_SIDE_CENTER,{type:'str',value:''}),
        cell(3,S_SIDE_LEFT,{type:'str',value:''}),
        cell(4,S_SIDE_CENTER,{type:'str',value:''}),
        cell(5,S_SIDE_CENTER,{type:'str',value:''}),
        cell(6,S_SIDE_MONEY,{type:'str',value:''}),
      ]);
      rn++;
    });

    const rowOps = rn, rowMinta = rn+1, rowSisa = rn+2;
    const rumusTotal = rentangItem.length ? `SUM(${rentangItem.join(',')})` : '';
    // Kolom B-E ikut ditulis (kosong) walaupun nanti di-merge dengan A:
    // Excel menggambar garis kotak dari sel penyusunnya, kalau selnya tidak
    // ada garis kanan/bawah baris totalnya hilang sebagian.
    function barisTotal(rowNum, label, sel){
      addRow(rowNum,[
        cell(1,S_BOX_BOLD_CENTER,{type:'str',value:label}),
        cell(2,S_BOX_BOLD_CENTER,{type:'str',value:''}),
        cell(3,S_BOX_BOLD_CENTER,{type:'str',value:''}),
        cell(4,S_BOX_BOLD_CENTER,{type:'str',value:''}),
        cell(5,S_BOX_BOLD_CENTER,{type:'str',value:''}),
        sel,
      ]);
    }
    barisTotal(rowOps,'Jumlah Biaya Operasional', cell(6,S_BOX_BOLD_MONEY, rumusTotal
      ? {type:'formula',formula:rumusTotal,value:totalOps}
      : {type:'num',value:totalOps}));
    barisTotal(rowMinta,'Jumlah Permintaan Dana', cell(6,S_BOX_BOLD_MONEY,{type:'num',value:permintaan}));
    barisTotal(rowSisa,'Sisa Dana', cell(6,S_BOX_BOLD_MONEY,{type:'formula',formula:`F${rowMinta}-F${rowOps}`,value:sisa}));
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
    // Surat dibagi dua: separuh kiri (A:C) untuk "Diperiksa Oleh", separuh
    // kanan (D:F) untuk "Dibuat Oleh", dan "Disetujui Oleh" digabung selebar
    // tabel (A:F). Isinya rata tengah di dalam gabungannya masing-masing --
    // yang membuat versi sebelumnya kelihatan berpencar bukan perataannya,
    // tapi gabungan yang belum membelah surat jadi dua bagian utuh.
    // Tanggal surat rata kanan supaya menempel di tepi kanan tabel.
    addRow(rTgl,[cell(4,S_RIGHT,{type:'str',value:`Balikpapan, ${formatTanggalIndo(data.tanggalSurat)||''}`})]);
    merges.push(`C${rTgl}:F${rTgl}`);

    addRow(rLabel,[
      cell(1,S_BOLD_CENTER,{type:'str',value:'Diperiksa Oleh'}),
      cell(4,S_BOLD_CENTER,{type:'str',value:'Dibuat Oleh'}),
    ]);
    addRow(rJabatan,[
      cell(1,S_CENTER,{type:'str',value:koma(data.pemeriksaJabatan)}),
      cell(4,S_CENTER,{type:'str',value:koma(data.pembuatJabatan)}),
    ]);
    addRow(rNama,[
      cell(1,S_NAME,{type:'str',value:data.pemeriksaNama||''}),
      cell(4,S_NAME,{type:'str',value:data.pembuatNama||''}),
    ]);
    merges.push(`A${rLabel}:C${rLabel}`,`D${rLabel}:F${rLabel}`,
                `A${rJabatan}:C${rJabatan}`,`D${rJabatan}:F${rJabatan}`,
                `A${rNama}:C${rNama}`,`D${rNama}:F${rNama}`);

    addRow(rLabel2,[cell(1,S_BOLD_CENTER,{type:'str',value:'Disetujui Oleh'})]);
    addRow(rJabatan2,[cell(1,S_CENTER,{type:'str',value:koma(data.penyetujuJabatan)})]);
    addRow(rNama2,[cell(1,S_NAME,{type:'str',value:data.penyetujuNama||''})]);
    merges.push(`A${rLabel2}:F${rLabel2}`,`A${rJabatan2}:F${rJabatan2}`,`A${rNama2}:F${rNama2}`);

    // ---- footer alamat perusahaan (persis contoh) ----
    const rFooterLine = rNama2 + 2;  // garis footer, sama seperti garis header
    addRow(rFooterLine,[
      cell(1,S_LINE,{type:'str',value:''}), cell(2,S_LINE,{type:'str',value:''}),
      cell(3,S_LINE,{type:'str',value:''}), cell(4,S_LINE,{type:'str',value:''}),
      cell(5,S_LINE,{type:'str',value:''}), cell(6,S_LINE,{type:'str',value:''}),
    ]);
    const rFooter = rFooterLine + 1;
    addRow(rFooter,[cell(1,S_FOOTER,{type:'str',value:'Graha Tirta Jl. Ruhui Rahayu I, Balikpapan, Kalimantan Timur'})]);
    addRow(rFooter+1,[cell(1,S_FOOTER,{type:'str',value:'Telp. (0542) 7218831- 7218832 Fax. (0542) 7218863'})]);
    addRow(rFooter+2,[cell(1,S_FOOTER,{type:'str',value:'E-mail : humas@tirtamanuntung.co.id - http//:www.tirtamanuntung.co.id'})]);
    merges.push(`A${rFooter}:F${rFooter}`,`A${rFooter+1}:F${rFooter+1}`,`A${rFooter+2}:F${rFooter+2}`);

    const LAST_ROW = rFooter + 2;

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
<dimension ref="A1:F${LAST_ROW}"/>
<sheetViews><sheetView showGridLines="0" workbookViewId="0"/></sheetViews>
<sheetFormatPr defaultColWidth="9.109375" defaultRowHeight="15.6"/>
<cols>
<col min="1" max="1" width="${W.a}" customWidth="1"/>
<col min="2" max="2" width="${W.b}" customWidth="1"/>
<col min="3" max="3" width="${W.c}" customWidth="1"/>
<col min="4" max="4" width="${W.d}" customWidth="1"/>
<col min="5" max="5" width="${W.e}" customWidth="1"/>
<col min="6" max="6" width="${W.f}" customWidth="1"/>
</cols>
<sheetData>${sheetData}</sheetData>
${mergeXml}
<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>
<pageSetup paperSize="5" orientation="portrait" fitToWidth="1" fitToHeight="0"/>
<drawing r:id="rId1"/>
</worksheet>`;

    const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Default Extension="jpeg" ContentType="image/jpeg"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>
</Types>`;

    const RELS_ROOT = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

    const WORKBOOK_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="LPJ Operasional" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;

    const WORKBOOK_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

    // Relasi worksheet -> drawing (logo kop) dan drawing -> media gambar.
    const SHEET_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/>
</Relationships>`;
    const DRAWING_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.jpg"/>
</Relationships>`;

    // Drawing logo PERUMDA di pojok kiri-atas (sel A1, ~0,75cm persegi).
    const DRAWING_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
<xdr:oneCellAnchor>
  <xdr:from><xdr:col>0</xdr:col><xdr:colOff>152400</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>120000</xdr:rowOff></xdr:from>
  <xdr:ext cx="752475" cy="752475"/>
  <xdr:pic>
    <xdr:nvPicPr>
      <xdr:cNvPr id="1" name="logo" descr="pdam_color"/>
      <xdr:cNvPicPr preferRelativeResize="0"/>
    </xdr:nvPicPr>
    <xdr:blipFill>
      <a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="rId1" cstate="print"/>
      <a:stretch><a:fillRect/></a:stretch>
    </xdr:blipFill>
    <xdr:spPr>
      <a:xfrm><a:off x="152400" y="120000"/><a:ext cx="752475" cy="752475"/></a:xfrm>
      <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
      <a:noFill/>
    </xdr:spPr>
  </xdr:pic>
  <xdr:clientData/>
</xdr:oneCellAnchor>
</xdr:wsDr>`;

    function toBytes(s){return strToBytes(s);}
    // Logo PERUMDA (image1.jpg dari contoh) di-embed sebagai base64.
    function logoBytes(){
      const b64 = LPJ_LOGO_B64;
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return bytes;
    }

    return [
      {name:'[Content_Types].xml',data:toBytes(CONTENT_TYPES)},
      {name:'_rels/.rels',data:toBytes(RELS_ROOT)},
      {name:'xl/workbook.xml',data:toBytes(WORKBOOK_XML)},
      {name:'xl/_rels/workbook.xml.rels',data:toBytes(WORKBOOK_RELS)},
      {name:'xl/styles.xml',data:toBytes(STYLES_XML)},
      {name:'xl/worksheets/sheet1.xml',data:toBytes(sheetXml)},
      {name:'xl/worksheets/_rels/sheet1.xml.rels',data:toBytes(SHEET_RELS)},
      {name:'xl/drawings/drawing1.xml',data:toBytes(DRAWING_XML)},
      {name:'xl/drawings/_rels/drawing1.xml.rels',data:toBytes(DRAWING_RELS)},
      {name:'xl/media/image1.jpg',data:logoBytes()},
    ];
  }

  function generateXlsxBytes(data){
    return createZip(buildWorkbookFiles(data));
  }
  function filename(data){
    // Format yang dipakai kantor: "LPJ_<Bulan>-<tahun>.xlsx" (mis.
    // "LPJ_Agustus-2026.xlsx"), diambil dari tanggal surat.
    const [y, m] = String(data.tanggalSurat || '').split('-').map(Number);
    const bln = (y && m && BULAN_ID[m-1]) ? `${BULAN_ID[m-1]}-${y}` : (data.tanggalSurat || 'tanpa-tanggal');
    return `LPJ_${bln}.xlsx`;
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
