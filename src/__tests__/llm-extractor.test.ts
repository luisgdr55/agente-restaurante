/**
 * Tests del extractor de pedidos LLM.
 * Mockea OpenAI/OpenRouter para no hacer llamadas reales.
 */

// Mock de la instancia de OpenAI — intercepta chat.completions.create
const mockCreate = jest.fn();

jest.mock('openai', () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      chat: { completions: { create: mockCreate } },
    })),
  };
});

jest.mock('../db/prisma', () => ({
  prisma: {
    llmUsageLog: { create: jest.fn().mockResolvedValue({}) },
  },
}));

import { extractOrderFromText } from '../llm/gemini-client';
import type { CategoryWithItems } from '../menu/menu-service';

// ─── Menu de prueba ───────────────────────────────────────────────────────────

const mockMenu: CategoryWithItems[] = [
  {
    id: 'cat-burgers', name: 'Hamburguesas', emoji: '🍔', sortOrder: 1,
    isActive: true, createdAt: new Date(), updatedAt: new Date(),
    items: [
      {
        id: 'item-big', categoryId: 'cat-burgers', name: 'Big Burger',
        description: 'Doble carne', priceUsd: '6.50' as any,
        priceUsdNum: 6.50, priceBs: 237.25, imageUrl: null,
        isAvailable: true, sortOrder: 1, createdAt: new Date(), updatedAt: new Date(), deletedAt: null,
      },
      {
        id: 'item-classic', categoryId: 'cat-burgers', name: 'Clásica',
        description: 'Sencilla', priceUsd: '4.50' as any,
        priceUsdNum: 4.50, priceBs: 164.25, imageUrl: null,
        isAvailable: true, sortOrder: 2, createdAt: new Date(), updatedAt: new Date(), deletedAt: null,
      },
    ],
  },
  {
    id: 'cat-drinks', name: 'Bebidas', emoji: '🥤', sortOrder: 2,
    isActive: true, createdAt: new Date(), updatedAt: new Date(),
    items: [
      {
        id: 'item-coke', categoryId: 'cat-drinks', name: 'Coca-Cola',
        description: '500ml', priceUsd: '1.50' as any,
        priceUsdNum: 1.50, priceBs: 54.75, imageUrl: null,
        isAvailable: true, sortOrder: 1, createdAt: new Date(), updatedAt: new Date(), deletedAt: null,
      },
      {
        id: 'item-nestea', categoryId: 'cat-drinks', name: 'Nestea',
        description: 'Té helado', priceUsd: '1.50' as any,
        priceUsdNum: 1.50, priceBs: 54.75, imageUrl: null,
        isAvailable: true, sortOrder: 2, createdAt: new Date(), updatedAt: new Date(), deletedAt: null,
      },
    ],
  },
];

// ─── Helper para mockear respuesta de OpenAI ─────────────────────────────────

function mockOpenAIResponse(content: string) {
  mockCreate.mockResolvedValueOnce({
    choices: [{ message: { content } }],
    usage: { prompt_tokens: 150, completion_tokens: 50, total_tokens: 200 },
  });
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('extractOrderFromText', () => {
  test('extrae pedido simple correctamente', async () => {
    mockOpenAIResponse(
      JSON.stringify({
        items: [
          { menuItemId: 'item-big', name: 'Big Burger', quantity: 2 },
          { menuItemId: 'item-coke', name: 'Coca-Cola', quantity: 1 },
        ],
        ambiguous: [],
      }),
    );

    const result = await extractOrderFromText('quiero 2 big burger y una coca', mockMenu);

    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toMatchObject({ menuItemId: 'item-big', quantity: 2 });
    expect(result.items[1]).toMatchObject({ menuItemId: 'item-coke', quantity: 1 });
    expect(result.ambiguous).toHaveLength(0);
  });

  test('detecta ambigüedades correctamente', async () => {
    mockOpenAIResponse(
      JSON.stringify({
        items: [],
        ambiguous: [
          { userText: 'hamburguesa', candidates: ['Big Burger', 'Clásica'] },
        ],
      }),
    );

    const result = await extractOrderFromText('dame una hamburguesa', mockMenu);

    expect(result.ambiguous).toHaveLength(1);
    expect(result.ambiguous[0]?.userText).toBe('hamburguesa');
    expect(result.items).toHaveLength(0);
  });

  test('retorna vacío si LLM no reconoce nada', async () => {
    mockOpenAIResponse(JSON.stringify({ items: [], ambiguous: [] }));

    const result = await extractOrderFromText('hola qué tal', mockMenu);

    expect(result.items).toHaveLength(0);
    expect(result.ambiguous).toHaveLength(0);
  });

  test('limpia markdown del JSON de respuesta', async () => {
    mockOpenAIResponse(
      '```json\n{"items":[{"menuItemId":"item-nestea","name":"Nestea","quantity":1}],"ambiguous":[]}\n```',
    );

    const result = await extractOrderFromText('un nestea', mockMenu);

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.menuItemId).toBe('item-nestea');
  });

  test('JSON inválido del LLM → retorna vacío sin lanzar', async () => {
    mockOpenAIResponse('esto no es JSON válido {{{');

    const result = await extractOrderFromText('quiero algo', mockMenu);

    expect(result.items).toHaveLength(0);
    expect(result.ambiguous).toHaveLength(0);
  });

  test('LLM no disponible → lanza LLM_UNAVAILABLE', async () => {
    mockCreate.mockRejectedValueOnce(new Error('Connection refused'));

    await expect(extractOrderFromText('quiero algo', mockMenu)).rejects.toThrow('LLM_UNAVAILABLE');
  });
});
