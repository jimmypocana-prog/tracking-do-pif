/**
 * export.js — Export Laporan Delivery ke PDF & Excel (.xlsx)
 * Program: Tracking Delivery Order - PIF
 */

function exportReportToPdf(items, summary, filters) {
  if (!items || !items.length) {
    showToast('Tidak ada data laporan untuk diexport ke PDF.', 'warning');
    return;
  }

  var periodText = (filters.dateFrom || 'Semua') + ' s/d ' + (filters.dateTo || 'Semua');
  var printedAt = formatDateTimeID(new Date().toISOString());

  if (window.jspdf && window.jspdf.jsPDF) {
    var jsPDFCtor = window.jspdf.jsPDF;
    var doc = new jsPDFCtor({ orientation: 'landscape', unit: 'mm', format: 'a4' });

    doc.setFillColor(15, 23, 42);
    doc.rect(0, 0, 297, 22, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(14);
    doc.setFont(undefined, 'bold');
    doc.text('TRACKING DELIVERY ORDER - PIF | LAPORAN PENGIRIMAN', 12, 10);
    doc.setFontSize(9);
    doc.setFont(undefined, 'normal');
    var viaSubText = '   |   VIA: ' + ((filters && filters.via) ? filters.via : 'Semua VIA');
    var drvSubText = (filters && filters.driverName) ? '   |   Petugas: ' + filters.driverName : '   |   Petugas: Semua';
    var cstSubText = (filters && filters.customerName) ? '   |   Cust: ' + filters.customerName : '';
    var stSubText = (filters && filters.status) ? '   |   Status: ' + filters.status : '';
    doc.text('Periode: ' + periodText + viaSubText + drvSubText + cstSubText + stSubText + '   |   Dicetak: ' + printedAt, 12, 16.5);

    doc.setTextColor(15, 23, 42);
    doc.setFontSize(9);
    var kpiText =
      'Total DO: ' + (summary.total || 0) +
      '   |   Selesai: ' + (summary.selesai || 0) +
      '   |   Dalam Proses: ' + (summary.dalamProses || 0) +
      '   |   Siap Pick Up: ' + (summary.siapPickUp || 0) +
      '   |   Gagal Kirim: ' + (summary.gagalKirim || 0) +
      '   |   Kirim Ulang: ' + (summary.redeliveryCount || 0);
    doc.text(kpiText, 12, 29);

    var head = [[
      'No',
      'ID Tracking',
      'Tgl DO',
      'Nomor DO',
      'VIA',
      'Ke',
      'Customer',
      'Driver / Kurir',
      'Mobil',
      'Status',
      'Pick Up',
      'Check-In & Penerima',
      'Check-Out',
      'Ket. / Alasan Gagal'
    ]];

    var body = [];
    for (var i = 0; i < items.length; i++) {
      var d = items[i];
      var mobilInfo = d.platMobil
        ? (d.platMobil + (d.jenisMobil ? '\n' + d.jenisMobil : ''))
        : '-';
      var pickUpInfo = d.waktuPickUp
        ? formatDateTimeID(d.waktuPickUp) +
          (d.pickUpLat !== null && d.pickUpLat !== undefined && d.pickUpLat !== '' ? '\nGPS: ' + d.pickUpLat + ', ' + d.pickUpLng : '')
        : '-';
      var checkInLabel = (d.via === 'Kurir' || d.via === 'Online') ? 'Selesai: ' : 'Penerima: ';
      var checkInInfo = d.waktuCheckIn
        ? formatDateTimeID(d.waktuCheckIn) + '\n' + checkInLabel + (d.namaPenerima || '-') +
          (d.checkInLat !== null && d.checkInLat !== undefined && d.checkInLat !== '' ? '\nGPS: ' + d.checkInLat + ', ' + d.checkInLng : '')
        : '-';
      var checkOutInfo = d.waktuCheckOut
        ? formatDateTimeID(d.waktuCheckOut) +
          (d.checkOutLat !== null && d.checkOutLat !== undefined && d.checkOutLat !== '' ? '\nGPS: ' + d.checkOutLat + ', ' + d.checkOutLng : '')
        : '-';
      var notes = '';
      if (d.status === 'Gagal Kirim') {
        notes = 'GAGAL: ' + (d.alasanGagalKirim || '-') +
          (d.gagalKirimLat !== null && d.gagalKirimLat !== undefined && d.gagalKirimLat !== '' ? '\nGPS: ' + d.gagalKirimLat + ', ' + d.gagalKirimLng : '');
      } else {
        notes = d.keterangan || '-';
      }

      body.push([
        String(i + 1),
        d.idTracking,
        formatDateID(d.tanggalDO),
        d.nomorDO,
        d.via || 'Driver',
        '#' + (d.percobaanKe || 1),
        d.namaCustomer,
        d.namaDriver,
        mobilInfo,
        d.status,
        pickUpInfo,
        checkInInfo,
        checkOutInfo,
        notes
      ]);
    }

    if (typeof doc.autoTable === 'function') {
      doc.autoTable({
        startY: 33,
        head: head,
        body: body,
        theme: 'grid',
        styles: {
          fontSize: 7.0,
          cellPadding: 2.0,
          valign: 'top',
          textColor: [15, 23, 42]
        },
        headStyles: {
          fillColor: [30, 41, 59],
          textColor: [255, 255, 255],
          fontStyle: 'bold'
        },
        columnStyles: {
          0: { cellWidth: 6 },
          1: { cellWidth: 21 },
          2: { cellWidth: 16 },
          3: { cellWidth: 21 },
          4: { cellWidth: 13 },
          5: { cellWidth: 7 },
          6: { cellWidth: 24 },
          7: { cellWidth: 20 },
          8: { cellWidth: 18 },
          9: { cellWidth: 18 },
          10: { cellWidth: 22 },
          11: { cellWidth: 30 },
          12: { cellWidth: 23 },
          13: { cellWidth: 38 }
        },
        margin: { left: 10, right: 10 }
      });
    }

    var pdfName = 'Laporan_Delivery_PIF_' + getTodayYMD() + '.pdf';
    if (window.AndroidApp && typeof window.AndroidApp.saveBase64File === 'function') {
      var pdfDataUri = doc.output('datauristring');
      window.AndroidApp.saveBase64File(pdfDataUri, pdfName, 'application/pdf');
      showToast('Mengunduh PDF laporan ke folder Download HP...', 'success');
      return;
    }

    doc.save(pdfName);
    showToast('File PDF laporan berhasil diunduh.', 'success');
    return;
  }

  // Fallback jika library CDN offline: buka tampilan cetak browser
  var win = window.open('', '_blank');
  if (!win) {
    showToast('Pop-up diblokir browser. Izinkan pop-up untuk mencetak PDF.', 'warning');
    return;
  }
  var rowsHtml = '';
  for (var j = 0; j < items.length; j++) {
    var row = items[j];
    var rowMobil = row.platMobil
      ? escapeHtml(row.platMobil) + (row.jenisMobil ? '<br/><small>' + escapeHtml(row.jenisMobil) + '</small>' : '')
      : '-';
    rowsHtml += '<tr>' +
      '<td>' + (j + 1) + '</td>' +
      '<td>' + escapeHtml(row.idTracking) + '</td>' +
      '<td>' + escapeHtml(formatDateID(row.tanggalDO)) + '</td>' +
      '<td>' + escapeHtml(row.nomorDO) + ' (#' + (row.percobaanKe || 1) + ')</td>' +
      '<td>' + escapeHtml(row.via || 'Driver') + '</td>' +
      '<td>' + escapeHtml(row.namaCustomer) + '</td>' +
      '<td>' + escapeHtml(row.namaDriver) + '</td>' +
      '<td>' + rowMobil + '</td>' +
      '<td>' + escapeHtml(row.status) + '</td>' +
      '<td>' + escapeHtml(row.namaPenerima || '-') + '</td>' +
      '<td>' + escapeHtml(row.status === 'Gagal Kirim' ? row.alasanGagalKirim : (row.keterangan || '-')) + '</td>' +
      '</tr>';
  }
  var viaPrintText = ' | Pengiriman VIA: ' + ((filters && filters.via) ? escapeHtml(filters.via) : 'Semua VIA');
  var drvPrintText = (filters && filters.driverName) ? ' | Petugas: ' + escapeHtml(filters.driverName) : '';
  var cstPrintText = (filters && filters.customerName) ? ' | Customer: ' + escapeHtml(filters.customerName) : '';
  var stPrintText = (filters && filters.status) ? ' | Status: ' + escapeHtml(filters.status) : '';
  var htmlDoc = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Laporan Delivery PIF</title>' +
    '<style>body{font-family:sans-serif;font-size:11px;padding:16px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #cbd5e1;padding:6px;text-align:left}th{background:#0f172a;color:#fff}</style>' +
    '</head><body><h2>Laporan Tracking Delivery Order - PIF</h2>' +
    '<p>Periode: ' + escapeHtml(periodText) + ' | Dicetak: ' + escapeHtml(printedAt) + viaPrintText + drvPrintText + cstPrintText + stPrintText + '</p>' +
    '<table><thead><tr><th>No</th><th>ID Tracking</th><th>Tgl DO</th><th>Nomor DO</th><th>VIA</th><th>Customer</th><th>Driver / Kurir</th><th>Mobil</th><th>Status</th><th>Penerima</th><th>Keterangan / Alasan Gagal</th></tr></thead>' +
    '<tbody>' + rowsHtml + '</tbody></table></body></html>';
  win.document.write(htmlDoc);
  win.document.close();
  win.focus();
  win.print();
}

function exportReportToExcel(items, summary, filters) {
  if (!items || !items.length) {
    showToast('Tidak ada data laporan untuk diexport ke Excel.', 'warning');
    return;
  }

  var rows = [];
  for (var i = 0; i < items.length; i++) {
    var d = items[i];
    rows.push({
      'No': i + 1,
      'ID Tracking': d.idTracking,
      'Tanggal DO': d.tanggalDO,
      'Nomor DO': d.nomorDO,
      'Pengiriman VIA': d.via || 'Driver',
      'Percobaan Ke': d.percobaanKe || 1,
      'Ref Tracking Sebelumnya': d.refTrackingSebelumnya || '-',
      'Nama Customer': d.namaCustomer,
      'Alamat Customer': d.customerAlamat || '-',
      'Nama Driver / Kurir': d.namaDriver,
      'Plat Mobil': d.platMobil || '-',
      'Jenis Mobil': d.jenisMobil || '-',
      'Diinput Oleh (Back Office)': d.namaBackOffice,
      'Status': d.status,
      'ID Batch Pick Up': d.idPickUpBatch || '-',
      'Waktu Pick Up': d.waktuPickUp ? formatDateTimeID(d.waktuPickUp) : '-',
      'GPS Pick Up': (d.pickUpLat !== null && d.pickUpLat !== undefined && d.pickUpLat !== '') ? (d.pickUpLat + ', ' + d.pickUpLng) : '-',
      'Maps Pick Up': buildGoogleMapsUrl(d.pickUpLat, d.pickUpLng),
      'Link Foto Pick Up': (d.pickUpFotos || []).join(' | '),
      'Waktu Check-In': d.waktuCheckIn ? formatDateTimeID(d.waktuCheckIn) : '-',
      'GPS Check-In / Selesai': (d.checkInLat !== null && d.checkInLat !== undefined && d.checkInLat !== '') ? (d.checkInLat + ', ' + d.checkInLng) : '-',
      'Maps Check-In / Selesai': buildGoogleMapsUrl(d.checkInLat, d.checkInLng),
      'Nama Penerima': d.namaPenerima || '-',
      'Keterangan': d.keterangan || '-',
      'Link Foto Check-In': (d.checkInFotos || []).join(' | '),
      'Waktu Check-Out': d.waktuCheckOut ? formatDateTimeID(d.waktuCheckOut) : '-',
      'GPS Check-Out': (d.checkOutLat !== null && d.checkOutLat !== undefined && d.checkOutLat !== '') ? (d.checkOutLat + ', ' + d.checkOutLng) : '-',
      'Maps Check-Out': buildGoogleMapsUrl(d.checkOutLat, d.checkOutLng),
      'Durasi Di Customer': formatDuration(d.waktuCheckIn, d.waktuCheckOut),
      'Waktu Gagal Kirim': d.waktuGagalKirim ? formatDateTimeID(d.waktuGagalKirim) : '-',
      'Alasan Gagal Kirim': d.alasanGagalKirim || '-',
      'GPS Gagal Kirim': (d.gagalKirimLat !== null && d.gagalKirimLat !== undefined && d.gagalKirimLat !== '') ? (d.gagalKirimLat + ', ' + d.gagalKirimLng) : '-',
      'Maps Gagal Kirim': buildGoogleMapsUrl(d.gagalKirimLat, d.gagalKirimLng),
      'Link Foto Gagal Kirim': (d.gagalKirimFotos || []).join(' | ')
    });
  }

  if (window.XLSX) {
    var wb = window.XLSX.utils.book_new();
    var wsData = window.XLSX.utils.json_to_sheet(rows);
    wsData['!cols'] = [
      { wch: 5 }, { wch: 18 }, { wch: 13 }, { wch: 20 }, { wch: 15 }, { wch: 12 }, { wch: 18 },
      { wch: 24 }, { wch: 30 }, { wch: 20 }, { wch: 16 }, { wch: 18 }, { wch: 20 }, { wch: 18 },
      { wch: 18 }, { wch: 18 }, { wch: 22 }, { wch: 35 }, { wch: 40 }, { wch: 18 }, { wch: 22 },
      { wch: 35 }, { wch: 20 }, { wch: 28 }, { wch: 40 }, { wch: 18 }, { wch: 22 }, { wch: 35 },
      { wch: 16 }, { wch: 18 }, { wch: 30 }, { wch: 22 }, { wch: 35 }, { wch: 40 }
    ];
    window.XLSX.utils.book_append_sheet(wb, wsData, 'Laporan Delivery');

    var summaryRows = [
      { 'Metrik': 'Program', 'Nilai': 'Tracking Delivery Order - PIF' },
      { 'Metrik': 'Periode Filter', 'Nilai': (filters.dateFrom || 'Semua') + ' s/d ' + (filters.dateTo || 'Semua') },
      { 'Metrik': 'Filter Status', 'Nilai': (filters && filters.status) ? filters.status : 'Semua Status' },
      { 'Metrik': 'Filter Pengiriman VIA', 'Nilai': (filters && filters.via) ? filters.via : 'Semua VIA' },
      { 'Metrik': 'Filter Driver / Kurir', 'Nilai': (filters && filters.driverName) ? filters.driverName : 'Semua Driver / Kurir' },
      { 'Metrik': 'Filter Customer', 'Nilai': (filters && filters.customerName) ? filters.customerName : 'Semua Customer' },
      { 'Metrik': 'Filter Pencarian Teks', 'Nilai': (filters && filters.search) ? filters.search : '-' },
      { 'Metrik': 'Total Delivery Order', 'Nilai': summary.total || 0 },
      { 'Metrik': 'Siap Pick Up', 'Nilai': summary.siapPickUp || 0 },
      { 'Metrik': 'Dalam Proses (Jalan / Check-In)', 'Nilai': summary.dalamProses || 0 },
      { 'Metrik': 'Selesai', 'Nilai': summary.selesai || 0 },
      { 'Metrik': 'Gagal Kirim', 'Nilai': summary.gagalKirim || 0 },
      { 'Metrik': 'Jumlah Kirim Ulang (Redelivery)', 'Nilai': summary.redeliveryCount || 0 }
    ];
    var wsSummary = window.XLSX.utils.json_to_sheet(summaryRows);
    wsSummary['!cols'] = [{ wch: 34 }, { wch: 36 }];
    window.XLSX.utils.book_append_sheet(wb, wsSummary, 'Ringkasan KPI');

    var xlsxName = 'Laporan_Delivery_PIF_' + getTodayYMD() + '.xlsx';
    if (window.AndroidApp && typeof window.AndroidApp.saveBase64File === 'function') {
      var xlsxBase64 = window.XLSX.write(wb, { bookType: 'xlsx', type: 'base64' });
      window.AndroidApp.saveBase64File(
        xlsxBase64,
        xlsxName,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      showToast('Mengunduh Excel laporan ke folder Download HP...', 'success');
      return;
    }

    window.XLSX.writeFile(wb, xlsxName);
    showToast('File Excel (.xlsx) laporan berhasil diunduh.', 'success');
    return;
  }

  // Fallback CSV UTF-8 BOM jika library CDN XLSX offline
  var headers = Object.keys(rows[0]);
  var csvLines = [headers.join(',')];
  for (var r = 0; r < rows.length; r++) {
    var lineVals = [];
    for (var h = 0; h < headers.length; h++) {
      var val = String(rows[r][headers[h]] || '').replace(/"/g, '""');
      lineVals.push('"' + val + '"');
    }
    csvLines.push(lineVals.join(','));
  }
  var csvName = 'Laporan_Delivery_PIF_' + getTodayYMD() + '.csv';
  var csvContent = '\uFEFF' + csvLines.join('\n');
  if (window.AndroidApp && typeof window.AndroidApp.saveBase64File === 'function') {
    var csvBase64 = btoa(unescape(encodeURIComponent(csvContent)));
    window.AndroidApp.saveBase64File(csvBase64, csvName, 'text/csv');
    showToast('Library Excel offline — menyimpan CSV ke folder Download HP...', 'info');
    return;
  }

  var blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  var link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = csvName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  showToast('Library Excel offline — data diunduh dalam format CSV.', 'info');
}

// ============================================================================
// EXPORT LAPORAN AKTIVITAS DRIVER (OPERASIONAL KENDARAAN & BBM) KE PDF & EXCEL
// ============================================================================

function exportAktivitasToPdf(items, summary, filters) {
  if (!items || !items.length) {
    showToast('Tidak ada data aktivitas driver untuk diexport ke PDF.', 'warning');
    return;
  }

  var periodText = (filters.dateFrom || 'Semua') + ' s/d ' + (filters.dateTo || 'Semua');
  var printedAt = formatDateTimeID(new Date().toISOString());

  if (window.jspdf && window.jspdf.jsPDF) {
    var jsPDFCtor = window.jspdf.jsPDF;
    var doc = new jsPDFCtor({ orientation: 'landscape', unit: 'mm', format: 'a4' });

    doc.setFillColor(15, 23, 42);
    doc.rect(0, 0, 297, 22, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(13);
    doc.setFont(undefined, 'bold');
    doc.text('TRACKING DELIVERY ORDER - PIF | LAPORAN AKTIVITAS & BBM DRIVER', 12, 10);
    doc.setFontSize(9);
    doc.setFont(undefined, 'normal');
    var drvSubText = (filters && filters.driverName) ? '   |   Petugas: ' + filters.driverName : '   |   Petugas: Semua';
    var mblSubText = (filters && filters.platMobilText) ? '   |   Armada: ' + filters.platMobilText : '';
    var stSubText = (filters && filters.statusText) ? '   |   Status: ' + filters.statusText : '';
    doc.text('Periode: ' + periodText + drvSubText + mblSubText + stSubText + '   |   Dicetak: ' + printedAt, 12, 16.5);

    doc.setTextColor(15, 23, 42);
    doc.setFontSize(8.5);
    var kpiText =
      'Total Perjalanan: ' + (summary.totalPerjalanan || 0) +
      '   |   Total KM Tempuh: ' + (summary.totalKmTempuh || 0) + ' km' +
      '   |   Total Biaya BBM: Rp ' + (summary.totalBiayaBbm ? summary.totalBiayaBbm.toLocaleString('id-ID') : '0') +
      ' (' + (summary.totalLiterBbm || 0) + ' L)' +
      '   |   Selesai: ' + (summary.selesai || 0) +
      '   |   Sedang Berangkat: ' + (summary.sedangBerangkat || 0);
    doc.text(kpiText, 12, 29);

    var head = [[
      'No',
      'ID Aktivitas',
      'Tgl',
      'Driver / Kurir',
      'Mobil',
      'KM Awal',
      'KM Akhir',
      'Total KM',
      'BBM (Rp / L)',
      'Status',
      'Berangkat & GPS',
      'Check-In & GPS',
      'Catatan'
    ]];

    var body = [];
    for (var i = 0; i < items.length; i++) {
      var d = items[i];
      var mobilText = d.platMobil ? (d.platMobil + (d.jenisMobil ? '\n' + d.jenisMobil : '')) : '-';
      var bbmText = (d.totalBiayaBbm > 0 || d.totalLiterBbm > 0)
        ? 'Rp ' + d.totalBiayaBbm.toLocaleString('id-ID') + '\n' + d.totalLiterBbm + ' L'
        : '-';
      var brkText = d.waktuBerangkat
        ? formatDateTimeID(d.waktuBerangkat) + (d.gpsBerangkatLat !== null ? '\nGPS: ' + d.gpsBerangkatLat + ', ' + d.gpsBerangkatLng : '')
        : '-';
      var cinText = d.waktuCheckIn
        ? formatDateTimeID(d.waktuCheckIn) + (d.gpsCheckInLat !== null ? '\nGPS: ' + d.gpsCheckInLat + ', ' + d.gpsCheckInLng : '')
        : (d.status === 'Sedang Berangkat' ? 'Sedang Berjalan' : '-');
      var notes = (d.catatanBerangkat ? 'Brk: ' + d.catatanBerangkat : '') +
        (d.catatanCheckIn ? (d.catatanBerangkat ? '\n' : '') + 'Plg: ' + d.catatanCheckIn : '');

      body.push([
        String(i + 1),
        d.idAktivitas,
        formatDateID(d.tanggal),
        d.namaDriver,
        mobilText,
        String(d.kmAwal || 0),
        d.kmAkhir !== null ? String(d.kmAkhir) : '-',
        (d.totalKm || 0) + ' km',
        bbmText,
        d.status,
        brkText,
        cinText,
        notes || '-'
      ]);
    }

    if (typeof doc.autoTable === 'function') {
      doc.autoTable({
        startY: 33,
        head: head,
        body: body,
        theme: 'grid',
        styles: {
          fontSize: 7.0,
          cellPadding: 2.0,
          valign: 'top',
          textColor: [15, 23, 42]
        },
        headStyles: {
          fillColor: [30, 41, 59],
          textColor: [255, 255, 255],
          fontStyle: 'bold'
        },
        columnStyles: {
          0: { cellWidth: 7 },
          1: { cellWidth: 23 },
          2: { cellWidth: 17 },
          3: { cellWidth: 22 },
          4: { cellWidth: 22 },
          5: { cellWidth: 16 },
          6: { cellWidth: 16 },
          7: { cellWidth: 16 },
          8: { cellWidth: 22 },
          9: { cellWidth: 20 },
          10: { cellWidth: 32 },
          11: { cellWidth: 32 },
          12: { cellWidth: 32 }
        },
        margin: { left: 10, right: 10 }
      });
    }

    var pdfName = 'Laporan_Aktivitas_Driver_' + getTodayYMD() + '.pdf';
    if (window.AndroidApp && typeof window.AndroidApp.saveBase64File === 'function') {
      var pdfDataUri = doc.output('datauristring');
      window.AndroidApp.saveBase64File(pdfDataUri, pdfName, 'application/pdf');
      showToast('Mengunduh PDF aktivitas driver ke folder Download HP...', 'success');
      return;
    }

    doc.save(pdfName);
    showToast('File PDF aktivitas driver berhasil diunduh.', 'success');
    return;
  }

  // Fallback cetak HTML browser jika library offline
  var win = window.open('', '_blank');
  if (!win) {
    showToast('Pop-up diblokir browser. Izinkan pop-up untuk mencetak PDF.', 'warning');
    return;
  }
  var rowsHtml = '';
  for (var j = 0; j < items.length; j++) {
    var r = items[j];
    rowsHtml += '<tr>' +
      '<td>' + (j + 1) + '</td>' +
      '<td>' + escapeHtml(r.idAktivitas) + '</td>' +
      '<td>' + escapeHtml(formatDateID(r.tanggal)) + '</td>' +
      '<td>' + escapeHtml(r.namaDriver) + '</td>' +
      '<td>' + escapeHtml(r.platMobil) + ' (' + escapeHtml(r.jenisMobil) + ')</td>' +
      '<td>' + (r.kmAwal || 0) + '</td>' +
      '<td>' + (r.kmAkhir !== null ? r.kmAkhir : '-') + '</td>' +
      '<td>' + (r.totalKm || 0) + ' km</td>' +
      '<td>Rp ' + (r.totalBiayaBbm ? r.totalBiayaBbm.toLocaleString('id-ID') : '0') + ' (' + (r.totalLiterBbm || 0) + ' L)</td>' +
      '<td>' + escapeHtml(r.status) + '</td>' +
      '</tr>';
  }
  var htmlDoc = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Laporan Aktivitas Driver PIF</title>' +
    '<style>body{font-family:sans-serif;font-size:11px;padding:16px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #cbd5e1;padding:6px;text-align:left}th{background:#0f172a;color:#fff}</style>' +
    '</head><body><h2>Laporan Aktivitas Driver & BBM - PIF</h2>' +
    '<p>Periode: ' + escapeHtml(periodText) + ' | Dicetak: ' + escapeHtml(printedAt) + '</p>' +
    '<table><thead><tr><th>No</th><th>ID Aktivitas</th><th>Tgl</th><th>Driver</th><th>Mobil</th><th>KM Awal</th><th>KM Akhir</th><th>Total KM</th><th>Total BBM</th><th>Status</th></tr></thead>' +
    '<tbody>' + rowsHtml + '</tbody></table></body></html>';
  win.document.write(htmlDoc);
  win.document.close();
  win.focus();
  win.print();
}

function exportAktivitasToExcel(items, summary, filters) {
  if (!items || !items.length) {
    showToast('Tidak ada data aktivitas untuk diexport ke Excel.', 'warning');
    return;
  }

  var rows = [];
  for (var i = 0; i < items.length; i++) {
    var d = items[i];
    rows.push({
      'No': i + 1,
      'ID Aktivitas': d.idAktivitas,
      'Tanggal': d.tanggal,
      'Nama Driver / Kurir': d.namaDriver,
      'Plat Mobil': d.platMobil || '-',
      'Jenis Mobil': d.jenisMobil || '-',
      'Status Perjalanan': d.status,
      'Waktu Berangkat': d.waktuBerangkat ? formatDateTimeID(d.waktuBerangkat) : '-',
      'Kilometer Awal': d.kmAwal || 0,
      'GPS Berangkat': d.gpsBerangkatLat !== null ? d.gpsBerangkatLat + ', ' + d.gpsBerangkatLng : '-',
      'Maps Berangkat': buildGoogleMapsUrl(d.gpsBerangkatLat, d.gpsBerangkatLng),
      'Link Foto KM Awal': d.fotoKmAwal || '-',
      'Waktu Check-In Kantor': d.waktuCheckIn ? formatDateTimeID(d.waktuCheckIn) : '-',
      'Kilometer Akhir': d.kmAkhir !== null ? d.kmAkhir : '-',
      'GPS Check-In': d.gpsCheckInLat !== null ? d.gpsCheckInLat + ', ' + d.gpsCheckInLng : '-',
      'Maps Check-In': buildGoogleMapsUrl(d.gpsCheckInLat, d.gpsCheckInLng),
      'Link Foto KM Akhir': d.fotoKmAkhir || '-',
      'Total KM Tempuh': (d.totalKm || 0) + ' km',
      'Total Biaya BBM (Rp)': d.totalBiayaBbm || 0,
      'Total Liter BBM (L)': d.totalLiterBbm || 0,
      'Catatan Berangkat': d.catatanBerangkat || '-',
      'Catatan Check-In': d.catatanCheckIn || '-'
    });
  }

  if (window.XLSX) {
    var wb = window.XLSX.utils.book_new();
    var wsData = window.XLSX.utils.json_to_sheet(rows);
    wsData['!cols'] = [
      { wch: 5 }, { wch: 18 }, { wch: 13 }, { wch: 20 }, { wch: 16 }, { wch: 18 },
      { wch: 18 }, { wch: 20 }, { wch: 15 }, { wch: 22 }, { wch: 35 }, { wch: 35 },
      { wch: 20 }, { wch: 15 }, { wch: 22 }, { wch: 35 }, { wch: 35 }, { wch: 16 },
      { wch: 20 }, { wch: 18 }, { wch: 25 }, { wch: 25 }
    ];
    window.XLSX.utils.book_append_sheet(wb, wsData, 'Aktivitas Driver');

    var summaryRows = [
      { 'Metrik': 'Program', 'Nilai': 'Tracking Delivery Order - PIF' },
      { 'Metrik': 'Laporan', 'Nilai': 'Aktivitas Harian Driver, KM & BBM' },
      { 'Metrik': 'Periode Filter', 'Nilai': (filters.dateFrom || 'Semua') + ' s/d ' + (filters.dateTo || 'Semua') },
      { 'Metrik': 'Filter Driver / Kurir', 'Nilai': (filters && filters.driverName) ? filters.driverName : 'Semua Driver / Kurir' },
      { 'Metrik': 'Filter Armada Mobil', 'Nilai': (filters && filters.platMobilText) ? filters.platMobilText : 'Semua Mobil' },
      { 'Metrik': 'Filter Status Perjalanan', 'Nilai': (filters && filters.statusText) ? filters.statusText : 'Semua Status' },
      { 'Metrik': 'Filter Pencarian Teks', 'Nilai': (filters && filters.search) ? filters.search : '-' },
      { 'Metrik': 'Total Perjalanan', 'Nilai': summary.totalPerjalanan || 0 },
      { 'Metrik': 'Total KM Tempuh Armada', 'Nilai': (summary.totalKmTempuh || 0) + ' km' },
      { 'Metrik': 'Total Pengeluaran BBM (Rp)', 'Nilai': summary.totalBiayaBbm || 0 },
      { 'Metrik': 'Total Volume BBM (Liter)', 'Nilai': summary.totalLiterBbm || 0 },
      { 'Metrik': 'Selesai', 'Nilai': summary.selesai || 0 },
      { 'Metrik': 'Sedang Berangkat', 'Nilai': summary.sedangBerangkat || 0 }
    ];
    var wsSummary = window.XLSX.utils.json_to_sheet(summaryRows);
    wsSummary['!cols'] = [{ wch: 34 }, { wch: 36 }];
    window.XLSX.utils.book_append_sheet(wb, wsSummary, 'Ringkasan KPI');

    var xlsxName = 'Laporan_Aktivitas_Driver_' + getTodayYMD() + '.xlsx';
    if (window.AndroidApp && typeof window.AndroidApp.saveBase64File === 'function') {
      var xlsxBase64 = window.XLSX.write(wb, { bookType: 'xlsx', type: 'base64' });
      window.AndroidApp.saveBase64File(
        xlsxBase64,
        xlsxName,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      showToast('Mengunduh Excel aktivitas ke folder Download HP...', 'success');
      return;
    }

    window.XLSX.writeFile(wb, xlsxName);
    showToast('File Excel (.xlsx) aktivitas driver berhasil diunduh.', 'success');
    return;
  }

  // Fallback CSV UTF-8 BOM jika library offline
  var headers = Object.keys(rows[0]);
  var csvLines = [headers.join(',')];
  for (var r = 0; r < rows.length; r++) {
    var lineVals = [];
    for (var h = 0; h < headers.length; h++) {
      var val = String(rows[r][headers[h]] || '').replace(/"/g, '""');
      lineVals.push('"' + val + '"');
    }
    csvLines.push(lineVals.join(','));
  }
  var csvName = 'Laporan_Aktivitas_Driver_' + getTodayYMD() + '.csv';
  var csvContent = '\uFEFF' + csvLines.join('\n');
  if (window.AndroidApp && typeof window.AndroidApp.saveBase64File === 'function') {
    var csvBase64 = btoa(unescape(encodeURIComponent(csvContent)));
    window.AndroidApp.saveBase64File(csvBase64, csvName, 'text/csv');
    showToast('Menyimpan CSV aktivitas ke folder Download HP...', 'info');
    return;
  }

  var blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  var link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = csvName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  showToast('Data aktivitas diunduh dalam format CSV.', 'info');
}

