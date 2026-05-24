import { TransactionService } from '../services/transaction.service';
import QrisService from '../services/qris.service';

export interface CreateTransactionInput {
  nominal: number;
  qris: string;
}

export interface CreateTransactionOutput {
  transactionId: string;
  originalAmount: number;
  uniqueCode: number;
  totalAmount: number;
  qrisConverted: string;
  merchantName: string;
}

export class CashierController {
  constructor(
    private transactionService: TransactionService,
    private qrisService: QrisService
  ) {}

  createTransaction(input: CreateTransactionInput): CreateTransactionOutput {
    const { nominal, qris } = input;

    if (!Number.isInteger(nominal) || nominal <= 0) {
      throw new Error('Nominal harus berupa bilangan bulat positif');
    }

    if (!qris || typeof qris !== 'string' || qris.length < 20) {
      throw new Error('QRIS string tidak valid');
    }

    const merchantName = this.qrisService.extractMerchantName(qris) || 'Merchant';

    const transaction = this.transactionService.createTransaction(nominal, merchantName);

    const qrisConverted = this.qrisService.convert(qris, transaction.amount.toString());

    return {
      transactionId: transaction.transactionId,
      originalAmount: transaction.originalAmount,
      uniqueCode: transaction.uniqueCode,
      totalAmount: transaction.amount,
      qrisConverted,
      merchantName: transaction.merchantName,
    };
  }
}

export default CashierController;
