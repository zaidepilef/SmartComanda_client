import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { lastValueFrom } from 'rxjs';

import {
  CreateOrderInput,
  CreateOrderResult,
  DeliveryEstimate,
  DeliveryInput,
  ExpectedPaymentMethod,
  FulfillmentType,
  MenuDish,
  PublicMenu,
  SavedAddress,
} from './api-types';
import { ActiveOrderService } from './active-order.service';
import { JourneyService } from './journey.service';
import { PublicApiService } from './public-api.service';
import { mobileDigitsOf, toCanonicalMobile } from '../utils/phone';
import { readStorage, writeStorage } from '../utils/storage';
import { uuidV4 } from '../utils/uuid';

export type { FulfillmentType, MenuDish, PublicMenu, DeliveryInput, DeliveryEstimate } from './api-types';

export const DELIVERY_ADDRESS_MIN_LENGTH = 5;
export const NAME_MAX_LENGTH = 80;
export const ITEM_NOTE_MAX_LENGTH = 140;

/** Pasos del pedido, en orden. `address` solo existe en domicilio. */
export type OrderStep = 'mode' | 'phone' | 'identity' | 'address' | 'menu' | 'summary';

export interface CartItem {
  /** Plato + nota: el mismo plato con otra nota es otra línea. */
  key: string;
  dish: MenuDish;
  quantity: number;
  note: string;
}

/** Dirección elegida: una guardada (el servidor tiene sus coordenadas) o una nueva. */
export type AddressChoice = { kind: 'saved'; id: string } | { kind: 'new' };

export type SubmitOutcome =
  | { ok: true; result: CreateOrderResult }
  | { ok: false; outOfRange?: boolean; deliveryUnavailable?: boolean };

const PHONE_KEY = (tenantId: string) => `sc_phone_${tenantId}`;
const NAME_KEY = (tenantId: string) => `sc_name_${tenantId}`;
const DELIVERY_KEY = (tenantId: string) => `sc_delivery_${tenantId}`;

const EMPTY_DELIVERY: DeliveryInput = { address: '' };

function readDelivery(tenantId: string): DeliveryInput {
  try {
    const parsed = JSON.parse(readStorage(DELIVERY_KEY(tenantId)) || 'null');

    if (parsed && typeof parsed.address === 'string') {
      return {
        address: parsed.address,
        reference: typeof parsed.reference === 'string' ? parsed.reference : undefined,
        lat: Number.isFinite(parsed.lat) ? parsed.lat : undefined,
        lng: Number.isFinite(parsed.lng) ? parsed.lng : undefined,
      };
    }
  } catch {
    // Valor corrupto: se ignora.
  }

  return EMPTY_DELIVERY;
}

const cartKey = (dishId: string, note: string) => `${dishId}::${note}`;

function firstWord(name: string): string {
  return name.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
}

/**
 * Estado y reglas del flujo de compra del cliente:
 * modalidad → teléfono → saludo/nombre → dirección (domicilio) → menú → resumen.
 */
@Injectable({ providedIn: 'root' })
export class OrderStore {
  private readonly api = inject(PublicApiService);
  private readonly journey = inject(JourneyService);
  private readonly activeOrder = inject(ActiveOrderService);

  readonly tenantId = signal<string | null>(null);
  readonly branchId = signal<string | null>(null);
  readonly menu = signal<PublicMenu | null>(null);
  readonly step = signal<OrderStep>('mode');
  readonly error = signal<string | null>(null);
  readonly cart = signal<CartItem[]>([]);

  readonly fulfillment = signal<FulfillmentType>('qr');

  // Identidad
  readonly phoneDigits = signal('');
  readonly name = signal('');
  readonly known = signal(false);
  /** Primer nombre que devolvió la búsqueda (cliente conocido). */
  readonly knownFirstName = signal<string | null>(null);
  readonly lookingUp = signal(false);

  // Dirección
  readonly savedAddresses = signal<SavedAddress[]>([]);
  readonly addressChoice = signal<AddressChoice>({ kind: 'new' });
  readonly delivery = signal<DeliveryInput>(EMPTY_DELIVERY);
  readonly deliveryEstimate = signal<DeliveryEstimate | null>(null);

  // Resumen
  readonly expectedPaymentMethod = signal<ExpectedPaymentMethod | null>(null);
  readonly cashTendered = signal<number | null>(null);
  readonly submitting = signal(false);
  /** Se genera al entrar al resumen y se reutiliza en los reintentos (idempotencia). */
  private clientRequestId: string | null = null;

