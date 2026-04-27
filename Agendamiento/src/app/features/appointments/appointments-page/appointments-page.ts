import { isPlatformBrowser } from '@angular/common';
import { Component, ElementRef, inject, OnDestroy, PLATFORM_ID, signal, viewChild } from '@angular/core';
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
  DayHeaderContentArg,
  EventHoveringArg,
  EventInput,
  NowIndicatorContentArg,
} from '@fullcalendar/core';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import esLocale from '@fullcalendar/core/locales/es';
import { FullCalendarComponent } from '@fullcalendar/angular';
import { AppointmentsData } from '../appointments.data';
import { AppointmentFormDialog } from '../appointment-form-dialog/appointment-form-dialog';
import { AppointmentQuickDialog, type QuickApptPayload } from '../appointment-quick-dialog/appointment-quick-dialog';
import {
  appointmentCalendarCellTheme,
  EVENT_TEXT_ON_CALENDAR_PASTEL,
} from '../../../core/appointment-status-theme';
import { TenantContextService } from '../../../core/tenant-context.service';
import { petAvatarFromSpecies } from '../../customers/pet-avatar.util';
import { ServicesData, staffRowsForScheduling, type StaffMini } from '../../services-schedule/services.data';
import { vetDisplayShort } from '../vet-calendar-display.util';

interface ApptRow {
  id: string;
  user_id: string;
  start_date_time: string;
  end_date_time: string;
  rescheduled_from_released_slot_id: string | null;
  attention_started_at: string | null;
  status_id: number;
  customer: { id: string; name: string; phone: string | null } | null;
  pet: { id: string; name: string; species: string | null } | null;
  service: { id: string; name: string; price: number; duration_minutes: number } | null;
  vet: { id: string; name: string } | null;
  status: { name: string } | null;
  appointment_earlier_slot_opt_in: { enabled: boolean } | null;
}

