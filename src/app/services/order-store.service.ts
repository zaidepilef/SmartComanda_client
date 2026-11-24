import { Injectable, computed, signal } from '@angular/core';

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

export interface PublicMenu {
  tenancy: MenuTenancy;
  dishes: MenuDish[];
}

export interface CreateOrderItemInput {
  dishId: string;
  quantity: number;
}

/** Retiro en local (`qr`) o a domicilio (`delivery`). */
export type FulfillmentType = 'qr' | 'delivery';

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

export interface CreateOrderInput {
  tenantId: string;
  branchId: string;
  name: string;
  phone: string;
  orderType: FulfillmentType;
  delivery?: Omit<DeliveryInput, 'addressFromMap'>;
  items: CreateOrderItemInput[];
}

export const DELIVERY_ADDRESS_MIN_LENGTH = 5;

export interface CreateOrderResult {
  number: number;
  orderId: string;
  total: number;
  pointsRate: number | null;
  pointsBalance: number;
  orderType?: FulfillmentType;
  deliveryEtaMinutes?: number | null;
  deliveryDistanceKm?: number | null;
  deliveryOutOfRange?: boolean | null;
}

export interface CustomerBalance {
  phone: string;
  pointsBalance: number;
}

export interface CartItem {
  dish: MenuDish;
  quantity: number;
}

export type OrderStep = 'phone' | 'menu' | 'success';

const PHONE_KEY = (tenantId: string) => `sc_phone_${tenantId}`;
const NAME_KEY = (tenantId: string) => `sc_name_${tenantId}`;
const DELIVERY_KEY = (tenantId: string) => `sc_delivery_${tenantId}`;

const EMPTY_DELIVERY: DeliveryInput = { address: '' };

// localStorage puede fallar (p. ej. navegación privada); el pedido no debe depender de él.
function readStorage(key: string): string {
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Sin persistencia: la identidad sigue disponible en memoria.
  }
}

function readDelivery(tenantId: string): DeliveryInput {
  try {
    const parsed = JSON.parse(readStorage(DELIVERY_KEY(tenantId)) || 'null');

    if (parsed && typeof parsed.address === 'string') {
      return {
        address: parsed.address,
        reference: typeof parsed.reference === 'string' ? parsed.reference : undefined,
        lat: Number.isFinite(parsed.lat) ? parsed.lat : undefined,
        lng: Number.isFinite(parsed.lng) ? parsed.lng : undefined,
        accuracy: Number.isFinite(parsed.accuracy) ? parsed.accuracy : undefined,
      };
    }
  } catch {
    // Valor corrupto: se ignora.
  }

  return EMPTY_DELIVERY;
}

@Injectable({ providedIn: 'root' })
export class OrderStore {
  readonly tenantId = signal<string | null>(null);
  readonly branchId = signal<string | null>(null);
  readonly menu = signal<PublicMenu | null>(null);
  readonly step = signal<OrderStep>('phone');
  readonly error = signal<string | null>(null);
  readonly cart = signal<CartItem[]>([]);
  readonly orderResult = signal<CreateOrderResult | null>(null);

  // Señales (no computed sobre localStorage): localStorage no es reactivo y
  // un computed quedaba con el valor vacío tras llenar el formulario.
  readonly phone = signal('');
  readonly name = signal('');

  readonly fulfillment = signal<FulfillmentType>('qr');
  readonly delivery = signal<DeliveryInput>(EMPTY_DELIVERY);
  readonly deliveryEstimate = signal<DeliveryEstimate | null>(null);

  readonly branchDishes = computed(() => {
    const menu = this.menu();
    return menu
      ? [...menu.dishes].sort((a, b) => a.category.localeCompare(b.category))
      : [];
  });

  readonly categories = computed(() => {
    const seen = new Map<string, { name: string; icon: string }>();
    for (const dish of this.branchDishes()) {
      if (!seen.has(dish.category)) {
        seen.set(dish.category, {
          name: dish.category,
          icon: dish.icon ?? '🍽️',
        });
      }
    }
    return [...seen.values()];
  });

  readonly cartTotal = computed(() =>
    this.cart().reduce((acc, item) => acc + item.dish.price * item.quantity, 0)
  );

  readonly cartCount = computed(() =>
    this.cart().reduce((acc, item) => acc + item.quantity, 0)
  );

  init(tenantId: string, branchId: string): void {
    this.tenantId.set(tenantId);
    this.branchId.set(branchId);
    this.error.set(null);
    this.name.set(readStorage(NAME_KEY(tenantId)));
    this.phone.set(readStorage(PHONE_KEY(tenantId)));
    this.delivery.set(readDelivery(tenantId));

    if (this.name() && this.phone()) {
      this.step.set('menu');
    } else {
      this.step.set('phone');
    }
  }

  saveIdentity(name: string, phone: string): void {
    const tenantId = this.tenantId();

    this.name.set(name);
    this.phone.set(phone);

    if (tenantId) {
      writeStorage(NAME_KEY(tenantId), name);
      writeStorage(PHONE_KEY(tenantId), phone);
    }

    this.step.set('menu');
  }

  setMenu(menu: PublicMenu): void {
    this.menu.set(menu);
  }

  setError(message: string): void {
    this.error.set(message);
  }

  clearError(): void {
    this.error.set(null);
  }

  addToCart(dish: MenuDish, quantity: number): void {
    const current = this.cart();

    const existing = current.find((item) => item.dish.id === dish.id);

    if (existing) {
      this.cart.set(
        current.map((item) =>
          item.dish.id === dish.id ? { ...item, quantity: item.quantity + quantity } : item
        )
      );
      return;
    }

    this.cart.set([...current, { dish, quantity }]);
  }

  changeQuantity(dishId: string, quantity: number): void {
    if (quantity <= 0) {
      this.cart.set(this.cart().filter((item) => item.dish.id !== dishId));
      return;
    }

    this.cart.set(
      this.cart().map((item) =>
        item.dish.id === dishId ? { ...item, quantity } : item
      )
    );
  }

  clearCart(): void {
    this.cart.set([]);
  }

  /** Recuerda la última dirección para el próximo pedido a domicilio (solo en este teléfono). */
  rememberDelivery(delivery: DeliveryInput): void {
    const tenantId = this.tenantId();

    if (tenantId) {
      writeStorage(DELIVERY_KEY(tenantId), JSON.stringify(delivery));
    }
  }

  confirm(result: CreateOrderResult): void {
    this.orderResult.set(result);
    this.step.set('success');
    this.clearCart();
  }
}