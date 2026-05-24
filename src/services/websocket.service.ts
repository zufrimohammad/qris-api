export class WebSocketService {
  private subscribers: Map<string, Set<any>> = new Map();

  subscribe(transactionId: string, ws: any): void {
    if (!this.subscribers.has(transactionId)) {
      this.subscribers.set(transactionId, new Set());
    }
    this.subscribers.get(transactionId)!.add(ws);
  }

  unsubscribe(transactionId: string, ws: any): void {
    const subs = this.subscribers.get(transactionId);
    if (subs) {
      subs.delete(ws);
      if (subs.size === 0) {
        this.subscribers.delete(transactionId);
      }
    }
  }

  broadcast(transactionId: string, data: object): void {
    const subs = this.subscribers.get(transactionId);
    if (!subs) return;

    const message = JSON.stringify(data);
    for (const ws of subs) {
      try {
        ws.send(message);
      } catch {
        // Remove broken connections
        subs.delete(ws);
      }
    }

    if (subs.size === 0) {
      this.subscribers.delete(transactionId);
    }
  }

  getSubscriberCount(transactionId: string): number {
    return this.subscribers.get(transactionId)?.size ?? 0;
  }
}

export default WebSocketService;
