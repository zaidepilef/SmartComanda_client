import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { lastValueFrom } from 'rxjs';

import { TrackedOrder } from '../../services/api-types';
import { ActiveOrderReceipt, ActiveOrderService } from '../../services/active-order.service';
import { PublicApiService } from '../../services/public-api.service';
import {
  METHOD_LABELS,
  STATUS_LABELS,
  isFinalStatus,
  paymentIndicatorOf,
  timelineOf,
} from '../../services/order-tracking';
import { ThemeToggle } from '../../components/theme-toggle/theme-toggle';
import { formatPrice } from '../../utils/format';

const POLL_INTERVAL_MS = 15_000;

/**
 * Seguimiento del pedido en curso. Mientras el pedido esté activo es la pantalla
 * a la que vuelve el cliente al recargar o reescanear el QR.
 */
@Component({
  selector: 'app-order-tracking',
  imports: [ThemeToggle],
  templateUrl: './order-tracking.html',
  styleUrl: './order-tracking.scss',
})
export class OrderTrackingView implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly api = inject(PublicApiService);
  private readonly activeOrder = inject(ActiveOrderService);
  private readonly destroyRef = inject(DestroyRef);

  readonly formatPrice = formatPrice;
  readonly methodLabels = METHOD_LABELS;

  readonly receipt = signal<ActiveOrderReceipt | null>(null);
  readonly order = signal<TrackedOrder | null>(null);
  readonly offline = signal(false);
  readonly finished = signal(false);

  readonly timeline = computed(() => {
    const order = this.order();
    return order ? timelineOf(order) : [];
  });

  readonly payment = computed(() => {
    const order = this.order();
    return order ? paymentIndicatorOf(order) : null;
  });

  /** Estado visible; el pago va aparte en su indicador ("Por pagar $X al recibir" / "Pagado ✓"). */
  readonly headline = computed(() => {
    const order = this.order();
    return order ? STATUS_LABELS[order.status] : null;
  });

  private tenantId = '';
  private branchId = '';
  private timer: ReturnType<typeof setInterval> | null = null;
  private loading = false;

  ngOnInit(): void {
    this.tenantId = this.route.snapshot.paramMap.get('tenantId') ?? '';
    this.branchId = this.route.snapshot.paramMap.get('branchId') ?? '';
    const number = Number(this.route.snapshot.paramMap.get('number'));
    const receipt = this.tenantId && this.branchId ? this.activeOrder.get(this.tenantId, this.branchId) : null;

    // Sin comprobante (u otro número) no hay nada que seguir en este teléfono.
    if (!receipt || receipt.number !== number) {
      this.goToNewOrder();
      return;
    }

    this.receipt.set(receipt);

    if (!receipt.trackingToken) {
      return;
    }

    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), POLL_INTERVAL_MS);

    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        void this.refresh();
      }
    };
    document.addEventListener('visibilitychange', onVisible);

    this.destroyRef.onDestroy(() => {
      this.stopPolling();
      document.removeEventListener('visibilitychange', onVisible);
    });
  }

  async refresh(): Promise<void> {
    const token = this.receipt()?.trackingToken;

    if (!token || this.loading || this.finished()) {
      return;
    }

    this.loading = true;

    try {
      const order = await lastValueFrom(
        this.api.trackOrder({ tenantId: this.tenantId, trackingToken: token })
      );
      this.order.set(order);
      this.offline.set(false);

      if (isFinalStatus(order.status)) {
        // Pedido cerrado: se muestra el estado final y se libera el teléfono para otro pedido.
        this.finished.set(true);
        this.stopPolling();
        this.activeOrder.clear(this.tenantId, this.branchId);
      }
    } catch (error) {
      if (error instanceof HttpErrorResponse && error.status === 404) {
        // El servidor no reconoce el token: se descarta y se empieza de nuevo.
        this.stopPolling();
        this.goToNewOrder();
        return;
      }

      this.offline.set(true);
    } finally {
      this.loading = false;
    }
  }

  newOrder(): void {
    this.goToNewOrder();
  }

  private goToNewOrder(): void {
    if (this.tenantId && this.branchId) {
      this.activeOrder.clear(this.tenantId, this.branchId);
      void this.router.navigate(['/q', this.tenantId, this.branchId], { replaceUrl: true });
    } else {
      void this.router.navigate(['/q'], { replaceUrl: true });
    }
  }

  private stopPolling(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
