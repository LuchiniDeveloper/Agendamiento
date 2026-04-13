import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';
import { SUPABASE_CLIENT } from './supabase';
import { TenantContextService } from './tenant-context.service';

/** Tras login: exige perfil staff; si no, manda a onboarding. */
export const tenantGuard: CanActivateFn = async () => {
  const tenant = inject(TenantContextService);
  const router = inject(Router);
  const supabase = inject(SUPABASE_CLIENT);
  const auth = inject(AuthService);
  const p = await tenant.refreshProfile();
  if (!p) {
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
    router.navigate(['/onboarding']);
    return false;
  }
  return true;
};
