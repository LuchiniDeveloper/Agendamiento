import { Component, inject, OnInit, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { AppointmentsData } from '../appointments.data';
import {
  copPriceValidator,
  formatPriceInputLive,
  parsePriceToNumber,
  priceToFormattedInput,
} from '../../services-schedule/service-form.helpers';
import { CopCurrencyPipe } from '../../../shared/pipes/cop-currency.pipe';

export interface AppointmentExtraChargesDialogData {
  appointmentId: string;
}

type ChargeRow = { id: string; description: string; amount: number };

@Component({
  selector: 'app-appointment-extra-charges-dialog',
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    CopCurrencyPipe,
  ],
  templateUrl: './appointment-extra-charges-dialog.html',
  styleUrl: './appointment-extra-charges-dialog.scss',
})
export class AppointmentExtraChargesDialog implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly appts = inject(AppointmentsData);
  private readonly ref = inject(MatDialogRef<AppointmentExtraChargesDialog>);
  private readonly snack = inject(MatSnackBar);
  protected readonly data = inject(MAT_DIALOG_DATA) as AppointmentExtraChargesDialogData;

  protected readonly loading = signal(false);
  protected readonly adding = signal(false);
  protected readonly rows = signal<ChargeRow[]>([]);

  newLine = this.fb.nonNullable.group({
    description: ['', [Validators.required, Validators.maxLength(200)]],
    amount: ['0', [copPriceValidator]],
  });

  ngOnInit(): void {
    void this.reload();
  }

  protected extrasTotal(): number {
    return this.rows().reduce((s, r) => s + Number(r.amount), 0);
  }

  private async reload() {
    this.loading.set(true);
    try {
      const { data, error } = await this.appts.listExtraCharges(this.data.appointmentId);
      if (error) throw error;
      this.rows.set(
        (data ?? []).map((r) => ({
          id: r.id as string,
          description: String(r.description ?? ''),
          amount: Number(r.amount ?? 0),
        })),
      );
    } catch (e: unknown) {
      this.snack.open(e instanceof Error ? e.message : 'No se pudieron cargar los cargos', 'OK', {
        duration: 4000,
      });
    } finally {
      this.loading.set(false);
    }
  }

  protected onNewAmountInput() {
    const c = this.newLine.controls.amount;
    c.setValue(formatPriceInputLive(c.value), { emitEvent: false });
  }

  protected async addLine() {
    this.newLine.markAllAsTouched();
    if (this.newLine.invalid) return;
    const v = this.newLine.getRawValue();
    const amount = parsePriceToNumber(v.amount);
    if (Number.isNaN(amount) || amount < 0) return;
    this.adding.set(true);
    try {
      const { error } = await this.appts.insertExtraCharge(this.data.appointmentId, v.description.trim(), amount);
      if (error) throw error;
      this.newLine.reset({ description: '', amount: priceToFormattedInput(0) });
      await this.reload();
    } catch (e: unknown) {
      this.snack.open(e instanceof Error ? e.message : 'No se pudo agregar', 'OK', { duration: 4000 });
    } finally {
      this.adding.set(false);
    }
  }

  protected async removeRow(id: string) {
    try {
      const { error } = await this.appts.deleteExtraCharge(id);
      if (error) throw error;
      await this.reload();
    } catch (e: unknown) {
      this.snack.open(e instanceof Error ? e.message : 'No se pudo eliminar', 'OK', { duration: 4000 });
    }
  }

  protected close() {
    this.ref.close(true);
  }
}
