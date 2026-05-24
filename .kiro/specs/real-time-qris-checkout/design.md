# Design Document: Real-Time QRIS Checkout

## Overview

Fitur ini menambahkan kemampuan kasir otomatis ke QRIS API yang sudah ada dengan alur:
1. Kasir memasukkan nominal → sistem generate dynamic QRIS dengan unique code
2. QR ditampilkan ke pelanggan → frontend membuka WebSocket untuk monitoring
3. Sistem eksternal (n8n/payment gateway) mengirim notifikasi mutasi ke webhook
4. Webhook mencocokkan mutasi dengan transaksi pending → update status
5. WebSocket push notification ke frontend → tampilkan sukses + sound alert TTS

Arsitektur menggunakan in-memory transaction store (Map), Elysia WebSocket plugin untuk real-time communication, dan browser SpeechSynthesis API untuk TTS alert.

## Architecture

```mermaid
flowchart TB
    subgraph Frontend["Cashier Dashboard (Browser)"]
        UI[Input Nominal]
        QR[QR Display]
        WS_CLIENT[WebSocket Client]
        TTS[SpeechSynthesis TTS]
        NOTIF[Visual Notification]
    end

    subgraph Backend["Elysia Server (Bun)"]
        API[REST API]
        WH[Webhook Handler<br/>POST /webhook/payment]
        WS_SERVER[WebSocket Server<br/>/ws/transaction/:id]
        TS[Transaction Store<br/>In-Memory Map]
        CONVERT[/convert Endpoint]
        QR_GEN[/qr Endpoint]
    end

    subgraph External["External Systems"]
        N8N[n8n Automation]
        BANK[Payment Gateway/Bank]
    end

    UI -->|1. Input nominal| API
    API -->|2. Create transaction| TS
    API -->|3. Call /convert + unique code| CONVERT
    CONVERT -->|4. Dynamic QRIS| QR_GEN
    QR_GEN -->|5. QR Image| QR
    QR -->|6. Open WS| WS_CLIENT
    WS_CLIENT <-->|7. Subscribe| WS_SERVER

    BANK -->|Mutasi| N8N
    N8N -->|POST /webhook/payment| WH
    WH -->|8. Match & update| TS
    TS -->|9. Notify| WS_SERVER
    WS_SERVER -->|10. Push SUCCESS| WS_CLIENT
    WS_CLIENT -->|11. Trigger| TTS
    WS_CLIENT -->|11. Trigger| NOTIF
```

## Components and Interfaces

### 1. Transaction Store (`src/services/transaction.service.ts`)

Service untuk mengelola state transaksi di memory.

```typescript
interface Transaction {
  transactionId: string;
  amount: number;        // nominal asli + unique code
  originalAmount: number; // nominal asli yang diinput kasir
  uniqueCode: number;    // unique code (1-99)
  status: 'PENDING' | 'SUCCESS';
  createdAt: number;     // Date.now() timestamp
  merchantName: string;
}

class TransactionService {
  private store: Map<string, Transaction>;
  private cleanupInterval: Timer;

  createTransaction(originalAmount: number, merchantName: string): Transaction;
  findByAmount(amount: number): Transaction | undefined;
  findById(transactionId: string): Transaction | undefined;
  markSuccess(transactionId: string): Transaction | undefined;
  cleanup(): void; // hapus transaksi > 15 menit
}
```

**Unique Code Generation Strategy:**
- Generate random number 1-99
- Cek collision: pastikan `originalAmount + uniqueCode` tidak sama dengan transaksi PENDING lain
- Jika collision, regenerate (max 10 attempts)
- Final amount = originalAmount + uniqueCode

### 2. WebSocket Manager (`src/services/websocket.service.ts`)

Service untuk mengelola koneksi WebSocket dan broadcasting.

```typescript
interface WsSubscriber {
  ws: any; // Elysia WebSocket instance
  transactionId: string;
}

class WebSocketService {
  private subscribers: Map<string, Set<any>>; // transactionId -> Set of ws connections

  subscribe(transactionId: string, ws: any): void;
  unsubscribe(transactionId: string, ws: any): void;
  broadcast(transactionId: string, data: object): void;
}
```

