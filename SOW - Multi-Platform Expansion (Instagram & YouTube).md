# A. Project — Multi-Platform Analytics Dashboard (TikTok, Instagram & YouTube)

## 1. Project Summary

Developer akan membangun sebuah **Multi-Platform Analytics Dashboard** dengan fitur lengkap yang mencakup **3 platform sekaligus: TikTok, Instagram, dan YouTube**. Dashboard ini meliputi tracking hashtag, trending detection, leaderboard, campaign management system, group analytics, role-based access control, grafik analytics, serta multi-campaign system.

Seluruh platform terintegrasi dalam satu unified dashboard dengan fitur auto-refresh, historical data tracking, dan full mobile responsive design. Project ini juga mencakup biaya operasional 1 tahun (API 3 platform + server hosting), sehingga Client tidak perlu membayar biaya tahunan terpisah selama 12 bulan pertama.

---

## 2. Scope of Work

### 2.1. Development Scope (214 Jam Total)

#### A. Dashboard & Analytics UI (3 Platform) — 34 Jam
Halaman utama yang menampilkan seluruh data performa konten dari 3 platform dalam satu tampilan terpadu. Pengguna dapat langsung melihat ringkasan total Views, Likes, Comments, dan jumlah Posts tanpa perlu membuka masing-masing platform.
   a. **Dashboard utama (overview)** — halaman ringkasan yang menampilkan total metrik dari seluruh platform sekaligus
   b. **Chart analytics lengkap (Line Chart)** — grafik garis interaktif untuk memvisualisasikan tren Views, Likes, dan Comments dari waktu ke waktu
   c. **Posts chart per-platform** — grafik terpisah yang menampilkan jumlah konten yang diposting, dengan breakdown warna berbeda untuk TikTok, Instagram, dan YouTube
   d. **Historical data integration** — penggabungan data lama (sebelum sistem berjalan) dengan data realtime, sehingga grafik menampilkan data lengkap sejak awal campaign
   e. **Multiple chart modes** — dua mode tampilan: *Post Date* (berdasarkan tanggal konten diposting) dan *Accrual* (berdasarkan pertumbuhan metrik harian)
   f. **Platform filter** — tombol filter untuk melihat data All / TikTok saja / Instagram saja / YouTube saja
   g. **Custom date range** — pengguna dapat memilih rentang tanggal tertentu untuk analisis periode spesifik
   h. **Combined header totals** — angka total di header yang menggabungkan data historis + data realtime secara akurat

#### B. TikTok API Integration — 20 Jam
Menghubungkan sistem dengan TikTok untuk mengambil data video (views, likes, comments) dari setiap akun peserta secara otomatis. Tanpa integrasi ini, data harus diinput manual satu per satu.
   a. **Setup & autentikasi TikTok API** — konfigurasi koneksi ke TikTok melalui RapidAPI, termasuk manajemen API key dan rate limiting
   b. **Daily data fetching** — sistem mengambil data terbaru dari setiap akun TikTok setiap hari secara otomatis
   c. **Video metadata extraction** — mengambil detail setiap video: jumlah views, likes, comments, tanggal posting, caption, dan hashtag
   d. **Data normalization** — mengolah data mentah dari TikTok ke format standar yang bisa digabungkan dengan platform lain di dashboard

#### C. Instagram Aggregator API Integration — 24 Jam
Menghubungkan sistem dengan Instagram melalui layanan aggregator pihak ketiga (karena Instagram tidak menyediakan API publik langsung). Proses ini lebih kompleks dari TikTok karena membutuhkan penanganan khusus untuk resolusi data dan proteksi data.
   a. **Setup Instagram Aggregator API (v3)** — konfigurasi koneksi ke aggregator server yang menyediakan data Instagram Reels
   b. **Daily data fetching** — pengambilan data views, likes, comments dari setiap akun Instagram peserta secara otomatis setiap hari
   c. **Data parsing & conversion** — konversi data dari format aggregator (misalnya: timestamp UNIX ke tanggal, shortcode ke numeric ID) agar kompatibel dengan database
   d. **NULL protection system** — mekanisme keamanan data: jika API mengembalikan data kosong, sistem tetap mempertahankan data yang sudah tersimpan sebelumnya agar tidak hilang
   e. **Backfill system** — sistem recovery untuk mengisi data yang tidak lengkap (misalnya tanggal posting yang belum tersedia saat pengambilan awal)

