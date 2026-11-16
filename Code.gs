/**
 * OPS DISPATCH BACKEND — MULTI SITE (v2: role Requester/PIC/Admin/Driver)
 * ============================================================
 * Butuh 4 sheet di spreadsheet ini. Kalau belum ada, SCRIPT INI
 * AKAN MEMBUATNYA OTOMATIS (lengkap dengan header + data awal)
 * begitu web app pertama kali diakses (saat fungsi doGet jalan).
 *
 *   1) "Requests" -> log semua request trip
 *   2) "Armada"   -> daftar kendaraan per site
 *   3) "Driver"   -> daftar driver per site
 *   4) "PIC"      -> PIC transport per site (buat notifikasi WA/email)
 *
 * CATATAN PENTING: header di setiap sheet SELALU dicek & diperbaiki
 * otomatis setiap kali data diambil (misal saat app dibuka/refresh).
 * Kalau sebelumnya kamu sempat pakai versi script lama, header baru
 * (termasuk kolom KM Awal / Waktu Mulai / KM Akhir / Waktu Selesai /
 * Total Biaya / koordinat GPS) akan otomatis ditambahkan di akhir
 * tanpa merusak data lama. Jadi cukup redeploy versi baru lalu
 * buka/refresh app sekali — tidak perlu edit sheet manual.
 *
 * ALUR BARU (v2):
 *   1. Requester login -> pilih site -> submit request (opsional ambil
 *      lokasi GPS untuk titik jemput & tujuan) -> notif email otomatis
 *      ke PIC site tsb (dan WA manual via tombol di halaman sukses).
 *   2. PIC login -> lihat papan dispatch site-nya -> assign armada +
 *      nama driver -> status jadi "Ditugaskan" -> notif WA ke
 *      requester (nama driver, kontak armada, cost center) dipicu
 *      otomatis dari sisi frontend begitu assign berhasil.
 *   3. Driver login (pakai PIN) -> lihat tugas yang di-assign ke
 *      namanya (termasuk tombol buka rute Google Maps) -> tekan
 *      "Mulai Tugas" + isi KM Awal (status -> "Berjalan") -> setelah
 *      selesai tekan "Selesai Tugas" + isi KM Akhir & Total Biaya
 *      (status -> "Selesai", armada otomatis balik "Tersedia").
 *   4. PIC/Admin bisa pantau semua permintaan, ketersediaan armada &
 *      driver, serta rekap total KM dan total biaya per trip/bulan.
 *
 * CATATAN LOGIN: fitur login (role requester/pic/admin/driver) dan
 * filter per-site sepenuhnya berjalan di sisi frontend (Index.html,
 * lihat AUTH_ACCOUNTS & DRIVER_ACCOUNTS/DRIVER_PIN). Backend ini TIDAK
 * memvalidasi ulang siapa yang login — jadi ini adalah gerbang akses
 * sederhana (cocok untuk internal team), bukan pengamanan tingkat
 * server.
 *
 * Header "Requests" (baris 1):
 *   Ticket ID | Timestamp | Site | Nama | NIK | Departemen | Cost Center |
 *   Kontak | Tanggal | Jam | Jam Pulang | Tipe Perjalanan | Lokasi Awal |
 *   Tujuan | Keperluan | Jenis Kendaraan | Jumlah Penumpang | Catatan |
 *   Status | Armada Assigned | Driver | KM Awal | Waktu Mulai | KM Akhir |
 *   Waktu Selesai | Total Biaya | Lat Awal | Lng Awal | Lat Tujuan | Lng Tujuan |
 *   Foto KM Awal | Foto KM Akhir | Foto Bukti Biaya | Butuh Driver |
 *   Kebersihan Unit | Foto Dokumentasi | Foto SIM
 *   (Foto SIM wajib diisi kalau Butuh Driver = 'Tidak' / self-drive)
 *
 * Header "Armada":
 *   Site | Kode | Jenis | No Polisi | Status
 *   Status hanya boleh: "Tersedia" atau "Dipakai"
 *
 * Header "Driver":
 *   Site | Nama Driver | No HP
 *
 * Header "PIC":
 *   Site | Nama | No HP
 *   No HP dipakai untuk tombol WhatsApp. Kalau belum ada nomornya,
 *   isi "MENYUSUL" — otomatis disembunyikan dari tombol WA di frontend.
 *
 * CARA PAKAI / DEPLOY:
 *   1) Buka spreadsheet Google Sheets (boleh spreadsheet baru/kosong).
 *   2) Extensions -> Apps Script, hapus isi default, paste file ini
 *      sebagai Code.gs, lalu buat file HTML baru bernama Index dan
 *      paste isi Index.html.
 *   3) Deploy -> New deployment -> Web app.
 *      - Execute as: Me
 *      - Who has access: Anyone (atau "Anyone within [organisasi]"
 *        sesuai kebutuhan)
 *   4) Buka URL /exec hasil deploy — sheet Armada/Driver/PIC otomatis
 *      dibuat & diisi data awal saat pertama kali diakses.
 *   5) Setiap kali kode ini diubah, cukup "Deploy -> Manage deployments
 *      -> Edit (ikon pensil) -> New version -> Deploy". URL /exec tetap
 *      sama, tidak perlu update apapun di Index.html.
 * ============================================================
 */

