# Implementation Plan: Real-Time QRIS Checkout

## Overview

Implementasi sistem kasir otomatis QRIS dengan real-time notification. Menggunakan pendekatan incremental: mulai dari transaction store, lalu webhook, WebSocket, dan terakhir frontend dashboard.

## Tasks

- [x] 1. Setup dependencies dan Transaction Store
  - [x] 1.1 Install `@elysiajs/websocket` dan `fast-check` (dev dependency), tambahkan `uuid` untuk generate transactionId
    - Run: `bun add @elysiajs/websocket` dan `bun add -d fast-check @types/uuid` dan `bun add uuid`
    - _Requirements: 3.1_

  - [x] 1.2 Buat Transaction type dan service (`src/types/transaction.type.ts` dan `src/services/transaction.service.ts`)
    - Definisikan interface `Transaction` dengan field: transactionId, amount, originalAmount, uniqueCode, status, createdAt, merchantName
    - Implementasi `TransactionService` class dengan Map sebagai store
    - Method: `createTransaction(originalAmount: number, merchantName: string): Transaction`
    - Method: `findByAmount(amount: number): Transaction | undefined` - cari PENDING transaction by amount
    - Method: `findById(transactionId: string): Transaction | undefined`
    - Method: `markSuccess(transactionId: string): Transaction | undefined`
    - Method: `cleanup(): void` - hapus transaksi > 15 menit
    - Unique code generation: random 1-99, check collision dengan PENDING transactions yang punya originalAmount sama
    - Setup interval cleanup setiap 1 menit
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

  - [ ]* 1.3 Write property tests for TransactionService
    - **Property 1: Transaction creation invariants**
    - **Validates: Requirements 1.1, 1.2, 1.4**
    - **Property 2: Unique code constraints and collision avoidance**
    - **Validates: Requirements 1.5**
    - Gunakan fast-check, minimum 100 iterations
    - File: `src/__tests__/transaction.service.test.ts`

- [x] 2. Implement WebSocket Service
  - [x] 2.1 Buat WebSocket service (`src/services/websocket.service.ts`)
    - Implementasi `WebSocketService` class
    - `subscribers: Map<string, Set<any>>` - transactionId → set of ws connections
    - Method: `subscribe(transactionId: string, ws: any): void`
    - Method: `unsubscribe(transactionId: string, ws: any): void`
    - Method: `broadcast(transactionId: string, data: object): void` - kirim JSON ke semua subscriber
    - _Requirements: 3.2, 3.3, 3.4_

  - [x] 2.2 Register WebSocket route di `src/app.ts`
    - Import dan use `@elysiajs/websocket` plugin
    - Tambahkan route `.ws('/ws/transaction/:transactionId', { ... })`
    - On open: validasi transactionId ada di store, subscribe client
    - On close: unsubscribe client
    - Jika transactionId tidak valid, kirim error message dan close
    - _Requirements: 3.1, 3.2, 3.5_

  - [ ]* 2.3 Write property tests for WebSocketService
    - **Property 6: WebSocket broadcast reaches all subscribers**
    - **Validates: Requirements 3.3**
    - **Property 7: WebSocket cleanup on disconnect**
    - **Validates: Requirements 3.4**
    - Gunakan mock WebSocket objects
    - File: `src/__tests__/websocket.service.test.ts`

- [x] 3. Implement Webhook Handler
  - [x] 3.1 Buat Webhook controller (`src/controllers/webhook.controller.ts`)
    - Definisikan types: `WebhookPayloadByAmount`, `WebhookPayloadById`
    - Method: `handlePayment(payload)` - validate body, cari transaksi, update status, trigger broadcast
    - Jika body punya `transactionId` → findById
    - Jika body punya `amount` + `description` → findByAmount
    - Jika match ditemukan → markSuccess + broadcast via WebSocketService
    - Return appropriate response (200/400/404)
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7_

  - [x] 3.2 Register webhook route di `src/app.ts`
    - Tambahkan `app.post('/webhook/payment', ...)` dengan body validation menggunakan Elysia `t.Object`
    - Wire WebhookController dengan TransactionService dan WebSocketService
    - _Requirements: 2.1_

  - [ ]* 3.3 Write property tests for Webhook handler
    - **Property 3: Webhook match by amount updates status to SUCCESS**
    - **Validates: Requirements 2.2, 2.4**
    - **Property 4: Webhook match by transactionId updates status to SUCCESS**
    - **Validates: Requirements 2.3, 2.4**
    - **Property 5: Webhook returns appropriate errors for invalid/unmatched requests**
    - **Validates: Requirements 2.6, 2.7**
    - File: `src/__tests__/webhook.controller.test.ts`

