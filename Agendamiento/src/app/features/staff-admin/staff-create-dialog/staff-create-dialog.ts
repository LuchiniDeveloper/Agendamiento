import { Component, inject, signal } from '@angular/core';
import {
  AbstractControl,
  FormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { StaffData, type RoleRow } from '../staff.data';

export interface StaffCreateDialogData {
  roles: RoleRow[];
  /** Nombre de la veterinaria (siempre string; nunca undefined). */
  clinicName: string;
}

function passwordsMatch(group: AbstractControl): ValidationErrors | null {
  const p = group.get('password')?.value as string | undefined;
  const c = group.get('passwordConfirm')?.value as string | undefined;
  if (p === undefined || c === undefined) return null;
  if (p !== c) return { passwordMismatch: true };
  return null;
}

@Component({
  selector: 'app-staff-create-dialog',
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatSelectModule,
  ],
  templateUrl: './staff-create-dialog.html',
  styleUrl: './staff-create-dialog.scss',
})
export class StaffCreateDialog {
  private readonly fb = inject(FormBuilder);
  private readonly api = inject(StaffData);
  protected readonly ref = inject(MatDialogRef<StaffCreateDialog, boolean>);
  protected readonly dlgData = inject(MAT_DIALOG_DATA) as StaffCreateDialogData;

  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  readonly minPassword = 6;

  form = this.fb.nonNullable.group(
    {
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.minLength(this.minPassword)]],
      passwordConfirm: ['', Validators.required],
      name: ['', Validators.required],
      role_id: [null as number | null, Validators.required],
      phone: [''],
    },
    { validators: [passwordsMatch] },
  );

  cancel() {
    this.ref.close(false);
  }

  async submit() {
    this.error.set(null);
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();
    if (v.role_id === null) return;
    this.saving.set(true);
    try {
      const res = await this.api.createStaffMember({
        email: v.email.trim().toLowerCase(),
        password: v.password,
        name: v.name.trim(),
        role_id: v.role_id,
        phone: v.phone.trim() || null,
      });
      if (!res.ok) {
        this.error.set(res.message);
        return;
      }
      this.ref.close(true);
    } finally {
      this.saving.set(false);
    }
  }
}
