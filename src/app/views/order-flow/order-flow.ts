import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { lastValueFrom } from 'rxjs';

import {
  CartItem,
  ITEM_NOTE_MAX_LENGTH,
  NAME_MAX_LENGTH,
  OrderStore,
} from '../../services/order-store.service';
import { ExpectedPaymentMethod, MenuDish } from '../../services/api-types';
import { ActiveOrderService } from '../../services/active-order.service';
import { PublicApiService } from '../../services/public-api.service';
import { JourneyService } from '../../services/journey.service';
import { ThemeToggle } from '../../components/theme-toggle/theme-toggle';
import { DeliveryLocation } from '../../components/delivery-location/delivery-location';
import { MOBILE_DIGITS, MOBILE_PREFIX, isCompleteMobile, sanitizeMobileDigits } from '../../utils/phone';
import { formatPrice } from '../../utils/format';

const PAYMENT_LABELS: Record<ExpectedPaymentMethod, string> = {
  cash: '💵 Efectivo',
  debit: '💳 Débito',
  credit: '💳 Crédito',
  card: '💳 Tarjeta (débito o crédito)',
};

@Component({
  selector: 'app-order-flow',
  imports: [FormsModule, ThemeToggle, DeliveryLocation],
  templateUrl: './order-flow.html',
  styleUrl: './order-flow.scss',
})
export class OrderFlowView implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly api = inject(PublicApiService);
  private readonly journey = inject(JourneyService);
  private readonly activeOrder = inject(ActiveOrderService);
  readonly store = inject(OrderStore);

  readonly mobilePrefix = MOBILE_PREFIX;
  readonly mobileDigits = MOBILE_DIGITS;
  readonly nameMaxLength = NAME_MAX_LENGTH;
  readonly noteMaxLength = ITEM_NOTE_MAX_LENGTH;
  readonly paymentLabels = PAYMENT_LABELS;
  readonly formatPrice = formatPrice;

  readonly nameInput = signal('');
  readonly editingName = signal(false);
  readonly query = signal('');
  readonly activeCategory = signal('all');
  readonly selectedDish = signal<MenuDish | null>(null);
  readonly selectedQuantity = signal(1);
  readonly selectedNote = signal('');
  readonly cartVisible = signal(false);
  readonly offerPickup = signal(false);

  readonly phoneComplete = computed(() => isCompleteMobile(this.store.phoneDigits()));

  readonly nameValid = computed(() => {
    const value = this.nameInput().trim();
    return value.length > 0 && value.length <= NAME_MAX_LENGTH;
  });

  /** Cliente conocido sin "¿No eres tú?": se saluda y no se pide el nombre. */
  readonly greeting = computed(() =>
    this.store.known() && this.store.knownFirstName() && !this.editingName()
      ? this.store.knownFirstName()
      : null
  );

  readonly visibleDishes = computed(() => {
    const term = this.query().trim().toLowerCase();
    const category = this.activeCategory();

    return this.store
      .branchDishes()
      .filter((dish) => category === 'all' || dish.category === category)
      .filter((dish) => term === '' || dish.name.toLowerCase().includes(term));
  });

  readonly confirmLabel = computed(() => {
    if (this.store.submitting()) {
      return 'Enviando…';
    }

    return this.store.fulfillment() === 'delivery'
      ? `Confirmar pedido · pagas ${formatPrice(this.store.cartTotal())} al recibir`
      : `Confirmar pedido · ${formatPrice(this.store.cartTotal())}`;
  });

  ngOnInit(): void {
    const tenantId = this.route.snapshot.paramMap.get('tenantId');
    const branchId = this.route.snapshot.paramMap.get('branchId');

    if (!tenantId || !branchId) {
      this.store.setError('QR inválido: falta el local o la sucursal.');
      return;
    }

    // Pedido en curso en este teléfono: se vuelve directo al seguimiento.
    const receipt = this.activeOrder.get(tenantId, branchId);
    if (receipt) {
      void this.router.navigate(['/q', tenantId, branchId, 'pedido', receipt.number], {
        replaceUrl: true,
      });
      return;
    }

    this.store.init(tenantId, branchId);
    this.journey.start(tenantId, branchId);
    void this.loadMenu(tenantId, branchId);
  }

  async loadMenu(tenantId: string, branchId: string): Promise<void> {
    this.store.clearError();

    try {
      const menu = await lastValueFrom(this.api.getMenu(tenantId, branchId));
      this.store.setMenu(menu);
      this.journey.track({ type: 'menu_loaded', data: { dishCount: menu.dishes.length } });
    } catch (error) {
      this.store.setError('No se pudo cargar el menú. Verifica que el QR sea válido.');
      this.journey.track({ type: 'menu_failed', data: describeHttpError(error) });
    }
  }

  // Teléfono

  onPhoneInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const digits = sanitizeMobileDigits(input.value);
    input.value = digits;
    this.store.phoneDigits.set(digits);
  }

  async submitPhone(): Promise<void> {
    if (!this.phoneComplete() || this.store.lookingUp()) {
      return;
    }

    await this.store.lookup();
    this.editingName.set(false);
    this.nameInput.set(this.store.name());
  }

  // Saludo / nombre

  notMe(): void {
    this.store.notMe();
    this.editingName.set(true);
    this.nameInput.set('');
  }

  continueIdentity(): void {
    if (this.greeting()) {
      this.store.confirmIdentity(this.store.name() || this.store.knownFirstName()!);
      return;
    }

    if (this.nameValid()) {
      this.store.confirmIdentity(this.nameInput());
    }
  }

  // Dirección

  useSavedAddress(id: string): void {
    this.store.addressChoice.set({ kind: 'saved', id });
  }

  useNewAddress(): void {
    this.store.addressChoice.set({ kind: 'new' });
  }

  continueAddress(): void {
    if (this.store.addressReady()) {
      this.store.goTo('menu');
    }
  }

  pickupInstead(): void {
    this.offerPickup.set(false);
    this.store.switchToPickup();
  }

  // Menú y carrito

  openDish(dish: MenuDish): void {
    this.selectedDish.set(dish);
    this.selectedQuantity.set(1);
    this.selectedNote.set('');
  }

  closeDish(): void {
    this.selectedDish.set(null);
  }

  confirmDish(): void {
    const dish = this.selectedDish();

    if (dish) {
      const quantity = this.selectedQuantity();
      this.store.addToCart(dish, quantity, this.selectedNote());
      this.journey.track({ type: 'item_added', data: { dishId: dish.id, quantity } });
    }

    this.closeDish();
  }

  openCart(): void {
    this.cartVisible.set(true);
    this.journey.track({ type: 'cart_opened', data: { itemCount: this.store.cartCount() } });
  }

  changeQuantity(item: CartItem, delta: 1 | -1): void {
    this.store.changeQuantity(item.key, item.quantity + delta);
    this.journey.track({
      type: delta > 0 ? 'item_added' : 'item_removed',
      data: { dishId: item.dish.id, quantity: 1 },
    });
  }

  goToSummary(): void {
    this.cartVisible.set(false);
    this.store.goTo('summary');
  }

  // Resumen

  onCashTendered(value: string): void {
    const digits = String(value ?? '').replace(/\D/g, '');
    this.store.cashTendered.set(digits ? Number(digits) : null);
  }

  async confirmOrder(): Promise<void> {
    this.offerPickup.set(false);
    const outcome = await this.store.submit();

    if (outcome.ok) {
      void this.router.navigate(
        ['/q', this.store.tenantId(), this.store.branchId(), 'pedido', outcome.result.number],
        { replaceUrl: true }
      );
      return;
    }

    if (outcome.outOfRange || outcome.deliveryUnavailable) {
      this.offerPickup.set(true);
    }
  }
}

function describeHttpError(error: unknown): { status: number; reason?: string } {
  if (error instanceof HttpErrorResponse) {
    const apiMessage = typeof error.error?.error === 'string' ? error.error.error : undefined;
    return {
      status: error.status,
      reason: (apiMessage ?? error.statusText ?? '').slice(0, 200) || undefined,
    };
  }

  return { status: 0, reason: 'Unexpected error' };
}
