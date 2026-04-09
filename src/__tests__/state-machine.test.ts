/**
 * Tests de integración de la máquina de estados.
 * Mockea Redis, DB y WhatsApp para testear solo la lógica de transiciones.
 */

// Mock de módulos externos antes de cualquier import
jest.mock('../redis/session-manager');
jest.mock('../agent/customer-service');
jest.mock('../whatsapp/client');
jest.mock('../menu/config-service');

import { handleMessage } from '../agent/conversation-agent';
import * as sessionManager from '../redis/session-manager';
import * as customerService from '../agent/customer-service';
import * as configService from '../menu/config-service';
import { whatsappClient } from '../whatsapp/client';
import type { IncomingMessage } from '../agent/types';
import type { SessionData } from '../redis/session-manager';
import type { Customer } from '@prisma/client';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeMsg(overrides: Partial<IncomingMessage> = {}): IncomingMessage {
  return {
    messageId: 'msg-test-1',
    phone: '584141111111',
    type: 'text',
    text: 'Hola',
    timestamp: Date.now(),
    ...overrides,
  };
}

function makeSession(overrides: Partial<SessionData> = {}): SessionData {
  return {
    state: 'IDLE',
    phone: '584141111111',
    cart: [],
    messageCount: 0,
    lastActivity: Date.now(),
    ...overrides,
  };
}

function makeCustomer(overrides: Partial<Customer> = {}): Customer {
  return {
    id: 'customer-1',
    phone: '584141111111',
    name: null,
    isActive: true,
    savedAddress: null,
    conversationState: { state: 'IDLE' },
    sessionExpiresAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  };
}

// ─── Setup global ─────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();

  // Defaults: negocio activo, admin diferente
  (configService.isBusinessActive as jest.Mock).mockResolvedValue(true);
  (configService.getConfig as jest.Mock).mockImplementation(async (key: string) => {
    const configs: Record<string, string> = {
      RESTAURANT_NAME: 'Burger Express',
      ADMIN_PHONE: '584149999999',
      RESTAURANT_HOURS: 'Lun-Dom 11am-10pm',
    };
    return configs[key] ?? null;
  });

  // WA client — no hacer nada real
  (whatsappClient.sendMessage as jest.Mock).mockResolvedValue('msg-sent');
  (whatsappClient.markAsRead as jest.Mock).mockResolvedValue(undefined);

  // Customer service
  (customerService.findOrCreateCustomer as jest.Mock).mockResolvedValue(makeCustomer());
  (customerService.isSessionExpired as jest.Mock).mockReturnValue(false);
  (customerService.updateCustomerConversationState as jest.Mock).mockResolvedValue(undefined);
  (customerService.updateCustomerName as jest.Mock).mockResolvedValue(undefined);

  // Session manager
  (sessionManager.createDefaultSession as jest.Mock).mockImplementation(
    async (phone: string) => makeSession({ phone }),
  );
  (sessionManager.updateSessionState as jest.Mock).mockImplementation(
    async (phone: string, state: SessionData['state'], extra?: Partial<SessionData>) =>
      makeSession({ phone, state, ...extra }),
  );
  // updateCustomerConversationState lives in customer-service, already mocked above
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('IDLE → AWAITING_NAME (cliente nuevo)', () => {
  test('nuevo cliente sin nombre recibe welcome y va a AWAITING_NAME', async () => {
    (sessionManager.getSession as jest.Mock).mockResolvedValue(null);
    (customerService.findOrCreateCustomer as jest.Mock).mockResolvedValue(makeCustomer({ name: null }));

    await handleMessage(makeMsg({ text: 'Hola' }));

    expect(sessionManager.updateSessionState).toHaveBeenCalledWith(
      expect.any(String),
      'AWAITING_NAME',
      expect.any(Object),
    );
    expect(whatsappClient.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'text' }),
    );
  });

  test('negocio cerrado → envía mensaje de cerrado sin cambiar estado', async () => {
    (configService.isBusinessActive as jest.Mock).mockResolvedValue(false);
    (sessionManager.getSession as jest.Mock).mockResolvedValue(makeSession({ state: 'IDLE' }));

    await handleMessage(makeMsg());

    // No debe cambiar de estado
    expect(sessionManager.updateSessionState).not.toHaveBeenCalled();
    // Debe enviar mensaje de cerrado
    expect(whatsappClient.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'text',
        text: expect.objectContaining({ body: expect.stringContaining('cerrado') }),
      }),
    );
  });

  test('número del admin activa ADMIN_MODE', async () => {
    const adminPhone = '584149999999';
    (sessionManager.getSession as jest.Mock).mockResolvedValue(makeSession({ phone: adminPhone, state: 'IDLE' }));
    (customerService.findOrCreateCustomer as jest.Mock).mockResolvedValue(makeCustomer({ phone: adminPhone }));
    (customerService.isSessionExpired as jest.Mock).mockReturnValue(false);

    await handleMessage(makeMsg({ phone: adminPhone }));

    expect(sessionManager.updateSessionState).toHaveBeenCalledWith(
      adminPhone,
      'ADMIN_MODE',
      expect.any(Object),
    );
  });

  test('cliente con nombre en sesión expirada recibe bienvenida y va a MAIN_MENU', async () => {
    (customerService.isSessionExpired as jest.Mock).mockReturnValue(true);
    (sessionManager.getSession as jest.Mock).mockResolvedValue(
      makeSession({ state: 'ORDER_DELIVERED', customerName: 'Luis' }),
    );
    (customerService.findOrCreateCustomer as jest.Mock).mockResolvedValue(
      makeCustomer({ name: 'Luis', sessionExpiresAt: new Date(Date.now() - 1000) }),
    );

    await handleMessage(makeMsg());

    expect(sessionManager.updateSessionState).toHaveBeenCalledWith(
      expect.any(String),
      'MAIN_MENU',
      expect.any(Object),
    );
  });
});

