/**
 * CustomerStats — computes and persists per-customer analytics.
 *
 * Called after an order reaches DELIVERED status.
 */
import { prisma } from '../db/prisma';
import { logger } from '../utils/logger';

/**
 * Recalculates and upserts stats for a customer based on all their
 * completed (DELIVERED) orders.
 */
export async function finalizeCustomerStats(customerId: string): Promise<void> {
  try {
    const orders = await prisma.order.findMany({
      where: { customerId, status: 'DELIVERED' },
      include: { items: { include: { menuItem: true } } },
    });

    if (orders.length === 0) return;

    const totalOrders = orders.length;
    const totalSpentUsd = orders.reduce(
      (sum, o) => sum + Number(o.totalUsd),
      0,
    );
    const totalSpentBs = orders.reduce(
      (sum, o) => sum + Number(o.totalBs),
      0,
    );
    const avgOrderValueUsd = totalSpentUsd / totalOrders;

    const sortedByDate = [...orders].sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
    );
    const firstOrderAt = sortedByDate[0].createdAt;
    const lastOrderAt = sortedByDate[sortedByDate.length - 1].createdAt;

    // Count item occurrences across all delivered orders
    const itemCounts = new Map<string, { name: string; count: number }>();
    for (const order of orders) {
      for (const item of order.items) {
        const existing = itemCounts.get(item.menuItemId);
        if (existing) {
          existing.count += item.quantity;
        } else {
          itemCounts.set(item.menuItemId, {
            name: item.menuItem?.name ?? 'Desconocido',
            count: item.quantity,
          });
        }
      }
    }

    let favoriteItemId: string | null = null;
    let favoriteItemName: string | null = null;
    let maxCount = 0;
    for (const [id, { name, count }] of itemCounts) {
      if (count > maxCount) {
        maxCount = count;
        favoriteItemId = id;
        favoriteItemName = name;
      }
    }

    // Also count cancelled orders separately
    const cancelledOrders = await prisma.order.count({
      where: { customerId, status: 'CANCELLED' },
    });

    await prisma.customerStats.upsert({
      where: { customerId },
      create: {
        customerId,
        totalOrders,
        completedOrders: totalOrders,
        cancelledOrders,
        totalSpentUsd,
        totalSpentBs,
        avgOrderValueUsd,
        firstOrderAt,
        lastOrderAt,
        favoriteItemId,
        favoriteItemName,
      },
      update: {
        totalOrders,
        completedOrders: totalOrders,
        cancelledOrders,
        totalSpentUsd,
        totalSpentBs,
        avgOrderValueUsd,
        firstOrderAt,
        lastOrderAt,
        favoriteItemId,
        favoriteItemName,
      },
    });

    logger.info({ customerId, totalOrders, totalSpentUsd }, 'Customer stats updated');
  } catch (err) {
    logger.error({ err, customerId }, 'Failed to update customer stats');
    // Non-fatal — don't throw
  }
}

/**
 * Returns stats for a single customer, or null if none.
 */
export async function getCustomerStats(customerId: string) {
  return prisma.customerStats.findUnique({
    where: { customerId },
    include: { customer: true },
  });
}

/**
 * Returns top N customers by total spent USD.
 */
export async function getTopCustomers(limit = 10) {
  return prisma.customerStats.findMany({
    orderBy: { totalSpentUsd: 'desc' },
    take: limit,
    include: { customer: true },
  });
}
