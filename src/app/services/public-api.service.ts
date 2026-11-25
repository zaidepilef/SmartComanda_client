import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';

import { environment } from '../../environments/environment';
import {
  CreateOrderInput,
  CreateOrderResult,
  CustomerLookupResult,
  DeliveryEstimateResult,
  PublicMenu,
  TrackedOrder,
} from './api-types';

@Injectable({ providedIn: 'root' })
export class PublicApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/api/public`;

  getMenu(tenantId: string, branchId: string): Observable<PublicMenu> {
    return this.http.get<PublicMenu>(`${this.baseUrl}/menu`, {
      params: { tenantId, branchId },
    });
  }

  /** POST para que el teléfono no quede en URLs ni en logs de acceso. */
  lookupCustomer(input: {
    tenantId: string;
    branchId: string;
    phone: string;
  }): Observable<CustomerLookupResult> {
    return this.http.post<CustomerLookupResult>(`${this.baseUrl}/customers/lookup`, input);
  }

  /** journeySessionId vincula el resultado del pedido al recorrido del cliente. */
  createOrder(input: CreateOrderInput, journeySessionId?: string | null): Observable<CreateOrderResult> {
    const headers = journeySessionId
      ? new HttpHeaders({ 'X-Journey-Session': journeySessionId })
      : undefined;

    return this.http.post<CreateOrderResult>(`${this.baseUrl}/orders`, input, { headers });
  }

  /** El token va en el cuerpo, nunca en la URL. */
  trackOrder(input: { tenantId: string; trackingToken: string }): Observable<TrackedOrder> {
    return this.http.post<TrackedOrder>(`${this.baseUrl}/orders/track`, input);
  }

  /** Distancia y minutos estimados desde la sucursal hasta el punto del cliente. */
  getDeliveryEstimate(input: {
    tenantId: string;
    branchId: string;
    lat: number;
    lng: number;
  }): Observable<DeliveryEstimateResult> {
    return this.http.post<DeliveryEstimateResult>(`${this.baseUrl}/delivery-estimate`, input);
  }
}
