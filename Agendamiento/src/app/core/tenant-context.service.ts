import { Injectable, computed, inject, signal } from '@angular/core';
import { AuthService } from './auth.service';
import { SUPABASE_CLIENT } from './supabase';

export interface StaffProfile {
  id: string;
  business_id: string;
  role_id: number;
  name: string;
  phone: string | null;
  email?: string | null;
  role?: { name: string };
  business?: {
    id: string;
    name: string;
    phone: string | null;
    address: string | null;
  };
}

/** PostgREST a veces devuelve FK embebidas como array de un elemento. */
function single<T>(v: T | T[] | null | undefined): T | undefined {
  if (v == null) return undefined;
  return Array.isArray(v) ? v[0] : v;
}

/** Nombre del negocio para UI (evita `undefined` si `business` vino mal embebido). */
export function businessDisplayNameFromProfile(profile: StaffProfile | null | undefined): string {
  const b = single(
    profile?.business as StaffProfile['business'] | StaffProfile['business'][] | undefined,
  );
  const n = typeof b?.name === 'string' ? b.name.trim() : '';
  return n || 'Clínica';
}

@Injectable({ providedIn: 'root' })
export class TenantContextService {
  private readonly supabase = inject(SUPABASE_CLIENT);
  private readonly auth = inject(AuthService);

  private readonly profileSignal = signal<StaffProfile | null>(null);
  readonly profile = this.profileSignal.asReadonly();
  readonly businessId = computed(() => this.profileSignal()?.business_id ?? null);
  readonly roleName = computed(() => this.profileSignal()?.role?.name ?? null);
  readonly isAdmin = computed(() => this.roleName() === 'Admin');
  readonly canEditMedical = computed(() =>
    ['Admin', 'Veterinario'].includes(this.roleName() ?? ''),
  );

  async refreshProfile(): Promise<StaffProfile | null> {
    const client = this.supabase;
    const uid = this.auth.user()?.id;
    if (!client || !uid) {
      this.profileSignal.set(null);
      return null;
    }
    const { data, error } = await client
      .from('staff')
      .select(
        `
        id,
        business_id,
        role_id,
        name,
        phone,
        role:role_id (name),
        business:business_id (id, name, phone, address)
      `,
      )
      .eq('id', uid)
      .eq('active', true)
      .maybeSingle();

    if (error) {
      console.error(error);
      this.profileSignal.set(null);
      return null;
    }
    if (!data) {
      this.profileSignal.set(null);
      return null;
    }
    const raw = data as Record<string, unknown>;
    const profile = {
      ...raw,
      role: single(raw['role'] as StaffProfile['role'] | StaffProfile['role'][] | undefined),
      business: single(
        raw['business'] as StaffProfile['business'] | StaffProfile['business'][] | undefined,
      ),
    } as StaffProfile;
    this.profileSignal.set(profile);
    return profile;
  }

  clear() {
    this.profileSignal.set(null);
  }
}
