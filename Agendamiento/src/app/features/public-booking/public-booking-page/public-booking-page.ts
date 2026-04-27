import { DatePipe } from '@angular/common';
import { afterNextRender, Component, inject, signal } from '@angular/core';
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
import { MatCardModule } from '@angular/material/card';
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

type EarlierPreviewOk = {
  ok: true;
  appointment_id: string;
  business_id: string;
  current_start: string;
  current_end: string;
  new_start: string;
  new_end: string;
  pet_name: string;
  service_name: string;
  vet_name: string;
};

type EarlierClaimOk = {
  appointment_id: string;
  new_start: string;
  new_end: string;
  pet_name: string;
  service_name: string;
  vet_name: string;
};

@Component({
  selector: 'app-public-booking-page',
  imports: [
    DatePipe,
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
    MatCardModule,
  ],
  templateUrl: './public-booking-page.html',
  styleUrl: './public-booking-page.scss',
})
export class PublicBookingPage {
  private readonly route = inject(ActivatedRoute);
  private readonly fb = inject(FormBuilder);
  private readonly supabase = inject(SUPABASE_CLIENT);
  private readonly snack = inject(MatSnackBar);

  /** Evita pantalla infinita si Supabase no responde (red, bloqueo, etc.). */
  private readonly rpcDeadlineMs = 25_000;

  protected readonly speciesGroups = PET_SPECIES_GROUPS;
  protected readonly speciesOther = PET_SPECIES_OTHER;

  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly businessName = signal('');
  protected readonly rescheduleMode = signal(false);
  /** Enlace desde correo horario liberado: token + rs → sin formulario de invitado. */
  protected readonly emailEarlierFlow = signal(false);
  protected readonly earlierPhase = signal<'loading' | 'preview' | 'claiming' | 'success' | 'error'>('loading');
  protected readonly earlierPreview = signal<EarlierPreviewOk | null>(null);
  protected readonly earlierSuccess = signal<EarlierClaimOk | null>(null);
  protected readonly earlierErrorCode = signal<string | null>(null);

  protected readonly services = signal<{ id: string; name: string; duration_minutes: number }[]>([]);
  protected readonly vets = signal<{ id: string; name: string }[]>([]);
  protected readonly slots = signal<string[]>([]);
  protected readonly slotsLoading = signal(false);

  private businessId = '';
  private rescheduleToken: string | null = null;
  private releasedSlotId: string | null = null;

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

    const snap = this.route.snapshot;
    const bid = snapshotBusinessIdFromRoute(snap) ?? snap.paramMap.get('businessId');
    const token = snap.queryParamMap.get('t');
    const rs = snap.queryParamMap.get('rs');
    if (bid && token && rs) {
      this.businessId = bid;
      this.rescheduleToken = token;
      this.releasedSlotId = rs;
      this.emailEarlierFlow.set(true);
      this.earlierPhase.set('loading');
    }

