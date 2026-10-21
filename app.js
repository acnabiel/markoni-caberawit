/* ============================================================
   APP.JS — AbsensiKu Dashboard Application
   
   Supports:
   - Firebase Realtime Database (RTDB) & Cloud Firestore
   - LocalStorage offline synchronization (100% resilient CRUD)
   - Real-time updates for Attendance (Absensi) & Employees (Karyawan)
   - Interactive ApexCharts with period filters
   - Filterable tables, CSV export, and demo generator
   ============================================================ */

// -----------------------------------------------
// 1. FIREBASE CONFIGURATION & INITIALIZATION
// -----------------------------------------------
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

let db = null;           // Cloud Firestore
let rtdb = null;         // Realtime Database
let activeEngine = null; // 'rtdb', 'firestore', or 'local'
let isFirebaseConnected = false;

try {
    if (typeof firebase !== 'undefined' && firebase.apps) {
        if (!firebase.apps.length) {
            firebase.initializeApp(firebaseConfig);
        }
        // Inisialisasi Realtime Database jika ada databaseURL
        if (typeof firebase.database === 'function' && firebaseConfig.databaseURL) {
            rtdb = firebase.database();
        }
        // Inisialisasi Cloud Firestore
        if (typeof firebase.firestore === 'function') {
            db = firebase.firestore();
        }
    }
} catch (e) {
    console.warn('Firebase init warning:', e);
}


// -----------------------------------------------
// 2. GLOBAL STATE
// -----------------------------------------------
let currentPage = 'dashboard';
let attendanceChart = null;
let allAbsensiData = [];
let allKaryawanData = [];
let displayLimit = 10;
let dashboardStatusFilter = 'semua';
let dashboardScope = 'today';

// State untuk checkbox & bulk delete
let selectedKaryawanIds = new Set();
let lastRenderedKaryawanList = [];
let selectedRekapIds = new Set();
let lastRenderedRekapList = [];
let currentBulkDeleteTarget = null; // 'karyawan' or 'rekap'

// State untuk QR Scanner & Badges (Mobile & Desktop)
let html5QrScanner = null;
let isScannerRunning = false;
let currentFacingMode = "environment"; // default kamera belakang pada mobile
let selectedCameraId = null;
let scanSoundEnabled = true;
let lastScannedText = null;
let lastScanTimestamp = 0;
const SCAN_COOLDOWN_MS = 2500;
let liveClockInterval = null;
let currentSelectedQRItem = null;



// -----------------------------------------------
// 3. INITIALIZATION — DOM READY
// -----------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
    setCurrentDate();
    setDefaultFormDate();
    initChart();

    // Muat data lokal
    loadFromLocalStorage();

    // Bersihkan data demo yang tersisa
    cleanupLegacyDemoData(false);

    // Coba hubungkan ke Firebase (Realtime Database atau Firestore)
    connectToFirebase();

    // Setup input file listener untuk unggah gambar QR fallback
    const qrFileInput = document.getElementById('qr-file-input');
    if (qrFileInput) {
        qrFileInput.addEventListener('change', handleQRImageUpload);
    }
});


// -----------------------------------------------
// 4. FIREBASE AUTO-DETECTION & CONNECTION
// -----------------------------------------------

async function connectToFirebase() {
    updateConnectionBadge('checking', 'Memeriksa Database...');

    // Prioritas 1: Firebase Realtime Database (sesuai URL database user)
    if (rtdb) {
        try {
            console.log('🔄 Mencoba koneksi ke Firebase Realtime Database...');
            const testRef = rtdb.ref('absensi');
            
            // Coba ambil 1 data dengan timeout
            const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error('timeout')), 4000)
            );
            const fetchPromise = testRef.limitToLast(1).once('value');

            await Promise.race([fetchPromise, timeoutPromise]);

            activeEngine = 'rtdb';
            isFirebaseConnected = true;
            console.log('✅ Terhubung ke Firebase Realtime Database!');
            updateConnectionBadge('connected', 'Firebase Realtime Online');
            updateModalDbInfo('Realtime Database Terhubung', 'Aplikasi berhasil tersambung ke <b>Firebase Realtime Database</b> (absensi-4d9c8). Data tersinkronisasi real-time.', 'emerald');
            
            setupRealtimeDbListeners();
            return;
        } catch (err) {
            console.warn('Realtime Database error:', err.message || err);
            if (err.message && (err.message.includes('Permission denied') || err.message.includes('permission_denied'))) {
                updateConnectionBadge('locked', 'Rules RTDB Terkunci');
                updateModalDbInfo('Aturan Realtime Database Terkunci', 'Firebase Realtime Database aktif, namun tab <b>Rules</b> masih menolak akses.<br><br><b>Perbaikan:</b> Masukkan aturan JSON berikut di tab Rules:<br><code>{\n  "rules": {\n    ".read": true,\n    ".write": true\n  }\n}</code>', 'amber');
                showToast('Rules Realtime Database masih terkunci. Mode lokal aktif.', 'info');
                ensureDataAvailable();
                return;
            }
        }
    }

    // Prioritas 2: Cloud Firestore
    if (db) {
        try {
            console.log('🔄 Mencoba koneksi ke Cloud Firestore...');
            const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error('timeout')), 4000)
            );
            const fetchPromise = db.collection('absensi').limit(1).get();

            await Promise.race([fetchPromise, timeoutPromise]);

            activeEngine = 'firestore';
            isFirebaseConnected = true;
            console.log('✅ Terhubung ke Cloud Firestore!');
            updateConnectionBadge('connected', 'Firestore Online');
            updateModalDbInfo('Cloud Firestore Terhubung', 'Aplikasi berhasil tersambung ke <b>Cloud Firestore</b>. Data tersinkronisasi real-time.', 'emerald');
            
            setupFirestoreListeners();
            return;
        } catch (err) {
            console.warn('Firestore error:', err.message || err);
        }
    }

    // Fallback: Mode Lokal
    activeEngine = 'local';
    isFirebaseConnected = false;
    updateConnectionBadge('offline', 'Mode Lokal (Penyimpanan Aman)');
    ensureDataAvailable();
}

function updateConnectionBadge(status, text) {
    const badge = document.getElementById('connection-status-badge');
    const dot = document.getElementById('connection-status-dot');
    const label = document.getElementById('connection-status-text');

    if (!badge || !dot || !label) return;

    label.textContent = text;
    badge.className = 'inline-flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold border transition-all shadow-sm active:scale-95 cursor-pointer';
    dot.className = 'w-2 h-2 rounded-full';

    if (status === 'connected') {
        badge.classList.add('bg-emerald-50', 'text-emerald-700', 'border-emerald-200/80', 'hover:bg-emerald-100');
        dot.classList.add('bg-emerald-500', 'animate-pulse');
    } else if (status === 'checking') {
        badge.classList.add('bg-blue-50', 'text-blue-700', 'border-blue-200/80', 'hover:bg-blue-100');
        dot.classList.add('bg-blue-500', 'animate-ping');
    } else if (status === 'locked') {
        badge.classList.add('bg-amber-50', 'text-amber-800', 'border-amber-300', 'hover:bg-amber-100');
        dot.classList.add('bg-amber-500');
    } else {
        badge.classList.add('bg-rose-50', 'text-rose-700', 'border-rose-200', 'hover:bg-rose-100');
        dot.classList.add('bg-rose-500');
    }
}

function updateModalDbInfo(title, desc, color) {
    const statusEl = document.getElementById('modal-db-status');
    const descEl = document.getElementById('modal-db-desc');
    if (statusEl) {
        statusEl.textContent = title;
        statusEl.className = `font-bold text-${color}-600`;
    }
    if (descEl) descEl.innerHTML = desc;
}

async function testFirebaseConnection() {
    showToast('Mengetes ulang koneksi database...', 'info');
    await connectToFirebase();
    if (isFirebaseConnected) {
        showToast('Koneksi berhasil terhubung!', 'success');
        closeModal('modal-connection-info');
    } else {
        showToast('Masih belum terhubung. Pastikan Rules sudah dipublish.', 'error');
    }
}


// -----------------------------------------------
// 5. REALTIME LISTENERS (RTDB & FIRESTORE)
// -----------------------------------------------

function setupRealtimeDbListeners() {
    if (!rtdb) return;

    // Absensi listener
    rtdb.ref('absensi').on('value', (snapshot) => {
        const val = snapshot.val();
        if (val) {
            allAbsensiData = Object.entries(val)
                .map(([id, item]) => ({ id, ...item }))
                .filter(item => !isDemoRecord(item));
            allAbsensiData.sort((a, b) => {
                const tA = Number(a.timestamp) || new Date(`${a.tanggal} ${a.jam || '00:00'}`).getTime() || 0;
                const tB = Number(b.timestamp) || new Date(`${b.tanggal} ${b.jam || '00:00'}`).getTime() || 0;
                return tB - tA;
            });
        } else {
            allAbsensiData = [];
        }
        saveToLocalStorage();
        updateStatCards();
        renderAttendanceTable();
        updateChartData();
        renderRecentScansFeed();
        if (currentPage === 'rekap') filterRekapData();
    });

    // Karyawan / Caberawit listener
    rtdb.ref('karyawan').on('value', (snapshot) => {
        const val = snapshot.val();
        if (val) {
            const rawList = Object.entries(val)
                .map(([id, item]) => ({ id, ...item }))
                .filter(item => !isDemoRecord(item));

            // Deduplikasi berdasarkan nama peserta (hindari duplikat)
            const seenNames = new Set();
            const uniqueList = [];
            const duplicateIdsToDelete = [];

            rawList.forEach(item => {
                const cleanName = (item.nama || '').trim().toLowerCase();
                if (!cleanName) return;
                if (!seenNames.has(cleanName)) {
                    seenNames.add(cleanName);
                    uniqueList.push(item);
                } else {
                    duplicateIdsToDelete.push(item.id);
                }
            });

            // Hapus duplikat dari Firebase jika ada
            if (duplicateIdsToDelete.length > 0 && rtdb) {
                duplicateIdsToDelete.forEach(dupId => {
                    rtdb.ref(`karyawan/${dupId}`).remove().catch(() => {});
                });
            }

            allKaryawanData = uniqueList;
            allKaryawanData.sort((a, b) => (a.nama || '').localeCompare(b.nama || ''));
        } else {
            allKaryawanData = [];
        }
        saveKaryawanToLocalStorage();
        renderKaryawanTable(allKaryawanData);
        updateKaryawanDatalist();
        updateQuickQRCaberawitSelect();
    });
}

function setupFirestoreListeners() {
    if (!db) return;

    db.collection('absensi').onSnapshot((snapshot) => {
        if (!snapshot.empty) {
            allAbsensiData = [];
            snapshot.forEach(doc => {
                const item = { id: doc.id, ...doc.data() };
                if (!isDemoRecord(item)) {
                    allAbsensiData.push(item);
                }
            });
            allAbsensiData.sort((a, b) => (Number(b.timestamp) || 0) - (Number(a.timestamp) || 0));
        } else {
            allAbsensiData = [];
        }
        saveToLocalStorage();
        updateStatCards();
        renderAttendanceTable();
        updateChartData();
        renderRecentScansFeed();
        if (currentPage === 'rekap') filterRekapData();
    });

    db.collection('karyawan').onSnapshot((snapshot) => {
        if (!snapshot.empty) {
            const rawList = [];
            snapshot.forEach(doc => {
                const item = { id: doc.id, ...doc.data() };
                if (!isDemoRecord(item)) {
                    rawList.push(item);
                }
            });

            // Deduplikasi berdasarkan nama peserta
            const seenNames = new Set();
            const uniqueList = [];
            const duplicateIdsToDelete = [];

            rawList.forEach(item => {
                const cleanName = (item.nama || '').trim().toLowerCase();
                if (!cleanName) return;
                if (!seenNames.has(cleanName)) {
                    seenNames.add(cleanName);
                    uniqueList.push(item);
                } else {
                    duplicateIdsToDelete.push(item.id);
                }
            });

            if (duplicateIdsToDelete.length > 0 && db) {
                duplicateIdsToDelete.forEach(dupId => {
                    db.collection('karyawan').doc(dupId).delete().catch(() => {});
                });
            }

            allKaryawanData = uniqueList;
            allKaryawanData.sort((a, b) => (a.nama || '').localeCompare(b.nama || ''));
        } else {
            allKaryawanData = [];
        }
        saveKaryawanToLocalStorage();
        renderKaryawanTable(allKaryawanData);
        updateKaryawanDatalist();
        updateQuickQRCaberawitSelect();
    });
}


// -----------------------------------------------
// 6. LOCAL STORAGE PERSISTENCE
// -----------------------------------------------

function saveToLocalStorage() {
    try {
        localStorage.setItem('absensiku_absensi', JSON.stringify(allAbsensiData));
    } catch (e) {}
}

function saveKaryawanToLocalStorage() {
    try {
        localStorage.setItem('absensiku_karyawan', JSON.stringify(allKaryawanData));
    } catch (e) {}
}

function loadFromLocalStorage() {
    try {
        const abs = localStorage.getItem('absensiku_absensi');
        const kar = localStorage.getItem('absensiku_karyawan');
        if (abs) {
            allAbsensiData = JSON.parse(abs).filter(item => !isDemoRecord(item));
        }
        if (kar) {
            const raw = JSON.parse(kar).filter(item => !isDemoRecord(item));
            const seen = new Set();
            allKaryawanData = [];
            raw.forEach(k => {
                const key = (k.nama || '').trim().toLowerCase();
                if (key && !seen.has(key)) {
                    seen.add(key);
                    allKaryawanData.push(k);
                }
            });
        }

        updateStatCards();
        renderAttendanceTable();
        updateChartData();
        renderKaryawanTable(allKaryawanData);
        updateKaryawanDatalist();
        updateQuickQRCaberawitSelect();
        renderRecentScansFeed();
    } catch (e) {}
}

function ensureDataAvailable() {
    cleanupLegacyDemoData(false);
    updateStatCards();
    renderAttendanceTable();
    updateChartData();
    renderKaryawanTable(allKaryawanData);
    updateKaryawanDatalist();
    updateQuickQRCaberawitSelect();
    renderRecentScansFeed();
}


// -----------------------------------------------
// 7. DATA CLEANUP & RESET (NO DEMO DATA)
// -----------------------------------------------

function isDemoRecord(item) {
    if (!item) return false;
    if (typeof item.id === 'string' && (item.id.startsWith('demo-') || item.id.includes('demo'))) return true;
    const dummyNames = [
        'Andi Pratama', 'Budi Santoso', 'Citra Dewi', 'Dian Permata', 'Eka Fitriani',
        'Fajar Nugroho', 'Gita Lestari', 'Hadi Kusuma', 'Indah Sari', 'Joko Widodo'
    ];
    if (item.nama && dummyNames.includes(item.nama.trim())) {
        if (typeof item.id === 'string' && item.id.startsWith('karyawan-')) return true;
    }
    return false;
}