const REQUESTS_SHEET = 'Requests';
const ARMADA_SHEET   = 'Armada';
const DRIVER_SHEET    = 'Driver';
const PIC_SHEET       = 'PIC';

const SITES = ['NDC-Cikarang', 'NDC-Cikupa', 'NDC-Sidoarjo'];

const REQ_HEADERS = [
  'Ticket ID','Timestamp','Site','Nama','NIK','Departemen','Cost Center','Kontak',
  'Tanggal','Jam','Jam Pulang','Tipe Perjalanan','Lokasi Awal','Tujuan','Keperluan',
  'Jenis Kendaraan','Jumlah Penumpang','Catatan','Status','Armada Assigned','Driver',
  'KM Awal','Waktu Mulai','KM Akhir','Waktu Selesai','Total Biaya',
  'Lat Awal','Lng Awal','Lat Tujuan','Lng Tujuan',
  'Foto KM Awal','Foto KM Akhir','Foto Bukti Biaya',
  'Butuh Driver','Kebersihan Unit','Foto Dokumentasi','Foto SIM'
];
const ARMADA_HEADERS = ['Site','Kode','Jenis','No Polisi','Status'];
const DRIVER_HEADERS = ['Site','Nama Driver','No HP'];
const PIC_HEADERS    = ['Site','Nama','No HP'];

/* ---- Seed data awal, diambil dari data Armada/Driver/PIC yang dikirim user ---- */
const ARMADA_SEED = [
  ['NDC-Cikarang', 'A3VO',   'GRANDMAX OPS', 'B1496HFA', 'Tersedia'],
  ['NDC-Cikarang', 'A4VO',   'GRANDMAX OPS', 'B1494HFA', 'Tersedia'],
  ['NDC-Cikarang', 'I2VO',   'GRANDMAX OPS', 'B1570HFA', 'Tersedia'],
  ['NDC-Cikarang', 'K2VO',   'VAN OPS',      'B2559BNR', 'Tersedia'],
  ['NDC-Cikupa',   'C101OC', 'MIN VAN OPS',  'B1578HFA', 'Tersedia'],
  ['NDC-Cikupa',   'C102OC', 'MIN VAN OPS',  'B2685UBI', 'Tersedia'],
  ['NDC-Cikupa',   'C104OC', 'MIN VAN OPS',  'B1045HFA', 'Tersedia'],
  ['NDC-Sidoarjo', 'OPS',    'GRANDMAX OPS', 'B2166UBA', 'Tersedia'],
  ['NDC-Sidoarjo', 'SC1',    'GRANDMAX OPS', 'W1345YH',  'Tersedia']
];

