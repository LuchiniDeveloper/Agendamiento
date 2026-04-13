import { DatePipe } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ActivatedRoute } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDialog } from '@angular/material/dialog';
import { SUPABASE_CLIENT } from '../../../core/supabase';
import { snapshotBusinessId } from '../client-portal-route.utils';
import { petAvatarFromSpecies } from '../../customers/pet-avatar.util';
import type { PetRow } from '../../customers/customers.data';
import { PetFormDialog } from '../../customers/pet-form-dialog/pet-form-dialog';

type FkName = { name: string } | { name: string }[] | null;

type UpcomingRow = {
  id: string;
  start_date_time: string;
  booking_source: string;
  pet: { id: string; name: string } | { id: string; name: string }[] | null;
  service: { name: string } | { name: string }[] | null;
};

type CompletedSummaryRow = {
  id: string;
  start_date_time: string;
  pet: { name: string } | { name: string }[] | null;
  service: { name: string } | { name: string }[] | null;
};

export type PetHealthKind = 'saludable' | 'tratamiento' | 'control';

@Component({
  selector: 'app-portal-dashboard',
  imports: [
    DatePipe,
    RouterLink,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatFormFieldModule,
    MatSelectModule,
    MatSnackBarModule,
  ],
  templateUrl: './portal-dashboard.html',
  styleUrl: './portal-dashboard.scss',
})
export class PortalDashboard implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly supabase = inject(SUPABASE_CLIENT);
  private readonly snack = inject(MatSnackBar);
  private readonly dialog = inject(MatDialog);
  /** Set en init para recargas por mascota sin repetir lookup de estado. */
  private completedStatusId: number | null = null;

  protected readonly businessId = signal(snapshotBusinessId(this.route.snapshot) ?? '');
  protected readonly pets = signal<PetRow[]>([]);
  protected readonly selectedPetId = signal('');
  protected readonly loading = signal(true);
  protected readonly petInsightsLoading = signal(false);
  protected readonly totalAppointments = signal(0);
  protected readonly completedAppointments = signal(0);
  protected readonly upcoming = signal<UpcomingRow[]>([]);
  protected readonly completedForSummary = signal<CompletedSummaryRow[]>([]);
  protected readonly cancellingId = signal<string | null>(null);

  protected readonly clinicName = signal('');
  protected readonly clinicPhone = signal('');

  /** Última visita: prioridad cita completada; si no, nota clínica más reciente. */
  protected readonly lastVisitAt = signal<string | null>(null);
  protected readonly lastVisitReason = signal<string>('');
  protected readonly petHealth = signal<PetHealthKind>('saludable');

  protected readonly selectedPet = computed(() => {
    const id = this.selectedPetId();
    return this.pets().find((p) => p.id === id) ?? null;
  });

  protected readonly waLink = computed(() => {
    const raw = this.clinicPhone().trim();
    if (!raw) return '';
    const digits = raw.replace(/\D/g, '');
    if (!digits) return '';
    return `https://wa.me/${digits}`;
  });

  async ngOnInit() {
    if (!this.supabase) {
      this.loading.set(false);
      return;
    }

    const sb = this.supabase;

    const { data: statusRows, error: stErr } = await sb
      .from('appointment_status')
      .select('id,name')
      .in('name', ['Completada', 'Agendada', 'Confirmada']);
    if (stErr) console.error(stErr);
    const statusByName = new Map<string, number>(
      ((statusRows as { id: number; name: string }[] | null) ?? []).map((r) => [r.name, r.id]),
    );
    const completedId = statusByName.get('Completada');
    this.completedStatusId = completedId ?? null;
    const agendadaId = statusByName.get('Agendada');
    const confirmadaId = statusByName.get('Confirmada');

    const nowIso = new Date().toISOString();

    const [
      totalRes,
      completedRes,
      petsRes,
      profileRes,
      upcomingRes,
      completedListRes,
    ] = await Promise.all([
      sb.from('appointment').select('*', { count: 'exact', head: true }),
      completedId != null
        ? sb.from('appointment').select('*', { count: 'exact', head: true }).eq('status_id', completedId)
        : Promise.resolve({ count: 0, error: null }),
      sb
        .from('pet')
        .select('id, customer_id, name, species, breed, gender, birth_date, weight, color, notes')
        .order('name'),
      sb.rpc('get_portal_clinic_profile'),
      agendadaId != null && confirmadaId != null
        ? sb
            .from('appointment')
            .select(
              `
            id,
            start_date_time,
            booking_source,
            pet:pet_id (id, name),
            service:service_id (name)
          `,
            )
            .gte('start_date_time', nowIso)
            .in('status_id', [agendadaId, confirmadaId])
            .order('start_date_time', { ascending: true })
            .limit(25)
        : Promise.resolve({ data: [], error: null }),
      completedId != null
        ? sb
            .from('appointment')
            .select(
              `
            id,
            start_date_time,
            pet:pet_id (name),
            service:service_id (name)
          `,
            )
            .eq('status_id', completedId)
            .order('start_date_time', { ascending: false })
            .limit(5)
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (totalRes.error) console.error(totalRes.error);
    this.totalAppointments.set(totalRes.count ?? 0);
    if (completedRes.error) console.error(completedRes.error);
    this.completedAppointments.set(completedRes.count ?? 0);

    if (!petsRes.error && petsRes.data) {
      const list = this.normalizePets((petsRes.data as Record<string, unknown>[]) ?? []);
      this.pets.set(list);
      if (list.length) {
        this.selectedPetId.set(list[0]!.id);
      }
    }

    if (!profileRes.error && profileRes.data) {
      const j = profileRes.data as { name?: string; phone?: string | null };
      this.clinicName.set(String(j?.name ?? '').trim());
      this.clinicPhone.set(String(j?.phone ?? '').trim());
    }

    if (!upcomingRes.error && upcomingRes.data) {
      this.upcoming.set((upcomingRes.data as UpcomingRow[]) ?? []);
    } else {
      this.upcoming.set([]);
    }

    if (!completedListRes.error && completedListRes.data) {
      this.completedForSummary.set((completedListRes.data as CompletedSummaryRow[]) ?? []);
    } else {
      this.completedForSummary.set([]);
    }

    const pid = this.selectedPetId();
    if (pid && completedId != null) {
      await this.loadPetInsights(pid, completedId);
    }

    this.loading.set(false);
  }

  private coerceWeight(v: unknown): number | null {
    if (v == null || v === '') return null;
    const n = typeof v === 'number' ? v : parseFloat(String(v));
    return Number.isNaN(n) ? null : n;
  }

  private normalizePets(rows: Record<string, unknown>[]): PetRow[] {
    return rows.map((r) => ({
      id: String(r['id']),
      customer_id: String(r['customer_id']),
      name: String(r['name'] ?? ''),
      species: (r['species'] as string | null) ?? null,
      breed: (r['breed'] as string | null) ?? null,
      gender: (r['gender'] as string | null) ?? null,
      birth_date: (r['birth_date'] as string | null) ?? null,
      weight: this.coerceWeight(r['weight']),
      color: (r['color'] as string | null) ?? null,
      notes: (r['notes'] as string | null) ?? null,
    }));
  }

  /** Tras editar en el diálogo compartido con el staff. */
  protected openEditPet(): void {
    const pet = this.selectedPet();
    if (!pet) return;
    this.dialog
      .open(PetFormDialog, {
        width: 'min(520px, 100vw)',
        maxHeight: '90vh',
        autoFocus: 'first-tabbable',
        data: { customerId: pet.customer_id, pet },
      })
      .afterClosed()
      .subscribe(() => void this.reloadPetsAfterEdit());
  }

  private async reloadPetsAfterEdit(): Promise<void> {
    const sb = this.supabase;
    if (!sb) return;
    const { data, error } = await sb
      .from('pet')
      .select('id, customer_id, name, species, breed, gender, birth_date, weight, color, notes')
      .order('name');
    if (error) {
      console.error(error);
      this.snack.open('No se pudieron recargar las mascotas.', 'OK', { duration: 4000 });
      return;
    }
    const list = this.normalizePets((data as Record<string, unknown>[]) ?? []);
    this.pets.set(list);
    const cur = this.selectedPetId();
    if (cur && !list.some((p) => p.id === cur) && list.length) {
      this.selectedPetId.set(list[0]!.id);
    }
    const cid = this.completedStatusId;
    const pid = this.selectedPetId();
    if (pid && cid != null) {
      await this.loadPetInsights(pid, cid);
    }
  }

  protected petAvatar(species: string | null | undefined) {
    return petAvatarFromSpecies(species);
  }

  protected formatPetAge(birthDate: string | null | undefined): string {
    if (!birthDate) return '—';
    const d = new Date(birthDate + 'T12:00:00');
    if (Number.isNaN(d.getTime())) return '—';
    const now = new Date();
    let years = now.getFullYear() - d.getFullYear();
    let months = now.getMonth() - d.getMonth();
    if (months < 0) {
      years -= 1;
      months += 12;
    }
    if (now.getDate() < d.getDate()) {
      months -= 1;
      if (months < 0) {
        years -= 1;
        months += 12;
      }
    }
    if (years <= 0 && months <= 0) return 'Menos de 1 mes';
    if (years <= 0) return `${months} ${months === 1 ? 'mes' : 'meses'}`;
    if (months === 0) return `${years} ${years === 1 ? 'año' : 'años'}`;
    return `${years} a. ${months} m.`;
  }

  protected formatWeight(w: number | null | undefined): string {
    if (w == null) return '—';
    const n = typeof w === 'string' ? parseFloat(w) : w;
    if (Number.isNaN(n)) return '—';
    return `${n} kg`;
  }

  /**
   * Estado derivado de la última nota clínica (por created_at):
   * - En tratamiento: treatment no vacío en los últimos 90 días.
   * - Control pendiente: next_visit_date de esa misma nota ≤ hoy (calendario local).
   * - Saludable: resto.
   */
  private computeHealthFromLatestMed(
    med: {
      created_at: string;
      treatment: string | null;
      next_visit_date: string | null;
    } | null,
  ): PetHealthKind {
    if (!med) return 'saludable';
    const created = new Date(med.created_at);
    if (Number.isNaN(created.getTime())) return 'saludable';
    const days90 = 90 * 24 * 60 * 60 * 1000;
    const treatment = (med.treatment ?? '').trim();
    if (treatment && Date.now() - created.getTime() <= days90) {
      return 'tratamiento';
    }
    const nv = med.next_visit_date;
    if (nv) {
      const todayYmd = this.localYmd(new Date());
      if (nv <= todayYmd) return 'control';
    }
    return 'saludable';
  }

  private localYmd(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  protected async onPetChange(petId: string) {
    this.selectedPetId.set(petId);
    const cid = this.completedStatusId;
    if (cid == null) return;
    await this.loadPetInsights(petId, cid);
  }

  private async loadPetInsights(petId: string, completedStatusId: number) {
    const sb = this.supabase;
    if (!sb) return;
    this.petInsightsLoading.set(true);
    try {
      const [{ data: lastDone, error: e1 }, { data: latestMed, error: e2 }] = await Promise.all([
        sb
          .from('appointment')
          .select(
            `
          start_date_time,
          service:service_id (name),
          status:status_id (name)
        `,
          )
          .eq('pet_id', petId)
          .eq('status_id', completedStatusId)
          .order('start_date_time', { ascending: false })
          .limit(1)
          .maybeSingle(),
        sb
          .from('medical_record')
          .select('created_at, treatment, next_visit_date, diagnosis, observations')
          .eq('pet_id', petId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      if (e1) console.error(e1);
      if (e2) console.error(e2);

      const done = lastDone as
        | {
            start_date_time: string;
            service: FkName;
          }
        | null
        | undefined;

      if (done?.start_date_time) {
        this.lastVisitAt.set(done.start_date_time);
        this.lastVisitReason.set(this.relName(done.service) || 'Consulta');
      } else if (latestMed) {
        const m = latestMed as {
          created_at: string;
          diagnosis: string | null;
          observations: string | null;
        };
        this.lastVisitAt.set(m.created_at);
        const reason = (m.diagnosis ?? '').trim() || (m.observations ?? '').trim() || 'Registro clínico';
        this.lastVisitReason.set(reason.length > 120 ? reason.slice(0, 117) + '…' : reason);
      } else {
        this.lastVisitAt.set(null);
        this.lastVisitReason.set('Sin visitas registradas');
      }

      this.petHealth.set(
        this.computeHealthFromLatestMed(
          (latestMed as {
            created_at: string;
            treatment: string | null;
            next_visit_date: string | null;
          } | null) ?? null,
        ),
      );
    } finally {
      this.petInsightsLoading.set(false);
    }
  }

  protected relName(x: FkName): string {
    if (!x) return '';
    return Array.isArray(x) ? (x[0]?.name ?? '') : x.name;
  }

  protected petNameRow(r: UpcomingRow | CompletedSummaryRow): string {
    const p = r.pet;
    if (!p) return '';
    return Array.isArray(p) ? (p[0]?.name ?? '') : p.name;
  }

  protected bookingSourceLabel(src: string | null | undefined): string {
    switch (src) {
      case 'staff':
        return 'Agendada por la clínica';
      case 'portal':
        return 'Reserva portal';
      case 'public':
        return 'Reserva web';
      case 'public_guest':
        return 'Reserva invitado';
      default:
        return src ? String(src) : '—';
    }
  }

  protected healthLabel(kind: PetHealthKind): { icon: string; text: string; css: string } {
    switch (kind) {
      case 'tratamiento':
        return { icon: '⚠️', text: 'En tratamiento', css: 'pet-health--warn' };
      case 'control':
        return { icon: '🕒', text: 'Control pendiente', css: 'pet-health--pending' };
      default:
        return { icon: '✅', text: 'Saludable', css: 'pet-health--ok' };
    }
  }

  protected openWhatsApp() {
    const url = this.waLink();
    if (!url) {
      this.snack.open('La clínica no tiene teléfono cargado para WhatsApp.', 'OK', { duration: 4000 });
      return;
    }
    const pet = this.selectedPet();
    const msg = encodeURIComponent(
      `Hola${this.clinicName() ? `, escribo desde el portal de ${this.clinicName()}` : ''}.${pet ? ` Mascota: ${pet.name}.` : ''} `,
    );
    window.open(`${url}?text=${msg}`, '_blank', 'noopener,noreferrer');
  }

  protected async cancelAppointment(id: string) {
    const sb = this.supabase;
    if (!sb) return;
    this.cancellingId.set(id);
    try {
      const { data, error } = await sb.rpc('portal_cancel_appointment', { p_appointment_id: id });
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
      this.upcoming.update((rows) => rows.filter((r) => r.id !== id));
    } finally {
      this.cancellingId.set(null);
    }
  }
}
