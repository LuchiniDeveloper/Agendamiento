import { isPlatformBrowser } from '@angular/common';
import { Component, inject, OnDestroy, PLATFORM_ID, signal, viewChild } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { FullCalendarModule } from '@fullcalendar/angular';
import {
  CalendarOptions,
  EventChangeArg,
  EventClickArg,
  EventContentArg,
  EventDropArg,
  EventInput,
} from '@fullcalendar/core';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import esLocale from '@fullcalendar/core/locales/es';
import { FullCalendarComponent } from '@fullcalendar/angular';
import { AppointmentsData } from '../appointments.data';
import { AppointmentFormDialog } from '../appointment-form-dialog/appointment-form-dialog';
import { AppointmentQuickDialog, type QuickApptPayload } from '../appointment-quick-dialog/appointment-quick-dialog';
import { TenantContextService } from '../../../core/tenant-context.service';
import { petAvatarFromSpecies } from '../../customers/pet-avatar.util';
import { ServicesData, staffRowsForScheduling, type StaffMini } from '../../services-schedule/services.data';
import { vetDisplayShort } from '../vet-calendar-display.util';

interface ApptRow {
  id: string;
  user_id: string;
  start_date_time: string;
  end_date_time: string;
  attention_started_at: string | null;
  status_id: number;
  customer: { id: string; name: string; phone: string | null } | null;
  pet: { id: string; name: string; species: string | null } | null;
  service: { id: string; name: string; price: number; duration_minutes: number } | null;
  vet: { id: string; name: string } | null;
  status: { name: string } | null;
}

function isInAttention(row: ApptRow | null | undefined): boolean {
  if (!row?.attention_started_at) return false;
  const st = row.status?.name ?? '';
  return st !== 'Completada' && st !== 'Cancelada' && st !== 'NoShow';
}

const STATUS_COLORS: Record<string, string> = {
  Agendada: '#5c6bc0',
  Confirmada: '#00897b',
  Cancelada: '#757575',
  Completada: '#43a047',
  NoShow: '#e53935',
};

@Component({
  selector: 'app-appointments-page',
  imports: [
    MatButtonModule,
    MatFormFieldModule,
    MatSelectModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    FullCalendarModule,
  ],
  templateUrl: './appointments-page.html',
  styleUrl: './appointments-page.scss',
})
export class AppointmentsPage implements OnDestroy {
  private readonly appts = inject(AppointmentsData);
  private readonly services = inject(ServicesData);
  private readonly dialog = inject(MatDialog);
  private readonly snack = inject(MatSnackBar);
  protected readonly tenant = inject(TenantContextService);
  private readonly platformId = inject(PLATFORM_ID);
  protected readonly showCalendar = isPlatformBrowser(this.platformId);

  protected readonly cal = viewChild(FullCalendarComponent);
  protected readonly statuses = signal<{ id: number; name: string }[]>([]);
  /** Veterinarios para filtrar la vista del calendario. */
  protected readonly vetOptions = signal<StaffMini[]>([]);
  protected readonly attentionBannerRows = signal<ApptRow[]>([]);
  private readonly attentionTick = signal(0);
  private attentionTimerId: ReturnType<typeof setInterval> | null = null;
  /** null = todos los veterinarios en una sola agenda. */
  protected readonly filterVetId = signal<string | null>(null);

