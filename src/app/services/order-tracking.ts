import {
  CustomerOrderStatus,
  ExpectedPaymentMethod,
  FINAL_CUSTOMER_STATUSES,
  FulfillmentType,
  TrackedOrder,
} from './api-types';
import { formatPrice } from '../utils/format';

/** Textos y reglas de presentación del seguimiento (sin estado ni llamadas a la API). */

export const STATUS_LABELS: Record<CustomerOrderStatus, string> = {
  received: 'Recibido',
  awaiting_payment: 'Pendiente de pago en caja',
  preparing: 'En preparación',
  ready_for_pickup: 'Listo para retirar',
  ready_for_dispatch: 'Listo para despacho',
  out_for_delivery: 'En reparto',
  delivered: 'Entregado',
  rejected: 'Rechazado por el local',
  cancelled: 'Anulado',
};

export const METHOD_LABELS: Record<ExpectedPaymentMethod, string> = {
  cash: 'Efectivo',
  debit: 'Débito',
  credit: 'Crédito',
  card: 'Tarjeta',
};

export interface TimelineStep {
  label: string;
  state: 'done' | 'current' | 'pending';
}

const PICKUP_STEPS: CustomerOrderStatus[][] = [
  ['awaiting_payment', 'received'],
  ['preparing'],
  ['ready_for_pickup'],
  ['delivered'],
];

const DELIVERY_STEPS: CustomerOrderStatus[][] = [
  ['received'],
  ['preparing'],
  ['ready_for_dispatch'],
  ['out_for_delivery'],
  ['delivered'],
];

const PICKUP_STEP_LABELS = ['Recibido', 'En preparación', 'Listo para retirar', 'Entregado'];
const DELIVERY_STEP_LABELS = ['Recibido', 'En preparación', 'Listo para despacho', 'En reparto', 'Entregado'];

export function isFinalStatus(status: CustomerOrderStatus): boolean {
  return FINAL_CUSTOMER_STATUSES.includes(status);
}

/** Línea de tiempo por modalidad; vacía si el pedido fue rechazado o anulado. */
export function timelineOf(order: Pick<TrackedOrder, 'orderType' | 'status'>): TimelineStep[] {
  if (order.status === 'rejected' || order.status === 'cancelled') {
    return [];
  }

  const delivery = order.orderType === 'delivery';
  const steps = delivery ? DELIVERY_STEPS : PICKUP_STEPS;
  const labels = delivery ? DELIVERY_STEP_LABELS : PICKUP_STEP_LABELS;
  const current = steps.findIndex((group) => group.includes(order.status));

  return labels.map((label, index) => ({
    label,
    state:
      index < current || order.status === 'delivered'
        ? 'done'
        : index === current
          ? 'current'
          : 'pending',
  }));
}

/**
 * Indicador de pago: "Por pagar $X al recibir / en caja" mientras falte cobrar,
 * "Pagado ✓" cuando se cobró y nada si el pedido se anuló o rechazó.
 */
export function paymentIndicatorOf(
  order: Pick<TrackedOrder, 'paymentStatus' | 'total'> & { orderType: FulfillmentType }
): { text: string; paid: boolean } | null {
  if (order.paymentStatus === 'paid') {
    return { text: 'Pagado ✓', paid: true };
  }

  if (order.paymentStatus === 'pending' || order.paymentStatus === 'declined') {
    const where = order.orderType === 'delivery' ? 'al recibir' : 'en caja';
    return { text: `Por pagar ${formatPrice(order.total)} ${where}`, paid: false };
  }

  return null;
}
