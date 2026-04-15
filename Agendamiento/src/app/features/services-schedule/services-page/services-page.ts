import { NgClass } from '@angular/common';
import { Component, inject, OnInit, signal, ViewChild } from '@angular/core';
import { FormBuilder, FormGroupDirective, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSlideToggleChange, MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { CopCurrencyPipe } from '../../../shared/pipes/cop-currency.pipe';
import {
  DESC_MAX,
  copPriceValidator,
  descCounterTone,
  digitsOnly,
  formatPriceInputLive,
  formatThousandsFromDigits,
  parsePriceToNumber,
} from '../service-form.helpers';
import { ServiceDeleteDialog } from '../service-delete-dialog/service-delete-dialog';
import { ServiceEditDialog } from '../service-edit-dialog/service-edit-dialog';
import { ServicesData, type ServiceRow } from '../services.data';

function deleteServiceMessage(err: { code?: string; message?: string }): string {
  if (err.code === '23503') {
    return 'No se puede eliminar: hay citas u otros registros vinculados. Puedes inactivar el servicio.';
  }
  return err.message?.trim() || 'No se pudo eliminar el servicio.';
}

@Component({
  selector: 'app-services-page',
  imports: [
    NgClass,
    ReactiveFormsModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatSlideToggleModule,
    MatTooltipModule,
    MatSnackBarModule,
    CopCurrencyPipe,
  ],
  templateUrl: './services-page.html',
  styleUrl: './services-page.scss',
})
export class ServicesPage implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly data = inject(ServicesData);
  private readonly dialog = inject(MatDialog);
  private readonly snack = inject(MatSnackBar);

  @ViewChild(FormGroupDirective) private svcFormDirective?: FormGroupDirective;

  protected readonly loading = signal(true);
  protected readonly services = signal<ServiceRow[]>([]);
  protected readonly togglingServiceId = signal<string | null>(null);

  svcForm = this.fb.nonNullable.group({
    name: ['', Validators.required],
    duration_minutes: [30, [Validators.required, Validators.min(5)]],
    price: ['0', [copPriceValidator]],
    description: ['', Validators.maxLength(DESC_MAX)],
  });

  async ngOnInit() {
    await this.reloadServices();
    this.loading.set(false);
  }

  async reloadServices() {
    const { data, error } = await this.data.listServices();
    if (!error) this.services.set((data ?? []) as ServiceRow[]);
  }

  protected readonly descMax = DESC_MAX;
  protected readonly descCounterTone = descCounterTone;

  protected previewDesc(text: string | null, max = 80): string {
    if (!text) return '';
    const t = text.trim();
    if (t.length <= max) return t;
    return `${t.slice(0, max)}…`;
  }

  onPriceFocus(): void {
    const c = this.svcForm.controls.price;
    c.setValue(digitsOnly(c.value), { emitEvent: false });
    c.updateValueAndValidity();
  }

  onPriceBlur(): void {
    const c = this.svcForm.controls.price;
    const n = parsePriceToNumber(c.value);
    if (!Number.isNaN(n) && n >= 0) {
      c.setValue(formatThousandsFromDigits(n.toString()), { emitEvent: false });
    }
    c.updateValueAndValidity();
  }

  onSvcPriceInput(): void {
    const c = this.svcForm.controls.price;
    c.setValue(formatPriceInputLive(c.value), { emitEvent: false });
    c.updateValueAndValidity();
  }

  async addService() {
    this.onPriceBlur();
    if (this.svcForm.invalid) return;
    const v = this.svcForm.getRawValue();
    const priceNum = parsePriceToNumber(v.price);
    const { error } = await this.data.insertService({
      name: v.name,
      duration_minutes: Number(v.duration_minutes),
      price: priceNum,
      description: v.description.trim() || null,
      active: true,
    });
    if (error) {
      this.snack.open('No se pudo crear el servicio', 'OK', { duration: 4000 });
      return;
    }
    const empty = {
      name: '',
      duration_minutes: 30,
      price: '0',
      description: '',
    };
    if (this.svcFormDirective) {
      this.svcFormDirective.resetForm(empty);
    } else {
      this.svcForm.reset(empty);
    }
    this.snack.open('Servicio creado', 'OK', { duration: 2500 });
    await this.reloadServices();
  }

  openEdit(s: ServiceRow) {
    this.dialog
      .open(ServiceEditDialog, {
        width: 'min(540px, 100vw)',
        maxHeight: '90vh',
        autoFocus: 'first-tabbable',
        data: { service: s },
      })
      .afterClosed()
      .subscribe((saved) => {
        if (saved) {
          this.snack.open('Cambios guardados', 'OK', { duration: 2500 });
          void this.reloadServices();
        }
      });
  }

  openDelete(s: ServiceRow) {
    this.dialog
      .open(ServiceDeleteDialog, {
        width: 'min(440px, 100vw)',
        autoFocus: 'dialog',
        data: { service: s },
      })
      .afterClosed()
      .subscribe(async (confirm) => {
        if (!confirm) return;
        const { error } = await this.data.deleteService(s.id);
        if (error) {
          this.snack.open(deleteServiceMessage(error), 'OK', { duration: 6000 });
          return;
        }
        this.snack.open('Servicio eliminado', 'OK', { duration: 2500 });
        await this.reloadServices();
      });
  }

  async toggleActive(s: ServiceRow, active: boolean) {
    if (typeof active !== 'boolean') return;
    const nextActive = active;
    const currentActive = !!s.active;
    if (currentActive === nextActive) return;

    this.togglingServiceId.set(s.id);
    const { data, error } = await this.data.updateService(s.id, { active: nextActive });
    this.togglingServiceId.set(null);

    if (error || !data || !!data.active !== nextActive) {
      this.snack.open('No se pudo actualizar el estado', 'OK', { duration: 4000 });
      await this.reloadServices();
      return;
    }

    this.services.update((list) =>
      list.map((x) => (x.id === s.id ? { ...x, active: nextActive } : x)),
    );
    this.snack.open(nextActive ? 'Servicio activado' : 'Servicio inactivado', 'OK', { duration: 2200 });
  }

  onSlideToggleChange(s: ServiceRow, ev: MatSlideToggleChange) {
    void this.toggleActive(s, ev.checked);
  }

  onStatusPillClick(s: ServiceRow) {
    void this.toggleActive(s, !s.active);
  }
}
