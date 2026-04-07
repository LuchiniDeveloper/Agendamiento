import { InjectionToken, inject, isDevMode } from '@angular/core';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { environment } from '../../environments/environment';

function createBrowserClient(): SupabaseClient | null {
  if (typeof window === 'undefined') {
    return null;
  }
  if (
    !environment.supabaseUrl ||
    environment.supabaseUrl.includes('YOUR_SUPABASE') ||
    !environment.supabaseAnonKey ||
    environment.supabaseAnonKey.includes('YOUR_SUPABASE')
  ) {
    if (isDevMode()) {
      console.warn(
        'Supabase: configura supabaseUrl y supabaseAnonKey en src/environments/environment.development.ts',
      );
    }
    return null;
  }
  return createClient(environment.supabaseUrl, environment.supabaseAnonKey, {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      /** Lee tokens del hash/query tras confirmar correo o aceptar invitación. */
      detectSessionInUrl: true,
      /** Coherente con enlaces mágicos/invitación que redirigen con fragmento #access_token=… */
      flowType: 'implicit',
    },
  });
}

export const SUPABASE_CLIENT = new InjectionToken<SupabaseClient | null>('SUPABASE_CLIENT', {
  providedIn: 'root',
  factory: () => createBrowserClient(),
});

export function injectSupabase(): SupabaseClient | null {
  return inject(SUPABASE_CLIENT);
}
