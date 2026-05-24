import { TransactionService } from '../services/transaction.service';
import { WebSocketService } from '../services/websocket.service';

export interface WebhookPayloadByAmount {
  amount: number;
  description: string;
}

export interface WebhookPayloadById {
  transactionId: string;
}

export type WebhookPayload = WebhookPayloadByAmount | WebhookPayloadById;

export class WebhookController {
  constructor(
    private transactionService: TransactionService,
    private webSocketService: WebSocketService
  ) {}

  handlePayment(payload: WebhookPayload): { success: boolean; transactionId?: string; error?: string; status: number } {
    // Match by transactionId
    if ('transactionId' in payload && payload.transactionId) {
      const transaction = this.transactionService.findById(payload.transactionId);
      if (!transaction || transaction.status !== 'PENDING') {
        return { success: false, error: 'Transaksi tidak ditemukan', status: 404 };
      }

      const updated = this.transactionService.markSuccess(transaction.transactionId);
      if (!updated) {
        return { success: false, error: 'Gagal mengupdate transaksi', status: 404 };
      }

      this.webSocketService.broadcast(updated.transactionId, {
        type: 'PAYMENT_SUCCESS',
        transactionId: updated.transactionId,
        amount: updated.amount,
        originalAmount: updated.originalAmount,
        uniqueCode: updated.uniqueCode,
        merchantName: updated.merchantName,
      });

      return { success: true, transactionId: updated.transactionId, status: 200 };
    }

    // Match by amount + description
    if ('amount' in payload && 'description' in payload && payload.amount && payload.description) {
      const transaction = this.transactionService.findByAmount(payload.amount);
      if (!transaction) {
        return { success: false, error: 'Transaksi tidak ditemukan', status: 404 };
      }

      const updated = this.transactionService.markSuccess(transaction.transactionId);
      if (!updated) {
        return { success: false, error: 'Gagal mengupdate transaksi', status: 404 };
      }

      this.webSocketService.broadcast(updated.transactionId, {
        type: 'PAYMENT_SUCCESS',
        transactionId: updated.transactionId,
        amount: updated.amount,
        originalAmount: updated.originalAmount,
        uniqueCode: updated.uniqueCode,
        merchantName: updated.merchantName,
      });

      return { success: true, transactionId: updated.transactionId, status: 200 };
    }

    // Invalid payload
    return { success: false, error: 'Body tidak valid: harus memiliki transactionId atau amount + description', status: 400 };
  }
}

export default WebhookController;