/* ---- DIPERBAIKI (2x):
 * 1) Baris placeholder ['NDC-Sidoarjo','MENYUSUL','MENYUSUL'] dihapus.
 *    Sebelumnya sheet "Driver" bisa ter-seed dengan "driver" bernama
 *    literal "MENYUSUL", yang muncul sebagai pilihan nama driver di
 *    assign PIC padahal bukan driver sungguhan, dan tidak akan pernah
 *    bisa login.
 * 2) 'JOKO' (NDC-Cikupa) dan 'KHAERUL' (NDC-Sidoarjo) dihapus dari sini
 *    karena keduanya SUDAH terdaftar di sheet PIC (lihat PIC_SEED di
 *    bawah — JOKO untuk NDC-Cikupa, KHERUL untuk NDC-Sidoarjo). Mereka
 *    PIC, bukan driver, jadi tidak boleh dobel muncul di daftar Driver.
 *
 * Akibatnya saat ini NDC-Cikupa hanya punya 1 driver terdaftar (EDI S)
 * dan NDC-Sidoarjo belum punya driver sama sekali. Tambahkan baris baru
 * di sini begitu ada nama driver asli untuk slot yang masih kosong,
 * lalu tambahkan juga akunnya di DRIVER_ACCOUNTS (Index.html). */
const DRIVER_SEED = [
  ['NDC-Cikarang', 'JOHAR',    'MENYUSUL'],
  ['NDC-Cikarang', 'SUPRIONO', 'MENYUSUL'],
  ['NDC-Cikupa',   'EDI S',    'MENYUSUL']
];

const PIC_SEED = [
  ['NDC-Cikarang', 'MISBAH',   '6285313361655'],
  ['NDC-Cikarang', 'THEO',     '6287781212237'],
  ['NDC-Cikupa',   'JOKO',     '6287774275201'],
  ['NDC-Cikupa',   'YULIANTO', 'MENYUSUL'],
  ['NDC-Sidoarjo', 'KHERUL',   '6281293433284'],
  ['NDC-Sidoarjo', 'MENYUSUL', 'MENYUSUL']
];

/* Fallback email PIC umum (dipakai untuk notifikasi email — sheet PIC baru
 * hanya menyimpan No HP, belum ada kolom email per site). Ganti/tambah
 * sesuai kebutuhan, atau kosongkan array ini kalau tidak mau kirim email. */
const FALLBACK_PIC_EMAILS = ['jemi.nuryanti@kawanlamacorp.com', 'khomisunur.iriani@kawanlamacorp.com'];

function getSheet(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  return sheet;
}

function ensureHeaders(sheet, headers) {
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
    return;
  }

  const lastCol = Math.max(sheet.getLastColumn(), headers.length);
  let currentHeaders = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h).trim());
  const same = currentHeaders.length === headers.length && currentHeaders.every((h, i) => h === headers[i]);
  if (same) return;

  // Migrasi dari versi lama (sebelum multi-site) yang headernya PERSIS sama
  // tapi belum punya kolom "Site", DAN sheet sudah punya data asli (bukan
  // cuma header kosong) -> sisipkan kolom "Site" di posisi yang benar
  // supaya data lama (Nama, NIK, dst / Kode, Jenis, dst) tidak ikut bergeser
  // salah kolom.
  const headersWithoutSite = headers.filter(h => h !== 'Site');
  const matchesLegacy = currentHeaders.length === headersWithoutSite.length &&
    currentHeaders.every((h, i) => h === headersWithoutSite[i]);

  if (matchesLegacy && sheet.getLastRow() > 1) {
    const siteColIndex = headers.indexOf('Site') + 1; // 1-based
    sheet.insertColumnBefore(siteColIndex);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    return;
  }

  // Migrasi baru: kalau header yang ada sekarang adalah AWALAN (prefix)
  // persis dari header target (misal sheet lama belum punya kolom KM Awal /
  // Waktu Mulai / KM Akhir / Waktu Selesai / Total Biaya / koordinat GPS
  // yang ditambahkan di versi ini) -> cukup tambahkan kolom yang kurang di
  // akhir, data lama sama sekali tidak disentuh/digeser.
  const isPrefix = currentHeaders.length < headers.length &&
    currentHeaders.every((h, i) => h === headers[i]);
  if (isPrefix) {
    const missing = headers.slice(currentHeaders.length);
    sheet.getRange(1, currentHeaders.length + 1, 1, missing.length).setValues([missing]);
    return;
  }

  // Kalau bukan pola migrasi di atas (misal: header rusak/ketinggalan
  // seperti kasus mismatch header-vs-kolom-data), aman untuk langsung
  // menimpa baris header dengan header versi terbaru.
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
}