  calendarOptions = signal<CalendarOptions>({
    plugins: [dayGridPlugin, timeGridPlugin, interactionPlugin],
    initialView: 'timeGridWeek',
    locale: esLocale,
    headerToolbar: {
      left: 'prev,next today',
      center: 'title',
      right: 'dayGridMonth,timeGridWeek,timeGridDay',
    },
    slotMinTime: '07:00:00',
    slotMaxTime: '21:00:00',
    allDaySlot: false,
    /**
     * En vista mes, el modo `auto` usa eventos tipo lista (punto) sin fondo de estado.
     * `block` alinea el aspecto con semana/día: barra completa con backgroundColor.
     */
    eventDisplay: 'block',
    /** Citas simultáneas en columnas más anchas y legibles. */
    slotEventOverlap: true,
    eventMinWidth: 112,
    editable: true,
    eventDurationEditable: true,
    height: 'auto',
    events: (info, successCallback, failureCallback) => {
      void this.loadEvents(info.start, info.end, successCallback, failureCallback);
    },
    eventClick: (arg) => this.onEventClick(arg),
    eventDrop: (arg) => void this.onEventDropResize(arg),
    eventResize: (arg) => void this.onEventDropResize(arg),
    dateClick: (arg) => this.onDateClick(arg),
    eventContent: (arg: EventContentArg) => {
      const raw = arg.event.extendedProps['raw'] as ApptRow | undefined;
      const av = petAvatarFromSpecies(raw?.pet?.species);
      const inAttention = isInAttention(raw);
      const vetFull = raw?.vet?.name?.trim() ?? '';
      const vetShort = vetDisplayShort(vetFull);
      const sharedAgenda = this.filterVetId() === null;
      const showVet = sharedAgenda && !!vetShort && !!raw?.user_id;

      const wrap = document.createElement('div');
      wrap.className =
        'fc-appt-custom' +
        (showVet ? ' fc-appt-custom--shared' : '') +
        (inAttention ? ' fc-appt-custom--attention' : '');

      const avatar = document.createElement('span');
      avatar.className = 'pet-cal-avatar';
      avatar.setAttribute('data-pet-tone', av.tone);
      avatar.setAttribute('aria-hidden', 'true');
      const emoji = document.createElement('span');
      emoji.className = 'pet-cal-avatar__emoji';
      emoji.textContent = av.emoji;
      avatar.appendChild(emoji);
      const main = document.createElement('div');
      main.className = 'fc-appt-custom__main';
      if (showVet) {
        const vetEl = document.createElement('span');
        vetEl.className = 'fc-appt-custom__vet';
        vetEl.textContent = vetShort;
        vetEl.title = vetFull;
        main.appendChild(vetEl);
      }
      const title = document.createElement('span');
      title.className = 'fc-appt-custom__title';
      title.textContent = arg.event.title || '';
      main.appendChild(title);
      const svcName = raw?.service?.name?.trim();
      if (svcName) {
        const svc = document.createElement('span');
        svc.className = 'fc-appt-custom__service';
        svc.textContent = svcName;
        main.appendChild(svc);
      }
      if (inAttention) {
        const at = document.createElement('span');
        at.className = 'fc-appt-custom__attention';
        at.textContent = 'En atención';
        main.appendChild(at);
      }
      wrap.appendChild(avatar);
      wrap.appendChild(main);
      return { domNodes: [wrap] };
    },
  });

  constructor() {
    void this.loadStatuses();
    void this.loadVetOptions();
    void this.applyScheduleSlotBounds();
    this.attentionTimerId = setInterval(() => this.attentionTick.update((n) => n + 1), 1000);
  }

  ngOnDestroy(): void {
    if (this.attentionTimerId != null) {
      clearInterval(this.attentionTimerId);
      this.attentionTimerId = null;
    }
  }

  private async loadVetOptions() {
    try {
      const { data } = await this.services.listStaff();
      this.vetOptions.set(staffRowsForScheduling(data));
    } catch {
      this.vetOptions.set([]);
    }
  }

  /** Valor del mat-select (cadena vacía = todos). */
  protected vetFilterSelectValue(): string {
    return this.filterVetId() ?? '';
  }

  protected async onVetFilterChange(value: string) {
    this.filterVetId.set(value === '' ? null : value);
    await this.applyScheduleSlotBounds();
    queueMicrotask(() => this.cal()?.getApi()?.refetchEvents());
  }

  private async applyScheduleSlotBounds() {
    try {
      const b = await this.appts.getScheduleSlotBounds(this.filterVetId());
      const min = b?.minTime ?? '07:00:00';
      const max = b?.maxTime ?? '21:00:00';
      this.calendarOptions.update((o) => ({ ...o, slotMinTime: min, slotMaxTime: max }));
      queueMicrotask(() => {
        const api = this.cal()?.getApi();
        if (api) {
          api.setOption('slotMinTime', min);
          api.setOption('slotMaxTime', max);
        }
      });
    } catch {
      /* defaults del signal inicial */
    }
  }

