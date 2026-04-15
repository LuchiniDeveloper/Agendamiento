import { DatePipe } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ActivatedRoute } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatTableModule } from '@angular/material/table';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { SUPABASE_CLIENT } from '../../../core/supabase';
import { snapshotBusinessId } from '../client-portal-route.utils';

type FkName = { name: string } | { name: string }[] | null;

type ApptRowRaw = {
  id: string;
  start_date_time: string;
  end_date_time: string;
  service_id: string;
  user_id: string;
  status: FkName;
  pet: { id: string; name: string } | { id: string; name: string }[] | null;
};

export type ApptDisplayRow = ApptRowRaw & {
  serviceLabel: string;
  vetLabel: string;
};

export type PortalApptTicket = {
  appointmentId: string;
  businessName: string;
  startDateTime: string;
  endDateTime: string;
  petName: string;
  serviceName: string;
  professionalName: string;
  statusLabel: string;
};

@Component({
  selector: 'app-portal-appointments',
  imports: [
    DatePipe,
    RouterLink,
    MatCardModule,
    MatTableModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    MatTooltipModule,
  ],
  templateUrl: './portal-appointments.html',
  styleUrl: './portal-appointments.scss',
})
export class PortalAppointments implements OnInit {
  private readonly supabase = inject(SUPABASE_CLIENT);
  private readonly route = inject(ActivatedRoute);
  private readonly snack = inject(MatSnackBar);

  protected readonly rows = signal<ApptDisplayRow[]>([]);
  protected readonly loading = signal(true);
  protected readonly businessId = signal(snapshotBusinessId(this.route.snapshot) ?? '');
  protected readonly displayedColumns = ['when', 'pet', 'service', 'vet', 'status', 'actions'];
  protected readonly ticket = signal<PortalApptTicket | null>(null);
  protected readonly clinicName = signal('');
  protected readonly cancellingId = signal<string | null>(null);

  async ngOnInit() {
    if (!this.supabase) {
      this.loading.set(false);
      return;
    }
    const sb = this.supabase;
    const bid = this.businessId();

    const [{ data: profile }, { data, error }] = await Promise.all([
      bid ? sb.rpc('get_portal_clinic_profile') : Promise.resolve({ data: null as unknown }),
      sb
        .from('appointment')
        .select(
          `
        id,
        start_date_time,
        end_date_time,
        service_id,
        user_id,
        pet:pet_id (id, name),
        status:status_id (name)
      `,
        )
        .order('start_date_time', { ascending: false })
        .limit(80),
    ]);

    if (profile && typeof profile === 'object' && 'name' in (profile as object)) {
      const n = String((profile as { name?: string }).name ?? '').trim();
      if (n) this.clinicName.set(n);
    }

    if (error) {
      console.error(error);
      this.rows.set([]);
    } else {
      const raw = (data as ApptRowRaw[]) ?? [];
      this.rows.set(await this.enrichRows(raw));
    }
    this.loading.set(false);
  }

  /** Nombres de servicio y veterinario vía tablas `service` y `staff` (políticas portal). */
  private async enrichRows(raw: ApptRowRaw[]): Promise<ApptDisplayRow[]> {
    const sb = this.supabase;
    if (!sb || raw.length === 0) return [];

    const uniq = (ids: string[]) => [...new Set(ids.filter(Boolean))];
    const svcIds = uniq(raw.map((r) => r.service_id));
    const vetIds = uniq(raw.map((r) => r.user_id));

    const [svcRes, vetRes] = await Promise.all([
      svcIds.length
        ? sb.from('service').select('id,name').in('id', svcIds)
        : Promise.resolve({ data: [] as { id: string; name: string }[] }),
      vetIds.length
        ? sb.from('staff').select('id,name').in('id', vetIds)
        : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    ]);

    const svcMap = new Map((svcRes.data as { id: string; name: string }[] | null)?.map((x) => [x.id, x.name]) ?? []);
    const vetMap = new Map((vetRes.data as { id: string; name: string }[] | null)?.map((x) => [x.id, x.name]) ?? []);

    return raw.map((r) => ({
      ...r,
      serviceLabel: svcMap.get(r.service_id)?.trim() || '—',
      vetLabel: vetMap.get(r.user_id)?.trim() || '—',
    }));
  }

  statusName(r: ApptDisplayRow): string {
    const s = r.status;
    if (!s) return '';
    return Array.isArray(s) ? (s[0]?.name ?? '') : s.name;
  }

  petName(r: ApptDisplayRow): string {
    const p = r.pet;
    if (!p) return '';
    return Array.isArray(p) ? (p[0]?.name ?? '') : p.name;
  }

  petId(r: ApptDisplayRow): string {
    const p = r.pet;
    if (!p) return '';
    return Array.isArray(p) ? (p[0]?.id ?? '') : p.id;
  }

  canCancel(r: ApptDisplayRow): boolean {
    const st = this.statusName(r);
    if (st !== 'Agendada' && st !== 'Confirmada') return false;
    return new Date(r.start_date_time).getTime() > Date.now();
  }

  canClinicalHistory(r: ApptDisplayRow): boolean {
    return this.statusName(r) === 'Completada' && !!this.petId(r);
  }

  canViewInvoice(r: ApptDisplayRow): boolean {
    return this.statusName(r) === 'Completada';
  }

  openTicket(r: ApptDisplayRow): void {
    this.ticket.set({
      appointmentId: r.id,
      businessName: this.clinicName() || 'Clínica',
      startDateTime: r.start_date_time,
      endDateTime: r.end_date_time,
      petName: this.petName(r),
      serviceName: r.serviceLabel,
      professionalName: r.vetLabel,
      statusLabel: this.statusName(r) || '—',
    });
  }

  dismissTicket(): void {
    this.ticket.set(null);
  }

  printTicket(): void {
    window.print();
  }

  async cancelAppointment(r: ApptDisplayRow): Promise<void> {
    const sb = this.supabase;
    if (!sb) return;
    this.cancellingId.set(r.id);
    try {
      const { data, error } = await sb.rpc('portal_cancel_appointment', { p_appointment_id: r.id });
      if (error) {
        console.error(error);
        this.snack.open('No se pudo cancelar la cita.', 'OK', { duration: 4000 });
        return;
      }
      const j = data as { ok?: boolean; error?: string };
      if (!j?.ok) {
        const msg =
          j?.error === 'PAST'
            ? 'No se puede cancelar una cita que ya comenzó o pasó.'
            : j?.error === 'STATUS'
              ? 'Esta cita no se puede cancelar desde el portal.'
              : 'No se pudo cancelar la cita.';
        this.snack.open(msg, 'OK', { duration: 5000 });
        return;
      }
      this.snack.open('Cita cancelada.', 'OK', { duration: 3000 });
      this.rows.update((list) =>
        list.map((row) =>
          row.id === r.id ? { ...row, status: { name: 'Cancelada' }, serviceLabel: row.serviceLabel, vetLabel: row.vetLabel } : row,
        ),
      );
    } finally {
      this.cancellingId.set(null);
    }
  }
}
