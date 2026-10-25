/* ============================================================
   RAPORT.JS — Portal Raport & Evaluasi Caberawit (Wali Murid)
   
   Supports:
   - Live synchronization with Firebase RTDB & Firestore
   - LocalStorage offline resilience (karyawan, raport, absensi)
   - Real-time student search & period filters
   - Clean printable report with official Kop Surat
   - WhatsApp direct teacher consultation & share link
   ============================================================ */

const firebaseConfig = {
    apiKey: "AIzaSyCThW7QOe5hJv_wBW2q9yB-RtzfS31f3CU",
    authDomain: "absensi-4d9c8.firebaseapp.com",
    databaseURL: "https://absensi-4d9c8-default-rtdb.firebaseio.com",
    projectId: "absensi-4d9c8",
    storageBucket: "absensi-4d9c8.firebasestorage.app",
    messagingSenderId: "818960168268",
    appId: "1:818960168268:web:5abe3ea57e1f407a604be9",
    measurementId: "G-F1WJ745NBR"
};

let parentDb = null;
let parentRtdb = null;
let isFirebaseConnected = false;

let parentRaportList = [];
let parentKaryawanList = [];
let parentAbsensiList = [];
let currentSelectedRaport = null;
let currentSelectedStudentName = '';

// Inisialisasi Firebase
try {
    if (typeof firebase !== 'undefined' && firebase.apps) {
        if (!firebase.apps.length) {
            firebase.initializeApp(firebaseConfig);
        }
        if (typeof firebase.database === 'function' && firebaseConfig.databaseURL) {
            parentRtdb = firebase.database();
        }
        if (typeof firebase.firestore === 'function') {
            parentDb = firebase.firestore();
        }
    }
} catch (e) {
    console.warn('Firebase init in raport.js:', e);
}

// Event: DOM Ready
document.addEventListener('DOMContentLoaded', async () => {
    loadParentDataFromLocalStorage();
    await connectFirebaseParent();
    checkUrlParams();
});

// ------------------------------------------------------------
// 1. DATA PERSISTENCE & LOCAL STORAGE
// ------------------------------------------------------------

function loadParentDataFromLocalStorage() {
    try {
        const storedKaryawan = localStorage.getItem('absensiku_karyawan');
        if (storedKaryawan) {
            parentKaryawanList = JSON.parse(storedKaryawan).filter(k => !isDemoRecord(k));
        }

        const storedRaport = localStorage.getItem('absensiku_raport');
        if (storedRaport) {
            parentRaportList = JSON.parse(storedRaport);
        }

        const storedAbsensi = localStorage.getItem('absensiku_absensi');
        if (storedAbsensi) {
            parentAbsensiList = JSON.parse(storedAbsensi).filter(a => !isDemoRecord(a));
        }
    } catch (e) {
        console.warn('Error reading localStorage in raport.js:', e);
    }

    populateParentDropdowns();
    renderAvailableRaportGrid();
}

function isDemoRecord(item) {
    if (!item) return false;
    if (typeof item.id === 'string' && (item.id.startsWith('demo-') || item.id.includes('demo'))) return true;
    return false;
}

// ------------------------------------------------------------
// 2. FIREBASE REALTIME SYNCHRONIZATION
// ------------------------------------------------------------