### 3. Webhook Handler (`src/controllers/webhook.controller.ts`)

Controller untuk menerima dan memproses notifikasi mutasi.

```typescript
interface WebhookPayloadByAmount {
  amount: number;
  description: string;
}

interface WebhookPayloadById {
  transactionId: string;
}

type WebhookPayload = WebhookPayloadByAmount | WebhookPayloadById;

class WebhookController {
  handlePayment(payload: WebhookPayload): { success: boolean; transactionId?: string; error?: string };
}
```

### 4. Cashier API (`src/controllers/cashier.controller.ts`)

Controller untuk endpoint kasir (create transaction).

```typescript
interface CreateTransactionInput {
  nominal: number;
  qris: string; // static QRIS string dari merchant
}

interface CreateTransactionOutput {
  transactionId: string;
  originalAmount: number;
  uniqueCode: number;
  totalAmount: number;
  qrisConverted: string;
  merchantName: string;
}

class CashierController {
  createTransaction(input: CreateTransactionInput): CreateTransactionOutput;
}
```

### 5. Frontend Cashier Dashboard (`public/ui.html`, `public/ui.js`, `public/ui.css`)

Update UI menjadi dashboard kasir interaktif dengan 3 state:
- **INPUT**: Form input nominal + QRIS
- **WAITING**: QR displayed + animasi menunggu + WebSocket monitoring
- **SUCCESS**: Layar sukses + confetti + TTS alert

## Data Models

### Transaction Object

```typescript
interface Transaction {
  transactionId: string;     // UUID v4
  amount: number;            // total (originalAmount + uniqueCode)
  originalAmount: number;    // nominal yang diinput kasir
  uniqueCode: number;        // 1-99
  status: 'PENDING' | 'SUCCESS';
  createdAt: number;         // unix timestamp ms
  merchantName: string;      // dari QRIS string
}
```

### WebSocket Messages

**Server → Client (Success):**
```json
{
  "type": "PAYMENT_SUCCESS",
  "transactionId": "uuid-here",
  "amount": 10025,
  "originalAmount": 10000,
  "uniqueCode": 25,
  "merchantName": "Toko ABC"
}
```

**Server → Client (Error):**
```json
{
  "type": "ERROR",
  "message": "Transaction not found"
}
```

### Webhook Request Body

**By Amount:**
```json
{
  "amount": 10025,
  "description": "Transfer dari DANA - Rp10.025"
}
```

**By Transaction ID:**
```json
{
  "transactionId": "uuid-here"
}
```

### API Endpoints Summary

| Method | Path | Description |
|--------|------|-------------|
| POST | `/cashier/create` | Buat transaksi baru, return QR data |
| POST | `/webhook/payment` | Terima notifikasi mutasi |
| WS | `/ws/transaction/:transactionId` | Real-time monitoring |
| GET | `/ui` | Cashier dashboard HTML |

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system-essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Transaction creation invariants

*For any* valid nominal (positive integer) and merchantName (non-empty string), creating a transaction SHALL produce an object where: status is PENDING, transactionId is a non-empty unique string, amount equals originalAmount + uniqueCode, createdAt is a valid timestamp, and findById with the transactionId returns the same object.

**Validates: Requirements 1.1, 1.2, 1.4**

### Property 2: Unique code constraints and collision avoidance

*For any* created transaction, the uniqueCode SHALL be an integer in range [1, 99], and for any two concurrent PENDING transactions with the same originalAmount, their total amount (originalAmount + uniqueCode) SHALL differ.

**Validates: Requirements 1.5**

### Property 3: Webhook match by amount updates status to SUCCESS

*For any* PENDING transaction in the store, sending a webhook payload with `{ amount: transaction.amount, description: "any string" }` SHALL change the transaction status to SUCCESS and return a success response.

**Validates: Requirements 2.2, 2.4**