- [x] 4. Implement Cashier API Endpoint
  - [x] 4.1 Buat Cashier controller (`src/controllers/cashier.controller.ts`)
    - Method: `createTransaction(input: { nominal: number, qris: string })`
    - Validasi nominal (positive integer) dan qris string
    - Call TransactionService.createTransaction → dapatkan transaction object
    - Call QrisService.convert(qris, totalAmount.toString()) → dapatkan converted QRIS
    - Return: transactionId, originalAmount, uniqueCode, totalAmount, qrisConverted, merchantName
    - _Requirements: 4.2, 4.3, 4.4_

  - [x] 4.2 Register cashier route di `src/app.ts`
    - Tambahkan `app.post('/cashier/create', ...)` dengan body validation
    - Body: `{ nominal: number, qris: string }`
    - Response: `{ transactionId, originalAmount, uniqueCode, totalAmount, qrisConverted, merchantName }`
    - _Requirements: 4.1, 4.2_

  - [ ]* 4.3 Write property test for Cashier transaction creation
    - **Property 8: Transaction creation produces valid converted QRIS**
    - **Validates: Requirements 4.2**
    - File: `src/__tests__/cashier.controller.test.ts`

- [x] 5. Checkpoint - Backend Integration
  - Ensure all tests pass, ask the user if questions arise.
  - Verifikasi alur: create transaction → webhook match → WebSocket notification berjalan end-to-end

- [x] 6. Update Cashier Dashboard Frontend
  - [x] 6.1 Update `public/ui.html` menjadi dashboard kasir
    - Redesign layout dengan 3 state/view: INPUT, WAITING, SUCCESS
    - State INPUT: form dengan input nominal, static QRIS textarea (atau upload), tombol "Generate QR", toggle sound on/off
    - State WAITING: QR image besar, info transaksi (nominal, unique code, total), animasi "Menunggu Pembayaran..." dengan spinner
    - State SUCCESS: layar hijau full dengan teks "PEMBAYARAN SUKSES", nominal, efek confetti, tombol "Transaksi Baru"
    - Gunakan Bootstrap 5 yang sudah ada
    - _Requirements: 4.1, 4.4, 5.2, 5.3_

  - [x] 6.2 Update `public/ui.css` untuk styling dashboard kasir
    - Styling untuk 3 state (INPUT, WAITING, SUCCESS)
    - Animasi pulse/loading untuk state WAITING
    - Green success screen styling
    - Confetti animation CSS
    - Responsive design untuk tablet/desktop kasir
    - _Requirements: 5.2, 5.3_

  - [x] 6.3 Rewrite `public/ui.js` dengan logika kasir lengkap
    - State management: currentState (INPUT/WAITING/SUCCESS), currentTransaction
    - Generate QR flow: call `/cashier/create` → tampilkan QR dari `/qr?text=<qrisConverted>` → switch ke WAITING state
    - WebSocket connection: connect ke `ws://host/ws/transaction/<transactionId>` setelah QR ditampilkan
    - Handle WebSocket messages: jika type === "PAYMENT_SUCCESS" → switch ke SUCCESS state
    - Reconnect logic: max 3 attempts, interval 2 detik
    - Sound toggle state persistence (localStorage)
    - Tombol "Transaksi Baru" → reset ke INPUT state, tutup WebSocket
    - _Requirements: 4.2, 4.3, 5.1, 5.5_

  - [x] 6.4 Implementasi TTS Alert di `public/ui.js`
    - Fungsi `playSuccessSound(amount)`: gunakan SpeechSynthesis API
    - Buat SpeechSynthesisUtterance dengan text: "Pembayaran sebesar [amount] rupiah berhasil diterima"
    - Set lang: "id-ID", rate: 1, pitch: 1
    - Check `window.speechSynthesis` availability sebelum play
    - Jika tidak tersedia: fallback ke visual notification only (flash screen)
    - Respect sound toggle setting
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

  - [ ]* 6.5 Write property test for TTS message format
    - **Property 9: TTS message format contains correct nominal**
    - **Validates: Requirements 6.1**
    - File: `src/__tests__/tts-format.test.ts`

- [x] 7. Final Checkpoint - Full Integration
  - Ensure all tests pass, ask the user if questions arise.
  - Verifikasi full flow: Input nominal → Generate QR → Webhook masuk → WebSocket notify → Success screen + TTS

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Property-based tests menggunakan `fast-check` library dengan minimum 100 iterations
- Frontend menggunakan Bootstrap 5 yang sudah ada di project
- WebSocket menggunakan `@elysiajs/websocket` plugin resmi
- Transaction store in-memory (tidak perlu database untuk MVP)
- Static QRIS string bisa di-hardcode di environment variable atau diinput manual oleh kasir
