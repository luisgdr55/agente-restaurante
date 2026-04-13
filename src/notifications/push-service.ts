import webpush from 'web-push';
import { prisma } from '../db/prisma';
import { env } from '../config/env';
import { logger } from '../utils/logger';

webpush.setVapidDetails(
  env.VAPID_EMAIL,
  env.VAPID_PUBLIC_KEY,
  env.VAPID_PRIVATE_KEY,
);

export async function sendPushToPhone(
  phone: string,
  title: string,
  body: string,
  url?: string,
): Promise<void> {
  const sub = await prisma.pushSubscription.findFirst({
    where: { phone },
  });

  if (!sub) {
    logger.debug({ phone }, 'push: no subscription found, skipping');
    return;
  }

  const payload = JSON.stringify({ title, body, ...(url && { url }) });

  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      payload,
    );
    logger.info({ phone }, 'push: notification sent');
  } catch (err: unknown) {
    const status = (err as { statusCode?: number }).statusCode;
    if (status === 410) {
      logger.warn({ phone, endpoint: sub.endpoint }, 'push: subscription gone, deleting');
      await prisma.pushSubscription.delete({ where: { id: sub.id } });
    } else {
      logger.error({ phone, err }, 'push: failed to send notification');
    }
  }
}
