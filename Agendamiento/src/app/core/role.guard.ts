import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { TenantContextService } from './tenant-context.service';

/**
 * `route.data['roles']`: array de nombres de rol (`Admin`, `Veterinario`, `Recepcionista`) permitidos.
 * Si el usuario no está en la lista, redirige a la agenda.
 */
export const roleGuard: CanActivateFn = (route) => {
  const tenant = inject(TenantContextService);
  const router = inject(Router);
  const allowed = route.data['roles'] as string[] | undefined;
  if (!allowed?.length) return true;
  const name = tenant.roleName();
  if (name && allowed.includes(name)) return true;
  return router.createUrlTree(['/app/appointments']);
};
