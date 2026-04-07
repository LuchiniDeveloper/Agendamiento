import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { TenantContextService } from './tenant-context.service';

export const adminGuard: CanActivateFn = () => {
  const tenant = inject(TenantContextService);
  const router = inject(Router);
  if (!tenant.isAdmin()) {
    router.navigate(['/app/dashboard']);
    return false;
  }
  return true;
};
