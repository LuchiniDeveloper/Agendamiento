import { DatePipe, NgTemplateOutlet } from '@angular/common';
import { Component, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, ParamMap, Router } from '@angular/router';
import { skip } from 'rxjs';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatNativeDateModule } from '@angular/material/core';
import { MatDatepickerModule, type MatDatepickerInputEvent } from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTooltipModule } from '@angular/material/tooltip';
import { AppointmentsData } from '../../appointments/appointments.data';
import { CustomersData, type CustomerRow } from '../../customers/customers.data';
import { petAvatarFromSpecies } from '../../customers/pet-avatar.util';
import { MedicalData, type NextVisitFollowupRow } from '../../medical-records/medical.data';
import { TenantContextService } from '../../../core/tenant-context.service';
import { buildWhatsAppLink } from '../../../shared/util/whatsapp';

export type MessageTemplateId = 'reminder' | 'confirm' | 'followup' | 'custom';

export type ChatQueueAppointmentRow = {
  id: string;
  start_date_time: string;
  customer: { id: string; name: string; phone: string | null } | null;
  pet: { id: string; name: string; species: string | null } | null;
  service: { id: string; name: string } | null;
  status: { name: string } | null;
};

interface MsgCtx {
  customerName: string;
  petName: string;
  whenLine: string;
  businessName: string;
  address: string;
  serviceName: string;
  lastVisitLine?: string;
}

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

function addLocalDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function ymdLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** `YYYY-MM-DD` → medianoche local; inválido → null. */
function parseYmdLocal(ymd: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return null;
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10) - 1;
  const d = parseInt(m[3], 10);
  const dt = new Date(y, mo, d, 0, 0, 0, 0);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo || dt.getDate() !== d) return null;
  return dt;
}

type TemplateScope = 'queue' | 'next' | 'search';

@Component({
  selector: 'app-reminders-page',
  imports: [
    DatePipe,
    NgTemplateOutlet,
    FormsModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    MatTabsModule,
    MatFormFieldModule,
    MatInputModule,
    MatTooltipModule,
    MatDatepickerModule,
    MatNativeDateModule,
  ],
  templateUrl: './reminders-page.html',
  styleUrl: './reminders-page.scss',
})
export class RemindersPage implements OnInit {
  private readonly appts = inject(AppointmentsData);
  private readonly medical = inject(MedicalData);
  private readonly customers = inject(CustomersData);
  private readonly snack = inject(MatSnackBar);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly tenant = inject(TenantContextService);

  protected readonly petAvatarFromSpecies = petAvatarFromSpecies;

  protected readonly loading = signal(true);
  protected readonly queueAppointments = signal<ChatQueueAppointmentRow[]>([]);
  protected queueDayModel = startOfLocalDay(new Date());

  /** Fila resaltada al venir desde la agenda (`?appointmentId=`). */
  protected readonly focusQueueAppointmentId = signal<string | null>(null);

  /** Pestaña activa (0 = cola del día); se fuerza 0 al abrir desde agenda. */
  protected readonly chatTabIndex = signal(0);

  protected readonly nextVisits = signal<NextVisitFollowupRow[]>([]);
  protected readonly nextVisitsLoading = signal(false);
  protected readonly searchLoading = signal(false);
  protected readonly searchResults = signal<CustomerRow[]>([]);
  protected searchQuery = '';

  protected customMessageBody = '';

  /** Plantilla elegida por fila: clave `scope:id` → tipo. */
  protected readonly templatePick = signal<Record<string, MessageTemplateId | null>>({});

  /** Paso «WhatsApp» en el indicador: solo tras clic en Enviar. Clave `scope:id`. */
  private readonly waFlowSendClicked = signal<Record<string, true>>({});

  /** Tras abrir WhatsApp con plantilla distinta de «Personalizado», bloquea otro envío hasta cambiar de plantilla. */
  private readonly waConsumedNonCustom = signal<Record<string, true>>({});

  protected readonly templateChoices: { id: MessageTemplateId; label: string }[] = [
    { id: 'reminder', label: 'Recordatorio' },
    { id: 'confirm', label: 'Confirmar asistencia' },
    { id: 'followup', label: 'Seguimiento' },
    { id: 'custom', label: 'Personalizado' },
  ];

