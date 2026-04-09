/**
 * Genera los textos de reporte para enviar al admin por WhatsApp.
 * Soporta: diario, semanal, mensual.
 */
import { prisma } from '../db/prisma';
import { getConfig } from '../menu/config-service';
import { DAY_NAMES_FULL } from '../menu/promo-day-service';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function bs(n: number): string {
  return `Bs ${n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;
}

function usd(n: number): string {
  return `$${n.toFixed(2)}`;
}

function pct(curr: number, prev: number): string {
  if (prev === 0) return '';
  const diff = ((curr - prev) / prev) * 100;
  const arrow = diff >= 0 ? '📈' : '📉';
  return ` ${arrow} ${diff >= 0 ? '+' : ''}${diff.toFixed(1)}% vs período ant.`;
}

async function getBusinessName(): Promise<string> {
  const name = await getConfig('RESTAURANT_NAME').catch(() => null);
  return name ?? 'tu negocio';
}

async function aggregateOrders(from: Date, to?: Date) {
  const orders = await prisma.order.findMany({
    where: {
      createdAt: { gte: from, ...(to ? { lt: to } : {}) },
    },
    include: {
      items: { include: { menuItem: { select: { name: true } } } },
    },
  });

  const delivered  = orders.filter((o) => o.status === 'DELIVERED');
  const cancelled  = orders.filter((o) => o.status === 'CANCELLED');

  const grossBs  = delivered.reduce((s, o) => s + Number(o.totalBs),  0);
  const grossUsd = delivered.reduce((s, o) => s + Number(o.totalUsd), 0);

  // Top product by units sold
  const itemMap = new Map<string, number>();
  for (const o of delivered) {
    for (const i of o.items) {
      const name = i.menuItem?.name ?? '?';
      itemMap.set(name, (itemMap.get(name) ?? 0) + i.quantity);
    }
  }
  const topProduct = [...itemMap.entries()].sort((a, b) => b[1] - a[1])[0];

  return {
    total: orders.length,
    delivered: delivered.length,
    cancelled: cancelled.length,
    grossBs,
    grossUsd,
    avgTicketBs:  delivered.length > 0 ? grossBs  / delivered.length : 0,
    avgTicketUsd: delivered.length > 0 ? grossUsd / delivered.length : 0,
    topProduct: topProduct ? `${topProduct[0]} (${topProduct[1]} und)` : null,
  };
}

// ─── Reportes ─────────────────────────────────────────────────────────────────

export async function generateDailyReport(): Promise<string> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const [current, prev, businessName, todayRating] = await Promise.all([
    aggregateOrders(today),
    aggregateOrders(yesterday, today),
    getBusinessName(),
    prisma.review.aggregate({
      where: { createdAt: { gte: today } },
      _avg: { rating: true },
      _count: { rating: true },
    }),
  ]);

  const dayName = DAY_NAMES_FULL[new Date().getDay()] ?? '';
  const convPct = current.total > 0
    ? Math.round((current.delivered / (current.delivered + current.cancelled)) * 100)
    : 0;

  const lines = [
    `📊 *Resumen de hoy — ${businessName}*`,
    `_${dayName}, ${new Date().toLocaleDateString('es-VE')}_`,
    '',
    `🛒 Pedidos recibidos: *${current.total}*`,
    `✅ Entregados: *${current.delivered}*  |  ❌ Cancelados: *${current.cancelled}*`,
    `📊 Conversión: *${convPct}%*`,
    '',
    `💰 Ingresos brutos: *${bs(current.grossBs)}* (~${usd(current.grossUsd)})${pct(current.grossBs, prev.grossBs)}`,
    `🎟️ Ticket promedio: *${bs(current.avgTicketBs)}*${pct(current.avgTicketBs, prev.avgTicketBs)}`,
  ];

  if (current.topProduct) {
    lines.push(`🔥 Más vendido: *${current.topProduct}*`);
  }

  if (todayRating._count.rating > 0 && todayRating._avg.rating !== null) {
    lines.push(`⭐ Satisfacción: *${todayRating._avg.rating.toFixed(1)}/5* (${todayRating._count.rating} reseñas hoy)`);
  }

  if (current.delivered === 0) {
    lines.push('', '_Sin pedidos entregados hoy todavía._');
  }

  lines.push('', '_Sistema funcionando con normalidad ✅_');

  return lines.join('\n');
}

export async function generateWeeklyReport(): Promise<string> {
  const now = new Date();
  const thisWeekStart = new Date(now.getTime() - 7 * 86400_000);
  const prevWeekStart = new Date(now.getTime() - 14 * 86400_000);

  const [current, prev, businessName] = await Promise.all([
    aggregateOrders(thisWeekStart),
    aggregateOrders(prevWeekStart, thisWeekStart),
    getBusinessName(),
  ]);

  // Best day of the week
  const dayOrdersMap = new Map<number, number>();
  const thisWeekOrders = await prisma.order.findMany({
    where: { status: 'DELIVERED', createdAt: { gte: thisWeekStart } },
    select: { createdAt: true },
  });
  for (const o of thisWeekOrders) {
    const day = o.createdAt.getDay();
    dayOrdersMap.set(day, (dayOrdersMap.get(day) ?? 0) + 1);
  }
  const bestDayEntry = [...dayOrdersMap.entries()].sort((a, b) => b[1] - a[1])[0];
  const bestDay = bestDayEntry ? DAY_NAMES_FULL[bestDayEntry[0]] : null;

  const fromStr = thisWeekStart.toLocaleDateString('es-VE');
  const toStr   = now.toLocaleDateString('es-VE');

  const lines = [
    `📅 *Resumen semanal — ${businessName}*`,
    `_Del ${fromStr} al ${toStr}_`,
    '',
    `🛒 Total pedidos: *${current.total}*`,
    `✅ Entregados: *${current.delivered}*  |  ❌ Cancelados: *${current.cancelled}*`,
    '',
    `💰 Ingresos: *${bs(current.grossBs)}* (~${usd(current.grossUsd)})${pct(current.grossBs, prev.grossBs)}`,
    `🎟️ Ticket promedio: *${bs(current.avgTicketBs)}*${pct(current.avgTicketBs, prev.avgTicketBs)}`,
  ];

  if (bestDay) lines.push(`📦 Mejor día: *${bestDay}* (${bestDayEntry![1]} pedidos)`);
  if (current.topProduct) lines.push(`🥇 Top producto: *${current.topProduct}*`);

  lines.push('', `_¡Sigue construyendo algo grande! 🚀_`);

  return lines.join('\n');
}

export async function generateMonthlyReport(): Promise<string> {
  const now = new Date();
  const thisMonthStart = new Date(now.getTime() - 30 * 86400_000);
  const prevMonthStart = new Date(now.getTime() - 60 * 86400_000);

  const [current, prev, businessName] = await Promise.all([
    aggregateOrders(thisMonthStart),
    aggregateOrders(prevMonthStart, thisMonthStart),
    getBusinessName(),
  ]);

  // New vs returning customers
  const customerOrders = await prisma.order.groupBy({
    by: ['customerId'],
    where: { status: 'DELIVERED', createdAt: { gte: thisMonthStart } },
    _count: { id: true },
  });
  const returningCustomers = customerOrders.filter((c) => c._count.id > 1).length;
  const newCustomers = customerOrders.length - returningCustomers;

  // Top customer
  const topCustomerEntry = customerOrders.sort((a, b) => b._count.id - a._count.id)[0];
  let topCustomerName: string | null = null;
  if (topCustomerEntry) {
    const cust = await prisma.customer.findUnique({
      where: { id: topCustomerEntry.customerId },
      select: { name: true, phone: true },
    });
    topCustomerName = cust
      ? `${cust.name ?? cust.phone} (${topCustomerEntry._count.id} pedidos)`
      : null;
  }

  const monthName = now.toLocaleDateString('es-VE', { month: 'long', year: 'numeric' });
  const convPct   = current.total > 0
    ? Math.round((current.delivered / (current.delivered + current.cancelled)) * 100)
    : 0;

  const lines = [
    `📆 *Resumen mensual — ${businessName}*`,
    `_${monthName.charAt(0).toUpperCase() + monthName.slice(1)}_`,
    '',
    `🛒 Total pedidos: *${current.total}*`,
    `✅ Entregados: *${current.delivered}* (${convPct}%)  |  ❌ Cancelados: *${current.cancelled}*`,
    '',
    `💰 Ingresos: *${bs(current.grossBs)}* (~${usd(current.grossUsd)})${pct(current.grossBs, prev.grossBs)}`,
    `🎟️ Ticket promedio: *${bs(current.avgTicketBs)}*${pct(current.avgTicketBs, prev.avgTicketBs)}`,
    '',
    `🆕 Clientes nuevos: *${newCustomers}*`,
    `♻️ Clientes recurrentes: *${returningCustomers}*`,
  ];

  if (current.topProduct) lines.push(`🥇 Producto del mes: *${current.topProduct}*`);
  if (topCustomerName)    lines.push(`👑 Cliente VIP: *${topCustomerName}*`);

  lines.push('', `_¡Un mes más creciendo! 💪_`);

  return lines.join('\n');
}
