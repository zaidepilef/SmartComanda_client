import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  inject,
  input,
  model,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { lastValueFrom } from 'rxjs';
import * as L from 'leaflet';

import { GeolocationService, geolocationErrorMessage } from '../../services/geolocation.service';
import { DeliveryEstimate, DeliveryInput } from '../../services/api-types';
import { PublicApiService } from '../../services/public-api.service';

/** Centro inicial del mapa antes de conocer la ubicación del cliente (Santiago). */
const DEFAULT_CENTER: L.LatLngTuple = [-33.4489, -70.6693];
const POINT_ZOOM = 17;

const PIN_ICON = L.divIcon({
  className: '',
  html: '<div class="delivery-pin"></div>',
  iconSize: [26, 26],
  iconAnchor: [13, 26],
});

const round6 = (value: number): number => Math.round(value * 1e6) / 1e6;

/**
 * Dirección de entrega: "Usar mi ubicación" (GPS del teléfono), mapa para ajustar el punto,
 * dirección editable y referencia. Muestra la estimación de llegada que calcula el servidor.
 */
@Component({
  selector: 'app-delivery-location',
  imports: [FormsModule],
  templateUrl: './delivery-location.html',
  styleUrl: './delivery-location.scss',
})
export class DeliveryLocation implements AfterViewInit, OnDestroy {
  private readonly geolocation = inject(GeolocationService);
  private readonly api = inject(PublicApiService);

  readonly tenantId = input.required<string>();
  readonly branchId = input.required<string>();
  /** Datos de entrega (dirección, referencia y punto) compartidos con el carrito. */
  readonly delivery = model.required<DeliveryInput>();
  readonly estimate = model<DeliveryEstimate | null>(null);

  readonly mapEl = viewChild.required<ElementRef<HTMLDivElement>>('mapEl');

  readonly locating = signal(false);
  readonly estimating = signal(false);
  readonly locationError = signal('');

  private map: L.Map | null = null;
  private marker: L.Marker | null = null;
  private estimateSeq = 0;

  ngAfterViewInit(): void {
    const current = this.delivery();
    const hasPoint = current.lat !== undefined && current.lng !== undefined;

    this.map = L.map(this.mapEl().nativeElement, { zoomControl: true }).setView(
      hasPoint ? [current.lat!, current.lng!] : DEFAULT_CENTER,
      hasPoint ? POINT_ZOOM : 12
    );

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap',
    }).addTo(this.map);

    this.map.on('click', (event: L.LeafletMouseEvent) => this.setPoint(event.latlng.lat, event.latlng.lng));

    if (hasPoint) {
      this.placeMarker(current.lat!, current.lng!);
      void this.refreshEstimate();
    }

    // El mapa vive dentro del panel del carrito, que se acaba de abrir.
    setTimeout(() => this.map?.invalidateSize(), 50);
  }

  ngOnDestroy(): void {
    this.map?.remove();
    this.map = null;
  }

  async useMyLocation(): Promise<void> {
    this.locating.set(true);
    this.locationError.set('');

    try {
      const position = await this.geolocation.getCurrentPosition();
      this.setPoint(position.lat, position.lng, position.accuracy);
    } catch (error) {
      this.locationError.set(geolocationErrorMessage(error));
    } finally {
      this.locating.set(false);
    }
  }

  updateAddress(address: string): void {
    // Escrita por el cliente: ya no se reemplaza al mover el marcador.
    this.delivery.update((current) => ({ ...current, address, addressFromMap: false }));
  }

  updateReference(reference: string): void {
    this.delivery.update((current) => ({ ...current, reference }));
  }

  /** Fija el punto, rellena la dirección si está vacía o vino del mapa y pide la estimación. */
  private setPoint(lat: number, lng: number, accuracy?: number): void {
    const previous = this.delivery();
    const autoAddress = !previous.address.trim() || previous.addressFromMap === true;

    this.delivery.set({
      ...previous,
      lat: round6(lat),
      lng: round6(lng),
      accuracy: accuracy !== undefined ? Math.round(accuracy) : undefined,
    });

    this.placeMarker(lat, lng);
    this.map?.setView([lat, lng], Math.max(this.map.getZoom(), POINT_ZOOM));
    void this.refreshEstimate();

    if (autoAddress) {
      void this.fillAddress(lat, lng);
    }
  }

  private async fillAddress(lat: number, lng: number): Promise<void> {
    const address = await this.geolocation.reverseGeocode(lat, lng);
    const current = this.delivery();

    // Solo si el cliente no escribió otra dirección mientras tanto y el punto sigue siendo el mismo.
    if (address && current.lat === round6(lat) && current.lng === round6(lng)) {
      if (!current.address.trim() || current.addressFromMap) {
        this.delivery.set({ ...current, address, addressFromMap: true });
      }
    }
  }

  private async refreshEstimate(): Promise<void> {
    const { lat, lng } = this.delivery();

    if (lat === undefined || lng === undefined) {
      return;
    }

    const seq = ++this.estimateSeq;
    this.estimating.set(true);

    try {
      const result = await lastValueFrom(
        this.api.getDeliveryEstimate({ tenantId: this.tenantId(), branchId: this.branchId(), lat, lng })
      );

      if (seq === this.estimateSeq) {
        this.estimate.set(result.estimate);
      }
    } catch {
      if (seq === this.estimateSeq) {
        this.estimate.set(null);
      }
    } finally {
      if (seq === this.estimateSeq) {
        this.estimating.set(false);
      }
    }
  }

  private placeMarker(lat: number, lng: number): void {
    if (!this.map) {
      return;
    }

    if (this.marker) {
      this.marker.setLatLng([lat, lng]);
      return;
    }

    this.marker = L.marker([lat, lng], { draggable: true, icon: PIN_ICON }).addTo(this.map);
    this.marker.on('dragend', () => {
      const position = this.marker?.getLatLng();

      if (position) {
        this.setPoint(position.lat, position.lng);
      }
    });
  }

  formatKm(value: number): string {
    return value.toLocaleString('es-CL', { maximumFractionDigits: 1 });
  }
}