/** Buat header kalau kosong, lalu isi data awal (seed) kalau sheet
 *  masih belum punya data sama sekali (cuma header / benar-benar kosong). */
function seedIfEmpty(sheet, headers, seedRows) {
  ensureHeaders(sheet, headers);
  if (sheet.getLastRow() <= 1 && seedRows && seedRows.length) {
    sheet.getRange(2, 1, seedRows.length, headers.length).setValues(seedRows);
  }
}

function formatCellValue(value) {
  if (Object.prototype.toString.call(value) === '[object Date]') {
    const tz = Session.getScriptTimeZone();
    // Google Sheets menyimpan nilai waktu-saja dengan tanggal dasar 1899-12-30
    if (value.getFullYear() === 1899 && value.getMonth() === 11 && value.getDate() === 30) {
      return Utilities.formatDate(value, tz, 'HH:mm');
    }
    if (value.getHours() === 0 && value.getMinutes() === 0 && value.getSeconds() === 0) {
      return Utilities.formatDate(value, tz, 'yyyy-MM-dd');
    }
    return Utilities.formatDate(value, tz, 'yyyy-MM-dd HH:mm');
  }
  return value;
}

function sheetToObjects(sheet) {
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0].map(h => String(h).trim());
  return values.slice(1)
    // buang baris yang benar-benar kosong (misal bekas baris ERROR lama)
    .filter(row => row.some(cell => String(cell).trim() !== ''))
    .map(row => {
      const obj = {};
      headers.forEach((h, i) => obj[h] = formatCellValue(row[i]));
      return obj;
    });
}

/**
 * ======================= google.script.run API =======================
 * Fungsi-fungsi di bawah ini dipanggil LANGSUNG dari Index.html lewat
 * google.script.run (bukan lewat URL/fetch). Ini cara resmi & paling
 * stabil untuk komunikasi client-server Apps Script — otomatis nempel
 * ke deployment yang sedang dibuka, jadi tidak akan rusak walau URL
 * /exec berubah setelah redeploy baru.
 */

/** Dipanggil saat app dibuka / refresh — balikin semua data sekaligus. */
function getAppData() {
  const reqSheet = getSheet(REQUESTS_SHEET);
  ensureHeaders(reqSheet, REQ_HEADERS);

  const armadaSheet = getSheet(ARMADA_SHEET);
  seedIfEmpty(armadaSheet, ARMADA_HEADERS, ARMADA_SEED);

  const driverSheet = getSheet(DRIVER_SHEET);
  seedIfEmpty(driverSheet, DRIVER_HEADERS, DRIVER_SEED);

  const picSheet = getSheet(PIC_SHEET);
  seedIfEmpty(picSheet, PIC_HEADERS, PIC_SEED);

  return {
    status: 'ok',
    sites: SITES,
    requests: sheetToObjects(reqSheet),
    armada: sheetToObjects(armadaSheet),
    driver: sheetToObjects(driverSheet),
    pic: sheetToObjects(picSheet)
  };
}

/** Dipanggil saat karyawan (requester) submit form request baru. */
function submitNewRequest(d) {
  const reqSheet = getSheet(REQUESTS_SHEET);
  ensureHeaders(reqSheet, REQ_HEADERS);

  // Penjaga sisi server: trip self-drive (Butuh Driver = 'Tidak') WAJIB
  // menyertakan foto SIM. Frontend juga sudah memvalidasi, tapi cek ini
  // memastikan aturannya tetap berlaku walau request datang dari jalur lain.
  const butuhDriver = d.butuh_driver || 'Ya';
  const fotoSim = butuhDriver === 'Tidak' ? (d.foto_sim_url || '') : '';
  if (butuhDriver === 'Tidak' && !fotoSim) {
    throw new Error('Foto SIM wajib dilampirkan untuk request self-drive (unit saja).');
  }

  reqSheet.appendRow([
    d.ticket_id,
    new Date().toLocaleString('id-ID'),
    d.site || '',
    d.nama, d.nik, d.departemen, d.cost_center, d.kontak,
    d.tanggal_pakai, d.jam_pakai, d.jam_pulang, d.tipe_perjalanan,
    d.lokasi_awal, d.tujuan, d.keperluan,
    d.jenis_kendaraan, d.jumlah_penumpang, d.catatan,
    'Menunggu', '', '',
    '', '', '', '', '',                              // KM Awal, Waktu Mulai, KM Akhir, Waktu Selesai, Total Biaya
    d.lat_awal || '', d.lng_awal || '', d.lat_tujuan || '', d.lng_tujuan || '',  // koordinat GPS (opsional)
    '', '', '',                                       // Foto KM Awal, Foto KM Akhir, Foto Bukti Biaya
    butuhDriver, '', '',                               // Butuh Driver ('Ya'/'Tidak'), Kebersihan Unit, Foto Dokumentasi
    fotoSim                                            // Foto SIM (hanya self-drive)
  ]);
  sendPicEmail(d);

  return { status: 'ok' };
}

