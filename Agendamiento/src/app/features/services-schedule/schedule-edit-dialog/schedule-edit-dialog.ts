import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { ServicesData, type ScheduleRow, type ServiceRow } from '../services.data';

/** Lunes→Domingo (índices DB: 1..6, 0) */
const DAY_PICKER = [
  { dow: 1, label: 'L' },
  { dow: 2, label: 'M' },
  { dow: 3, label: 'X' },
  { dow: 4, label: 'J' },
  { dow: 5, label: 'V' },
  { dow: 6, label: 'S' },
  { dow: 0, label: 'D' },
] as const;

export interface ScheduleEditDialogData {
  row: ScheduleRow | null;
  services: ServiceRow[];
  existing: ScheduleRow[];
  userId: string;
}

function scheduleKey(day: number, serviceId: string | null): string {
  return `${day}:${serviceId ?? ''}`;
}

@Component({
  selector: 'app-schedule-edit-dialog',
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatSelectModule,
    MatTooltipModule,
    MatSnackBarModule,
  ],
  templateUrl: './schedule-edit-dialog.html',
  styleUrl: './schedule-edit-dialog.scss',
})
export class ScheduleEditDialog {
  private readonly fb = inject(FormBuilder);
  private readonly api = inject(ServicesData);
  private readonly snack = inject(MatSnackBar);
  protected readonly ref = inject(MatDialogRef<ScheduleEditDialog, boolean>);
  protected readonly data = inject(MAT_DIALOG_DATA) as ScheduleEditDialogData;

  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly dayPicker = DAY_PICKER;
  /** En creación: varios días; en edición: un solo día. */
  protected readonly selectedDays = signal<Set<number>>(new Set());
  protected readonly isEditMode = !!this.data.row;

  form = this.fb.nonNullable.group({
    start_time: ['09:00', Validators.required],
    end_time: ['17:00', Validators.required],
    service_id: ['' as string],
  });

  private usedKeys(): Set<string> {
    const curId = this.data.row?.id;
    const set = new Set<string>();
    for (const r of this.data.existing) {
      if (r.id === curId) continue;
      set.add(scheduleKey(r.day_of_week, r.service_id));
    }
    return set;
  }

  isDayOptionDisabled(dayIndex: number): boolean {
    const sid = this.form.controls.service_id.value;
    const serviceId = sid === '' ? null : sid;
    return this.usedKeys().has(scheduleKey(dayIndex, serviceId));
  }

  isServiceOptionDisabled(serviceId: string): boolean {
    const days = this.selectedDays();
    if (days.size === 0) return false;
    for (const d of days) {
      if (!this.usedKeys().has(scheduleKey(d, serviceId))) return false;
    }
    return true;
  }

  isCualquieraDisabled(): boolean {
    const days = this.selectedDays();
    if (days.size === 0) return false;
    for (const d of days) {
      if (!this.usedKeys().has(scheduleKey(d, null))) return false;
    }
    return true;
  }

  constructor() {
    const dr = inject(DestroyRef);
    const r = this.data.row;
    if (r) {
      this.selectedDays.set(new Set([r.day_of_week]));
      this.form.patchValue({
        start_time: r.start_time.slice(0, 5),
        end_time: r.end_time.slice(0, 5),
        service_id: r.service_id ?? '',
      });
    } else {
      this.selectedDays.set(new Set([1]));
      this.pruneInvalidSelectedDays();
    }

    this.form.controls.service_id.valueChanges.pipe(takeUntilDestroyed(dr)).subscribe(() => {
      if (this.isEditMode) return;
      this.pruneInvalidSelectedDays();
    });
  }

  private dayShortLabel(dow: number): string {
    return DAY_PICKER.find((x) => x.dow === dow)?.label ?? String(dow);
  }

  dayPillTooltip(dow: number): string {
    if (!this.isDayOptionDisabled(dow)) return '';
    if (!this.isEditMode && this.isDaySelected(dow)) {
      return 'Este día ya tiene esta franja; pulsa para quitarlo de la selección.';
    }
    return 'Ya hay una franja para este día y el servicio elegido.';
  }

