import { inject } from '@angular/core';
import type { CanActivateFn } from '@angular/router';
import { Router } from '@angular/router';
import { SUPABASE_CLIENT } from '../../core/supabase';
import { snapshotBusinessId } from './client-portal-route.utils';

export const clientPortalSessionGuard: CanActivateFn = async (route) => {
  const router = inject(Router);
  const supabase = inject(SUPABASE_CLIENT);
  const bid = snapshotBusinessId(route);
  if (!bid || !supabase) {
    await router.navigate(['/']);
    return false;
  }
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    await router.navigate(['/portal', bid, 'login']);
    return false;
  }
  const { data: acc } = await supabase
    .from('customer_portal_account')
    .select('customer_id')
    .eq('auth_user_id', session.user.id)
    .maybeSingle();
  if (!acc?.customer_id) {
    await supabase.auth.signOut();
    await router.navigate(['/portal', bid, 'login']);
    return false;
  }
  const { data: cust } = await supabase
    .from('customer')
    .select('business_id')
    .eq('id', acc.customer_id)
    .maybeSingle();
  const rb = (cust as { business_id?: string } | null)?.business_id;
  if (!rb || rb !== bid) {
    await router.navigate(rb ? ['/portal', rb] : ['/']);
    return false;
  }
  return true;
};
