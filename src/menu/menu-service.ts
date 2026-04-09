/**
 * Servicio de menú con cache Redis (TTL 5 min).
 * Precios en USD desde DB, convertidos a Bs en tiempo de ejecución.
 */
import type { MenuItem, MenuCategory } from '@prisma/client';
import { prisma } from '../db/prisma';
import { redisClient } from '../redis/client';
import { getExchangeRate, usdToBs, invalidateMenuCache } from './config-service';
import { logger } from '../utils/logger';

const MENU_CACHE_TTL = 300; // 5 minutos
const MENU_CACHE_KEY = 'menu:full';
const CATEGORY_CACHE_PREFIX = 'menu:cat:';

// ─── Tipos enriquecidos ───────────────────────────────────────────────────────

export interface MenuItemWithBs extends MenuItem {
  priceBs: number;
  priceUsdNum: number;
}

export interface CategoryWithItems extends MenuCategory {
  items: MenuItemWithBs[];
}

// ─── Loaders ─────────────────────────────────────────────────────────────────

export async function getActiveCategories(): Promise<MenuCategory[]> {
  const cacheKey = 'menu:categories';
  const cached = await redisClient.get(cacheKey);
  if (cached) return JSON.parse(cached) as MenuCategory[];

  const categories = await prisma.menuCategory.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: 'asc' },
  });

  await redisClient.setex(cacheKey, MENU_CACHE_TTL, JSON.stringify(categories));
  return categories;
}

export async function getItemsByCategory(categoryId: string): Promise<MenuItemWithBs[]> {
  const cacheKey = `${CATEGORY_CACHE_PREFIX}${categoryId}`;
  const rate = await getExchangeRate();

  const cached = await redisClient.get(cacheKey);
  if (cached) {
    const items = JSON.parse(cached) as MenuItem[];
    return items.map((i) => enrichWithBs(i, rate));
  }

  const items = await prisma.menuItem.findMany({
    where: { categoryId, isAvailable: true, deletedAt: null },
    orderBy: { sortOrder: 'asc' },
  });

  await redisClient.setex(cacheKey, MENU_CACHE_TTL, JSON.stringify(items));
  return items.map((i) => enrichWithBs(i, rate));
}

export async function getItemById(itemId: string): Promise<MenuItemWithBs | null> {
  const item = await prisma.menuItem.findFirst({
    where: { id: itemId, isAvailable: true, deletedAt: null },
  });
  if (!item) return null;
  const rate = await getExchangeRate();
  return enrichWithBs(item, rate);
}

export async function getActiveMenuForLlm(): Promise<CategoryWithItems[]> {
  const cacheKey = MENU_CACHE_KEY;
  const rate = await getExchangeRate();

  const cached = await redisClient.get(cacheKey);
  if (cached) {
    const cats = JSON.parse(cached) as CategoryWithItems[];
    // Re-calcular precios Bs con tasa actual (podría haber cambiado)
    return cats.map((c) => ({
      ...c,
      items: c.items.map((i) => enrichWithBs(i, rate)),
    }));
  }

  const categories = await prisma.menuCategory.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: 'asc' },
    include: {
      items: {
        where: { isAvailable: true, deletedAt: null },
        orderBy: { sortOrder: 'asc' },
      },
    },
  });

  const enriched: CategoryWithItems[] = categories.map((c) => ({
    ...c,
    items: c.items.map((i) => enrichWithBs(i, rate)),
  }));

  await redisClient.setex(cacheKey, MENU_CACHE_TTL, JSON.stringify(enriched));
  return enriched;
}

export { invalidateMenuCache };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function enrichWithBs(item: MenuItem, rate: number): MenuItemWithBs {
  const priceUsdNum = parseFloat(item.priceUsd.toString());
  return {
    ...item,
    priceUsdNum,
    priceBs: usdToBs(priceUsdNum, rate),
  };
}