async function cleanupLegacyDemoData(notify = false) {
    const demoAbsensi = allAbsensiData.filter(isDemoRecord);
    const demoKaryawan = allKaryawanData.filter(isDemoRecord);

    allAbsensiData = allAbsensiData.filter(item => !isDemoRecord(item));
    allKaryawanData = allKaryawanData.filter(item => !isDemoRecord(item));

    // Bersihkan juga duplikat peserta jika ada nama yang ganda
    const seenNames = new Set();
    const cleanKaryawan = [];
    const duplicateKaryawanToDelete = [];
    allKaryawanData.forEach(item => {
        const key = (item.nama || '').trim().toLowerCase();
        if (key && !seenNames.has(key)) {
            seenNames.add(key);
            cleanKaryawan.push(item);
        } else {
            duplicateKaryawanToDelete.push(item);
        }
    });
    allKaryawanData = cleanKaryawan;

    saveToLocalStorage();
    saveKaryawanToLocalStorage();
    localStorage.removeItem('absensiku_seeded');

    // Hapus juga sisa data demo & duplikat di Firebase jika terhubung
    if (isFirebaseConnected) {
        if (activeEngine === 'rtdb' && rtdb) {
            demoAbsensi.forEach(item => {
                rtdb.ref(`absensi/${item.id}`).remove().catch(() => {});
            });
            demoKaryawan.forEach(item => {
                rtdb.ref(`karyawan/${item.id}`).remove().catch(() => {});
            });
            duplicateKaryawanToDelete.forEach(item => {
                rtdb.ref(`karyawan/${item.id}`).remove().catch(() => {});
            });
        } else if (activeEngine === 'firestore' && db) {
            demoAbsensi.forEach(item => {
                db.collection('absensi').doc(item.id).delete().catch(() => {});
            });
            demoKaryawan.forEach(item => {
                db.collection('karyawan').doc(item.id).delete().catch(() => {});
            });
            duplicateKaryawanToDelete.forEach(item => {
                db.collection('karyawan').doc(item.id).delete().catch(() => {});
            });
        }
    }

    updateStatCards();
    renderAttendanceTable();
    updateChartData();
    renderKaryawanTable(allKaryawanData);
    updateKaryawanDatalist();
    updateQuickQRCaberawitSelect();
    renderRecentScansFeed();
    if (currentPage === 'rekap') filterRekapData();

    if (notify) {
        showToast('✅ Berhasil membersihkan seluruh data demo!', 'success');
    }
}

async function generateSampleData() {
    showToast('Fitur data demo telah dinonaktifkan sesuai konfigurasi.', 'info');
}

async function clearAllData() {
    if (!confirm('Apakah Anda yakin ingin MENGHAPUS SEMUA data absensi dan peserta caberawit?')) return;

    allAbsensiData = [];
    allKaryawanData = [];
    selectedKaryawanIds.clear();
    selectedRekapIds.clear();
    localStorage.removeItem('absensiku_absensi');
    localStorage.removeItem('absensiku_karyawan');
    localStorage.removeItem('absensiku_seeded');

    if (isFirebaseConnected) {
        if (activeEngine === 'rtdb' && rtdb) {
            rtdb.ref('absensi').remove().catch(() => {});
            rtdb.ref('karyawan').remove().catch(() => {});
        } else if (activeEngine === 'firestore' && db) {
            try {
                const absSnap = await db.collection('absensi').get();
                absSnap.forEach(d => d.ref.delete());
                const karSnap = await db.collection('karyawan').get();
                karSnap.forEach(d => d.ref.delete());
            } catch (e) {}
        }
    }

    updateStatCards();
    renderAttendanceTable();
    updateChartData();
    renderKaryawanTable([]);
    updateKaryawanDatalist();
    updateQuickQRCaberawitSelect();
    renderRecentScansFeed();
    if (currentPage === 'rekap') filterRekapData();
    updateKaryawanBulkUI();
    updateRekapBulkUI();

    showToast('Seluruh data berhasil dikosongkan.', 'info');
}


// -----------------------------------------------
// 8. STAT CARDS & COUNTERS
// -----------------------------------------------

function updateStatCards() {
    const today = formatDateISO(new Date());
    const todayData = allAbsensiData.filter(item => item.tanggal === today);

    animateCounter('stat-hadir', todayData.filter(i => i.status === 'Hadir').length);
    animateCounter('stat-izin', todayData.filter(i => i.status === 'Izin').length);
    animateCounter('stat-sakit', todayData.filter(i => i.status === 'Sakit').length);
    animateCounter('stat-alpa', todayData.filter(i => i.status === 'Alpa').length);
}

