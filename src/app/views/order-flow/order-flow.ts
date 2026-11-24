import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { lastValueFrom } from 'rxjs';

import { OrderStore } from '../../services/order-store.service';
import { PublicApiService } from '../../services/public-api.service';
import { JourneyService } from '../../services/journey.service';
import {
  CartItem,
  CreateOrderInput,
  CreateOrderResult,
  DELIVERY_ADDRESS_MIN_LENGTH,
  FulfillmentType,
  MenuDish,
} from '../../services/order-store.service';
import { ThemeToggle } from '../../components/theme-toggle/theme-toggle';
import { DeliveryLocation } from '../../components/delivery-location/delivery-location';

const PHONE_PATTERN = /^\+?[0-9]{9,15}$/;
const NAME_MAX_LENGTH = 80;

@Component({
  selector: 'app-order-flow',
  imports: [CommonModule, FormsModule, ThemeToggle, DeliveryLocation],
  templateUrl: './order-flow.html',
  styleUrl: './order-flow.scss',
})
export class OrderFlowView implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(PublicApiService);
  private readonly journey = inject(JourneyService);
  readonly store = inject(OrderStore);

  readonly nameInput = signal('');
  readonly phoneInput = signal('');
  readonly query = signal('');
  readonly activeCategory = signal('all');
  readonly selectedDish = signal<MenuDish | null>(null);
  readonly selectedQuantity = signal(1);
  readonly submitting = signal(false);
  readonly cartVisible = signal(false);

  readonly nameError = computed(() => {
    const value = this.nameInput().trim();

    if (value === '') {
      return null;
    }

    return value.length <= NAME_MAX_LENGTH
      ? null
      : `El nombre no puede superar ${NAME_MAX_LENGTH} caracteres.`;
  });

  readonly phoneError = computed(() => {
    const value = this.phoneInput().trim();

    if (value === '') {
      return null;
    }

    return PHONE_PATTERN.test(value) ? null : 'Ingresa un teléfono válido (ej. +56912345678).';
  });

  readonly canSubmitPhone = computed(() => {
    const name = this.nameInput().trim();
    const phone = this.phoneInput().trim();
    return name !== '' && name.length <= NAME_MAX_LENGTH && PHONE_PATTERN.test(phone);
  });

  /** Domicilio exige una dirección mínima; retiro en local no pide nada más. */
  readonly canSubmitOrder = computed(() => {
    if (this.store.cartCount() === 0) {
      return false;
    }

    return (
      this.store.fulfillment() !== 'delivery' ||
      this.store.delivery().address.trim().length >= DELIVERY_ADDRESS_MIN_LENGTH
    );
  });

  readonly visibleDishes = computed(() => {
    const term = this.query().trim().toLowerCase();
    const category = this.activeCategory();

    return this.store
      .branchDishes()
      .filter((dish) => category === 'all' || dish.category === category)
      .filter((dish) => term === '' || dish.name.toLowerCase().includes(term));
  });

  readonly pointsLabel = computed(() => {
    const menu = this.store.menu();

    if (!menu) {
      return null;
    }

    const rate = this.totalPointsRate();

    return rate ? `Gana 1 punto por cada $${rate} en comida` : null;
  });

  private readonly totalPointsRate = computed(() => {
    const result = this.store.orderResult();
    return result?.pointsRate ?? null;
  });

  ngOnInit(): void {
    const tenantId = this.route.snapshot.paramMap.get('tenantId');
    const branchId = this.route.snapshot.paramMap.get('branchId');

    if (!tenantId || !branchId) {
      this.store.setError('QR inválido: falta el local o la sucursal.');
      return;
    }

    this.store.init(tenantId, branchId);
    const newSession = this.journey.start(tenantId, branchId);
    // Después de init(): la identidad recordada se carga ahí.
    this.nameInput.set(this.store.name());
    this.phoneInput.set(this.store.phone());

    // Cliente que vuelve: no ve el formulario, pero la sesión queda identificada.
    if (newSession && this.store.name() && this.store.phone()) {
      this.trackIdentity();
    }

    void this.loadMenu(tenantId, branchId);
  }

  async loadMenu(tenantId: string, branchId: string): Promise<void> {
    this.store.clearError();

    try {
      const menu = await lastValueFrom(this.api.getMenu(tenantId, branchId));
      this.store.setMenu(menu);
      this.journey.track({ type: 'menu_loaded', data: { dishCount: menu.dishes.length } });
    } catch (error) {
      this.store.setError('No se pudo cargar el menú. Verificá que el QR sea válido.');
      this.journey.track({ type: 'menu_failed', data: describeHttpError(error) });
    }
  }

  savePhone(): void {
    const name = this.nameInput().trim();
    const phone = this.phoneInput().trim();
    this.store.saveIdentity(name, phone);
    this.trackIdentity();
  }

  private trackIdentity(): void {
    this.journey.track({
      type: 'identity_submitted',
      data: { name: this.store.name(), phone: this.store.phone() },
    });
  }

  openCart(): void {
    this.cartVisible.set(true);
    this.journey.track({ type: 'cart_opened', data: { itemCount: this.store.cartCount() } });
  }

  changeQuantity(item: CartItem, delta: 1 | -1): void {
    this.store.changeQuantity(item.dish.id, item.quantity + delta);
    this.journey.track({
      type: delta > 0 ? 'item_added' : 'item_removed',
      data: { dishId: item.dish.id, quantity: 1 },
    });
  }

  setFulfillment(type: FulfillmentType): void {
    this.store.fulfillment.set(type);
  }

  openDish(dish: MenuDish): void {
    this.selectedDish.set(dish);
    this.selectedQuantity.set(1);
  }

  closeDish(): void {
    this.selectedDish.set(null);
  }

  confirmDish(): void {
    const dish = this.selectedDish();

    if (dish) {
      const quantity = this.selectedQuantity();
      this.store.addToCart(dish, quantity);
      this.journey.track({ type: 'item_added', data: { dishId: dish.id, quantity } });
    }

    this.closeDish();
  }

  formatPrice(value: number): string {
    return `$${value.toLocaleString('es-CL')}`;
  }

  async submitOrder(): Promise<void> {
    const tenantId = this.store.tenantId();
    const branchId = this.store.branchId();

    if (!tenantId || !branchId || !this.canSubmitOrder()) {
      return;
    }

    this.submitting.set(true);
    this.store.clearError();
    this.journey.track({
      type: 'order_submitted',
      data: { itemCount: this.store.cartCount(), total: this.store.cartTotal() },
    });

    try {
      const orderType = this.store.fulfillment();
      const input: CreateOrderInput = {
        tenantId,
        branchId,
        name: this.store.name(),
        phone: this.store.phone(),
        orderType,
        items: this.store.cart().map((item) => ({
          dishId: item.dish.id,
          quantity: item.quantity,
        })),
      };

      if (orderType === 'delivery') {
        const { address, reference, lat, lng, accuracy } = this.store.delivery();
        input.delivery = {
          address: address.trim(),
          reference: reference?.trim() || undefined,
          lat,
          lng,
          accuracy,
        };
      }

      const result = await lastValueFrom(this.api.createOrder(input, this.journey.sessionId));

      if (orderType === 'delivery') {
        this.store.rememberDelivery(this.store.delivery());
      }

      this.store.confirm(result);
    } catch (error) {
      this.store.setError('No se pudo enviar el pedido. Intentalo de nuevo.');
      // Si hubo respuesta HTTP, el servidor ya registró el fallo con su motivo.
      const failure = describeHttpError(error);
      if (failure.status === 0) {
        this.journey.track({ type: 'order_failed', data: failure });
      }
    } finally {
      this.submitting.set(false);
    }
  }

  switchTo(step: 'menu' | 'success'): void {
    if (step === 'menu' && this.store.step() === 'success') {
      // Nuevo pedido: nueva sesión del recorrido, ya identificada.
      this.journey.restart();
      this.trackIdentity();
    }
    this.store.step.set(step);
  }

  getEarnedPoints(result: CreateOrderResult): number {
    return result.pointsRate ? Math.floor(result.total / result.pointsRate) : 0;
  }
}

function describeHttpError(error: unknown): { status: number; reason?: string } {
  if (error instanceof HttpErrorResponse) {
    const apiMessage = typeof error.error?.error === 'string' ? error.error.error : undefined;
    return { status: error.status, reason: (apiMessage ?? error.statusText ?? '').slice(0, 200) || undefined };
  }

  return { status: 0, reason: 'Unexpected error' };
}