async function connectFirebaseParent() {
    // 1. Realtime Database (RTDB)
    if (parentRtdb) {
        try {
            console.log('🔄 Menghubungkan ke Realtime Database...');
            
            // Listener Karyawan / Caberawit
            parentRtdb.ref('karyawan').on('value', (snap) => {
                const val = snap.val();
                if (val) {
                    parentKaryawanList = Object.entries(val)
                        .map(([id, item]) => ({ id, ...item }))
                        .filter(k => !isDemoRecord(k));
                    try { localStorage.setItem('absensiku_karyawan', JSON.stringify(parentKaryawanList)); } catch (e) {}
                }
                populateParentDropdowns();
                refreshCurrentView();
            });

            // Listener Raport
            parentRtdb.ref('raport').on('value', (snap) => {
                const val = snap.val();
                if (val) {
                    parentRaportList = Object.entries(val).map(([id, item]) => ({ id, ...item }));
                    try { localStorage.setItem('absensiku_raport', JSON.stringify(parentRaportList)); } catch (e) {}
                }
                populateParentDropdowns();
                renderAvailableRaportGrid();
                refreshCurrentView();
            });

            // Listener Absensi
            parentRtdb.ref('absensi').on('value', (snap) => {
                const val = snap.val();
                if (val) {
                    parentAbsensiList = Object.entries(val)
                        .map(([id, item]) => ({ id, ...item }))
                        .filter(a => !isDemoRecord(a));
                    try { localStorage.setItem('absensiku_absensi', JSON.stringify(parentAbsensiList)); } catch (e) {}
                }
                refreshCurrentView();
            });

            isFirebaseConnected = true;
            return;
        } catch (e) {
            console.warn('RTDB Error:', e);
        }
    }

    // 2. Cloud Firestore Fallback
    if (parentDb) {
        try {
            console.log('🔄 Menghubungkan ke Cloud Firestore...');

            parentDb.collection('karyawan').onSnapshot(snap => {
                if (!snap.empty) {
                    parentKaryawanList = [];
                    snap.forEach(d => {
                        const item = { id: d.id, ...d.data() };
                        if (!isDemoRecord(item)) parentKaryawanList.push(item);
                    });
                    try { localStorage.setItem('absensiku_karyawan', JSON.stringify(parentKaryawanList)); } catch (e) {}
                }
                populateParentDropdowns();
                refreshCurrentView();
            });

            parentDb.collection('raport').onSnapshot(snap => {
                if (!snap.empty) {
                    parentRaportList = [];
                    snap.forEach(d => parentRaportList.push({ id: d.id, ...d.data() }));
                    try { localStorage.setItem('absensiku_raport', JSON.stringify(parentRaportList)); } catch (e) {}
                }
                populateParentDropdowns();
                renderAvailableRaportGrid();
                refreshCurrentView();
            });

            parentDb.collection('absensi').onSnapshot(snap => {
                if (!snap.empty) {
                    parentAbsensiList = [];
                    snap.forEach(d => {
                        const item = { id: d.id, ...d.data() };
                        if (!isDemoRecord(item)) parentAbsensiList.push(item);
                    });
                    try { localStorage.setItem('absensiku_absensi', JSON.stringify(parentAbsensiList)); } catch (e) {}
                }
                refreshCurrentView();
            });

            isFirebaseConnected = true;
        } catch (e) {
            console.warn('Firestore Error:', e);
        }
    }
}

// ------------------------------------------------------------
// 3. DROPDOWN & FILTER HANDLING
// ------------------------------------------------------------

function populateParentDropdowns() {
    const selectMurid = document.getElementById('parent-select-murid');
    const selectPeriode = document.getElementById('parent-filter-periode');
    const pillsContainer = document.getElementById('quick-student-pills');

    if (!selectMurid) return;

    // Ambil semua nama murid dari:
    // 1. Data Caberawit (karyawan)
    // 2. Data Raport yang sudah diterbitkan
    const nameMap = new Map();

    parentKaryawanList.forEach(k => {
        const clean = (k.nama || '').trim();
        if (clean) nameMap.set(clean.toLowerCase(), clean);
    });

    parentRaportList.forEach(r => {
        const clean = (r.nama || '').trim();
        if (clean) nameMap.set(clean.toLowerCase(), clean);
    });

    const uniqueNames = Array.from(nameMap.values()).sort((a, b) => a.localeCompare(b));

    const curVal = selectMurid.value;
    selectMurid.innerHTML = '<option value="">— Pilih Nama Putra / Putri Anda —</option>';

    uniqueNames.forEach(nama => {
        const opt = document.createElement('option');
        opt.value = nama;
        opt.textContent = nama;
        selectMurid.appendChild(opt);
    });

    if (curVal && uniqueNames.includes(curVal)) {
        selectMurid.value = curVal;
    }

    // Populate Periode dropdown
    if (selectPeriode) {
        const curP = selectPeriode.value;
        selectPeriode.innerHTML = '<option value="semua">Semua Periode</option>';
        const uniquePeriods = Array.from(new Set(parentRaportList.map(r => r.periode).filter(Boolean))).sort().reverse();
        uniquePeriods.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p;
            opt.textContent = formatPeriodeDisplay(p);
            selectPeriode.appendChild(opt);
        });
        if (curP) selectPeriode.value = curP;
    }

    // Quick pills di bawah dropdown
    if (pillsContainer) {
        if (uniqueNames.length === 0) {
            pillsContainer.innerHTML = '<span class="text-[11px] text-surface-400">Belum ada murid yang terdaftar di database</span>';
        } else {
            pillsContainer.innerHTML = uniqueNames.slice(0, 8).map(nama => `
                <button type="button" onclick="selectStudentByName('${escapeHtml(nama)}')"
                    class="px-3 py-1 rounded-full text-xs font-semibold bg-surface-100 hover:bg-violet-100 text-surface-700 hover:text-violet-700 transition-all shrink-0 border border-surface-200/60 active:scale-95">
                    ${escapeHtml(nama)}
                </button>
            `).join('');
        }
    }
}

