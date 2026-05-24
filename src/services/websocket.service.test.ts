import { describe, it, expect, beforeEach } from 'bun:test';
import { WebSocketService } from './websocket.service';

describe('WebSocketService', () => {
  let service: WebSocketService;

  beforeEach(() => {
    service = new WebSocketService();
  });

  it('should subscribe a client to a transactionId', () => {
    const mockWs = { send: () => {} };
    service.subscribe('tx-1', mockWs);
    expect(service.getSubscriberCount('tx-1')).toBe(1);
  });

  it('should unsubscribe a client from a transactionId', () => {
    const mockWs = { send: () => {} };
    service.subscribe('tx-1', mockWs);
    service.unsubscribe('tx-1', mockWs);
    expect(service.getSubscriberCount('tx-1')).toBe(0);
  });

  it('should handle unsubscribe for non-existent transactionId', () => {
    const mockWs = { send: () => {} };
    // Should not throw
    service.unsubscribe('non-existent', mockWs);
    expect(service.getSubscriberCount('non-existent')).toBe(0);
  });

  it('should broadcast message to all subscribers of a transactionId', () => {
    const received: string[] = [];
    const mockWs1 = { send: (msg: string) => received.push(msg) };
    const mockWs2 = { send: (msg: string) => received.push(msg) };

    service.subscribe('tx-1', mockWs1);
    service.subscribe('tx-1', mockWs2);

    const data = { type: 'PAYMENT_SUCCESS', transactionId: 'tx-1', amount: 10025 };
    service.broadcast('tx-1', data);

    expect(received.length).toBe(2);
    expect(JSON.parse(received[0])).toEqual(data);
    expect(JSON.parse(received[1])).toEqual(data);
  });

  it('should not broadcast to subscribers of a different transactionId', () => {
    const received: string[] = [];
    const mockWs1 = { send: (msg: string) => received.push(msg) };
    const mockWs2 = { send: (msg: string) => received.push(msg) };

    service.subscribe('tx-1', mockWs1);
    service.subscribe('tx-2', mockWs2);

    service.broadcast('tx-1', { type: 'PAYMENT_SUCCESS' });

    expect(received.length).toBe(1);
  });

  it('should remove broken connections during broadcast', () => {
    const mockWs1 = {
      send: () => {
        throw new Error('Connection closed');
      },
    };
    const mockWs2 = { send: () => {} };

    service.subscribe('tx-1', mockWs1);
    service.subscribe('tx-1', mockWs2);

    service.broadcast('tx-1', { type: 'PAYMENT_SUCCESS' });

    // Broken connection should be removed
    expect(service.getSubscriberCount('tx-1')).toBe(1);
  });

  it('should handle broadcast with no subscribers gracefully', () => {
    // Should not throw
    service.broadcast('non-existent', { type: 'PAYMENT_SUCCESS' });
  });

  it('should support multiple subscribers for same transactionId', () => {
    const mockWs1 = { send: () => {} };
    const mockWs2 = { send: () => {} };
    const mockWs3 = { send: () => {} };

    service.subscribe('tx-1', mockWs1);
    service.subscribe('tx-1', mockWs2);
    service.subscribe('tx-1', mockWs3);

    expect(service.getSubscriberCount('tx-1')).toBe(3);
  });

  it('should cleanup empty subscriber sets after last unsubscribe', () => {
    const mockWs = { send: () => {} };
    service.subscribe('tx-1', mockWs);
    service.unsubscribe('tx-1', mockWs);
    // Internal map should not hold empty sets
    expect(service.getSubscriberCount('tx-1')).toBe(0);
  });
});
