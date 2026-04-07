import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { TenantContextService } from './tenant-context.service';

/** Si ya tiene clínica asignada, salir de onboarding. */
export const onboardingOnlyGuard: CanActivateFn = async () => {
  const tenant = inject(TenantContextService);
  const router = inject(Router);
  await tenant.refreshProfile();
  if (tenant.profile()) {
    router.navigate(['/app/dashboard']);
    return false;
  }
  return true;
};
