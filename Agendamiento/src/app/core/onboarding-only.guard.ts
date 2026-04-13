import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';
import { SUPABASE_CLIENT } from './supabase';
import { TenantContextService } from './tenant-context.service';

/** Si ya tiene clínica asignada, salir de onboarding. */
export const onboardingOnlyGuard: CanActivateFn = async () => {
  const tenant = inject(TenantContextService);
  const router = inject(Router);
  const supabase = inject(SUPABASE_CLIENT);
  const auth = inject(AuthService);
  await tenant.refreshProfile();
  if (tenant.profile()) {
    router.navigate(['/app/dashboard']);
    return false;
  }
  const client = supabase;
  const uid = auth.user()?.id;
  if (client && uid) {
    const { data: acc } = await client
      .from('customer_portal_account')
      .select('customer_id')
      .eq('auth_user_id', uid)
      .maybeSingle();
    if (acc?.customer_id) {
      const { data: cust } = await client
        .from('customer')
        .select('business_id')
        .eq('id', acc.customer_id)
        .maybeSingle();
      const bid = (cust as { business_id?: string } | null)?.business_id;
      if (bid) {
        await router.navigate(['/portal', bid]);
        return false;
      }
    }
  }
  return true;
};
