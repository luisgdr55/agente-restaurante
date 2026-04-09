/**
 * Tests for OCR service — text extraction and reference parsing logic.
 * Note: extractTextFromImage() (real tesseract) is NOT tested here to avoid
 * slow I/O in CI. We test the pure parsing functions instead.
 */
import { extractReference, isPaymentReceipt } from '../ocr/ocr-service';

describe('extractReference', () => {
  it('extracts a 20-digit reference number', () => {
    const text = 'Referencia: 12345678901234567890 aprobado';
    expect(extractReference(text)).toBe('12345678901234567890');
  });

  it('extracts 15-digit reference', () => {
    const text = 'Ref 123456789012345 OK';
    expect(extractReference(text)).toBe('123456789012345');
  });

  it('returns null when no reference found', () => {
    expect(extractReference('Hola como estas')).toBeNull();
  });

  it('ignores numbers shorter than 15 digits', () => {
    expect(extractReference('Monto: 1234.50 Bs')).toBeNull();
  });

  it('picks longest number when multiple candidates', () => {
    const text = 'Ref 1234567890123456 operacion 123456789012345678';
    const result = extractReference(text);
    expect(result).toBe('123456789012345678'); // 18 > 16 digits
  });

  it('handles numbers separated by spaces (normalizes them)', () => {
    // "123 456 789 012 345" → "12345678901234 5" → still extracted
    const text = 'Referencia: 1234 5678 9012 3456 7890';
    const result = extractReference(text);
    // After normalization removes spaces between digits: 12345678901234567890
    expect(result).toBe('12345678901234567890');
  });

  it('handles numbers separated by hyphens', () => {
    const text = 'Ref: 12345-67890-12345';
    const result = extractReference(text);
    expect(result).toBe('123456789012345');
  });
});

describe('isPaymentReceipt', () => {
  it('returns true for text with payment keywords', () => {
    const text = 'Pago Móvil exitoso. Banco de Venezuela. Monto: Bs 180.00';
    expect(isPaymentReceipt(text)).toBe(true);
  });

  it('returns true for transferencia + referencia', () => {
    const text = 'Transferencia completada. Referencia: 12345678901234567890';
    expect(isPaymentReceipt(text)).toBe(true);
  });

  it('returns false for generic text', () => {
    expect(isPaymentReceipt('Hola, ¿cómo estás?')).toBe(false);
  });

  it('returns false with only one keyword', () => {
    expect(isPaymentReceipt('Banco')).toBe(false);
  });

  it('returns true for aprobado + banco', () => {
    expect(isPaymentReceipt('Operacion aprobada. Banco Mercantil.')).toBe(true);
  });
});

describe('awaiting-payment-proof handler with OCR', () => {
  const mockUpdateSessionState = jest.fn(async (phone: string, state: string, data: object) => ({
    state,
    phone,
    cart: [],
    ...data,
  }));
  const mockSendMessage = jest.fn().mockResolvedValue(undefined);
  const mockUpdateOrderStatus = jest.fn().mockResolvedValue({ id: 'order-1' });
  const mockGetOrderById = jest.fn().mockResolvedValue({
    id: 'order-1',
    totalBs: '180.00',
    customer: { phone: '14155551234', name: 'Test' },
  });
  const mockOcrQueueAdd = jest.fn().mockResolvedValue({ id: 'job-1' });
  const mockNotifyPaymentReceived = jest.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('enqueues OCR job and transitions to PAYMENT_UNDER_REVIEW for image', async () => {
    jest.mock('../redis/session-manager', () => ({
      updateSessionState: mockUpdateSessionState,
    }));
    jest.mock('../whatsapp/client', () => ({
      whatsappClient: { sendMessage: mockSendMessage },
    }));
    jest.mock('../orders/order-service', () => ({
      updateOrderStatus: mockUpdateOrderStatus,
      getOrderById: mockGetOrderById,
      shortOrderId: (id: string) => id.slice(-6).toUpperCase(),
    }));
    jest.mock('../workers/queues', () => ({
      ocrQueue: { add: mockOcrQueueAdd },
    }));
    jest.mock('../notifications/admin-notifier', () => ({
      notifyPaymentReceived: mockNotifyPaymentReceived,
    }));

    const { handleAwaitingPaymentProof } = await import('../agent/handlers/awaiting-payment-proof.handler');

    const session = {
      state: 'AWAITING_PAYMENT_PROOF',
      phone: '14155551234',
      customerId: 'cust-1',
      customerName: 'Test',
      cart: [],
      activeOrderId: 'order-uuid-1234567890ab',
      deliveryType: 'PICKUP',
    } as any;

    const msg = {
      phone: '14155551234',
      messageId: 'msg-1',
      type: 'image',
      imageId: 'media-abc-123',
      timestamp: Date.now(),
    } as any;

    await handleAwaitingPaymentProof(msg, session);

    // Should update order with image URL
    expect(mockUpdateOrderStatus).toHaveBeenCalledWith(
      'order-uuid-1234567890ab',
      'PAYMENT_UPLOADED',
      expect.objectContaining({ paymentImageUrl: 'wa_media:media-abc-123' }),
    );

    // Should enqueue OCR job
    expect(mockOcrQueueAdd).toHaveBeenCalledWith(
      'ocr-payment',
      expect.objectContaining({ mediaId: 'media-abc-123', orderId: 'order-uuid-1234567890ab' }),
      expect.any(Object),
    );

    // Should NOT call notifyPaymentReceived (that's the OCR worker's job)
    expect(mockNotifyPaymentReceived).not.toHaveBeenCalled();

    // Should transition to PAYMENT_UNDER_REVIEW
    expect(mockUpdateSessionState).toHaveBeenCalledWith(
      '14155551234',
      'PAYMENT_UNDER_REVIEW',
      expect.any(Object),
    );
  });
});