/** Cek apakah sebuah request tercatat sebagai "self-drive" (Butuh Driver = 'Tidak'),
 *  dibaca langsung dari sheet (bukan dari payload frontend) supaya jadi sumber
 *  kebenaran tunggal — dipakai sebagai penjaga terakhir di updateRequestStatus. */
function isSelfDriveRequest_(sheet, ticketId) {
  const values = sheet.getDataRange().getValues();
  const headers = values[0];
  const idCol = headers.indexOf('Ticket ID');
  const butuhDriverCol = headers.indexOf('Butuh Driver');
  if (idCol === -1 || butuhDriverCol === -1) return false;
  for (let r = 1; r < values.length; r++) {
    if (values[r][idCol] === ticketId) {
      return String(values[r][butuhDriverCol] || '').trim() === 'Tidak';
    }
  }
  return false;
}

/** Dipanggil PIC saat assign armada/driver ke sebuah request (Menunggu -> Ditugaskan). */
function updateRequestStatus(d) {
  const reqSheet = getSheet(REQUESTS_SHEET);
  ensureHeaders(reqSheet, REQ_HEADERS);

  // Penjaga sisi server: kalau request ini "Butuh Driver" = 'Tidak' (self-drive),
  // JANGAN PERNAH simpan nama driver apapun, apapun yang terkirim dari frontend
  // (mis. bekas nilai lama, bug UI, atau panggilan manual ke fungsi ini).
  // Frontend (Index.html) sudah menyembunyikan input driver untuk trip
  // self-drive, tapi cek ini memastikan aturannya tetap berlaku walau
  // request datang dari jalur lain.
  const driverToSave = isSelfDriveRequest_(reqSheet, d.ticket_id) ? '' : (d.driver || '');

  updateRequestRow(reqSheet, d.ticket_id, {
    'Status': d.status,
    'Armada Assigned': d.armada || '',
    'Driver': driverToSave
  });
  if (d.armada_kode_untuk_update) {
    setArmadaStatus(getSheet(ARMADA_SHEET), d.armada_kode_untuk_update, d.armada_status_baru);
  }

  return { status: 'ok' };
}

/** Dipanggil DRIVER saat mulai tugas: catat KM Awal + foto odometer,
 *  status -> "Berjalan". foto_km_awal_url didapat dari uploadTripFile()
 *  yang dipanggil terpisah oleh frontend sebelum ini. */
function startTrip(d) {
  const reqSheet = getSheet(REQUESTS_SHEET);
  ensureHeaders(reqSheet, REQ_HEADERS);

  updateRequestRow(reqSheet, d.ticket_id, {
    'Status': 'Berjalan',
    'KM Awal': d.km_awal,
    'Waktu Mulai': new Date().toLocaleString('id-ID'),
    'Foto KM Awal': d.foto_km_awal_url || ''
  });

  return { status: 'ok' };
}

/** Dipanggil DRIVER (atau requester untuk trip self-drive) saat selesai
 *  tugas: catat KM Akhir, Total Biaya, kebersihan unit, foto odometer
 *  akhir, foto/dokumen bukti biaya, & foto dokumentasi kondisi unit.
 *  Status -> "Selesai", armada otomatis dibalikin "Tersedia". */