#### D. YouTube Data API Integration — 20 Jam
Menghubungkan sistem dengan YouTube untuk mengambil data performa video dari channel peserta. YouTube memiliki API resmi namun memerlukan penanganan quota dan autentikasi khusus.
   a. **Setup YouTube Data API** — konfigurasi koneksi ke Google/YouTube API, termasuk manajemen API key dan quota
   b. **Daily data fetching** — pengambilan data views, likes, comments dari setiap video YouTube peserta secara otomatis
   c. **Channel management** — pengelolaan daftar channel YouTube yang dipantau per campaign
   d. **Data normalization** — mengolah data YouTube ke format standar yang seragam dengan TikTok dan Instagram di dashboard

#### E. Cron Job Automation, Retry Queue & Backfill — 16 Jam
Sistem otomatisasi latar belakang yang memastikan data dari 3 platform selalu ter-update tanpa perlu intervensi manual. Jika terjadi kegagalan (server down, API error), sistem akan mencoba ulang secara otomatis.
   a. **Cron job scheduling** — penjadwalan otomatis pengambilan data untuk 3 platform (berjalan setiap hari tanpa perlu dijalankan manual)
   b. **Retry queue dengan exponential backoff** — jika pengambilan data gagal, sistem menyimpan antrian dan mencoba ulang secara bertahap (1 detik → 2 detik → 4 detik dst.) agar tidak membebani server
   c. **Concurrent processing** — pengambilan data beberapa akun sekaligus secara paralel untuk mempercepat proses refresh
   d. **Backfill & data recovery** — mengisi ulang data yang hilang atau tidak lengkap dari periode sebelumnya

#### F. Campaign Management System — 22 Jam
Sistem pengelolaan campaign (turnamen/kompetisi) yang memungkinkan admin membuat dan mengelola beberapa campaign sekaligus, masing-masing dengan peserta, hashtag, dan periode yang berbeda.
   a. **Multi-campaign CRUD** — membuat, mengedit, dan menghapus campaign dengan pengaturan nama, hashtag, dan periode
   b. **Participant management** — mengelola daftar peserta per campaign untuk masing-masing platform (akun TikTok, Instagram, YouTube)
   c. **Campaign hashtag tracking** — melacak konten berdasarkan hashtag campaign di semua platform
   d. **Campaign videos detail page** — halaman yang menampilkan semua video yang terdeteksi dalam sebuah campaign, lengkap dengan metrik per video
   e. **Per-campaign analytics** — grafik dan statistik khusus per campaign, sehingga bisa membandingkan performa antar campaign

#### G. Group & Leaderboard System — 22 Jam
Sistem pengelompokan peserta dan peringkat untuk memantau performa individu maupun tim. Berguna untuk melihat siapa peserta terbaik dan video mana yang paling viral.
   a. **Group management** — membuat grup/tim, menambah dan mengelola anggota, serta menentukan struktur tim
   b. **Group analytics dashboard** — grafik dan statistik per grup, termasuk perbandingan performa antar anggota dalam satu tampilan
   c. **Cross-platform leaderboard** — papan peringkat yang menggabungkan data dari 3 platform, diurutkan berdasarkan total views, likes, atau comments
   d. **Employee detail page** — halaman profil per peserta yang menampilkan semua video dari seluruh platform beserta riwayat performanya
   e. **Top viral videos detection** — deteksi otomatis video dengan performa tertinggi (views terbanyak, engagement tertinggi) dari seluruh platform

