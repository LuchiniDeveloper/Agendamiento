import { DatePipe } from '@angular/common';
import { Component, inject, OnInit, signal } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { FormsModule } from '@angular/forms';
import { TenantContextService } from '../../../core/tenant-context.service';
import { buildWhatsAppLink } from '../../../shared/util/whatsapp';
import { RemindersData, type ReminderRow } from '../reminders.data';

@Component({
  selector: 'app-reminders-page',
  imports: [
    DatePipe,
    FormsModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    MatCheckboxModule,
  ],
  templateUrl: './reminders-page.html',
  styleUrl: './reminders-page.scss',
})
export class RemindersPage implements OnInit {
  private readonly data = inject(RemindersData);
  private readonly snack = inject(MatSnackBar);
  protected readonly tenant = inject(TenantContextService);

  protected readonly loading = signal(true);
  protected readonly rows = signal<ReminderRow[]>([]);
  /** IDs marcados manualmente como “ya envié” antes de persistir */
  protected readonly pendingMark = signal<Set<string>>(new Set());

  async ngOnInit() {
    await this.load();
  }

  async load() {
    this.loading.set(true);
    try {
      const { data, error } = await this.data.listPending();
      if (error) throw error;
      const list = (data ?? []) as unknown as ReminderRow[];
      list.sort((a, b) => {
        const ta = a.appointment?.start_date_time ?? '';
        const tb = b.appointment?.start_date_time ?? '';
        return ta.localeCompare(tb);
      });
      this.rows.set(list);
    } catch (e) {
      console.error(e);
      this.rows.set([]);
    } finally {
      this.loading.set(false);
    }
  }

  messageFor(r: ReminderRow) {
    const b = this.tenant.profile()?.business;
    const c = r.appointment?.customer?.name ?? 'Cliente';
    const p = r.appointment?.pet?.name ?? 'su mascota';
    const when = r.appointment?.start_date_time
      ? new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short' }).format(
          new Date(r.appointment.start_date_time),
        )
      : '';
    return `Hola ${c}, le recordamos la cita de ${p} el ${when} en ${b?.name ?? 'la clínica'}.${b?.address ? ' ' + b.address : ''}`;
  }

  waHref(r: ReminderRow) {
    const phone = r.appointment?.customer?.phone ?? null;
    return buildWhatsAppLink(phone, this.messageFor(r));
  }

  async markAsSent(r: ReminderRow) {
    try {
      const { error } = await this.data.markSent(r.id);
      if (error) throw error;
      this.snack.open('Marcado como enviado', 'OK', { duration: 2500 });
      await this.load();
    } catch (e) {
      this.snack.open(e instanceof Error ? e.message : 'Error', 'OK', { duration: 4000 });
    }
  }

  togglePending(id: string, checked: boolean) {
    const next = new Set(this.pendingMark());
    if (checked) next.add(id);
    else next.delete(id);
    this.pendingMark.set(next);
  }

  isPendingMark(id: string) {
    return this.pendingMark().has(id);
  }
}
