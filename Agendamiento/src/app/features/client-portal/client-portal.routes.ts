import { Routes } from '@angular/router';
import { clientPortalLoginGuard } from './client-portal-login.guard';
import { clientPortalSessionGuard } from './client-portal-session.guard';

export const CLIENT_PORTAL_ROUTES: Routes = [
  {
    path: 'guest-book',
    loadComponent: () =>
      import('../public-booking/public-booking-page/public-booking-page').then((m) => m.PublicBookingPage),
  },
  {
    path: 'login',
    canActivate: [clientPortalLoginGuard],
    loadComponent: () => import('./portal-login/portal-login').then((m) => m.PortalLogin),
  },
  {
    path: 'register',
    canActivate: [clientPortalLoginGuard],
    loadComponent: () => import('./portal-register/portal-register').then((m) => m.PortalRegister),
  },
  {
    path: 'activate',
    canActivate: [clientPortalLoginGuard],
    loadComponent: () => import('./portal-activate/portal-activate').then((m) => m.PortalActivate),
  },
  {
    path: '',
    canActivate: [clientPortalSessionGuard],
    loadComponent: () => import('./client-portal-layout/client-portal-layout').then((m) => m.ClientPortalLayout),
    children: [
      { path: '', loadComponent: () => import('./portal-dashboard/portal-dashboard').then((m) => m.PortalDashboard) },
      {
        path: 'perfil',
        loadComponent: () => import('./portal-profile/portal-profile').then((m) => m.PortalProfile),
      },
      {
        path: 'citas',
        loadComponent: () => import('./portal-appointments/portal-appointments').then((m) => m.PortalAppointments),
      },
      {
        path: 'nueva-cita',
        loadComponent: () => import('./portal-book/portal-book').then((m) => m.PortalBook),
      },
      {
        path: 'mascota/:petId/historial',
        loadComponent: () => import('./portal-pet-medical/portal-pet-medical').then((m) => m.PortalPetMedical),
      },
      {
        path: 'cita/:appointmentId/resumen',
        loadComponent: () =>
          import('./portal-appointment-summary/portal-appointment-summary').then((m) => m.PortalAppointmentSummary),
      },
    ],
  },
];