describe('AWAITING_NAME → validación', () => {
  beforeEach(() => {
    (sessionManager.getSession as jest.Mock).mockResolvedValue(
      makeSession({ state: 'AWAITING_NAME', customerId: 'customer-1' }),
    );
    (customerService.findOrCreateCustomer as jest.Mock).mockResolvedValue(makeCustomer());
  });

  test('nombre válido → MAIN_MENU', async () => {
    await handleMessage(makeMsg({ text: 'Carlos' }));

    expect(sessionManager.updateSessionState).toHaveBeenCalledWith(
      expect.any(String),
      'MAIN_MENU',
      expect.objectContaining({ customerName: 'Carlos' }),
    );
  });

  test('nombre de una letra → se queda en AWAITING_NAME (retry A)', async () => {
    await handleMessage(makeMsg({ text: 'A' }));

    expect(sessionManager.updateSessionState).not.toHaveBeenCalledWith(
      expect.any(String),
      'MAIN_MENU',
      expect.any(Object),
    );
    expect(whatsappClient.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.objectContaining({ body: expect.stringContaining('2 letras') }) }),
    );
  });

  test('solo números → retry B', async () => {
    await handleMessage(makeMsg({ text: '123456' }));

    expect(whatsappClient.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.objectContaining({ body: expect.stringContaining('número') }) }),
    );
  });

  test('nombre con emojis → retry C', async () => {
    await handleMessage(makeMsg({ text: '🍔🍔🍔' }));

    expect(whatsappClient.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.objectContaining({ body: expect.stringContaining('nombre') }) }),
    );
  });

  test('imagen en AWAITING_NAME → retry C', async () => {
    const imgMsg: IncomingMessage = { messageId: 'msg-img', phone: '584141111111', type: 'image', imageId: 'img-1', timestamp: Date.now() };
    await handleMessage(imgMsg);

    expect(sessionManager.updateSessionState).not.toHaveBeenCalledWith(
      expect.any(String),
      'MAIN_MENU',
      expect.any(Object),
    );
  });
});

describe('MAIN_MENU → navegación', () => {
  beforeEach(() => {
    (sessionManager.getSession as jest.Mock).mockResolvedValue(
      makeSession({ state: 'MAIN_MENU', customerName: 'Luis', customerId: 'customer-1' }),
    );
  });

  test('botón "Ver Menú" → BROWSE_CATEGORIES', async () => {
    await handleMessage(
      makeMsg({
        type: 'interactive',
        interactiveReply: { type: 'button_reply', id: 'menu_browse', title: '🍔 Ver Menú' },
      }),
    );

    expect(sessionManager.updateSessionState).toHaveBeenCalledWith(
      expect.any(String),
      'BROWSE_CATEGORIES',
      expect.any(Object),
    );
  });

  test('botón "Hablar con humano" → AWAITING_HUMAN', async () => {
    await handleMessage(
      makeMsg({
        type: 'interactive',
        interactiveReply: { type: 'button_reply', id: 'menu_human', title: '🧑 Humano' },
      }),
    );

    expect(sessionManager.updateSessionState).toHaveBeenCalledWith(
      expect.any(String),
      'AWAITING_HUMAN',
      expect.any(Object),
    );
  });

  test('texto "menú" → re-muestra el menú sin cambiar estado', async () => {
    await handleMessage(makeMsg({ text: 'menú' }));

    expect(sessionManager.updateSessionState).not.toHaveBeenCalledWith(
      expect.any(String),
      expect.not.stringContaining('MAIN_MENU'),
      expect.any(Object),
    );
    expect(whatsappClient.sendMessage).toHaveBeenCalled();
  });
});
