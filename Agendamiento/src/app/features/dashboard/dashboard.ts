import { DatePipe, DecimalPipe, NgClass } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatIconModule } from '@angular/material/icon';
import { MatDividerModule } from '@angular/material/divider';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TenantContextService } from '../../core/tenant-context.service';
import { SUPABASE_CLIENT } from '../../core/supabase';
import { CopCurrencyPipe } from '../../shared/pipes/cop-currency.pipe';
import { AppointmentsData, todayYmdLocal } from '../appointments/appointments.data';

interface KpiJson {
  revenue?: number;
  appointments_completed?: number;
  appointments_by_status?: { status_name: string; cnt: number }[];
}

interface NamedCount {
  name: string;
  count: number;
}

/** Servicios más demandados: nombre + precio lista + conteo. */
interface ServiceDemandRow {
  name: string;
  count: number;
  unitPrice: number;
}

interface NamedAmount {
  name: string;
  amount: number;
}

interface DayPoint {
  label: string;
  value: number;
}

interface DonutSlice {
  name: string;
  count: number;
  pct: number;
  color: string;
}

interface AgendaRow {
  id: string;
  start_date_time: string;
  end_date_time: string;
  pet: { name: string } | null;
  customer: { name: string; phone?: string | null } | null;
  service: { name: string } | null;
  status: { id: number; name: string } | null;
}

interface FollowUpRow {
  next_visit_date: string;
  treatment: string | null;
  pet: { name: string } | null;
}

interface TopPetRow {
  petName: string;
  customerName: string;
  phone: string;
  count: number;
}

interface RawAppointment {
  user_id: string;
  service_id: string;
  status_id: number;
  start_date_time: string;
  end_date_time: string;
  pet_id: string;
  customer_id: string;
  status: { name: string } | null;
  vet: { name: string } | null;
  pet: { name: string } | null;
  customer: { name: string; phone?: string | null } | null;
}

interface RawPayment {
  amount: number | string;
  created_at: string;
  payment_method: string;
}

interface RawPaymentVet {
  amount: number | string;
  created_at: string;
  appointment: { user_id: string; business_id: string } | null;
}

function startOfLocalDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDays(d: Date, n: number): Date {
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

function pctChange(today: number, yest: number): number | null {
  if (yest <= 0 && today <= 0) return null;
  if (yest <= 0) return null;
  return Math.round(((today - yest) / yest) * 1000) / 10;
}

const STATUS_COLORS: Record<string, string> = {
  Agendada: '#5c6bc0',
  Confirmada: '#00897b',
  Completada: '#43a047',
  Cancelada: '#9e9e9e',
  NoShow: '#e53935',
};

@Component({
  selector: 'app-dashboard',
  imports: [
    DatePipe,
    DecimalPipe,
    NgClass,
    RouterLink,
    MatCardModule,
    MatButtonModule,
    MatProgressSpinnerModule,
    MatIconModule,
    MatDividerModule,
    MatButtonToggleModule,
    MatTooltipModule,
    CopCurrencyPipe,
  ],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Dashboard implements OnInit {
  private readonly supabase = inject(SUPABASE_CLIENT);
  private readonly appts = inject(AppointmentsData);
  protected readonly tenant = inject(TenantContextService);

  /** Rango global del panel: gráficas, top mascotas y productividad (KPIs del día y score usan ventanas fijas). */
  protected readonly chartPeriod = signal<'1' | '7' | '30'>('7');

  /** Tasas a 30 días solo para score del día y recomendaciones (no cambian al alternar 1|7|30). */
  private scoreCancelRatePct = 0;
  private scoreNoShowRatePct = 0;

  private paymentsRaw: RawPayment[] = [];
  private paymentsVetRaw: RawPaymentVet[] = [];
  private apptsRaw: RawAppointment[] = [];
  private staffNameById = new Map<string, string>();
  private serviceMetaCache = new Map<string, { name: string; price: number }>();

  protected readonly loading = signal(true);

  protected readonly todayRevenue = signal(0);
  protected readonly yesterdayRevenue = signal(0);
  protected readonly todayAppointments = signal(0);
  protected readonly todayCompleted = signal(0);
  protected readonly todayCancelled = signal(0);
  protected readonly todayNoShow = signal(0);
  protected readonly petsAttendedToday = signal(0);

  /** Totales del día anterior (para comparación en KPIs). */
  protected readonly yesterdayAppointments = signal(0);
  protected readonly yesterdayCompleted = signal(0);
  protected readonly yesterdayBadTotal = signal(0);
  protected readonly yesterdayPetsAttended = signal(0);

  protected readonly revenueByDay = signal<DayPoint[]>([]);
  protected readonly statusDonut = signal<DonutSlice[]>([]);
  protected readonly vetsBars = signal<NamedCount[]>([]);
  protected readonly servicesBars = signal<ServiceDemandRow[]>([]);
  protected readonly paymentDonut = signal<DonutSlice[]>([]);
  protected readonly vetRevenueBars = signal<NamedAmount[]>([]);

  protected readonly agendaToday = signal<AgendaRow[]>([]);
  protected readonly freeSlotsToday = signal<number | null>(null);
  protected readonly alertsUnconfirmed = signal(0);
  protected readonly alertsReminders = signal(0);
  protected readonly followUps = signal<FollowUpRow[]>([]);

  protected readonly newCustomersRegistered30 = signal(0);
  protected readonly topPets = signal<TopPetRow[]>([]);

  protected readonly avgAppointmentMin = signal<number | null>(null);
  protected readonly cancelRate = signal<number | null>(null);
  protected readonly noShowRate = signal<number | null>(null);

  protected readonly dayScore = signal<'good' | 'mid' | 'bad'>('mid');
  protected readonly recommendation = signal<string | null>(null);

  private statusByName = new Map<string, number>();

  protected readonly revDelta = computed(() =>
    pctChange(this.todayRevenue(), this.yesterdayRevenue()),
  );

  protected readonly aptDelta = computed(() =>
    pctChange(this.todayAppointments(), this.yesterdayAppointments()),
  );

  protected readonly completedDelta = computed(() =>
    pctChange(this.todayCompleted(), this.yesterdayCompleted()),
  );

  /** Canceladas + NoShow: más que ayer = peor (usar clases invertidas en plantilla). */
  protected readonly badEventsDelta = computed(() =>
    pctChange(
      this.todayCancelled() + this.todayNoShow(),
      this.yesterdayBadTotal(),
    ),
  );

  protected readonly petsDelta = computed(() =>
    pctChange(this.petsAttendedToday(), this.yesterdayPetsAttended()),
  );

  protected readonly revenueLinePoints = computed(() => {
    const pts = this.revenueByDay();
    if (pts.length === 0) return '';
    const max = Math.max(...pts.map((p) => p.value), 1);
    const w = 100;
    const h = 36;
    if (pts.length === 1) {
      const y = h - (pts[0].value / max) * h;
      return `0,${y} 100,${y}`;
    }
    return pts
      .map((p, i) => {
        const x = (i / (pts.length - 1)) * w;
        const y = h - (p.value / max) * h;
        return `${x},${y}`;
      })
      .join(' ');
  });

  protected readonly revenueLineArea = computed(() => {
    const pts = this.revenueByDay();
    if (pts.length === 0) return '';
    const line = this.revenueLinePoints();
    return `${line} 100,36 0,36`;
  });

  protected payMethodLabel(method: string): string {
    const labels: Record<string, string> = {
      Cash: 'Efectivo',
      Card: 'Tarjeta',
      Transfer: 'Transferencia',
    };
    return labels[method] ?? method;
  }

  protected statusColor(name: string | undefined): string {
    if (!name) return 'var(--mat-sys-outline)';
    return STATUS_COLORS[name] ?? 'var(--mat-sys-primary)';
  }

  protected donutGradient(slices: DonutSlice[]): string {
    if (!slices.length) return 'conic-gradient(var(--mat-sys-surface-variant) 0deg 360deg)';
    let acc = 0;
    const parts: string[] = [];
    for (const s of slices) {
      const deg = (s.pct / 100) * 360;
      const start = acc;
      acc += deg;
      parts.push(`${s.color} ${start}deg ${acc}deg`);
    }
    return `conic-gradient(${parts.join(', ')})`;
  }

  protected barPct(max: number, n: number): number {
    if (max <= 0) return 0;
    return Math.round((n / max) * 100);
  }

  protected maxNamed(rows: NamedCount[]): number {
    return rows.reduce((m, r) => Math.max(m, r.count), 0);
  }

  protected maxServiceDemand(rows: ServiceDemandRow[]): number {
    return rows.reduce((m, r) => Math.max(m, r.count), 0);
  }

  protected maxAmount(rows: NamedAmount[]): number {
    return rows.reduce((m, r) => Math.max(m, r.amount), 0);
  }

  async ngOnInit() {
    await this.load();
  }

  private chartRangeFrom(period: '1' | '7' | '30', today0: Date): Date {
    if (period === '1') return today0;
    if (period === '7') return addDays(today0, -6);
    return addDays(today0, -29);
  }

  private filterApptsByPeriod(
    rows: RawAppointment[],
    period: '1' | '7' | '30',
    today0: Date,
    now: Date,
  ): RawAppointment[] {
    const from = this.chartRangeFrom(period, today0).getTime();
    const to = now.getTime();
    return rows.filter((a) => {
      const t = new Date(a.start_date_time).getTime();
      return t >= from && t < to;
    });
  }

  private filterPaymentsByPeriod(
    rows: RawPayment[],
    period: '1' | '7' | '30',
    today0: Date,
    now: Date,
  ): RawPayment[] {
    const from = this.chartRangeFrom(period, today0).getTime();
    const to = now.getTime();
    return rows.filter((p) => {
      const t = new Date(p.created_at).getTime();
      return t >= from && t <= to;
    });
  }

  private filterPaymentsVetByPeriod(
    rows: RawPaymentVet[],
    period: '1' | '7' | '30',
    today0: Date,
    now: Date,
  ): RawPaymentVet[] {
    const from = this.chartRangeFrom(period, today0).getTime();
    const to = now.getTime();
    return rows.filter((p) => {
      const t = new Date(p.created_at).getTime();
      return t >= from && t <= to;
    });
  }

  /** Ventana 30 días calendario: score del día y recomendaciones (estable al cambiar 1|7|30). */
  private filterApptsLast30d(rows: RawAppointment[], today0: Date, now: Date): RawAppointment[] {
    const from = addDays(today0, -29).getTime();
    const to = now.getTime();
    return rows.filter((a) => {
      const t = new Date(a.start_date_time).getTime();
      return t >= from && t < to;
    });
  }

  private computeProductivityMetrics(rows: RawAppointment[]): {
    avgMin: number | null;
    cancelPct: number | null;
    noShowPct: number | null;
  } {
    let durSumMin = 0;
    let durN = 0;
    let cancelC = 0;
    let totalC = 0;
    let noshowC = 0;
    const completedId = this.statusByName.get('Completada');
    for (const a of rows) {
      totalC++;
      const sn = a.status?.name;
      if (sn === 'Cancelada') cancelC++;
      if (sn === 'NoShow') noshowC++;
      if (a.status_id === completedId) {
        const start = new Date(a.start_date_time).getTime();
        const end = new Date(a.end_date_time).getTime();
        if (end > start) {
          durSumMin += (end - start) / 60000;
          durN++;
        }
      }
    }
    return {
      avgMin: durN ? Math.round((durSumMin / durN) * 10) / 10 : null,
      cancelPct: totalC ? Math.round((cancelC / totalC) * 1000) / 10 : null,
      noShowPct: totalC ? Math.round((noshowC / totalC) * 1000) / 10 : null,
    };
  }

  private applyChartAggregates(now: Date, today0: Date) {
    const period = this.chartPeriod();
    const apChart = this.filterApptsByPeriod(this.apptsRaw, period, today0, now);
    const payChart = this.filterPaymentsByPeriod(this.paymentsRaw, period, today0, now);
    const payVetChart = this.filterPaymentsVetByPeriod(this.paymentsVetRaw, period, today0, now);

    if (period === '1') {
      this.revenueByDay.set(this.bucketPaymentsByHourToday(payChart, today0, now));
    } else {
      this.revenueByDay.set(
        this.bucketPaymentsByDay(payChart, this.chartRangeFrom(period, today0), now),
      );
    }

    const statusMap = new Map<string, number>();
    for (const a of apChart) {
      const n = a.status?.name ?? '—';
      statusMap.set(n, (statusMap.get(n) ?? 0) + 1);
    }
    const stTotal = [...statusMap.values()].reduce((s, v) => s + v, 0) || 1;
    this.statusDonut.set(
      [...statusMap.entries()].map(([name, cnt]) => ({
        name,
        count: cnt,
        pct: Math.round((cnt / stTotal) * 1000) / 10,
        color: this.statusColor(name),
      })),
    );

    const vetMap = new Map<string, { count: number; label: string }>();
    for (const a of apChart) {
      const label = (
        a.vet?.name ??
        this.staffNameById.get(a.user_id) ??
        'Veterinario'
      ).trim() || 'Veterinario';
      const prev = vetMap.get(a.user_id);
      if (prev) {
        vetMap.set(a.user_id, { ...prev, count: prev.count + 1 });
      } else {
        vetMap.set(a.user_id, { count: 1, label });
      }
    }
    this.vetsBars.set(
      [...vetMap.values()]
        .map((v) => ({ name: v.label, count: v.count }))
        .sort((a, b) => b.count - a.count),
    );

    const svcMap = new Map<string, number>();
    for (const a of apChart) {
      svcMap.set(a.service_id, (svcMap.get(a.service_id) ?? 0) + 1);
    }
    this.servicesBars.set(
      [...svcMap.entries()]
        .map(([id, count]) => {
          const meta = this.serviceMetaCache.get(id);
          return {
            name: meta?.name ?? 'Servicio',
            count,
            unitPrice: Number(meta?.price ?? 0),
          };
        })
        .sort((a, b) => b.count - a.count)
        .slice(0, 8),
    );

    const pmAgg = new Map<string, number>();
    for (const p of payChart) {
      const method = p.payment_method;
      if (!method) continue;
      const amt = Number(p.amount);
      pmAgg.set(method, (pmAgg.get(method) ?? 0) + amt);
    }
    const pmTotal = [...pmAgg.values()].reduce((s, v) => s + v, 0) || 1;
    const pmColors: Record<string, string> = {
      Cash: 'color-mix(in srgb, var(--mat-sys-tertiary) 88%, white)',
      Card: 'color-mix(in srgb, var(--mat-sys-primary) 88%, white)',
      Transfer: 'color-mix(in srgb, var(--mat-sys-primary) 45%, var(--mat-sys-tertiary) 55%)',
    };
    this.paymentDonut.set(
      [...pmAgg.entries()].map(([name, v]) => ({
        name,
        count: Math.round(v),
        pct: Math.round((v / pmTotal) * 1000) / 10,
        color: pmColors[name] ?? 'var(--mat-sys-tertiary)',
      })),
    );

    const vetRev = new Map<string, { amount: number; label: string }>();
    for (const p of payVetChart) {
      const ap = p.appointment;
      if (!ap?.user_id) continue;
      const amt = Number(p.amount);
      const label = (this.staffNameById.get(ap.user_id) ?? 'Veterinario').trim() || 'Veterinario';
      const cur = vetRev.get(ap.user_id);
      if (cur) vetRev.set(ap.user_id, { amount: cur.amount + amt, label: cur.label });
      else vetRev.set(ap.user_id, { amount: amt, label });
    }
    this.vetRevenueBars.set(
      [...vetRev.values()]
        .map((v) => ({ name: v.label, amount: v.amount }))
        .sort((a, b) => b.amount - a.amount),
    );

    const prod = this.computeProductivityMetrics(apChart);
    this.avgAppointmentMin.set(prod.avgMin);
    this.cancelRate.set(prod.cancelPct);
    this.noShowRate.set(prod.noShowPct);

    const petCounts = new Map<string, number>();
    const petMeta = new Map<string, { petName: string; customerName: string; phone: string }>();
    for (const a of apChart) {
      const pid = a.pet_id;
      petCounts.set(pid, (petCounts.get(pid) ?? 0) + 1);
      if (!petMeta.has(pid)) {
        petMeta.set(pid, {
          petName: a.pet?.name ?? 'Mascota',
          customerName: a.customer?.name ?? '—',
          phone: a.customer?.phone ?? '—',
        });
      }
    }
    this.topPets.set(
      [...petCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([pid, count]) => {
          const m = petMeta.get(pid);
          return {
            petName: m?.petName ?? 'Mascota',
            customerName: m?.customerName ?? '—',
            phone: m?.phone ?? '—',
            count,
          };
        }),
    );
  }

  async load() {
    const client = this.supabase;
    const bid = this.tenant.businessId();
    if (!client || !bid) {
      this.loading.set(false);
      return;
    }

    const now = new Date();
    const today0 = startOfLocalDay(now);
    const tomorrow = addDays(today0, 1);
    const yesterday0 = addDays(today0, -1);
    const d30From = addDays(today0, -29);

    const t0 = today0.toISOString();
    const t1 = tomorrow.toISOString();
    const y0 = yesterday0.toISOString();
    const y1 = today0.toISOString();

    try {
      const { data: statuses } = await client.from('appointment_status').select('id, name');
      for (const s of statuses ?? []) {
        this.statusByName.set(s.name as string, s.id as number);
      }

      const [
        kToday,
        kYest,
        paymentsRes,
        paymentsVetRes,
        apptsRes,
        apptsTodayList,
        petsDone,
        petsYesterday,
        svcAllRes,
        staffAllRes,
        svcRow,
        customersCountRes,
        nextVisits,
        remindersBad,
      ] = await Promise.all([
        client.rpc('get_kpis', { p_from: t0, p_to: t1 }),
        client.rpc('get_kpis', { p_from: y0, p_to: y1 }),
        client
          .from('payment')
          .select('amount, created_at, payment_method')
          .gte('created_at', d30From.toISOString())
          .lte('created_at', now.toISOString()),
        client
          .from('payment')
          .select(
            'amount, created_at, appointment:appointment_id!inner(user_id, business_id)',
          )
          .eq('appointment.business_id', bid)
          .gte('created_at', d30From.toISOString())
          .lte('created_at', now.toISOString()),
        client
          .from('appointment')
          .select(
            `
            user_id,
            service_id,
            status_id,
            start_date_time,
            end_date_time,
            pet_id,
            customer_id,
            status:status_id(name),
            vet:user_id(name),
            pet:pet_id(name),
            customer:customer_id(name, phone)
          `,
          )
          .eq('business_id', bid)
          .gte('start_date_time', d30From.toISOString())
          .lt('start_date_time', now.toISOString()),
        client
          .from('appointment')
          .select(
            `
            id,
            start_date_time,
            end_date_time,
            pet:pet_id (name),
            customer:customer_id (name, phone),
            service:service_id (name),
            status:status_id (id, name)
          `,
          )
          .eq('business_id', bid)
          .gte('start_date_time', t0)
          .lt('start_date_time', t1)
          .order('start_date_time'),
        client
          .from('appointment')
          .select('pet_id')
          .eq('business_id', bid)
          .gte('start_date_time', t0)
          .lt('start_date_time', t1)
          .eq('status_id', this.statusByName.get('Completada') ?? -1),
        client
          .from('appointment')
          .select('pet_id')
          .eq('business_id', bid)
          .gte('start_date_time', y0)
          .lt('start_date_time', y1)
          .eq('status_id', this.statusByName.get('Completada') ?? -1),
        client.from('service').select('id, name, price').eq('business_id', bid),
        client.from('staff').select('id, name, active').eq('business_id', bid),
        client.from('service').select('id').eq('business_id', bid).eq('active', true).limit(1).maybeSingle(),
        client
          .from('customer')
          .select('id', { count: 'exact', head: true })
          .eq('business_id', bid)
          .gte('created_at', d30From.toISOString()),
        client
          .from('medical_record')
          .select('next_visit_date, treatment, pet:pet_id(name)')
          .not('next_visit_date', 'is', null)
          .gte('next_visit_date', ymdLocal(today0))
          .order('next_visit_date')
          .limit(8),
        client
          .from('reminder')
          .select('id, sent, appointment:appointment_id!inner(start_date_time, business_id)')
          .eq('sent', false),
      ]);

      this.paymentsRaw = (paymentsRes.data ?? []) as RawPayment[];
      this.paymentsVetRaw = (paymentsVetRes.data ?? []) as unknown as RawPaymentVet[];
      this.apptsRaw = (apptsRes.data ?? []) as unknown as RawAppointment[];

      this.serviceMetaCache.clear();
      for (const row of svcAllRes.data ?? []) {
        const s = row as { id: string; name: string; price?: number | string | null };
        this.serviceMetaCache.set(s.id, {
          name: s.name,
          price: Number(s.price ?? 0),
        });
      }
      this.staffNameById.clear();
      for (const row of staffAllRes.data ?? []) {
        const s = row as { id: string; name: string };
        this.staffNameById.set(s.id, s.name);
      }
      const staffActiveList = (staffAllRes.data ?? []).filter(
        (r) => (r as { active?: boolean }).active !== false,
      ) as { id: string; name: string }[];

      const jToday = (kToday.data ?? {}) as KpiJson;
      const jYest = (kYest.data ?? {}) as KpiJson;

      this.todayRevenue.set(Number(jToday.revenue ?? 0));
      this.yesterdayRevenue.set(Number(jYest.revenue ?? 0));
      this.todayCompleted.set(Number(jToday.appointments_completed ?? 0));

      const byToday = jToday.appointments_by_status ?? [];
      let cancel = 0;
      let noshow = 0;
      let totalToday = 0;
      for (const row of byToday) {
        totalToday += row.cnt;
        if (row.status_name === 'Cancelada') cancel = row.cnt;
        if (row.status_name === 'NoShow') noshow = row.cnt;
      }
      this.todayAppointments.set(totalToday);
      this.todayCancelled.set(cancel);
      this.todayNoShow.set(noshow);

      this.yesterdayCompleted.set(Number(jYest.appointments_completed ?? 0));
      const byYest = jYest.appointments_by_status ?? [];
      let yTotal = 0;
      let yCancel = 0;
      let yNoShow = 0;
      for (const row of byYest) {
        yTotal += row.cnt;
        if (row.status_name === 'Cancelada') yCancel = row.cnt;
        if (row.status_name === 'NoShow') yNoShow = row.cnt;
      }
      this.yesterdayAppointments.set(yTotal);
      this.yesterdayBadTotal.set(yCancel + yNoShow);

      const donePets = new Set((petsDone.data ?? []).map((r: { pet_id: string }) => r.pet_id));
      this.petsAttendedToday.set(donePets.size);
      const donePetsYest = new Set(
        (petsYesterday.data ?? []).map((r: { pet_id: string }) => r.pet_id),
      );
      this.yesterdayPetsAttended.set(donePetsYest.size);

      this.applyChartAggregates(now, today0);

      const unconfId = this.statusByName.get('Agendada');
      const todayRows = (apptsTodayList.data ?? []) as unknown as AgendaRow[];
      this.agendaToday.set(todayRows);
      this.alertsUnconfirmed.set(todayRows.filter((r) => r.status?.id === unconfId).length);
      const remRows = (remindersBad.data ?? []) as unknown as {
        appointment?: { start_date_time: string; business_id: string };
      }[];
      this.alertsReminders.set(
        remRows.filter(
          (r) =>
            r.appointment?.business_id === bid &&
            r.appointment?.start_date_time >= t0 &&
            r.appointment?.start_date_time < t1,
        ).length,
      );

      this.followUps.set((nextVisits.data ?? []) as unknown as FollowUpRow[]);

      this.newCustomersRegistered30.set(customersCountRes.count ?? 0);

      const svcId = (svcRow.data as { id: string } | null)?.id;
      const ymd = todayYmdLocal();
      if (svcId && staffActiveList.length) {
        const slots = await Promise.all(
          staffActiveList.map((s) =>
            this.appts.getAvailableSlots({ userId: s.id, serviceId: svcId, onDate: ymd }).catch(() => []),
          ),
        );
        this.freeSlotsToday.set(slots.reduce((a, b) => a + b.length, 0));
      } else {
        this.freeSlotsToday.set(null);
      }

      const apScore = this.filterApptsLast30d(this.apptsRaw, today0, now);
      const scoreP = this.computeProductivityMetrics(apScore);
      this.scoreCancelRatePct = scoreP.cancelPct ?? 0;
      this.scoreNoShowRatePct = scoreP.noShowPct ?? 0;
      this.computeScoreAndTip();
      this.recommendation.set(this.buildRecommendation());
    } catch (e) {
      console.error(e);
    } finally {
      this.loading.set(false);
    }
  }

  /** 1 día: ingresos por hora (6h–21h) del día local. */
  private bucketPaymentsByHourToday(
    rows: { amount: number | string; created_at: string }[],
    today0: Date,
    now: Date,
  ): DayPoint[] {
    const startH = 6;
    const endH = 21;
    const pts: DayPoint[] = [];
    for (let h = startH; h <= endH; h++) {
      pts.push({ label: `${h}h`, value: 0 });
    }
    const dayStr = ymdLocal(today0);
    const endMs = now.getTime();
    for (const r of rows) {
      const t = new Date(r.created_at);
      if (ymdLocal(t) !== dayStr) continue;
      if (t.getTime() > endMs) continue;
      const h = t.getHours();
      if (h < startH || h > endH) continue;
      pts[h - startH].value += Number(r.amount);
    }
    return pts;
  }

  private bucketPaymentsByDay(
    rows: { amount: number | string; created_at: string }[],
    from: Date,
    to: Date,
  ): DayPoint[] {
    const map = new Map<string, number>();
    for (let d = new Date(from); d <= to; d = addDays(d, 1)) {
      map.set(ymdLocal(d), 0);
    }
    for (const r of rows) {
      const day = ymdLocal(new Date(r.created_at));
      if (!map.has(day)) continue;
      map.set(day, (map.get(day) ?? 0) + Number(r.amount));
    }
    const keys = [...map.keys()].sort();
    return keys.map((label) => ({ label: label.slice(5), value: map.get(label) ?? 0 }));
  }

  private computeScoreAndTip() {
    const revOk = this.todayRevenue() >= this.yesterdayRevenue() * 0.75 || this.todayRevenue() > 0;
    const cr = this.scoreCancelRatePct;
    const ns = this.scoreNoShowRatePct;
    if (revOk && cr < 18 && ns < 12) this.dayScore.set('good');
    else if (cr > 28 || ns > 22 || (!revOk && this.yesterdayRevenue() > 0)) this.dayScore.set('bad');
    else this.dayScore.set('mid');
  }

  private buildRecommendation(): string | null {
    const ns = this.scoreNoShowRatePct;
    if (ns > 15) return 'La tasa de inasistencias es alta: refuerza recordatorios por WhatsApp el día anterior.';
    const cr = this.scoreCancelRatePct;
    if (cr > 22) return 'Muchas cancelaciones: revisa política de reserva o confirma citas con más antelación.';
    const free = this.freeSlotsToday();
    if (free != null && free > 8)
      return `Tienes ${free} huecos libres hoy: conviene una campaña a clientes inactivos o promoción puntual.`;
    return null;
  }

  protected onPeriodChange(value: string | null | undefined) {
    if (value === '1' || value === '7' || value === '30') this.setChartPeriod(value);
  }

  protected setChartPeriod(p: '1' | '7' | '30') {
    this.chartPeriod.set(p);
    const now = new Date();
    const today0 = startOfLocalDay(now);
    this.applyChartAggregates(now, today0);
  }

  protected barPctMoney(max: number, n: number): number {
    if (max <= 0) return 0;
    return Math.round((n / max) * 100);
  }
}
