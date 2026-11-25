import { Injectable } from '@angular/core';

export interface DevicePosition {
  lat: number;
  lng: number;
  /** Radio de precisión en metros que informa el navegador. */
  accuracy: number;
}

export type GeolocationErrorKind = 'denied' | 'unavailable' | 'timeout' | 'unsupported' | 'insecure';

export class GeolocationError extends Error {
  constructor(readonly kind: GeolocationErrorKind) {
    super(kind);
  }
}

const POSITION_TIMEOUT_MS = 10_000;
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/reverse';

/**
 * Ubicación del dispositivo con la API de geolocalización del navegador
 * (requiere HTTPS o localhost y el permiso del cliente).
 */
@Injectable({ providedIn: 'root' })
export class GeolocationService {
  getCurrentPosition(): Promise<DevicePosition> {
    if (typeof window !== 'undefined' && !window.isSecureContext) {
      return Promise.reject(new GeolocationError('insecure'));
    }

    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      return Promise.reject(new GeolocationError('unsupported'));
    }

    return new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        (position) =>
          resolve({
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            accuracy: position.coords.accuracy,
          }),
        (error) => {
          const kind: GeolocationErrorKind =
            error.code === error.PERMISSION_DENIED
              ? 'denied'
              : error.code === error.TIMEOUT
                ? 'timeout'
                : 'unavailable';
          reject(new GeolocationError(kind));
        },
        { enableHighAccuracy: true, timeout: POSITION_TIMEOUT_MS, maximumAge: 60_000 }
      );
    });
  }

  /**
   * Dirección aproximada de un punto (OpenStreetMap Nominatim). Solo se llama por acción
   * del cliente (política de uso ~1 req/s). Devuelve null si no hay resultado.
   */
  async reverseGeocode(lat: number, lng: number): Promise<string | null> {
    const params = new URLSearchParams({
      format: 'jsonv2',
      lat: String(lat),
      lon: String(lng),
      zoom: '18',
      addressdetails: '1',
      'accept-language': 'es',
    });

    try {
      const response = await fetch(`${NOMINATIM_URL}?${params}`, { headers: { Accept: 'application/json' } });

      if (!response.ok) {
        return null;
      }

      const data = await response.json();
      return formatAddress(data?.address) ?? data?.display_name ?? null;
    } catch {
      return null;
    }
  }
}

/** "Calle 123, Comuna" a partir de la dirección de Nominatim. */
function formatAddress(address: Record<string, string> | undefined): string | null {
  if (!address) {
    return null;
  }

  const street = [address['road'] ?? address['pedestrian'] ?? address['footway'], address['house_number']]
    .filter(Boolean)
    .join(' ');
  const area = address['suburb'] ?? address['city_district'] ?? address['town'] ?? address['city'] ?? address['village'];
  const parts = [street, area].filter(Boolean);

  return parts.length > 0 ? parts.join(', ') : null;
}

export function geolocationErrorMessage(error: unknown): string {
  const kind = error instanceof GeolocationError ? error.kind : 'unavailable';

  switch (kind) {
    case 'denied':
      return 'No diste permiso para usar tu ubicación. Puedes escribir tu dirección o marcarla en el mapa.';
    case 'timeout':
      return 'Tu ubicación tardó demasiado. Intenta de nuevo o marca el punto en el mapa.';
    case 'insecure':
      return 'Tu ubicación solo está disponible en una conexión segura (https). Marca el punto en el mapa.';
    case 'unsupported':
      return 'Tu navegador no permite obtener la ubicación. Marca el punto en el mapa.';
    default:
      return 'No pudimos obtener tu ubicación. Revisa que el GPS esté activo o marca el punto en el mapa.';
  }
}
