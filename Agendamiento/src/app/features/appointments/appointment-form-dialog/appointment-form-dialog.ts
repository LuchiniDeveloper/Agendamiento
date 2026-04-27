import { Component, inject, OnInit, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { debounceTime, merge } from 'rxjs';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatSelectModule } from '@angular/material/select';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { CustomersData, type PetRow } from '../../customers/customers.data';
import { petAvatarFromSpecies } from '../../customers/pet-avatar.util';
import { ServicesData, staffRowsForScheduling } from '../../services-schedule/services.data';
import { AppointmentsData, todayYmdLocal } from '../appointments.data';

export interface AppointmentFormOpen {
  defaultStart?: Date;
  defaultVetId?: string | null;
}

export type AppointmentPetOption = { id: string; name: string; species: string | null };

@Component({
  selector: 'app-appointment-form-dialog',
  styleUrl: './appointment-form-dialog.scss',
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatSelectModule,
    MatDatepickerModule,
    MatNativeDateModule,
    MatCheckboxModule,
  ],
  templateUrl: './appointment-form-dialog.html',
})
export class AppointmentFormDialog implements OnInit {
  protected readonly petAvatarFromSpecies = petAvatarFromSpecies;

  private readonly fb = inject(FormBuilder);
  private readonly customers = inject(CustomersData);
  private readonly services = inject(ServicesData);
  private readonly appts = inject(AppointmentsData);
  private readonly ref = inject(MatDialogRef<AppointmentFormDialog, boolean>);
  private readonly openData = inject(MAT_DIALOG_DATA, { optional: true }) as AppointmentFormOpen | undefined;

  protected readonly error = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly slotsLoading = signal(false);
  protected readonly slotsError = signal<string | null>(null);
  protected readonly slotOptions = signal<string[]>([]);
  protected readonly customerOptions = signal<{ id: string; name: string; phone: string | null }[]>([]);
  protected readonly pets = signal<AppointmentPetOption[]>([]);
  protected readonly servicesList = signal<{ id: string; name: string; duration_minutes: number }[]>([]);
  protected readonly vets = signal<{ id: string; name: string }[]>([]);
  protected statusIdDefault = 1;

  /** Inicio del día local (datepicker: no fechas pasadas). */
  protected readonly minDate = AppointmentFormDialog.startOfToday();

  form = this.fb.nonNullable.group({
    customer_id: ['', Validators.required],
    pet_id: ['', Validators.required],
    service_id: ['', Validators.required],
    user_id: ['', Validators.required],
    date: [AppointmentFormDialog.startOfToday(), Validators.required],
    start_time: ['', Validators.required],
    notify_if_earlier_slot: [false],
    notes: [''],
  });

  private static startOfToday(): Date {
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    return t;
  }

  constructor() {
    merge(
      this.form.controls.user_id.valueChanges,
      this.form.controls.service_id.valueChanges,
      this.form.controls.date.valueChanges,
    )
      .pipe(debounceTime(100), takeUntilDestroyed())
      .subscribe(() => void this.refreshSlotOptions());
  }

  async ngOnInit() {
    const [{ data: st }, { data: sv }, { data: vt }] = await Promise.all([
      this.appts.statusMap(),
      this.services.listServices(),
      this.services.listStaff(),
    ]);
    const agendada = (st ?? []).find((x: { name: string }) => x.name === 'Agendada');
    if (agendada) this.statusIdDefault = agendada.id as number;
    this.servicesList.set(
      (sv ?? []).filter((s: { active?: boolean }) => s.active !== false) as {
        id: string;
        name: string;
        duration_minutes: number;
      }[],
    );
    this.vets.set(staffRowsForScheduling(vt));

    const defStart = this.openData?.defaultStart ?? new Date();
    this.form.patchValue({
      date: this.clampDateToNotBeforeToday(defStart),
      start_time: '',
      user_id: this.openData?.defaultVetId ?? (this.vets()[0]?.id ?? ''),
    });

    await this.reloadCustomers();
    await this.refreshSlotOptions();
  }

  private clampDateToNotBeforeToday(d: Date): Date {
    const min = AppointmentFormDialog.startOfToday();
    const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    return day.getTime() < min.getTime() ? new Date(min) : day;
  }

  /**
   * El día ya cargado no tiene huecos: busca desde el día siguiente hasta 60 días.
   * No dispara `valueChanges` en el formulario.
   */
  private async advanceUntilSlotsFound(maxDaysForward = 60) {
    const { user_id, service_id, date } = this.form.getRawValue();
    if (!user_id || !service_id || !date) return;

    let d = date instanceof Date ? new Date(date) : new Date(date);
    d = this.clampDateToNotBeforeToday(d);
    d.setDate(d.getDate() + 1);

    for (let i = 0; i < maxDaysForward; i++) {
      const onDate = this.localCalendarDateString(d);
      try {
        const slots = await this.appts.getAvailableSlots({
          userId: user_id,
          serviceId: service_id,
          onDate,
        });
        if (slots.length > 0) {
          const dayOnly = new Date(d.getFullYear(), d.getMonth(), d.getDate());
          this.form.patchValue({ date: dayOnly, start_time: slots[0]! }, { emitEvent: false });
          this.slotOptions.set(slots);
          return;
        }
      } catch {
        return;
      }
      d.setDate(d.getDate() + 1);
    }

    d.setDate(d.getDate() - 1);
    const last = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    this.form.patchValue({ date: last, start_time: '' }, { emitEvent: false });
    this.slotOptions.set([]);
  }

