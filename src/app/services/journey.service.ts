import { DestroyRef, Injectable, inject } from '@angular/core';

import { environment } from '../../environments/environment';
import { uuidV4 } from '../utils/uuid';

// Eventos del recorrido del cliente (spec customer-journey-tracking).
// order_created no se envía desde aquí: lo registra el servidor.
export type JourneyEvent =
  | { type: 'qr_opened' }
  | { type: 'menu_loaded'; data: { dishCount: number } }
  | { type: 'menu_failed'; data: { status: number; reason?: string } }
  | { type: 'identity_submitted'; data: { name: string; phone: string } }
  | { type: 'item_added'; data: { dishId: string; quantity: number } }
  | { type: 'item_removed'; data: { dishId: string; quantity: number } }
  | { type: 'cart_opened'; data: { itemCount: number } }
  | { type: 'order_submitted'; data: { itemCount: number; total: number } }
  | { type: 'order_failed'; data: { status: number; reason?: string } };

type QueuedEvent = JourneyEvent & { occurredAt: string };

const SESSION_KEY = (tenantId: string, branchId: string) => `sc_journey_${tenantId}_${branchId}`;
const FLUSH_DELAY_MS = 3000;
const MAX_BATCH = 50;
const MAX_QUEUE = 200;
const URGENT_TYPES = new Set<JourneyEvent['type']>([
  'identity_submitted',
  'order_submitted',
  'order_failed',
  'menu_failed',
]);

function readSession(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeSession(key: string, value: string | null): void {
  try {
    if (value === null) {
      sessionStorage.removeItem(key);
    } else {
      sessionStorage.setItem(key, value);
    }
  } catch {
    // Sin sessionStorage la sesión vive solo en memoria.
  }
}

/**
 * Registra el recorrido del cliente y lo envía en lotes a la API.
 * Nunca lanza errores ni bloquea el flujo de pedido: si el envío falla,
 * se reintenta una vez y luego se descarta.
 */
@Injectable({ providedIn: 'root' })
export class JourneyService {
  private readonly endpoint = `${environment.apiUrl}/api/public/events`;
  private tenantId: string | null = null;
  private branchId: string | null = null;
  private currentSessionId: string | null = null;
  private queue: QueuedEvent[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private retried = false;

  constructor() {
    const onHidden = () => {
      if (document.visibilityState === 'hidden') {
        this.flush(true);
      }
    };
    const onPageHide = () => this.flush(true);

    document.addEventListener('visibilitychange', onHidden);
    window.addEventListener('pagehide', onPageHide);

    inject(DestroyRef).onDestroy(() => {
      document.removeEventListener('visibilitychange', onHidden);
      window.removeEventListener('pagehide', onPageHide);
    });
  }

  get sessionId(): string | null {
    return this.currentSessionId;
  }

  /**
   * Inicia (o retoma, si se recarga la pestaña) la sesión de esta sucursal.
   * Devuelve true si la sesión es nueva.
   */
  start(tenantId: string, branchId: string): boolean {
    this.tenantId = tenantId;
    this.branchId = branchId;

    const key = SESSION_KEY(tenantId, branchId);
    const existing = readSession(key);

    if (existing) {
      this.currentSessionId = existing;
      return false;
    }

    this.beginSession();
    return true;
  }

  /** Cierra la sesión actual y abre una nueva (p. ej. "Hacer otro pedido"). */
  restart(): void {
    if (!this.tenantId || !this.branchId) {
      return;
    }

    this.flush();
    this.beginSession();
  }

  track(event: JourneyEvent): void {
    if (!this.currentSessionId) {
      return;
    }

    if (this.queue.length >= MAX_QUEUE) {
      this.queue.shift();
    }

    this.queue.push({ ...event, occurredAt: new Date().toISOString() });

    if (URGENT_TYPES.has(event.type)) {
      this.flush();
    } else {
      this.scheduleFlush();
    }
  }

  private beginSession(): void {
    const key = SESSION_KEY(this.tenantId!, this.branchId!);
    this.currentSessionId = uuidV4();
    writeSession(key, this.currentSessionId);
    this.track({ type: 'qr_opened' });
  }

  private scheduleFlush(): void {
    if (this.flushTimer === null) {
      this.flushTimer = setTimeout(() => this.flush(), FLUSH_DELAY_MS);
    }
  }

  private flush(useBeacon = false): void {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    if (this.queue.length === 0 || !this.tenantId || !this.branchId || !this.currentSessionId) {
      return;
    }

    const events = this.queue.splice(0, MAX_BATCH);
    // text/plain evita el preflight CORS y es compatible con sendBeacon.
    const body = JSON.stringify({
      tenantId: this.tenantId,
      branchId: this.branchId,
      sessionId: this.currentSessionId,
      events,
    });

    if (useBeacon && typeof navigator.sendBeacon === 'function') {
      navigator.sendBeacon(this.endpoint, new Blob([body], { type: 'text/plain' }));
    } else {
      fetch(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body,
        keepalive: true,
      })
        .then((response) => {
          // 4xx: el lote es inválido y reintentar no sirve.
          if (response.status >= 500 || response.status === 429) {
            this.retryOnce(events);
          } else {
            this.retried = false;
          }
        })
        .catch(() => this.retryOnce(events));
    }

    if (this.queue.length > 0) {
      this.scheduleFlush();
    }
  }

  private retryOnce(events: QueuedEvent[]): void {
    if (this.retried) {
      this.retried = false;
      return;
    }

    this.retried = true;
    this.queue.unshift(...events);
    this.scheduleFlush();
  }
}