    afterNextRender(() => void this.bootstrapPublicBooking());
  }

  /** Race RPC contra timeout: si fetch() cuelga, `finally` del caller nunca corría antes. */
  private async rpcDeadline<T>(promise: PromiseLike<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<T>((_, rej) => {
      timer = setTimeout(() => rej(new Error('REQUEST_TIMEOUT')), this.rpcDeadlineMs);
    });
    try {
      return await Promise.race([Promise.resolve(promise), timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async bootstrapPublicBooking() {
    const bid = snapshotBusinessIdFromRoute(this.route.snapshot) ?? this.route.snapshot.paramMap.get('businessId');
    const token = this.route.snapshot.queryParamMap.get('t');
    const rs = this.route.snapshot.queryParamMap.get('rs');
    if (!bid || !this.supabase) {
      if (!this.supabase) {
        this.snack.open(
          'No hay conexión con el servidor de citas (configuración). Probá desde otro navegador o verificá tu red.',
          'OK',
          { duration: 6000 },
        );
      }
      this.loading.set(false);
      return;
    }
    this.businessId = bid;
    this.rescheduleToken = token;
    this.releasedSlotId = rs;

    if (token && rs) {
      try {
        const { data: bjson, error: e1 } = await this.rpcDeadline(
          this.supabase.rpc('get_public_booking_business', {
            p_business_id: bid,
          }),
        );
        if (e1) throw e1;
        if (!bjson) {
          this.earlierErrorCode.set('BOOKING_DISABLED');
          this.earlierPhase.set('error');
          this.loading.set(false);
          return;
        }
        const b = bjson as { name?: string };
        this.businessName.set(String(b?.name ?? 'Clínica'));

        const { data: prev, error: ep } = await this.rpcDeadline(
          this.supabase.rpc('preview_earlier_slot_reschedule', {
            p_token: token,
            p_released_slot_id: rs,
          }),
        );
        if (ep) throw ep;
        const pj = prev as { ok?: boolean; error?: string } & Partial<EarlierPreviewOk>;
        if (!pj?.ok) {
          this.earlierErrorCode.set(pj?.error ?? 'ERROR');
          this.earlierPhase.set('error');
          this.loading.set(false);
          return;
        }
        this.earlierPreview.set(pj as EarlierPreviewOk);
        this.earlierPhase.set('preview');
      } catch (e) {
        console.error(e);
        const msg = e instanceof Error ? e.message : '';
        if (msg === 'REQUEST_TIMEOUT') {
          this.earlierErrorCode.set('REQUEST_TIMEOUT');
          this.snack.open(
            'La solicitud tardó demasiado. Revisá tu conexión o intentá en otro momento.',
            'OK',
            { duration: 6000 },
          );
        } else {
          this.earlierErrorCode.set('PREVIEW_FAILED');
        }
        this.earlierPhase.set('error');
      } finally {
        this.loading.set(false);
      }
      return;
    }

    if (token) {
      try {
        const { data: v } = await this.rpcDeadline(
          this.supabase.rpc('validate_reschedule_token', { p_token: token }),
        );
        const j = v as { ok?: boolean };
        if (j?.ok) this.rescheduleMode.set(true);
      } catch (e) {
        console.error(e);
      }
    }

    try {
      const { data: bjson, error: e1 } = await this.rpcDeadline(
        this.supabase.rpc('get_public_booking_business', {
          p_business_id: bid,
        }),
      );
      if (e1) throw e1;
      if (!bjson) {
        this.snack.open('Reserva no disponible para esta clínica.', 'OK', { duration: 4000 });
        this.loading.set(false);
        return;
      }
      const b = bjson as { name?: string };
      this.businessName.set(String(b?.name ?? 'Clínica'));

      const [{ data: sv }, { data: st }] = await Promise.all([
        this.rpcDeadline(this.supabase.rpc('list_booking_services', { p_business_id: bid })),
        this.rpcDeadline(this.supabase.rpc('list_booking_staff', { p_business_id: bid })),
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
      const msg = e instanceof Error ? e.message : '';
      if (msg === 'REQUEST_TIMEOUT') {
        this.snack.open(
          'La solicitud tardó demasiado. Revisá tu conexión o intentá de nuevo.',
          'OK',
          { duration: 6000 },
        );
      } else {
        this.snack.open('No se pudo cargar la agenda pública.', 'OK', { duration: 4000 });
      }
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

  protected async confirmEarlierSlot(): Promise<void> {
    const token = this.rescheduleToken;
    const rs = this.releasedSlotId;
    if (!token || !rs || !this.supabase) return;
    this.earlierPhase.set('claiming');
    try {
      const { data, error } = await this.rpcDeadline(
        this.supabase.rpc('claim_released_slot_with_reschedule_token', {
          p_token: token,
          p_released_slot_id: rs,
        }),
      );
      if (error) throw error;
      const j = data as { ok?: boolean; error?: string } & Partial<EarlierClaimOk>;
      if (!j?.ok) {
        const code = j?.error ?? 'ERROR';
        this.earlierErrorCode.set(code);
        this.earlierPhase.set('error');
        const map: Record<string, string> = {
          SLOT_ALREADY_TAKEN: 'Ese horario ya no se encuentra disponible.',
          SLOT_EXPIRED: 'El horario liberado ya expiró.',
          SLOT_NOT_COMPATIBLE: 'El horario no es compatible con tu cita.',
          NOT_EARLIER: 'El horario ya no es más temprano que tu cita actual.',
          ALREADY_USED: 'Este enlace ya fue utilizado. Si necesitás otro turno, pedilo desde el portal.',
          EXPIRED: 'El enlace expiró. Solicitá un nuevo enlace desde la clínica o el portal.',
          INVALID_TOKEN: 'El enlace no es válido.',
        };
        this.snack.open(map[code] ?? 'No se pudo confirmar el reagendamiento.', 'OK', { duration: 5000 });
        return;
      }
      this.earlierSuccess.set({
        appointment_id: String(j.appointment_id ?? ''),
        new_start: String(j.new_start ?? ''),
        new_end: String(j.new_end ?? ''),
        pet_name: String(j.pet_name ?? ''),
        service_name: String(j.service_name ?? ''),
        vet_name: String(j.vet_name ?? ''),
      });
      this.earlierPhase.set('success');
      this.snack.open('Tu cita quedó reagendada.', 'OK', { duration: 4000 });
    } catch (e) {
      console.error(e);
      const msg = e instanceof Error ? e.message : '';
      if (msg === 'REQUEST_TIMEOUT') {
        this.earlierErrorCode.set('REQUEST_TIMEOUT');
        this.earlierPhase.set('error');
        this.snack.open('La confirmación tardó demasiado. Probá de nuevo.', 'OK', { duration: 6000 });
        return;
      }
      this.earlierErrorCode.set('CLAIM_FAILED');
      this.earlierPhase.set('error');
      this.snack.open(e instanceof Error ? e.message : 'Error', 'OK', { duration: 4000 });
    }
  }

  protected earlierErrorMessage(): string {
    const c = this.earlierErrorCode();
    const map: Record<string, string> = {
      SLOT_ALREADY_TAKEN: 'Ese horario ya no está disponible. Otro cliente lo tomó antes.',
      SLOT_EXPIRED: 'El horario liberado ya no está vigente.',
      SLOT_NOT_FOUND: 'No encontramos ese espacio liberado.',
      SLOT_NOT_COMPATIBLE: 'El espacio ya no coincide con tu cita.',
      NOT_EARLIER: 'El horario ya no es anterior al que tenías.',
      INSUFFICIENT_DURATION: 'La duración del espacio ya no alcanza para tu servicio.',
      ALREADY_USED: 'Este enlace ya fue usado.',
      EXPIRED: 'El enlace caducó.',
      INVALID_TOKEN: 'Enlace inválido o incompleto.',
      PREVIEW_FAILED: 'No se pudo cargar la vista previa.',
      CLAIM_FAILED: 'No se pudo completar el reagendamiento.',
      BOOKING_DISABLED: 'La reserva en línea no está habilitada para esta clínica.',
      REQUEST_TIMEOUT:
        'La solicitud tardó demasiado. Revisá tu conexión o intentá de nuevo más tarde.',
    };
    return map[c ?? ''] ?? 'No pudimos procesar este enlace. Probá desde el portal o contactá a la clínica.';
  }

  async submit() {
    if (this.emailEarlierFlow()) return;
    if (!this.supabase) return;
    if (this.form.invalid) return;
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