function finishTrip(d) {
  const reqSheet = getSheet(REQUESTS_SHEET);
  ensureHeaders(reqSheet, REQ_HEADERS);

  updateRequestRow(reqSheet, d.ticket_id, {
    'Status': 'Selesai',
    'KM Akhir': d.km_akhir,
    'Waktu Selesai': new Date().toLocaleString('id-ID'),
    'Total Biaya': d.total_biaya,
    'Foto KM Akhir': d.foto_km_akhir_url || '',
    'Foto Bukti Biaya': d.foto_biaya_url || '',
    'Kebersihan Unit': d.kebersihan_unit || '',
    'Foto Dokumentasi': d.foto_dokumentasi_url || ''
  });
  if (d.armada_kode_untuk_update) {
    setArmadaStatus(getSheet(ARMADA_SHEET), d.armada_kode_untuk_update, 'Tersedia');
  }

  return { status: 'ok' };
}

/** Nama folder Google Drive tempat semua foto/dokumen bukti trip
 *  (odometer & bukti biaya) disimpan. Dibuat otomatis kalau belum ada. */
const UPLOAD_FOLDER_NAME = 'KLG Go - Bukti Trip';

function getOrCreateUploadFolder() {
  const folders = DriveApp.getFoldersByName(UPLOAD_FOLDER_NAME);
  if (folders.hasNext()) return folders.next();
  return DriveApp.createFolder(UPLOAD_FOLDER_NAME);
}

/** Dipanggil DRIVER (via google.script.run) untuk mengunggah satu file
 *  (foto odometer atau bukti biaya) ke Google Drive SEBELUM startTrip/
 *  finishTrip dipanggil. base64Data harus base64 murni (tanpa prefix
 *  "data:...;base64,"). File disimpan ke folder UPLOAD_FOLDER_NAME dan
 *  dibagikan sebagai "siapa saja yang punya link bisa lihat", supaya
 *  PIC/Admin bisa membukanya langsung dari link di dashboard. */
function uploadTripFile(base64Data, mimeType, fileName, sensitif) {
  const folder = getOrCreateUploadFolder();
  const bytes = Utilities.base64Decode(base64Data);
  const blob = Utilities.newBlob(bytes, mimeType, fileName);
  const file = folder.createFile(blob);
  if (sensitif) {
    // Dokumen pribadi (mis. SIM): JANGAN dibuka ke publik. Coba batasi ke
    // satu domain organisasi (hanya jalan di Google Workspace). Kalau akun
    // bukan Workspace, file tetap privat (hanya pemilik script yang bisa buka).
    try {
      file.setSharing(DriveApp.Access.DOMAIN_WITH_LINK, DriveApp.Permission.VIEW);
    } catch (err) {
      Logger.log('Sharing domain gagal, file SIM tetap privat: ' + err.message);
    }
  } else {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  }
  return { status: 'ok', url: file.getUrl(), fileId: file.getId() };
}

/**
 * GET: serve halaman app (Index.html), sekaligus dukung DEEP LINK lewat
 * parameter URL supaya notifikasi WhatsApp bisa langsung membuka layar
 * yang relevan:
 *   ?view=status&ticket=TRX-123456   -> Requester: langsung ke Cek Status
 *   ?view=assign&ticket=TRX-123456   -> PIC/Admin: langsung ke assign trip itu
 *   ?view=start&ticket=TRX-123456    -> Driver: langsung ke form Mulai Tugas
 * Parameter di-whitelist/divalidasi di sini (bukan langsung dicetak apa
 * adanya) supaya aman disisipkan ke halaman HTML.
 */
