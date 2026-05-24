import { v4 as uuidv4 } from 'uuid';
import type { Transaction } from '../types/transaction.type';

const CLEANUP_INTERVAL_MS = 60 * 1000; // 1 minute
const TRANSACTION_TTL_MS = 15 * 60 * 1000; // 15 minutes
const MAX_UNIQUE_CODE = 99;
const MIN_UNIQUE_CODE = 1;
const MAX_COLLISION_ATTEMPTS = 10;

export class TransactionService {
  private store: Map<string, Transaction> = new Map();
  private cleanupInterval: ReturnType<typeof setInterval>;

  constructor() {
    this.cleanupInterval = setInterval(() => this.cleanup(), CLEANUP_INTERVAL_MS);
  }

  createTransaction(originalAmount: number, merchantName: string): Transaction {
    const uniqueCode = this.generateUniqueCode(originalAmount);
    const amount = originalAmount + uniqueCode;

    const transaction: Transaction = {
      transactionId: uuidv4(),
      amount,
      originalAmount,
      uniqueCode,
      status: 'PENDING',
      createdAt: Date.now(),
      merchantName,
    };

    this.store.set(transaction.transactionId, transaction);
    return transaction;
  }

  findByAmount(amount: number): Transaction | undefined {
    for (const transaction of this.store.values()) {
      if (transaction.amount === amount && transaction.status === 'PENDING') {
        return transaction;
      }
    }
    return undefined;
  }

  findById(transactionId: string): Transaction | undefined {
    return this.store.get(transactionId);
  }

  markSuccess(transactionId: string): Transaction | undefined {
    const transaction = this.store.get(transactionId);
    if (transaction && transaction.status === 'PENDING') {
      transaction.status = 'SUCCESS';
      return transaction;
    }
    return undefined;
  }

  cleanup(): void {
    const now = Date.now();
    for (const [id, transaction] of this.store.entries()) {
      if (now - transaction.createdAt > TRANSACTION_TTL_MS) {
        this.store.delete(id);
      }
    }
  }

  private generateUniqueCode(originalAmount: number): number {
    for (let attempt = 0; attempt < MAX_COLLISION_ATTEMPTS; attempt++) {
      const code = Math.floor(Math.random() * MAX_UNIQUE_CODE) + MIN_UNIQUE_CODE;
      const candidateAmount = originalAmount + code;

      if (!this.hasCollision(candidateAmount)) {
        return code;
      }
    }

    // Fallback: return last generated code even if collision exists
    return Math.floor(Math.random() * MAX_UNIQUE_CODE) + MIN_UNIQUE_CODE;
  }

  private hasCollision(amount: number): boolean {
    for (const transaction of this.store.values()) {
      if (transaction.amount === amount && transaction.status === 'PENDING') {
        return true;
      }
    }
    return false;
  }

  destroy(): void {
    clearInterval(this.cleanupInterval);
    this.store.clear();
  }
}

export default TransactionService;
