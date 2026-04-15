import { DatePipe } from '@angular/common';
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
import { CopCurrencyPipe } from '../../../shared/pipes/cop-currency.pipe';

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
    DatePipe,
    CopCurrencyPipe,
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
  protected readonly invoiceExpanded = signal(false);
  protected readonly invoiceLoading = signal(false);
  protected readonly paidTotal = signal(0);
  protected readonly paidMethod = signal<string | null>(null);
  protected readonly paidAt = signal<string | null>(null);
  protected readonly paidCount = signal(0);
  protected readonly paidTransferChannel = signal<string | null>(null);
  protected readonly paidTransferProof = signal<string | null>(null);
  protected readonly paymentRecordId = signal<string | null>(null);
  protected readonly invoiceBreakdown = signal<PaymentBreakdown | null>(null);

  protected readonly attentionStartedAt = signal<string | null>(this.data.attentionStartedAt ?? null);
  protected readonly attentionBusy = signal(false);
  protected readonly attentionPaused = signal(false);
  private readonly clockTick = signal(0);
  private timerId: ReturnType<typeof setInterval> | null = null;
  private attentionPausedAtMs: number | null = null;

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
    void this.refreshInvoiceSummary();
    this.syncDisableClose();
    this.maybeStartClock();
  }

  ngOnDestroy() {
    this.stopClock();
  }

  private maybeStartClock() {
    this.stopClock();
    if (!this.inAttention() || this.attentionPaused()) return;
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

  private syncDisableClose() {
    this.ref.disableClose = this.inAttention();
  }

  protected closeDialog() {
    this.ref.close(false);
  }

  protected isCompleted(): boolean {
    return this.data.statusName === 'Completada';
  }

  protected isCompletedAndPaid(): boolean {
    return this.isCompleted() && this.paidCount() > 0;
  }

  protected showStatusField(): boolean {
    return !this.inAttention() && !this.isCompletedAndPaid();
  }

  protected canDownloadInvoicePdf(): boolean {
    return this.isCompletedAndPaid();
  }

  protected statusOptionsForSelect(): { id: number; name: string }[] {
    return this.data.statuses.filter((s) => s.name !== 'Completada');
  }

  protected toggleInvoiceExpanded() {
    this.invoiceExpanded.update((v) => !v);
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
    if (this.attentionPaused()) return 'Atención en pausa temporal.';
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
      this.attentionPaused.set(false);
      this.syncDisableClose();
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

  protected async togglePauseAttention() {
    if (!this.inAttention()) return;
    const next = !this.attentionPaused();
    if (next) {
      this.attentionPaused.set(true);
      this.attentionPausedAtMs = Date.now();
      this.stopClock();
      this.snack.open('Atención en pausa', 'OK', { duration: 1800 });
      return;
    }
    const baseIso = this.attentionStartedAt();
    const pausedAt = this.attentionPausedAtMs;
    if (!baseIso || pausedAt == null) {
      this.attentionPaused.set(false);
      this.attentionPausedAtMs = null;
      this.maybeStartClock();
      return;
    }
    this.attentionBusy.set(true);
    try {
      const pausedMs = Math.max(0, Date.now() - pausedAt);
      const shiftedIso = new Date(new Date(baseIso).getTime() + pausedMs).toISOString();
      const { error } = await this.appts.updateAttentionStartedAt(this.data.id, shiftedIso);
      if (error) throw error;
      this.attentionStartedAt.set(shiftedIso);
      this.attentionPaused.set(false);
      this.attentionPausedAtMs = null;
      this.maybeStartClock();
      this.snack.open('Atención reanudada', 'OK', { duration: 1800 });
    } catch (e: unknown) {
      this.snack.open(e instanceof Error ? e.message : 'No se pudo reanudar la atención', 'OK', {
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
      this.attentionPaused.set(false);
      this.attentionPausedAtMs = null;
      this.attentionStartedAt.set(null);
      this.syncDisableClose();
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

  private statusIdByName(name: string): number | null {
    return this.data.statuses.find((s) => s.name === name)?.id ?? null;
  }

  private async buildPaymentData(apptId: string, servicePrice: number) {
    const { data: extraRows, error: e3 } = await this.appts.listExtraCharges(apptId);
    if (e3) throw e3;
    const lines = (extraRows ?? []).map((r) => ({
      description: String((r as { description?: string }).description ?? ''),
      amount: Number((r as { amount?: unknown }).amount ?? 0),
    }));
    const extrasSum = lines.reduce((s, l) => s + l.amount, 0);
    const total = servicePrice + extrasSum;
    const breakdown: PaymentBreakdown = {
      serviceLabel: this.data.serviceName?.trim() ? this.data.serviceName : 'Servicio',
      serviceAmount: servicePrice,
      extrasAmount: extrasSum,
      extrasLines: lines.length ? lines : undefined,
    };
    return {
      appointmentId: apptId,
      defaultAmount: total,
      breakdown,
    };
  }

  private paymentMethodLabel(v: string | null): string {
    if (v === 'Cash') return 'Efectivo';
    if (v === 'Card') return 'Tarjeta';
    if (v === 'Transfer') return 'Transferencia';
    return v || '—';
  }

  private currencyCop(v: number): string {
    return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(
      Number(v ?? 0),
    );
  }

  private escapeHtml(raw: string): string {
    return raw
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  private async refreshInvoiceSummary() {
    this.invoiceLoading.set(true);
    try {
      const [payRes, extrasRes] = await Promise.all([
        this.appts.listPaymentsByAppointment(this.data.id),
        this.appts.listExtraCharges(this.data.id),
      ]);
      if (payRes.error) throw payRes.error;
      if (extrasRes.error) throw extrasRes.error;
      const payments = (payRes.data ?? []) as {
        id?: string | null;
        amount?: number | string | null;
        payment_method?: string | null;
        created_at?: string | null;
        transfer_channel?: string | null;
        transfer_proof_code?: string | null;
      }[];
      const extrasLines = (extrasRes.data ?? []).map((r) => ({
        description: String((r as { description?: string }).description ?? ''),
        amount: Number((r as { amount?: unknown }).amount ?? 0),
      }));
      const extrasAmount = extrasLines.reduce((s, l) => s + l.amount, 0);
      const totalPaid = payments.reduce((s, p) => s + Number(p.amount ?? 0), 0);
      this.paidTotal.set(totalPaid);
      this.paidCount.set(payments.length);
      const last = payments[payments.length - 1];
      this.paymentRecordId.set((last?.id as string | null) ?? null);
      this.paidMethod.set(this.paymentMethodLabel((last?.payment_method as string | null) ?? null));
      this.paidAt.set((last?.created_at as string | null) ?? null);
      this.paidTransferChannel.set((last?.transfer_channel as string | null) ?? null);
      this.paidTransferProof.set((last?.transfer_proof_code as string | null) ?? null);
      this.invoiceBreakdown.set({
        serviceLabel: this.data.serviceName?.trim() || 'Servicio',
        serviceAmount: Number(this.data.servicePrice ?? 0),
        extrasAmount,
        extrasLines: extrasLines.length ? extrasLines : undefined,
      });
    } catch (e: unknown) {
      this.snack.open(e instanceof Error ? e.message : 'No se pudo cargar el resumen de factura', 'OK', {
        duration: 3500,
      });
    } finally {
      this.invoiceLoading.set(false);
    }
  }

  /** Descarga el comprobante como archivo HTML (sin ventana emergente; se puede imprimir a PDF al abrirlo). */
  protected downloadInvoicePdf() {
    if (!this.canDownloadInvoicePdf()) return;
    const bill = this.invoiceBreakdown();
    if (!bill) return;
    const issueDate = this.paidAt() ? new Date(this.paidAt()!) : new Date();
    const issueLabel = new Intl.DateTimeFormat('es-CO', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(issueDate);
    const invoiceNo = `INV-${this.data.id.slice(0, 8).toUpperCase()}`;
    const paymentLine =
      this.paidMethod() === 'Transferencia' && this.paidTransferChannel()
        ? `${this.paidMethod()} (${this.paidTransferChannel()})`
        : (this.paidMethod() ?? '—');
    const proofLine = this.paidTransferProof() || 'N/A';
    const extrasRows = (bill.extrasLines ?? [])
      .map(
        (l) =>
          `<tr><td>${this.escapeHtml(l.description)}</td><td style="text-align:right">${this.currencyCop(l.amount)}</td></tr>`,
      )
      .join('');
    const total = this.paidTotal();
    const html = `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <title>Factura ${invoiceNo}</title>
  <style>
    body{font-family:Segoe UI,Arial,sans-serif;margin:0;background:#f4f6fb;color:#1e2430}
    .sheet{max-width:840px;margin:24px auto;background:#fff;border:1px solid #d8deea;border-radius:14px;box-shadow:0 10px 24px rgba(18,24,39,.08);overflow:hidden}
    .head{padding:22px 26px;background:linear-gradient(135deg,#0a5cc2,#0d7be7);color:#fff}
    .head h1{margin:0 0 6px;font-size:22px}
    .head p{margin:0;font-size:13px;opacity:.92}
    .meta{display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:18px 26px;border-bottom:1px solid #e7ecf4}
    .card{background:#f8fbff;border:1px solid #e3ebf6;border-radius:10px;padding:10px 12px}
    .card b{display:block;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#5b6780;margin-bottom:4px}
    table{width:calc(100% - 52px);margin:18px 26px;border-collapse:collapse}
    th,td{padding:10px 8px;border-bottom:1px solid #e8edf6;font-size:14px}
    th{text-align:left;font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:#62718f}
    .totals{margin:0 26px 20px;border:1px solid #e4eaf5;border-radius:10px;padding:12px;background:#fbfdff}
    .line{display:flex;justify-content:space-between;padding:4px 0}
    .line.total{margin-top:6px;padding-top:8px;border-top:1px solid #dce5f2;font-weight:800;font-size:18px}
    .foot{padding:14px 26px 20px;font-size:12px;color:#60708b}
    @media print{body{background:#fff}.sheet{margin:0;border:none;box-shadow:none;border-radius:0}}
  </style>
</head>
<body>
  <article class="sheet">
    <header class="head">
      <h1>${this.escapeHtml(this.data.businessName || 'Clínica')}</h1>
      <p>${this.escapeHtml(this.data.businessAddress || 'Sin dirección registrada')} · ${this.escapeHtml(this.data.businessPhone || 'Sin teléfono')}</p>
    </header>
    <section class="meta">
      <div class="card">
        <b>Factura</b>
        ${invoiceNo}<br/>Emitida: ${issueLabel}<br/>Cita: ${this.escapeHtml(this.data.id)}
      </div>
      <div class="card">
        <b>Cliente / Mascota</b>
        ${this.escapeHtml(this.data.customerName)}<br/>Mascota: ${this.escapeHtml(this.data.petName)}<br/>Veterinario: ${this.escapeHtml(this.data.vetName || '—')}
      </div>
    </section>
    <table>
      <thead><tr><th>Concepto</th><th style="text-align:right">Valor</th></tr></thead>
      <tbody>
        <tr><td>${this.escapeHtml(bill.serviceLabel)}</td><td style="text-align:right">${this.currencyCop(bill.serviceAmount)}</td></tr>
        ${extrasRows}
      </tbody>
    </table>
    <section class="totals">
      <div class="line"><span>Método de pago</span><strong>${this.escapeHtml(paymentLine)}</strong></div>
      <div class="line"><span>Comprobante</span><strong>${this.escapeHtml(proofLine)}</strong></div>
      <div class="line"><span>ID pago</span><strong>${this.escapeHtml(this.paymentRecordId() || '—')}</strong></div>
      <div class="line total"><span>Total pagado</span><span>${this.currencyCop(total)}</span></div>
    </section>
    <footer class="foot">Documento generado desde el sistema de agenda para soporte de caja y cliente.</footer>
  </article>
</body>
</html>`;
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const safeName = invoiceNo.replace(/[^\w.-]+/g, '_');
    const a = document.createElement('a');
    a.href = url;
    a.download = `Factura-${safeName}.html`;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
    this.snack.open('Factura descargada (archivo HTML). Para PDF, ábrela e imprime con Guardar como PDF.', 'OK', {
      duration: 4000,
    });
  }

  protected async completeAttention() {
    const completedId = this.statusIdByName('Completada');
    if (completedId == null) {
      this.snack.open('No se encontró el estado Completada.', 'OK', { duration: 3500 });
      return;
    }
    this.form.patchValue({ status_id: completedId });
    await this.saveStatus();
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
    if (this.inAttention()) return false;
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
        this.attentionPaused.set(false);
        this.attentionPausedAtMs = null;
        this.syncDisableClose();
        this.attentionStartedAt.set(null);
      }
      const completed = newName === 'Completada';
      const apptId = this.data.id;
      const servicePrice = this.data.servicePrice;
      let paymentData: { appointmentId: string; defaultAmount: number; breakdown: PaymentBreakdown } | null =
        null;
      if (completed) {
        paymentData = await this.buildPaymentData(apptId, servicePrice);
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
      this.data.statusName = newName;
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
