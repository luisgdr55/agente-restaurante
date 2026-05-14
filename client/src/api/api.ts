import axios from 'axios'

const api = axios.create({ baseURL: `${import.meta.env.VITE_BACKEND_URL ?? 'https://yebrams.up.railway.app'}/api/public` })

// ── Types ────────────────────────────────────────────────────────────────────

export interface MenuItem {
  id: string
  categoryId: string
  name: string
  description: string | null
  priceUsd: string        // Decimal serialized as string
  imageUrl: string | null
  isAvailable: boolean
  sortOrder: number
}

export interface MenuCategory {
  id: string
  name: string
  emoji: string
  sortOrder: number
  items: MenuItem[]
}

export interface PublicConfig {
  RESTAURANT_NAME: string
  PAGO_MOVIL_PHONE: string
  PAGO_MOVIL_BANK: string
  PAGO_MOVIL_HOLDER: string
  PAGO_MOVIL_RIF: string
  DELIVERY_FEE_USD: string
  USD_TO_BS_RATE: string
  ADMIN_PHONE: string
  RESTAURANT_HOURS: string
  BUSINESS_ACTIVE: string
  SCHEDULE_ENABLED: string
  SCHEDULE_OPEN_TIME: string
  SCHEDULE_CLOSE_TIME: string
  SCHEDULE_DAYS: string
  vapidPublicKey: string
  IS_HIGH_DEMAND?: string
  IS_POWER_OUTAGE?: string
  OUTAGE_MESSAGE?: string
  IS_ORDERS_PAUSED?: string
  ORDERS_PAUSE_MINUTES?: string
  ORDERS_PAUSE_UNTIL?: string
  BUSINESS_OPEN_TIME?: string
  BUSINESS_CLOSE_TIME?: string
}

// Returns true if the restaurant is currently open.
// Closed if: (1) BUSINESS_ACTIVE === 'false', OR (2) SCHEDULE_ENABLED and outside hours.
// Mirrors isBusinessActive() / isWithinSchedule() in config-service.ts.
export function isRestaurantOpen(config: PublicConfig): boolean {
  // Condition 1: manual toggle off
  if (config.BUSINESS_ACTIVE === 'false') return false

  // Condition 2: auto-schedule
  if (config.SCHEDULE_ENABLED !== 'true') return true // schedule disabled → open

  const { SCHEDULE_OPEN_TIME, SCHEDULE_CLOSE_TIME, SCHEDULE_DAYS } = config
  if (!SCHEDULE_OPEN_TIME || !SCHEDULE_CLOSE_TIME) return true

  // Venezuela = UTC-4
  const nowUtcMs = Date.now()
  const venMs = nowUtcMs - 4 * 60 * 60 * 1000
  const d = new Date(venMs)
  const totalMinutes = d.getUTCHours() * 60 + d.getUTCMinutes()
  const dayOfWeek = d.getUTCDay() // 0=Sun … 6=Sat

  const [openH = 0, openM = 0] = SCHEDULE_OPEN_TIME.split(':').map(Number)
  const [closeH = 0, closeM = 0] = SCHEDULE_CLOSE_TIME.split(':').map(Number)
  const openMins = openH * 60 + openM
  const closeMins = closeH * 60 + closeM

  let activeDays: number[] = [1, 2, 3, 4, 5, 6]
  try { if (SCHEDULE_DAYS) activeDays = JSON.parse(SCHEDULE_DAYS) as number[] } catch { /* default */ }

  if (!activeDays.includes(dayOfWeek)) return false

  if (closeMins > openMins) {
    return totalMinutes >= openMins && totalMinutes < closeMins
  } else {
    return totalMinutes >= openMins || totalMinutes < closeMins
  }
}

export interface OrderPublic {
  id: string
  orderNumber: number
  status: string
  deliveryAddress: string | null
  deliveryReference: string | null
  customer: { name: string | null; phone: string }
}

export interface TrackingOrder {
  id: string
  orderNumber: number
  status: string
  deliveryType: string | null
  deliveryAddress: string | null
  customerName: string | null
  totalUsd: string
  totalBs: string
  cancelReason: string | null
  items: { name: string; quantity: number; unitPriceUsd: string }[]
}

export interface WebOrderBody {
  customerName: string
  phone: string
  deliveryType: 'DELIVERY' | 'PICKUP'
  address?: string
  items: { menuItemId: string; quantity: number }[]
  proofImageBase64?: string
  paymentMethod?: 'PAGO_MOVIL' | 'CASH' | 'POS'
  paymentReference?: string
}

export interface WebOrderResponse {
  orderId: string
  orderNumber: number
  queued?: boolean
}

// ── API calls ────────────────────────────────────────────────────────────────

export const publicApi = {
  getMenu: () => api.get<MenuCategory[]>('/menu').then((r) => r.data),
  getConfig: () => api.get<PublicConfig>('/config').then((r) => r.data),
  createOrder: (body: WebOrderBody) =>
    api.post<WebOrderResponse>('/orders', body).then((r) => r.data),
  getSavedAddress: (phone: string) =>
    api.get<{ savedAddress: string | null }>(`/customers/${encodeURIComponent(phone)}`).then((r) => r.data.savedAddress),
  getOrderTracking: (orderId: string) =>
    api.get<TrackingOrder>(`/orders/${orderId}/tracking`).then((r) => r.data),
  getOrderPublic: (orderId: string) =>
    api.get<OrderPublic>(`/orders/${orderId}`).then((r) => r.data),
  confirmDelivery: (orderId: string) =>
    api.post(`/orders/${orderId}/delivered`),
  submitReview: (orderId: string, body: { rating: number; comment?: string }) =>
    api.post(`/reviews/${orderId}`, body),
  uploadPaymentProof: (orderId: string, paymentImageUrl: string) =>
    api.patch(`/orders/${orderId}/payment-proof`, { paymentImageUrl }),
  cancelOrder: (orderId: string) =>
    api.delete(`/orders/${orderId}`),
}
