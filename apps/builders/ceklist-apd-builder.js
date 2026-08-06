// Builder Ceklist APD (.xlsx) -- diekstrak & dirapikan dari fungsi
// downloadExcel() di apps/ceklist-apd.html supaya bisa dipakai ulang dari
// admin-dashboard.html (fitur "Unduh Ulang" di Riwayat Surat).
//
// Beda dengan builder jenis surat lain: downloadExcel() aslinya membaca
// nilai langsung dari elemen DOM (document.getElementById('fTanggal').value,
// dst) dan dari variabel global `state`, bukan dari satu parameter data --
// jadi di sini diubah supaya generateBytes(d) menerima SATU objek data
// { lokasi, tanggal, docnum, persons, apds, cells, catatan, periksaJab,
// periksaNama, tahuJab, tahuNama }. ceklist-apd.html sendiri tidak diubah;
// dia tetap punya downloadExcel() versi aslinya yang baca dari DOM.
//
// Perlu ExcelJS (window.ExcelJS) sudah di-load sebelum file ini dipakai --
// baik di ceklist-apd.html maupun admin-dashboard.html.
window.CeklistApdBuilder = (function () {
const DOCNUM = 'PTMBBPP-SR-K3/01-02';
const LOGO_B64 = window.KopAssets.LOGO_CEKLIST;
function fmtTanggal(iso){
  if(!iso) return '';
  const bln=['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
  const [y,m,d]=iso.split('-');
  return `${parseInt(d)} ${bln[parseInt(m)-1]} ${y}`;
}

async function generateBytes(d){
  const wb=new ExcelJS.Workbook();
  const ws=wb.addWorksheet('Ceklist APD',{
    pageSetup:{orientation:'landscape',paperSize:9,fitToPage:true,fitToWidth:1,fitToHeight:0,
      margins:{left:0.35,right:0.35,top:0.4,bottom:0.4,header:0.2,footer:0.2}}
  });

  const TNR = (opt={}) => Object.assign({name:'Times New Roman',size:12}, opt);
  const nApd=d.apds.length;
  const lastCol=3+nApd+1;
  const thin={style:'thin'}, med={style:'medium'}, dbl={style:'double'};
  const allThin={top:thin,left:thin,bottom:thin,right:thin};
  const allMed={top:med,left:med,bottom:med,right:med};

  ws.getColumn(1).width=4.9; ws.getColumn(2).width=18; ws.getColumn(3).width=16;
  for(let i=0;i<nApd;i++) ws.getColumn(4+i).width=6;
  ws.getColumn(lastCol).width=24;

  const imgId=wb.addImage({base64:LOGO_B64, extension:'jpeg'});
  ws.addImage(imgId,{tl:{col:0.15,row:0.4}, ext:{width:87,height:61}});
  ws.mergeCells(1,3,4,lastCol);
  const tc=ws.getCell(1,3);
  tc.value='CEKLIST INSPEKSI APD';
  tc.font=TNR({bold:true,size:24});
  tc.alignment={horizontal:'center',vertical:'middle'};
  tc.border={top:thin, bottom:thin, left:thin, right:thin};
  ws.getRow(1).height=15; ws.getRow(2).height=15; ws.getRow(3).height=15; ws.getRow(4).height=15;

  const tgl=fmtTanggal(d.tanggal);
  const infoR1=6, infoR2=7;
  function infoBox(c1,c2,text,size){
    ws.mergeCells(infoR1,c1,infoR2,c2);
    const cell=ws.getCell(infoR1,c1);
    cell.value=text;
    cell.font=TNR({bold:true,size:size});
    cell.alignment={horizontal:c1===1?'left':'center',vertical:'middle',indent:c1===1?1:0};
    cell.border={top:med, bottom:med, left:med, right:med};
  }
  const midStart=4;
  // Klem supaya kotak "Jumlah Personel" & "Tanggal" tidak pernah saling
  // tumpang tindih atau keluar dari lastCol kalau daftar APD (nApd) sedikit
  // (di bawah ±4 kolom) -- rumus asli mengasumsikan nApd selalu besar.
  let midEnd = Math.min(3+Math.max(4,nApd-4), lastCol-1);
  midEnd = Math.max(midEnd, midStart);
  infoBox(1,3,`Lokasi : ${d.lokasi}`,12);
  infoBox(midStart,midEnd,`Jumlah Personel : ${d.persons.length} Orang`,14);
  infoBox(midEnd+1,lastCol,`Tanggal : ${tgl}`,14);

  const h1=9,h2=10;
  ws.mergeCells(h1,1,h2,1); ws.getCell(h1,1).value='NO';
  ws.mergeCells(h1,2,h2,2); ws.getCell(h1,2).value='NAMA';
  ws.mergeCells(h1,3,h2,3); ws.getCell(h1,3).value='JABATAN';
  ws.mergeCells(h1,4,h1,3+nApd); ws.getCell(h1,4).value='Seragam & APD';
  ws.mergeCells(h1,lastCol,h2,lastCol); ws.getCell(h1,lastCol).value='Komentar';
  ws.getCell(h1,1).border={top:dbl,bottom:thin,left:dbl,right:thin};
  ws.getCell(h1,2).border={top:dbl,bottom:thin,left:thin,right:thin};
  ws.getCell(h1,3).border={top:dbl,bottom:thin,left:thin,right:thin};
  ws.getCell(h1,4).border={top:dbl,bottom:thin,left:thin,right:thin};
  ws.getCell(h1,lastCol).border={top:dbl,bottom:thin,left:thin,right:dbl};
  [1,2,3,4,lastCol].forEach(c=>{
    const cell=ws.getCell(h1,c);
    cell.alignment={horizontal:'center',vertical:'middle'};
    cell.font=TNR({bold:true,size:14});
  });
  d.apds.forEach((a,i)=>{
    const c=ws.getCell(h2,4+i);
    c.value=a;
    c.alignment={textRotation:90,horizontal:'center',vertical:'bottom',wrapText:true};
    c.font=TNR({size:10});
    c.border=allThin;
  });
  ws.getRow(h2).height=88;

  let r=h2+1;
  d.persons.forEach((p,pi)=>{
    ws.getCell(r,1).value=pi+1;
    ws.getCell(r,2).value=p.nama;
    ws.getCell(r,3).value=p.jabatan;
    d.apds.forEach((a,ai)=>{
      const c=ws.getCell(r,4+ai);
      c.value=d.cells[pi][ai];
      c.alignment={horizontal:'center'};
      c.font=TNR({bold:true,size:14});
    });
    ws.getCell(r,lastCol).value=p.komentar||'';
    const isLast = pi===d.persons.length-1;
    for(let col=1;col<=lastCol;col++){
      const c=ws.getCell(r,col);
      c.border={top:thin,bottom:isLast?dbl:thin,left:col===1?dbl:thin,right:col===lastCol?dbl:thin};
      if(!c.font || !c.font.name) c.font=TNR({size:14});
      if(col===1) c.alignment={horizontal:'center'};
    }
    ws.getCell(r,2).font=TNR({size:14});
    ws.getCell(r,3).font=TNR({size:14});
    ws.getCell(r,lastCol).font=TNR({size:12});
    r++;
  });

  r++;
  ws.mergeCells(r,lastCol-3,r,lastCol);
  const dn=ws.getCell(r,lastCol-3);
  dn.value=d.docnum || DOCNUM;
  dn.font=TNR({bold:true,size:11});
  dn.alignment={horizontal:'center'};
  dn.border={top:thin,bottom:thin,left:thin,right:thin};

  r+=3;
  const L=r;
  ws.getCell(L,1).value='Legend :'; ws.getCell(L,1).font=TNR({bold:true,size:12});
  const legend=[['√',': OK'],['X',': Rusak'],['K',': Kosong (Tidak Tersedia)'],['TP',': Tidak Perlu']];
  legend.forEach((row,i)=>{
    ws.getCell(L+1+i,2).value=row[0];
    ws.getCell(L+1+i,3).value=row[1];
    ws.getCell(L+1+i,2).font=TNR({bold:true,size:12});
    ws.getCell(L+1+i,3).font=TNR({bold:true,size:12});
  });
  ws.getCell(L+6,1).value='Catatan : '+(d.catatan||'');
  ws.getCell(L+6,1).font=TNR({bold:true,size:12});

  // Lebar blok tanda tangan menyesuaikan lastCol -- tetap 4 kolom seperti
  // semula untuk tabel normal (nApd besar), tapi mengecil kalau daftar APD
  // sangat sedikit supaya blok "Diperiksa" & "Diketahui" tidak pernah
  // tumpang tindih (dulu bisa Cannot merge already merged cells kalau
  // nApd <= 6).
  const signW=Math.min(4, Math.max(1, Math.floor((lastCol-3)/2)));
  const sCol2=lastCol-signW+1, sCol1=Math.max(4, sCol2-signW-3);
  function signBlock(col,label,jab,nama){
    ws.mergeCells(L,col,L,col+signW-1);
    ws.getCell(L,col).value=label;
    ws.getCell(L,col).alignment={horizontal:'center'};
    ws.getCell(L,col).font=TNR({size:12});
    ws.mergeCells(L+1,col,L+1,col+signW-1);
    ws.getCell(L+1,col).value=jab;
    ws.getCell(L+1,col).alignment={horizontal:'center'};
    ws.getCell(L+1,col).font=TNR({size:12});
    ws.mergeCells(L+6,col,L+6,col+signW-1);
    const n=ws.getCell(L+6,col);
    n.value=(nama||'').toUpperCase();
    n.alignment={horizontal:'center'};
    n.font=TNR({bold:true,size:12});
    n.border={bottom:thin};
  }
  signBlock(sCol1,'Diperiksa Oleh,',d.periksaJab,d.periksaNama);
  signBlock(sCol2,'Diketahui Oleh,',d.tahuJab,d.tahuNama);

  return await wb.xlsx.writeBuffer();
}

function filename(d){
  const lok=(d.lokasi||'draft').replace(/[^a-z0-9]+/gi,'_');
  return `Ceklist_APD_${lok}_${d.tanggal}.xlsx`;
}

return { generateBytes: generateBytes, filename: filename };
})();