function selectStudentByName(nama) {
    const selectMurid = document.getElementById('parent-select-murid');
    if (selectMurid) selectMurid.value = nama;
    onParentSelectMuridChange();
}

function onParentSelectMuridChange() {
    const selectMurid = document.getElementById('parent-select-murid');
    const selectPeriode = document.getElementById('parent-filter-periode');
    const nama = selectMurid ? selectMurid.value.trim() : '';
    const periode = selectPeriode ? selectPeriode.value : 'semua';

    currentSelectedStudentName = nama;

    if (!nama) {
        hideRaportCard();
        return;
    }

    // Cari raport santri yang sesuai nama & periode
    let found = parentRaportList.filter(r => (r.nama || '').trim().toLowerCase() === nama.toLowerCase());
    if (periode !== 'semua') {
        found = found.filter(r => r.periode === periode);
    }

    if (found.length > 0) {
        // Santri memiliki raport
        displayRaport(found[0]);
    } else {
        // Santri belum memiliki raport untuk periode ini -> Tampilkan Pending Card
        displayPendingStudent(nama);
    }
}

function onParentFilterChange() {
    onParentSelectMuridChange();
}

function refreshCurrentView() {
    if (currentSelectedStudentName) {
        onParentSelectMuridChange();
    }
}

// ------------------------------------------------------------
// 4. DISPLAY VIEW (RAPORT FOUND VS PENDING)
// ------------------------------------------------------------

function displayRaport(raport) {
    currentSelectedRaport = raport;

    document.getElementById('display-nama').textContent = raport.nama;
    document.getElementById('display-kelas').textContent = raport.kelas || 'Caberawit';
    document.getElementById('display-periode').textContent = `Periode: ${formatPeriodeDisplay(raport.periode)}`;
    document.getElementById('display-predikat').textContent = raport.predikat || 'Baik';
    document.getElementById('display-mapel').textContent = raport.mapel || 'Al-Qur\'an';
    document.getElementById('display-kekurangan').textContent = raport.kekurangan || 'Alhamdulillah, tidak ada kekurangan materi yang mencolok.';
    document.getElementById('display-saran').textContent = raport.saran || 'Mohon didampingi mengulang dan melancarkan hafalan di rumah secara berkala.';
    document.getElementById('display-catatan').textContent = `"${raport.catatan || 'Terus istiqomah dan semangat dalam belajar serta mengaji.'}"`;
    document.getElementById('display-avatar').textContent = getInitials(raport.nama);

    // Predikat badge styling
    const predikatEl = document.getElementById('display-predikat');
    if (raport.predikat === 'Sangat Baik') predikatEl.className = 'text-sm sm:text-lg font-extrabold text-emerald-600 mt-0.5';
    else if (raport.predikat === 'Baik') predikatEl.className = 'text-sm sm:text-lg font-extrabold text-teal-600 mt-0.5';
    else if (raport.predikat === 'Cukup') predikatEl.className = 'text-sm sm:text-lg font-extrabold text-amber-600 mt-0.5';
    else predikatEl.className = 'text-sm sm:text-lg font-extrabold text-rose-600 mt-0.5';

    // Hitung absensi anak
    calculateStudentAttendance(raport.nama);

    // Switch views
    document.getElementById('raport-display-card').classList.remove('hidden');
    document.getElementById('raport-pending-card')?.classList.add('hidden');
    document.getElementById('raport-empty-state').classList.add('hidden');

    if (window.innerWidth < 768) {
        document.getElementById('raport-display-card').scrollIntoView({ behavior: 'smooth' });
    }
}