function animateCounter(elementId, target) {
    const el = document.getElementById(elementId);
    if (!el) return;

    const duration = 600;
    const start = parseInt(el.textContent) || 0;
    const startTime = performance.now();

    function step(currentTime) {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        el.textContent = Math.round(start + (target - start) * eased);
        if (progress < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
}


// -----------------------------------------------
// 9. APEXCHARTS
// -----------------------------------------------

function initChart() {
    const chartEl = document.getElementById('attendance-chart');
    if (!chartEl) return;

    const options = {
        series: [
            { name: 'Hadir', data: [] },
            { name: 'Izin', data: [] },
            { name: 'Sakit', data: [] },
            { name: 'Alpa', data: [] }
        ],
        chart: {
            type: 'area',
            height: 320,
            fontFamily: 'Inter, system-ui, sans-serif',
            toolbar: { show: true, tools: { download: true, selection: false, zoom: false, zoomin: false, zoomout: false, pan: false, reset: false } },
            animations: { enabled: true, easing: 'easeinout', speed: 500 }
        },
        colors: ['#10b981', '#f59e0b', '#3b82f6', '#ef4444'],
        stroke: { curve: 'smooth', width: 2.5 },
        fill: { type: 'gradient', gradient: { shadeIntensity: 1, opacityFrom: 0.25, opacityTo: 0.05, stops: [0, 90, 100] } },
        dataLabels: { enabled: false },
        xaxis: {
            categories: [],
            labels: { style: { colors: '#64748b', fontSize: '11px', fontWeight: 500 } },
            axisBorder: { show: false },
            axisTicks: { show: false }
        },
        yaxis: {
            labels: {
                style: { colors: '#64748b', fontSize: '11px', fontWeight: 500 },
                formatter: (val) => Math.round(val)
            }
        },
        grid: { borderColor: '#f1f5f9', strokeDashArray: 4, xaxis: { lines: { show: false } }, yaxis: { lines: { show: true } } },
        legend: { position: 'top', horizontalAlign: 'right', fontSize: '12px', fontWeight: 600, labels: { colors: '#475569' }, markers: { radius: 4, width: 10, height: 10 } },
        tooltip: { shared: true, intersect: false, y: { formatter: (val) => `${val} orang` } }
    };

    attendanceChart = new ApexCharts(chartEl, options);
    attendanceChart.render();
}

function updateChart(filter) {
    if (!attendanceChart) return;
    if (!filter) filter = document.getElementById('chart-filter')?.value || 'mingguan';
    const chartData = calculateChartData(filter);

    attendanceChart.updateOptions({
        xaxis: { categories: chartData.labels },
        series: [
            { name: 'Hadir', data: chartData.hadir },
            { name: 'Izin', data: chartData.izin },
            { name: 'Sakit', data: chartData.sakit },
            { name: 'Alpa', data: chartData.alpa }
        ]
    });
}

function updateChartData() {
    const filter = document.getElementById('chart-filter')?.value || 'mingguan';
    updateChart(filter);
}

function calculateChartData(filter) {
    const result = { labels: [], hadir: [], izin: [], sakit: [], alpa: [] };
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (filter === 'harian') {
        for (let i = 6; i >= 0; i--) {
            const date = new Date(today);
            date.setDate(date.getDate() - i);
            const dateStr = formatDateISO(date);
            const dayData = allAbsensiData.filter(item => item.tanggal === dateStr);

            result.labels.push(formatDateShort(date));
            result.hadir.push(dayData.filter(d => d.status === 'Hadir').length);
            result.izin.push(dayData.filter(d => d.status === 'Izin').length);
            result.sakit.push(dayData.filter(d => d.status === 'Sakit').length);
            result.alpa.push(dayData.filter(d => d.status === 'Alpa').length);
        }
    } else if (filter === 'mingguan') {
        for (let w = 3; w >= 0; w--) {
            const weekEnd = new Date(today);
            weekEnd.setDate(weekEnd.getDate() - (w * 7));
            const weekStart = new Date(weekEnd);
            weekStart.setDate(weekStart.getDate() - 6);

            const startStr = formatDateISO(weekStart);
            const endStr = formatDateISO(weekEnd);

            const weekData = allAbsensiData.filter(item => item.tanggal >= startStr && item.tanggal <= endStr);

            result.labels.push(`${formatDateShort(weekStart)} - ${formatDateShort(weekEnd)}`);
            result.hadir.push(weekData.filter(d => d.status === 'Hadir').length);
            result.izin.push(weekData.filter(d => d.status === 'Izin').length);
            result.sakit.push(weekData.filter(d => d.status === 'Sakit').length);
            result.alpa.push(weekData.filter(d => d.status === 'Alpa').length);
        }
    } else if (filter === 'bulanan') {
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
        for (let m = 5; m >= 0; m--) {
            const monthDate = new Date(today.getFullYear(), today.getMonth() - m, 1);
            const y = monthDate.getFullYear();
            const mo = String(monthDate.getMonth() + 1).padStart(2, '0');
            const prefix = `${y}-${mo}`;

            const monthData = allAbsensiData.filter(item => item.tanggal && item.tanggal.startsWith(prefix));

            result.labels.push(`${monthNames[monthDate.getMonth()]} ${y}`);
            result.hadir.push(monthData.filter(d => d.status === 'Hadir').length);
            result.izin.push(monthData.filter(d => d.status === 'Izin').length);
            result.sakit.push(monthData.filter(d => d.status === 'Sakit').length);
            result.alpa.push(monthData.filter(d => d.status === 'Alpa').length);
        }
    }
    return result;
}


// -----------------------------------------------
// 10. ATTENDANCE TABLE — DASHBOARD
// -----------------------------------------------

function setDashboardStatusFilter(status) {
    dashboardStatusFilter = status;
    document.querySelectorAll('.dash-filter-btn').forEach(btn => {
        btn.className = 'dash-filter-btn px-2.5 py-1 rounded-lg bg-white text-surface-600 hover:bg-surface-100 border border-surface-200';
    });

    const activeBtn = document.getElementById(`btn-filter-${status.toLowerCase()}`);
    if (activeBtn) {
        activeBtn.className = 'dash-filter-btn px-2.5 py-1 rounded-lg bg-primary-600 text-white border border-primary-600';
    }
    renderAttendanceTable();
}

function setDashboardScope(scope) {
    dashboardScope = scope;
    const subTitle = document.getElementById('table-subtitle');
    if (subTitle) {
        subTitle.textContent = (scope === 'today') ? 'Data kehadiran yang tercatat hari ini' : 'Semua riwayat data kehadiran yang tercatat';
    }
    renderAttendanceTable();
}

function renderAttendanceTable() {
    const tbody = document.getElementById('attendance-table-body');
    const emptyState = document.getElementById('table-empty');
    const countEl = document.getElementById('table-count');
    if (!tbody) return;

    const today = formatDateISO(new Date());

    let filtered = dashboardScope === 'today'
        ? allAbsensiData.filter(item => item.tanggal === today)
        : [...allAbsensiData];

    if (dashboardStatusFilter !== 'semua') {
        filtered = filtered.filter(item => item.status === dashboardStatusFilter);
    }

    const searchVal = document.getElementById('search-table')?.value?.toLowerCase().trim() || '';
    if (searchVal) {
        filtered = filtered.filter(item => (item.nama || '').toLowerCase().includes(searchVal));
    }

    const displayData = filtered.slice(0, displayLimit);

    if (displayData.length === 0) {
        tbody.innerHTML = '';
        emptyState?.classList.remove('hidden');
        emptyState?.classList.add('flex');
        if (countEl) countEl.textContent = '0';
        return;
    }

    emptyState?.classList.add('hidden');
    emptyState?.classList.remove('flex');

    tbody.innerHTML = displayData.map((item, index) => `
        <tr class="group hover:bg-surface-50 transition-colors">
            <td class="px-6 py-3.5 text-sm text-surface-400 font-medium">${index + 1}</td>
            <td class="px-6 py-3.5">
                <div class="flex items-center gap-3">
                    <div class="w-8 h-8 rounded-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center text-white text-xs font-bold shadow-sm">
                        ${getInitials(item.nama)}
                    </div>
                    <div>
                        <p class="text-sm font-semibold text-surface-800">${escapeHtml(item.nama)}</p>
                        ${item.keterangan ? `<p class="text-[11px] text-surface-400 truncate max-w-[160px]">${escapeHtml(item.keterangan)}</p>` : ''}
                    </div>
                </div>
            </td>
            <td class="px-6 py-3.5 text-sm text-surface-600">${formatDateDisplay(item.tanggal)}</td>
            <td class="px-6 py-3.5 text-sm text-surface-600 font-mono">${item.jam || '-'}</td>
            <td class="px-6 py-3.5">
                <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold badge-${item.status.toLowerCase()}">
                    ${getStatusIcon(item.status)} ${item.status}
                </span>
            </td>
            <td class="px-6 py-3.5">
                <div class="flex items-center gap-1.5">
                    <button onclick="openEditModal('${item.id}')" class="p-1.5 rounded-lg hover:bg-primary-50 text-surface-400 hover:text-primary-600 transition-colors" title="Edit Absensi">
                        <i class="fa-solid fa-pen-to-square text-xs"></i>
                    </button>
                    <button onclick="deleteAbsensi('${item.id}')" class="p-1.5 rounded-lg hover:bg-rose-50 text-surface-400 hover:text-rose-600 transition-colors" title="Hapus Absensi">
                        <i class="fa-solid fa-trash-can text-xs"></i>
                    </button>
                </div>
            </td>
        </tr>
    `).join('');

    if (countEl) countEl.textContent = filtered.length;
}

function loadMoreData() {
    displayLimit += 10;
    renderAttendanceTable();
}

function filterTable(query) {
    renderAttendanceTable();
}


// -----------------------------------------------
// 11. REKAP DATA & CSV EXPORT
// -----------------------------------------------

function filterRekapData() {
    const startDate = document.getElementById('filter-start')?.value;
    const endDate = document.getElementById('filter-end')?.value;

    let filtered = [...allAbsensiData];
    if (startDate) filtered = filtered.filter(item => item.tanggal >= startDate);
    if (endDate) filtered = filtered.filter(item => item.tanggal <= endDate);

    filtered.sort((a, b) => {
        const tA = Number(a.timestamp) || new Date(`${a.tanggal} ${a.jam || '00:00'}`).getTime() || 0;
        const tB = Number(b.timestamp) || new Date(`${b.tanggal} ${b.jam || '00:00'}`).getTime() || 0;
        return tB - tA;
    });

    renderRekapTable(filtered);
}

function renderRekapTable(data) {
    const tbody = document.getElementById('rekap-table-body');
    const emptyState = document.getElementById('rekap-empty');
    if (!tbody) return;

    lastRenderedRekapList = data || [];

    if (!data || data.length === 0) {
        tbody.innerHTML = '';
        emptyState?.classList.remove('hidden');
        emptyState?.classList.add('flex');
        updateRekapBulkUI();
        return;
    }

    emptyState?.classList.add('hidden');
    emptyState?.classList.remove('flex');

    tbody.innerHTML = data.map((item, index) => {
        const isSelected = selectedRekapIds.has(item.id);
        return `
        <tr class="group hover:bg-surface-50 transition-colors ${isSelected ? 'row-selected' : ''}" id="rekap-row-${item.id}">
            <td class="w-12 px-4 py-3.5 text-center">
                <input type="checkbox" class="table-checkbox w-4 h-4 rounded text-primary-600 border-surface-300 focus:ring-primary-500 cursor-pointer"
                    data-id="${item.id}"
                    ${isSelected ? 'checked' : ''}
                    onchange="toggleRekapRow('${item.id}', this.checked)" />
            </td>
            <td class="px-6 py-3.5 text-sm text-surface-400 font-medium">${index + 1}</td>
            <td class="px-6 py-3.5">
                <div class="flex items-center gap-3">
                    <div class="w-8 h-8 rounded-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center text-white text-xs font-bold shadow-sm">
                        ${getInitials(item.nama)}
                    </div>
                    <span class="text-sm font-semibold text-surface-800">${escapeHtml(item.nama)}</span>
                </div>
            </td>
            <td class="px-6 py-3.5 text-sm text-surface-600">${formatDateDisplay(item.tanggal)}</td>
            <td class="px-6 py-3.5 text-sm text-surface-600 font-mono">${item.jam || '-'}</td>
            <td class="px-6 py-3.5">
                <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold badge-${item.status.toLowerCase()}">
                    ${getStatusIcon(item.status)} ${item.status}
                </span>
            </td>
            <td class="px-6 py-3.5 text-sm text-surface-500 max-w-[200px] truncate">${escapeHtml(item.keterangan || '-')}</td>
            <td class="px-6 py-3.5">
                <div class="flex items-center gap-1.5">
                    <button onclick="openEditModal('${item.id}')" class="p-1.5 rounded-lg hover:bg-primary-50 text-surface-400 hover:text-primary-600 transition-colors" title="Edit">
                        <i class="fa-solid fa-pen-to-square text-xs"></i>
                    </button>
                    <button onclick="deleteAbsensi('${item.id}')" class="p-1.5 rounded-lg hover:bg-rose-50 text-surface-400 hover:text-rose-600 transition-colors" title="Hapus">
                        <i class="fa-solid fa-trash-can text-xs"></i>
                    </button>
                </div>
            </td>
        </tr>
    `}).join('');

    updateRekapBulkUI();
}

function toggleSelectAllRekap(master) {
    if (master.checked) {
        lastRenderedRekapList.forEach(r => selectedRekapIds.add(r.id));
    } else {
        lastRenderedRekapList.forEach(r => selectedRekapIds.delete(r.id));
    }
    renderRekapTable(lastRenderedRekapList);
}

function toggleRekapRow(id, isChecked) {
    if (isChecked) {
        selectedRekapIds.add(id);
    } else {
        selectedRekapIds.delete(id);
    }
    const row = document.getElementById(`rekap-row-${id}`);
    if (row) {
        if (isChecked) row.classList.add('row-selected');
        else row.classList.remove('row-selected');
    }
    updateRekapBulkUI();
}

function updateRekapBulkUI() {
    const master = document.getElementById('rekap-select-all');
    const visibleCount = lastRenderedRekapList.length;
    const selectedInVisible = lastRenderedRekapList.filter(r => selectedRekapIds.has(r.id)).length;
    const totalSelected = selectedRekapIds.size;

    if (master) {
        if (visibleCount > 0 && selectedInVisible === visibleCount) {
            master.checked = true;
            master.indeterminate = false;
        } else if (selectedInVisible > 0) {
            master.checked = false;
            master.indeterminate = true;
        } else {
            master.checked = false;
            master.indeterminate = false;
        }
    }

    const badge = document.getElementById('selected-rekap-badge');
    const bulkBar = document.getElementById('rekap-bulk-bar');
    const bulkBarCount = document.getElementById('rekap-bulk-bar-count');
    const deleteBtn = document.getElementById('btn-delete-selected-rekap');

    if (totalSelected > 0) {
        if (badge) badge.textContent = totalSelected;
        if (bulkBarCount) bulkBarCount.textContent = totalSelected;
        if (bulkBar) {
            bulkBar.classList.remove('hidden');
            bulkBar.classList.add('flex');
        }
        if (deleteBtn) {
            deleteBtn.classList.remove('hidden');
            deleteBtn.classList.add('inline-flex');
        }
    } else {
        if (bulkBar) {
            bulkBar.classList.add('hidden');
            bulkBar.classList.remove('flex');
        }
        if (deleteBtn) {
            deleteBtn.classList.add('hidden');
            deleteBtn.classList.remove('inline-flex');
        }
    }
}

function clearRekapSelection() {
    selectedRekapIds.clear();
    renderRekapTable(lastRenderedRekapList);
}

function confirmDeleteSelectedRekap() {
    const count = selectedRekapIds.size;
    if (count === 0) {
        showToast('Pilih setidaknya 1 data absensi terlebih dahulu', 'info');
        return;
    }

    currentBulkDeleteTarget = 'rekap';
    const titleEl = document.getElementById('bulk-modal-title');
    const msgEl = document.getElementById('bulk-modal-message');

    if (titleEl) titleEl.textContent = `Hapus ${count} Data Absensi?`;
    if (msgEl) {
        msgEl.innerHTML = `Apakah Anda yakin ingin menghapus <strong class="text-rose-600">${count} data absensi</strong> yang dipilih dari riwayat?<br><span class="text-[11px] text-surface-400 mt-2 block">Data yang dihapus akan disinkronkan secara permanen ke database.</span>`;
    }

    openModal('modal-confirm-bulk-delete');
}

async function executeDeleteSelectedRekap() {
    const count = selectedRekapIds.size;
    if (count === 0) return;

    const idsToDelete = Array.from(selectedRekapIds);

    // Hapus dari Firebase jika terhubung
    if (isFirebaseConnected) {
        if (activeEngine === 'rtdb' && rtdb) {
            await Promise.all(idsToDelete.map(id => rtdb.ref(`absensi/${id}`).remove().catch(() => {})));
        } else if (activeEngine === 'firestore' && db) {
            await Promise.all(idsToDelete.map(id => db.collection('absensi').doc(id).delete().catch(() => {})));
        }
    }

    allAbsensiData = allAbsensiData.filter(d => !selectedRekapIds.has(d.id));
    selectedRekapIds.clear();
    saveToLocalStorage();

    updateStatCards();
    renderAttendanceTable();
    updateChartData();
    filterRekapData();
    updateRekapBulkUI();

    closeModal('modal-confirm-bulk-delete');
    showToast(`Berhasil menghapus ${count} data absensi!`, 'success');
}


function exportCSV() {
    const startDate = document.getElementById('filter-start')?.value;
    const endDate = document.getElementById('filter-end')?.value;

    let data = [...allAbsensiData];
    if (startDate) data = data.filter(item => item.tanggal >= startDate);
    if (endDate) data = data.filter(item => item.tanggal <= endDate);

    if (data.length === 0) {
        showToast('Tidak ada data absensi untuk diekspor', 'error');
        return;
    }

    data.sort((a, b) => a.tanggal.localeCompare(b.tanggal));

    let csv = 'No,Nama Karyawan,Tanggal,Jam Masuk,Status,Keterangan\n';
    data.forEach((row, i) => {
        csv += `${i + 1},"${(row.nama || '').replace(/"/g, '""')}",${row.tanggal},${row.jam || ''},${row.status},"${(row.keterangan || '').replace(/"/g, '""')}"\n`;
    });

    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Rekap_Absensi_${formatDateISO(new Date())}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    showToast(`Berhasil mengekspor ${data.length} data absensi`, 'success');
}


// -----------------------------------------------
// 12. CRUD OPERATIONS — ABSENSI
// -----------------------------------------------

async function handleSubmitAbsensi(event) {
    event.preventDefault();

    const nama = document.getElementById('input-nama').value.trim();
    const tanggal = document.getElementById('input-tanggal').value;
    const jam = document.getElementById('input-jam').value;
    const status = document.getElementById('input-status').value;
    const keterangan = document.getElementById('input-keterangan')?.value.trim() || '';

    if (!nama || !tanggal || !jam || !status) {
        showToast('Mohon lengkapi field wajib!', 'error');
        return;
    }

    const newRecord = { nama, tanggal, jam, status, keterangan, timestamp: Date.now() };

    // Simpan ke cloud
    if (isFirebaseConnected) {
        if (activeEngine === 'rtdb' && rtdb) {
            try {
                const newRef = rtdb.ref('absensi').push();
                await newRef.set(newRecord);
                newRecord.id = newRef.key;
            } catch (e) { newRecord.id = 'local-' + Date.now(); }
        } else if (activeEngine === 'firestore' && db) {
            try {
                const docRef = await db.collection('absensi').add(newRecord);
                newRecord.id = docRef.id;
            } catch (e) { newRecord.id = 'local-' + Date.now(); }
        }
    } else {
        newRecord.id = 'local-' + Date.now();
    }

    allAbsensiData.unshift(newRecord);
    saveToLocalStorage();

    updateStatCards();
    renderAttendanceTable();
    updateChartData();

    document.getElementById('attendance-form').reset();
    setDefaultFormDate();

    showToast(`Absensi ${nama} (${status}) berhasil disimpan!`, 'success');
    navigateTo('dashboard');
}

async function handleQuickSubmitAbsensi(event) {
    event.preventDefault();

    const nama = document.getElementById('quick-nama').value.trim();
    const tanggal = document.getElementById('quick-tanggal').value;
    const jam = document.getElementById('quick-jam').value;
    const status = document.getElementById('quick-status').value;
    const keterangan = document.getElementById('quick-keterangan')?.value.trim() || '';

    if (!nama || !tanggal || !jam || !status) {
        showToast('Mohon isi field wajib!', 'error');
        return;
    }

    const newRecord = { nama, tanggal, jam, status, keterangan, timestamp: Date.now() };

    if (isFirebaseConnected) {
        if (activeEngine === 'rtdb' && rtdb) {
            try {
                const newRef = rtdb.ref('absensi').push();
                await newRef.set(newRecord);
                newRecord.id = newRef.key;
            } catch (e) { newRecord.id = 'local-' + Date.now(); }
        } else if (activeEngine === 'firestore' && db) {
            try {
                const docRef = await db.collection('absensi').add(newRecord);
                newRecord.id = docRef.id;
            } catch (e) { newRecord.id = 'local-' + Date.now(); }
        }
    } else {
        newRecord.id = 'local-' + Date.now();
    }

    allAbsensiData.unshift(newRecord);
    saveToLocalStorage();

    updateStatCards();
    renderAttendanceTable();
    updateChartData();

    closeModal('modal-quick-absensi');
    showToast(`Absensi cepat ${nama} berhasil disimpan!`, 'success');
}

function openQuickAddModal() {
    const today = new Date();
    const dateInput = document.getElementById('quick-tanggal');
    const timeInput = document.getElementById('quick-jam');
    const nameInput = document.getElementById('quick-nama');

    if (dateInput) dateInput.value = formatDateISO(today);
    if (timeInput) timeInput.value = `${String(today.getHours()).padStart(2, '0')}:${String(today.getMinutes()).padStart(2, '0')}`;
    if (nameInput) nameInput.value = '';

    openModal('modal-quick-absensi');
}

function openEditModal(id) {
    const item = allAbsensiData.find(d => d.id === id);
    if (!item) return;

    document.getElementById('edit-id').value = id;
    document.getElementById('edit-nama').value = item.nama;
    document.getElementById('edit-tanggal').value = item.tanggal;
    document.getElementById('edit-jam').value = item.jam;
    document.getElementById('edit-status').value = item.status;
    const ketEl = document.getElementById('edit-keterangan');
    if (ketEl) ketEl.value = item.keterangan || '';

    openModal('modal-edit');
}

async function handleUpdateAbsensi(event) {
    event.preventDefault();

    const id = document.getElementById('edit-id').value;
    const updatedData = {
        nama: document.getElementById('edit-nama').value.trim(),
        tanggal: document.getElementById('edit-tanggal').value,
        jam: document.getElementById('edit-jam').value,
        status: document.getElementById('edit-status').value,
        keterangan: document.getElementById('edit-keterangan')?.value.trim() || '',
        timestamp: Date.now()
    };

    if (isFirebaseConnected) {
        if (activeEngine === 'rtdb' && rtdb) {
            rtdb.ref(`absensi/${id}`).update(updatedData).catch(() => {});
        } else if (activeEngine === 'firestore' && db) {
            db.collection('absensi').doc(id).update(updatedData).catch(() => {});
        }
    }

    const idx = allAbsensiData.findIndex(d => d.id === id);
    if (idx !== -1) allAbsensiData[idx] = { ...allAbsensiData[idx], ...updatedData };
    saveToLocalStorage();

    updateStatCards();
    renderAttendanceTable();
    updateChartData();
    if (currentPage === 'rekap') filterRekapData();

    closeModal('modal-edit');
    showToast('Data absensi berhasil diperbarui!', 'success');
}

async function deleteAbsensi(id) {
    const item = allAbsensiData.find(d => d.id === id);
    const nama = item ? item.nama : 'data ini';

    if (!confirm(`Hapus absensi untuk "${nama}"?`)) return;

    if (isFirebaseConnected) {
        if (activeEngine === 'rtdb' && rtdb) {
            rtdb.ref(`absensi/${id}`).remove().catch(() => {});
        } else if (activeEngine === 'firestore' && db) {
            db.collection('absensi').doc(id).delete().catch(() => {});
        }
    }

    allAbsensiData = allAbsensiData.filter(d => d.id !== id);
    selectedRekapIds.delete(id);
    saveToLocalStorage();

    updateStatCards();
    renderAttendanceTable();
    updateChartData();
    if (currentPage === 'rekap') filterRekapData();
    updateRekapBulkUI();

    showToast('Data absensi berhasil dihapus', 'success');
}


// -----------------------------------------------
// 13. CRUD OPERATIONS — DATA KARYAWAN
// -----------------------------------------------

function renderKaryawanTable(data) {
    const tbody = document.getElementById('karyawan-table-body');
    const emptyState = document.getElementById('karyawan-empty');
    const countEl = document.getElementById('karyawan-count');

    if (!tbody) return;
    lastRenderedKaryawanList = data || [];
    if (countEl) countEl.textContent = data ? data.length : 0;

    if (!data || data.length === 0) {
        tbody.innerHTML = '';
        emptyState?.classList.remove('hidden');
        emptyState?.classList.add('flex');
        updateKaryawanBulkUI();
        return;
    }

    emptyState?.classList.add('hidden');
    emptyState?.classList.remove('flex');

    tbody.innerHTML = data.map((item, index) => {
        const isSelected = selectedKaryawanIds.has(item.id);
        return `
        <tr class="group hover:bg-surface-50 transition-colors ${isSelected ? 'row-selected' : ''}" id="karyawan-row-${item.id}">
            <td class="w-12 px-4 py-3.5 text-center">
                <input type="checkbox" class="table-checkbox w-4 h-4 rounded text-primary-600 border-surface-300 focus:ring-primary-500 cursor-pointer"
                    data-id="${item.id}"
                    ${isSelected ? 'checked' : ''}
                    onchange="toggleKaryawanRow('${item.id}', this.checked)" />
            </td>
            <td class="px-6 py-3.5 text-sm text-surface-400 font-medium">${index + 1}</td>
            <td class="px-6 py-3.5">
                <div class="flex items-center gap-3">
                    <div class="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-indigo-700 flex items-center justify-center text-white text-xs font-bold shadow-sm">
                        ${getInitials(item.nama)}
                    </div>
                    <span class="text-sm font-semibold text-surface-800">${escapeHtml(item.nama)}</span>
                </div>
            </td>
            <td class="px-6 py-3.5 text-sm text-surface-600 font-medium">${escapeHtml(item.jabatan || '-')}</td>
            <td class="px-6 py-3.5 text-xs text-surface-500">
                ${item.email ? `<div><i class="fa-regular fa-envelope text-surface-400 mr-1"></i>${escapeHtml(item.email)}</div>` : ''}
                ${item.telepon ? `<div class="mt-0.5"><i class="fa-solid fa-phone text-surface-400 mr-1"></i>${escapeHtml(item.telepon)}</div>` : ''}
                ${!item.email && !item.telepon ? '-' : ''}
            </td>
            <td class="px-6 py-3.5">
                <div class="flex items-center gap-1.5">
                    <button onclick="openCaberawitQRModal('${item.id}')" class="p-1.5 rounded-lg hover:bg-emerald-50 text-surface-400 hover:text-emerald-600 transition-colors" title="Lihat & Cetak QR Code">
                        <i class="fa-solid fa-qrcode text-xs"></i>
                    </button>
                    <button onclick="openEditKaryawanModal('${item.id}')" class="p-1.5 rounded-lg hover:bg-primary-50 text-surface-400 hover:text-primary-600 transition-colors" title="Edit Data">
                        <i class="fa-solid fa-pen-to-square text-xs"></i>
                    </button>
                    <button onclick="deleteKaryawan('${item.id}')" class="p-1.5 rounded-lg hover:bg-rose-50 text-surface-400 hover:text-rose-600 transition-colors" title="Hapus Data">
                        <i class="fa-solid fa-trash-can text-xs"></i>
                    </button>
                </div>
            </td>
        </tr>
    `}).join('');

    updateKaryawanBulkUI();
}

function toggleSelectAllKaryawan(master) {
    if (master.checked) {
        lastRenderedKaryawanList.forEach(k => selectedKaryawanIds.add(k.id));
    } else {
        lastRenderedKaryawanList.forEach(k => selectedKaryawanIds.delete(k.id));
    }
    renderKaryawanTable(lastRenderedKaryawanList);
}

function toggleKaryawanRow(id, isChecked) {
    if (isChecked) {
        selectedKaryawanIds.add(id);
    } else {
        selectedKaryawanIds.delete(id);
    }
    const row = document.getElementById(`karyawan-row-${id}`);
    if (row) {
        if (isChecked) row.classList.add('row-selected');
        else row.classList.remove('row-selected');
    }
    updateKaryawanBulkUI();
}

function updateKaryawanBulkUI() {
    const master = document.getElementById('karyawan-select-all');
    const visibleCount = lastRenderedKaryawanList.length;
    const selectedInVisible = lastRenderedKaryawanList.filter(k => selectedKaryawanIds.has(k.id)).length;
    const totalSelected = selectedKaryawanIds.size;

    if (master) {
        if (visibleCount > 0 && selectedInVisible === visibleCount) {
            master.checked = true;
            master.indeterminate = false;
        } else if (selectedInVisible > 0) {
            master.checked = false;
            master.indeterminate = true;
        } else {
            master.checked = false;
            master.indeterminate = false;
        }
    }

    const badge = document.getElementById('selected-karyawan-badge');
    const bulkBar = document.getElementById('karyawan-bulk-bar');
    const bulkBarCount = document.getElementById('bulk-bar-count');
    const deleteBtn = document.getElementById('btn-delete-selected-karyawan');

    if (totalSelected > 0) {
        if (badge) badge.textContent = totalSelected;
        if (bulkBarCount) bulkBarCount.textContent = totalSelected;
        if (bulkBar) {
            bulkBar.classList.remove('hidden');
            bulkBar.classList.add('flex');
        }
        if (deleteBtn) {
            deleteBtn.classList.remove('hidden');
            deleteBtn.classList.add('inline-flex');
        }
    } else {
        if (bulkBar) {
            bulkBar.classList.add('hidden');
            bulkBar.classList.remove('flex');
        }
        if (deleteBtn) {
            deleteBtn.classList.add('hidden');
            deleteBtn.classList.remove('inline-flex');
        }
    }
}

function clearKaryawanSelection() {
    selectedKaryawanIds.clear();
    renderKaryawanTable(lastRenderedKaryawanList);
}

function confirmDeleteSelectedKaryawan() {
    const count = selectedKaryawanIds.size;
    if (count === 0) {
        showToast('Pilih setidaknya 1 karyawan terlebih dahulu', 'info');
        return;
    }

    currentBulkDeleteTarget = 'karyawan';
    const titleEl = document.getElementById('bulk-modal-title');
    const msgEl = document.getElementById('bulk-modal-message');

    if (titleEl) titleEl.textContent = `Hapus ${count} Karyawan Terpilih?`;
    if (msgEl) {
        msgEl.innerHTML = `Apakah Anda yakin ingin menghapus <strong class="text-rose-600">${count} data karyawan</strong> yang dipilih dari sistem?<br><span class="text-[11px] text-surface-400 mt-2 block">Data yang dihapus akan disinkronkan secara permanen ke database.</span>`;
    }

    openModal('modal-confirm-bulk-delete');
}

async function executeDeleteSelectedKaryawan() {
    const count = selectedKaryawanIds.size;
    if (count === 0) return;

    const idsToDelete = Array.from(selectedKaryawanIds);

    if (isFirebaseConnected) {
        if (activeEngine === 'rtdb' && rtdb) {
            await Promise.all(idsToDelete.map(id => rtdb.ref(`karyawan/${id}`).remove().catch(() => {})));
        } else if (activeEngine === 'firestore' && db) {
            await Promise.all(idsToDelete.map(id => db.collection('karyawan').doc(id).delete().catch(() => {})));
        }
    }

    allKaryawanData = allKaryawanData.filter(k => !selectedKaryawanIds.has(k.id));
    selectedKaryawanIds.clear();
    saveKaryawanToLocalStorage();
    renderKaryawanTable(allKaryawanData);
    updateKaryawanDatalist();
    updateKaryawanBulkUI();

    closeModal('modal-confirm-bulk-delete');
    showToast(`Berhasil menghapus ${count} data karyawan!`, 'success');
}

async function executeCurrentBulkDelete() {
    if (currentBulkDeleteTarget === 'karyawan') {
        await executeDeleteSelectedKaryawan();
    } else if (currentBulkDeleteTarget === 'rekap') {
        await executeDeleteSelectedRekap();
    }
}


function filterKaryawanTable(query) {
    const q = (query || '').toLowerCase().trim();
    if (!q) {
        renderKaryawanTable(allKaryawanData);
        return;
    }
    const filtered = allKaryawanData.filter(k =>
        (k.nama || '').toLowerCase().includes(q) ||
        (k.jabatan || '').toLowerCase().includes(q) ||
        (k.email || '').toLowerCase().includes(q)
    );
    renderKaryawanTable(filtered);
}

function updateKaryawanDatalist() {
    const datalist = document.getElementById('karyawan-datalist');
    if (!datalist) return;
    datalist.innerHTML = allKaryawanData.map(k => `<option value="${escapeHtml(k.nama)}">${escapeHtml(k.jabatan || '')}</option>`).join('');
}

function showAddKaryawanModal() {
    document.getElementById('karyawan-form').reset();
    openModal('modal-karyawan');
}

let isSubmittingKaryawan = false;

async function handleSubmitKaryawan(event) {
    event.preventDefault();

    if (isSubmittingKaryawan) return;

    const namaInput = document.getElementById('karyawan-nama');
    const jabatanInput = document.getElementById('karyawan-jabatan');
    const emailInput = document.getElementById('karyawan-email');
    const teleponInput = document.getElementById('karyawan-telepon');
    const submitBtn = document.querySelector('#karyawan-form button[type="submit"]');

    const nama = namaInput ? namaInput.value.trim() : '';
    const jabatan = jabatanInput ? jabatanInput.value.trim() : '';
    const email = emailInput ? emailInput.value.trim() : '';
    const telepon = teleponInput ? teleponInput.value.trim() : '';

    if (!nama || !jabatan) {
        showToast('Mohon lengkapi nama dan role Caberawit!', 'error');
        return;
    }

    // Cek apakah nama peserta sudah pernah ditambahkan untuk menghindari data duplikat
    const isDuplicate = allKaryawanData.some(k => (k.nama || '').trim().toLowerCase() === nama.toLowerCase());
    if (isDuplicate) {
        showToast(`⚠️ Peserta "${nama}" sudah terdaftar sebelumnya!`, 'warning');
        return;
    }

    isSubmittingKaryawan = true;
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin text-xs"></i> Menyimpan...';
    }

    const newKaryawan = { 
        nama, 
        jabatan, 
        email, 
        telepon, 
        createdAt: Date.now() 
    };

    try {
        if (isFirebaseConnected) {
            if (activeEngine === 'rtdb' && rtdb) {
                const newRef = rtdb.ref('karyawan').push();
                newKaryawan.id = newRef.key;
                await newRef.set(newKaryawan);
            } else if (activeEngine === 'firestore' && db) {
                const docRef = await db.collection('karyawan').add(newKaryawan);
                newKaryawan.id = docRef.id;
            }
        } else {
            newKaryawan.id = 'caberawit-' + Date.now();
        }

        // Pastikan hanya masuk 1 kali ke state lokal
        if (!allKaryawanData.some(k => k.id === newKaryawan.id || (k.nama || '').trim().toLowerCase() === nama.toLowerCase())) {
            allKaryawanData.push(newKaryawan);
            allKaryawanData.sort((a, b) => (a.nama || '').localeCompare(b.nama || ''));
        }
        saveKaryawanToLocalStorage();
        renderKaryawanTable(allKaryawanData);
        updateKaryawanDatalist();
        updateQuickQRCaberawitSelect();

        // Reset form & TUTUP MODAL
        document.getElementById('karyawan-form').reset();
        closeModal('modal-karyawan');
        showToast(`✅ Data Caberawit "${nama}" berhasil disimpan!`, 'success');
    } catch (err) {
        console.error('Error saat menyimpan Caberawit:', err);
        if (!newKaryawan.id) newKaryawan.id = 'caberawit-' + Date.now();
        if (!allKaryawanData.some(k => k.id === newKaryawan.id)) {
            allKaryawanData.push(newKaryawan);
        }
        saveKaryawanToLocalStorage();
        renderKaryawanTable(allKaryawanData);
        updateKaryawanDatalist();
        updateQuickQRCaberawitSelect();

        document.getElementById('karyawan-form').reset();
        closeModal('modal-karyawan');
        showToast(`Data "${nama}" disimpan (mode lokal).`, 'info');
    } finally {
        isSubmittingKaryawan = false;
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i class="fa-solid fa-check text-xs"></i> Simpan Data Caberawit';
        }
    }
}

