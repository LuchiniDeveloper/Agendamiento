import { NgClass } from '@angular/common';
import { Component, inject, OnInit, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import {
  DESC_MAX,
  copPriceValidator,
  descCounterTone,
  digitsOnly,
  formatThousandsFromDigits,
  formatPriceInputLive,
  parsePriceToNumber,
  priceToFormattedInput,
} from '../service-form.helpers';
import { ServicesData, type ServiceRow } from '../services.data';

export interface ServiceEditDialogData {
  service: ServiceRow;
}

@Component({
  selector: 'app-service-edit-dialog',
  imports: [
    NgClass,
    ReactiveFormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
  ],
  templateUrl: './service-edit-dialog.html',
  styleUrl: './service-edit-dialog.scss',
})
export class ServiceEditDialog implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly api = inject(ServicesData);
  protected readonly ref = inject(MatDialogRef<ServiceEditDialog, boolean>);
  protected readonly dlgData = inject(MAT_DIALOG_DATA) as ServiceEditDialogData;

  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly descMax = DESC_MAX;
  protected readonly descCounterTone = descCounterTone;

  form = this.fb.nonNullable.group({
    name: ['', Validators.required],
    duration_minutes: [30, [Validators.required, Validators.min(5)]],
    price: ['0', [copPriceValidator]],
    description: ['', Validators.maxLength(DESC_MAX)],
  });

  ngOnInit() {
    const s = this.dlgData.service;
    this.form.patchValue({
      name: s.name,
      duration_minutes: s.duration_minutes,
      price: priceToFormattedInput(s.price),
      description: s.description ?? '',
    });
  }

  onPriceFocus(): void {
    const c = this.form.controls.price;
    c.setValue(digitsOnly(c.value), { emitEvent: false });
    c.updateValueAndValidity();
  }

  onPriceInput(): void {
    const c = this.form.controls.price;
    c.setValue(formatPriceInputLive(c.value), { emitEvent: false });
    c.updateValueAndValidity();
  }

  onPriceBlur(): void {
    const c = this.form.controls.price;
    const n = parsePriceToNumber(c.value);
    if (!Number.isNaN(n) && n >= 0) {
      c.setValue(formatThousandsFromDigits(n.toString()), { emitEvent: false });
    }
    c.updateValueAndValidity();
  }

  cancel() {
    this.ref.close(false);
  }

  async save() {
    this.onPriceBlur();
    this.error.set(null);
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.saving.set(true);
    try {
      const v = this.form.getRawValue();
      const { error } = await this.api.updateService(this.dlgData.service.id, {
        name: v.name,
        duration_minutes: Number(v.duration_minutes),
        price: parsePriceToNumber(v.price),
        description: v.description.trim() || null,
      });
      if (error) {
        this.error.set(
          (error as { message?: string }).message?.trim() || 'No se pudo guardar los cambios.',
        );
        return;
      }
      this.ref.close(true);
    } finally {
      this.saving.set(false);
    }
  }
}
