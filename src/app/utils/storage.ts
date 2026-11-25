// localStorage puede fallar (p. ej. navegación privada); el pedido no debe depender de él.
export function readStorage(key: string): string {
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

export function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Sin persistencia: los datos siguen disponibles en memoria.
  }
}

export function clearStorage(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Sin persistencia: no hay nada guardado.
  }
}
