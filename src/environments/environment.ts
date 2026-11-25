export const environment = {
  production: false,
  // Vacío: en desarrollo la app llama a /api en su mismo origen y el proxy
  // de ng serve (proxy.conf.mjs) lo reenvía a la API.
  apiUrl: '',
};
