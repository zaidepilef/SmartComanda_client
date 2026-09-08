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

export interface CreateOrderInput {
  tenantId: string;
  branchId: string;
  name: string;
  phone: string;
  items: CreateOrderItemInput[];
}

export interface CreateOrderResult {
  number: number;
  orderId: string;
  total: number;
  pointsRate: number | null;
  pointsBalance: number;
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

@Injectable({ providedIn: 'root' })
export class OrderStore {
  readonly tenantId = signal<string | null>(null);
  readonly branchId = signal<string | null>(null);
  readonly menu = signal<PublicMenu | null>(null);
  readonly step = signal<OrderStep>('phone');
  readonly error = signal<string | null>(null);
  readonly cart = signal<CartItem[]>([]);
  readonly orderResult = signal<CreateOrderResult | null>(null);

  readonly phone = computed(() => {
    const tenantId = this.tenantId();
    return tenantId ? localStorage.getItem(PHONE_KEY(tenantId)) ?? '' : '';
  });

  readonly name = computed(() => {
    const tenantId = this.tenantId();
    return tenantId ? localStorage.getItem(NAME_KEY(tenantId)) ?? '' : '';
  });

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

    if (this.name() && this.phone()) {
      this.step.set('menu');
    } else {
      this.step.set('phone');
    }
  }

  saveIdentity(name: string, phone: string): void {
    const tenantId = this.tenantId();

    if (tenantId) {
      localStorage.setItem(NAME_KEY(tenantId), name);
      localStorage.setItem(PHONE_KEY(tenantId), phone);
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

  confirm(result: CreateOrderResult): void {
    this.orderResult.set(result);
    this.step.set('success');
    this.clearCart();
  }
}