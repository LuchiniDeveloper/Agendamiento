import { inject, Injectable } from '@angular/core';
import { SUPABASE_CLIENT } from '../../core/supabase';

export interface CustomerRow {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
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

@Injectable({ providedIn: 'root' })
export class CustomersData {
  private readonly supabase = inject(SUPABASE_CLIENT);

  searchByPhone(q: string) {
    if (!this.supabase) throw new Error('Supabase no configurado');
    const trimmed = q.trim();
    const digits = trimmed.replace(/\D/g, '');
    let query = this.supabase.from('customer').select('id, name, phone, email, notes').limit(30);
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
      .select('id, name, phone, email, notes, created_at')
      .order('created_at', { ascending: false })
      .limit(100);
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
