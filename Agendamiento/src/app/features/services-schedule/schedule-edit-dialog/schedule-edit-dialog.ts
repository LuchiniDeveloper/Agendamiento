import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatSelectModule } from '@angular/material/select';
import { MatRadioModule } from '@angular/material/radio';
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

/** Par de franjas del mismo día y servicio (tabla agrupada); permite alternar H1/H2 en un solo modal. */
export interface ScheduleSlotPair {
  w1: ScheduleRow | null;
  w2: ScheduleRow | null;
}

export interface ScheduleEditDialogData {
  row: ScheduleRow | null;
  /** Si viene de la fila agrupada: al cambiar horario 1/2 se carga la fila correspondiente. */
  slotPair?: ScheduleSlotPair | null;
  services: ServiceRow[];
  existing: ScheduleRow[];
  userId: string;
}

function scheduleKey(day: number, serviceId: string | null, windowOrder: number): string {
  return `${day}:${serviceId ?? ''}:${windowOrder}`;
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
    MatRadioModule,
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
  /** Fila que se actualiza al guardar; en modo `slotPair` cambia al alternar horario 1/2. */
  private activeRow: ScheduleRow | null = null;

  protected get dialogTitle(): string {
    if (!this.data.row) return 'Añadir franjas';
    if (this.data.slotPair) return 'Editar horarios';
    return 'Editar franja';
  }

  form = this.fb.nonNullable.group({
    window_order: [1 as number, [Validators.required, Validators.min(1), Validators.max(2)]],
    start_time: ['09:00', Validators.required],
    end_time: ['17:00', Validators.required],
    service_id: ['' as string],
  });

  private usedKeys(): Set<string> {
    const curId = this.activeRow?.id;
    const set = new Set<string>();
    for (const r of this.data.existing) {
      if (r.id === curId) continue;
      const wo = r.window_order ?? 1;
      set.add(scheduleKey(r.day_of_week, r.service_id, wo));
    }
    return set;
  }

  private selectedWindowOrder(): number {
    const w = Number(this.form.controls.window_order.value);
    return w === 2 ? 2 : 1;
  }

  isDayOptionDisabled(dayIndex: number): boolean {
    const sid = this.form.controls.service_id.value;
    const serviceId = sid === '' ? null : sid;
    return this.usedKeys().has(scheduleKey(dayIndex, serviceId, this.selectedWindowOrder()));
  }

  isServiceOptionDisabled(serviceId: string): boolean {
    const days = this.selectedDays();
    if (days.size === 0) return false;
    const sid = serviceId === '' ? null : serviceId;
    const wo = this.selectedWindowOrder();
    for (const d of days) {
      if (!this.usedKeys().has(scheduleKey(d, sid, wo))) return false;
    }
    return true;
  }

  isCualquieraDisabled(): boolean {
    const days = this.selectedDays();
    if (days.size === 0) return false;
    const wo = this.selectedWindowOrder();
    for (const d of days) {
      if (!this.usedKeys().has(scheduleKey(d, null, wo))) return false;
    }
    return true;
  }

  /** En edición con par agrupado: deshabilitar el radio del hueco vacío. */
  protected isWindowOrderOptionDisabled(wo: 1 | 2): boolean {
    const p = this.data.slotPair;
    if (!this.isEditMode || !p) return false;
    if (wo === 1) return !p.w1;
    return !p.w2;
  }

  protected windowOrderOptionTooltip(wo: 1 | 2): string {
    if (!this.isWindowOrderOptionDisabled(wo)) return '';
    return wo === 1
      ? 'No hay horario 1 en esta fila. Podés crearlo con «Añadir franja».'
      : 'No hay horario 2 en esta fila. Podés crearlo con «Añadir franja».';
  }

  private syncActiveRowFromSlotPair(): void {
    const p = this.data.slotPair;
    if (!p || !this.isEditMode) return;
    const wo = this.selectedWindowOrder();
    const next = wo === 2 ? p.w2 : p.w1;
    if (!next) return;
    this.activeRow = next;
    this.form.patchValue(
      {
        window_order: wo,
        start_time: next.start_time.slice(0, 5),
        end_time: next.end_time.slice(0, 5),
        service_id: next.service_id ?? '',
      },
      { emitEvent: false },
    );
  }

  constructor() {
    const dr = inject(DestroyRef);
    this.activeRow = this.data.row;
    const r = this.data.row;
    if (r) {
      this.selectedDays.set(new Set([r.day_of_week]));
      this.form.patchValue({
        window_order: r.window_order === 2 ? 2 : 1,
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
    this.form.controls.window_order.valueChanges.pipe(takeUntilDestroyed(dr)).subscribe(() => {
      if (this.isEditMode && this.data.slotPair) {
        this.syncActiveRowFromSlotPair();
        return;
      }
      if (!this.isEditMode) {
        this.pruneInvalidSelectedDays();
      }
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
    const wo = v.window_order === 2 ? 2 : 1;
    const dowOrder = (d: number) => (d === 0 ? 7 : d);
    const daysSorted = [...this.selectedDays()].sort((a, b) => dowOrder(a) - dowOrder(b));

    this.saving.set(true);
    try {
      const start = v.start_time.length === 5 ? `${v.start_time}:00` : v.start_time;
      const end = v.end_time.length === 5 ? `${v.end_time}:00` : v.end_time;
      if (this.activeRow) {
        const day = daysSorted[0];
        if (this.usedKeys().has(scheduleKey(day, sid, wo))) {
          this.error.set('Ya existe una franja para ese día, servicio y número de horario.');
          return;
        }
        const { error } = await this.api.updateSchedule(this.activeRow.id, {
          day_of_week: day,
          window_order: wo,
          start_time: start,
          end_time: end,
          service_id: sid,
        });
        if (error) {
          this.error.set(this.mapErr(error));
          return;
        }
      } else {
        const daysToInsert = daysSorted.filter((d) => !this.usedKeys().has(scheduleKey(d, sid, wo)));
        if (daysToInsert.length === 0) {
          this.error.set(
            'Los días marcados ya tienen esta franja (horario 1 u 2) para el servicio elegido. Cambiá el número de horario, el servicio o los días.',
          );
          return;
        }
        const skipped = daysSorted.length - daysToInsert.length;
        const rows = daysToInsert.map((day_of_week) => ({
          user_id: this.data.userId,
          service_id: sid,
          day_of_week,
          window_order: wo,
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
            .filter((d) => this.usedKeys().has(scheduleKey(d, sid, wo)))
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
      return 'Ya existe una franja para ese día, servicio y número de horario.';
    }
    return err.message?.trim() || 'No se pudo guardar.';
  }
}
