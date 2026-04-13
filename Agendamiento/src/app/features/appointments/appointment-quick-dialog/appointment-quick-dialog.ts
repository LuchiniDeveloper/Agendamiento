import { Component, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { AGENDA_DEFAULT_TZ, AppointmentsData } from '../appointments.data';
import { MedicalData } from '../../medical-records/medical.data';
import { MedicalRecordFormDialog } from '../../medical-records/medical-record-form-dialog/medical-record-form-dialog';
import { PaymentFormDialog, type PaymentBreakdown } from '../payment-form-dialog/payment-form-dialog';
import { AppointmentExtraChargesDialog } from '../appointment-extra-charges-dialog/appointment-extra-charges-dialog';
import { TenantContextService } from '../../../core/tenant-context.service';
import { AppointmentEmailNotificationsPanel } from '../../email-notifications/appointment-email-notifications-panel/appointment-email-notifications-panel';
import { petAvatarFromSpecies } from '../../customers/pet-avatar.util';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

function isoToTimeInput(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Fecha calendario local YYYY-MM-DD desde un instante ISO. */
function localCalendarDateStringFromIso(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Usa el día calendario de `isoDate` y la hora de `hhmm` (HH:mm). */
function combineDateWithTime(isoDate: string, hhmm: string): Date {
  const base = new Date(isoDate);
  const parts = hhmm.split(':').map((x) => parseInt(x, 10));
  const h = parts[0] ?? 0;
  const mi = parts[1] ?? 0;
  return new Date(base.getFullYear(), base.getMonth(), base.getDate(), h, mi, 0, 0);
}

/** Citas que se pueden borrar de la agenda; nunca Completada (visita ya cerrada). */
const DELETABLE_STATUSES = new Set(['Agendada', 'Confirmada', 'Cancelada', 'NoShow']);

export interface QuickApptPayload {
  id: string;
  /** Veterinario asignado (solapes) */
  userId: string;
  /** Nombre del veterinario de la cita */
  vetName: string;
  petId: string;
  /** Cliente dueño (ficha en /app/customers/:id) */
  customerId: string;
  customerPhone: string | null;
  customerName: string;
  petName: string;
  /** Especie (texto libre o catálogo) para icono en el detalle. */
  petSpecies: string | null;
  serviceId: string;
  /** Nombre del servicio de la cita */
  serviceName: string;
  serviceDurationMinutes: number;
  servicePrice: number;
  /** Inicio de atención en consultorio (ISO); null si no aplica. */
  attentionStartedAt: string | null;
  statusId: number;
  statusName: string;
  statuses: { id: number; name: string }[];
  businessPhone: string | null;
  businessAddress: string | null;
  businessName: string;
  startLabel: string;
  endLabel: string;
  startIso: string;
  endIso: string;
}

@Component({
  selector: 'app-appointment-quick-dialog',
  styleUrl: './appointment-quick-dialog.scss',
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatSelectModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    MatSnackBarModule,
    MatProgressSpinnerModule,
    AppointmentEmailNotificationsPanel,
  ],
  templateUrl: './appointment-quick-dialog.html',
})
export class AppointmentQuickDialog implements OnInit, OnDestroy {
  private readonly fb = inject(FormBuilder);
  private readonly appts = inject(AppointmentsData);
  private readonly medical = inject(MedicalData);
  private readonly ref = inject(MatDialogRef<AppointmentQuickDialog>);
  protected readonly data = inject(MAT_DIALOG_DATA) as QuickApptPayload;
  private readonly dialog = inject(MatDialog);
  private readonly snack = inject(MatSnackBar);
  private readonly router = inject(Router);
  protected readonly tenant = inject(TenantContextService);

  protected readonly saving = signal(false);
  protected readonly deleting = signal(false);
  protected readonly slotsLoading = signal(false);
  protected readonly slotsError = signal<string | null>(null);
  protected readonly slotOptions = signal<string[]>([]);
  /** Hay nota clínica con esta cita (solo UI; el texto no se muestra en el diálogo). */
  protected readonly hasLinkedClinicalNote = signal(false);

  protected readonly attentionStartedAt = signal<string | null>(this.data.attentionStartedAt ?? null);
  protected readonly attentionBusy = signal(false);
  private readonly clockTick = signal(0);
  private timerId: ReturnType<typeof setInterval> | null = null;

  protected petAvatar() {
    return petAvatarFromSpecies(this.data.petSpecies);
  }

  form = this.fb.nonNullable.group({
    status_id: [this.data.statusId],
    start_slot: [''],
  });

  ngOnInit() {
    this.form.patchValue({ status_id: this.data.statusId });
    void this.loadLinkedClinicalNote();
    void this.refreshSlots();
    this.maybeStartClock();
  }

  ngOnDestroy() {
    this.stopClock();
  }

  private maybeStartClock() {
    this.stopClock();
    if (!this.inAttention()) return;
    this.timerId = setInterval(() => this.clockTick.update((n) => n + 1), 1000);
  }

  private stopClock() {
    if (this.timerId != null) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
  }

  /** Atención en curso según BD + estado guardado de la cita. */
  protected inAttention(): boolean {
    if (this.attentionStartedAt() == null) return false;
    const n = this.data.statusName;
    return n !== 'Completada' && n !== 'Cancelada' && n !== 'NoShow';
  }

  protected canStartAttention(): boolean {
    if (this.attentionStartedAt() != null) return false;
    return this.data.statusName === 'Agendada' || this.data.statusName === 'Confirmada';
  }

  protected attentionTone(): 'ok' | 'warn' | 'over' {
    const iso = this.attentionStartedAt();
    if (!iso || !this.inAttention()) return 'ok';
    this.clockTick();
    const elapsedMin = (Date.now() - new Date(iso).getTime()) / 60_000;
    const expected = Math.max(1, this.data.serviceDurationMinutes || 30);
    if (elapsedMin > expected) return 'over';
    if (elapsedMin > expected * 0.8) return 'warn';
    return 'ok';
  }

  protected attentionElapsedLabel(): string {
    const iso = this.attentionStartedAt();
    if (!iso) return '—';
    this.clockTick();
    const ms = Math.max(0, Date.now() - new Date(iso).getTime());
    const totalMin = Math.floor(ms / 60_000);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    if (h > 0) return `${h} h ${m} min`;
    return `${m} min`;
  }

  protected attentionHint(): string {
    switch (this.attentionTone()) {
      case 'ok':
        return 'Dentro del tiempo agendado.';
      case 'warn':
        return 'Cerca del fin del tiempo previsto.';
      case 'over':
        return 'Superó la duración agendada del servicio.';
    }
  }

  protected async startAttention() {
    if (!this.canStartAttention()) return;
    this.attentionBusy.set(true);
    try {
      const iso = new Date().toISOString();
      const { error } = await this.appts.updateAttentionStartedAt(this.data.id, iso);
      if (error) throw error;
      this.attentionStartedAt.set(iso);
      this.maybeStartClock();
      this.snack.open('Atención iniciada', 'OK', { duration: 2200 });
    } catch (e: unknown) {
      this.snack.open(e instanceof Error ? e.message : 'No se pudo iniciar la atención', 'OK', {
        duration: 4000,
      });
    } finally {
      this.attentionBusy.set(false);
    }
  }

  protected async clearAttention() {
    if (!this.inAttention()) return;
    const { data: rows, error: e1 } = await this.appts.listExtraCharges(this.data.id);
    if (e1) {
      this.snack.open(e1.message, 'OK', { duration: 4000 });
      return;
    }
    const hasExtras = (rows?.length ?? 0) > 0;
    const msg = hasExtras
      ? '¿Descartar atención? El cronómetro se detiene; los gastos adicionales ya cargados se mantienen.'
      : '¿Descartar el cronómetro de atención?';
    if (!confirm(msg)) return;
    this.attentionBusy.set(true);
    try {
      const { error } = await this.appts.updateAttentionStartedAt(this.data.id, null);
      if (error) throw error;
      this.stopClock();
      this.attentionStartedAt.set(null);
      this.snack.open('Atención descartada', 'OK', { duration: 2200 });
    } catch (e: unknown) {
      this.snack.open(e instanceof Error ? e.message : 'No se pudo actualizar', 'OK', { duration: 4000 });
    } finally {
      this.attentionBusy.set(false);
    }
  }

  protected openExtras() {
    if (!this.inAttention()) return;
    this.dialog
      .open(AppointmentExtraChargesDialog, {
        width: 'min(480px, 96vw)',
        maxWidth: '96vw',
        data: { appointmentId: this.data.id },
      })
      .afterClosed()
      .subscribe(() => undefined);
  }

  onStatusChange() {
    void this.refreshSlots();
  }

  private async loadLinkedClinicalNote() {
    try {
      const { data, error } = await this.medical.getByAppointmentId(this.data.id);
      if (error) throw error;
      this.hasLinkedClinicalNote.set(!!data);
    } catch {
      this.hasLinkedClinicalNote.set(false);
    }
  }

  /** Ir a la ficha del cliente y enfocar la mascota (historia clínica). */
  goToPetClinicalHistory() {
    const cid = this.data.customerId;
    const pid = this.data.petId;
    if (!cid || !pid) {
      this.snack.open('No se puede abrir la ficha del cliente.', 'OK', { duration: 3500 });
      return;
    }
    this.ref.close(false);
    void this.router.navigate(['/app/customers', cid], { queryParams: { pet: pid } });
  }

  protected canEditSchedule(): boolean {
    const sid = this.form.getRawValue().status_id;
    return this.data.statuses.find((s) => s.id === sid)?.name === 'Agendada';
  }

  /** Cliente con dígitos de teléfono (solo pista visual; el chat se abre igual). */
  protected hasCustomerPhone(): boolean {
    return (this.data.customerPhone ?? '').replace(/\D/g, '').length > 0;
  }

  /** Ir al módulo Chat con el día de la cita y la fila enfocada (plantillas disponibles allí). */
  protected onWhatsAppClick() {
    const day = localCalendarDateStringFromIso(this.data.startIso);
    this.ref.close(false);
    void this.router.navigate(['/app/reminders'], {
      queryParams: { day, appointmentId: this.data.id },
    });
  }

  /** Solo si el estado del formulario difiere del guardado en base de datos. */
  protected showSaveStatusButton(): boolean {
    return this.form.getRawValue().status_id !== this.data.statusId;
  }

  /**
   * Quitar de la agenda: visible para Agendada / Confirmada / Cancelada / NoShow.
   * No se ofrece eliminar si el estado es Completada (cita ya atendida).
   */
  protected canDeleteAppointment(): boolean {
    const sid = this.form.getRawValue().status_id;
    const name = this.data.statuses.find((s) => s.id === sid)?.name ?? '';
    if (name === 'Completada') return false;
    return DELETABLE_STATUSES.has(name);
  }

  async refreshSlots() {
    if (!this.canEditSchedule()) {
      this.slotOptions.set([]);
      return;
    }
    if (!this.data.serviceId) {
      this.slotsError.set('La cita no tiene servicio asociado.');
      this.slotOptions.set([]);
      return;
    }
    this.slotsLoading.set(true);
    this.slotsError.set(null);
    try {
      const onDate = localCalendarDateStringFromIso(this.data.startIso);
      const slots = await this.appts.getAvailableSlots({
        userId: this.data.userId,
        serviceId: this.data.serviceId,
        onDate,
        tz: AGENDA_DEFAULT_TZ,
        excludeAppointmentId: this.data.id,
      });
      const cur = isoToTimeInput(this.data.startIso);
      const mergeCur =
        !!cur && !slots.includes(cur) && this.appts.isSlotTimeInFutureForOnDate(onDate, cur);
      const merged = mergeCur ? [...slots, cur].sort((a, b) => a.localeCompare(b)) : [...slots];
      this.slotOptions.set(merged);
      const pick = merged.includes(cur) ? cur : merged[0] ?? '';
      this.form.patchValue({ start_slot: pick });
    } catch (e) {
      console.error(e);
      const msg =
        e && typeof e === 'object' && 'message' in e
          ? String((e as { message?: string }).message)
          : 'No se pudieron cargar los horarios.';
      this.slotsError.set(msg);
      this.slotOptions.set([]);
      this.form.patchValue({ start_slot: '' });
    } finally {
      this.slotsLoading.set(false);
    }
  }

  async saveTimes() {
    if (!this.canEditSchedule()) return;
    const slot = this.form.getRawValue().start_slot;
    if (!slot) {
      this.snack.open('Elige un horario disponible.', 'OK', { duration: 4000 });
      return;
    }
    this.saving.set(true);
    try {
      const onDate = localCalendarDateStringFromIso(this.data.startIso);
      if (!this.appts.isSlotTimeInFutureForOnDate(onDate, slot)) {
        this.snack.open('Elige un horario posterior a la hora actual.', 'OK', { duration: 4000 });
        return;
      }
      const dur = Math.max(1, this.data.serviceDurationMinutes || 30);
      const newStart = combineDateWithTime(this.data.startIso, slot);
      if (newStart.getTime() <= Date.now()) {
        this.snack.open('Elige un horario posterior a la hora actual.', 'OK', { duration: 4000 });
        return;
      }
      const newEnd = new Date(newStart.getTime() + dur * 60_000);
      const overlap = await this.appts.hasOverlap(this.data.userId, newStart, newEnd, this.data.id);
      if (overlap) {
        this.snack.open('Ese veterinario ya tiene otra cita en ese horario.', 'OK', { duration: 4000 });
        return;
      }
      const { error } = await this.appts.updateTimes(
        this.data.id,
        newStart.toISOString(),
        newEnd.toISOString(),
      );
      if (error) throw error;
      this.snack.open('Horario actualizado', 'OK', { duration: 2500 });
      this.ref.close(true);
    } catch (e: unknown) {
      this.snack.open(e instanceof Error ? e.message : 'No se pudo actualizar el horario', 'OK', {
        duration: 4000,
      });
    } finally {
      this.saving.set(false);
    }
  }

  async saveStatus() {
    this.saving.set(true);
    try {
      const sid = this.form.getRawValue().status_id;
      const newName = this.data.statuses.find((s) => s.id === sid)?.name ?? '';
      const { error } = await this.appts.updateStatus(this.data.id, sid);
      if (error) throw error;
      if (newName === 'Completada' || newName === 'Cancelada' || newName === 'NoShow') {
        const { error: e2 } = await this.appts.updateAttentionStartedAt(this.data.id, null);
        if (e2) throw e2;
        this.stopClock();
        this.attentionStartedAt.set(null);
      }
      const completed = newName === 'Completada';
      const apptId = this.data.id;
      const servicePrice = this.data.servicePrice;
      let paymentData: { appointmentId: string; defaultAmount: number; breakdown: PaymentBreakdown } | null =
        null;
      if (completed) {
        const { data: extraRows, error: e3 } = await this.appts.listExtraCharges(apptId);
        if (e3) throw e3;
        const lines = (extraRows ?? []).map((r) => ({
          description: String((r as { description?: string }).description ?? ''),
          amount: Number((r as { amount?: unknown }).amount ?? 0),
        }));
        const extrasSum = lines.reduce((s, l) => s + l.amount, 0);
        const total = servicePrice + extrasSum;
        paymentData = {
          appointmentId: apptId,
          defaultAmount: total,
          breakdown: {
            serviceLabel: this.data.serviceName?.trim() ? this.data.serviceName : 'Servicio',
            serviceAmount: servicePrice,
            extrasAmount: extrasSum,
            extrasLines: lines.length ? lines : undefined,
          },
        };
      }
      this.ref.close(true);
      if (paymentData) {
        queueMicrotask(() => {
          this.dialog.open(PaymentFormDialog, {
            width: 'min(400px, 100vw)',
            data: paymentData!,
          });
        });
      }
    } catch (e: unknown) {
      this.snack.open(e instanceof Error ? e.message : 'Error', 'OK', { duration: 4000 });
    } finally {
      this.saving.set(false);
    }
  }

  async deleteAppointment() {
    if (!this.canDeleteAppointment()) return;
    if (!confirm('¿Eliminar esta cita? Esta acción no se puede deshacer.')) return;
    this.deleting.set(true);
    try {
      const { error } = await this.appts.deleteAppointment(this.data.id);
      if (error) throw error;
      this.snack.open('Cita eliminada', 'OK', { duration: 2500 });
      this.ref.close(true);
    } catch (e: unknown) {
      this.snack.open(e instanceof Error ? e.message : 'No se pudo eliminar la cita', 'OK', {
        duration: 4000,
      });
    } finally {
      this.deleting.set(false);
    }
  }

  async openMedical() {
    if (!this.tenant.canEditMedical()) return;
    let record = null;
    try {
      const { data, error } = await this.medical.getByAppointmentId(this.data.id);
      if (error) throw error;
      record = data;
    } catch {
      /* nueva nota */
    }
    this.dialog
      .open(MedicalRecordFormDialog, {
        width: 'min(520px, 100vw)',
        data: { petId: this.data.petId, appointmentId: this.data.id, record },
      })
      .afterClosed()
      .subscribe(() => void this.loadLinkedClinicalNote());
  }
}
