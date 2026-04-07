import { Component, inject, OnInit, signal } from '@angular/core';
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
import { PaymentFormDialog } from '../payment-form-dialog/payment-form-dialog';
import { buildWhatsAppLink } from '../../../shared/util/whatsapp';
import { TenantContextService } from '../../../core/tenant-context.service';

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

const TERMINAL_STATUSES = new Set(['Completada', 'Cancelada', 'NoShow']);
const DELETABLE_STATUSES = new Set(['Agendada', 'Cancelada', 'NoShow']);

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
  serviceId: string;
  /** Nombre del servicio de la cita */
  serviceName: string;
  serviceDurationMinutes: number;
  servicePrice: number;
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
  ],
  templateUrl: './appointment-quick-dialog.html',
})
export class AppointmentQuickDialog implements OnInit {
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

  form = this.fb.nonNullable.group({
    status_id: [this.data.statusId],
    start_slot: [''],
  });

  ngOnInit() {
    this.form.patchValue({ status_id: this.data.statusId });
    void this.loadLinkedClinicalNote();
    void this.refreshSlots();
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

  /** WhatsApp al cliente: oculto si el estado es terminal (Completada, Cancelada, NoShow). */
  protected showMessagingAndStatusSave(): boolean {
    const sid = this.form.getRawValue().status_id;
    const name = this.data.statuses.find((s) => s.id === sid)?.name ?? '';
    return !TERMINAL_STATUSES.has(name);
  }

  /** Solo si el estado del formulario difiere del guardado en base de datos. */
  protected showSaveStatusButton(): boolean {
    return this.form.getRawValue().status_id !== this.data.statusId;
  }

  /**
   * Eliminar: inicio futuro y estado Agendada, Cancelada o NoShow.
   */
  protected canDeleteAppointment(): boolean {
    const start = new Date(this.data.startIso);
    if (start.getTime() <= Date.now()) return false;
    const sid = this.form.getRawValue().status_id;
    const name = this.data.statuses.find((s) => s.id === sid)?.name ?? '';
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

  waLink() {
    const msg = `Hola ${this.data.customerName}, le recordamos la cita de ${this.data.petName} el ${this.data.startLabel} (hasta ${this.data.endLabel}) en ${this.data.businessName}.${this.data.businessAddress ? ' ' + this.data.businessAddress : ''}`;
    return buildWhatsAppLink(this.data.customerPhone, msg);
  }

  async saveStatus() {
    this.saving.set(true);
    try {
      const sid = this.form.getRawValue().status_id;
      const { error } = await this.appts.updateStatus(this.data.id, sid);
      if (error) throw error;
      const completed = this.data.statuses.find((s) => s.id === sid)?.name === 'Completada';
      if (completed) {
        this.dialog.open(PaymentFormDialog, {
          width: 'min(400px, 100vw)',
          data: {
            appointmentId: this.data.id,
            defaultAmount: this.data.servicePrice,
          },
        });
      }
      this.ref.close(true);
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