  readonly phone = computed(() => toCanonicalMobile(this.phoneDigits()));

  readonly branchDishes = computed(() => {
    const menu = this.menu();
    return menu ? [...menu.dishes].sort((a, b) => a.category.localeCompare(b.category)) : [];
  });

  readonly categories = computed(() => {
    const seen = new Map<string, { name: string; icon: string }>();
    for (const dish of this.branchDishes()) {
      if (!seen.has(dish.category)) {
        seen.set(dish.category, { name: dish.category, icon: dish.icon ?? '🍽️' });
      }
    }
    return [...seen.values()];
  });

  readonly cartTotal = computed(() =>
    this.cart().reduce((acc, item) => acc + item.dish.price * item.quantity, 0)
  );

  readonly cartCount = computed(() => this.cart().reduce((acc, item) => acc + item.quantity, 0));

  /** Medios que la app ofrece según la modalidad y lo que la sucursal tiene habilitado. */
  readonly paymentOptions = computed<ExpectedPaymentMethod[]>(() => {
    const methods = this.menu()?.paymentMethods ?? [];
    const options: ExpectedPaymentMethod[] = [];

    if (methods.includes('cash')) {
      options.push('cash');
    }

    if (this.fulfillment() === 'delivery') {
      if (methods.includes('debit') || methods.includes('credit')) {
        options.push('card');
      }
    } else {
      if (methods.includes('debit')) options.push('debit');
      if (methods.includes('credit')) options.push('credit');
    }

    return options;
  });

  readonly change = computed(() => {
    const tendered = this.cashTendered();
    return tendered !== null && tendered >= this.cartTotal() ? tendered - this.cartTotal() : null;
  });

  /** Dirección nueva lista: texto mínimo, punto en el mapa y dentro de la cobertura. */
  readonly newAddressReady = computed(() => {
    const delivery = this.delivery();
    const estimate = this.deliveryEstimate();
    return (
      delivery.address.trim().length >= DELIVERY_ADDRESS_MIN_LENGTH &&
      delivery.lat !== undefined &&
      delivery.lng !== undefined &&
      estimate !== null &&
      !estimate.outOfRange
    );
  });

  readonly addressReady = computed(() =>
    this.addressChoice().kind === 'saved' ? true : this.newAddressReady()
  );

  readonly canConfirm = computed(() => {
    const method = this.expectedPaymentMethod();
    const tendered = this.cashTendered();

    return (
      this.cartCount() > 0 &&
      method !== null &&
      this.paymentOptions().includes(method) &&
      (tendered === null || (method === 'cash' && tendered >= this.cartTotal())) &&
      (this.fulfillment() !== 'delivery' || this.addressReady())
    );
  });