  private async loadStatuses() {
    const { data } = await this.appts.statusMap();
    this.statuses.set((data ?? []) as { id: number; name: string }[]);
  }

  private async loadEvents(
    start: Date,
    end: Date,
    success: (events: EventInput[]) => void,
    failure: (e: Error) => void,
  ) {
    try {
      const { data, error } = await this.appts.listRange(
        start.toISOString(),
        end.toISOString(),
        this.filterVetId(),
      );
      if (error) throw error;
      const rows = (data ?? []) as unknown as ApptRow[];
      if (this.tenant.isAdmin() && this.filterVetId()) {
        const allRes = await this.appts.listRange(start.toISOString(), end.toISOString(), null);
        if (allRes.error) throw allRes.error;
        const allRows = (allRes.data ?? []) as unknown as ApptRow[];
        this.updateAttentionBanner(allRows);
      } else {
        this.updateAttentionBanner(rows);
      }
      success(
        rows.map((r) => {
          const bg = STATUS_COLORS[r.status?.name ?? ''] ?? '#3949ab';
          const inAttention = isInAttention(r);
          return {
            id: r.id,
            title: `${r.pet?.name ?? 'Mascota'} · ${r.customer?.name ?? 'Cliente'}`,
            start: r.start_date_time,
            end: r.end_date_time,
            backgroundColor: bg,
            borderColor: bg,
            textColor: '#ffffff',
            editable: r.status?.name === 'Agendada',
            classNames: inAttention ? ['fc-event--attention'] : [],
            extendedProps: {
              vetId: r.user_id,
              raw: r,
            },
          };
        }),
      );
    } catch (e) {
      failure(e instanceof Error ? e : new Error(String(e)));
    }
  }

  private updateAttentionBanner(rows: ApptRow[]) {
    const active = rows
      .filter((r) => isInAttention(r))
      .sort((a, b) => {
        const ta = new Date(a.attention_started_at ?? a.start_date_time).getTime();
        const tb = new Date(b.attention_started_at ?? b.start_date_time).getTime();
        return ta - tb;
      });
    if (!active.length) {
      this.attentionBannerRows.set([]);
      return;
    }
    if (this.tenant.isAdmin()) {
      this.attentionBannerRows.set(active);
      return;
    }
    const uid = this.tenant.profile()?.id ?? null;
    if (!uid) {
      this.attentionBannerRows.set([]);
      return;
    }
    const own = active.filter((r) => r.user_id === uid);
    this.attentionBannerRows.set(own.length ? [own[0]!] : []);
  }

  protected hasAttentionBanner(): boolean {
    return this.attentionBannerRows().length > 0;
  }

  protected attentionCardTitle(r: ApptRow): string {
    const pet = r.pet?.name?.trim() || 'Mascota';
    const customer = r.customer?.name?.trim() || 'Cliente';
    return `${pet} · ${customer}`;
  }

  protected attentionCardSubtitle(r: ApptRow): string {
    const service = r.service?.name?.trim() || 'Servicio';
    if (this.tenant.isAdmin()) {
      const vet = r.vet?.name?.trim() || 'Veterinario';
      return `${service} · ${vet}`;
    }
    return service;
  }

  protected attentionElapsedLabel(r: ApptRow): string {
    this.attentionTick();
    const iso = r.attention_started_at;
    if (!iso) return '0 min';
    const mins = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (h > 0) return `${h}h ${m}m`;
    return `${m} min`;
  }

  protected attentionStartLabel(r: ApptRow): string {
    const iso = r.attention_started_at;
    if (!iso) return 'Inicio no registrado';
    return new Intl.DateTimeFormat('es-CO', {
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso));
  }

