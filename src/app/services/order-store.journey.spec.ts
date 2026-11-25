import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { CreateOrderResult, MenuDish, PublicMenu } from './api-types';
import { JourneyService } from './journey.service';
import { OrderStore } from './order-store.service';

const TENANT_ID = 'a'.repeat(24);
const BRANCH_ID = 'b'.repeat(24);

const DISH: MenuDish = { id: 'c'.repeat(24), name: 'Completo italiano', category: 'Completos', price: 3500 };
const MENU: PublicMenu = {
  tenancy: { businessName: 'Local', branchName: 'Centro' },
  paymentMethods: ['cash', 'debit', 'credit'],
  deliveryAvailable: false,
  dishes: [DISH],
};
const CREATED: CreateOrderResult = {
  number: 7,
  orderId: 'd'.repeat(24),
  total: 3500,
  orderType: 'qr',
  status: 'awaiting_payment',
  expectedPaymentMethod: 'debit',
  cashTendered: null,
  pointsRate: null,
  pointsBalance: 0,
  trackingToken: 'T'.repeat(43),
};

/** Deja un pedido de retiro listo para confirmar, como lo haría el flujo. */
function prepareOrder(store: OrderStore): void {
  store.init(TENANT_ID, BRANCH_ID);
  store.setMenu(MENU);
  store.chooseMode('qr');
  store.phoneDigits.set('87654321');
  store.confirmIdentity('Ana Pérez');
  store.addToCart(DISH, 1);
  store.goTo('summary');
  store.expectedPaymentMethod.set('debit');
}

describe('OrderStore: el registro del recorrido no afecta el pedido', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    vi.unstubAllGlobals();
  });

  it('crea el pedido aunque la API de eventos esté caída', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const journey = TestBed.inject(JourneyService);
    const store = TestBed.inject(OrderStore);
    journey.start(TENANT_ID, BRANCH_ID);
    prepareOrder(store);

    const outcome = store.submit();
    const request = http.expectOne('/api/public/orders');
    expect(request.request.headers.get('X-Journey-Session')).toBe(journey.sessionId);
    request.flush(CREATED, { status: 201, statusText: 'Created' });

    await expect(outcome).resolves.toEqual({ ok: true, result: CREATED });
    expect(store.error()).toBeNull();
  });

  it('crea el pedido sin cabecera de sesión cuando el recorrido no se inició', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const store = TestBed.inject(OrderStore);
    prepareOrder(store);

    const outcome = store.submit();
    const request = http.expectOne('/api/public/orders');
    expect(request.request.headers.has('X-Journey-Session')).toBe(false);
    request.flush(CREATED, { status: 201, statusText: 'Created' });

    await expect(outcome).resolves.toMatchObject({ ok: true });
  });
});
