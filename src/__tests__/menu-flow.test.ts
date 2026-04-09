/**
 * Tests del flujo de menú (Paso 4):
 * BROWSE_CATEGORIES → BROWSE_ITEMS → BUILDING_ORDER
 */

jest.mock('../redis/session-manager');
jest.mock('../agent/customer-service');
jest.mock('../whatsapp/client');
jest.mock('../menu/config-service');
jest.mock('../menu/menu-service');
jest.mock('../llm/gemini-client');
jest.mock('../db/prisma', () => ({ prisma: { llmUsageLog: { create: jest.fn().mockResolvedValue({}) } } }));

import { handleMessage } from '../agent/conversation-agent';
import * as sessionManager from '../redis/session-manager';
import * as customerService from '../agent/customer-service';
import * as configService from '../menu/config-service';
import * as menuService from '../menu/menu-service';
import { whatsappClient } from '../whatsapp/client';
import type { IncomingMessage } from '../agent/types';
import type { SessionData } from '../redis/session-manager';
import type { Customer } from '@prisma/client';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const PHONE = '584141111111';

function makeMsg(overrides: Partial<IncomingMessage> = {}): IncomingMessage {
  return {
    messageId: `msg-${Date.now()}`,
    phone: PHONE,
    type: 'text',
    text: 'test',
    timestamp: Date.now(),
    ...overrides,
  };
}

function makeSession(overrides: Partial<SessionData> = {}): SessionData {
  return {
    state: 'BROWSE_CATEGORIES',
    phone: PHONE,
    cart: [],
    customerName: 'Luis',
    customerId: 'cust-1',
    messageCount: 1,
    lastActivity: Date.now(),
    ...overrides,
  };
}

function makeCustomer(): Customer {
  return {
    id: 'cust-1', phone: PHONE, name: 'Luis', isActive: true,
    savedAddress: null,
    conversationState: { state: 'BROWSE_CATEGORIES' }, sessionExpiresAt: null,
    createdAt: new Date(), updatedAt: new Date(), deletedAt: null,
  };
}

const mockCategories = [
  { id: 'cat-burgers', name: 'Hamburguesas', emoji: '🍔', sortOrder: 1, isActive: true, createdAt: new Date(), updatedAt: new Date() },
  { id: 'cat-drinks', name: 'Bebidas', emoji: '🥤', sortOrder: 2, isActive: true, createdAt: new Date(), updatedAt: new Date() },
];

const mockItems = [
  {
    id: 'item-big', categoryId: 'cat-burgers', name: 'Big Burger',
    description: 'Doble carne', priceUsd: { toString: () => '6.50' } as any,
    priceUsdNum: 6.50, priceBs: 237.25, imageUrl: null,
    isAvailable: true, sortOrder: 1, createdAt: new Date(), updatedAt: new Date(), deletedAt: null,
  },
  {
    id: 'item-classic', categoryId: 'cat-burgers', name: 'Clásica',
    description: 'Carne, lechuga, tomate', priceUsd: { toString: () => '4.50' } as any,
    priceUsdNum: 4.50, priceBs: 164.25, imageUrl: null,
    isAvailable: true, sortOrder: 2, createdAt: new Date(), updatedAt: new Date(), deletedAt: null,
  },
];

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();

  (configService.isBusinessActive as jest.Mock).mockResolvedValue(true);
  (configService.getConfig as jest.Mock).mockImplementation(async (key: string) => {
    const map: Record<string, string> = {
      ADMIN_PHONE: '584149999999',
      DELIVERY_FEE_USD: '1.50',
      MIN_ORDER_USD: '3.00',
      RESTAURANT_HOURS: 'Lun-Dom 11am-10pm',
    };
    return map[key] ?? null;
  });
  (configService.getExchangeRate as jest.Mock).mockResolvedValue(36.5);
  (configService.usdToBs as jest.Mock).mockImplementation((usd: number, rate: number) => Math.round(usd * rate * 100) / 100);

  (menuService.getActiveCategories as jest.Mock).mockResolvedValue(mockCategories);
  (menuService.getItemsByCategory as jest.Mock).mockResolvedValue(mockItems);
  (menuService.getItemById as jest.Mock).mockResolvedValue(mockItems[0]);

  (customerService.findOrCreateCustomer as jest.Mock).mockResolvedValue(makeCustomer());
  (customerService.isSessionExpired as jest.Mock).mockReturnValue(false);
  (customerService.updateCustomerConversationState as jest.Mock).mockResolvedValue(undefined);
  (customerService.updateCustomerName as jest.Mock).mockResolvedValue(undefined);

  (whatsappClient.sendMessage as jest.Mock).mockResolvedValue('msg-sent');
  (whatsappClient.markAsRead as jest.Mock).mockResolvedValue(undefined);

  (sessionManager.createDefaultSession as jest.Mock).mockImplementation(
    async (phone: string) => makeSession({ phone }),
  );
  (sessionManager.updateSessionState as jest.Mock).mockImplementation(
    async (phone: string, state: SessionData['state'], extra?: object) =>
      makeSession({ phone, state, ...extra }),
  );
  (sessionManager.isMessageProcessed as jest.Mock).mockResolvedValue(false);
});

