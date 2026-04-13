import { Routes } from '@angular/router';
import { authGuard } from './core/auth.guard';
import { tenantGuard } from './core/tenant.guard';
import { onboardingOnlyGuard } from './core/onboarding-only.guard';
import { adminGuard } from './core/admin.guard';
import { roleGuard } from './core/role.guard';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'auth/login' },
  {
    path: 'confirm',
    loadComponent: () =>
      import('./features/confirm-appointment/confirm-appointment-page/confirm-appointment-page').then(
        (m) => m.ConfirmAppointmentPage,
      ),
  },
  {
    path: 'portal/:businessId',
    loadChildren: () =>
      import('./features/client-portal/client-portal.routes').then((m) => m.CLIENT_PORTAL_ROUTES),
  },
  {
    path: 'auth/login',
    loadComponent: () => import('./features/auth/login/login').then((m) => m.Login),
  },
  {
    path: 'auth/register',
    loadComponent: () => import('./features/auth/register/register').then((m) => m.Register),
  },
  {
    path: 'onboarding',
    canActivate: [authGuard, onboardingOnlyGuard],
    loadComponent: () =>
      import('./features/onboarding/onboarding').then((m) => m.Onboarding),
  },
  {
    path: 'app',
    canActivate: [authGuard, tenantGuard],
    loadComponent: () => import('./layout/main-layout/main-layout').then((m) => m.MainLayout),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
      {
        path: 'dashboard',
        canActivate: [roleGuard],
        data: { roles: ['Admin', 'Veterinario'] },
        loadComponent: () =>
          import('./features/dashboard/dashboard').then((m) => m.Dashboard),
      },
      {
        path: 'appointments',
        loadComponent: () =>
          import('./features/appointments/appointments-page/appointments-page').then(
            (m) => m.AppointmentsPage,
          ),
      },
      {
        path: 'customers',
        loadComponent: () =>
          import('./features/customers/customers-list/customers-list').then((m) => m.CustomersList),
      },
      {
        path: 'customers/:id',
        loadComponent: () =>
          import('./features/customers/customer-detail/customer-detail').then((m) => m.CustomerDetail),
      },
      {
        path: 'services',
        canActivate: [roleGuard],
        data: { roles: ['Admin', 'Veterinario'] },
        loadComponent: () =>
          import('./features/services-schedule/services-page/services-page').then((m) => m.ServicesPage),
      },
      {
        path: 'reminders',
        canActivate: [roleGuard],
        data: { roles: ['Admin', 'Veterinario'] },
        loadComponent: () =>
          import('./features/reminders/reminders-page/reminders-page').then((m) => m.RemindersPage),
      },
      {
        path: 'smtp',
        canActivate: [adminGuard],
        loadComponent: () =>
          import('./features/smtp-settings/smtp-settings-page/smtp-settings-page').then(
            (m) => m.SmtpSettingsPage,
          ),
      },
      {
        path: 'reports',
        canActivate: [adminGuard],
        loadComponent: () =>
          import('./features/reports/reports-page/reports-page').then((m) => m.ReportsPage),
      },
      {
        path: 'staff',
        canActivate: [adminGuard],
        loadComponent: () =>
          import('./features/staff-admin/staff-page/staff-page').then((m) => m.StaffPage),
      },
    ],
  },
  { path: '**', redirectTo: 'auth/login' },
];
