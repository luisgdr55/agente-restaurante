/// <reference types="vite/client" />
import { io, Socket } from 'socket.io-client';

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    const token = localStorage.getItem('token');
    socket = io(import.meta.env.VITE_API_URL ?? 'https://yebrams.up.railway.app', {
      path: '/ws',
      transports: ['websocket'],
      autoConnect: false,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
      auth: token ? { token } : undefined,
    });
  }
  return socket;
}

/** Conecta (o reconecta) el socket con el token dado. */
export function connectSocket(token: string): void {
  const s = getSocket();
  s.auth = { token };
  if (!s.connected) s.connect();
}

/** Conecta con el token guardado en localStorage (útil en recarga de página). */
export function ensureSocketConnected(): void {
  const token = localStorage.getItem('token');
  if (token) connectSocket(token);
}

export function disconnectSocket(): void {
  socket?.disconnect();
  socket = null;
}