function displayPendingStudent(nama) {
    currentSelectedRaport = null;

    // Cari info murid dari karyawan
    const studentInfo = parentKaryawanList.find(k => (k.nama || '').trim().toLowerCase() === nama.toLowerCase());
    const kelas = studentInfo ? (studentInfo.jabatan || 'Peserta Caberawit') : 'Caberawit';

    const pendingEl = document.getElementById('raport-pending-card');
    if (pendingEl) {
        document.getElementById('pending-nama').textContent = nama;
        document.getElementById('pending-kelas').textContent = kelas;
        document.getElementById('pending-avatar').textContent = getInitials(nama);

        calculateStudentAttendanceForPending(nama);

        pendingEl.classList.remove('hidden');
        document.getElementById('raport-display-card').classList.add('hidden');
        document.getElementById('raport-empty-state').classList.add('hidden');

        if (window.innerWidth < 768) {
            pendingEl.scrollIntoView({ behavior: 'smooth' });
        }
    } else {
        hideRaportCard();
        showParentToast(`Raport untuk ananda ${nama} belum diterbitkan.`, 'info');
    }
}

function hideRaportCard() {
    currentSelectedRaport = null;
    currentSelectedStudentName = '';
    document.getElementById('raport-display-card').classList.add('hidden');
    document.getElementById('raport-pending-card')?.classList.add('hidden');
    document.getElementById('raport-empty-state').classList.remove('hidden');
}

function calculateStudentAttendance(nama) {
    const studentAbsensi = parentAbsensiList.filter(a => (a.nama || '').trim().toLowerCase() === nama.trim().toLowerCase());
    const hadir = studentAbsensi.filter(a => a.status === 'Hadir').length;
    const izin = studentAbsensi.filter(a => a.status === 'Izin').length;
    const sakit = studentAbsensi.filter(a => a.status === 'Sakit').length;
    const alpa = studentAbsensi.filter(a => a.status === 'Alpa').length;

    const total = hadir + izin + sakit + alpa;
    const persen = total > 0 ? Math.round((hadir / total) * 100) : 100;

    const elHadir = document.getElementById('display-hadir-count');
    const elIzin = document.getElementById('display-izin-count');
    const elSakit = document.getElementById('display-sakit-count');
    const elAlpa = document.getElementById('display-alpa-count');
    const elPersen = document.getElementById('display-persen-hadir');

    if (elHadir) elHadir.textContent = hadir;
    if (elIzin) elIzin.textContent = izin;
    if (elSakit) elSakit.textContent = sakit;
    if (elAlpa) elAlpa.textContent = alpa;
    if (elPersen) elPersen.textContent = `${persen}%`;
}

