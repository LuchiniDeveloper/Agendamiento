import { inject, Injectable } from '@angular/core';
import { SUPABASE_CLIENT } from '../../core/supabase';

export interface ReminderRow {
  id: string;
  sent: boolean;
  appointment_id: string;
  appointment: {
    id: string;
    start_date_time: string;
    customer: { name: string; phone: string | null } | null;
    pet: { name: string } | null;
  } | null;
}

@Injectable({ providedIn: 'root' })
export class RemindersData {
  private readonly supabase = inject(SUPABASE_CLIENT);

  listPending() {
    if (!this.supabase) throw new Error('Supabase no configurado');
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
          customer:customer_id (name, phone),
          pet:pet_id (name)
        )
      `,
      )
      .eq('sent', false)
      .order('id', { ascending: false })
      .limit(100);
  }

  markSent(id: string) {
    if (!this.supabase) throw new Error('Supabase no configurado');
    return this.supabase
      .from('reminder')
      .update({ sent: true, sent_at: new Date().toISOString() })
      .eq('id', id);
  }
}
