import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

import { environment } from '../../environments/environment';
import {
  CreateOrderInput,
  CreateOrderResult,
  CustomerBalance,
  PublicMenu,
} from './order-store.service';

@Injectable({ providedIn: 'root' })
export class PublicApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = environment.apiUrl;

  getMenu(tenantId: string, branchId: string): Observable<PublicMenu> {
    return this.http.get<PublicMenu>(`${this.baseUrl}/api/public/menu`, {
      params: { tenantId, branchId },
    });
  }

  createOrder(input: CreateOrderInput): Observable<CreateOrderResult> {
    return this.http.post<CreateOrderResult>(
      `${this.baseUrl}/api/public/orders`,
      input
    );
  }

  getBalance(
    tenantId: string,
    branchId: string,
    phone: string
  ): Observable<CustomerBalance> {
    return this.http.get<CustomerBalance>(
      `${this.baseUrl}/api/public/customers/balance`,
      { params: { tenantId, branchId, phone } }
    );
  }
}