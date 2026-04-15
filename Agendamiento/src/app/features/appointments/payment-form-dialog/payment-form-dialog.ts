import { Component, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { Subscription } from 'rxjs';
import { AppointmentsData } from '../appointments.data';
import { CopCurrencyPipe } from '../../../shared/pipes/cop-currency.pipe';
import { AppointmentExtraChargesDialog } from '../appointment-extra-charges-dialog/appointment-extra-charges-dialog';
import {
  copPriceValidator,
  digitsOnly,
  formatPriceInputLive,
  formatThousandsFromDigits,
  parsePriceToNumber,
  priceToFormattedInput,
} from '../../services-schedule/service-form.helpers';

export interface PaymentBreakdownLine {
  description: string;
  amount: number;
}

export interface PaymentBreakdown {
  serviceLabel: string;
  serviceAmount: number;
  extrasAmount: number;
  extrasLines?: PaymentBreakdownLine[];
}

export interface PaymentPayload {
  appointmentId: string;
  defaultAmount: number;
  breakdown?: PaymentBreakdown;
}

/** Medios típicos de transferencia en Colombia (pago de citas). */
export const TRANSFER_CHANNEL_OPTIONS: { value: string; label: string }[] = [
  { value: 'Nequi', label: 'Nequi' },
  { value: 'DaviPlata', label: 'DaviPlata' },
  { value: 'Bancolombia', label: 'Bancolombia' },
  { value: 'Banco_de_Bogota', label: 'Banco de Bogotá' },
  { value: 'BBVA_Colombia', label: 'BBVA Colombia' },
  { value: 'Banco_Popular', label: 'Banco Popular' },
  { value: 'Scotiabank_Colpatria', label: 'Scotiabank Colpatria' },
  { value: 'Banco_Caja_Social', label: 'Banco Caja Social' },
  { value: 'Banco_Agrario', label: 'Banco Agrario de Colombia' },
  { value: 'Davivienda', label: 'Davivienda' },
  { value: 'Banco_Falabella', label: 'Banco Falabella' },
  { value: 'Bancoomeva', label: 'Bancoomeva' },
  { value: 'Banco_Finandina', label: 'Banco Finandina' },
  { value: 'Banco_Pichincha_CO', label: 'Banco Pichincha (Colombia)' },
  { value: 'Coopcentral', label: 'Coopcentral / cooperativas' },
  { value: 'Otro_banco_CO', label: 'Otro banco en Colombia' },
];

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
    MatIconModule,
    CopCurrencyPipe,
  ],
  templateUrl: './payment-form-dialog.html',
})
export class PaymentFormDialog implements OnInit, OnDestroy {
  private readonly fb = inject(FormBuilder);
  private readonly appts = inject(AppointmentsData);
  private readonly dialog = inject(MatDialog);
  private readonly ref = inject(MatDialogRef<PaymentFormDialog>);
  protected readonly payload = inject(MAT_DIALOG_DATA) as PaymentPayload;

  private sub?: Subscription;

  protected readonly error = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly refreshingBreakdown = signal(false);
  protected readonly transferChannels = TRANSFER_CHANNEL_OPTIONS;
  protected readonly breakdown = signal<PaymentBreakdown | null>(this.payload.breakdown ?? null);
  protected readonly totalToCharge = signal<number>(this.payload.defaultAmount);

  form = this.fb.nonNullable.group({
    amount: ['0', [copPriceValidator]],
    payment_method: ['Cash' as 'Cash' | 'Card' | 'Transfer', Validators.required],
    transfer_channel: [''],
    transfer_proof_code: [''],
  });

  ngOnInit() {
    this.form.patchValue({
      amount: priceToFormattedInput(this.totalToCharge()),
    });
    this.applyTransferValidators(this.form.controls.payment_method.value);
    this.sub = this.form.controls.payment_method.valueChanges.subscribe((m) => {
      this.applyTransferValidators(m);
    });
    if (this.payload.breakdown) {
      void this.refreshBreakdownFromDb();
    }
  }

  ngOnDestroy() {
    this.sub?.unsubscribe();
  }

  private applyTransferValidators(method: 'Cash' | 'Card' | 'Transfer') {
    const ch = this.form.controls.transfer_channel;
    const pr = this.form.controls.transfer_proof_code;
    if (method === 'Transfer') {
      ch.setValidators([Validators.required]);
    } else {
      ch.clearValidators();
      ch.setValue('');
      pr.setValue('');
    }
    ch.updateValueAndValidity({ emitEvent: false });
    pr.updateValueAndValidity({ emitEvent: false });
  }

  protected isTransfer(): boolean {
    return this.form.controls.payment_method.value === 'Transfer';
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

  private applySuggestedAmount(amount: number) {
    this.totalToCharge.set(amount);
    this.form.controls.amount.setValue(priceToFormattedInput(amount), { emitEvent: false });
    this.form.controls.amount.markAsPristine();
  }

  protected async openExtraCharges() {
    this.dialog
      .open(AppointmentExtraChargesDialog, {
        width: 'min(480px, 96vw)',
        maxWidth: '96vw',
        data: { appointmentId: this.payload.appointmentId },
      })
      .afterClosed()
      .subscribe(() => void this.refreshBreakdownFromDb());
  }

  protected async refreshBreakdownFromDb() {
    if (!this.breakdown()) return;
    this.refreshingBreakdown.set(true);
    this.error.set(null);
    try {
      const { data: rows, error } = await this.appts.listExtraCharges(this.payload.appointmentId);
      if (error) throw error;
      const extrasLines: PaymentBreakdownLine[] = (rows ?? []).map((r) => ({
        description: String((r as { description?: string }).description ?? ''),
        amount: Number((r as { amount?: unknown }).amount ?? 0),
      }));
      const base = this.breakdown()!;
      const extrasAmount = extrasLines.reduce((sum, line) => sum + line.amount, 0);
      const next: PaymentBreakdown = {
        serviceLabel: base.serviceLabel,
        serviceAmount: Number(base.serviceAmount ?? 0),
        extrasAmount,
        extrasLines: extrasLines.length ? extrasLines : undefined,
      };
      this.breakdown.set(next);
      this.applySuggestedAmount(next.serviceAmount + next.extrasAmount);
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'No se pudo actualizar la factura.');
    } finally {
      this.refreshingBreakdown.set(false);
    }
  }

  async save() {
    this.error.set(null);
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.error.set('Revisá los campos marcados (monto, método y datos de transferencia).');
      return;
    }
    this.saving.set(true);
    try {
      const v = this.form.getRawValue();
      const amount = parsePriceToNumber(v.amount);
      if (Number.isNaN(amount) || amount < 0) {
        this.error.set('Monto inválido');
        return;
      }
      const method = v.payment_method;
      const transfer =
        method === 'Transfer'
          ? {
              channel: v.transfer_channel?.trim() || '',
              proofCode: v.transfer_proof_code?.trim() || null,
            }
          : undefined;
      if (method === 'Transfer' && !transfer?.channel) {
        this.error.set('Elegí el medio de transferencia (Nequi, banco, etc.).');
        return;
      }
      const { error } = await this.appts.insertPayment(this.payload.appointmentId, amount, method, transfer);
      if (error) throw error;
      this.ref.close(true);
    } catch (e: unknown) {
      const msg =
        e && typeof e === 'object' && 'message' in e
          ? String((e as { message?: string }).message)
          : e instanceof Error
            ? e.message
            : 'Error al guardar el pago';
      this.error.set(msg);
    } finally {
      this.saving.set(false);
    }
  }
}
