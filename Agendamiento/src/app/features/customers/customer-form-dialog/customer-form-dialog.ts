import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { CustomersData, type CustomerRow } from '../customers.data';

@Component({
  selector: 'app-customer-form-dialog',
  styleUrl: './customer-form-dialog.scss',
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
  ],
  templateUrl: './customer-form-dialog.html',
})
export class CustomerFormDialog {
  private readonly fb = inject(FormBuilder);
  private readonly data = inject(CustomersData);
  private readonly ref = inject(MatDialogRef<CustomerFormDialog, string | undefined>);
  protected readonly existing = inject(MAT_DIALOG_DATA, { optional: true }) as CustomerRow | null;

  protected readonly error = signal<string | null>(null);
  protected readonly saving = signal(false);

  form = this.fb.nonNullable.group({
    name: [this.existing?.name ?? '', Validators.required],
    phone: [this.existing?.phone ?? ''],
    email: [this.existing?.email ?? ''],
    address: [this.existing?.address ?? ''],
    notes: [this.existing?.notes ?? ''],
  });

  cancel() {
    this.ref.close();
  }

  async save() {
    if (this.form.invalid) return;
    this.error.set(null);
    this.saving.set(true);
    try {
      const v = this.form.getRawValue();
      if (this.existing?.id) {
        const { error } = await this.data.update(this.existing.id, v);
        if (error) throw error;
        this.ref.close(this.existing.id);
      } else {
        const { data, error } = await this.data.insert(v);
        if (error) throw error;
        this.ref.close(data?.id as string);
      }
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al guardar');
    } finally {
      this.saving.set(false);
    }
  }
}
