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
  const { data: userData, error } = await client.auth.getUser();
  if (error) {
    const transient =
      typeof error.message === 'string' &&
      /fetch|network|timeout|load failed|failed to fetch/i.test(error.message);
    if (transient) {
      return true;
    }
    await client.auth.signOut();
    router.navigate(['/auth/login']);
    return false;
  }
  if (!userData.user) {
    await client.auth.signOut();
    router.navigate(['/auth/login']);
    return false;
  }
  return true;
};
