import { Injectable } from '@angular/core';

import { FulfillmentType } from './api-types';
import { clearStorage, readStorage, writeStorage } from '../utils/storage';

/**
 * Comprobante del pedido en curso: la "sesión" del cliente en este teléfono.
 * Mientras exista, recargar o volver a escanear el QR abre el seguimiento.
 * El token solo da acceso a este pedido (no hay sesión en el servidor).
 */
export interface ActiveOrderReceipt {
  number: number;
  /** `null` si el servidor no lo entregó (pedido repetido tras perder la respuesta). */
  trackingToken: string | null;
  phone: string;
  mode: FulfillmentType;
  total: number;
  createdAt: string;
}

const RECEIPT_KEY = (tenantId: string, branchId: string) => `sc_active_order_${tenantId}_${branchId}`;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function parseReceipt(raw: string): ActiveOrderReceipt | null {
  try {
    const value = JSON.parse(raw || 'null');

    if (
      value &&
      Number.isInteger(value.number) &&
      (value.trackingToken === null || TOKEN_PATTERN.test(value.trackingToken)) &&
      typeof value.phone === 'string' &&
      (value.mode === 'qr' || value.mode === 'delivery')
    ) {
      return {
        number: value.number,
        trackingToken: value.trackingToken,
        phone: value.phone,
        mode: value.mode,
        total: Number.isFinite(value.total) ? value.total : 0,
        createdAt: typeof value.createdAt === 'string' ? value.createdAt : '',
      };
    }
  } catch {
    // Valor corrupto: se ignora.
  }

  return null;
}

@Injectable({ providedIn: 'root' })
export class ActiveOrderService {
  get(tenantId: string, branchId: string): ActiveOrderReceipt | null {
    return parseReceipt(readStorage(RECEIPT_KEY(tenantId, branchId)));
  }

  save(tenantId: string, branchId: string, receipt: ActiveOrderReceipt): void {
    writeStorage(RECEIPT_KEY(tenantId, branchId), JSON.stringify(receipt));
  }

  clear(tenantId: string, branchId: string): void {
    clearStorage(RECEIPT_KEY(tenantId, branchId));
  }
}