  private pruneInvalidSelectedDays() {
    const next = new Set(this.selectedDays());
    for (const d of [...next]) {
      if (this.isDayOptionDisabled(d)) next.delete(d);
    }
    if (next.size === 0) {
      const first = DAY_PICKER.find((x) => !this.isDayOptionDisabled(x.dow));
      if (first) next.add(first.dow);
    }
    this.selectedDays.set(next);
  }

  isDaySelected(dow: number): boolean {
    return this.selectedDays().has(dow);
  }

  toggleDay(dow: number) {
    if (this.isEditMode) {
      if (this.isDayOptionDisabled(dow)) return;
      this.selectedDays.set(new Set([dow]));
      return;
    }
    const cur = new Set(this.selectedDays());
    const taken = this.isDayOptionDisabled(dow);
    if (cur.has(dow)) {
      if (cur.size <= 1) return;
      cur.delete(dow);
      this.selectedDays.set(cur);
      return;
    }
    if (taken) return;
    cur.add(dow);
    this.selectedDays.set(cur);
  }

  /** En creación: el botón solo se deshabilita si el día ya tiene franja y no está seleccionado (así puedes quitarlo). */
  isDayButtonDisabled(dow: number): boolean {
    if (this.isEditMode) return this.isDayOptionDisabled(dow);
    return this.isDayOptionDisabled(dow) && !this.isDaySelected(dow);
  }

  canSave(): boolean {
    if (this.form.invalid) return false;
    if (!this.isEditMode && this.selectedDays().size === 0) return false;
    return true;
  }

  cancel() {
    this.ref.close(false);
  }

  async save() {
    if (!this.canSave()) return;
    this.error.set(null);
    const v = this.form.getRawValue();
    const sid = v.service_id === '' ? null : v.service_id;
    const dowOrder = (d: number) => (d === 0 ? 7 : d);
    const daysSorted = [...this.selectedDays()].sort((a, b) => dowOrder(a) - dowOrder(b));

    this.saving.set(true);
    try {
      const start = v.start_time.length === 5 ? `${v.start_time}:00` : v.start_time;
      const end = v.end_time.length === 5 ? `${v.end_time}:00` : v.end_time;
      if (this.data.row) {
        const day = daysSorted[0];
        if (this.usedKeys().has(scheduleKey(day, sid))) {
          this.error.set('Ya existe una franja para ese día y servicio.');
          return;
        }
        const { error } = await this.api.updateSchedule(this.data.row.id, {
          day_of_week: day,
          start_time: start,
          end_time: end,
          service_id: sid,
        });
        if (error) {
          this.error.set(this.mapErr(error));
          return;
        }
      } else {
        const daysToInsert = daysSorted.filter((d) => !this.usedKeys().has(scheduleKey(d, sid)));
        if (daysToInsert.length === 0) {
          this.error.set(
            'Los días marcados ya tienen franja para este servicio. Quita esos días o cambia el servicio.',
          );
          return;
        }
        const skipped = daysSorted.length - daysToInsert.length;
        const rows = daysToInsert.map((day_of_week) => ({
          user_id: this.data.userId,
          service_id: sid,
          day_of_week,
          start_time: start,
          end_time: end,
        }));
        const { error } = await this.api.insertSchedulesBatch(rows);
        if (error) {
          this.error.set(this.mapErr(error));
          return;
        }
        if (skipped > 0) {
          const labels = daysSorted
            .filter((d) => this.usedKeys().has(scheduleKey(d, sid)))
            .map((d) => this.dayShortLabel(d))
            .join(', ');
          this.snack.open(
            `Franjas nuevas: ${daysToInsert.length} día(s). Ya existían (omitidos): ${labels}.`,
            'Cerrar',
            { duration: 6000 },
          );
        }
      }
      this.ref.close(true);
    } finally {
      this.saving.set(false);
    }
  }

  private mapErr(err: { code?: string; message?: string }): string {
    if (err.code === '23505') {
      return 'Ya existe una franja para ese día y servicio.';
    }
    return err.message?.trim() || 'No se pudo guardar.';
  }
}