function calculateStudentAttendanceForPending(nama) {
    const studentAbsensi = parentAbsensiList.filter(a => (a.nama || '').trim().toLowerCase() === nama.trim().toLowerCase());
    const hadir = studentAbsensi.filter(a => a.status === 'Hadir').length;
    const izin = studentAbsensi.filter(a => a.status === 'Izin').length;
    const sakit = studentAbsensi.filter(a => a.status === 'Sakit').length;
    const alpa = studentAbsensi.filter(a => a.status === 'Alpa').length;

    const total = hadir + izin + sakit + alpa;
    const persen = total > 0 ? Math.round((hadir / total) * 100) : 100;

    const elHadir = document.getElementById('pending-hadir-count');
    const elIzin = document.getElementById('pending-izin-count');
    const elSakit = document.getElementById('pending-sakit-count');
    const elAlpa = document.getElementById('pending-alpa-count');
    const elPersen = document.getElementById('pending-persen-hadir');

    if (elHadir) elHadir.textContent = hadir;
    if (elIzin) elIzin.textContent = izin;
    if (elSakit) elSakit.textContent = sakit;
    if (elAlpa) elAlpa.textContent = alpa;
    if (elPersen) elPersen.textContent = `${persen}%`;
}

function renderAvailableRaportGrid() {
    const grid = document.getElementById('available-raport-grid');
    if (!grid) return;

    if (parentRaportList.length === 0) {
        grid.innerHTML = '<p class="text-xs text-surface-400 py-4 col-span-2 text-center">Belum ada lembar raport yang diterbitkan.</p>';
        return;
    }

    grid.innerHTML = parentRaportList.slice(0, 8).map(item => `
        <div onclick="selectStudentByName('${escapeHtml(item.nama)}')"
            class="p-4 rounded-2xl border border-surface-200/80 hover:border-violet-300 hover:shadow-md bg-white hover:bg-violet-50/30 transition-all cursor-pointer group shadow-sm">
            <div class="flex items-center gap-3">
                <div class="w-10 h-10 rounded-xl bg-violet-100 text-violet-700 flex items-center justify-center font-bold text-sm shrink-0 group-hover:scale-105 transition-transform">
                    ${getInitials(item.nama)}
                </div>
                <div class="min-w-0 flex-1">
                    <h5 class="text-xs sm:text-sm font-bold text-surface-800 truncate">${escapeHtml(item.nama)}</h5>
                    <p class="text-[11px] text-surface-400 truncate">${escapeHtml(item.kelas)} • ${formatPeriodeDisplay(item.periode)}</p>
                </div>
                <span class="text-xs text-violet-600 font-bold group-hover:translate-x-1 transition-transform">&rarr;</span>
            </div>
        </div>
    `).join('');
}

// ------------------------------------------------------------
// 5. URL PARAMS & QUICK ACCESS
// ------------------------------------------------------------

function checkUrlParams() {
    const urlParams = new URLSearchParams(window.location.search);
    const idParam = urlParams.get('id');
    const namaParam = urlParams.get('nama');

    if (idParam) {
        const found = parentRaportList.find(r => r.id === idParam);
        if (found) {
            const selectMurid = document.getElementById('parent-select-murid');
            if (selectMurid) selectMurid.value = found.nama;
            displayRaport(found);
            return;
        }
    }

    if (namaParam) {
        selectStudentByName(namaParam);
    }
}

// ------------------------------------------------------------
// 6. PRINT & PDF DOWNLOAD (SAFE HTML GENERATION)
// ------------------------------------------------------------

