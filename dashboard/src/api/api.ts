import axios from 'axios';

const BACKEND = import.meta.env.VITE_API_URL ?? 'https://yebrams.up.railway.app';
const api = axios.create({ baseURL: `${BACKEND}/api` });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('token');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  },
);

export default api;

export interface Order {
  id: string;
  orderNumber: number;
  status: string;
  deliveryType: string | null;
  deliveryAddress: string | null;
  deliveryReference: string | null;
  totalBs: string;
  totalUsd: string;
  discountBs?: string;
  paymentMethod?: string | null;
  paymentReference?: string | null;
  cancelReason?: string | null;
  driverId?: string | null;
  driverPhone?: string | null;
  hasPaymentImage?: boolean;
  createdAt: string;
  customer: { name: string | null; phone: string };
  items: Array<{
    quantity: number;
    unitPriceUsd: string;
    menuItem: { name: string };
  }>;
}

export interface Driver {
  id: string;
  name: string;
  phone: string;
  isActive: boolean;
  createdAt: string;
}

export interface Stats {
  totalOrders: number;
  delivered: number;
  cancelled: number;
  inProgress: number;
  revenueBs: number;
  revenueUsd: number;
}

export interface ConfigEntry { key: string; value: string; }

export const ordersApi = {
  getActive: () => api.get<Order[]>('/orders').then(r => r.data),
  getToday: () => api.get<Order[]>('/orders/today').then(r => r.data),
  updateStatus: (id: string, status: string, reason?: string) =>
    api.patch<Order>(`/orders/${id}/status`, { status, ...(reason && { reason }) }).then(r => r.data),
  assignDriver: (orderId: string, driverId: string) =>
    api.post<Order>(`/orders/${orderId}/assign-driver`, { driverId }).then(r => r.data),
  setOutForDelivery: (id: string) =>
    api.patch<Order>(`/orders/${id}/status`, { status: 'OUT_FOR_DELIVERY' }).then(r => r.data),
  getProof: (id: string) =>
    api.get<{ paymentImageUrl: string | null }>(`/orders/${id}/proof`).then(r => r.data),
  runOcr: (id: string) =>
    api.post<Record<string, string | null>>(`/orders/${id}/ocr-payment`).then(r => r.data),
};

export const driversApi = {
  getAll: () => api.get<Driver[]>('/drivers').then(r => r.data),
  create: (data: { name: string; phone: string }) =>
    api.post<Driver>('/drivers', data).then(r => r.data),
  update: (id: string, data: { name?: string; phone?: string; isActive?: boolean }) =>
    api.patch<Driver>(`/drivers/${id}`, data).then(r => r.data),
  remove: (id: string) =>
    api.delete<{ deleted?: boolean; softDeleted?: boolean }>(`/drivers/${id}`).then(r => r.data),
};

export const statsApi = {
  get: () => api.get<Stats>('/stats').then(r => r.data),
};

export const configApi = {
  getAll: () => api.get<ConfigEntry[]>('/config').then(r => r.data),
  update: (key: string, value: string) => api.patch('/config', { key, value }),
};

export interface MenuItem {
  id: string;
  categoryId: string;
  name: string;
  description: string | null;
  priceUsd: string;       // Decimal serialized as string
  imageUrl: string | null;
  isAvailable: boolean;
  sortOrder: number;
}

export interface MenuCategoryFull {
  id: string;
  name: string;
  emoji: string;
  sortOrder: number;
  isActive: boolean;
  items: MenuItem[];
}

export interface MenuItemFlat {
  id: string;
  name: string;
  categoryName: string;
  priceUsd: number;
  priceBs: number;
}

export interface ManualOrderItem { menuItemId: string; quantity: number; }

export interface ManualOrderBody {
  customerId?: string;
  customerName?: string;
  customerPhone?: string;
  items: ManualOrderItem[];
  deliveryType: 'DELIVERY' | 'PICKUP';
  deliveryAddress?: string;
  paymentMethod: 'EFECTIVO' | 'PAGO_MOVIL';
  paymentReference?: string;
  notifyCustomer: boolean;
}

export const manualOrderApi = {
  create: (body: ManualOrderBody) =>
    api.post<{ ok: boolean; orderId: string }>('/orders/manual', body).then(r => r.data),
};

export const menuApi = {
  getActive: () => api.get('/menu').then(r => r.data),
  getFull: () => api.get<MenuCategoryFull[]>('/menu/full').then(r => r.data),
  getItemsFlat: () => api.get<MenuItemFlat[]>('/menu/items-flat').then(r => r.data),

  // Categories
  createCategory: (data: { name: string; emoji: string }) =>
    api.post<MenuCategoryFull>('/menu/categories', data).then(r => r.data),
  updateCategory: (id: string, data: { name?: string; emoji?: string }) =>
    api.patch<MenuCategoryFull>(`/menu/categories/${id}`, data).then(r => r.data),
  deleteCategory: (id: string) => api.delete(`/menu/categories/${id}`),

  // Items
  createItem: (data: { categoryId: string; name: string; description?: string; priceUsd: number; isAvailable?: boolean; imageUrl?: string }) =>
    api.post<MenuItem>('/menu/items', data).then(r => r.data),
  updateItem: (id: string, data: Partial<{ name: string; description: string; priceUsd: number; isAvailable: boolean; imageUrl: string | null }>) =>
    api.patch<MenuItem>(`/menu/items/${id}`, data).then(r => r.data),
  deleteItem: (id: string) => api.delete(`/menu/items/${id}`),
};