#### H. Admin Panel — 18 Jam
Panel kontrol khusus admin untuk mengelola seluruh sistem, termasuk memicu refresh data secara manual, memonitor status API, dan mengelola hadiah/reward campaign.
   a. **Admin dashboard** — halaman overview khusus admin dengan ringkasan semua campaign yang berjalan
   b. **Auto-refresh 3 platform** — tombol untuk memperbarui data dari TikTok, Instagram, dan YouTube secara bersamaan atau per platform
   c. **Status monitoring** — indikator real-time yang menampilkan status terakhir refresh (berhasil/gagal, jumlah data yang diambil, waktu terakhir update)
   d. **Retry queue UI** — tampilan antrian data yang gagal diambil, dengan opsi retry manual
   e. **Prize/reward management** — pengelolaan hadiah per campaign (input hadiah, tampilkan di dashboard peserta)

#### I. User Authentication & Access Control — 8 Jam
Sistem login dan kontrol akses untuk memastikan hanya pengguna yang berwenang yang dapat mengakses fitur tertentu. Admin memiliki akses penuh, sementara User/Public hanya dapat melihat data.
   a. **Login & authentication** — halaman login yang aman dengan manajemen session
   b. **Role-Based Access Control (RBAC)** — pembagian hak akses: Admin (akses penuh, kelola campaign, refresh data) dan User/Public (hanya lihat dashboard & leaderboard)

#### J. Mobile Responsive Design — 14 Jam
Penyesuaian tampilan seluruh halaman agar dapat diakses dengan nyaman di perangkat mobile (HP/tablet), tanpa perlu membuat aplikasi terpisah.
   a. **Responsive dashboard & analytics** — grafik, tabel, dan filter yang menyesuaikan ukuran layar HP
   b. **Responsive admin panel** — panel admin yang tetap fungsional di layar kecil (tombol, modal, tabel)
   c. **Responsive leaderboard & groups** — tampilan peringkat dan grup yang optimal di mobile
   d. **Responsive detail pages** — halaman detail employee, video, dan campaign yang mobile-friendly

#### K. Database Design, Deployment & QA — 16 Jam
Perancangan struktur database, deployment ke server production, dan pengujian menyeluruh untuk memastikan sistem berjalan stabil dan tanpa error.
   a. **Database schema design (Supabase)** — perancangan tabel, relasi, dan index untuk menyimpan data 3 platform secara efisien
   b. **Server setup & deployment (Vercel)** — konfigurasi server production, domain, environment variables, dan CI/CD
   c. **Cross-platform testing** — pengujian fungsi pengambilan data dari 3 platform untuk memastikan akurasi
   d. **Performance optimization** — optimasi kecepatan loading dashboard, query database, dan API calls
   e. **Dokumentasi penggunaan** — panduan cara menggunakan dashboard, admin panel, dan fitur-fitur utama

### 2.2. Tidak Termasuk (Out of Scope)

Fitur di bawah tidak termasuk dalam versi ini:
   a. Discord Bot integration
   b. Export data CSV & PDF
   c. Advanced filtering (AI, rekomendasi otomatis, scoring cerdas)
   d. Pembuatan mobile app (Android/iOS)

---

## 3. Deliverables

Developer akan menyerahkan:
   a. Multi-Platform Analytics Dashboard live (web) — TikTok, Instagram, YouTube
   b. Backend + API + cron job berjalan untuk 3 platform
   c. Campaign Management System (multi-platform)
   d. Group & Leaderboard system (cross-platform)
   e. Admin Panel dengan kontrol refresh 3 platform
   f. Trending detection engine & top viral videos
   g. Historical data system (weekly historical + realtime merge)
   h. Full mobile responsive design
   i. Role-based access control
   j. Dokumentasi penggunaan
   k. 30 hari support pasca-handover

---

## 4. Biaya & Struktur Pembayaran

### 4.1. Rincian Biaya Development (Rate: Rp 157.500/jam)

