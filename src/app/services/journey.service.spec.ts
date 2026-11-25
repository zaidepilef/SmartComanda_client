import { TestBed } from '@angular/core/testing';

import { JourneyService } from './journey.service';

const TENANT_ID = 'a'.repeat(24);
const BRANCH_ID = 'b'.repeat(24);
const FLUSH_DELAY_MS = 3000;

/** Deja correr las promesas pendientes del `fetch` simulado. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await Promise.resolve();
  }
}

function sentBatches(fetchMock: ReturnType<typeof vi.fn>): Array<{ sessionId: string; events: { type: string }[] }> {
  return fetchMock.mock.calls.map(([, init]) => JSON.parse((init as RequestInit).body as string));
}

describe('JourneyService (customer-journey-tracking)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    sessionStorage.clear();
    fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('no envía nada ni lanza error si se registra un evento sin sesión', () => {
    const journey = TestBed.inject(JourneyService);

    expect(() => journey.track({ type: 'cart_opened', data: { itemCount: 1 } })).not.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('envía en un lote los eventos de la sesión, con su identificador', async () => {
    const journey = TestBed.inject(JourneyService);
    journey.start(TENANT_ID, BRANCH_ID);
    journey.track({ type: 'mode_selected', data: { mode: 'pickup' } });

    await vi.advanceTimersByTimeAsync(FLUSH_DELAY_MS);

    const [batch] = sentBatches(fetchMock);
    expect(batch.sessionId).toBe(journey.sessionId);
    expect(batch.events.map((event) => event.type)).toEqual(['qr_opened', 'mode_selected']);
  });

  it('si la API de eventos no responde, reintenta una vez, descarta el lote y no lanza error', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const journey = TestBed.inject(JourneyService);
    journey.start(TENANT_ID, BRANCH_ID);

    // Evento urgente: se envía de inmediato.
    journey.track({ type: 'order_submitted', data: { itemCount: 1, total: 6000 } });
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(FLUSH_DELAY_MS);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Tras el segundo fallo el lote se descarta: no hay más envíos.
    await vi.advanceTimersByTimeAsync(FLUSH_DELAY_MS * 3);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reintenta ante un 5xx pero no ante un lote rechazado (4xx)', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 503 }));
    const journey = TestBed.inject(JourneyService);
    journey.start(TENANT_ID, BRANCH_ID);
    journey.track({ type: 'order_submitted', data: { itemCount: 1, total: 6000 } });
    await settle();
    await vi.advanceTimersByTimeAsync(FLUSH_DELAY_MS);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 400 }));
    journey.track({ type: 'order_failed', data: { status: 0, reason: 'Network error' } });
    await settle();
    await vi.advanceTimersByTimeAsync(FLUSH_DELAY_MS * 3);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('sin sessionStorage la sesión vive en memoria y el registro sigue funcionando', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    const journey = TestBed.inject(JourneyService);

    expect(journey.start(TENANT_ID, BRANCH_ID)).toBe(true);
    expect(journey.sessionId).toMatch(/^[0-9a-f-]{36}$/);

    journey.track({ type: 'cart_opened', data: { itemCount: 1 } });
    await vi.advanceTimersByTimeAsync(FLUSH_DELAY_MS);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
