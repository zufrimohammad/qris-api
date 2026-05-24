export interface Transaction {
  transactionId: string;
  amount: number;        // nominal asli + unique code
  originalAmount: number; // nominal asli yang diinput kasir
  uniqueCode: number;    // unique code (1-99)
  status: 'PENDING' | 'SUCCESS';
  createdAt: number;     // Date.now() timestamp
  merchantName: string;
}