function openEditKaryawanModal(id) {
    const item = allKaryawanData.find(k => k.id === id);
    if (!item) return;

    document.getElementById('edit-karyawan-id').value = id;
    document.getElementById('edit-karyawan-nama').value = item.nama || '';
    document.getElementById('edit-karyawan-jabatan').value = item.jabatan || '';
    const emailEl = document.getElementById('edit-karyawan-email');
    const telEl = document.getElementById('edit-karyawan-telepon');
    if (emailEl) emailEl.value = item.email || '';
    if (telEl) telEl.value = item.telepon || '';

    openModal('modal-edit-karyawan');
}

async function handleUpdateKaryawan(event) {
    event.preventDefault();

    const id = document.getElementById('edit-karyawan-id').value;
    const updated = {
        nama: document.getElementById('edit-karyawan-nama').value.trim(),
        jabatan: document.getElementById('edit-karyawan-jabatan').value.trim(),
        email: document.getElementById('edit-karyawan-email')?.value.trim() || '',
        telepon: document.getElementById('edit-karyawan-telepon')?.value.trim() || ''
    };

    if (isFirebaseConnected) {
        if (activeEngine === 'rtdb' && rtdb) {
            rtdb.ref(`karyawan/${id}`).update(updated).catch(() => {});
        } else if (activeEngine === 'firestore' && db) {
            db.collection('karyawan').doc(id).update(updated).catch(() => {});
        }
    }

    const idx = allKaryawanData.findIndex(k => k.id === id);
    if (idx !== -1) allKaryawanData[idx] = { ...allKaryawanData[idx], ...updated };
    saveKaryawanToLocalStorage();
    renderKaryawanTable(allKaryawanData);
    updateKaryawanDatalist();

    closeModal('modal-edit-karyawan');
    showToast('Data karyawan berhasil diperbarui!', 'success');
}

async function deleteKaryawan(id) {
    const item = allKaryawanData.find(k => k.id === id);
    const nama = item ? item.nama : 'karyawan ini';

    if (!confirm(`Hapus karyawan "${nama}" dari sistem?`)) return;

    if (isFirebaseConnected) {
        if (activeEngine === 'rtdb' && rtdb) {
            rtdb.ref(`karyawan/${id}`).remove().catch(() => {});
        } else if (activeEngine === 'firestore' && db) {
            db.collection('karyawan').doc(id).delete().catch(() => {});
        }
    }

    allKaryawanData = allKaryawanData.filter(k => k.id !== id);
    selectedKaryawanIds.delete(id);
    saveKaryawanToLocalStorage();
    renderKaryawanTable(allKaryawanData);
    updateKaryawanDatalist();
    updateKaryawanBulkUI();

    showToast(`Karyawan ${nama} berhasil dihapus`, 'success');
}


// -----------------------------------------------
// 14. NAVIGATION & MODALS
// -----------------------------------------------

function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    if (!sidebar) return;

    const isOpen = !sidebar.classList.contains('-translate-x-full');
    if (isOpen) {
        sidebar.classList.add('-translate-x-full');
        overlay?.classList.add('opacity-0', 'pointer-events-none');
        overlay?.classList.remove('opacity-100', 'pointer-events-auto');
        document.body.style.overflow = '';
    } else {
        sidebar.classList.remove('-translate-x-full');
        overlay?.classList.remove('opacity-0', 'pointer-events-none');
        overlay?.classList.add('opacity-100', 'pointer-events-auto');
        document.body.style.overflow = 'hidden';
    }
}