function printCurrentRaport() {
    if (!currentSelectedRaport) return;
    const item = currentSelectedRaport;
    const dateFormatted = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });

    const printWin = window.open('', '_blank');
    if (!printWin) {
        alert('Popup diblokir oleh browser. Izinkan popup untuk mengunduh raport.');
        return;
    }

    const htmlContent = [
        '<!DOCTYPE html>',
        '<html lang="id">',
        '<head>',
        '<meta charset="UTF-8">',
        '<title>Raport Caberawit - ' + escapeHtml(item.nama) + '</title>',
        '<style>',
        '@page { size: A4 portrait; margin: 15mm; }',
        '* { box-sizing: border-box; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }',
        'body { font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif; color: #1e293b; background: #fff; margin: 0; padding: 20px; line-height: 1.5; }',
        '.kop { text-align: center; border-bottom: 3px double #0f172a; padding-bottom: 12px; margin-bottom: 20px; }',
        '.kop h2 { margin: 0; font-size: 18px; color: #1e1b4b; text-transform: uppercase; letter-spacing: 0.5px; }',
        '.kop h1 { margin: 4px 0; font-size: 21px; color: #4338ca; }',
        '.kop p { margin: 0; font-size: 11px; color: #64748b; }',
        '.badge-title { display: inline-block; background: #ede9fe; color: #5b21b6; padding: 5px 14px; border-radius: 999px; font-size: 12px; font-weight: bold; margin-bottom: 15px; border: 1px solid #ddd6fe; }',
        '.identity-table { width: 100%; border-collapse: collapse; margin-bottom: 18px; font-size: 12px; }',
        '.identity-table td { padding: 6px 10px; border-bottom: 1px solid #f1f5f9; }',
        '.identity-table td.label { width: 28%; font-weight: bold; color: #475569; background: #f8fafc; }',
        '.box { border-radius: 10px; padding: 14px 16px; margin-bottom: 14px; page-break-inside: avoid; }',
        '.box-warning { background: #fff1f2; border: 1.5px solid #fecdd3; }',
        '.box-warning h3 { margin: 0 0 6px 0; font-size: 13px; color: #9f1239; }',
        '.box-warning p { margin: 0; font-size: 12px; color: #334155; }',
        '.box-success { background: #f0fdf4; border: 1.5px solid #bbf7d0; }',
        '.box-success h3 { margin: 0 0 6px 0; font-size: 13px; color: #166534; }',
        '.box-success p { margin: 0; font-size: 12px; color: #334155; }',
        '.box-note { background: #f8fafc; border: 1px solid #e2e8f0; font-size: 11px; color: #64748b; }',
        '.signatures { margin-top: 35px; width: 100%; display: table; font-size: 12px; }',
        '.sig-col { display: table-cell; width: 50%; text-align: center; }',
        '.sig-space { height: 60px; }',
        '.footer { margin-top: 30px; text-align: center; font-size: 10px; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 10px; }',
        '@media print { body { padding: 0; } }',
        '</style>',
        '</head>',
        '<body>',
        '<div class="kop">',
        '<h2>Lembaga Pembinaan Caberawit & Generasi Penerus</h2>',
        '<h1>LEMBAR RAPORT & EVALUASI BELAJAR</h1>',
        '<p>Sistem Informasi Perkembangan Pembelajaran Caberawit Terintegrasi</p>',
        '</div>',
        '<div style="text-align: center;">',
        '<span class="badge-title">RAPORT PERIODE: ' + formatPeriodeDisplay(item.periode).toUpperCase() + '</span>',
        '</div>',
        '<table class="identity-table">',
        '<tr><td class="label">Nama Lengkap Murid</td><td><b>' + escapeHtml(item.nama) + '</b></td><td class="label">Kelas / Kelompok</td><td>' + escapeHtml(item.kelas) + '</td></tr>',
        '<tr><td class="label">Mata Pelajaran</td><td><b>' + escapeHtml(item.mapel) + '</b></td><td class="label">Predikat Capaian</td><td><b>' + escapeHtml(item.predikat) + '</b></td></tr>',
        '<tr><td class="label">Status Evaluasi</td><td>Resmi Terbit</td><td class="label">Tanggal Cetak</td><td>' + dateFormatted + '</td></tr>',
        '</table>',
        '<div class="box box-warning">',
        '<h3>⚠️ KEKURANGAN MATERI (HAL YANG PERLU DITINGKATKAN):</h3>',
        '<p>' + escapeHtml(item.kekurangan).replace(/\n/g, '<br>') + '</p>',
        '</div>',
        '<div class="box box-success">',
        '<h3>💡 SARAN PEMBINAAN & PENDAMPINGAN ORANG TUA DI RUMAH:</h3>',
        '<p>' + escapeHtml(item.saran || 'Mohon kerja sama orang tua untuk mendampingi putra/putrinya mengulang materi di rumah.').replace(/\n/g, '<br>') + '</p>',
        '</div>',
        item.catatan ? ('<div class="box box-note"><b>Catatan Guru Pengajar:</b><br>' + escapeHtml(item.catatan).replace(/\n/g, '<br>') + '</div>') : '',
        '<table class="signatures">',
        '<tr>',
        '<td class="sig-col">Mengetahui,<br><b>Orang Tua / Wali Murid</b><div class="sig-space"></div>( ............................................ )</td>',
        '<td class="sig-col">Ditetapkan pada: ' + dateFormatted + '<br><b>Guru Pengajar / Wali Kelas</b><div class="sig-space"></div>( <b>Ustadz / Ustadzah</b> )</td>',
        '</tr>',
        '</table>',
        '<div class="footer">Dokumen resmi dicetak melalui Portal Raport Caberawit.</div>',
        '</body>',
        '</html>'
    ].join('\n');

    printWin.document.open();
    printWin.document.write(htmlContent);
    printWin.document.close();
    setTimeout(() => printWin.print(), 500);
}