function doGet(e) {
  const params = (e && e.parameter) || {};
  const ALLOWED_VIEWS = ['status', 'assign', 'start'];

  let view = String(params.view || '');
  if (ALLOWED_VIEWS.indexOf(view) === -1) view = '';

  let ticket = String(params.ticket || '');
  if (!/^[A-Za-z0-9\-]{0,40}$/.test(ticket)) ticket = '';

  const template = HtmlService.createTemplateFromFile('Index');
  template.initialView = view;
  template.initialTicket = ticket;
  template.appBaseUrl = ScriptApp.getService().getUrl();

  return template.evaluate()
    .setTitle('Operasional KLG')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** POST: disisakan sebagai fallback lama (tidak dipakai frontend versi ini,
 *  tapi tidak mengganggu kalau ada integrasi luar yang masih memakainya). */
function doPost(e) {
  const reqSheet = getSheet(REQUESTS_SHEET);
  ensureHeaders(reqSheet, REQ_HEADERS);

  try {
    const d = (e.parameter && e.parameter.payload)
      ? JSON.parse(e.parameter.payload)
      : JSON.parse(e.postData.contents);
    const action = d.action || 'new_request';

    if (action === 'new_request') {
      submitNewRequest(d);
    } else if (action === 'update_status') {
      updateRequestStatus(d);
    } else if (action === 'start_trip') {
      startTrip(d);
    } else if (action === 'finish_trip') {
      finishTrip(d);
    }

    return ContentService.createTextOutput(JSON.stringify({status:'ok'})).setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    reqSheet.appendRow(['ERROR: ' + err.message]);
    return ContentService.createTextOutput(JSON.stringify({status:'error', message: err.message})).setMimeType(ContentService.MimeType.JSON);
  }
}

function sendPicEmail(d) {
  // Prioritaskan email yang dikirim frontend (kalau ada); kalau tidak,
  // pakai fallback umum. Kosongkan FALLBACK_PIC_EMAILS untuk mematikan email.
  const recipients = d.pic_emails || FALLBACK_PIC_EMAILS.join(',');
  if (!recipients) return;

  const subject = 'Request Kendaraan Baru — ' + d.ticket_id + ' (' + (d.site || '-') + ')';
  const body =
    'Ada request kendaraan operasional baru yang perlu dijadwalkan:\n\n' +
    'Tiket        : ' + d.ticket_id + '\n' +
    'Site         : ' + (d.site || '-') + '\n' +
    'Pemohon      : ' + d.nama + ' (' + d.departemen + ')\n' +
    'NIK          : ' + d.nik + '\n' +
    'Cost Center  : ' + d.cost_center + '\n' +
    'Kontak       : ' + d.kontak + '\n' +
    'Tanggal      : ' + d.tanggal_pakai + '  Jam: ' + d.jam_pakai + ' (pulang ' + d.jam_pulang + ')\n' +
    'Tipe         : ' + d.tipe_perjalanan + '\n' +
    'Rute         : ' + d.lokasi_awal + ' -> ' + d.tujuan + '\n' +
    'Keperluan    : ' + d.keperluan + '\n' +
    'Kendaraan    : ' + d.jenis_kendaraan + '\n' +
    'Penumpang    : ' + d.jumlah_penumpang + '\n' +
    'Perlu Driver : ' + (d.butuh_driver === 'Tidak' ? 'Tidak (self-drive, foto SIM terlampir di dashboard)' : 'Ya') + '\n' +
    'Catatan      : ' + (d.catatan || '-') + '\n\n' +
    'Mohon dijadwalkan dan di-assign armada melalui dashboard PIC. Terima kasih.';

  try {
    MailApp.sendEmail({
      to: recipients,
      subject: subject,
      body: body
    });
  } catch (err) {
    // Jangan hentikan proses utama kalau email gagal terkirim
    Logger.log('Gagal kirim email: ' + err.message);
  }
}

function updateRequestRow(sheet, ticketId, updates) {
  const values = sheet.getDataRange().getValues();
  const headers = values[0];
  const idCol = headers.indexOf('Ticket ID');
  for (let r = 1; r < values.length; r++) {
    if (values[r][idCol] === ticketId) {
      Object.keys(updates).forEach(key => {
        const col = headers.indexOf(key);
        if (col !== -1) sheet.getRange(r + 1, col + 1).setValue(updates[key]);
      });
      break;
    }
  }
}

function setArmadaStatus(sheet, kode, status) {
  const values = sheet.getDataRange().getValues();
  const headers = values[0];
  const kodeCol = headers.indexOf('Kode');
  const statusCol = headers.indexOf('Status');
  for (let r = 1; r < values.length; r++) {
    if (values[r][kodeCol] === kode) {
      sheet.getRange(r + 1, statusCol + 1).setValue(status);
      break;
    }
  }
}