  init(tenantId: string, branchId: string): void {
    this.tenantId.set(tenantId);
    this.branchId.set(branchId);
    this.error.set(null);
    this.menu.set(null);
    this.step.set('mode');
    this.cart.set([]);
    this.known.set(false);
    this.knownFirstName.set(null);
    this.savedAddresses.set([]);
    this.addressChoice.set({ kind: 'new' });
    this.expectedPaymentMethod.set(null);
    this.cashTendered.set(null);
    this.deliveryEstimate.set(null);
    this.name.set(readStorage(NAME_KEY(tenantId)));
    this.phoneDigits.set(mobileDigitsOf(readStorage(PHONE_KEY(tenantId))));
    this.delivery.set(readDelivery(tenantId));
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

  goTo(step: OrderStep): void {
    this.clearError();
    if (step === 'summary') {
      this.enterSummary();
    }
    this.step.set(step);
  }

  /** Paso anterior según la modalidad; el carrito se conserva. */
  back(): void {
    const order: OrderStep[] =
      this.fulfillment() === 'delivery'
        ? ['mode', 'phone', 'identity', 'address', 'menu', 'summary']
        : ['mode', 'phone', 'identity', 'menu', 'summary'];
    const index = order.indexOf(this.step());
    this.goTo(order[Math.max(0, index - 1)]);
  }

  chooseMode(mode: FulfillmentType): void {
    if (mode === 'delivery' && !this.menu()?.deliveryAvailable) {
      return;
    }

    this.fulfillment.set(mode);
    this.journey.track({ type: 'mode_selected', data: { mode: mode === 'delivery' ? 'delivery' : 'pickup' } });
    this.goTo('phone');
  }

  /** Busca al cliente por teléfono; si la búsqueda falla, se sigue pidiendo el nombre. */
  async lookup(): Promise<void> {
    const tenantId = this.tenantId();
    const branchId = this.branchId();

    if (!tenantId || !branchId) {
      return;
    }

    this.lookingUp.set(true);
    this.clearError();

    try {
      const result = await lastValueFrom(
        this.api.lookupCustomer({ tenantId, branchId, phone: this.phone() })
      );

      this.known.set(result.known);
      this.knownFirstName.set(result.known ? result.firstName ?? null : null);
      this.savedAddresses.set(result.addresses ?? []);
      this.addressChoice.set(
        result.lastAddressId ? { kind: 'saved', id: result.lastAddressId } : { kind: 'new' }
      );

      if (result.known && result.firstName) {
        // Se mantiene el nombre completo recordado si corresponde a la misma persona.
        if (firstWord(this.name()) !== firstWord(result.firstName)) {
          this.name.set(result.firstName);
        }
      } else if (!result.known) {
        // Teléfono nuevo: el nombre recordado es de otra persona.
        this.name.set('');
      }
    } catch (error) {
      // Sin búsqueda: solo se reutiliza el nombre recordado si es del mismo teléfono.
      const sameDevicePhone = readStorage(PHONE_KEY(tenantId)) === this.phone();
      this.name.set(sameDevicePhone ? readStorage(NAME_KEY(tenantId)) : '');
      this.known.set(false);
      this.knownFirstName.set(null);
      this.savedAddresses.set([]);
      this.addressChoice.set({ kind: 'new' });

      if (error instanceof HttpErrorResponse && error.status === 429) {
        this.setError('Demasiados intentos. Espera unos minutos o continúa con tu nombre.');
      }
    } finally {
      this.lookingUp.set(false);
    }

    writeStorage(PHONE_KEY(tenantId), this.phone());
    this.journey.track({ type: 'customer_looked_up', data: { known: this.known() } });
    this.step.set('identity');
  }

  /** "¿No eres tú?": se pide el nombre como a un cliente nuevo, sin las direcciones guardadas. */
  notMe(): void {
    this.known.set(false);
    this.knownFirstName.set(null);
    this.name.set('');
    this.savedAddresses.set([]);
    this.addressChoice.set({ kind: 'new' });
  }

  confirmIdentity(name: string): void {
    const tenantId = this.tenantId();
    const clean = name.trim();

    if (!clean || clean.length > NAME_MAX_LENGTH) {
      return;
    }

    this.name.set(clean);

    if (tenantId) {
      writeStorage(NAME_KEY(tenantId), clean);
    }

    this.journey.track({ type: 'identity_submitted', data: { name: clean, phone: this.phone() } });
    this.goTo(this.fulfillment() === 'delivery' ? 'address' : 'menu');
  }

  /** Cambio a retiro cuando el domicilio no es posible: se conserva el carrito. */
  switchToPickup(): void {
    this.fulfillment.set('qr');
    this.journey.track({ type: 'mode_selected', data: { mode: 'pickup' } });
    this.expectedPaymentMethod.set(null);
    this.cashTendered.set(null);
    this.goTo(this.step() === 'summary' ? 'summary' : 'menu');
  }

  addToCart(dish: MenuDish, quantity: number, note = ''): void {
    const cleanNote = note.trim().slice(0, ITEM_NOTE_MAX_LENGTH);
    const key = cartKey(dish.id, cleanNote);
    const current = this.cart();

    if (current.some((item) => item.key === key)) {
      this.cart.set(
        current.map((item) => (item.key === key ? { ...item, quantity: item.quantity + quantity } : item))
      );
      return;
    }

    this.cart.set([...current, { key, dish, quantity, note: cleanNote }]);
  }

  changeQuantity(key: string, quantity: number): void {
    if (quantity <= 0) {
      this.cart.set(this.cart().filter((item) => item.key !== key));
      return;
    }

    this.cart.set(this.cart().map((item) => (item.key === key ? { ...item, quantity } : item)));
  }

  private enterSummary(): void {
    this.clientRequestId = uuidV4();
    // La API rechaza el lote completo si el resumen llega sin ítems.
    if (this.cartCount() > 0) {
      this.journey.track({
        type: 'summary_opened',
        data: { itemCount: this.cartCount(), total: this.cartTotal() },
      });
    }
    const options = this.paymentOptions();
    const current = this.expectedPaymentMethod();

    if (current === null || !options.includes(current)) {
      this.expectedPaymentMethod.set(options.length === 1 ? options[0] : null);
    }

    if (this.expectedPaymentMethod() !== 'cash') {
      this.cashTendered.set(null);
    }
  }

  setPaymentMethod(method: ExpectedPaymentMethod): void {
    this.expectedPaymentMethod.set(method);
    if (method !== 'cash') {
      this.cashTendered.set(null);
    }
  }

  private buildOrderInput(tenantId: string, branchId: string): CreateOrderInput {
    const orderType = this.fulfillment();
    const input: CreateOrderInput = {
      tenantId,
      branchId,
      name: this.name(),
      phone: this.phone(),
      orderType,
      clientRequestId: this.clientRequestId ?? (this.clientRequestId = uuidV4()),
      expectedPaymentMethod: this.expectedPaymentMethod()!,
      items: this.cart().map((item) => ({
        dishId: item.dish.id,
        quantity: item.quantity,
        ...(item.note ? { note: item.note } : {}),
      })),
    };

    const tendered = this.cashTendered();
    if (tendered !== null && input.expectedPaymentMethod === 'cash') {
      input.cashTendered = tendered;
    }

    if (orderType === 'delivery') {
      const choice = this.addressChoice();
      const { address, reference, lat, lng, accuracy } = this.delivery();

      input.delivery =
        choice.kind === 'saved'
          ? { addressId: choice.id }
          : { address: address.trim(), reference: reference?.trim() || undefined, lat, lng, accuracy };
    }

    return input;
  }

  /**
   * Envía el pedido. El mismo `clientRequestId` se reutiliza en los reintentos:
   * si la primera respuesta se perdió, el servidor devuelve el mismo pedido.
   */
  async submit(): Promise<SubmitOutcome> {
    const tenantId = this.tenantId();
    const branchId = this.branchId();

    if (!tenantId || !branchId || !this.canConfirm() || this.submitting()) {
      return { ok: false };
    }

    this.submitting.set(true);
    this.clearError();
    this.journey.track({
      type: 'order_submitted',
      data: { itemCount: this.cartCount(), total: this.cartTotal() },
    });

    try {
      const result = await lastValueFrom(
        this.api.createOrder(this.buildOrderInput(tenantId, branchId), this.journey.sessionId)
      );

      if (this.fulfillment() === 'delivery' && this.addressChoice().kind === 'new') {
        writeStorage(DELIVERY_KEY(tenantId), JSON.stringify(this.delivery()));
      }

      this.activeOrder.save(tenantId, branchId, {
        number: result.number,
        trackingToken: result.trackingToken ?? null,
        phone: this.phone(),
        mode: result.orderType ?? this.fulfillment(),
        total: result.total,
        createdAt: new Date().toISOString(),
      });

      this.cart.set([]);
      this.clientRequestId = null;
      return { ok: true, result };
    } catch (error) {
      return this.handleSubmitError(error);
    } finally {
      this.submitting.set(false);
    }
  }

  private handleSubmitError(error: unknown): SubmitOutcome {
    if (!(error instanceof HttpErrorResponse)) {
      this.setError('No se pudo enviar el pedido. Inténtalo de nuevo.');
      return { ok: false };
    }

    const code = typeof error.error?.code === 'string' ? error.error.code : undefined;

    if (error.status === 422 && code === 'DELIVERY_OUT_OF_RANGE') {
      this.setError('Tu dirección está fuera de nuestra zona de reparto. Puedes retirar en el local.');
      return { ok: false, outOfRange: true };
    }

    if (error.status === 422 && code === 'DELIVERY_UNAVAILABLE') {
      this.setError('Este local no está haciendo despachos ahora. Puedes retirar en el local.');
      return { ok: false, deliveryUnavailable: true };
    }

    if (error.status === 409) {
      // El id ya se usó con otro teléfono: se genera uno nuevo para el próximo intento.
      this.clientRequestId = uuidV4();
      this.setError('No pudimos confirmar el pedido. Revisa los datos e inténtalo de nuevo.');
      return { ok: false };
    }

    if (error.status === 429) {
      this.setError('Demasiados intentos. Espera un momento e inténtalo de nuevo.');
      return { ok: false };
    }

    if (error.status === 0) {
      this.journey.track({ type: 'order_failed', data: { status: 0, reason: 'Network error' } });
      this.setError('Sin conexión. Revisa tu internet e inténtalo de nuevo: no se duplicará tu pedido.');
      return { ok: false };
    }

    this.setError('No se pudo enviar el pedido. Revisa los datos e inténtalo de nuevo.');
    return { ok: false };
  }
}
