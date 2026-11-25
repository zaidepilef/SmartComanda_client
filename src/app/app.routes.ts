import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: 'q',
    loadComponent: () =>
      import('./views/qr-landing/qr-landing').then((m) => m.QrLandingView),
  },
  {
    path: 'q/:tenantId/:branchId',
    loadComponent: () =>
      import('./views/order-flow/order-flow').then((m) => m.OrderFlowView),
  },
  {
    path: 'q/:tenantId/:branchId/pedido/:number',
    loadComponent: () =>
      import('./views/order-tracking/order-tracking').then((m) => m.OrderTrackingView),
  },
  { path: '', pathMatch: 'full', redirectTo: 'q' },
  { path: '**', redirectTo: 'q' },
];