function navigateTo(page) {
    // Jika keluar dari halaman scan, matikan stream kamera agar hemat baterai
    if (currentPage === 'scan' && page !== 'scan') {
        stopQRScanner();
    }

    currentPage = page;
    document.querySelectorAll('.page-section').forEach(s => s.classList.add('hidden'));

    const target = document.getElementById(`section-${page}`);
    if (target) {
        target.classList.remove('hidden');
        target.style.animation = 'none';
        target.offsetHeight;
        target.style.animation = '';
    }

    document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
    document.getElementById(`nav-${page}`)?.classList.add('active');

    const titles = {
        dashboard: { title: 'Dashboard', subtitle: 'Ringkasan data kehadiran hari ini' },
        absensi: { title: 'Input Absensi', subtitle: 'Tambahkan data kehadiran peserta caberawit' },
        scan: { title: 'Scan QR Absensi', subtitle: 'Pindai barcode QR untuk absensi otomatis (Mobile & Desktop)' },
        rekap: { title: 'Rekap Data', subtitle: 'Filter dan kelola data absensi' },
        karyawan: { title: 'Data Caberawit', subtitle: 'Kelola data peserta caberawit terdaftar' },
        jurnal: { title: 'Jurnal Guru & KBM', subtitle: 'Catatan kegiatan belajar mengajar harian' },
        pengaturan: { title: 'Pengaturan', subtitle: 'Konfigurasi sistem & database absensi' }
    };

    const info = titles[page] || titles.dashboard;
    document.getElementById('page-title').textContent = info.title;
    document.getElementById('page-subtitle').textContent = info.subtitle;

    if (page === 'scan') {
        initQRScannerPage();
    } else if (page === 'rekap') {
        filterRekapData();
    } else if (page === 'karyawan') {
        renderKaryawanTable(allKaryawanData);
    } else if (page === 'jurnal') {
        renderJurnalData();
    }

    const sidebar = document.getElementById('sidebar');
    if (window.innerWidth < 1024 && sidebar && !sidebar.classList.contains('-translate-x-full')) {
        toggleSidebar();
    }
}

function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.remove('hidden');
        modal.classList.add('modal-open');
        document.body.style.overflow = 'hidden';
    }
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('modal-open');
        document.body.style.overflow = '';
    }
}

function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const icons = { success: 'fa-solid fa-check', error: 'fa-solid fa-xmark', info: 'fa-solid fa-circle-info' };
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
        <div class="toast-icon"><i class="${icons[type] || icons.info} text-sm"></i></div>
        <span class="flex-1">${escapeHtml(message)}</span>
        <button onclick="this.closest('.toast').classList.add('toast-exit'); setTimeout(() => this.closest('.toast')?.remove(), 300);" class="p-1 rounded hover:bg-surface-100 text-surface-400 transition-colors flex-shrink-0">
            <i class="fa-solid fa-xmark text-xs"></i>
        </button>
    `;
    container.appendChild(toast);
    setTimeout(() => {
        toast.classList.add('toast-exit');
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}


// -----------------------------------------------
// 15. UTILITIES
// -----------------------------------------------

function setCurrentDate() {
    const el = document.getElementById('current-date');
    if (el) {
        const today = new Date();
        el.textContent = today.toLocaleDateString('id-ID', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    }
}

function setDefaultFormDate() {
    const dateInput = document.getElementById('input-tanggal');
    const timeInput = document.getElementById('input-jam');
    const now = new Date();
    if (dateInput) dateInput.value = formatDateISO(now);
    if (timeInput) timeInput.value = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

function formatDateISO(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function formatDateShort(date) {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
    return `${date.getDate()} ${months[date.getMonth()]}`;
}

function formatDateDisplay(dateStr) {
    if (!dateStr) return '-';
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
    const parts = dateStr.split('-');
    if (parts.length !== 3) return dateStr;
    return `${parseInt(parts[2])} ${months[parseInt(parts[1]) - 1]} ${parts[0]}`;
}

function getInitials(name) {
    if (!name) return '?';
    const parts = name.trim().split(' ');
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return name.substring(0, 2).toUpperCase();
}

function getStatusIcon(status) {
    const icons = { 'Hadir': '✅', 'Izin': '📋', 'Sakit': '🏥', 'Alpa': '❌' };
    return icons[status] || '•';
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatCurrentTime() {
    const now = new Date();
    return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}


// -----------------------------------------------
// 17. QR CODE SCANNER & ATTENDANCE SYSTEM (MOBILE & DESKTOP)
// -----------------------------------------------

async function initQRScannerPage() {
    updateLiveClock();
    if (!liveClockInterval) {
        liveClockInterval = setInterval(updateLiveClock, 1000);
    }

    renderRecentScansFeed();
    updateQuickQRCaberawitSelect();

    // Deteksi daftar kamera yang tersedia di perangkat (Webcam Desktop / Kamera Mobile)
    try {
        if (typeof Html5Qrcode !== 'undefined') {
            const devices = await Html5Qrcode.getCameras();
            availableCameras = devices || [];
            const selectEl = document.getElementById('select-camera-device');
            if (selectEl) {
                selectEl.innerHTML = '';
                if (devices && devices.length > 0) {
                    devices.forEach((device, idx) => {
                        const opt = document.createElement('option');
                        opt.value = device.id;
                        opt.textContent = device.label || `Kamera ${idx + 1}`;
                        selectEl.appendChild(opt);
                    });
                    if (!selectedCameraId) {
                        selectedCameraId = devices[0].id;
                    }
                    selectEl.value = selectedCameraId;
                } else {
                    const opt = document.createElement('option');
                    opt.value = '';
                    opt.textContent = 'Kamera Default';
                    selectEl.appendChild(opt);
                }
            }
        }
    } catch (err) {
        console.warn('Deteksi kamera info:', err);
    }

    // Jalankan kamera scanner secara otomatis jika belum berjalan
    if (!isScannerRunning) {
        startQRScanner();
    }
}

async function startQRScanner() {
    if (typeof Html5Qrcode === 'undefined') {
        showToast('Library pemindai QR belum siap.', 'error');
        return;
    }

    const placeholder = document.getElementById('scanner-placeholder');
    const overlay = document.getElementById('scanner-overlay');
    const statusBadge = document.getElementById('scanner-status-badge');
    const btnToggle = document.getElementById('btn-toggle-camera');

    try {
        if (!html5QrScanner) {
            html5QrScanner = new Html5Qrcode("qr-reader");
        }

        if (statusBadge) {
            statusBadge.textContent = 'Mengaktifkan kamera...';
            statusBadge.className = 'text-xs font-semibold text-blue-600 animate-pulse';
        }

        const qrConfig = {
            fps: 15,
            qrbox: function(viewfinderWidth, viewfinderHeight) {
                const minEdge = Math.min(viewfinderWidth, viewfinderHeight);
                const boxSize = Math.max(180, Math.floor(minEdge * 0.72));
                return { width: boxSize, height: boxSize };
            },
            aspectRatio: 1.0
        };

        const cameraConfig = selectedCameraId 
            ? selectedCameraId 
            : { facingMode: currentFacingMode };

        await html5QrScanner.start(
            cameraConfig,
            qrConfig,
            onQRScanSuccess,
            onQRScanError
        );

        isScannerRunning = true;
        if (placeholder) placeholder.classList.add('hidden');
        if (overlay) overlay.classList.remove('hidden');
        if (statusBadge) {
            statusBadge.textContent = 'Memindai...';
            statusBadge.className = 'text-xs font-semibold text-emerald-600 animate-pulse';
        }
        if (btnToggle) {
            btnToggle.innerHTML = '<i class="fa-solid fa-stop"></i><span>Hentikan Kamera</span>';
            btnToggle.className = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-rose-50 text-rose-600 border border-rose-200 hover:bg-rose-100 transition-colors shadow-sm';
        }
    } catch (err) {
        console.warn('Kamera scanner start warning:', err);
        isScannerRunning = false;
        if (placeholder) placeholder.classList.remove('hidden');
        if (overlay) overlay.classList.add('hidden');
        if (statusBadge) {
            statusBadge.textContent = 'Kamera Dimatikan / Butuh Izin';
            statusBadge.className = 'text-xs font-semibold text-surface-400';
        }
        if (btnToggle) {
            btnToggle.innerHTML = '<i class="fa-solid fa-play"></i><span>Nyalakan Kamera</span>';
            btnToggle.className = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-emerald-50 text-emerald-600 border border-emerald-200 hover:bg-emerald-100 transition-colors shadow-sm';
        }
    }
}

async function stopQRScanner() {
    if (html5QrScanner && isScannerRunning) {
        try {
            await html5QrScanner.stop();
        } catch (e) {
            console.warn('Stop QR scanner warning:', e);
        }
    }
    isScannerRunning = false;

    const placeholder = document.getElementById('scanner-placeholder');
    const overlay = document.getElementById('scanner-overlay');
    const statusBadge = document.getElementById('scanner-status-badge');
    const btnToggle = document.getElementById('btn-toggle-camera');

    if (placeholder) placeholder.classList.remove('hidden');
    if (overlay) overlay.classList.add('hidden');
    if (statusBadge) {
        statusBadge.textContent = 'Kamera Dimatikan';
        statusBadge.className = 'text-xs font-semibold text-surface-400';
    }
    if (btnToggle) {
        btnToggle.innerHTML = '<i class="fa-solid fa-play"></i><span>Nyalakan Kamera</span>';
        btnToggle.className = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-emerald-50 text-emerald-600 border border-emerald-200 hover:bg-emerald-100 transition-colors shadow-sm';
    }
}

async function toggleQRScanner() {
    if (isScannerRunning) {
        await stopQRScanner();
    } else {
        await startQRScanner();
    }
}

async function switchCameraFacing() {
    currentFacingMode = (currentFacingMode === 'environment') ? 'user' : 'environment';
    selectedCameraId = null;
    if (isScannerRunning) {
        await stopQRScanner();
        await startQRScanner();
    }
    showToast(`Mengalihkan lensa (${currentFacingMode === 'environment' ? 'Belakang' : 'Depan'})...`, 'info');
}

async function onCameraDeviceSelected(cameraId) {
    selectedCameraId = cameraId;
    if (isScannerRunning) {
        await stopQRScanner();
        await startQRScanner();
    }
}

function toggleScanSound() {
    scanSoundEnabled = !scanSoundEnabled;
    const icon = document.getElementById('sound-icon');
    const text = document.getElementById('sound-text');
    if (icon) {
        icon.className = scanSoundEnabled ? 'fa-solid fa-volume-high' : 'fa-solid fa-volume-xmark';
    }
    if (text) {
        text.textContent = scanSoundEnabled ? 'Suara Aktif' : 'Suara Hening';
    }
    showToast(scanSoundEnabled ? 'Suara scanner diaktifkan' : 'Suara scanner dimatikan', 'info');
}

function playScanBeep(type = 'success') {
    if (!scanSoundEnabled) return;
    try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = new AudioCtx();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);

        if (type === 'success') {
            osc.type = 'sine';
            osc.frequency.setValueAtTime(880, ctx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.12);
            gain.gain.setValueAtTime(0.28, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.22);
            osc.start();
            osc.stop(ctx.currentTime + 0.22);
        } else {
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(440, ctx.currentTime);
            gain.gain.setValueAtTime(0.25, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.28);
            osc.start();
            osc.stop(ctx.currentTime + 0.28);
        }
    } catch (e) {}
}

function updateScanFeedback(type, title, desc, badgeText) {
    const box = document.getElementById('scan-feedback-box');
    const icon = document.getElementById('scan-feedback-icon');
    const titleEl = document.getElementById('scan-feedback-title');
    const descEl = document.getElementById('scan-feedback-desc');
    const badgeEl = document.getElementById('scan-feedback-badge');

    if (titleEl) titleEl.textContent = title;
    if (descEl) descEl.textContent = desc;

    if (badgeEl) {
        if (badgeText) {
            badgeEl.textContent = badgeText;
            badgeEl.classList.remove('hidden');
        } else {
            badgeEl.classList.add('hidden');
        }
    }

    if (box && icon && badgeEl) {
        if (type === 'success') {
            box.className = 'p-4 mx-6 mb-6 rounded-2xl bg-emerald-50/90 border border-emerald-200 transition-all duration-300 ring-2 ring-emerald-500/20';
            icon.className = 'w-10 h-10 rounded-xl bg-emerald-500 text-white flex items-center justify-center text-lg shrink-0 shadow-sm';
            icon.innerHTML = '<i class="fa-solid fa-check"></i>';
            badgeEl.className = 'px-2.5 py-1 rounded-lg text-xs font-bold bg-emerald-100 text-emerald-800';
        } else if (type === 'warning') {
            box.className = 'p-4 mx-6 mb-6 rounded-2xl bg-amber-50/90 border border-amber-200 transition-all duration-300 ring-2 ring-amber-500/20';
            icon.className = 'w-10 h-10 rounded-xl bg-amber-500 text-white flex items-center justify-center text-lg shrink-0 shadow-sm';
            icon.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i>';
            badgeEl.className = 'px-2.5 py-1 rounded-lg text-xs font-bold bg-amber-100 text-amber-800';
        } else {
            box.className = 'p-4 mx-6 mb-6 rounded-2xl bg-surface-50 border border-surface-200 transition-all duration-300';
            icon.className = 'w-10 h-10 rounded-xl bg-surface-200 text-surface-600 flex items-center justify-center text-lg shrink-0';
            icon.innerHTML = '<i class="fa-solid fa-qrcode"></i>';
            badgeEl.classList.add('hidden');
        }
    }
}

function onQRScanError(errorMessage) {
    // Normal frame scanner misses are handled quietly without clogging UI
}

function onQRScanSuccess(decodedText, decodedResult) {
    const now = Date.now();
    if (lastScannedText === decodedText && (now - lastScanTimestamp) < SCAN_COOLDOWN_MS) {
        return;
    }
    lastScannedText = decodedText;
    lastScanTimestamp = now;

    processAttendanceScan(decodedText);
}

function parseScannedQR(text) {
    if (!text || typeof text !== 'string') return null;
    const trimmed = text.trim();
    let nama = '';
    let role = '';
    let caberawitId = '';

    // Coba parsing JSON format aplikasi
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
        try {
            const parsed = JSON.parse(trimmed);
            if (parsed.nama) nama = parsed.nama;
            if (parsed.role || parsed.jabatan) role = parsed.role || parsed.jabatan;
            if (parsed.id) caberawitId = parsed.id;
        } catch (e) {}
    }

    // Jika bukan JSON atau tidak ada nama, coba cocokan dengan ID atau Nama di allKaryawanData
    if (!nama) {
        const matchedById = allKaryawanData.find(k => k.id === trimmed);
        if (matchedById) {
            nama = matchedById.nama;
            role = matchedById.jabatan;
            caberawitId = matchedById.id;
        } else {
            const matchedByName = allKaryawanData.find(k => (k.nama || '').trim().toLowerCase() === trimmed.toLowerCase());
            if (matchedByName) {
                nama = matchedByName.nama;
                role = matchedByName.jabatan;
                caberawitId = matchedByName.id;
            } else {
                nama = trimmed;
            }
        }
    }

    return { nama, role, caberawitId };
}

async function processAttendanceScan(rawText) {
    const parsed = parseScannedQR(rawText);
    if (!parsed || !parsed.nama) {
        playScanBeep('warning');
        updateScanFeedback('warning', 'Format QR Tidak Dikenal', 'QR Code tidak memuat identitas atau nama yang valid.', 'Gagal');
        return;
    }

    const { nama, role } = parsed;
    const today = formatDateISO(new Date());
    const nowTime = formatCurrentTime();

    // Cek apakah peserta sudah hadir hari ini
    const alreadyAttended = allAbsensiData.some(item => 
        (item.nama || '').trim().toLowerCase() === nama.trim().toLowerCase() && 
        item.tanggal === today
    );

    if (alreadyAttended) {
        playScanBeep('warning');
        updateScanFeedback('warning', `${nama} Sudah Hadir`, `Telah tercatat absensi hari ini pada tanggal ${today}.`, 'Duplikat');
        showToast(`⚠️ ${nama} sudah tercatat hadir hari ini!`, 'warning');
        return;
    }

    // Buat data absensi baru
    const recordId = `abs_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const newRecord = {
        id: recordId,
        nama: nama,
        tanggal: today,
        jam: nowTime,
        status: 'Hadir',
        keterangan: 'Absensi via Barcode QR Scanner',
        timestamp: Date.now()
    };

    // Sinkronisasi otomatis ke Firebase (Realtime Database atau Firestore)
    try {
        if (isFirebaseConnected) {
            if (activeEngine === 'rtdb' && rtdb) {
                await rtdb.ref(`absensi/${recordId}`).set(newRecord);
            } else if (activeEngine === 'firestore' && db) {
                await db.collection('absensi').doc(recordId).set(newRecord);
            }
        }
    } catch (err) {
        console.warn('Firebase attendance sync warning:', err);
    }

    // Simpan ke state lokal & localStorage
    allAbsensiData.unshift(newRecord);
    saveToLocalStorage();

    // Jika peserta belum ada di daftar Caberawit, otomatis daftarkan ke master Caberawit
    const existsInRoster = allKaryawanData.some(k => (k.nama || '').trim().toLowerCase() === nama.trim().toLowerCase());
    if (!existsInRoster) {
        const newCaberawit = {
            id: parsed.caberawitId || `caberawit_${Date.now()}`,
            nama: nama,
            jabatan: role || 'Peserta Caberawit',
            email: '',
            telepon: ''
        };
        allKaryawanData.push(newCaberawit);
        saveKaryawanToLocalStorage();
        if (isFirebaseConnected) {
            if (activeEngine === 'rtdb' && rtdb) {
                rtdb.ref(`karyawan/${newCaberawit.id}`).set(newCaberawit).catch(() => {});
            } else if (activeEngine === 'firestore' && db) {
                db.collection('karyawan').doc(newCaberawit.id).set(newCaberawit).catch(() => {});
            }
        }
        renderKaryawanTable(allKaryawanData);
        updateKaryawanDatalist();
        updateQuickQRCaberawitSelect();
    }

    // Bunyikan chime & tampilkan feedback
    playScanBeep('success');
    updateScanFeedback('success', `${nama} — BERHASIL!`, `Status: Hadir • Waktu: ${nowTime} WIB`, 'Tersimpan ke Cloud');
    showToast(`✅ Absensi berhasil: ${nama} (${nowTime})`, 'success');

    // Perbarui counter dan tampilan tabel
    updateStatCards();
    renderAttendanceTable();
    updateChartData();
    renderRecentScansFeed();
    if (currentPage === 'rekap') filterRekapData();
}

