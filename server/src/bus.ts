import type { WebSocket } from 'ws';
import type { ServerEvent } from './contracts.js';

const elders = new Set<WebSocket>();
const guardians = new Set<WebSocket>();
const spokeWaiters = new Set<() => void>();
export function addClient(socket: WebSocket, role: 'elder' | 'guardian'): () => void {
  const clients = role === 'elder' ? elders : guardians;
  clients.add(socket);
  return () => clients.delete(socket);
}
function send(clients: Set<WebSocket>, event: ServerEvent): void {
  const json = JSON.stringify(event);
  for (const socket of clients) {
    if (socket.readyState !== 1) continue;
    try { socket.send(json, error => { if (error) clients.delete(socket); }); }
    catch { clients.delete(socket); }
  }
}
export const toElder = (event: ServerEvent): void => send(elders, event);
export const toGuardian = (event: ServerEvent): void => send(guardians, event);
export const toAll = (event: ServerEvent): void => { toElder(event); toGuardian(event); };
export const hasElder = (): boolean => [...elders].some(socket => socket.readyState === 1);
export function awaitSpoke(timeoutMs = 8_000): Promise<void> {
  // No elder device connected (curl / acceptance tests): nobody will send `spoke`, so do not stall.
  if (!hasElder()) return Promise.resolve();
  return new Promise(resolve => {
    const finish = () => { clearTimeout(timer); spokeWaiters.delete(finish); resolve(); };
    const timer = setTimeout(finish, timeoutMs);
    timer.unref();
    spokeWaiters.add(finish);
  });
}
// index.ts calls this only for elder sockets; reset also cancels pending waits.
export function acknowledgeSpoke(): void { for (const finish of [...spokeWaiters]) finish(); }
