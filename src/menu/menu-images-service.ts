/**
 * Almacena y recupera los media IDs de las imágenes del menú visual.
 * Los media IDs son asignados por WhatsApp cuando el admin envía las fotos al bot.
 * Se guardan en Redis para acceso rápido.
 */
import { redisClient } from '../redis/client';

const MENU_IMAGES_KEY = 'menu:visual_images';

export async function getMenuImages(): Promise<string[]> {
  const raw = await redisClient.get(MENU_IMAGES_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as string[];
  } catch {
    return [];
  }
}

export async function addMenuImage(mediaId: string): Promise<number> {
  const images = await getMenuImages();
  if (!images.includes(mediaId)) images.push(mediaId);
  await redisClient.set(MENU_IMAGES_KEY, JSON.stringify(images));
  return images.length;
}

export async function clearMenuImages(): Promise<void> {
  await redisClient.del(MENU_IMAGES_KEY);
}
