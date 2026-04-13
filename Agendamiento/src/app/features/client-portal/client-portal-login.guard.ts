import { inject } from '@angular/core';
import type { CanActivateFn } from '@angular/router';
import { Router } from '@angular/router';
import { SUPABASE_CLIENT } from '../../core/supabase';
import { snapshotBusinessId } from './client-portal-route.utils';

/** Si ya hay sesión de portal para esta clínica, ir al inicio del portal. */
export const clientPortalLoginGuard: CanActivateFn = async (route) => {
  const router = inject(Router);
  const supabase = inject(SUPABASE_CLIENT);
  const bid = snapshotBusinessId(route);
  if (!bid || !supabase) return true;
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return true;
  const { data: acc } = await supabase
    .from('customer_portal_account')
    .select('customer_id')
    .eq('auth_user_id', session.user.id)
    .maybeSingle();
  if (!acc?.customer_id) return true;
  const { data: cust } = await supabase
    .from('customer')
    .select('business_id')
    .eq('id', acc.customer_id)
    .maybeSingle();
  const rb = (cust as { business_id?: string } | null)?.business_id;
  if (rb === bid) {
    await router.navigate(['/portal', bid]);
    return false;
  }
  return true;
};
