import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MedicalData, type MedicalRecordRow } from '../medical.data';

export interface MedicalFormPayload {
  petId: string;
  appointmentId?: string | null;
  /** Si viene definido, el diálogo actualiza en lugar de insertar. */
  record?: MedicalRecordRow | null;
}

function parseLocalYmd(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function toLocalYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Mínimo del datepicker: hoy, o la fecha guardada si ya pasó (edición). */
function minNextVisitFor(record?: MedicalRecordRow | null): Date {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (record?.next_visit_date) {
    const ex = parseLocalYmd(record.next_visit_date);
    ex.setHours(0, 0, 0, 0);
    if (ex.getTime() < today.getTime()) return ex;
  }
  return today;
}

@Component({
  selector: 'app-medical-record-form-dialog',
  styleUrl: './medical-record-form-dialog.scss',
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatDatepickerModule,
    MatNativeDateModule,
  ],
  templateUrl: './medical-record-form-dialog.html',
})
export class MedicalRecordFormDialog {
  private readonly fb = inject(FormBuilder);
  private readonly data = inject(MedicalData);
  private readonly ref = inject(MatDialogRef<MedicalRecordFormDialog, void>);
  protected readonly payload = inject(MAT_DIALOG_DATA) as MedicalFormPayload;

  protected readonly error = signal<string | null>(null);
  protected readonly saving = signal(false);

  protected readonly minNextVisitDate = minNextVisitFor(this.payload.record);

  form = this.fb.nonNullable.group({
    diagnosis: [this.payload.record?.diagnosis ?? ''],
    treatment: [this.payload.record?.treatment ?? ''],
    observations: [this.payload.record?.observations ?? ''],
    weight: [this.payload.record?.weight ?? (null as number | null)],
    next_visit_date: [
      this.payload.record?.next_visit_date
        ? parseLocalYmd(this.payload.record.next_visit_date)
        : (null as Date | null),
    ],
  });

  cancel() {
    this.ref.close();
  }

  async save() {
    this.error.set(null);
    this.saving.set(true);
    try {
      const v = this.form.getRawValue();
      const next =
        v.next_visit_date instanceof Date ? toLocalYmd(v.next_visit_date) : null;
      const body = {
        diagnosis: v.diagnosis || null,
        treatment: v.treatment || null,
        observations: v.observations || null,
        weight: v.weight,
        next_visit_date: next,
      };
      const id = this.payload.record?.id;
      const { error } = id
        ? await this.data.update(id, body)
        : await this.data.insert({
            pet_id: this.payload.petId,
            appointment_id: this.payload.appointmentId ?? null,
            ...body,
          });
      if (error) throw error;
      this.ref.close();
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al guardar');
    } finally {
      this.saving.set(false);
    }
  }
}
