import { DatePipe } from '@angular/common';
import { Component, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatSelectModule } from '@angular/material/select';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatIconModule } from '@angular/material/icon';
import { debounceTime, merge } from 'rxjs';
import { SUPABASE_CLIENT } from '../../../core/supabase';
import { AGENDA_DEFAULT_TZ } from '../../appointments/appointments.data';
import { snapshotBusinessId } from '../client-portal-route.utils';

export type PortalBookingTicket = {
  appointmentId: string;
  businessName: string;
  startDateTime: string;
  endDateTime: string;
  petName: string;
  serviceName: string;
  professionalName: string;
  statusLabel: string;
};

type FkName = { name: string } | { name: string }[] | null;

function relName(x: FkName): string {
  if (!x) return '';
  return Array.isArray(x) ? (x[0]?.name ?? '') : x.name;
}

@Component({
  selector: 'app-portal-book',
  imports: [
    DatePipe,
    ReactiveFormsModule,
    RouterLink,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatSelectModule,
    MatDatepickerModule,
    MatNativeDateModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    MatIconModule,
  ],
  templateUrl: './portal-book.html',
  styleUrl: './portal-book.scss',
})
export class PortalBook implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly fb = inject(FormBuilder);
  private readonly supabase = inject(SUPABASE_CLIENT);
  private readonly snack = inject(MatSnackBar);

  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly businessName = signal('');
  protected readonly pets = signal<{ id: string; name: string }[]>([]);
  protected readonly services = signal<{ id: string; name: string; duration_minutes: number }[]>([]);
  protected readonly vets = signal<{ id: string; name: string }[]>([]);
  protected readonly slots = signal<string[]>([]);
  protected readonly slotsLoading = signal(false);
  /** Para enlaces `routerLink` al resto del portal. */
  protected readonly businessId = signal('');
  /** Comprobante tras confirmar la reserva. */
  protected readonly ticket = signal<PortalBookingTicket | null>(null);

  private portalBusinessId = '';

  readonly form = this.fb.nonNullable.group({
    pet_id: ['', Validators.required],
    service_id: ['', Validators.required],
    user_id: ['', Validators.required],
    date: [new Date(), Validators.required],
    start_time: ['', Validators.required],
  });

  constructor() {
    merge(
      this.form.controls.service_id.valueChanges,
      this.form.controls.user_id.valueChanges,
      this.form.controls.date.valueChanges,
    )
      .pipe(debounceTime(250), takeUntilDestroyed())
      .subscribe(() => void this.refreshSlots());
  }

  async ngOnInit() {
    const bid = snapshotBusinessId(this.route.snapshot);
    if (!bid || !this.supabase) {
      this.loading.set(false);
      return;
    }
    this.portalBusinessId = bid;
    this.businessId.set(bid);
    try {
      const { data: bjson, error: e1 } = await this.supabase.rpc('get_public_booking_business', {
        p_business_id: bid,
      });
      if (e1) throw e1;
      if (!bjson) {
        this.snack.open('Reserva no disponible para esta clínica.', 'OK', { duration: 4000 });
        this.loading.set(false);
        return;
      }
      const b = bjson as { name?: string };
      this.businessName.set(String(b?.name ?? 'Clínica'));

      const { data: pets, error: pe } = await this.supabase.from('pet').select('id, name').order('name');
      if (pe) throw pe;
      const pList = (pets as { id: string; name: string }[] | null) ?? [];
      this.pets.set(pList);

      const wantedPet = this.route.snapshot.queryParamMap.get('petId');
      const defaultPet =
        wantedPet && pList.some((p) => p.id === wantedPet) ? wantedPet : pList.length ? pList[0]!.id : '';

      const [{ data: sv }, { data: st }] = await Promise.all([
        this.supabase.rpc('list_booking_services', { p_business_id: bid }),
        this.supabase.rpc('list_booking_staff', { p_business_id: bid }),
      ]);
      const sList = (sv as { id: string; name: string; duration_minutes: number }[] | null) ?? [];
      const vList = (st as { id: string; name: string }[] | null) ?? [];
      this.services.set(sList);
      this.vets.set(vList);
      if (defaultPet) {
        this.form.patchValue({ pet_id: defaultPet });
      }
      if (sList.length && vList.length) {
        this.form.patchValue({
          service_id: sList[0]!.id,
          user_id: vList[0]!.id,
        });
      }
      await this.refreshSlots();
    } catch (e) {
      console.error(e);
      this.snack.open('No se pudo cargar la agenda.', 'OK', { duration: 4000 });
    } finally {
      this.loading.set(false);
    }
  }

  private localYmd(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  protected async refreshSlots() {
    if (!this.supabase) return;
    const v = this.form.getRawValue();
    const svcId = v.service_id;
    const uid = v.user_id;
    const d = v.date;
    if (!svcId || !uid || !d) {
      this.slots.set([]);
      return;
    }
    const onDate = this.localYmd(d instanceof Date ? d : new Date(d));
    this.slotsLoading.set(true);
    try {
      const { data, error } = await this.supabase.rpc('get_available_slots_public', {
        p_business_id: this.portalBusinessId,
        p_user_id: uid,
        p_service_id: svcId,
        p_on_date: onDate,
        p_tz: AGENDA_DEFAULT_TZ,
        p_day_of_week: null,
        p_exclude_appointment_id: null,
      });
      if (error) throw error;
      const arr = (data as string[] | null) ?? [];
      this.slots.set(arr);
      const cur = this.form.controls.start_time.value;
      if (arr.length) {
        if (!cur || !arr.includes(cur)) {
          this.form.patchValue({ start_time: arr[0]! });
        }
      } else {
        this.form.patchValue({ start_time: '' });
      }
    } catch (e) {
      console.error(e);
      this.slots.set([]);
    } finally {
      this.slotsLoading.set(false);
    }
  }

  protected dismissTicket(): void {
    this.ticket.set(null);
  }

  protected printTicket(): void {
    window.print();
  }

  async submit() {
    if (this.form.invalid || !this.supabase) return;
    const v = this.form.getRawValue();
    this.saving.set(true);
    try {
      const onDate = this.localYmd(v.date instanceof Date ? v.date : new Date(v.date));
      const { data, error } = await this.supabase.rpc('create_portal_booking_appointment', {
        p_business_id: this.portalBusinessId,
        p_pet_id: v.pet_id,
        p_service_id: v.service_id,
        p_user_id: v.user_id,
        p_on_date: onDate,
        p_start_hhmm: v.start_time,
        p_tz: AGENDA_DEFAULT_TZ,
      });
      if (error) throw error;
      const j = data as { ok?: boolean; error?: string; appointment_id?: string };
      if (!j?.ok) {
        const err = j?.error ?? 'ERROR';
        const map: Record<string, string> = {
          BOOKING_DISABLED: 'La reserva en línea no está habilitada.',
          SLOT_TAKEN: 'Ese horario ya no está disponible.',
          PAST: 'Elegí un horario futuro.',
          PET: 'Mascota no válida.',
          BUSINESS_MISMATCH: 'Sesión no coincide con esta clínica.',
          NOT_PORTAL: 'Iniciá sesión en el portal.',
        };
        this.snack.open(map[err] ?? 'No se pudo reservar.', 'OK', { duration: 4500 });
        return;
      }

      const aid = j.appointment_id;
      const vetName = this.vets().find((x) => x.id === v.user_id)?.name ?? '—';
      const petName = this.pets().find((x) => x.id === v.pet_id)?.name ?? '—';
      const svcName = this.services().find((x) => x.id === v.service_id)?.name ?? '—';

      if (aid) {
        const { data: row, error: re } = await this.supabase
          .from('appointment')
          .select(
            `
            id,
            start_date_time,
            end_date_time,
            user_id,
            pet:pet_id (name),
            service:service_id (name),
            status:status_id (name)
          `,
          )
          .eq('id', aid)
          .maybeSingle();

        if (!re && row) {
          const r = row as {
            id: string;
            start_date_time: string;
            end_date_time: string;
            user_id: string;
            pet: FkName;
            service: FkName;
            status: FkName;
          };
          const prof =
            this.vets().find((x) => x.id === r.user_id)?.name ?? vetName;
          this.ticket.set({
            appointmentId: r.id,
            businessName: this.businessName(),
            startDateTime: r.start_date_time,
            endDateTime: r.end_date_time,
            petName: relName(r.pet) || petName,
            serviceName: relName(r.service) || svcName,
            professionalName: prof,
            statusLabel: relName(r.status) || 'Agendada',
          });
        } else {
          const d = v.date instanceof Date ? v.date : new Date(v.date);
          const [hh, mm] = v.start_time.split(':').map(Number);
          const localStart = new Date(d.getFullYear(), d.getMonth(), d.getDate(), hh ?? 0, mm ?? 0, 0, 0);
          const dur = this.services().find((x) => x.id === v.service_id)?.duration_minutes ?? 30;
          const localEnd = new Date(localStart.getTime() + dur * 60_000);
          this.ticket.set({
            appointmentId: aid,
            businessName: this.businessName(),
            startDateTime: localStart.toISOString(),
            endDateTime: localEnd.toISOString(),
            petName,
            serviceName: svcName,
            professionalName: vetName,
            statusLabel: 'Agendada',
          });
        }
      } else {
        this.snack.open('Cita agendada.', 'OK', { duration: 4000 });
      }

      await this.refreshSlots();
    } catch (e) {
      this.snack.open(e instanceof Error ? e.message : 'Error', 'OK', { duration: 4000 });
    } finally {
      this.saving.set(false);
    }
  }

  protected selectSlot(sl: string): void {
    this.form.patchValue({ start_time: sl });
  }
}