async function handleQRImageUpload(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;

    if (typeof Html5Qrcode === 'undefined') {
        showToast('Library pemindai QR belum siap.', 'error');
        return;
    }

    try {
        showToast('Memproses berkas gambar QR Code...', 'info');
        const scanner = new Html5Qrcode("qr-reader");
        const decodedResult = await scanner.scanFile(file, true);
        await processAttendanceScan(decodedResult);
        event.target.value = '';
    } catch (err) {
        console.warn('QR File Scan Error:', err);
        playScanBeep('warning');
        updateScanFeedback('warning', 'Gagal Membaca QR', 'Gambar tidak memuat QR Code yang terbaca jelas.', 'Gagal');
        showToast('Tidak dapat membaca QR Code dari berkas yang dipilih. Pastikan gambar jelas.', 'warning');
        event.target.value = '';
    }
}

function updateLiveClock() {
    const clockEl = document.getElementById('scan-live-clock');
    const dateEl = document.getElementById('scan-live-date');
    if (!clockEl && !dateEl) return;

    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');

    if (clockEl) clockEl.textContent = `${hours}:${minutes}:${seconds} WIB`;
    if (dateEl) {
        const days = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
        dateEl.textContent = `${days[now.getDay()]}, ${now.getDate()} ${months[now.getMonth()]} ${now.getFullYear()}`;
    }
}

function renderRecentScansFeed() {
    const container = document.getElementById('today-scans-feed');
    const countEl = document.getElementById('qr-scanned-count');
    if (!container) return;

    const today = formatDateISO(new Date());
    const todayList = allAbsensiData.filter(d => d.tanggal === today);
    if (countEl) countEl.textContent = todayList.length;

    if (todayList.length === 0) {
        container.innerHTML = `
            <div class="text-center py-8 text-surface-400 text-xs">
                <i class="fa-solid fa-clipboard-user text-2xl mb-2 text-surface-300"></i>
                <p>Belum ada yang scan hari ini.</p>
            </div>
        `;
        return;
    }

    container.innerHTML = todayList.slice(0, 15).map(item => `
        <div class="flex items-center justify-between p-3 rounded-xl bg-surface-50 border border-surface-100 hover:bg-emerald-50/40 transition-colors">
            <div class="flex items-center gap-3 min-w-0">
                <div class="w-8 h-8 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-xs font-bold shrink-0">
                    ${getInitials(item.nama)}
                </div>
                <div class="min-w-0">
                    <p class="text-xs font-bold text-surface-800 truncate">${escapeHtml(item.nama)}</p>
                    <p class="text-[11px] text-surface-400">${escapeHtml(item.jam || '--:--')} WIB • <span class="text-emerald-600 font-medium">${escapeHtml(item.status)}</span></p>
                </div>
            </div>
            <span class="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-700 shrink-0">
                ${escapeHtml(item.status)}
            </span>
        </div>
    `).join('');
}

function updateQuickQRCaberawitSelect() {
    const select = document.getElementById('quick-qr-caberawit-select');
    if (!select) return;

    const previousVal = select.value;
    select.innerHTML = '<option value="">-- Pilih Peserta Caberawit --</option>';

    allKaryawanData.forEach(item => {
        const opt = document.createElement('option');
        opt.value = item.id;
        opt.textContent = `${item.nama} (${item.jabatan || 'Caberawit'})`;
        select.appendChild(opt);
    });

    if (allKaryawanData.length > 0) {
        if (previousVal && allKaryawanData.some(k => k.id === previousVal)) {
            select.value = previousVal;
            renderQuickBadgePreview(previousVal);
        } else {
            select.value = allKaryawanData[0].id;
            renderQuickBadgePreview(allKaryawanData[0].id);
        }
    } else {
        const previewEl = document.getElementById('quick-badge-preview');
        const nameEl = document.getElementById('quick-badge-nama');
        const roleEl = document.getElementById('quick-badge-role');
        const qrWrapper = document.getElementById('quick-badge-qr');
        if (nameEl) nameEl.textContent = 'Belum Ada Caberawit';
        if (roleEl) roleEl.textContent = 'Tambahkan di Data Caberawit';
        if (qrWrapper) qrWrapper.innerHTML = '<div class="text-xs text-surface-400 py-6">QR Code akan muncul di sini</div>';
    }
}

function onQuickQRCaberawitChange(id) {
    if (!id) return;
    renderQuickBadgePreview(id);
}

