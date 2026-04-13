import { inject, Injectable } from '@angular/core';
import { SUPABASE_CLIENT } from '../../core/supabase';

export interface ServiceRow {
  id: string;
  business_id: string;
  name: string;
  description: string | null;
  duration_minutes: number;
  price: number;
  active: boolean;
}

export interface ScheduleRow {
  id: string;
  user_id: string;
  service_id: string | null;
  day_of_week: number;
  /** 1 = primera franja, 2 = segunda (mismo día y servicio, p. ej. almuerzo). */
  window_order: number;
  start_time: string;
  end_time: string;
}

export interface StaffMini {
  id: string;
  name: string;
}

/** PostgREST puede devolver FK embebida como objeto o como array de un elemento. */
function roleNameFromRow(role: { name: string } | { name: string }[] | null | undefined): string | undefined {
  if (role == null) return undefined;
  const r = Array.isArray(role) ? role[0] : role;
  return typeof r?.name === 'string' ? r.name : undefined;
}

/** Solo veterinarios en franjas y citas (sin recepcionistas ni administradores). */
export function staffRowsForScheduling(
  rows: { id: string; name: string; role?: { name: string } | { name: string }[] | null }[] | null,
): StaffMini[] {
  return (rows ?? [])
    .filter((r) => {
      const role = roleNameFromRow(r.role);
      return role === 'Veterinario';
    })
    .map(({ id, name }) => ({ id, name }));
}

@Injectable({ providedIn: 'root' })
export class ServicesData {
  private readonly supabase = inject(SUPABASE_CLIENT);

  listServices() {
    if (!this.supabase) throw new Error('Supabase no configurado');
    return this.supabase.from('service').select('*').order('name');
  }

  insertService(row: { name: string; description?: string | null; duration_minutes: number; price: number; active?: boolean }) {
    if (!this.supabase) throw new Error('Supabase no configurado');
    return this.supabase.from('service').insert(row).select('id').single();
  }

  updateService(id: string, row: Partial<ServiceRow>) {
    if (!this.supabase) throw new Error('Supabase no configurado');
    return this.supabase.from('service').update(row).eq('id', id).select('id, active').single();
  }

  deleteService(id: string) {
    if (!this.supabase) throw new Error('Supabase no configurado');
    return this.supabase.from('service').delete().eq('id', id);
  }

  /**
   * Personal activo con rol (para filtrar en UI). En franjas/citas usar `staffRowsForScheduling`.
   */
  listStaff() {
    if (!this.supabase) throw new Error('Supabase no configurado');
    return this.supabase
      .from('staff')
      .select('id, name, role:role_id(name)')
      .eq('active', true)
      .order('name');
  }

  listSchedule(userId: string) {
    if (!this.supabase) throw new Error('Supabase no configurado');
    return this.supabase
      .from('schedule')
      .select('*')
      .eq('user_id', userId)
      .order('day_of_week')
      .order('window_order');
  }

  insertSchedule(row: Omit<ScheduleRow, 'id'>) {
    if (!this.supabase) throw new Error('Supabase no configurado');
    return this.supabase.from('schedule').insert(row).select('id').single();
  }

  insertSchedulesBatch(rows: Omit<ScheduleRow, 'id'>[]) {
    if (!this.supabase) throw new Error('Supabase no configurado');
    if (rows.length === 0) {
      return Promise.resolve({ data: [] as { id: string }[], error: null });
    }
    return this.supabase.from('schedule').insert(rows).select('id');
  }

  updateSchedule(
    id: string,
    row: Pick<ScheduleRow, 'day_of_week' | 'window_order' | 'start_time' | 'end_time' | 'service_id'>,
  ) {
    if (!this.supabase) throw new Error('Supabase no configurado');
    return this.supabase.from('schedule').update(row).eq('id', id).select('id').single();
  }

  deleteSchedule(id: string) {
    if (!this.supabase) throw new Error('Supabase no configurado');
    return this.supabase.from('schedule').delete().eq('id', id);
  }
}