  async ngOnInit() {
    await this.bootstrapFromRoute(this.route.snapshot.queryParamMap);
    await this.loadNextVisits();
    this.route.queryParamMap
      .pipe(skip(1), takeUntilDestroyed(this.destroyRef))
      .subscribe((pm) => {
        if (pm.get('appointmentId') || pm.get('day')) {
          void this.bootstrapFromRoute(pm);
        }
      });
  }

  /** Aplica `day` / `appointmentId` de la URL, recarga cola y limpia query (replaceUrl). */
  private async bootstrapFromRoute(pm: ParamMap): Promise<void> {
    const dayStr = pm.get('day');
    const apptId = pm.get('appointmentId');
    this.focusQueueAppointmentId.set(null);
    this.chatTabIndex.set(0);
    if (dayStr) {
      const parsed = parseYmdLocal(dayStr);
      if (parsed) this.queueDayModel = startOfLocalDay(parsed);
    }
    await this.loadQueue();
    if (dayStr || apptId) {
      await this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { day: null, appointmentId: null },
        queryParamsHandling: '',
        replaceUrl: true,
      });
    }
    if (apptId) {
      if (this.queueAppointments().some((a) => a.id === apptId)) {
        this.focusQueueAppointmentId.set(apptId);
        queueMicrotask(() =>
          document.getElementById(`chat-queue-appt-${apptId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
        );
      } else {
        this.snack.open(
          'Esta cita no está en la cola del día (completada, cancelada u otra fecha). Usá el chat con citas pendientes.',
          'OK',
          { duration: 6000 },
        );
      }
    }
  }

  protected onChatTabChange(index: number): void {
    this.chatTabIndex.set(index);
  }

  private tplKey(scope: TemplateScope, id: string): string {
    return `${scope}:${id}`;
  }

  protected selectedTemplate(scope: TemplateScope, id: string): MessageTemplateId | null {
    return this.templatePick()[this.tplKey(scope, id)] ?? null;
  }

  protected pickTemplate(scope: TemplateScope, id: string, tid: MessageTemplateId) {
    if (tid === 'custom' && !this.hasCustomBody()) {
      this.snack.open('Escribí un mensaje personalizado arriba antes de usar esta plantilla.', 'OK', { duration: 4000 });
      return;
    }
    const k = this.tplKey(scope, id);
    const prev = this.templatePick()[k] ?? null;
    if (prev !== tid) {
      this.resetWaUiState(k);
    }
    this.templatePick.update((m) => ({ ...m, [k]: tid }));
  }

  private resetWaUiState(k: string) {
    this.waFlowSendClicked.update((m) => {
      const copy = { ...m };
      delete copy[k];
      return copy;
    });
    this.waConsumedNonCustom.update((m) => {
      const copy = { ...m };
      delete copy[k];
      return copy;
    });
  }

  private resetAllWaUiState() {
    this.waFlowSendClicked.set({});
    this.waConsumedNonCustom.set({});
  }

  /** Indicador visual: paso WhatsApp solo después de Enviar. */
  protected waStepActive(scope: TemplateScope, id: string): boolean {
    return !!this.waFlowSendClicked()[this.tplKey(scope, id)];
  }

  /** Bloquea el enlace Enviar salvo plantilla «Personalizado». */
  protected waSendLocked(scope: TemplateScope, id: string, tid: MessageTemplateId): boolean {
    if (tid === 'custom') return false;
    return !!this.waConsumedNonCustom()[this.tplKey(scope, id)];
  }

  protected onWaSendClick(scope: TemplateScope, id: string, tid: MessageTemplateId, ev: MouseEvent, href: string): void {
    if (href === '#' || this.waSendLocked(scope, id, tid)) {
      ev.preventDefault();
      return;
    }
    const k = this.tplKey(scope, id);
    this.waFlowSendClicked.update((m) => ({ ...m, [k]: true }));
    if (tid !== 'custom') {
      this.waConsumedNonCustom.update((m) => ({ ...m, [k]: true }));
    }
  }

  protected onQueueDayChange(ev: MatDatepickerInputEvent<Date | null>) {
    const v = ev.value;
    if (!v) return;
    this.focusQueueAppointmentId.set(null);
    this.queueDayModel = startOfLocalDay(v);
    void this.loadQueue();
  }

  protected resetQueueToToday() {
    this.focusQueueAppointmentId.set(null);
    this.queueDayModel = startOfLocalDay(new Date());
    void this.loadQueue();
  }

  async loadQueue() {
    this.loading.set(true);
    this.templatePick.set({});
    this.resetAllWaUiState();
    try {
      const start = startOfLocalDay(this.queueDayModel);
      const end = addLocalDays(start, 1);
      const { data, error } = await this.appts.listForChatQueueDay(start, end);
      if (error) throw error;
      const list = (data ?? []) as unknown as ChatQueueAppointmentRow[];
      this.queueAppointments.set(list);
    } catch (e) {
      console.error(e);
      this.queueAppointments.set([]);
    } finally {
      this.loading.set(false);
    }
  }

  async loadNextVisits() {
    this.nextVisitsLoading.set(true);
    try {
      const today = startOfLocalDay(new Date());
      const fromYmd = ymdLocal(today);
      const toYmd = ymdLocal(addLocalDays(today, 120));
      const { data, error } = await this.medical.listNextVisitFollowups(fromYmd, toYmd);
      if (error) throw error;
      const raw = (data ?? []) as unknown as NextVisitFollowupRow[];
      const withPhone = raw.filter((r) => {
        const p = (r.pet?.customer?.phone ?? '').replace(/\D/g, '');
        return p.length > 0;
      });
      this.nextVisits.set(withPhone);
    } catch (e) {
      console.error(e);
      this.nextVisits.set([]);
    } finally {
      this.nextVisitsLoading.set(false);
    }
  }

  async runSearch() {
    const q = this.searchQuery.trim();
    if (q.length < 2) {
      this.snack.open('Escribe al menos 2 caracteres (nombre o teléfono)', 'OK', { duration: 3000 });
      return;
    }
    this.searchLoading.set(true);
    this.templatePick.set({});
    this.resetAllWaUiState();
    try {
      const { data, error } = await this.customers.searchByPhone(q);
      if (error) throw error;
      const list = (data ?? []) as unknown as CustomerRow[];
      this.searchResults.set(list.filter((c) => (c.phone ?? '').replace(/\D/g, '').length > 0));
    } catch (e) {
      console.error(e);
      this.searchResults.set([]);
      this.snack.open(e instanceof Error ? e.message : 'Error en la búsqueda', 'OK', { duration: 4000 });
    } finally {
      this.searchLoading.set(false);
    }
  }

  protected hasCustomBody(): boolean {
    return this.customMessageBody.trim().length > 0;
  }

  protected ctxFromQueueAppointment(a: ChatQueueAppointmentRow): MsgCtx {
    return this.buildCtx({
      customerName: a.customer?.name ?? 'Cliente',
      petName: a.pet?.name ?? '',
      start: a.start_date_time,
      serviceName: a.service?.name ?? '',
    });
  }

  protected ctxFromCustomer(c: CustomerRow): MsgCtx {
    return this.buildCtx({
      customerName: c.name,
      petName: '',
      start: undefined,
      serviceName: '',
    });
  }

  protected ctxFromNextVisit(r: NextVisitFollowupRow): MsgCtx {
    const cust = r.pet?.customer;
    const nv = r.next_visit_date;
    const nvFmt = nv
      ? new Intl.DateTimeFormat('es-CO', { dateStyle: 'long' }).format(new Date(`${nv}T12:00:00`))
      : '';
    const lastIso = r.appointment?.start_date_time;
    const lastFmt = lastIso
      ? new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(lastIso))
      : '';
    const svc = r.appointment?.service?.name?.trim() ?? '';
    return {
      customerName: cust?.name ?? 'Cliente',
      petName: r.pet?.name ?? '',
      whenLine: nvFmt,
      businessName: this.tenant.profile()?.business?.name ?? 'la clínica',
      address: this.tenant.profile()?.business?.address ?? '',
      serviceName: svc,
      lastVisitLine: lastFmt || undefined,
    };
  }

  protected buildCtx(parts: {
    customerName: string;
    petName: string;
    start?: string;
    serviceName: string;
  }): MsgCtx {
    const b = this.tenant.profile()?.business;
    const whenLine = parts.start
      ? new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short' }).format(
          new Date(parts.start),
        )
      : '';
    return {
      customerName: parts.customerName,
      petName: parts.petName,
      whenLine,
      businessName: b?.name ?? 'la clínica',
      address: b?.address ?? '',
      serviceName: parts.serviceName,
    };
  }

  protected composeMessage(ctx: MsgCtx, tid: MessageTemplateId): string {
    const addr = ctx.address ? ` ${ctx.address}`.trimEnd() : '';
    const pet = ctx.petName || 'su mascota';
    const svc = ctx.serviceName ? ` (${ctx.serviceName})` : '';
    const when = ctx.whenLine;
    const last = ctx.lastVisitLine;

    switch (tid) {
      case 'custom': {
        const t = this.customMessageBody.trim();
        if (t) return t;
        return `Hola ${ctx.customerName}, le saludamos desde ${ctx.businessName}.${addr ? ' ' + addr : ''}`;
      }
      case 'confirm':
        if (last && when) {
          return `Hola ${ctx.customerName}, ¿nos confirma que podrá traer a ${pet} para la próxima visita sugerida el ${when}? (Última consulta: ${last}.)${addr ? ' ' + addr : ''}`;
        }
        return when
          ? `Hola ${ctx.customerName}, ¿nos confirma la asistencia${svc} de ${pet} el ${when} en ${ctx.businessName}?${addr ? ' ' + addr : ''}`
          : `Hola ${ctx.customerName}, ¿nos confirma la asistencia de ${pet} en ${ctx.businessName}?${addr ? ' ' + addr : ''}`;
      case 'followup':
        if (last && when) {
          return `Hola ${ctx.customerName}, desde ${ctx.businessName} le recordamos la próxima visita sugerida para ${pet} el ${when}, según la consulta del ${last}.${addr ? ' ' + addr : ''} ¿Desea coordinar turno?`;
        }
        return `Hola ${ctx.customerName}, nos comunicamos desde ${ctx.businessName} por ${pet}. ¿Cómo va todo? Si necesita algo, escríbanos.${addr ? ' ' + addr : ''}`;
      default:
        if (last && when) {
          return `Hola ${ctx.customerName}, le recordamos desde ${ctx.businessName} la próxima visita sugerida para ${pet} el ${when} (última consulta: ${last}).${addr ? ' ' + addr : ''}`;
        }
        return when
          ? `Hola ${ctx.customerName}, le recordamos la cita de ${pet}${svc} el ${when} en ${ctx.businessName}.${addr ? ' ' + addr : ''}`
          : `Hola ${ctx.customerName}, le escribimos desde ${ctx.businessName} respecto a ${pet}.${addr ? ' ' + addr : ''}`;
    }
  }

  protected waHrefQueue(a: ChatQueueAppointmentRow): string {
    const tid = this.selectedTemplate('queue', a.id);
    if (!tid) return '#';
    if (tid !== 'custom' && this.waConsumedNonCustom()[this.tplKey('queue', a.id)]) return '#';
    const phone = a.customer?.phone ?? null;
    return buildWhatsAppLink(phone, this.composeMessage(this.ctxFromQueueAppointment(a), tid));
  }

  protected waHrefNextVisitRow(nv: NextVisitFollowupRow): string {
    const tid = this.selectedTemplate('next', nv.id);
    if (!tid) return '#';
    if (tid !== 'custom' && this.waConsumedNonCustom()[this.tplKey('next', nv.id)]) return '#';
    const phone = nv.pet?.customer?.phone ?? null;
    return buildWhatsAppLink(phone, this.composeMessage(this.ctxFromNextVisit(nv), tid));
  }

  protected waHrefCustomerRow(c: CustomerRow): string {
    const tid = this.selectedTemplate('search', c.id);
    if (!tid) return '#';
    if (tid !== 'custom' && this.waConsumedNonCustom()[this.tplKey('search', c.id)]) return '#';
    return buildWhatsAppLink(c.phone, this.composeMessage(this.ctxFromCustomer(c), tid));
  }
}
