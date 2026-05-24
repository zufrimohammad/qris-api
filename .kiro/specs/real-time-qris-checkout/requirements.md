# Requirements Document

## Introduction

Fitur ini mentransformasi QRIS API yang sudah ada menjadi sistem kasir otomatis dengan notifikasi real-time dan alert suara, mirip dengan alur kerja TemanQRIS/GoPay Speaker. Sistem akan mencakup tracking transaksi in-memory, webhook endpoint untuk menerima notifikasi mutasi, integrasi WebSocket untuk komunikasi real-time, serta dashboard kasir interaktif dengan fitur suara TTS (Text-to-Speech).

## Glossary

- **Transaction_Store**: Komponen penyimpanan transaksi in-memory menggunakan JavaScript Map yang menyimpan data transaksi aktif
- **Webhook_Handler**: Endpoint HTTP POST yang menerima notifikasi mutasi pembayaran dari sistem eksternal atau n8n automation
- **WebSocket_Server**: Server WebSocket berbasis `@elysiajs/websocket` yang menyediakan komunikasi real-time antara backend dan frontend
- **Cashier_Dashboard**: Halaman UI interaktif di `/ui` yang berfungsi sebagai dashboard kasir dengan fitur generate QR, monitoring pembayaran, dan notifikasi suara
- **Transaction**: Objek data yang merepresentasikan satu transaksi QRIS dengan properti `transactionId`, `amount`, `status`, `createdAt`, dan `merchantName`
- **Unique_Code**: Angka tambahan kecil (1-99) yang ditambahkan ke nominal asli untuk membuat setiap mutasi unik dan mudah dicocokkan
- **TTS_Alert**: Fitur Text-to-Speech menggunakan browser SpeechSynthesis API untuk mengumumkan pembayaran berhasil

## Requirements

### Requirement 1: Transaction State Memory

**User Story:** Sebagai sistem, saya perlu menyimpan state transaksi yang sedang berlangsung, sehingga saya dapat mencocokkan mutasi masuk dengan transaksi yang pending.

#### Acceptance Criteria

1. THE Transaction_Store SHALL menyimpan setiap transaksi dengan properti: `transactionId` (string unik), `amount` (number), `status` (enum PENDING | SUCCESS), `createdAt` (timestamp), dan `merchantName` (string)
2. WHEN sebuah transaksi baru dibuat, THE Transaction_Store SHALL menetapkan status awal sebagai PENDING
3. WHEN sebuah transaksi sudah berusia lebih dari 15 menit, THE Transaction_Store SHALL menghapus transaksi tersebut dari memori
4. THE Transaction_Store SHALL menggunakan `transactionId` sebagai key unik untuk lookup O(1)
5. WHEN sebuah transaksi dibuat, THE Transaction_Store SHALL menambahkan unique code (1-99) ke nominal asli untuk menghasilkan amount unik yang dapat dicocokkan dengan mutasi

### Requirement 2: Webhook Payment Endpoint

**User Story:** Sebagai sistem eksternal (n8n/payment gateway), saya ingin mengirim notifikasi mutasi ke webhook endpoint, sehingga sistem dapat mencocokkan pembayaran dengan transaksi pending.

#### Acceptance Criteria

1. THE Webhook_Handler SHALL menerima request POST di path `/webhook/payment` dengan body berformat JSON
2. WHEN request body berisi `{ amount: number, description: string }`, THE Webhook_Handler SHALL mencari transaksi PENDING yang cocok berdasarkan amount
3. WHEN request body berisi `{ transactionId: string }`, THE Webhook_Handler SHALL mencari transaksi PENDING berdasarkan transactionId secara langsung
4. WHEN transaksi PENDING yang cocok ditemukan, THE Webhook_Handler SHALL mengubah status transaksi menjadi SUCCESS
5. WHEN status transaksi berubah menjadi SUCCESS, THE Webhook_Handler SHALL mengirim notifikasi melalui WebSocket ke subscriber transaksi tersebut
6. IF tidak ada transaksi PENDING yang cocok, THEN THE Webhook_Handler SHALL mengembalikan response HTTP 404 dengan pesan error deskriptif
7. IF request body tidak valid (missing required fields), THEN THE Webhook_Handler SHALL mengembalikan response HTTP 400 dengan pesan validasi