| No | Modul (sesuai Scope 2.1) | Jam | Biaya |
|----|--------------------------|-----|-------|
| A | Dashboard & Analytics UI (3 Platform) | 34 | Rp 5.355.000 |
| B | TikTok API Integration | 20 | Rp 3.150.000 |
| C | Instagram Aggregator API Integration | 24 | Rp 3.780.000 |
| D | YouTube Data API Integration | 20 | Rp 3.150.000 |
| E | Cron Job Automation, Retry Queue & Backfill | 16 | Rp 2.520.000 |
| F | Campaign Management System | 22 | Rp 3.465.000 |
| G | Group & Leaderboard System | 22 | Rp 3.465.000 |
| H | Admin Panel & Platform Controls | 18 | Rp 2.835.000 |
| I | User Authentication & RBAC | 8 | Rp 1.260.000 |
| J | Mobile Responsive Design | 14 | Rp 2.205.000 |
| K | Database Design, Deployment & QA | 16 | Rp 2.520.000 |
| | **Subtotal Development (214 jam)** | **214** | **Rp 33.705.000** |

### 4.2. Biaya Operasional 1 Tahun (Sudah Termasuk Total)

| No | Item | Biaya / Tahun |
|----|------|---------------|
| 1 | TikTok API (RapidAPI subscription) | Rp 3.000.000 |
| 2 | Instagram Aggregator API (v3 license) | Rp 2.500.000 |
| 3 | YouTube Data API (quota extension) | Rp 1.500.000 |
| 4 | Virtual Private Server (hosting & scaling) | Rp 2.393.200 |
| | **Subtotal Operasional** | **Rp 9.393.200** |

### 4.3. Total Biaya Project

| Kategori | Biaya |
|----------|-------|
| Development (214 jam) | Rp 33.705.000 |
| Operasional 1 tahun (API 3 Platform + Server) | Rp 9.393.200 |
| **TOTAL PROJECT** | **Rp 43.098.200** |

### 4.4. Payment Terms

   a. 50% DP di awal — **Rp 21.549.100**
   b. 50% setelah project selesai & deployed — **Rp 21.549.100**

---

## 5. Timeline Pengerjaan (3 Bulan)

| No | Deliverable | Sprint | Deskripsi |
|----|-------------|--------|-----------|
| 1 | Design & System Architecture | Sprint 1 | Finalisasi UI/UX + perancangan flow & database |
| 2 | TikTok API Integration | Sprint 2-3 | Setup API, autentikasi, daily tracking |
| 3 | Instagram API Integration | Sprint 4-5 | Setup aggregator API, daily tracking, retry queue |
| 4 | YouTube API Integration | Sprint 6-7 | Setup YouTube API, daily tracking, auto-refresh |
| 5 | Dashboard Multi-Platform & Analytics | Sprint 8-9 | Unified analytics, chart, historical data merge |
| 6 | Campaign, Group & Leaderboard | Sprint 10 | Multi-platform campaign, cross-platform leaderboard |
| 7 | Admin Panel & Mobile Responsive | Sprint 11 | Admin controls 3 platform, full mobile responsive |
| 8 | Quality Assurance & Deployment | Sprint 12 | Testing lengkap, performance optimization & deploy |

---

## 6. Support & Maintenance

Developer menyediakan:
   a. 30 hari support gratis (bugfix minor) pasca-handover
   b. Perubahan besar / fitur baru dikenakan biaya tambahan
   c. **Maintenance bulanan (opsional):** Rp 3.000.000/bulan — mencakup monitoring, bug fix, update API jika ada perubahan dari platform, serta minor enhancement

---

## 7. Hak Kekayaan Intelektual (HKI)

   a. Semua source code dan aset menjadi milik Client setelah pembayaran lunas.
   b. Developer dapat menyimpan salinan untuk portofolio privat (tanpa data sensitif).

---

## D. Persetujuan

Dengan menandatangani dokumen ini, kedua belah pihak menyetujui seluruh ketentuan dalam Statement of Work ini.


Tangerang, __ ___________ 2026


| Pihak Client | Pihak Developer |
|:-------------|----------------:|
| Trade With Suli | |
| | |
| | |
| | |
| **Andrew Jonathan** | **Naufal Ahmad Fadillah** |