// ─── Tests BROWSE_CATEGORIES ──────────────────────────────────────────────────

describe('BROWSE_CATEGORIES', () => {
  beforeEach(() => {
    (sessionManager.getSession as jest.Mock).mockResolvedValue(
      makeSession({ state: 'BROWSE_CATEGORIES' }),
    );
  });

  test('muestra lista de categorías al entrar', async () => {
    await handleMessage(makeMsg({ type: 'text', text: 'ver menú' }));

    expect(whatsappClient.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'interactive' }),
    );
  });

  test('seleccionar categoría → BROWSE_ITEMS con currentCategoryId', async () => {
    await handleMessage(
      makeMsg({
        type: 'interactive',
        interactiveReply: { type: 'list_reply', id: 'cat:cat-burgers', title: '🍔 Hamburguesas' },
      }),
    );

    expect(sessionManager.updateSessionState).toHaveBeenCalledWith(
      PHONE,
      'BROWSE_ITEMS',
      expect.objectContaining({ currentCategoryId: 'cat-burgers' }),
    );
  });

  test('texto "menú" → MAIN_MENU', async () => {
    await handleMessage(makeMsg({ text: 'menú' }));

    expect(sessionManager.updateSessionState).toHaveBeenCalledWith(
      PHONE, 'MAIN_MENU', expect.any(Object),
    );
  });

  test('carrito vacío + "carrito" → muestra aviso sin cambiar estado', async () => {
    await handleMessage(makeMsg({ text: 'carrito' }));

    expect(sessionManager.updateSessionState).not.toHaveBeenCalledWith(
      PHONE, 'BUILDING_ORDER', expect.any(Object),
    );
    expect(whatsappClient.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.objectContaining({ body: expect.stringContaining('vacío') }) }),
    );
  });
});

// ─── Tests BROWSE_ITEMS ───────────────────────────────────────────────────────

