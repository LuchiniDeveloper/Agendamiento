import { inject, Injectable, signal } from '@angular/core';
import { SUPABASE_CLIENT } from '../../core/supabase';

/** Debe coincidir con el default del RPC `get_available_slots` (`p_tz`). */
export const AGENDA_DEFAULT_TZ = 'America/Bogota';

function hhmmToMinutes(hhmm: string): number {
  const [a, b] = hhmm.split(':').map((x) => parseInt(x, 10));
  return (a || 0) * 60 + (b || 0);
}

/** YYYY-MM-DD hoy en el calendario local (igual que el datepicker). */
export function todayYmdLocal(): string {
  const t = new Date();
  const y = t.getFullYear();
  const m = String(t.getMonth() + 1).padStart(2, '0');
  const d = String(t.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function minutesNowBrowserLocal(): number {
  const t = new Date();
  return t.getHours() * 60 + t.getMinutes();
}

/**
 * Si `onDate` es hoy (local), quita HH:mm ya pasados (por minuto).
 * Refuerzo además del RPC; coincide con la fecha que envía el formulario.
 */
function dropPastSlotsIfToday(slots: string[], onDate: string): string[] {
  if (onDate !== todayYmdLocal()) return slots.slice();
  const nowMin = minutesNowBrowserLocal();
  return slots.filter((t) => hhmmToMinutes(t) > nowMin);
}

@Injectable({ providedIn: 'root' })
export class AppointmentsData {
  private readonly supabase = inject(SUPABASE_CLIENT);
  private readonly cancelledStatusId = signal<number | null | undefined>(undefined);
  private readonly completedStatusId = signal<number | null | undefined>(undefined);

  statusMap() {
    if (!this.supabase) throw new Error('Supabase no configurado');
    return this.supabase.from('appointment_status').select('id, name');
  }

  listRange(startIso: string, endIso: string, vetUserId?: string | null) {
    if (!this.supabase) throw new Error('Supabase no configurado');
    let q = this.supabase
      .from('appointment')
      .select(
        `
        id,
        user_id,
        start_date_time,
        end_date_time,
        attention_started_at,
        notes,
        status_id,
        customer:customer_id (id, name, phone),
        pet:pet_id (id, name, species),
        service:service_id (id, name, duration_minutes, price),
        vet:user_id (id, name),
        status:status_id (id, name)
      `,
      )
      .gte('start_date_time', startIso)
      .lt('start_date_time', endIso);
    if (vetUserId) {
      q = q.eq('user_id', vetUserId);
    }
    return q.order('start_date_time');
  }

  /**
   * Citas en [dayStart, dayEnd) para cola de chat (excluye canceladas y completadas).
   * Incluye especie de mascota para icono en UI.
   */
  async listForChatQueueDay(dayStart: Date, dayEnd: Date) {
    if (!this.supabase) throw new Error('Supabase no configurado');
    const cancelId = await this.getCancelledStatusId();
    const completedId = await this.getCompletedStatusId();
    let q = this.supabase
      .from('appointment')
      .select(
        `
        id,
        start_date_time,
        customer:customer_id (id, name, phone),
        pet:pet_id (id, name, species),
        service:service_id (id, name),
        status:status_id (name)
      `,
      )
      .gte('start_date_time', dayStart.toISOString())
      .lt('start_date_time', dayEnd.toISOString());
    if (cancelId != null) {
      q = q.neq('status_id', cancelId);
    }
    if (completedId != null) {
      q = q.neq('status_id', completedId);
    }
    return q.order('start_date_time');
  }

  async listUpcomingForCustomerContact(startIso: string, endIso: string) {
    if (!this.supabase) throw new Error('Supabase no configurado');
    const cancelId = await this.getCancelledStatusId();
    let q = this.supabase
      .from('appointment')
      .select(
        `
        id,
        start_date_time,
        customer:customer_id (id, name, phone),
        pet:pet_id (name),
        service:service_id (name)
      `,
      )
      .gte('start_date_time', startIso)
      .lt('start_date_time', endIso);
    if (cancelId != null) {
      q = q.neq('status_id', cancelId);
    }
    return q.order('start_date_time');
  }

  private async getCancelledStatusId(): Promise<number | null> {
    if (!this.supabase) throw new Error('Supabase no configurado');
    const cached = this.cancelledStatusId();
    if (cached !== undefined) return cached;
    const { data } = await this.supabase
      .from('appointment_status')
      .select('id')
      .eq('name', 'Cancelada')
      .maybeSingle();
    const id = (data?.id as number | undefined) ?? null;
    this.cancelledStatusId.set(id);
    return id;
  }

  private async getCompletedStatusId(): Promise<number | null> {
    if (!this.supabase) throw new Error('Supabase no configurado');
    const cached = this.completedStatusId();
    if (cached !== undefined) return cached;
    const { data } = await this.supabase
      .from('appointment_status')
      .select('id')
      .eq('name', 'Completada')
      .maybeSingle();
    const id = (data?.id as number | undefined) ?? null;
    this.completedStatusId.set(id);
    return id;
  }

  async hasOverlap(userId: string, start: Date, end: Date, excludeAppointmentId?: string) {
    if (!this.supabase) throw new Error('Supabase no configurado');
    const cancelId = await this.getCancelledStatusId();
    let q = this.supabase
      .from('appointment')
      .select('id')
      .eq('user_id', userId)
      .lt('start_date_time', end.toISOString())
      .gt('end_date_time', start.toISOString());
    if (cancelId != null) {
      q = q.neq('status_id', cancelId);
    }
    if (excludeAppointmentId) {
      q = q.neq('id', excludeAppointmentId);
    }
    const { data, error } = await q.limit(1);
    if (error) throw error;
    return (data?.length ?? 0) > 0;
  }

  /**
   * `onDate` = YYYY-MM-DD (calendario local).
   * `dayOfWeek` 0–6 (dom–sáb): si no se envía, se calcula desde `onDate` con mediodía local (estable).
   */
  async getAvailableSlots(params: {
    userId: string;
    serviceId: string;
    onDate: string;
    tz?: string;
    dayOfWeek?: number;
    /** Al reprogramar, la cita actual no cuenta como ocupación. */
    excludeAppointmentId?: string | null;
  }): Promise<string[]> {
    if (!this.supabase) throw new Error('Supabase no configurado');
    const parts = params.onDate.split('-').map((x) => parseInt(x, 10));
    const y = parts[0]!;
    const mo = parts[1]!;
    const d = parts[2]!;
    const dow =
      params.dayOfWeek ??
      new Date(y, mo - 1, d, 12, 0, 0, 0).getDay();
    const tz = params.tz ?? AGENDA_DEFAULT_TZ;
    const { data, error } = await this.supabase.rpc('get_available_slots', {
      p_user_id: params.userId,
      p_service_id: params.serviceId,
      p_on_date: params.onDate,
      p_tz: tz,
      p_day_of_week: dow,
      p_exclude_appointment_id: params.excludeAppointmentId ?? null,
    });
    if (error) throw error;
    return dropPastSlotsIfToday((data as string[] | null) ?? [], params.onDate);
  }

  /**
   * Si `onDate` es hoy (calendario local), el hueco HH:mm debe ser estrictamente posterior al minuto actual.
   */
  isSlotTimeInFutureForOnDate(onDate: string, hhmm: string): boolean {
    if (onDate !== todayYmdLocal()) return true;
    return hhmmToMinutes(hhmm) > minutesNowBrowserLocal();
  }

  /**
   * Límites del calendario según todas las franjas `schedule` visibles (negocio).
   * Devuelve HH:MM:SS para FullCalendar o null si no hay filas.
   */
  async getScheduleSlotBounds(vetUserId?: string | null): Promise<{ minTime: string; maxTime: string } | null> {
    if (!this.supabase) throw new Error('Supabase no configurado');
    let q = this.supabase.from('schedule').select('start_time, end_time');
    if (vetUserId) {
      q = q.eq('user_id', vetUserId);
    }
    const { data, error } = await q;
    if (error) throw error;
    if (!data?.length) return null;
    const toSec = (t: string) => {
      const [h, m, s] = t.split(':').map((x) => parseInt(x, 10));
      return (h || 0) * 3600 + (m || 0) * 60 + (s || 0);
    };
    const fmt = (sec: number) => {
      const h = Math.floor(sec / 3600);
      const m = Math.floor((sec % 3600) / 60);
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
    };
    let minS = Number.POSITIVE_INFINITY;
    let maxS = 0;
    for (const row of data as { start_time: string; end_time: string }[]) {
      minS = Math.min(minS, toSec(row.start_time));
      maxS = Math.max(maxS, toSec(row.end_time));
    }
    if (!Number.isFinite(minS) || maxS <= 0) return null;
    return { minTime: fmt(minS), maxTime: fmt(maxS) };
  }

  deleteAppointment(id: string) {
    if (!this.supabase) throw new Error('Supabase no configurado');
    return this.supabase.from('appointment').delete().eq('id', id);
  }

  insert(row: {
    customer_id: string;
    pet_id: string;
    service_id: string;
    user_id: string;
    start_date_time: string;
    end_date_time: string;
    status_id: number;
    notes?: string | null;
  }) {
    if (!this.supabase) throw new Error('Supabase no configurado');
    return this.supabase.from('appointment').insert(row).select('id').single();
  }

  updateTimes(id: string, start: string, end: string) {
    if (!this.supabase) throw new Error('Supabase no configurado');
    return this.supabase.from('appointment').update({ start_date_time: start, end_date_time: end }).eq('id', id);
  }

  updateStatus(id: string, status_id: number) {
    if (!this.supabase) throw new Error('Supabase no configurado');
    return this.supabase.from('appointment').update({ status_id }).eq('id', id);
  }

  updateNotes(id: string, notes: string | null) {
    if (!this.supabase) throw new Error('Supabase no configurado');
    return this.supabase.from('appointment').update({ notes }).eq('id', id);
  }

  /** `null` limpia el inicio de atención (cronómetro). */
  updateAttentionStartedAt(id: string, attention_started_at: string | null) {
    if (!this.supabase) throw new Error('Supabase no configurado');
    return this.supabase.from('appointment').update({ attention_started_at }).eq('id', id);
  }

  listExtraCharges(appointmentId: string) {
    if (!this.supabase) throw new Error('Supabase no configurado');
    return this.supabase
      .from('appointment_extra_charge')
      .select('id, description, amount, created_at')
      .eq('appointment_id', appointmentId)
      .order('created_at');
  }

  insertExtraCharge(appointmentId: string, description: string, amount: number) {
    if (!this.supabase) throw new Error('Supabase no configurado');
    return this.supabase.from('appointment_extra_charge').insert({
      appointment_id: appointmentId,
      description: description.trim(),
      amount,
    });
  }

  deleteExtraCharge(id: string) {
    if (!this.supabase) throw new Error('Supabase no configurado');
    return this.supabase.from('appointment_extra_charge').delete().eq('id', id);
  }

  listPaymentsByAppointment(appointmentId: string) {
    if (!this.supabase) throw new Error('Supabase no configurado');
    return this.supabase
      .from('payment')
      .select('id, amount, payment_method, status, created_at, transfer_channel, transfer_proof_code')
      .eq('appointment_id', appointmentId)
      .order('created_at');
  }

  insertPayment(
    appointmentId: string,
    amount: number,
    payment_method: 'Cash' | 'Card' | 'Transfer',
    transfer?: { channel: string; proofCode?: string | null },
  ) {
    if (!this.supabase) throw new Error('Supabase no configurado');
    const row: {
      appointment_id: string;
      amount: number;
      payment_method: 'Cash' | 'Card' | 'Transfer';
      status: string;
      transfer_channel?: string | null;
      transfer_proof_code?: string | null;
    } = {
      appointment_id: appointmentId,
      amount,
      payment_method,
      status: 'Completed',
    };
    if (payment_method === 'Transfer') {
      row.transfer_channel = transfer?.channel?.trim() || null;
      const code = transfer?.proofCode?.trim();
      row.transfer_proof_code = code ? code : null;
    }
    return this.supabase.from('payment').insert(row);
  }
}
