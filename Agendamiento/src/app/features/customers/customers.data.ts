import { inject, Injectable } from '@angular/core';
import { SUPABASE_CLIENT } from '../../core/supabase';

/** Fila embebida desde `customer_portal_account` (existe = cliente registrado en el portal). */
export type CustomerPortalAccountEmbed = { customer_id: string } | null;

export interface CustomerRow {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  id_document?: string | null;
  /** Presente solo cuando el select incluye la relación; no persistir en updates. */
  customer_portal_account?: CustomerPortalAccountEmbed | CustomerPortalAccountEmbed[];
}

export interface PetRow {
  id: string;
  customer_id: string;
  name: string;
  species: string | null;
  breed: string | null;
  gender: string | null;
  birth_date: string | null;
  weight: number | null;
  color: string | null;
  notes: string | null;
}

/** True si el cliente tiene fila en `customer_portal_account` (registrado en el portal). */
export function customerHasPortalAccount(row: CustomerRow): boolean {
  const p = row.customer_portal_account;
  if (p == null) return false;
  if (Array.isArray(p)) {
    const first = p[0] as { customer_id?: string } | undefined;
    return !!first?.customer_id;
  }
  if (typeof p !== 'object') return false;
  return !!(p as { customer_id?: string }).customer_id;
}

/** Texto tipo «2 perros, 1 gato» para la tabla de clientes. */

export function formatPetSpeciesSummary(counts: Map<string, number>): string {
  if (counts.size === 0) return 'Sin mascotas';
  const priority = ['Perro', 'Gato'];
  const parts: string[] = [];
  for (const key of priority) {
    const n = counts.get(key);
    if (!n) continue;
    if (key === 'Perro') parts.push(n === 1 ? '1 perro' : `${n} perros`);
    else if (key === 'Gato') parts.push(n === 1 ? '1 gato' : `${n} gatos`);
  }
  const rest = [...counts.entries()]
    .filter(([k]) => !priority.includes(k))
    .sort(([a], [b]) => a.localeCompare(b, 'es'));
  for (const [species, n] of rest) {
    const label = species.trim() || 'Sin especificar';
    if (n === 1) parts.push(`1 ${label.toLowerCase()}`);
    else parts.push(`${n} ${label.toLowerCase()}`);
  }
  return parts.join(', ');
}

@Injectable({ providedIn: 'root' })
export class CustomersData {
  private readonly supabase = inject(SUPABASE_CLIENT);

  private static readonly customerSelectBase =
    'id, name, phone, email, address, notes, id_document';

  /**
   * Marca `customer_portal_account` por consulta directa (más fiable que el embed en PostgREST + RLS).
   * Requiere política `portal_account_staff_select` y grant SELECT para `authenticated`.
   */
  async mergePortalAccountFlags<T extends CustomerRow>(rows: T[]): Promise<T[]> {
    if (!this.supabase || rows.length === 0) return rows;
    const ids = [...new Set(rows.map((r) => r.id))];
    const withPortal = new Set<string>();
    const chunk = 80;
    for (let i = 0; i < ids.length; i += chunk) {
      const slice = ids.slice(i, i + chunk);
      const { data, error } = await this.supabase
        .from('customer_portal_account')
        .select('customer_id')
        .in('customer_id', slice);
      if (error) {
        console.error('mergePortalAccountFlags', error);
        continue;
      }
      for (const row of (data ?? []) as { customer_id: string }[]) {
        withPortal.add(row.customer_id);
      }
    }
    return rows.map((r) => ({
      ...r,
      customer_portal_account: withPortal.has(r.id) ? { customer_id: r.id } : null,
    })) as T[];
  }

  searchByPhone(q: string) {
    if (!this.supabase) throw new Error('Supabase no configurado');
    const trimmed = q.trim();
    const digits = trimmed.replace(/\D/g, '');
    let query = this.supabase
      .from('customer')
      .select(CustomersData.customerSelectBase)
      .limit(30);
    if (digits.length >= 3) {
      query = query.ilike('phone', `%${digits}%`);
    } else if (trimmed.length > 0) {
      query = query.ilike('name', `%${trimmed.replace(/%/g, '')}%`);
    }
    return query;
  }

  list() {
    if (!this.supabase) throw new Error('Supabase no configurado');
    return this.supabase
      .from('customer')
      .select(`${CustomersData.customerSelectBase}, created_at`)
      .order('created_at', { ascending: false })
      .limit(100);
  }

  /** Resumen de mascotas por cliente (conteo por especie almacenada en `pet.species`). */
  async petSummariesForCustomers(customerIds: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (!this.supabase || customerIds.length === 0) return out;
    for (const id of customerIds) out.set(id, 'Sin mascotas');
    const { data, error } = await this.supabase
      .from('pet')
      .select('customer_id, species')
      .in('customer_id', customerIds);
    if (error || !data) return out;
    const byCustomer = new Map<string, Map<string, number>>();
    for (const row of data as { customer_id: string; species: string | null }[]) {
      const cid = row.customer_id;
      const sp = (row.species ?? '').trim() || 'Sin especificar';
      let m = byCustomer.get(cid);
      if (!m) {
        m = new Map();
        byCustomer.set(cid, m);
      }
      m.set(sp, (m.get(sp) ?? 0) + 1);
    }
    for (const id of customerIds) {
      const m = byCustomer.get(id);
      out.set(id, m ? formatPetSpeciesSummary(m) : 'Sin mascotas');
    }
    return out;
  }

  get(id: string) {
    if (!this.supabase) throw new Error('Supabase no configurado');
    return this.supabase.from('customer').select('*').eq('id', id).maybeSingle();
  }

  insert(row: Omit<CustomerRow, 'id'>) {
    if (!this.supabase) throw new Error('Supabase no configurado');
    return this.supabase.from('customer').insert(row).select('id').single();
  }

  update(id: string, row: Partial<CustomerRow>) {
    if (!this.supabase) throw new Error('Supabase no configurado');
    return this.supabase.from('customer').update(row).eq('id', id);
  }

  petsForCustomer(customerId: string) {
    if (!this.supabase) throw new Error('Supabase no configurado');
    return this.supabase.from('pet').select('*').eq('customer_id', customerId).order('name');
  }

  /** Pet IDs that have at least one medical_record (same business via RLS). */
  async petIdsWithMedicalHistory(petIds: string[]): Promise<Set<string>> {
    if (!this.supabase) throw new Error('Supabase no configurado');
    if (petIds.length === 0) return new Set();
    const { data, error } = await this.supabase.from('medical_record').select('pet_id').in('pet_id', petIds);
    if (error) throw error;
    return new Set((data ?? []).map((r: { pet_id: string }) => r.pet_id));
  }

  insertPet(row: Omit<PetRow, 'id'>) {
    if (!this.supabase) throw new Error('Supabase no configurado');
    return this.supabase.from('pet').insert(row).select('id').single();
  }

  updatePet(id: string, row: Partial<PetRow>) {
    if (!this.supabase) throw new Error('Supabase no configurado');
    return this.supabase.from('pet').update(row).eq('id', id);
  }

  deletePet(id: string) {
    if (!this.supabase) throw new Error('Supabase no configurado');
    return this.supabase.from('pet').delete().eq('id', id);
  }
}