  private buildQuickPayloadFromRow(r: ApptRow): QuickApptPayload {
    const b = this.tenant.profile()?.business;
    const fmt = new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short' });
    const startLabel = r.start_date_time ? fmt.format(new Date(r.start_date_time)) : '';
    const endLabel = r.end_date_time ? fmt.format(new Date(r.end_date_time)) : '';
    return {
      id: r.id,
      userId: r.user_id,
      vetName: r.vet?.name?.trim() ?? '',
      petId: r.pet?.id ?? '',
      customerId: r.customer?.id ?? '',
      customerPhone: r.customer?.phone ?? null,
      customerName: r.customer?.name ?? '',
      petName: r.pet?.name ?? '',
      petSpecies: r.pet?.species ?? null,
      serviceId: r.service?.id ?? '',
      serviceName: r.service?.name?.trim() ?? '',
      serviceDurationMinutes: r.service?.duration_minutes ?? 30,
      servicePrice: Number(r.service?.price ?? 0),
      attentionStartedAt: r.attention_started_at ?? null,
      statusId: r.status_id,
      statusName: r.status?.name ?? '',
      statuses: this.statuses(),
      businessPhone: b?.phone ?? null,
      businessAddress: b?.address ?? null,
      businessName: b?.name ?? this.tenant.profile()?.business?.name ?? '',
      startLabel,
      endLabel,
      startIso: r.start_date_time,
      endIso: r.end_date_time,
    };
  }

  protected openAttentionFromBanner(r: ApptRow) {
    const payload = this.buildQuickPayloadFromRow(r);
    this.dialog.open(AppointmentQuickDialog, {
      width: 'min(680px, calc(100vw - 32px))',
      maxWidth: '96vw',
      maxHeight: 'min(92vh, 920px)',
      panelClass: 'appt-quick-dialog-panel',
      data: payload,
      disableClose: isInAttention(r),
    })
      .afterClosed()
      .subscribe(() => {
        this.cal()?.getApi()?.refetchEvents();
      });
  }

  private onEventClick(arg: EventClickArg) {
    const r = arg.event.extendedProps['raw'] as ApptRow;
    if (!r) return;
    const payload = this.buildQuickPayloadFromRow(r);
    this.dialog.open(AppointmentQuickDialog, {
      width: 'min(680px, calc(100vw - 32px))',
      maxWidth: '96vw',
      maxHeight: 'min(92vh, 920px)',
      panelClass: 'appt-quick-dialog-panel',
      data: payload,
      disableClose: isInAttention(r),
    })
      .afterClosed()
      .subscribe(() => {
        // Refrescar siempre para levantar cambios hechos dentro del modal
        // (ej. iniciar atención) incluso cuando se cierra sin "guardar estado".
        this.cal()?.getApi()?.refetchEvents();
      });
  }

  private async onEventDropResize(arg: EventDropArg | EventChangeArg) {
    const ev = arg.event;
    const raw = ev.extendedProps['raw'] as ApptRow | undefined;
    if (raw?.status?.name !== 'Agendada') {
      arg.revert();
      return;
    }
    const vetId = ev.extendedProps['vetId'] as string;
    const start = ev.start;
    const end = ev.end;
    if (!start || !end) {
      arg.revert();
      return;
    }
    try {
      const overlap = await this.appts.hasOverlap(vetId, start, end, ev.id);
      if (overlap) {
        this.snack.open('Horario ocupado para ese veterinario', 'OK', { duration: 3500 });
        arg.revert();
        return;
      }
      const { error } = await this.appts.updateTimes(ev.id, start.toISOString(), end.toISOString());
      if (error) throw error;
    } catch {
      arg.revert();
      this.snack.open('No se pudo mover la cita', 'OK', { duration: 3500 });
    }
  }

  private onDateClick(arg: { date: Date; allDay: boolean; view: { type: string } }) {
    if (arg.allDay) return;
    const d = arg.date;
    const vid = this.filterVetId();
    this.dialog
      .open(AppointmentFormDialog, {
        width: 'min(480px, 100vw)',
        data: { defaultStart: d, defaultVetId: vid },
      })
      .afterClosed()
      .subscribe((ok) => {
        if (ok) this.cal()?.getApi()?.refetchEvents();
      });
  }

  newAppointment() {
    const vid = this.filterVetId();
    this.dialog
      .open(AppointmentFormDialog, {
        width: 'min(480px, 100vw)',
        data: { defaultVetId: vid },
      })
      .afterClosed()
      .subscribe((ok) => {
        if (ok) this.cal()?.getApi()?.refetchEvents();
      });
  }
}
