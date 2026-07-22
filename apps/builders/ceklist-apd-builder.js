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
const LOGO_B64 = "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";
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
