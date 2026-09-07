import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { lastValueFrom } from 'rxjs';

import { OrderStore } from '../../services/order-store.service';
import { PublicApiService } from '../../services/public-api.service';
import { CreateOrderResult, MenuDish } from '../../services/order-store.service';
import { ThemeToggle } from '../../components/theme-toggle/theme-toggle';

const PHONE_PATTERN = /^\+?[0-9]{9,15}$/;

@Component({
  selector: 'app-order-flow',
  imports: [CommonModule, FormsModule, ThemeToggle],
  templateUrl: './order-flow.html',
  styleUrl: './order-flow.scss',
})
export class OrderFlowView implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(PublicApiService);
  readonly store = inject(OrderStore);

  readonly phoneInput = signal('');
  readonly query = signal('');
  readonly activeCategory = signal('all');
  readonly selectedDish = signal<MenuDish | null>(null);
  readonly selectedQuantity = signal(1);
  readonly submitting = signal(false);
  readonly cartVisible = signal(false);

  readonly phoneError = computed(() => {
    const value = this.phoneInput().trim();

    if (value === '') {
      return null;
    }

    return PHONE_PATTERN.test(value) ? null : 'Ingresa un teléfono válido (ej. +56912345678).';
  });

  readonly canSubmitPhone = computed(() => PHONE_PATTERN.test(this.phoneInput().trim()));

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

    this.phoneInput.set(this.store.phone());

    if (!tenantId || !branchId) {
      this.store.setError('QR inválido: falta el local o la sucursal.');
      return;
    }

    void this.loadMenu(tenantId, branchId);
  }

  async loadMenu(tenantId: string, branchId: string): Promise<void> {
    this.store.init(tenantId, branchId);
    this.store.clearError();

    try {
      const menu = await lastValueFrom(this.api.getMenu(tenantId, branchId));
      this.store.setMenu(menu);
    } catch {
      this.store.setError('No se pudo cargar el menú. Verificá que el QR sea válido.');
    }
  }

  savePhone(): void {
    this.store.setPhone(this.phoneInput().trim());
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
      this.store.addToCart(dish, this.selectedQuantity());
    }

    this.closeDish();
  }

  formatPrice(value: number): string {
    return `$${value.toLocaleString('es-CL')}`;
  }

  async submitOrder(): Promise<void> {
    const tenantId = this.store.tenantId();
    const branchId = this.store.branchId();

    if (!tenantId || !branchId || this.store.cartCount() === 0) {
      return;
    }

    this.submitting.set(true);
    this.store.clearError();

    try {
      const result = await lastValueFrom(
        this.api.createOrder({
          tenantId,
          branchId,
          phone: this.store.phone(),
          items: this.store.cart().map((item) => ({
            dishId: item.dish.id,
            quantity: item.quantity,
          })),
        })
      );

      this.store.confirm(result);
    } catch {
      this.store.setError('No se pudo enviar el pedido. Intentalo de nuevo.');
    } finally {
      this.submitting.set(false);
    }
  }

  switchTo(step: 'menu' | 'success'): void {
    this.store.step.set(step);
  }

  getEarnedPoints(result: CreateOrderResult): number {
    return result.pointsRate ? Math.floor(result.total / result.pointsRate) : 0;
  }
}