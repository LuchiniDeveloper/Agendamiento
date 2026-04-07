import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

export const authGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const client = auth.client;
  if (!client) {
    router.navigate(['/auth/login']);
    return false;
  }
  const {
    data: { session },
  } = await client.auth.getSession();
  if (!session) {
    router.navigate(['/auth/login']);
    return false;
  }
  return true;
};
