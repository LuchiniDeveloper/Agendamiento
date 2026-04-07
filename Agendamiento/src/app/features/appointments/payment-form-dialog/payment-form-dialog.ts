import { Component, inject, OnInit, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { AppointmentsData } from '../appointments.data';
import {
  copPriceValidator,
  digitsOnly,
  formatPriceInputLive,
  formatThousandsFromDigits,
  parsePriceToNumber,
  priceToFormattedInput,
} from '../../services-schedule/service-form.helpers';

export interface PaymentPayload {
  appointmentId: string;
  defaultAmount: number;
}

@Component({
  selector: 'app-payment-form-dialog',
  styleUrl: './payment-form-dialog.scss',
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
  ],
  templateUrl: './payment-form-dialog.html',
})
export class PaymentFormDialog implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly appts = inject(AppointmentsData);
  private readonly ref = inject(MatDialogRef<PaymentFormDialog>);
  private readonly payload = inject(MAT_DIALOG_DATA) as PaymentPayload;

  protected readonly error = signal<string | null>(null);
  protected readonly saving = signal(false);

  form = this.fb.nonNullable.group({
    amount: ['0', [copPriceValidator]],
    payment_method: ['Cash' as 'Cash' | 'Card' | 'Transfer', Validators.required],
  });

  ngOnInit() {
    this.form.patchValue({
      amount: priceToFormattedInput(this.payload.defaultAmount),
    });
  }

  onAmountFocus(): void {
    const c = this.form.controls.amount;
    c.setValue(digitsOnly(c.value), { emitEvent: false });
    c.updateValueAndValidity();
  }

  onAmountInput(): void {
    const c = this.form.controls.amount;
    c.setValue(formatPriceInputLive(c.value), { emitEvent: false });
    c.updateValueAndValidity();
  }

  onAmountBlur(): void {
    const c = this.form.controls.amount;
    const n = parsePriceToNumber(c.value);
    if (!Number.isNaN(n) && n >= 0) {
      c.setValue(formatThousandsFromDigits(String(n)), { emitEvent: false });
    }
    c.updateValueAndValidity();
  }

  cancel() {
    this.ref.close();
  }

  async save() {
    if (this.form.invalid) return;
    this.error.set(null);
    this.saving.set(true);
    try {
      const v = this.form.getRawValue();
      const amount = parsePriceToNumber(v.amount);
      if (Number.isNaN(amount) || amount < 0) {
        this.error.set('Monto inválido');
        return;
      }
      const { error } = await this.appts.insertPayment(this.payload.appointmentId, amount, v.payment_method);
      if (error) throw error;
      this.ref.close(true);
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error');
    } finally {
      this.saving.set(false);
    }
  }
}
