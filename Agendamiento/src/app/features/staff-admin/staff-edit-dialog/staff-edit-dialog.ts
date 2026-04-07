import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { TenantContextService } from '../../../core/tenant-context.service';
import { StaffData, type RoleRow, type StaffDirectoryRow } from '../staff.data';

export interface StaffEditDialogData {
  staff: StaffDirectoryRow;
  /** Veterinario y Recepcionista (Admin no se asigna desde la app). */
  roles: RoleRow[];
}

@Component({
  selector: 'app-staff-edit-dialog',
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatProgressSpinnerModule,
    MatSelectModule,
  ],
  templateUrl: './staff-edit-dialog.html',
  styleUrl: './staff-edit-dialog.scss',
})
export class StaffEditDialog implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly api = inject(StaffData);
  private readonly tenant = inject(TenantContextService);
  protected readonly ref = inject(MatDialogRef<StaffEditDialog, boolean>);
  protected readonly dlgData = inject(MAT_DIALOG_DATA) as StaffEditDialogData;

  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  /** Solo administradores pueden asignar nueva contraseña al editar. */
  protected readonly canChangePassword = computed(() => this.tenant.isAdmin());
  protected readonly minPassword = 6;

  form = this.fb.nonNullable.group({
    name: ['', Validators.required],
    role_id: [null as number | null, Validators.required],
    phone: [''],
    password_new: [''],
    password_confirm: [''],
  });

  ngOnInit() {
    const s = this.dlgData.staff;
    this.form.patchValue({
      name: s.name,
      role_id: s.role_id,
      phone: s.phone ?? '',
    });
    if (s.role?.name === 'Admin') {
      this.form.controls.role_id.clearValidators();
      this.form.controls.role_id.disable({ emitEvent: false });
    }
  }

  protected staffIsAdmin(): boolean {
    return this.dlgData.staff.role?.name === 'Admin';
  }

  cancel() {
    this.ref.close(false);
  }

  async save() {
    this.error.set(null);
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();
    if (!this.staffIsAdmin() && v.role_id === null) return;

    if (this.canChangePassword()) {
      const pn = v.password_new.trim();
      const pc = v.password_confirm.trim();
      if (pn || pc) {
        if (pn.length < this.minPassword) {
          this.error.set(`La nueva contraseña debe tener al menos ${this.minPassword} caracteres.`);
          return;
        }
        if (pn !== pc) {
          this.error.set('Las contraseñas no coinciden.');
          return;
        }
      }
    }

    this.saving.set(true);
    try {
      if (this.canChangePassword()) {
        const pn = v.password_new.trim();
        if (pn) {
          const pwdRes = await this.api.updateStaffPassword(this.dlgData.staff.id, pn);
          if (!pwdRes.ok) {
            this.error.set(pwdRes.message);
            return;
          }
        }
      }
      const payload = this.staffIsAdmin()
        ? { name: v.name.trim(), phone: v.phone.trim() || null }
        : {
            name: v.name.trim(),
            role_id: v.role_id as number,
            phone: v.phone.trim() || null,
          };
      const { error } = await this.api.updateStaff(this.dlgData.staff.id, payload);
      if (error) {
        this.error.set(
          (error as { message?: string }).message?.trim() || 'No se pudo guardar.',
        );
        return;
      }
      this.ref.close(true);
    } finally {
      this.saving.set(false);
    }
  }
}
