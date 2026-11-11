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
    doc.text('Periode: ' + periodText + '   |   Dicetak: ' + printedAt, 12, 16.5);

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
      'Ke',
      'Customer',
      'Driver',
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
      var checkInInfo = d.waktuCheckIn
        ? formatDateTimeID(d.waktuCheckIn) + '\nPenerima: ' + (d.namaPenerima || '-') +
          (d.checkInLat !== null ? '\nGPS: ' + d.checkInLat + ', ' + d.checkInLng : '')
        : '-';
      var checkOutInfo = d.waktuCheckOut
        ? formatDateTimeID(d.waktuCheckOut) +
          (d.checkOutLat !== null ? '\nGPS: ' + d.checkOutLat + ', ' + d.checkOutLng : '')
        : '-';
      var notes = '';
      if (d.status === 'Gagal Kirim') {
        notes = 'GAGAL: ' + (d.alasanGagalKirim || '-') +
          (d.gagalKirimLat !== null ? '\nGPS: ' + d.gagalKirimLat + ', ' + d.gagalKirimLng : '');
      } else {
        notes = d.keterangan || '-';
      }

      body.push([
        String(i + 1),
        d.idTracking,
        formatDateID(d.tanggalDO),
        d.nomorDO,
        '#' + (d.percobaanKe || 1),
        d.namaCustomer,
        d.namaDriver,
        mobilInfo,
        d.status,
        d.waktuPickUp ? formatDateTimeID(d.waktuPickUp) : '-',
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
          0: { cellWidth: 7 },
          1: { cellWidth: 23 },
          2: { cellWidth: 17 },
          3: { cellWidth: 22 },
          4: { cellWidth: 7 },
          5: { cellWidth: 26 },
          6: { cellWidth: 20 },
          7: { cellWidth: 22 },
          8: { cellWidth: 20 },
          9: { cellWidth: 20 },
          10: { cellWidth: 32 },
          11: { cellWidth: 25 },
          12: { cellWidth: 36 }
        },
        margin: { left: 10, right: 10 }
      });
    }

    doc.save('Laporan_Delivery_PIF_' + getTodayYMD() + '.pdf');
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
      '<td>' + escapeHtml(row.namaCustomer) + '</td>' +
      '<td>' + escapeHtml(row.namaDriver) + '</td>' +
      '<td>' + rowMobil + '</td>' +
      '<td>' + escapeHtml(row.status) + '</td>' +
      '<td>' + escapeHtml(row.namaPenerima || '-') + '</td>' +
      '<td>' + escapeHtml(row.status === 'Gagal Kirim' ? row.alasanGagalKirim : (row.keterangan || '-')) + '</td>' +
      '</tr>';
  }
  var htmlDoc = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Laporan Delivery PIF</title>' +
    '<style>body{font-family:sans-serif;font-size:11px;padding:16px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #cbd5e1;padding:6px;text-align:left}th{background:#0f172a;color:#fff}</style>' +
    '</head><body><h2>Laporan Tracking Delivery Order - PIF</h2>' +
    '<p>Periode: ' + escapeHtml(periodText) + ' | Dicetak: ' + escapeHtml(printedAt) + '</p>' +
    '<table><thead><tr><th>No</th><th>ID Tracking</th><th>Tgl DO</th><th>Nomor DO</th><th>Customer</th><th>Driver</th><th>Mobil</th><th>Status</th><th>Penerima</th><th>Keterangan / Alasan Gagal</th></tr></thead>' +
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
      'Percobaan Ke': d.percobaanKe || 1,
      'Ref Tracking Sebelumnya': d.refTrackingSebelumnya || '-',
      'Nama Customer': d.namaCustomer,
      'Alamat Customer': d.customerAlamat || '-',
      'Nama Driver': d.namaDriver,
      'Plat Mobil': d.platMobil || '-',
      'Jenis Mobil': d.jenisMobil || '-',
      'Diinput Oleh (Back Office)': d.namaBackOffice,
      'Status': d.status,
      'ID Batch Pick Up': d.idPickUpBatch || '-',
      'Waktu Pick Up': d.waktuPickUp ? formatDateTimeID(d.waktuPickUp) : '-',
      'Link Foto Pick Up': (d.pickUpFotos || []).join(' | '),
      'Waktu Check-In': d.waktuCheckIn ? formatDateTimeID(d.waktuCheckIn) : '-',
      'GPS Check-In': d.checkInLat !== null ? d.checkInLat + ', ' + d.checkInLng : '-',
      'Maps Check-In': buildGoogleMapsUrl(d.checkInLat, d.checkInLng),
      'Nama Penerima': d.namaPenerima || '-',
      'Keterangan': d.keterangan || '-',
      'Link Foto Check-In': (d.checkInFotos || []).join(' | '),
      'Waktu Check-Out': d.waktuCheckOut ? formatDateTimeID(d.waktuCheckOut) : '-',
      'GPS Check-Out': d.checkOutLat !== null ? d.checkOutLat + ', ' + d.checkOutLng : '-',
      'Maps Check-Out': buildGoogleMapsUrl(d.checkOutLat, d.checkOutLng),
      'Durasi Di Customer': formatDuration(d.waktuCheckIn, d.waktuCheckOut),
      'Waktu Gagal Kirim': d.waktuGagalKirim ? formatDateTimeID(d.waktuGagalKirim) : '-',
      'Alasan Gagal Kirim': d.alasanGagalKirim || '-',
      'GPS Gagal Kirim': d.gagalKirimLat !== null ? d.gagalKirimLat + ', ' + d.gagalKirimLng : '-',
      'Maps Gagal Kirim': buildGoogleMapsUrl(d.gagalKirimLat, d.gagalKirimLng),
      'Link Foto Gagal Kirim': (d.gagalKirimFotos || []).join(' | ')
    });
  }

  if (window.XLSX) {
    var wb = window.XLSX.utils.book_new();
    var wsData = window.XLSX.utils.json_to_sheet(rows);
    wsData['!cols'] = [
      { wch: 5 }, { wch: 18 }, { wch: 13 }, { wch: 20 }, { wch: 12 }, { wch: 18 },
      { wch: 24 }, { wch: 30 }, { wch: 20 }, { wch: 16 }, { wch: 18 }, { wch: 20 }, { wch: 18 }, { wch: 18 },
      { wch: 18 }, { wch: 40 }, { wch: 18 }, { wch: 22 }, { wch: 35 }, { wch: 20 },
      { wch: 28 }, { wch: 40 }, { wch: 18 }, { wch: 22 }, { wch: 35 }, { wch: 16 },
      { wch: 18 }, { wch: 30 }, { wch: 22 }, { wch: 35 }, { wch: 40 }
    ];
    window.XLSX.utils.book_append_sheet(wb, wsData, 'Laporan Delivery');

    var summaryRows = [
      { 'Metrik': 'Program', 'Nilai': 'Tracking Delivery Order - PIF' },
      { 'Metrik': 'Periode Filter', 'Nilai': (filters.dateFrom || 'Semua') + ' s/d ' + (filters.dateTo || 'Semua') },
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

    window.XLSX.writeFile(wb, 'Laporan_Delivery_PIF_' + getTodayYMD() + '.xlsx');
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
  var blob = new Blob(['\uFEFF' + csvLines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  var link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'Laporan_Delivery_PIF_' + getTodayYMD() + '.csv';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  showToast('Library Excel offline — data diunduh dalam format CSV.', 'info');
}