### Requirement 3: WebSocket Real-Time Communication

**User Story:** Sebagai frontend dashboard, saya ingin menerima update status transaksi secara real-time, sehingga kasir langsung tahu ketika pembayaran berhasil tanpa perlu refresh halaman.

#### Acceptance Criteria

1. THE WebSocket_Server SHALL menyediakan koneksi WebSocket di path `/ws/transaction/:transactionId`
2. WHEN client terhubung ke WebSocket dengan transactionId tertentu, THE WebSocket_Server SHALL mendaftarkan client sebagai subscriber untuk transaksi tersebut
3. WHEN status transaksi berubah menjadi SUCCESS, THE WebSocket_Server SHALL mengirim pesan JSON `{ status: "SUCCESS", transactionId, amount, merchantName }` ke semua subscriber transaksi tersebut
4. WHEN client terputus, THE WebSocket_Server SHALL menghapus client dari daftar subscriber
5. IF transactionId tidak ditemukan di Transaction_Store, THEN THE WebSocket_Server SHALL mengirim pesan error dan menutup koneksi

### Requirement 4: Cashier Dashboard - Generate QR

**User Story:** Sebagai kasir, saya ingin memasukkan nominal pembayaran dan langsung mendapatkan QR code dinamis, sehingga pelanggan dapat melakukan pembayaran dengan scan QR.

#### Acceptance Criteria

1. THE Cashier_Dashboard SHALL menampilkan input field untuk nominal pembayaran
2. WHEN kasir memasukkan nominal dan menekan tombol "Generate QR", THE Cashier_Dashboard SHALL memanggil endpoint `/convert` secara internal dengan nominal ditambah unique code
3. WHEN konversi QRIS berhasil, THE Cashier_Dashboard SHALL menampilkan QR code image menggunakan endpoint `/qr`
4. THE Cashier_Dashboard SHALL menampilkan informasi transaksi: nominal asli, unique code, total amount, dan transactionId
5. IF konversi QRIS gagal, THEN THE Cashier_Dashboard SHALL menampilkan pesan error yang jelas kepada kasir

### Requirement 5: Cashier Dashboard - Payment Monitoring

**User Story:** Sebagai kasir, saya ingin melihat status pembayaran secara real-time setelah QR ditampilkan, sehingga saya tahu kapan pelanggan sudah membayar.

#### Acceptance Criteria

1. WHEN QR code berhasil ditampilkan, THE Cashier_Dashboard SHALL membuka koneksi WebSocket ke backend untuk monitoring transaksi tersebut
2. WHILE menunggu pembayaran, THE Cashier_Dashboard SHALL menampilkan animasi "Menunggu Pembayaran..." dengan indikator loading
3. WHEN WebSocket menerima pesan bahwa transaksi SUCCESS, THE Cashier_Dashboard SHALL langsung menampilkan layar "PEMBAYARAN SUKSES" dengan efek visual hijau/confetti
4. WHEN pembayaran berhasil, THE Cashier_Dashboard SHALL memutar notifikasi suara TTS: "Pembayaran sebesar [Nominal] rupiah berhasil diterima" menggunakan browser SpeechSynthesis API
5. IF koneksi WebSocket terputus, THEN THE Cashier_Dashboard SHALL mencoba reconnect otomatis maksimal 3 kali dengan interval 2 detik

### Requirement 6: Cashier Dashboard - Sound Alert

**User Story:** Sebagai kasir, saya ingin mendengar alert suara ketika pembayaran berhasil, sehingga saya tidak perlu terus-menerus melihat layar.

#### Acceptance Criteria

1. WHEN pembayaran berhasil diterima, THE TTS_Alert SHALL memutar pesan suara "Pembayaran sebesar [Nominal] rupiah berhasil diterima" menggunakan SpeechSynthesis API
2. THE TTS_Alert SHALL menggunakan bahasa Indonesia (lang: "id-ID") untuk pengucapan nominal
3. WHEN SpeechSynthesis API tidak tersedia di browser, THE Cashier_Dashboard SHALL menampilkan notifikasi visual sebagai fallback tanpa error
4. THE Cashier_Dashboard SHALL menyediakan tombol untuk mengaktifkan/menonaktifkan fitur suara

