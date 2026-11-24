// Proxy del servidor de desarrollo (ng serve).
// La app llama a /api/... en su mismo origen y este proxy lo reenvía a la API.
// Así funciona igual desde el Mac (localhost) y desde un teléfono en la red (IP).
// En Docker, docker-compose define API_PROXY_TARGET=http://api:3000.
const target = process.env.API_PROXY_TARGET ?? 'http://localhost:3000';

export default {
  '/api': {
    target,
    changeOrigin: true,
    secure: false,
  },
};