function isInAttention(row: ApptRow | null | undefined): boolean {
  if (!row?.attention_started_at) return false;
  const st = row.status?.name ?? '';
  return st !== 'Completada' && st !== 'Cancelada' && st !== 'NoShow';
}

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
  private readonly hostRef = inject(ElementRef<HTMLElement>);
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

  /** Leyenda del calendario (mismos colores que las citas). */
  protected readonly appointmentStatusLegend = [
    'Agendada',
    'Confirmada',
    'Completada',
    'Cancelada',
    'NoShow',
  ] as const;

  /** Estados visibles en el calendario (clic en la leyenda para alternar). */
  protected readonly statusFilterActive = signal<Set<string>>(
    new Set(['Agendada', 'Confirmada', 'Completada', 'Cancelada', 'NoShow']),
  );

  protected statusLegendSwatch(name: string): string {
    return appointmentCalendarCellTheme(name).bg;
  }

  protected isStatusFilteredOn(name: string): boolean {
    return this.statusFilterActive().has(name);
  }

  protected toggleStatusFilter(name: string): void {
    const cur = this.statusFilterActive();
    const next = new Set(cur);
    if (next.has(name)) {
      if (next.size <= 1) {
        this.snack.open('Debe quedar visible al menos un estado en la agenda.', 'OK', { duration: 2800 });
        return;
      }
      next.delete(name);
    } else {
      next.add(name);
    }
    this.statusFilterActive.set(next);
    queueMicrotask(() => this.cal()?.getApi()?.refetchEvents());
  }

  protected showAllStatuses(): void {
    this.statusFilterActive.set(
      new Set<string>(this.appointmentStatusLegend as unknown as string[]),
    );
    queueMicrotask(() => this.cal()?.getApi()?.refetchEvents());
  }

  protected allStatusesShown(): boolean {
    const s = this.statusFilterActive();
    return this.appointmentStatusLegend.every((x) => s.has(x));
  }

  /** Etiqueta corta para la pastilla de leyenda (mismo nombre que en BD salvo casos UX). */
  protected statusFilterLabel(key: string): string {
    if (key === 'NoShow') return 'Sin asistencia';
    return key;
  }

  protected statusFilterAriaToggle(key: string): string {
    const on = this.isStatusFilteredOn(key);
    const label = this.statusFilterLabel(key);
    return `${on ? 'Ocultar' : 'Mostrar'} citas ${label}`;
  }

  private apptHoverCard: HTMLDivElement | null = null;
  private apptHoverHideTimer: ReturnType<typeof setTimeout> | null = null;

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
    nowIndicator: true,
    nowIndicatorContent: (arg: NowIndicatorContentArg) => {
      if (!arg.isAxis) {
        return undefined;
      }
      const pill = document.createElement('span');
      pill.className = 'fc-now-time-pill';
      pill.textContent = new Intl.DateTimeFormat('es-CO', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(arg.date);
      return { domNodes: [pill] };
    },
    /** Encabezado por columna: nombre del día + número; hoy resaltado (pastilla). */
    dayHeaderContent: (arg: DayHeaderContentArg) => {
      const d = arg.date;
      const dowRaw = new Intl.DateTimeFormat('es', { weekday: 'short' })
        .format(d)
        .replace(/\./g, '')
        .trim();
      const dow = dowRaw
        .normalize('NFD')
        .replace(/\p{M}/gu, '')
        .toUpperCase();
      const wrap = document.createElement('div');
      wrap.className = 'fc-appt-day-head' + (arg.isToday ? ' fc-appt-day-head--today' : '');
      const dowEl = document.createElement('span');
      dowEl.className = 'fc-appt-day-head__dow';
      dowEl.textContent = dow;
      const numWrap = document.createElement('span');
      numWrap.className = 'fc-appt-day-head__num-wrap';
      const numEl = document.createElement('span');
      numEl.className =
        'fc-appt-day-head__num' + (arg.isToday ? ' fc-appt-day-head__num--today' : '');
      numEl.textContent = String(d.getDate());
      numWrap.appendChild(numEl);
      wrap.appendChild(dowEl);
      wrap.appendChild(numWrap);
      return { domNodes: [wrap] };
    },
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
    eventMouseEnter: (arg) => this.onEventMouseEnter(arg),
    eventMouseLeave: () => this.onEventMouseLeaveHover(),
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
      if (raw?.rescheduled_from_released_slot_id) {
        const release = document.createElement('span');
        release.className = 'fc-appt-custom__attention';
        release.textContent = 'Reprogramada por liberación';
        main.appendChild(release);
      }
      wrap.appendChild(avatar);
      wrap.appendChild(main);
      return { domNodes: [wrap] };
    },
    datesSet: (info) => {
      const host = this.hostRef.nativeElement;
      if (info.view.type === 'timeGridWeek') {
        host.classList.add('appt-cal--week-now-span');
      } else {
        host.classList.remove('appt-cal--week-now-span');
        this.removeWeekNowSpanLine();
      }
      this.scheduleWeekNowSpanLineUpdate();
    },
    viewDidMount: () => {
      this.scheduleWeekNowSpanLineUpdate();
    },
    windowResize: () => {
      this.scheduleWeekNowSpanLineUpdate();
    },
    eventsSet: () => {
      this.scheduleWeekNowSpanLineUpdate();
    },
  });

  /** Línea “ahora” a ancho completo en vista semana (overlay en `.fc-timegrid-cols`). */
  private weekNowBarEl: HTMLDivElement | null = null;
  private weekNowBarTimerId: ReturnType<typeof setInterval> | null = null;
  private readonly boundWeekNowResize = () => this.scheduleWeekNowSpanLineUpdate();

  constructor() {
    void this.loadStatuses();
    void this.loadVetOptions();
    void this.applyScheduleSlotBounds();
    this.attentionTimerId = setInterval(() => this.attentionTick.update((n) => n + 1), 1000);
    if (isPlatformBrowser(this.platformId)) {
      this.weekNowBarTimerId = setInterval(() => this.updateWeekNowSpanLine(), 60_000);
      window.addEventListener('resize', this.boundWeekNowResize);
    }
  }

  ngOnDestroy(): void {
    if (isPlatformBrowser(this.platformId)) {
      window.removeEventListener('resize', this.boundWeekNowResize);
    }
    if (this.weekNowBarTimerId != null) {
      clearInterval(this.weekNowBarTimerId);
      this.weekNowBarTimerId = null;
    }
    this.hostRef.nativeElement.classList.remove('appt-cal--week-now-span');
    this.removeWeekNowSpanLine();
    if (this.attentionTimerId != null) {
      clearInterval(this.attentionTimerId);
      this.attentionTimerId = null;
    }
    if (this.apptHoverHideTimer != null) {
      clearTimeout(this.apptHoverHideTimer);
      this.apptHoverHideTimer = null;
    }
    this.apptHoverCard?.remove();
    this.apptHoverCard = null;
  }

  private scheduleWeekNowSpanLineUpdate() {
    if (!isPlatformBrowser(this.platformId)) return;
    queueMicrotask(() => {
      setTimeout(() => this.updateWeekNowSpanLine(), 0);
    });
  }

  /**
   * FullCalendar solo pinta la línea en la columna del día actual; en semana duplicamos
   * una línea en `.fc-timegrid-cols` a todo el ancho y ocultamos las líneas por columna.
   */
  private updateWeekNowSpanLine() {
    if (!isPlatformBrowser(this.platformId)) return;
    const api = this.cal()?.getApi();
    if (!api || api.view.type !== 'timeGridWeek') {
      this.removeWeekNowSpanLine();
      return;
    }
    const root = this.hostRef.nativeElement.querySelector('.fc-timegrid') as HTMLElement | null;
    const cols = root?.querySelector('.fc-timegrid-cols') as HTMLElement | null;
    const line = root?.querySelector('.fc-timegrid-now-indicator-line') as HTMLElement | null;
    if (!cols || !line) {
      this.removeWeekNowSpanLine();
      return;
    }
    const lineRect = line.getBoundingClientRect();
    if (lineRect.width === 0 && lineRect.height === 0) {
      this.removeWeekNowSpanLine();
      return;
    }
    const colsRect = cols.getBoundingClientRect();
    const top = lineRect.top - colsRect.top;
    let bar = this.weekNowBarEl;
    if (!bar) {
      bar = document.createElement('div');
      bar.className = 'fc-week-span-now-line';
      bar.setAttribute('aria-hidden', 'true');
      cols.appendChild(bar);
      this.weekNowBarEl = bar;
    }
    bar.style.top = `${Math.max(0, top)}px`;
  }

  private removeWeekNowSpanLine() {
    if (this.weekNowBarEl?.parentNode) {
      this.weekNowBarEl.parentNode.removeChild(this.weekNowBarEl);
    }
    this.weekNowBarEl = null;
  }

  private ensureApptHoverCard(): HTMLDivElement {
    if (!this.apptHoverCard) {
      const el = document.createElement('div');
      el.className = 'fc-appt-hovercard';
      el.setAttribute('role', 'tooltip');
      this.hostRef.nativeElement.appendChild(el);
      this.apptHoverCard = el;
    }
    return this.apptHoverCard;
  }

  private onEventMouseEnter(arg: EventHoveringArg) {
    const raw = arg.event.extendedProps['raw'] as ApptRow | undefined;
    if (!raw) return;
    if (this.apptHoverHideTimer != null) {
      clearTimeout(this.apptHoverHideTimer);
      this.apptHoverHideTimer = null;
    }
    const card = this.ensureApptHoverCard();
    card.replaceChildren();
    const theme = appointmentCalendarCellTheme(raw.status?.name);

    const strip = document.createElement('div');
    strip.className = 'fc-appt-hovercard__strip';
    strip.style.background = theme.border;

    const body = document.createElement('div');
    body.className = 'fc-appt-hovercard__body';

    const title = document.createElement('div');
    title.className = 'fc-appt-hovercard__title';
    const pet = raw.pet?.name?.trim() || 'Mascota';
    const cust = raw.customer?.name?.trim() || 'Cliente';
    title.textContent = `${pet} · ${cust}`;
    body.appendChild(title);

    const phone = raw.customer?.phone?.trim();
    if (phone) {
      const row = document.createElement('div');
      row.className = 'fc-appt-hovercard__row';
      row.textContent = phone;
      body.appendChild(row);
    }

    const statusRow = document.createElement('div');
    statusRow.className = 'fc-appt-hovercard__row fc-appt-hovercard__row--muted';
    statusRow.textContent = `Estado: ${raw.status?.name ?? '—'}`;
    body.appendChild(statusRow);

    const svc = raw.service?.name?.trim();
    if (svc) {
      const srow = document.createElement('div');
      srow.className = 'fc-appt-hovercard__row fc-appt-hovercard__row--muted';
      srow.textContent = `Servicio: ${svc}`;
      body.appendChild(srow);
    }

    const vet = raw.vet?.name?.trim();
    if (vet) {
      const vrow = document.createElement('div');
      vrow.className = 'fc-appt-hovercard__row fc-appt-hovercard__row--muted';
      vrow.textContent = `Veterinario: ${vet}`;
      body.appendChild(vrow);
    }

    const timeFmt = new Intl.DateTimeFormat('es-CO', { hour: '2-digit', minute: '2-digit' });
    const tr = document.createElement('div');
    tr.className = 'fc-appt-hovercard__row fc-appt-hovercard__time';
    tr.textContent = `${timeFmt.format(new Date(raw.start_date_time))} – ${timeFmt.format(new Date(raw.end_date_time))}`;
    body.appendChild(tr);

    card.appendChild(strip);
    card.appendChild(body);

    this.positionApptHoverCard(arg.el, card);
    requestAnimationFrame(() => card.classList.add('fc-appt-hovercard--visible'));
  }

  private positionApptHoverCard(anchor: HTMLElement, card: HTMLDivElement) {
    const rect = anchor.getBoundingClientRect();
    const margin = 8;
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1024;
    const vh = typeof window !== 'undefined' ? window.innerHeight : 768;
    const cw = Math.min(300, vw - margin * 2);
    card.style.width = `${cw}px`;
    let left = rect.left;
    let top = rect.bottom + margin;
    if (left + cw > vw - margin) {
      left = vw - cw - margin;
    }
    if (left < margin) {
      left = margin;
    }
    const ch = card.offsetHeight || 200;
    if (top + ch > vh - margin) {
      top = Math.max(margin, rect.top - ch - margin);
    }
    card.style.left = `${left}px`;
    card.style.top = `${top}px`;
  }

  private onEventMouseLeaveHover() {
    if (this.apptHoverHideTimer != null) {
      clearTimeout(this.apptHoverHideTimer);
    }
    this.apptHoverHideTimer = setTimeout(() => {
      this.apptHoverCard?.classList.remove('fc-appt-hovercard--visible');
      this.apptHoverHideTimer = null;
    }, 120);
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
        setTimeout(() => this.scheduleWeekNowSpanLineUpdate(), 50);
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
      const rowsRaw = (data ?? []) as unknown as ApptRow[];
      const allowed = this.statusFilterActive();
      const rows = rowsRaw.filter((r) => allowed.has(r.status?.name ?? ''));
      if (this.tenant.isAdmin() && this.filterVetId()) {
        const allRes = await this.appts.listRange(start.toISOString(), end.toISOString(), null);
        if (allRes.error) throw allRes.error;
        const allRowsRaw = (allRes.data ?? []) as unknown as ApptRow[];
        this.updateAttentionBanner(allRowsRaw);
      } else {
        this.updateAttentionBanner(rowsRaw);
      }
      success(
        rows.map((r) => {
          const theme = appointmentCalendarCellTheme(r.status?.name);
          const inAttention = isInAttention(r);
          return {
            id: r.id,
            title: `${r.pet?.name ?? 'Mascota'} · ${r.customer?.name ?? 'Cliente'}`,
            start: r.start_date_time,
            end: r.end_date_time,
            backgroundColor: theme.bg,
            borderColor: theme.border,
            textColor: EVENT_TEXT_ON_CALENDAR_PASTEL,
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
      notifyIfEarlierSlot: r.appointment_earlier_slot_opt_in?.enabled === true,
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
