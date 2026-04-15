import { DatePipe } from '@angular/common';
import { Component, inject, input, OnDestroy, OnInit, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { SUPABASE_CLIENT } from '../../../core/supabase';
import {
  EmailNotificationsData,
  type NotificationListRow,
} from '../email-notifications.data';

@Component({
  selector: 'app-appointment-email-notifications-panel',
  imports: [DatePipe, MatIconModule, MatTooltipModule, MatButtonModule, MatProgressSpinnerModule],
  templateUrl: './appointment-email-notifications-panel.html',
  styleUrl: './appointment-email-notifications-panel.scss',
})
export class AppointmentEmailNotificationsPanel implements OnInit, OnDestroy {
  private readonly data = inject(EmailNotificationsData);
  private readonly supabase = inject(SUPABASE_CLIENT);

  /** Id de la cita (`appointment.id`). */
  readonly appointmentId = input.required<string>();

  protected readonly rows = signal<NotificationListRow[]>([]);
  protected readonly loading = signal(true);
  protected readonly collapsed = signal(true);

  private unsub: (() => void) | null = null;

  ngOnInit() {
    void this.load();
    const id = this.appointmentId();
    if (id && this.supabase) {
      const { unsubscribe } = this.data.subscribeAppointment(id, () => void this.load());
      this.unsub = unsubscribe;
    }
  }

  ngOnDestroy() {
    this.unsub?.();
  }

  async load() {
    const id = this.appointmentId();
    if (!id || !this.supabase) {
      this.loading.set(false);
      return;
    }
    try {
      const { data, error } = await this.data.listForAppointment(id);
      if (error) throw error;
      this.rows.set((data ?? []) as NotificationListRow[]);
    } catch (e) {
      console.error(e);
      this.rows.set([]);
    } finally {
      this.loading.set(false);
    }
  }

  protected kindLabel(k: string): string {
    const m: Record<string, string> = {
      CREATED: 'Cita agendada',
      CONFIRM_REMINDER: 'Recordatorio 1 h',
      COMPLETED_SUMMARY: 'Consulta completada',
      CANCELLED_ACK: 'Cancelación',
      NOSHOW_RESCHEDULE: 'Reagendar',
    };
    return m[k] ?? k;
  }

  protected statusClass(s: string): string {
    if (s === 'sent') return 'ok';
    if (s === 'failed' || s === 'skipped') return 'bad';
    if (s === 'sending') return 'warn';
    return '';
  }

  protected toggleCollapsed() {
    this.collapsed.update((v) => !v);
  }
}
