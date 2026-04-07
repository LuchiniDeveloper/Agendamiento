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
import { CustomersData } from '../../customers/customers.data';
import { ServicesData, staffRowsForScheduling } from '../../services-schedule/services.data';
import { AppointmentsData } from '../appointments.data';

export interface AppointmentFormOpen {
  defaultStart?: Date;
  defaultVetId?: string | null;
}

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
  protected readonly pets = signal<{ id: string; name: string }[]>([]);
  protected readonly servicesList = signal<{ id: string; name: string; duration_minutes: number }[]>([]);
  protected readonly vets = signal<{ id: string; name: string }[]>([]);
  protected statusIdDefault = 1;

  form = this.fb.nonNullable.group({
    customer_id: ['', Validators.required],
    pet_id: ['', Validators.required],
    service_id: ['', Validators.required],
    user_id: ['', Validators.required],
    date: [new Date(), Validators.required],
    start_time: ['', Validators.required],
    notes: [''],
    create_reminder: [true],
  });

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
      date: defStart,
      start_time: '',
      user_id: this.openData?.defaultVetId ?? (this.vets()[0]?.id ?? ''),
    });

    await this.reloadCustomers();
    await this.refreshSlotOptions();
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
      const d = date instanceof Date ? date : new Date(date);
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
    this.pets.set((data ?? []) as { id: string; name: string }[]);
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

      if (start.getTime() <= Date.now()) {
        this.error.set('Para hoy solo puedes agendar en horarios posteriores a la hora actual.');
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
      if (v.create_reminder && data?.id) {
        await this.appts.insertReminder(data.id as string);
      }
      this.ref.close(true);
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al guardar');
    } finally {
      this.saving.set(false);
    }
  }
}