describe('BROWSE_ITEMS', () => {
  beforeEach(() => {
    (sessionManager.getSession as jest.Mock).mockResolvedValue(
      makeSession({ state: 'BROWSE_ITEMS', currentCategoryId: 'cat-burgers' }),
    );
  });

  test('muestra lista de ítems al entrar', async () => {
    await handleMessage(makeMsg({ type: 'text', text: 'ver' }));

    expect(menuService.getItemsByCategory).toHaveBeenCalledWith('cat-burgers');
    expect(whatsappClient.sendMessage).toHaveBeenCalled();
  });

  test('seleccionar ítem → añade al carrito, permanece en BROWSE_ITEMS', async () => {
    await handleMessage(
      makeMsg({
        type: 'interactive',
        interactiveReply: { type: 'list_reply', id: 'item:item-big', title: 'Big Burger' },
      }),
    );

    expect(menuService.getItemById).toHaveBeenCalledWith('item-big');
    expect(sessionManager.updateSessionState).toHaveBeenCalledWith(
      PHONE,
      'BROWSE_ITEMS',
      expect.objectContaining({
        cart: expect.arrayContaining([
          expect.objectContaining({ menuItemId: 'item-big', quantity: 1 }),
        ]),
      }),
    );
    // Debe mostrar confirmación con botones
    expect(whatsappClient.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'interactive',
        interactive: expect.objectContaining({
          body: expect.objectContaining({ text: expect.stringContaining('añadido') }),
        }),
      }),
    );
  });

  test('botón "atrás" → BROWSE_CATEGORIES', async () => {
    await handleMessage(
      makeMsg({
        type: 'interactive',
        interactiveReply: { type: 'button_reply', id: 'back_categories', title: 'Categorías' },
      }),
    );

    expect(sessionManager.updateSessionState).toHaveBeenCalledWith(
      PHONE, 'BROWSE_CATEGORIES', expect.any(Object),
    );
  });

  test('botón "ver carrito" con items → BUILDING_ORDER', async () => {
    (sessionManager.getSession as jest.Mock).mockResolvedValue(
      makeSession({
        state: 'BROWSE_ITEMS',
        currentCategoryId: 'cat-burgers',
        cart: [{ menuItemId: 'item-big', name: 'Big Burger', quantity: 1, unitPriceUsd: 6.50 }],
      }),
    );

    await handleMessage(
      makeMsg({
        type: 'interactive',
        interactiveReply: { type: 'button_reply', id: 'cart_view', title: '🛒 Carrito' },
      }),
    );

    expect(sessionManager.updateSessionState).toHaveBeenCalledWith(
      PHONE, 'BUILDING_ORDER', expect.any(Object),
    );
  });
});

// ─── Tests BUILDING_ORDER ─────────────────────────────────────────────────────

describe('BUILDING_ORDER', () => {
  const cart = [
    { menuItemId: 'item-big', name: 'Big Burger', quantity: 2, unitPriceUsd: 6.50 },
    { menuItemId: 'item-classic', name: 'Clásica', quantity: 1, unitPriceUsd: 4.50 },
  ];

  beforeEach(() => {
    (sessionManager.getSession as jest.Mock).mockResolvedValue(
      makeSession({ state: 'BUILDING_ORDER', cart }),
    );
  });

  test('muestra resumen del carrito con botones de acción', async () => {
    await handleMessage(makeMsg({ text: 'ver carrito' }));

    expect(whatsappClient.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'interactive',
        interactive: expect.objectContaining({
          body: expect.objectContaining({ text: expect.stringContaining('Big Burger') }),
        }),
      }),
    );
  });

  test('botón confirmar → ORDER_CONFIRMATION', async () => {
    await handleMessage(
      makeMsg({
        type: 'interactive',
        interactiveReply: { type: 'button_reply', id: 'order_confirm', title: '✅ Confirmar' },
      }),
    );

    expect(sessionManager.updateSessionState).toHaveBeenCalledWith(
      PHONE, 'ORDER_CONFIRMATION', expect.any(Object),
    );
  });

  test('botón seguir comprando → BROWSE_CATEGORIES', async () => {
    await handleMessage(
      makeMsg({
        type: 'interactive',
        interactiveReply: { type: 'button_reply', id: 'order_continue', title: '🛍️ Seguir' },
      }),
    );

    expect(sessionManager.updateSessionState).toHaveBeenCalledWith(
      PHONE, 'BROWSE_CATEGORIES', expect.any(Object),
    );
  });

  test('vaciar carrito → BROWSE_CATEGORIES con carrito vacío', async () => {
    await handleMessage(
      makeMsg({
        type: 'interactive',
        interactiveReply: { type: 'button_reply', id: 'order_clear', title: '🗑️ Vaciar' },
      }),
    );

    expect(sessionManager.updateSessionState).toHaveBeenCalledWith(
      PHONE,
      'BROWSE_CATEGORIES',
      expect.objectContaining({ cart: [] }),
    );
  });

  test('carrito vacío → redirige a BROWSE_CATEGORIES automáticamente', async () => {
    (sessionManager.getSession as jest.Mock).mockResolvedValue(
      makeSession({ state: 'BUILDING_ORDER', cart: [] }),
    );

    await handleMessage(makeMsg({ text: 'ver pedido' }));

    expect(sessionManager.updateSessionState).toHaveBeenCalledWith(
      PHONE, 'BROWSE_CATEGORIES', expect.any(Object),
    );
  });
});