// ------------------------------------------------------------
// 7. ACTIONS: WHATSAPP CONSULTATION & SHARING
// ------------------------------------------------------------

function contactTeacherWhatsApp(customNama = '') {
    const studentName = customNama || (currentSelectedRaport ? currentSelectedRaport.nama : currentSelectedStudentName);
    const mapel = currentSelectedRaport ? currentSelectedRaport.mapel : 'Pembelajaran Caberawit';
    const periode = currentSelectedRaport ? formatPeriodeDisplay(currentSelectedRaport.periode) : 'Bulan ini';

    const text = [
        "Assalamu'alaikum Warahmatullahi Wabarakatuh Ustadz/Ustadzah.",
        `Saya wali murid dari ananda *${studentName}*.`,
        `Saya ingin berkonsultasi mengenai perkembangan materi pembelajaran ananda (${mapel} - ${periode}).`,
        "Alhamdulillah Jazakumullahu Khoiro atas bimbingan dan perhatiannya."
    ].join('\n\n');

    const url = `https://wa.me/?text=${encodeURIComponent(text)}`;
    window.open(url, '_blank');
}

function shareRaportLink() {
    let url = window.location.href.split('?')[0];
    if (currentSelectedRaport) {
        url += `?id=${currentSelectedRaport.id}`;
    } else if (currentSelectedStudentName) {
        url += `?nama=${encodeURIComponent(currentSelectedStudentName)}`;
    }

    if (navigator.share) {
        navigator.share({
            title: `Raport Caberawit - ${currentSelectedRaport ? currentSelectedRaport.nama : currentSelectedStudentName}`,
            text: `Lembar Raport & Evaluasi Pembelajaran ananda ${currentSelectedRaport ? currentSelectedRaport.nama : currentSelectedStudentName}`,
            url: url
        }).catch(() => {});
    } else {
        navigator.clipboard.writeText(url).then(() => {
            showParentToast('Tautan raport berhasil disalin ke clipboard!', 'success');
        }).catch(() => {
            prompt('Salin tautan ini:', url);
        });
    }
}

// ------------------------------------------------------------
// 8. UTILITIES
// ------------------------------------------------------------

function formatPeriodeDisplay(periodeStr) {
    if (!periodeStr) return '-';
    const parts = periodeStr.split('-');
    if (parts.length !== 2) return periodeStr;
    const months = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
    const mIdx = parseInt(parts[1]) - 1;
    return `${months[mIdx] || parts[1]} ${parts[0]}`;
}

function getInitials(name) {
    if (!name) return '?';
    const parts = name.trim().split(' ');
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return name.substring(0, 2).toUpperCase();
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function showParentToast(msg, type = 'info') {
    const container = document.getElementById('parent-toast-container');
    if (!container) return;
    const t = document.createElement('div');
    t.className = 'px-4 py-3 bg-surface-900 text-white text-xs font-semibold rounded-xl shadow-xl flex items-center gap-2 pointer-events-auto animate-slide-up';
    t.innerHTML = `<i class="fa-solid fa-circle-info text-primary-400"></i> <span>${escapeHtml(msg)}</span>`;
    container.appendChild(t);
    setTimeout(() => t.remove(), 3500);
}