### Property 4: Webhook match by transactionId updates status to SUCCESS

*For any* PENDING transaction in the store, sending a webhook payload with `{ transactionId: transaction.transactionId }` SHALL change the transaction status to SUCCESS and return a success response.

**Validates: Requirements 2.3, 2.4**

### Property 5: Webhook returns appropriate errors for invalid/unmatched requests

*For any* webhook request where the body lacks both (amount + description) and transactionId, the handler SHALL return HTTP 400. *For any* amount or transactionId not present in the store as PENDING, the handler SHALL return HTTP 404.

**Validates: Requirements 2.6, 2.7**

### Property 6: WebSocket broadcast reaches all subscribers

*For any* set of N subscribers connected to the same transactionId, when a broadcast is triggered for that transactionId, all N subscribers SHALL receive the message with correct JSON format containing type, transactionId, amount, and merchantName.

**Validates: Requirements 3.3**

### Property 7: WebSocket cleanup on disconnect

*For any* client that subscribes to a transactionId and then disconnects, the subscriber list for that transactionId SHALL no longer contain that client, and the subscriber count SHALL decrease by one.

**Validates: Requirements 3.4**

### Property 8: Transaction creation produces valid converted QRIS

*For any* valid nominal and valid static QRIS string, createTransaction SHALL produce a `qrisConverted` string that is a valid QRIS payload (starts with 000201, contains 5802ID, has valid CRC16) with the total amount embedded.

**Validates: Requirements 4.2**

### Property 9: TTS message format contains correct nominal

*For any* positive integer nominal, the generated TTS message SHALL contain the nominal value and follow the format "Pembayaran sebesar [Nominal] rupiah berhasil diterima".

**Validates: Requirements 6.1**

## Error Handling

### Backend Error Handling

| Scenario | Response | Action |
|----------|----------|--------|
| Webhook body invalid (missing fields) | HTTP 400 + JSON error | Log warning, return descriptive message |
| Webhook no matching transaction | HTTP 404 + JSON error | Log info, return "transaksi tidak ditemukan" |
| WebSocket invalid transactionId | WS error message + close | Send error JSON, close connection |
| Transaction store full (memory pressure) | Force cleanup old entries | Run cleanup, log warning |
| QRIS conversion fails | HTTP 400 + JSON error | Return error dari QrisService |
| Unique code collision (10 attempts failed) | HTTP 500 + JSON error | Log error, suggest retry |

### Frontend Error Handling

| Scenario | Action |
|----------|--------|
| WebSocket disconnect | Auto-reconnect 3x dengan interval 2s |
| WebSocket reconnect gagal 3x | Tampilkan pesan "Koneksi terputus, silakan refresh" |
| SpeechSynthesis tidak tersedia | Fallback ke visual notification only |
| API call gagal | Tampilkan error message di UI |
| QR generation gagal | Tampilkan pesan error, tetap di state INPUT |

## Testing Strategy

### Unit Tests (Example-based)

- Transaction cleanup: verify transactions > 15 menit dihapus
- WebSocket subscribe/unsubscribe lifecycle
- Webhook endpoint routing dan response codes
- Dashboard UI state transitions
- TTS language configuration (id-ID)
- Reconnect logic (max 3 attempts)

### Property-Based Tests

Library: **fast-check** (TypeScript property-based testing library untuk Bun/Node)

Konfigurasi: minimum 100 iterations per property test.

Setiap property test di-tag dengan format:
`Feature: real-time-qris-checkout, Property N: [property text]`

Properties to implement:
1. Transaction creation invariants
2. Unique code constraints and collision avoidance
3. Webhook match by amount
4. Webhook match by transactionId
5. Webhook error responses
6. WebSocket broadcast
7. WebSocket cleanup
8. Valid QRIS output
9. TTS message format

### Integration Tests

- End-to-end: create transaction → webhook → WebSocket notification
- Concurrent transactions with same nominal (unique code collision handling)
- WebSocket multiple clients subscribing to same transaction