export const authApi = {
  login: (pin: string) => api.post<{ token: string }>('/auth/login', { pin }).then(r => r.data),
};

export type AnalyticsPeriod = 'today' | 'week' | 'month' | 'year' | 'all';

export interface ProductStat {
  id: string;
  name: string;
  units: number;
  revenueBs: number;
  revenueUsd: number;
}

export interface CustomerStat {
  id: string;
  name: string | null;
  phone: string;
  orders: number;
  totalSpentBs: number;
  totalSpentUsd: number;
}

export const analyticsApi = {
  getProducts: (period: AnalyticsPeriod) =>
    api.get<ProductStat[]>('/analytics/products', { params: { period } }).then(r => r.data),
  getCustomers: (period: AnalyticsPeriod) =>
    api.get<CustomerStat[]>('/analytics/customers', { params: { period } }).then(r => r.data),
};

// ── Kitchen API (separate axios instance with kitchen_token) ──────────────
const kitchenAxios = axios.create({ baseURL: '/api' });
kitchenAxios.interceptors.request.use((config) => {
  const token = localStorage.getItem('kitchen_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});
kitchenAxios.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('kitchen_token');
      window.location.href = '/kitchen/login';
    }
    return Promise.reject(err);
  },
);

export const kitchenAuthApi = {
  login: (pin: string) => api.post<{ token: string }>('/auth/kitchen-login', { pin }).then(r => r.data),
};

export const kitchenOrdersApi = {
  getKitchen: () => kitchenAxios.get<Order[]>('/orders/kitchen').then(r => r.data),
  markReady: (id: string) => kitchenAxios.patch<Order>(`/orders/${id}/status`, { status: 'READY' }).then(r => r.data),
};

export interface Customer {
  id: string;
  name: string | null;
  phone: string;
  savedAddress: string | null;
  createdAt: string;
  totalOrders: number;
  completedOrders: number;
  cancelledOrders: number;
  totalSpentUsd: number;
  totalSpentBs: number;
  avgOrderValueUsd: number;
  favoriteItemName: string | null;
  favoriteDay: string | null;
  dayCounts: number[];   // [0..6] = Dom..Sáb
  firstOrderAt: string | null;
  lastOrderAt: string | null;
}

export type CustomerSortBy = 'totalOrders' | 'totalSpentUsd' | 'lastOrderAt' | 'name';

export interface DayPromo {
  name: string;
  description?: string;
  priceBs: number;
  menuItemId?: string;
  autoCreated?: boolean;
}

export const promoDayApi = {
  getPromos: () => api.get<DayPromo[]>('/promos/day').then(r => r.data),
  addPromo: (promo: DayPromo) => api.post<{ count: number }>('/promos/day', promo).then(r => r.data),
  updatePromo: (index: number, update: Partial<DayPromo>) => api.patch(`/promos/day/${index}`, update),
  removePromo: (index: number) => api.delete(`/promos/day/${index}`),
  clearPromos: () => api.delete('/promos/day'),
  getDays: () => api.get<{ days: number[] }>('/promos/days').then(r => r.data),
  setDays: (days: number[]) => api.put<{ days: number[] }>('/promos/days', { days }).then(r => r.data),
};

export const customersApi = {
  getAll: (params?: { search?: string; sortBy?: CustomerSortBy; order?: 'asc' | 'desc' }) =>
    api.get<Customer[]>('/customers', { params }).then(r => r.data),
};

export interface Review {
  id: string;
  orderId: string;
  customerId: string;
  rating: number;
  comment: string | null;
  createdAt: string;
  order: { orderNumber: number; createdAt: string };
  customer: { name: string | null; phone: string };
}

export interface ReviewStats {
  averageRating: number;
  totalReviews: number;
  distribution: Record<string, number>;
}

export const reviewsApi = {
  getAll: (params?: { rating?: number; limit?: number; offset?: number }) =>
    api.get<{ reviews: Review[]; total: number }>('/reviews', { params }).then(r => r.data),
  getStats: () =>
    api.get<ReviewStats>('/reviews/stats').then(r => r.data),
};

// ── Financials API ─────────────────────────────────────────────────────────

export interface FinancialSummary {
  period: string;
  grossRevenueBs: number;
  grossRevenueUsd: number;
  discountBs: number;
  discountUsd: number;
  netRevenueBs: number;
  netRevenueUsd: number;
  totalOrders: number;
  deliveredOrders: number;
  cancelledOrders: number;
  inProgressOrders: number;
  conversionRate: number;
  avgTicketBs: number;
  avgTicketUsd: number;
  deliveryCount: number;
  pickupCount: number;
  deliveryRevenueBs: number;
  pickupRevenueBs: number;
  pagoMovilCount: number;
  cashCount: number;
  pagoMovilRevenueBs: number;
  cashRevenueBs: number;
  vsPrevRevenuePct: number | null;
  vsPrevOrdersPct: number | null;
  vsPrevTicketPct: number | null;
}

export interface ChartPoint {
  date: string;
  revenueBs: number;
  revenueUsd: number;
  orders: number;
}

export type FinancialPeriod = 'today' | 'week' | 'month' | 'year';

export const financialsApi = {
  getSummary: (period: FinancialPeriod) =>
    api.get<FinancialSummary>('/financials/summary', { params: { period } }).then(r => r.data),
  getChart: (period: FinancialPeriod) =>
    api.get<ChartPoint[]>('/financials/chart', { params: { period } }).then(r => r.data),
};