function generateQRCodeInto(container, item, size = 180) {
    if (!container || !item) return;
    container.innerHTML = '';

    const qrPayload = JSON.stringify({
        app: "absensiku",
        id: item.id,
        nama: item.nama,
        role: item.jabatan || 'Caberawit'
    });

    let rendered = false;

    // 1. Coba render menggunakan library QRCode (qrcodejs)
    if (typeof QRCode !== 'undefined') {
        try {
            new QRCode(container, {
                text: qrPayload,
                width: size,
                height: size,
                colorDark: "#0f172a",
                colorLight: "#ffffff",
                correctLevel: QRCode.CorrectLevel.M
            });
            rendered = true;
        } catch (err) {
            console.warn('QRCode render exception, using fallback:', err);
            container.innerHTML = '';
        }
    }

    // 2. Fallback otomatis: jika library tidak tersedia / error, gunakan QR image API
    if (!rendered) {
        const encoded = encodeURIComponent(qrPayload);
        const img = document.createElement('img');
        img.crossOrigin = 'anonymous';
        img.alt = `QR Code ${item.nama}`;
        img.className = 'w-[180px] h-[180px] object-contain rounded-lg mx-auto shadow-xs';
        img.src = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&margin=10&data=${encoded}`;
        container.appendChild(img);
    }
}

function renderQuickBadgePreview(id) {
    const item = allKaryawanData.find(k => k.id === id);
    if (!item) return;

    currentSelectedQRItem = item;
    const nameEl = document.getElementById('quick-badge-nama');
    const roleEl = document.getElementById('quick-badge-role');
    const wrapper = document.getElementById('quick-badge-qr');

    if (nameEl) nameEl.textContent = item.nama;
    if (roleEl) roleEl.textContent = item.jabatan || 'Peserta Caberawit';

    if (wrapper) {
        generateQRCodeInto(wrapper, item, 140);
    }
}

function openCaberawitQRModal(id) {
    const item = allKaryawanData.find(k => k.id === id);
    if (!item) {
        showToast('Data peserta tidak ditemukan.', 'error');
        return;
    }

    currentSelectedQRItem = item;
    const nameEl = document.getElementById('modal-qr-nama');
    const roleEl = document.getElementById('modal-qr-role');
    const idEl = document.getElementById('modal-qr-id');
    const avatarEl = document.getElementById('modal-qr-avatar');
    const container = document.getElementById('modal-qr-code-container') || document.getElementById('modal-qr-canvas-wrapper');

    if (nameEl) nameEl.textContent = item.nama;
    if (roleEl) roleEl.textContent = item.jabatan || 'Peserta Caberawit';
    if (idEl) idEl.textContent = `ID: ${item.id}`;
    if (avatarEl) avatarEl.textContent = getInitials(item.nama);

    if (container) {
        generateQRCodeInto(container, item, 180);
    }

    openModal('modal-caberawit-qr');
}

async function downloadModalBadgePNG() {
    if (!currentSelectedQRItem) {
        showToast('Pilih data peserta terlebih dahulu.', 'warning');
        return;
    }

    const item = currentSelectedQRItem;
    const container = document.getElementById('modal-qr-code-container') || document.getElementById('modal-qr-canvas-wrapper');
    if (!container) {
        showToast('Elemen QR Code tidak ditemukan.', 'error');
        return;
    }

    showToast('Menyiapkan berkas kartu QR...', 'info');

    try {
        const qrCanvas = container.querySelector('canvas');
        const qrImg = container.querySelector('img');

        let qrSource = null;
        if (qrCanvas) {
            qrSource = qrCanvas;
        } else if (qrImg && qrImg.src) {
            qrSource = await new Promise((resolve, reject) => {
                const img = new Image();
                img.crossOrigin = 'anonymous';
                img.onload = () => resolve(img);
                img.onerror = () => reject(new Error('Gagal memuat gambar QR'));
                img.src = qrImg.src;
            });
        }

        if (!qrSource) {
            showToast('QR Code belum siap untuk diunduh.', 'error');
            return;
        }

        // Render Kartu Tanda Pengenal (ID Badge) resolusi tinggi 500x680 px
        const cardCanvas = document.createElement('canvas');
        const ctx = cardCanvas.getContext('2d');
        const width = 500;
        const height = 680;
        cardCanvas.width = width;
        cardCanvas.height = height;

        // Background putih bersih
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);

        // Header Indigo
        const grad = ctx.createLinearGradient(0, 0, width, 0);
        grad.addColorStop(0, '#4338ca');
        grad.addColorStop(1, '#6366f1');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, width, 130);

        // Header Title
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 22px Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('KARTU ABSENSI CABERAWIT', width / 2, 52);

        ctx.font = '13px Arial, sans-serif';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
        ctx.fillText('Absensi Digital Real-time • AbsensiKu', width / 2, 78);

        // Avatar Bulat
        ctx.beginPath();
        ctx.arc(width / 2, 130, 40, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.lineWidth = 4;
        ctx.strokeStyle = '#e0e7ff';
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(width / 2, 130, 36, 0, Math.PI * 2);
        ctx.fillStyle = '#4f46e5';
        ctx.fill();

        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 24px Arial, sans-serif';
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'center';
        ctx.fillText(getInitials(item.nama), width / 2, 130);

        // Nama Lengkap Peserta
        ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = '#0f172a';
        ctx.font = 'bold 22px Arial, sans-serif';
        let namaDisplay = item.nama;
        if (namaDisplay.length > 26) {
            namaDisplay = namaDisplay.substring(0, 24) + '...';
        }
        ctx.fillText(namaDisplay, width / 2, 210);

        // Role / Kelompok
        ctx.fillStyle = '#4f46e5';
        ctx.font = 'bold 15px Arial, sans-serif';
        ctx.fillText(item.jabatan || 'Peserta Caberawit', width / 2, 238);

        // ID Unik
        ctx.fillStyle = '#64748b';
        ctx.font = '13px monospace';
        ctx.fillText(`ID: ${item.id}`, width / 2, 262);

        // Box QR Code di tengah
        const boxSize = 270;
        const boxX = (width - boxSize) / 2;
        const boxY = 285;

        ctx.fillStyle = '#f8fafc';
        ctx.strokeStyle = '#e2e8f0';
        ctx.lineWidth = 2;
        if (ctx.roundRect) {
            ctx.beginPath();
            ctx.roundRect(boxX, boxY, boxSize, boxSize, 18);
            ctx.fill();
            ctx.stroke();
        } else {
            ctx.fillRect(boxX, boxY, boxSize, boxSize);
            ctx.strokeRect(boxX, boxY, boxSize, boxSize);
        }

        // Gambar QR Code di tengah box
        const pad = 18;
        ctx.drawImage(qrSource, boxX + pad, boxY + pad, boxSize - (pad * 2), boxSize - (pad * 2));

        // Teks instruksi di bawah
        ctx.fillStyle = '#64748b';
        ctx.font = '13px Arial, sans-serif';
        ctx.fillText('Pindai barcode ini ke kamera scanner untuk absensi', width / 2, 595);

        // Border luar kartu
        ctx.strokeStyle = '#cbd5e1';
        ctx.lineWidth = 2;
        ctx.strokeRect(1, 1, width - 2, height - 2);

        // Trigger Download
        const cleanName = (item.nama || 'Caberawit').replace(/[^a-zA-Z0-9_-]/g, '_');
        const link = document.createElement('a');
        link.download = `QR-Badge-${cleanName}.png`;
        link.href = cardCanvas.toDataURL('image/png');
        link.click();

        showToast(`✅ Kartu QR "${item.nama}" berhasil diunduh!`, 'success');
    } catch (err) {
        console.error('Download QR Error:', err);
        const rawCanvas = container.querySelector('canvas');
        if (rawCanvas) {
            const cleanName = (item.nama || 'Caberawit').replace(/[^a-zA-Z0-9_-]/g, '_');
            const link = document.createElement('a');
            link.download = `QR-${cleanName}.png`;
            link.href = rawCanvas.toDataURL('image/png');
            link.click();
            showToast('QR Code berhasil diunduh!', 'success');
        } else {
            showToast('Gagal memproses unduhan kartu QR.', 'error');
        }
    }
}

function printModalBadge() {
    window.print();
}

// Aliases for compatibility
const downloadQRCodePNG = downloadModalBadgePNG;
const printCaberawitQR = printModalBadge;
const downloadQuickBadgePNG = downloadModalBadgePNG;
const printQuickBadge = printModalBadge;


// -----------------------------------------------
// 20. JURNAL GURU & KBM — Full CRUD Module
// -----------------------------------------------

let allJurnalData = [];
let filteredJurnalData = [];
let pendingDeleteJurnalId = null;

// --- INITIALIZATION & DATA LOADING ---

function initJurnalModule() {
    loadJurnalFromLocalStorage();
    if (activeEngine === 'rtdb' && rtdb) {
        setupJurnalRtdbListener();
    } else if (activeEngine === 'firestore' && db) {
        setupJurnalFirestoreListener();
    }
    renderJurnalData();
}

function setupJurnalRtdbListener() {
    if (!rtdb) return;
    rtdb.ref('jurnal').on('value', (snapshot) => {
        const val = snapshot.val();
        if (val) {
            allJurnalData = Object.entries(val)
                .map(([id, item]) => ({ id, ...item }))
                .sort((a, b) => {
                    const tA = Number(a.timestamp) || new Date(`${a.tanggal} ${a.jam || '00:00'}`).getTime() || 0;
                    const tB = Number(b.timestamp) || new Date(`${b.tanggal} ${b.jam || '00:00'}`).getTime() || 0;
                    return tB - tA;
                });
        } else {
            allJurnalData = [];
        }
        saveJurnalToLocalStorage();
        renderJurnalData();
    });
}

function setupJurnalFirestoreListener() {
    if (!db) return;
    db.collection('jurnal').onSnapshot((snapshot) => {
        if (!snapshot.empty) {
            allJurnalData = [];
            snapshot.forEach(doc => {
                allJurnalData.push({ id: doc.id, ...doc.data() });
            });
            allJurnalData.sort((a, b) => (Number(b.timestamp) || 0) - (Number(a.timestamp) || 0));
        } else {
            allJurnalData = [];
        }
        saveJurnalToLocalStorage();
        renderJurnalData();
    });
}

function saveJurnalToLocalStorage() {
    try {
        localStorage.setItem('absensiku_jurnal', JSON.stringify(allJurnalData));
    } catch (e) {}
}

function loadJurnalFromLocalStorage() {
    try {
        const data = localStorage.getItem('absensiku_jurnal');
        if (data) {
            allJurnalData = JSON.parse(data);
        }
    } catch (e) {}
}

// --- MODAL HANDLERS ---

function openAddJurnalModal() {
    document.getElementById('jurnal-edit-id').value = '';
    document.getElementById('jurnal-form').reset();
    document.getElementById('jurnal-modal-title').textContent = 'Catat Jurnal KBM';
    document.getElementById('jurnal-submit-text').textContent = 'Simpan Jurnal KBM';

    // Set default date and time
    const now = new Date();
    document.getElementById('jurnal-tanggal').value = formatDateISO(now);
    document.getElementById('jurnal-jam').value = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    openModal('modal-jurnal');
}

function openEditJurnalModal(id) {
    const item = allJurnalData.find(j => j.id === id);
    if (!item) return;

    document.getElementById('jurnal-edit-id').value = id;
    document.getElementById('jurnal-modal-title').textContent = 'Edit Jurnal KBM';
    document.getElementById('jurnal-submit-text').textContent = 'Perbarui Jurnal';

    document.getElementById('jurnal-guru').value = item.guru || '';
    document.getElementById('jurnal-tanggal').value = item.tanggal || '';
    document.getElementById('jurnal-jam').value = item.jam || '';
    document.getElementById('jurnal-kelas').value = item.kelas || '';
    document.getElementById('jurnal-mapel').value = item.mapel || '';
    document.getElementById('jurnal-materi').value = item.materi || '';
    document.getElementById('jurnal-kegiatan').value = item.kegiatan || '';
    document.getElementById('jurnal-hadir').value = item.hadir || '';
    document.getElementById('jurnal-tidak-hadir').value = item.tidakHadir || '';
    document.getElementById('jurnal-catatan').value = item.catatan || '';

    openModal('modal-jurnal');
}

function showJurnalDetail(id) {
    const item = allJurnalData.find(j => j.id === id);
    if (!item) return;

    const tanggalFormatted = item.tanggal ? new Date(item.tanggal + 'T00:00:00').toLocaleDateString('id-ID', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    }) : '-';

    const totalSantri = (parseInt(item.hadir) || 0) + (parseInt(item.tidakHadir) || 0);
    const pctHadir = totalSantri > 0 ? Math.round(((parseInt(item.hadir) || 0) / totalSantri) * 100) : 0;

    const container = document.getElementById('jurnal-detail-content');
    container.innerHTML = `
        <div class="bg-gradient-to-br from-primary-50 to-indigo-50 rounded-2xl p-4 border border-primary-100">
            <div class="flex items-center gap-3 mb-3">
                <div class="w-10 h-10 rounded-xl bg-gradient-to-br from-primary-500 to-primary-700 flex items-center justify-center text-white shadow-md">
                    <i class="fa-solid fa-chalkboard-user text-sm"></i>
                </div>
                <div>
                    <p class="text-sm font-bold text-surface-900">${escapeHtml(item.guru || '-')}</p>
                    <p class="text-[11px] text-surface-500">${tanggalFormatted} • ${escapeHtml(item.jam || '-')} WIB</p>
                </div>
            </div>
        </div>

        <div class="grid grid-cols-2 gap-3">
            <div class="bg-surface-50 rounded-xl p-3 border border-surface-100">
                <p class="text-[10px] text-surface-400 font-semibold uppercase mb-0.5">Kelas</p>
                <p class="text-xs font-bold text-surface-800">${escapeHtml(item.kelas || '-')}</p>
            </div>
            <div class="bg-surface-50 rounded-xl p-3 border border-surface-100">
                <p class="text-[10px] text-surface-400 font-semibold uppercase mb-0.5">Mata Pelajaran</p>
                <p class="text-xs font-bold text-surface-800">${escapeHtml(item.mapel || '-')}</p>
            </div>
        </div>

        <div class="bg-surface-50 rounded-xl p-3 border border-surface-100">
            <p class="text-[10px] text-surface-400 font-semibold uppercase mb-1">
                <i class="fa-solid fa-file-lines text-primary-400 mr-0.5"></i> Materi Pokok
            </p>
            <p class="text-xs text-surface-800 leading-relaxed">${escapeHtml(item.materi || '-')}</p>
        </div>

        ${item.kegiatan ? `
        <div class="bg-surface-50 rounded-xl p-3 border border-surface-100">
            <p class="text-[10px] text-surface-400 font-semibold uppercase mb-1">
                <i class="fa-solid fa-pen-clip text-primary-400 mr-0.5"></i> Kegiatan
            </p>
            <p class="text-xs text-surface-800 leading-relaxed">${escapeHtml(item.kegiatan)}</p>
        </div>` : ''}

        <div class="grid grid-cols-3 gap-2">
            <div class="bg-emerald-50 rounded-xl p-3 text-center border border-emerald-100">
                <p class="text-lg font-extrabold text-emerald-600">${item.hadir || 0}</p>
                <p class="text-[10px] font-semibold text-emerald-600/70">Hadir</p>
            </div>
            <div class="bg-rose-50 rounded-xl p-3 text-center border border-rose-100">
                <p class="text-lg font-extrabold text-rose-600">${item.tidakHadir || 0}</p>
                <p class="text-[10px] font-semibold text-rose-600/70">Absen</p>
            </div>
            <div class="bg-primary-50 rounded-xl p-3 text-center border border-primary-100">
                <p class="text-lg font-extrabold text-primary-600">${pctHadir}%</p>
                <p class="text-[10px] font-semibold text-primary-600/70">% Hadir</p>
            </div>
        </div>

        ${item.catatan ? `
        <div class="bg-amber-50 rounded-xl p-3 border border-amber-100">
            <p class="text-[10px] text-amber-700 font-semibold uppercase mb-1">
                <i class="fa-solid fa-clipboard-check text-amber-500 mr-0.5"></i> Catatan Evaluasi
            </p>
            <p class="text-xs text-amber-900 leading-relaxed">${escapeHtml(item.catatan)}</p>
        </div>` : ''}

        <div class="flex items-center gap-2 pt-2">
            <button onclick="closeModal('modal-jurnal-detail'); openEditJurnalModal('${item.id}')"
                class="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2.5 bg-primary-50 hover:bg-primary-100 text-primary-700 text-xs font-semibold rounded-xl border border-primary-200 transition-all">
                <i class="fa-solid fa-pen-to-square text-[10px]"></i> Edit
            </button>
            <button onclick="closeModal('modal-jurnal-detail'); confirmDeleteJurnal('${item.id}')"
                class="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2.5 bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-semibold rounded-xl border border-rose-200 transition-all">
                <i class="fa-solid fa-trash-can text-[10px]"></i> Hapus
            </button>
        </div>
    `;

    openModal('modal-jurnal-detail');
}

// --- CRUD OPERATIONS ---

async function handleSubmitJurnal(event) {
    event.preventDefault();

    const editId = document.getElementById('jurnal-edit-id').value;
    const data = {
        guru: document.getElementById('jurnal-guru').value.trim(),
        tanggal: document.getElementById('jurnal-tanggal').value,
        jam: document.getElementById('jurnal-jam').value,
        kelas: document.getElementById('jurnal-kelas').value,
        mapel: document.getElementById('jurnal-mapel').value,
        materi: document.getElementById('jurnal-materi').value.trim(),
        kegiatan: document.getElementById('jurnal-kegiatan').value.trim(),
        hadir: parseInt(document.getElementById('jurnal-hadir').value) || 0,
        tidakHadir: parseInt(document.getElementById('jurnal-tidak-hadir').value) || 0,
        catatan: document.getElementById('jurnal-catatan').value.trim(),
        timestamp: Date.now()
    };

    try {
        if (editId) {
            // UPDATE
            if (activeEngine === 'rtdb' && rtdb) {
                await rtdb.ref(`jurnal/${editId}`).update(data);
            } else if (activeEngine === 'firestore' && db) {
                await db.collection('jurnal').doc(editId).update(data);
            } else {
                const idx = allJurnalData.findIndex(j => j.id === editId);
                if (idx !== -1) allJurnalData[idx] = { ...allJurnalData[idx], ...data };
                saveJurnalToLocalStorage();
                renderJurnalData();
            }
            showToast('Jurnal KBM berhasil diperbarui!', 'success');
        } else {
            // CREATE
            if (activeEngine === 'rtdb' && rtdb) {
                await rtdb.ref('jurnal').push(data);
            } else if (activeEngine === 'firestore' && db) {
                await db.collection('jurnal').add(data);
            } else {
                data.id = 'jurnal-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5);
                allJurnalData.unshift(data);
                saveJurnalToLocalStorage();
                renderJurnalData();
            }
            showToast('Jurnal KBM baru berhasil disimpan!', 'success');
        }
    } catch (err) {
        console.error('Jurnal save error:', err);
        showToast('Gagal menyimpan jurnal. Coba lagi.', 'error');
    }

    closeModal('modal-jurnal');
}

function confirmDeleteJurnal(id) {
    pendingDeleteJurnalId = id;
    openModal('modal-delete-jurnal');
}

async function executeDeleteJurnal() {
    if (!pendingDeleteJurnalId) return;

    try {
        if (activeEngine === 'rtdb' && rtdb) {
            await rtdb.ref(`jurnal/${pendingDeleteJurnalId}`).remove();
        } else if (activeEngine === 'firestore' && db) {
            await db.collection('jurnal').doc(pendingDeleteJurnalId).delete();
        } else {
            allJurnalData = allJurnalData.filter(j => j.id !== pendingDeleteJurnalId);
            saveJurnalToLocalStorage();
            renderJurnalData();
        }
        showToast('Jurnal berhasil dihapus.', 'success');
    } catch (err) {
        console.error('Delete jurnal error:', err);
        showToast('Gagal menghapus jurnal.', 'error');
    }

    pendingDeleteJurnalId = null;
    closeModal('modal-delete-jurnal');
}

// --- RENDERING ---

function renderJurnalData() {
    filterJurnalTable();
}

function filterJurnalTable() {
    const searchEl = document.getElementById('search-jurnal');
    const periodeEl = document.getElementById('filter-jurnal-periode');
    const tanggalEl = document.getElementById('filter-jurnal-tanggal');
    const kelasEl = document.getElementById('filter-jurnal-kelas');
    const mapelEl = document.getElementById('filter-jurnal-mapel');

    const searchTerm = (searchEl?.value || '').toLowerCase().trim();
    const periode = periodeEl?.value || 'semua';
    const tanggalFilter = tanggalEl?.value || '';
    const kelasFilter = kelasEl?.value || 'semua';
    const mapelFilter = mapelEl?.value || 'semua';

    const todayStr = formatDateISO(new Date());
    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - now.getDay());
    const weekStartStr = formatDateISO(weekStart);
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

    filteredJurnalData = allJurnalData.filter(item => {
        // Search filter
        if (searchTerm) {
            const searchable = `${item.guru || ''} ${item.materi || ''} ${item.kelas || ''} ${item.mapel || ''} ${item.kegiatan || ''} ${item.catatan || ''}`.toLowerCase();
            if (!searchable.includes(searchTerm)) return false;
        }

        // Specific date filter
        if (tanggalFilter && item.tanggal !== tanggalFilter) return false;

        // Periode filter
        if (periode === 'hari-ini' && item.tanggal !== todayStr) return false;
        if (periode === 'minggu-ini' && item.tanggal < weekStartStr) return false;
        if (periode === 'bulan-ini' && item.tanggal < monthStart) return false;

        // Kelas filter
        if (kelasFilter !== 'semua' && item.kelas !== kelasFilter) return false;

        // Mapel filter
        if (mapelFilter !== 'semua' && item.mapel !== mapelFilter) return false;

        return true;
    });

    renderJurnalTable(filteredJurnalData);
    renderJurnalCardList(filteredJurnalData);
    updateJurnalStats();
}

function renderJurnalTable(data) {
    const tbody = document.getElementById('jurnal-table-body');
    const emptyEl = document.getElementById('jurnal-empty');
    const countEl = document.getElementById('jurnal-count');

    if (!tbody) return;

    if (countEl) countEl.textContent = data.length;

    if (data.length === 0) {
        tbody.innerHTML = '';
        if (emptyEl) emptyEl.classList.remove('hidden'), emptyEl.classList.add('flex');
        return;
    }

    if (emptyEl) emptyEl.classList.add('hidden'), emptyEl.classList.remove('flex');

    tbody.innerHTML = data.map(item => {
        const tanggalFormatted = item.tanggal ? new Date(item.tanggal + 'T00:00:00').toLocaleDateString('id-ID', {
            day: 'numeric', month: 'short', year: 'numeric'
        }) : '-';
        const totalSantri = (parseInt(item.hadir) || 0) + (parseInt(item.tidakHadir) || 0);
        const pctHadir = totalSantri > 0 ? Math.round(((parseInt(item.hadir) || 0) / totalSantri) * 100) : 0;
        const pctColor = pctHadir >= 80 ? 'emerald' : pctHadir >= 50 ? 'amber' : 'rose';

        return `
        <tr class="hover:bg-surface-50/50 transition-colors">
            <td class="px-5 py-3.5">
                <p class="text-sm font-semibold text-surface-800">${tanggalFormatted}</p>
                <p class="text-[11px] text-surface-400">${escapeHtml(item.jam || '-')} WIB</p>
            </td>
            <td class="px-5 py-3.5">
                <div class="flex items-center gap-2.5">
                    <div class="w-8 h-8 rounded-lg bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center text-white text-xs font-bold shadow-sm">
                        ${(item.guru || '?').charAt(0).toUpperCase()}
                    </div>
                    <span class="text-sm font-semibold text-surface-800">${escapeHtml(item.guru || '-')}</span>
                </div>
            </td>
            <td class="px-5 py-3.5">
                <p class="text-xs font-semibold text-surface-800">${escapeHtml(item.kelas || '-')}</p>
                <p class="text-[11px] text-primary-600 font-medium">${escapeHtml(item.mapel || '-')}</p>
            </td>
            <td class="px-5 py-3.5 max-w-[240px]">
                <p class="text-xs text-surface-800 truncate font-medium">${escapeHtml(item.materi || '-')}</p>
                ${item.kegiatan ? `<p class="text-[11px] text-surface-400 truncate mt-0.5">${escapeHtml(item.kegiatan)}</p>` : ''}
            </td>
            <td class="px-5 py-3.5 text-center">
                <div class="inline-flex flex-col items-center gap-0.5">
                    <span class="text-sm font-bold text-${pctColor}-600">${item.hadir || 0}/${totalSantri}</span>
                    <div class="w-16 h-1.5 bg-surface-100 rounded-full overflow-hidden">
                        <div class="h-full bg-${pctColor}-500 rounded-full transition-all" style="width: ${pctHadir}%"></div>
                    </div>
                </div>
            </td>
            <td class="px-5 py-3.5 text-center">
                <div class="inline-flex items-center gap-1">
                    <button onclick="showJurnalDetail('${item.id}')"
                        class="p-2 rounded-lg hover:bg-primary-50 text-surface-400 hover:text-primary-600 transition-colors" title="Lihat Detail">
                        <i class="fa-solid fa-eye text-xs"></i>
                    </button>
                    <button onclick="openEditJurnalModal('${item.id}')"
                        class="p-2 rounded-lg hover:bg-amber-50 text-surface-400 hover:text-amber-600 transition-colors" title="Edit">
                        <i class="fa-solid fa-pen-to-square text-xs"></i>
                    </button>
                    <button onclick="confirmDeleteJurnal('${item.id}')"
                        class="p-2 rounded-lg hover:bg-rose-50 text-surface-400 hover:text-rose-600 transition-colors" title="Hapus">
                        <i class="fa-solid fa-trash-can text-xs"></i>
                    </button>
                </div>
            </td>
        </tr>`;
    }).join('');
}

function renderJurnalCardList(data) {
    const container = document.getElementById('jurnal-card-list');
    if (!container) return;

    if (data.length === 0) {
        container.innerHTML = '';
        return;
    }

    container.innerHTML = data.map(item => {
        const tanggalFormatted = item.tanggal ? new Date(item.tanggal + 'T00:00:00').toLocaleDateString('id-ID', {
            weekday: 'short', day: 'numeric', month: 'short', year: 'numeric'
        }) : '-';
        const totalSantri = (parseInt(item.hadir) || 0) + (parseInt(item.tidakHadir) || 0);
        const pctHadir = totalSantri > 0 ? Math.round(((parseInt(item.hadir) || 0) / totalSantri) * 100) : 0;
        const pctColor = pctHadir >= 80 ? 'emerald' : pctHadir >= 50 ? 'amber' : 'rose';

        return `
        <div class="p-4 hover:bg-surface-50/50 transition-colors cursor-pointer active:bg-surface-100" onclick="showJurnalDetail('${item.id}')">
            <!-- Header: Guru + Time -->
            <div class="flex items-start justify-between mb-2.5">
                <div class="flex items-center gap-2.5 min-w-0 flex-1">
                    <div class="w-9 h-9 rounded-xl bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center text-white text-xs font-bold shadow-sm shrink-0">
                        ${(item.guru || '?').charAt(0).toUpperCase()}
                    </div>
                    <div class="min-w-0">
                        <p class="text-sm font-bold text-surface-900 truncate">${escapeHtml(item.guru || '-')}</p>
                        <p class="text-[10px] text-surface-400">${tanggalFormatted} • ${escapeHtml(item.jam || '-')} WIB</p>
                    </div>
                </div>
                <div class="flex items-center gap-1 shrink-0 ml-2">
                    <button onclick="event.stopPropagation(); openEditJurnalModal('${item.id}')"
                        class="p-1.5 rounded-lg hover:bg-amber-50 text-surface-400 hover:text-amber-600 transition-colors">
                        <i class="fa-solid fa-pen-to-square text-[11px]"></i>
                    </button>
                    <button onclick="event.stopPropagation(); confirmDeleteJurnal('${item.id}')"
                        class="p-1.5 rounded-lg hover:bg-rose-50 text-surface-400 hover:text-rose-600 transition-colors">
                        <i class="fa-solid fa-trash-can text-[11px]"></i>
                    </button>
                </div>
            </div>

            <!-- Tags: Kelas + Mapel -->
            <div class="flex flex-wrap items-center gap-1.5 mb-2">
                <span class="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-primary-50 text-primary-700 border border-primary-100">
                    <i class="fa-solid fa-users text-[8px]"></i> ${escapeHtml(item.kelas || '-')}
                </span>
                <span class="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-100">
                    <i class="fa-solid fa-book text-[8px]"></i> ${escapeHtml(item.mapel || '-')}
                </span>
            </div>

            <!-- Materi -->
            <p class="text-xs text-surface-700 leading-relaxed mb-2 line-clamp-2">
                <i class="fa-solid fa-file-lines text-surface-300 mr-1 text-[10px]"></i>
                ${escapeHtml(item.materi || '-')}
            </p>

            <!-- Kehadiran Bar -->
            <div class="flex items-center justify-between bg-surface-50 rounded-xl px-3 py-2 border border-surface-100">
                <div class="flex items-center gap-3">
                    <div class="flex items-center gap-1">
                        <i class="fa-solid fa-user-check text-[10px] text-emerald-500"></i>
                        <span class="text-xs font-bold text-emerald-600">${item.hadir || 0}</span>
                    </div>
                    <div class="flex items-center gap-1">
                        <i class="fa-solid fa-user-xmark text-[10px] text-rose-400"></i>
                        <span class="text-xs font-bold text-rose-500">${item.tidakHadir || 0}</span>
                    </div>
                </div>
                <div class="flex items-center gap-2">
                    <div class="w-20 h-1.5 bg-surface-200 rounded-full overflow-hidden">
                        <div class="h-full bg-${pctColor}-500 rounded-full transition-all" style="width: ${pctHadir}%"></div>
                    </div>
                    <span class="text-[11px] font-bold text-${pctColor}-600">${pctHadir}%</span>
                </div>
            </div>
        </div>`;
    }).join('');
}

function updateJurnalStats() {
    const todayStr = formatDateISO(new Date());

    // Total jurnal
    const totalEl = document.getElementById('stat-total-jurnal');
    if (totalEl) totalEl.textContent = allJurnalData.length;

    // KBM hari ini
    const hariIniCount = allJurnalData.filter(j => j.tanggal === todayStr).length;
    const hariIniEl = document.getElementById('stat-jurnal-hari-ini');
    if (hariIniEl) hariIniEl.textContent = hariIniCount;

    // Guru aktif (unique guru names)
    const uniqueGuru = new Set(allJurnalData.map(j => (j.guru || '').trim().toLowerCase()).filter(Boolean));
    const guruEl = document.getElementById('stat-guru-aktif');
    if (guruEl) guruEl.textContent = uniqueGuru.size;

    // Total santri mengikuti KBM (sum of all hadir)
    const totalSantriHadir = allJurnalData.reduce((sum, j) => sum + (parseInt(j.hadir) || 0), 0);
    const santriEl = document.getElementById('stat-santri-kbm');
    if (santriEl) santriEl.textContent = totalSantriHadir;

    // Badge hari ini di nav
    const badgeEl = document.getElementById('badge-jurnal-today');
    if (badgeEl) {
        if (hariIniCount > 0) {
            badgeEl.textContent = hariIniCount;
            badgeEl.classList.remove('hidden');
        } else {
            badgeEl.classList.add('hidden');
        }
    }

    // Jurnal count in toolbar
    const countEl = document.getElementById('jurnal-count');
    if (countEl) countEl.textContent = filteredJurnalData.length;
}

function resetJurnalFilters() {
    const searchEl = document.getElementById('search-jurnal');
    const periodeEl = document.getElementById('filter-jurnal-periode');
    const tanggalEl = document.getElementById('filter-jurnal-tanggal');
    const kelasEl = document.getElementById('filter-jurnal-kelas');
    const mapelEl = document.getElementById('filter-jurnal-mapel');

    if (searchEl) searchEl.value = '';
    if (periodeEl) periodeEl.value = 'semua';
    if (tanggalEl) tanggalEl.value = '';
    if (kelasEl) kelasEl.value = 'semua';
    if (mapelEl) mapelEl.value = 'semua';

    filterJurnalTable();
    showToast('Filter jurnal direset.', 'info');
}

// --- EXPORT & PRINT ---

function exportJurnalToCSV() {
    if (filteredJurnalData.length === 0) {
        showToast('Tidak ada data jurnal untuk diexport.', 'info');
        return;
    }

    const headers = ['Tanggal', 'Jam', 'Guru Pengajar', 'Kelas', 'Mata Pelajaran', 'Materi Pokok', 'Kegiatan', 'Hadir', 'Tidak Hadir', 'Catatan'];
    const rows = filteredJurnalData.map(j => [
        j.tanggal || '',
        j.jam || '',
        j.guru || '',
        j.kelas || '',
        j.mapel || '',
        (j.materi || '').replace(/"/g, '""'),
        (j.kegiatan || '').replace(/"/g, '""'),
        j.hadir || 0,
        j.tidakHadir || 0,
        (j.catatan || '').replace(/"/g, '""')
    ]);

    const csvContent = [headers, ...rows].map(r => r.map(c => `"${c}"`).join(',')).join('\n');
    const BOM = '\uFEFF';
    const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Jurnal_KBM_${formatDateISO(new Date())}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    showToast('Data jurnal berhasil diexport ke CSV!', 'success');
}

function printJurnalReport() {
    if (filteredJurnalData.length === 0) {
        showToast('Tidak ada data jurnal untuk dicetak.', 'info');
        return;
    }

    const printRows = filteredJurnalData.map((j, i) => `
        <tr>
            <td style="padding:6px 8px;border:1px solid #ddd;font-size:11px;text-align:center">${i + 1}</td>
            <td style="padding:6px 8px;border:1px solid #ddd;font-size:11px">${j.tanggal || '-'}<br><small>${j.jam || ''} WIB</small></td>
            <td style="padding:6px 8px;border:1px solid #ddd;font-size:11px;font-weight:600">${escapeHtml(j.guru || '-')}</td>
            <td style="padding:6px 8px;border:1px solid #ddd;font-size:11px">${escapeHtml(j.kelas || '-')}</td>
            <td style="padding:6px 8px;border:1px solid #ddd;font-size:11px">${escapeHtml(j.mapel || '-')}</td>
            <td style="padding:6px 8px;border:1px solid #ddd;font-size:11px">${escapeHtml(j.materi || '-')}</td>
            <td style="padding:6px 8px;border:1px solid #ddd;font-size:11px;text-align:center">${j.hadir || 0}</td>
            <td style="padding:6px 8px;border:1px solid #ddd;font-size:11px;text-align:center">${j.tidakHadir || 0}</td>
        </tr>
    `).join('');

    const printWindow = window.open('', '_blank');
    printWindow.document.write(`
        <html>
        <head>
            <title>Rekap Jurnal KBM</title>
            <style>
                body { font-family: 'Segoe UI', sans-serif; padding: 20px; color: #333; }
                h2 { text-align: center; margin-bottom: 4px; }
                p.sub { text-align: center; color: #666; font-size: 12px; margin-bottom: 20px; }
                table { width: 100%; border-collapse: collapse; }
                th { background: #4f46e5; color: #fff; padding: 8px; font-size: 11px; text-align: left; border: 1px solid #4338ca; }
                @media print { body { padding: 0; } }
            </style>
        </head>
        <body>
            <h2>Rekap Jurnal Kegiatan Belajar Mengajar (KBM)</h2>
            <p class="sub">Dicetak pada: ${new Date().toLocaleDateString('id-ID', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })} — Total: ${filteredJurnalData.length} data</p>
            <table>
                <thead>
                    <tr>
                        <th>No</th><th>Tanggal</th><th>Guru</th><th>Kelas</th><th>Mapel</th><th>Materi</th><th>Hadir</th><th>Absen</th>
                    </tr>
                </thead>
                <tbody>${printRows}</tbody>
            </table>
        </body>
        </html>
    `);
    printWindow.document.close();
    setTimeout(() => printWindow.print(), 500);
    showToast('Halaman cetak rekap jurnal dibuka!', 'info');
}

// --- INIT on DOMContentLoaded (hook into existing init) ---
// We need to call initJurnalModule after firebase connects
// Hook into connectToFirebase completion
const _originalConnectToFirebase = connectToFirebase;
connectToFirebase = async function() {
    await _originalConnectToFirebase();
    initJurnalModule();
};

// Also load jurnal data immediately from localStorage
loadJurnalFromLocalStorage();
