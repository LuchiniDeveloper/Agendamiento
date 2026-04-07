import { Component, inject, signal } from '@angular/core';
import {
  AbstractControl,
  FormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  ValidatorFn,
  Validators,
} from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatSelectModule } from '@angular/material/select';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { CustomersData, type PetRow } from '../customers.data';
import {
  PET_SPECIES_GROUPS,
  PET_SPECIES_OTHER,
  resolveSpeciesPreset,
  speciesFromForm,
} from './pet-species.options';

function speciesGroupValidator(otherToken: string): ValidatorFn {
  return (group: AbstractControl): ValidationErrors | null => {
    const preset = group.get('speciesPreset')?.value as string;
    const other = (group.get('speciesOther')?.value as string)?.trim() ?? '';
    if (preset === otherToken && !other) {
      return { speciesOtherRequired: true };
    }
    return null;
  };
}

export interface PetFormData {
  customerId: string;
  pet?: PetRow;
}

@Component({
  selector: 'app-pet-form-dialog',
  styleUrl: './pet-form-dialog.scss',
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatSelectModule,
    MatDatepickerModule,
    MatNativeDateModule,
  ],
  templateUrl: './pet-form-dialog.html',
})
export class PetFormDialog {
  private readonly fb = inject(FormBuilder);
  private readonly data = inject(CustomersData);
  private readonly ref = inject(MatDialogRef<PetFormDialog, void>);
  protected readonly payload = inject(MAT_DIALOG_DATA) as PetFormData;

  protected readonly error = signal<string | null>(null);
  protected readonly saving = signal(false);

  protected readonly speciesGroups = PET_SPECIES_GROUPS;
  protected readonly speciesOther = PET_SPECIES_OTHER;
  protected readonly genders = [
    { label: 'Macho', value: 'Macho' },
    { label: 'Hembra', value: 'Hembra' },
  ] as const;

  private readonly speciesInit = resolveSpeciesPreset(this.payload.pet?.species);

  form = this.fb.nonNullable.group(
    {
      name: [this.payload.pet?.name ?? '', Validators.required],
      speciesPreset: [this.speciesInit.preset],
      speciesOther: [this.speciesInit.other],
      breed: [this.payload.pet?.breed ?? ''],
      gender: [this.normalizeGender(this.payload.pet?.gender)],
      birth_date: [
        this.payload.pet?.birth_date ? new Date(this.payload.pet.birth_date) : (null as Date | null),
      ],
      weight: [this.payload.pet?.weight ?? (null as number | null)],
      color: [this.payload.pet?.color ?? ''],
      notes: [this.payload.pet?.notes ?? ''],
    },
    { validators: [speciesGroupValidator(PET_SPECIES_OTHER)] },
  );

  private normalizeGender(g: string | null | undefined): string {
    if (!g) return '';
    const t = g.trim();
    if (t === 'Macho' || t === 'Hembra') return t;
    return '';
  }

  cancel() {
    this.ref.close();
  }

  async save() {
    this.form.markAllAsTouched();
    if (this.form.invalid) return;
    this.error.set(null);
    this.saving.set(true);
    try {
      const v = this.form.getRawValue();
      const species = speciesFromForm(v.speciesPreset, v.speciesOther);
      const birth =
        v.birth_date instanceof Date
          ? v.birth_date.toISOString().slice(0, 10)
          : null;
      if (this.payload.pet?.id) {
        const { error } = await this.data.updatePet(this.payload.pet.id, {
          name: v.name,
          species,
          breed: v.breed || null,
          gender: v.gender || null,
          birth_date: birth,
          weight: v.weight,
          color: v.color || null,
          notes: v.notes || null,
        });
        if (error) throw error;
      } else {
        const { error } = await this.data.insertPet({
          customer_id: this.payload.customerId,
          name: v.name,
          species,
          breed: v.breed || null,
          gender: v.gender || null,
          birth_date: birth,
          weight: v.weight,
          color: v.color || null,
          notes: v.notes || null,
        });
        if (error) throw error;
      }
      this.ref.close();
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al guardar');
    } finally {
      this.saving.set(false);
    }
  }
}
