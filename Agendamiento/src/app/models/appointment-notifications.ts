/** Alineado con `public.appointment_notification` y enums en Supabase. */

export type NotificationKind =
  | 'CREATED'
  | 'CONFIRM_REMINDER'
  | 'COMPLETED_SUMMARY'
  | 'CANCELLED_ACK'
  | 'NOSHOW_RESCHEDULE';

export type NotificationStatus =
  | 'pending'
  | 'scheduled'
  | 'sending'
  | 'sent'
  | 'failed'
  | 'skipped';

export interface AppointmentNotificationRow {
  id: string;
  business_id: string;
  appointment_id: string;
  kind: NotificationKind;
  channel: 'email';
  status: NotificationStatus;
  scheduled_for: string | null;
  recipient_email: string | null;
  attempt_count: number;
  last_error: string | null;
  sent_at: string | null;
  provider_message_id: string | null;
  payload_snapshot: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

/** Fila SMTP sin contraseña (la UI no muestra el valor cargado). */
export interface BusinessSmtpSettingsSafe {
  business_id: string;
  host: string;
  port: number;
  use_tls: boolean;
  username: string;
  from_email: string;
  from_name: string | null;
  enabled: boolean;
  updated_at: string;
}