  /** Fecha calendario local YYYY-MM-DD (evita corrimientos por ISO/UTC del datepicker). */
  private localCalendarDateString(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  async refreshSlotOptions() {
    const { user_id, service_id, date } = this.form.getRawValue();
    if (!user_id || !service_id || !date) {
      this.slotOptions.set([]);
      return;
    }
    this.slotsLoading.set(true);
    this.slotsError.set(null);
    try {
      let d = date instanceof Date ? date : new Date(date);
      const clamped = this.clampDateToNotBeforeToday(d);
      if (this.localCalendarDateString(clamped) !== this.localCalendarDateString(d)) {
        this.form.patchValue({ date: clamped }, { emitEvent: false });
        d = clamped;
      }
      const onDate = this.localCalendarDateString(d);
      const slots = await this.appts.getAvailableSlots({
        userId: user_id,
        serviceId: service_id,
        onDate,
      });
      this.slotOptions.set(slots);
      const cur = this.form.controls.start_time.value;
      if (slots.length) {
        if (!cur || !slots.includes(cur)) {
          this.form.patchValue({ start_time: slots[0]! });
        }
      } else {
        this.form.patchValue({ start_time: '' });
        if (onDate === todayYmdLocal()) {
          await this.advanceUntilSlotsFound();
        }
      }
    } catch (e) {
      console.error(e);
      const msg =
        e && typeof e === 'object' && 'message' in e
          ? String((e as { message?: string }).message)
          : 'No se pudieron cargar los horarios.';
      this.slotsError.set(msg);
      this.slotOptions.set([]);
      this.form.patchValue({ start_time: '' });
    } finally {
      this.slotsLoading.set(false);
    }
  }

  async reloadCustomers() {
    const { data } = await this.customers.list();
    this.customerOptions.set((data ?? []) as { id: string; name: string; phone: string | null }[]);
  }

  async onCustomerChange(id: string) {
    this.form.patchValue({ pet_id: '' });
    if (!id) {
      this.pets.set([]);
      return;
    }
    const { data } = await this.customers.petsForCustomer(id);
    const rows = (data ?? []) as PetRow[];
    this.pets.set(rows.map((p) => ({ id: p.id, name: p.name, species: p.species ?? null })));
  }

  protected selectedPet(): AppointmentPetOption | null {
    const id = this.form.controls.pet_id.value;
    if (!id) return null;
    return this.pets().find((p) => p.id === id) ?? null;
  }

  cancel() {
    this.ref.close(false);
  }

  async save() {
    if (this.form.invalid) return;
    this.error.set(null);
    this.saving.set(true);
    try {
      const v = this.form.getRawValue();
      const svc = this.servicesList().find((s) => s.id === v.service_id);
      const durMin = svc?.duration_minutes ?? 30;
      const d = v.date instanceof Date ? v.date : new Date(v.date);
      const parts = v.start_time.split(':');
      const hh = Number(parts[0]);
      const mm = Number(parts[1] ?? 0);
      const start = new Date(d);
      start.setHours(hh, mm, 0, 0);
      const end = new Date(start.getTime() + durMin * 60_000);

      const startDay = this.localCalendarDateString(start);
      if (startDay < todayYmdLocal()) {
        this.error.set('No puedes agendar en fechas pasadas.');
        return;
      }

      if (start.getTime() <= Date.now()) {
        this.error.set('Elige un horario posterior a la hora actual.');
        return;
      }

      const overlap = await this.appts.hasOverlap(v.user_id, start, end);
      if (overlap) {
        this.error.set('Ese veterinario ya tiene una cita en ese horario.');
        return;
      }

      const { data, error } = await this.appts.insert({
        customer_id: v.customer_id,
        pet_id: v.pet_id,
        service_id: v.service_id,
        user_id: v.user_id,
        start_date_time: start.toISOString(),
        end_date_time: end.toISOString(),
        status_id: this.statusIdDefault,
        notes: v.notes || null,
      });
      if (error) throw error;
      const appointmentId = (data as { id?: string } | null)?.id;
      if (appointmentId) {
        const { data: optData, error: optError } = await this.appts.setEarlierSlotOptIn(
          appointmentId,
          v.notify_if_earlier_slot,
        );
        if (optError) throw optError;
        const ok = (optData as { ok?: boolean; error?: string } | null)?.ok;
        if (!ok) {
          const code = (optData as { error?: string } | null)?.error ?? 'OPTIN_FAILED';
          throw new Error(`No se pudo guardar la preferencia (${code}).`);
        }
      }
      this.ref.close(true);
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al guardar');
    } finally {
      this.saving.set(false);
    }
  }
}
