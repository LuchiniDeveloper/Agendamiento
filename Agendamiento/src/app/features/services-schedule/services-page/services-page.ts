import { NgClass } from '@angular/common';
import { Component, inject, OnInit, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatSelectModule } from '@angular/material/select';
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
import { ScheduleEditDialog } from '../schedule-edit-dialog/schedule-edit-dialog';
import {
  ServicesData,
  staffRowsForScheduling,
  type ScheduleRow,
  type ServiceRow,
  type StaffMini,
} from '../services.data';

const DAYS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

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
    MatSelectModule,
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

  protected readonly loading = signal(true);
  protected readonly services = signal<ServiceRow[]>([]);
  protected readonly staff = signal<StaffMini[]>([]);
  protected readonly schedules = signal<ScheduleRow[]>([]);
  protected readonly selectedVetId = signal<string | null>(null);
  protected readonly togglingServiceId = signal<string | null>(null);
  protected readonly days = DAYS;

  svcForm = this.fb.nonNullable.group({
    name: ['', Validators.required],
    duration_minutes: [30, [Validators.required, Validators.min(5)]],
    price: ['0', [copPriceValidator]],
    description: ['', Validators.maxLength(DESC_MAX)],
  });

  async ngOnInit() {
    await this.reloadServices();
    const { data: s } = await this.data.listStaff();
    const vets = staffRowsForScheduling(s);
    this.staff.set(vets);
    const first = vets[0];
    if (first) {
      this.selectedVetId.set(first.id);
      await this.loadSchedule(first.id);
    }
    this.loading.set(false);
  }

  async reloadServices() {
    const { data, error } = await this.data.listServices();
    if (!error) this.services.set((data ?? []) as ServiceRow[]);
  }

  async loadSchedule(userId: string) {
    const { data, error } = await this.data.listSchedule(userId);
    if (!error) this.schedules.set((data ?? []) as ScheduleRow[]);
  }

  async onVetChange(id: string) {
    this.selectedVetId.set(id);
    await this.loadSchedule(id);
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

  scheduleServiceLabel(serviceId: string | null): string {
    if (!serviceId) return 'Cualquiera';
    return this.services().find((s) => s.id === serviceId)?.name ?? '—';
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
    this.svcForm.reset({
      name: '',
      duration_minutes: 30,
      price: '0',
      description: '',
    });
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

  /** `active` debe ser explícitamente true o false (p. ej. desde el slide o al invertir con el chip). */
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

  openScheduleDialog(row: ScheduleRow | null = null) {
    const uid = this.selectedVetId();
    if (!uid) return;
    this.dialog
      .open(ScheduleEditDialog, {
        width: 'min(520px, 100vw)',
        data: {
          row,
          services: this.services(),
          existing: this.schedules(),
          userId: uid,
        },
      })
      .afterClosed()
      .subscribe((saved) => {
        if (saved) void this.loadSchedule(uid);
      });
  }

  async removeSchedule(id: string) {
    const uid = this.selectedVetId();
    const { error } = await this.data.deleteSchedule(id);
    if (!error && uid) await this.loadSchedule(uid);
  }
}
