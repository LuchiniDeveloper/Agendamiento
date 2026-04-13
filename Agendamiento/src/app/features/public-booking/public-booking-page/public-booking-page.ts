import { Component, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, RouterLink, type ActivatedRouteSnapshot } from '@angular/router';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatSelectModule } from '@angular/material/select';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { debounceTime, merge } from 'rxjs';
import { SUPABASE_CLIENT } from '../../../core/supabase';
import { AGENDA_DEFAULT_TZ } from '../../appointments/appointments.data';
import { PortalAuthShell } from '../../client-portal/portal-auth-shell/portal-auth-shell';
import {
  PET_SPECIES_GROUPS,
  PET_SPECIES_OTHER,
  speciesFromForm,
} from '../../customers/pet-form-dialog/pet-species.options';

function snapshotBusinessIdFromRoute(s: ActivatedRouteSnapshot | null): string | null {
  for (let r: ActivatedRouteSnapshot | null = s; r; r = r.parent ?? null) {
    const b = r.paramMap.get('businessId');
    if (b) return b;
  }
  return null;
}

@Component({
  selector: 'app-public-booking-page',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    PortalAuthShell,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatSelectModule,
    MatDatepickerModule,
    MatNativeDateModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    MatChipsModule,
    MatIconModule,
  ],
  templateUrl: './public-booking-page.html',
  styleUrl: './public-booking-page.scss',
})
export class PublicBookingPage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly fb = inject(FormBuilder);
  private readonly supabase = inject(SUPABASE_CLIENT);
  private readonly snack = inject(MatSnackBar);

  protected readonly speciesGroups = PET_SPECIES_GROUPS;
  protected readonly speciesOther = PET_SPECIES_OTHER;

  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly businessName = signal('');
  protected readonly rescheduleMode = signal(false);
  protected readonly services = signal<{ id: string; name: string; duration_minutes: number }[]>([]);
  protected readonly vets = signal<{ id: string; name: string }[]>([]);
  protected readonly slots = signal<string[]>([]);
  protected readonly slotsLoading = signal(false);

  private businessId = '';

  /** Para enlaces a `/portal/:businessId/...` desde la plantilla. */
  protected businessIdForLink(): string {
    return this.businessId;
  }

  readonly form = this.fb.nonNullable.group({
    customer_name: ['', [Validators.required, Validators.minLength(2)]],
    customer_phone: [''],
    customer_email: ['', [Validators.required, Validators.email]],
    pet_name: ['', Validators.required],
    pet_species_preset: ['', Validators.required],
    pet_species_other: [''],
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
    const bid = snapshotBusinessIdFromRoute(this.route.snapshot) ?? this.route.snapshot.paramMap.get('businessId');
    const token = this.route.snapshot.queryParamMap.get('t');
    if (!bid || !this.supabase) {
      this.loading.set(false);
      return;
    }
    this.businessId = bid;

    if (token) {
      const { data: v } = await this.supabase.rpc('validate_reschedule_token', { p_token: token });
      const j = v as { ok?: boolean };
      if (j?.ok) this.rescheduleMode.set(true);
    }

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

      const [{ data: sv }, { data: st }] = await Promise.all([
        this.supabase.rpc('list_booking_services', { p_business_id: bid }),
        this.supabase.rpc('list_booking_staff', { p_business_id: bid }),
      ]);
      const sList = (sv as { id: string; name: string; duration_minutes: number }[] | null) ?? [];
      const vList = (st as { id: string; name: string }[] | null) ?? [];
      this.services.set(sList);
      this.vets.set(vList);
      if (sList.length && vList.length) {
        this.form.patchValue({
          service_id: sList[0]!.id,
          user_id: vList[0]!.id,
        });
      }
      await this.refreshSlots();
    } catch (e) {
      console.error(e);
      this.snack.open('No se pudo cargar la agenda pública.', 'OK', { duration: 4000 });
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
        p_business_id: this.businessId,
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

  async submit() {
    if (this.form.invalid || !this.supabase) return;
    const v = this.form.getRawValue();
    this.saving.set(true);
    try {
      const onDate = this.localYmd(v.date instanceof Date ? v.date : new Date(v.date));
      const species = speciesFromForm(v.pet_species_preset, v.pet_species_other);
      if (!species) {
        this.snack.open('Seleccioná la especie o completá «Otro».', 'OK', { duration: 4000 });
        return;
      }

      const rpcName = 'create_public_booking_appointment_guest';
      const { data, error } = await this.supabase.rpc(rpcName, {
        p_business_id: this.businessId,
        p_customer_name: v.customer_name.trim(),
        p_customer_phone: v.customer_phone?.trim() || null,
        p_customer_email: v.customer_email?.trim() || null,
        p_pet_name: v.pet_name.trim(),
        p_pet_species: species,
        p_service_id: v.service_id,
        p_user_id: v.user_id,
        p_on_date: onDate,
        p_start_hhmm: v.start_time,
        p_tz: AGENDA_DEFAULT_TZ,
      });
      if (error) throw error;
      const j = data as { ok?: boolean; error?: string };
      if (!j?.ok) {
        const err = j?.error ?? 'ERROR';
        const map: Record<string, string> = {
          BOOKING_DISABLED: 'La reserva en línea no está habilitada.',
          SLOT_TAKEN: 'Ese horario ya no está disponible. Elegí otro.',
          PAST: 'Elegí un horario futuro.',
          CONTACT: 'Necesitamos teléfono o correo.',
        };
        this.snack.open(map[err] ?? 'No se pudo reservar.', 'OK', { duration: 4500 });
        return;
      }
      const msg =
        'Cita agendada. No recibirás alertas por correo ni acceso al historial con este modo.';
      this.snack.open(msg, 'OK', {
        duration: 5000,
      });
      this.form.reset({
        customer_name: '',
        customer_phone: '',
        customer_email: '',
        pet_name: '',
        pet_species_preset: '',
        pet_species_other: '',
        service_id: this.services()[0]?.id ?? '',
        user_id: this.vets()[0]?.id ?? '',
        date: new Date(),
        start_time: '',
      });
      await this.refreshSlots();
    } catch (e) {
      this.snack.open(e instanceof Error ? e.message : 'Error', 'OK', { duration: 4000 });
    } finally {
      this.saving.set(false);
    }
  }
}
