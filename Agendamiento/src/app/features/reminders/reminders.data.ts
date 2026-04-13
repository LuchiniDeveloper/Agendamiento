import { inject, Injectable } from '@angular/core';
import { SUPABASE_CLIENT } from '../../core/supabase';

export interface ReminderRow {
  id: string;
  sent: boolean;
  appointment_id: string;
  appointment: {
    id: string;
    start_date_time: string;
    status_id?: number;
    status?: { name: string } | null;
    customer: { name: string; phone: string | null } | null;
    pet: { name: string } | null;
  } | null;
}

@Injectable({ providedIn: 'root' })
export class RemindersData {
  private readonly supabase = inject(SUPABASE_CLIENT);

  /**
   * Recordatorios pendientes cuya cita cae en el día local [dayStart, dayEnd)
   * y la cita no está cancelada.
   */
  async listPendingForAppointmentLocalDay(dayStart: Date, dayEnd: Date) {
    if (!this.supabase) throw new Error('Supabase no configurado');
    const { data: st } = await this.supabase
      .from('appointment_status')
      .select('id')
      .eq('name', 'Cancelada')
      .maybeSingle();
    const cancelId = (st?.id as number | undefined) ?? null;

    let aq = this.supabase
      .from('appointment')
      .select('id')
      .gte('start_date_time', dayStart.toISOString())
      .lt('start_date_time', dayEnd.toISOString());
    if (cancelId != null) {
      aq = aq.neq('status_id', cancelId);
    }
    const { data: apptRows, error: e1 } = await aq;
    if (e1) throw e1;
    const ids = (apptRows ?? []).map((x: { id: string }) => x.id);
    if (ids.length === 0) {
      return { data: [] as ReminderRow[], error: null };
    }

    return this.supabase
      .from('reminder')
      .select(
        `
        id,
        sent,
        appointment_id,
        appointment:appointment_id (
          id,
          start_date_time,
          status_id,
          status:status_id (name),
          customer:customer_id (name, phone),
          pet:pet_id (name)
        )
      `,
      )
      .eq('sent', false)
      .in('appointment_id', ids)
      .order('id', { ascending: false });
  }

  markSent(id: string) {
    if (!this.supabase) throw new Error('Supabase no configurado');
    return this.supabase
      .from('reminder')
      .update({ sent: true, sent_at: new Date().toISOString() })
      .eq('id', id);
  }
}
