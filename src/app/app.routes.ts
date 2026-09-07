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
  { path: '', pathMatch: 'full', redirectTo: 'q' },
  { path: '**', redirectTo: 'q' },
];