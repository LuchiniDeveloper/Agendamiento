import { DatePipe } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { SUPABASE_CLIENT } from '../../../core/supabase';
import { snapshotBusinessId } from '../client-portal-route.utils';

type MedRow = {
  id: string;
  appointment_id: string | null;
  created_at: string;
  diagnosis: string | null;
  treatment: string | null;
  observations: string | null;
  weight: number | null;
};

type FkName = { name: string } | { name: string }[] | null;

/** Citas completadas de esta mascota → misma ruta imprimible que el dashboard. */
type CompletedApptForDownload = {
  id: string;
  start_date_time: string;
  service: FkName;
};

@Component({
  selector: 'app-portal-pet-medical',
  imports: [
    DatePipe,
    RouterLink,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
  ],
  templateUrl: './portal-pet-medical.html',
  styleUrl: './portal-pet-medical.scss',
})
export class PortalPetMedical implements OnInit {
  private readonly supabase = inject(SUPABASE_CLIENT);
  private readonly route = inject(ActivatedRoute);
  private readonly snack = inject(MatSnackBar);

  protected readonly petName = signal('');
  protected readonly rows = signal<MedRow[]>([]);
  protected readonly completedForDownload = signal<CompletedApptForDownload[]>([]);
  protected readonly loading = signal(true);
  protected readonly businessId = signal(snapshotBusinessId(this.route.snapshot) ?? '');
  protected readonly selectedAppointmentId = signal(this.route.snapshot.queryParamMap.get('appointmentId') ?? '');

  async ngOnInit() {
    const petId = this.route.snapshot.paramMap.get('petId');
    if (!this.supabase || !petId) {
      this.loading.set(false);
      return;
    }
    const sb = this.supabase;
    const selectedApptId = this.selectedAppointmentId();

    const { data: pet, error: pe } = await sb.from('pet').select('name').eq('id', petId).maybeSingle();
    if (pe || !pet) {
      this.snack.open('Mascota no encontrada.', 'OK', { duration: 4000 });
      this.loading.set(false);
      return;
    }
    this.petName.set(String((pet as { name?: string }).name ?? 'Mascota'));

    const { data: stRow } = await sb.from('appointment_status').select('id').eq('name', 'Completada').maybeSingle();
    const completedId = (stRow as { id: number } | null)?.id;

    let medQ = sb
      .from('medical_record')
      .select('id, appointment_id, created_at, diagnosis, treatment, observations, weight')
      .eq('pet_id', petId)
      .order('created_at', { ascending: false });
    if (selectedApptId) medQ = medQ.eq('appointment_id', selectedApptId);

    let apptQ =
      completedId != null
        ? sb
            .from('appointment')
            .select(
              `
          id,
          start_date_time,
          service:service_id (name)
        `,
            )
            .eq('pet_id', petId)
            .eq('status_id', completedId)
            .order('start_date_time', { ascending: false })
            .limit(20)
        : null;
    if (apptQ && selectedApptId) apptQ = apptQ.eq('id', selectedApptId);

    const [medRes, apptRes] = await Promise.all([medQ, apptQ ?? Promise.resolve({ data: [], error: null })]);

    if (medRes.error) {
      this.snack.open('No se pudo cargar el historial.', 'OK', { duration: 4000 });
      this.rows.set([]);
    } else {
      this.rows.set((medRes.data as MedRow[]) ?? []);
    }

    if (!apptRes.error && apptRes.data) {
      this.completedForDownload.set((apptRes.data as CompletedApptForDownload[]) ?? []);
    } else {
      this.completedForDownload.set([]);
    }

    this.loading.set(false);
  }

  protected serviceName(c: CompletedApptForDownload): string {
    const s = c.service;
    if (!s) return '';
    return Array.isArray(s) ? (s[0]?.name ?? '') : s.name;
  }
}
