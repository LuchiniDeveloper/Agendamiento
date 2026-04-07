import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { TenantContextService } from './tenant-context.service';

/** Tras login: exige perfil staff; si no, manda a onboarding. */
export const tenantGuard: CanActivateFn = async () => {
  const tenant = inject(TenantContextService);
  const router = inject(Router);
  const p = await tenant.refreshProfile();
  if (!p) {
    router.navigate(['/onboarding']);
    return false;
  }
  return true;
};
