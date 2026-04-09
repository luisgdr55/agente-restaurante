import { create } from 'zustand';
import type { Order, Stats } from '../api/api';
import { connectSocket, disconnectSocket, ensureSocketConnected } from '../socket/socket';

const ACTIVE_STATUSES = ['PENDING_PAYMENT', 'PAYMENT_UPLOADED', 'PAYMENT_CONFIRMED', 'IN_KITCHEN', 'READY', 'OUT_FOR_DELIVERY'];

interface AppStore {
  isAuthenticated: boolean;
  token: string | null;
  orders: Order[];
  stats: Stats | null;
  lastUpdated: Date | null;
  setAuth: (token: string) => void;
  logout: () => void;
  setOrders: (orders: Order[]) => void;
  setStats: (stats: Stats) => void;
  upsertOrder: (order: Order) => void;   // add or update, auto-removes if terminal
  updateOrderStatus: (id: string, status: string) => void;
}

// Auto-conectar si ya hay token (recarga de página)
ensureSocketConnected();

export const useStore = create<AppStore>((set) => ({
  isAuthenticated: !!localStorage.getItem('token'),
  token: localStorage.getItem('token'),
  orders: [],
  stats: null,
  lastUpdated: null,
  setAuth: (token) => {
    localStorage.setItem('token', token);
    set({ isAuthenticated: true, token });
    connectSocket(token);
  },
  logout: () => {
    localStorage.removeItem('token');
    disconnectSocket();
    set({ isAuthenticated: false, token: null });
  },
  setOrders: (orders) => set({ orders, lastUpdated: new Date() }),
  setStats: (stats) => set({ stats }),
  upsertOrder: (order) =>
    set((state) => {
      const isActive = ACTIVE_STATUSES.includes(order.status);
      const exists = state.orders.some((o) => o.id === order.id);
      if (!isActive) {
        // Pedido terminal: quitar de la lista activa
        return { orders: state.orders.filter((o) => o.id !== order.id), lastUpdated: new Date() };
      }
      if (exists) {
        return { orders: state.orders.map((o) => (o.id === order.id ? order : o)), lastUpdated: new Date() };
      }
      return { orders: [order, ...state.orders], lastUpdated: new Date() };
    }),
  updateOrderStatus: (id, status) =>
    set((state) => ({
      orders: ACTIVE_STATUSES.includes(status)
        ? state.orders.map((o) => (o.id === id ? { ...o, status } : o))
        : state.orders.filter((o) => o.id !== id),
    })),
}));
