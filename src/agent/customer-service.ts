/**
 * CRUD de clientes — findOrCreate y actualización de estado de sesión.
 */
import type { Customer } from '@prisma/client';
import { prisma } from '../db/prisma';
import { logger } from '../utils/logger';

export interface CustomerWithStats extends Customer {
  stats: { totalOrders: number; totalSpentBs: import('@prisma/client').Prisma.Decimal } | null;
}

export async function findOrCreateCustomer(phone: string): Promise<Customer> {
  let customer = await prisma.customer.findUnique({ where: { phone } });

  if (!customer) {
    customer = await prisma.customer.create({
      data: {
        phone,
        conversationState: { state: 'IDLE' },
        stats: { create: {} }, // crear CustomerStats vacío
      },
    });
    logger.info({ phone }, 'New customer created');
  }

  return customer;
}

export async function updateCustomerName(customerId: string, name: string): Promise<void> {
  await prisma.customer.update({
    where: { id: customerId },
    data: { name },
  });
}

export async function updateCustomerConversationState(
  customerId: string,
  state: object,
): Promise<void> {
  await prisma.customer.update({
    where: { id: customerId },
    data: { conversationState: state },
  });
}

export async function getCustomerSavedAddress(customerId: string): Promise<string | null> {
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { savedAddress: true },
  });
  return customer?.savedAddress ?? null;
}

export async function updateCustomerSavedAddress(customerId: string, address: string): Promise<void> {
  await prisma.customer.update({
    where: { id: customerId },
    data: { savedAddress: address },
  });
  logger.info({ customerId }, 'Saved address updated');
}

export async function closeCustomerSession(customerId: string): Promise<void> {
  await prisma.customer.update({
    where: { id: customerId },
    data: { sessionExpiresAt: new Date() },
  });
}

export function isSessionExpired(customer: Customer): boolean {
  if (!customer.sessionExpiresAt) return false;
  return customer.sessionExpiresAt <= new Date();
}
