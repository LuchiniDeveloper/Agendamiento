import { inject, Injectable } from '@angular/core';
import { RealtimeChannel } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../core/supabase';
import type { AppointmentNotificationRow } from '../../models/appointment-notifications';

export type NotificationListRow = AppointmentNotificationRow;

@Injectable({ providedIn: 'root' })
export class EmailNotificationsData {
  private readonly supabase = inject(SUPABASE_CLIENT);

  /** Historial de correos solo para una cita (trazabilidad por cita). */
  listForAppointment(appointmentId: string) {
    if (!this.supabase) throw new Error('Supabase no configurado');
    return this.supabase
      .from('appointment_notification')
      .select(
        `
        id,
        business_id,
        appointment_id,
        kind,
        channel,
        status,
        scheduled_for,
        recipient_email,
        attempt_count,
        last_error,
        sent_at,
        provider_message_id,
        payload_snapshot,
        created_at,
        updated_at
      `,
      )
      .eq('appointment_id', appointmentId)
      .order('created_at', { ascending: false });
  }

  subscribeAppointment(
    appointmentId: string,
    onEvent: () => void,
  ): { channel: RealtimeChannel | null; unsubscribe: () => void } {
    if (!this.supabase) {
      return { channel: null, unsubscribe: () => undefined };
    }
    const ch = this.supabase
      .channel(`appt-notif-appt-${appointmentId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'appointment_notification',
          filter: `appointment_id=eq.${appointmentId}`,
        },
        () => onEvent(),
      )
      .subscribe();
    return {
      channel: ch,
      unsubscribe: () => {
        void this.supabase?.removeChannel(ch);
      },
    };
  }
}
