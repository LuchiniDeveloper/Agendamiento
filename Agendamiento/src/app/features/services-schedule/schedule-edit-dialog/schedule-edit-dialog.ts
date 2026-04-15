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
  /** Fila principal (edición de una sola franja). */
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
    slot1_start: [''],
    slot1_end: [''],
    slot2_start: [''],
    slot2_end: [''],
    /** Creación: segundo horario opcional (mismo día/servicio, ventana 2). */
    optional_w2_start: [''],
    optional_w2_end: [''],
  });

  protected isSlotPairEditMode(): boolean {
    return this.isEditMode && !!this.data.slotPair;
  }

  private excludedScheduleIds(): Set<string> {
    const s = new Set<string>();
    if (this.activeRow?.id) s.add(this.activeRow.id);
    const p = this.data.slotPair;
    if (p?.w1?.id) s.add(p.w1.id);
    if (p?.w2?.id) s.add(p.w2.id);
    return s;
  }

  private usedKeys(): Set<string> {
    const exclude = this.excludedScheduleIds();
    const set = new Set<string>();
    for (const r of this.data.existing) {
      if (exclude.has(r.id)) continue;
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
    if (this.isSlotPairEditMode()) {
      return this.slotPairDayBlocked(dayIndex, serviceId);
    }
    return this.usedKeys().has(scheduleKey(dayIndex, serviceId, this.selectedWindowOrder()));
  }

  /** Otro registro ya ocupa este día + servicio (excluido el par que estamos editando). */
  private slotPairDayBlocked(dayIndex: number, serviceId: string | null): boolean {
    const ex = this.excludedScheduleIds();
    for (const r of this.data.existing) {
      if (ex.has(r.id)) continue;
      if (r.day_of_week !== dayIndex) continue;
      if ((r.service_id ?? null) !== (serviceId ?? null)) continue;
      return true;
    }
    return false;
  }

  isServiceOptionDisabled(serviceId: string): boolean {
    const days = this.selectedDays();
    if (days.size === 0) return false;
    const sid = serviceId === '' ? null : serviceId;
    if (this.isSlotPairEditMode()) {
      for (const d of days) {
        if (!this.slotPairDayBlocked(d, sid)) return false;
      }
      return true;
    }
    const wo = this.selectedWindowOrder();
    for (const d of days) {
      if (!this.usedKeys().has(scheduleKey(d, sid, wo))) return false;
    }
    return true;
  }

  isCualquieraDisabled(): boolean {
    const days = this.selectedDays();
    if (days.size === 0) return false;
    if (this.isSlotPairEditMode()) {
      for (const d of days) {
        if (!this.slotPairDayBlocked(d, null)) return false;
      }
      return true;
    }
    const wo = this.selectedWindowOrder();
    for (const d of days) {
      if (!this.usedKeys().has(scheduleKey(d, null, wo))) return false;
    }
    return true;
  }

  /** En creación: deshabilitar radio del hueco vacío (solo modo una franja). */
  protected isWindowOrderOptionDisabled(wo: 1 | 2): boolean {
    if (this.isSlotPairEditMode()) return false;
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

  constructor() {
    const dr = inject(DestroyRef);
    this.activeRow = this.data.row;
    const r = this.data.row;
    const p = this.data.slotPair;
    if (r && p) {
      this.selectedDays.set(new Set([r.day_of_week]));
      this.form.patchValue({
        service_id: r.service_id ?? '',
        slot1_start: p.w1 ? p.w1.start_time.slice(0, 5) : '',
        slot1_end: p.w1 ? p.w1.end_time.slice(0, 5) : '',
        slot2_start: p.w2 ? p.w2.start_time.slice(0, 5) : '',
        slot2_end: p.w2 ? p.w2.end_time.slice(0, 5) : '',
      });
      this.form.controls.start_time.clearValidators();
      this.form.controls.end_time.clearValidators();
      this.form.controls.window_order.clearValidators();
      this.form.controls.start_time.updateValueAndValidity({ emitEvent: false });
      this.form.controls.end_time.updateValueAndValidity({ emitEvent: false });
      this.form.controls.window_order.updateValueAndValidity({ emitEvent: false });
    } else if (r) {
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
    this.form.controls.window_order.valueChanges.pipe(takeUntilDestroyed(dr)).subscribe((wo) => {
      if (this.isSlotPairEditMode()) return;
      if (!this.isEditMode) {
        if (wo === 2) {
          this.form.patchValue({ optional_w2_start: '', optional_w2_end: '' }, { emitEvent: false });
        }
        this.pruneInvalidSelectedDays();
      }
    });

    this.form.controls.optional_w2_start.valueChanges.pipe(takeUntilDestroyed(dr)).subscribe(() => {
      if (!this.isEditMode) this.pruneInvalidSelectedDays();
    });
    this.form.controls.optional_w2_end.valueChanges.pipe(takeUntilDestroyed(dr)).subscribe(() => {
      if (!this.isEditMode) this.pruneInvalidSelectedDays();
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
    if (this.isSlotPairEditMode()) {
      return this.canSaveSlotPair();
    }
    if (this.form.invalid) return false;
    if (!this.isEditMode) {
      const v = this.form.getRawValue();
      const a = v.optional_w2_start.trim();
      const b = v.optional_w2_end.trim();
      if ((a || b) && !this.timeRangeValid(a, b)) return false;
    }
    if (!this.isEditMode && this.selectedDays().size === 0) return false;
    return true;
  }

  private timeRangeValid(start: string, end: string): boolean {
    return !!(start && end && start < end);
  }

  private normalizeTime(t: string): string {
    const s = t.trim();
    return s.length === 5 ? `${s}:00` : s;
  }

  private canSaveSlotPair(): boolean {
    const p = this.data.slotPair;
    if (!p) return false;
    const v = this.form.getRawValue();
    const r1 = this.timeRangeValid(v.slot1_start.trim(), v.slot1_end.trim());
    const r2 = this.timeRangeValid(v.slot2_start.trim(), v.slot2_end.trim());
    const p1 = !!(v.slot1_start.trim() || v.slot1_end.trim());
    const p2 = !!(v.slot2_start.trim() || v.slot2_end.trim());
    if ((p1 && !r1) || (p2 && !r2)) return false;
    if (p.w1 && !r1) return false;
    if (p.w2 && !r2) return false;
    if (!p.w1 && p1 && !r1) return false;
    if (!p.w2 && p2 && !r2) return false;
    return true;
  }

  private optionalW2Complete(): boolean {
    const v = this.form.getRawValue();
    return this.timeRangeValid(v.optional_w2_start.trim(), v.optional_w2_end.trim());
  }

  cancel() {
    this.ref.close(false);
  }

  async save() {
    if (!this.canSave()) return;
    this.error.set(null);
    if (this.isSlotPairEditMode()) {
      await this.saveSlotPairBoth();
      return;
    }

    const v = this.form.getRawValue();
    const sid = v.service_id === '' ? null : v.service_id;
    const wo = v.window_order === 2 ? 2 : 1;
    const dowOrder = (d: number) => (d === 0 ? 7 : d);
    const daysSorted = [...this.selectedDays()].sort((a, b) => dowOrder(a) - dowOrder(b));

    this.saving.set(true);
    try {
      const start = this.normalizeTime(v.start_time);
      const end = this.normalizeTime(v.end_time);
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
        const dualW2 = wo === 1 && this.optionalW2Complete();
        const daysToInsert = daysSorted.filter((d) => {
          if (this.usedKeys().has(scheduleKey(d, sid, wo))) return false;
          if (dualW2 && this.usedKeys().has(scheduleKey(d, sid, 2))) return false;
          return true;
        });
        if (daysToInsert.length === 0) {
          this.error.set(
            'Los días marcados ya tienen esta franja (horario 1 u 2) para el servicio elegido. Cambiá el número de horario, el servicio o los días.',
          );
          return;
        }
        const skipped = daysSorted.length - daysToInsert.length;
        const rows: Omit<ScheduleRow, 'id'>[] = [];
        for (const day_of_week of daysToInsert) {
          rows.push({
            user_id: this.data.userId,
            service_id: sid,
            day_of_week,
            window_order: wo,
            start_time: start,
            end_time: end,
          });
          if (dualW2) {
            rows.push({
              user_id: this.data.userId,
              service_id: sid,
              day_of_week,
              window_order: 2,
              start_time: this.normalizeTime(v.optional_w2_start.trim()),
              end_time: this.normalizeTime(v.optional_w2_end.trim()),
            });
          }
        }
        const { error } = await this.api.insertSchedulesBatch(rows);
        if (error) {
          this.error.set(this.mapErr(error));
          return;
        }
        if (skipped > 0) {
          const labels = daysSorted
            .filter((d) => !daysToInsert.includes(d))
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

  private async saveSlotPairBoth() {
    const p = this.data.slotPair;
    if (!p) return;
    const v = this.form.getRawValue();
    const sid = v.service_id === '' ? null : v.service_id;
    const dowOrder = (d: number) => (d === 0 ? 7 : d);
    const daysSorted = [...this.selectedDays()].sort((a, b) => dowOrder(a) - dowOrder(b));
    const day = daysSorted[0];
    const r1 = this.timeRangeValid(v.slot1_start.trim(), v.slot1_end.trim());
    const r2 = this.timeRangeValid(v.slot2_start.trim(), v.slot2_end.trim());

    this.saving.set(true);
    try {
      const runUpdate = async (
        row: ScheduleRow,
        wo: 1 | 2,
        start: string,
        end: string,
      ) => {
        if (this.usedKeys().has(scheduleKey(day, sid, wo))) {
          this.error.set('Ya existe una franja para ese día, servicio y número de horario.');
          return false;
        }
        const { error } = await this.api.updateSchedule(row.id, {
          day_of_week: day,
          window_order: wo,
          start_time: this.normalizeTime(start),
          end_time: this.normalizeTime(end),
          service_id: sid,
        });
        if (error) {
          this.error.set(this.mapErr(error));
          return false;
        }
        return true;
      };

      const runInsert = async (wo: 1 | 2, start: string, end: string) => {
        if (this.usedKeys().has(scheduleKey(day, sid, wo))) {
          this.error.set('Ya existe una franja para ese día, servicio y número de horario.');
          return false;
        }
        const { error } = await this.api.insertSchedulesBatch([
          {
            user_id: this.data.userId,
            service_id: sid,
            day_of_week: day,
            window_order: wo,
            start_time: this.normalizeTime(start),
            end_time: this.normalizeTime(end),
          },
        ]);
        if (error) {
          this.error.set(this.mapErr(error));
          return false;
        }
        return true;
      };

      if (p.w1) {
        if (!r1) {
          this.error.set('Completá el horario 1.');
          return;
        }
        if (!(await runUpdate(p.w1, 1, v.slot1_start.trim(), v.slot1_end.trim()))) return;
      } else if (r1) {
        if (!(await runInsert(1, v.slot1_start.trim(), v.slot1_end.trim()))) return;
      }

      if (p.w2) {
        if (!r2) {
          this.error.set('Completá el horario 2.');
          return;
        }
        if (!(await runUpdate(p.w2, 2, v.slot2_start.trim(), v.slot2_end.trim()))) return;
      } else if (r2) {
        if (!(await runInsert(2, v.slot2_start.trim(), v.slot2_end.trim()))) return;
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
