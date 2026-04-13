import { DatePipe } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatToolbarModule } from '@angular/material/toolbar';
import { SUPABASE_CLIENT } from '../../../core/supabase';
import { snapshotBusinessId } from '../client-portal-route.utils';

type Fk = { name: string } | { name: string }[] | null;

@Component({
  selector: 'app-portal-appointment-summary',
  imports: [
    DatePipe,
    RouterLink,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    MatToolbarModule,
  ],
  templateUrl: './portal-appointment-summary.html',
  styleUrl: './portal-appointment-summary.scss',
})
export class PortalAppointmentSummary implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly supabase = inject(SUPABASE_CLIENT);
  private readonly snack = inject(MatSnackBar);

  protected readonly businessId = signal(snapshotBusinessId(this.route.snapshot) ?? '');
  protected readonly loading = signal(true);

  protected readonly apptStart = signal<string | null>(null);
  protected readonly apptEnd = signal<string | null>(null);
  protected readonly petName = signal('');
  protected readonly serviceName = signal('');
  protected readonly statusName = signal('');

  protected readonly diagnosis = signal<string | null>(null);
  protected readonly treatment = signal<string | null>(null);
  protected readonly observations = signal<string | null>(null);
  protected readonly weight = signal<number | string | null>(null);
  protected readonly nextVisit = signal<string | null>(null);

  async ngOnInit() {
    const id = this.route.snapshot.paramMap.get('appointmentId');
    if (!this.supabase || !id) {
      this.loading.set(false);
      return;
    }
    const sb = this.supabase;
    const [{ data: appt, error: e1 }, { data: med, error: e2 }] = await Promise.all([
      sb
        .from('appointment')
        .select(
          `
        start_date_time,
        end_date_time,
        pet:pet_id (name),
        service:service_id (name),
        status:status_id (name)
      `,
        )
        .eq('id', id)
        .maybeSingle(),
      sb
        .from('medical_record')
        .select('diagnosis, treatment, observations, weight, next_visit_date')
        .eq('appointment_id', id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    if (e1) console.error(e1);
    if (e2) console.error(e2);
    if (!appt) {
      this.snack.open('Cita no encontrada o sin acceso.', 'OK', { duration: 4000 });
      this.loading.set(false);
      return;
    }
    const a = appt as {
      start_date_time: string;
      end_date_time: string;
      pet: Fk;
      service: Fk;
      status: Fk;
    };
    this.apptStart.set(a.start_date_time);
    this.apptEnd.set(a.end_date_time);
    this.petName.set(this.relName(a.pet) || 'Mascota');
    this.serviceName.set(this.relName(a.service) || '—');
    this.statusName.set(this.relName(a.status) || '—');

    if (med) {
      const m = med as {
        diagnosis: string | null;
        treatment: string | null;
        observations: string | null;
        weight: number | null;
        next_visit_date: string | null;
      };
      const nz = (s: string | null | undefined) => {
        const t = (s ?? '').trim();
        return t ? t : null;
      };
      this.diagnosis.set(nz(m.diagnosis));
      this.treatment.set(nz(m.treatment));
      this.observations.set(nz(m.observations));
      this.weight.set(m.weight);
      this.nextVisit.set(m.next_visit_date ? String(m.next_visit_date).trim() || null : null);
    }
    this.loading.set(false);
  }

  private relName(x: Fk): string {
    if (!x) return '';
    return Array.isArray(x) ? (x[0]?.name ?? '') : x.name;
  }

  protected printPage(): void {
    window.print();
  }
}
