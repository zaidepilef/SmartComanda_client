/** Tipos de la API pública (`/api/public`). */

export interface MenuTenancy {
  businessName: string;
  branchName: string;
}

export interface MenuDish {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  category: string;
  price: number;
}

/** Medios habilitados en la sucursal (`transfer` no se ofrece en la app). */
export type BranchPaymentMethod = 'cash' | 'debit' | 'credit' | 'transfer';

export interface PublicMenu {
  tenancy: MenuTenancy;
  paymentMethods: BranchPaymentMethod[];
  deliveryAvailable: boolean;
  dishes: MenuDish[];
}

/** Retiro en local (`qr`) o a domicilio (`delivery`). */
export type FulfillmentType = 'qr' | 'delivery';

/**
 * Medio de pago esperado. `card` = débito o crédito, lo decide en la puerta
 * (solo domicilio). Elegirlo no es pagar.
 */
export type ExpectedPaymentMethod = 'cash' | 'debit' | 'credit' | 'card';

export interface SavedAddress {
  id: string;
  label: string;
}

export interface CustomerLookupResult {
  known: boolean;
  firstName?: string | null;
  addresses?: SavedAddress[];
  lastAddressId?: string | null;
}

export interface DeliveryInput {
  address: string;
  reference?: string;
  lat?: number;
  lng?: number;
  accuracy?: number;
  /** La dirección vino del mapa (no la escribió el cliente): se actualiza al mover el punto. */
  addressFromMap?: boolean;
}

/** Estimación de llegada que calcula el servidor (sin coordenadas de la sucursal). */
export interface DeliveryEstimate {
  distanceKm: number;
  etaMinutes: number;
  outOfRange: boolean;
}

export interface DeliveryEstimateResult {
  estimate: DeliveryEstimate | null;
}

export interface CreateOrderItemInput {
  dishId: string;
  quantity: number;
  note?: string;
}

export interface CreateOrderInput {
  tenantId: string;
  branchId: string;
  name: string;
  phone: string;
  orderType: FulfillmentType;
  clientRequestId: string;
  expectedPaymentMethod: ExpectedPaymentMethod;
  cashTendered?: number;
  delivery?: {
    addressId?: string;
    address?: string;
    reference?: string;
    lat?: number;
    lng?: number;
    accuracy?: number;
  };
  items: CreateOrderItemInput[];
}

/** Estado del pedido tal como lo ve el cliente (lo calcula el servidor). */
export type CustomerOrderStatus =
  | 'received'
  | 'awaiting_payment'
  | 'preparing'
  | 'ready_for_pickup'
  | 'ready_for_dispatch'
  | 'out_for_delivery'
  | 'delivered'
  | 'rejected'
  | 'cancelled';

export type PaymentStatus = 'pending' | 'paid' | 'declined' | 'voided' | 'refunded';

export interface CreateOrderResult {
  number: number;
  orderId: string;
  total: number;
  orderType: FulfillmentType;
  status: CustomerOrderStatus;
  expectedPaymentMethod: ExpectedPaymentMethod;
  cashTendered: number | null;
  deliveryEtaMinutes?: number | null;
  pointsRate: number | null;
  pointsBalance: number;
  /** Solo en la primera respuesta; una repetición (200) no lo trae. */
  trackingToken?: string;
}

export interface TrackedOrderItem {
  name: string;
  quantity: number;
  price: number;
  note: string | null;
}

export interface TrackedOrder {
  number: number;
  orderType: FulfillmentType;
  status: CustomerOrderStatus;
  items: TrackedOrderItem[];
  total: number;
  expectedPaymentMethod: ExpectedPaymentMethod | null;
  paymentStatus: PaymentStatus;
  deliveryEtaMinutes: number | null;
  rejectionReason: string | null;
  createdAt: string;
  updatedAt: string;
  timestamps: Partial<Record<string, string>>;
}

export const FINAL_CUSTOMER_STATUSES: readonly CustomerOrderStatus[] = [
  'delivered',
  'rejected',
  'cancelled',
];
