import { Component, inject, OnInit, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { SUPABASE_CLIENT } from '../../../core/supabase';
import { CopCurrencyPipe } from '../../../shared/pipes/cop-currency.pipe';
import {
  PET_SPECIES_GROUPS,
  PET_SPECIES_OTHER,
  speciesFromForm,
} from '../../customers/pet-form-dialog/pet-species.options';
import {
  REPORT_DEFINITIONS,
  type DateGrain,
  type ReportDefinition,
  type ReportId,
  type ReportRow,
} from '../report-types';
import { exportReportToExcel } from '../export-excel';

const DISPLAY_LIMIT = 500;
const EXPORT_LIMIT = 50_000;

@Component({
  selector: 'app-reports-page',
  imports: [
    ReactiveFormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatSelectModule,
    MatDatepickerModule,
    MatNativeDateModule,
    CopCurrencyPipe,
  ],
  templateUrl: './reports-page.html',
  styleUrl: './reports-page.scss',
})
export class ReportsPage implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly supabase = inject(SUPABASE_CLIENT);

  protected readonly definitions = REPORT_DEFINITIONS;
  protected readonly speciesGroups = PET_SPECIES_GROUPS;
  protected readonly speciesOtherVal = PET_SPECIES_OTHER;
  protected readonly loading = signal(false);
  protected readonly exportBusy = signal(false);
  protected readonly rows = signal<ReportRow[]>([]);
  protected readonly error = signal<string | null>(null);
  protected readonly selected = signal<ReportDefinition | null>(null);
  protected readonly staffOptions = signal<{ id: string; name: string }[]>([]);
  protected readonly displayLimit = DISPLAY_LIMIT;
  protected readonly exportLimit = EXPORT_LIMIT;

  protected readonly form = this.fb.group({
    from: this.fb.control<Date | null>(this.defaultFrom()),
    to: this.fb.control<Date | null>(this.defaultTo()),
    grain: this.fb.nonNullable.control<DateGrain>('month'),
    paymentMethod: this.fb.nonNullable.control(''),
    minCitas: this.fb.nonNullable.control(1),
    inactiveDays: this.fb.nonNullable.control(120),
    estado: this.fb.nonNullable.control<'Ambos' | 'Cancelada' | 'NoShow'>('Ambos'),
    speciesPreset: this.fb.nonNullable.control(''),
    speciesOther: this.fb.nonNullable.control(''),
    breed: this.fb.nonNullable.control(''),
    staffId: this.fb.nonNullable.control(''),
  });

  ngOnInit(): void {
    void this.loadStaff();
  }

  private defaultFrom(): Date {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  private defaultTo(): Date {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }

  private rangeIso(): { pFrom: string; pTo: string } | null {
    const from = this.form.controls.from.value;
    const to = this.form.controls.to.value;
    if (!from || !to) return null;
    const pFrom = new Date(from.getFullYear(), from.getMonth(), from.getDate(), 0, 0, 0, 0).toISOString();
    const pTo = new Date(to.getFullYear(), to.getMonth(), to.getDate(), 23, 59, 59, 999).toISOString();
    return { pFrom, pTo };
  }

  protected selectReport(def: ReportDefinition): void {
    this.selected.set(def);
    this.rows.set([]);
    this.error.set(null);
  }

  protected isSelected(id: ReportId): boolean {
    return this.selected()?.id === id;
  }

  /** Visual category for card accents (Financiero / Operacional / Clientes / Mascotas). */
  protected tagTone(tag: string): 'fin' | 'ops' | 'cli' | 'pets' {
    switch (tag) {
      case 'Financiero':
        return 'fin';
      case 'Clientes':
        return 'cli';
      case 'Mascotas':
        return 'pets';
      default:
        return 'ops';
    }
  }

  protected tagIcon(tag: string): string {
    switch (tag) {
      case 'Financiero':
        return 'account_balance';
      case 'Clientes':
        return 'diversity_3';
      case 'Mascotas':
        return 'pets';
      default:
        return 'analytics';
    }
  }

  protected reportOrdinal(index: number): string {
    return String(index + 1).padStart(2, '0');
  }

  /** Coerce JSON cell values for pipes. */
  protected num(v: unknown): number | null {
    if (v == null) return null;
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isNaN(n) ? null : n;
  }

  private paymentMethodLabel(v: unknown): string {
    if (v == null || v === '') return '—';
    const s = String(v).trim();
    if (s === '—') return '—';
    const map: Record<string, string> = {
      Cash: 'Efectivo',
      Card: 'Tarjeta',
      Transfer: 'Transferencia',
    };
    return map[s] ?? s;
  }

  private async loadStaff(): Promise<void> {
    const client = this.supabase;
    if (!client) return;
    const { data, error } = await client.from('staff').select('id, name').order('name');
    if (error) {
      console.error(error);
      return;
    }
    this.staffOptions.set((data ?? []) as { id: string; name: string }[]);
  }

  protected async runReport(): Promise<void> {
    await this.fetchReport(DISPLAY_LIMIT, true);
  }

  protected async exportExcel(): Promise<void> {
    const def = this.selected();
    if (!def) return;
    this.exportBusy.set(true);
    this.error.set(null);
    try {
      await this.fetchReport(EXPORT_LIMIT, false);
      const data = this.rows();
      await exportReportToExcel(def, data);
      await this.fetchReport(DISPLAY_LIMIT, true);
    } catch (e) {
      console.error(e);
      this.error.set('No se pudo exportar. Intenta de nuevo.');
    } finally {
      this.exportBusy.set(false);
    }
  }

  private async fetchReport(limit: number, useTableLoading: boolean): Promise<void> {
    const client = this.supabase;
    const def = this.selected();
    if (!client || !def) return;

    const range = this.rangeIso();
    if (!range) {
      this.error.set('Indica fecha desde y hasta.');
      return;
    }
    const { pFrom, pTo } = range;

    if (useTableLoading) this.loading.set(true);
    this.error.set(null);
    try {
      const f = this.form.getRawValue();
      let data: unknown;

      switch (def.id) {
        case 'revenue_by_service': {
          const { data: d, error } = await client.rpc('report_revenue_by_service', {
            p_from: pFrom,
            p_to: pTo,
            p_grain: f.grain,
            p_payment_method: f.paymentMethod.trim() || null,
            p_tz: 'America/Bogota',
          });
          if (error) throw error;
          const rows = Array.isArray(d) ? (d as ReportRow[]) : [];
          data = rows.map((row) => ({
            ...row,
            metodo_pago_principal: this.paymentMethodLabel(row['metodo_pago_principal']),
          }));
          break;
        }
        case 'staff_productivity': {
          const { data: d, error } = await client.rpc('report_staff_productivity', {
            p_from: pFrom,
            p_to: pTo,
            p_role: null,
            p_tz: 'America/Bogota',
          });
          if (error) throw error;
          data = d;
          break;
        }
        case 'customer_retention': {
          const { data: d, error } = await client.rpc('report_customer_retention', {
            p_from: pFrom,
            p_to: pTo,
            p_min_citas: f.minCitas,
            p_inactive_days: f.inactiveDays,
            p_tz: 'America/Bogota',
          });
          if (error) throw error;
          data = d;
          break;
        }
        case 'cancellations': {
          const { data: d, error } = await client.rpc('report_cancellations', {
            p_from: pFrom,
            p_to: pTo,
            p_estado: f.estado,
            p_tz: 'America/Bogota',
            p_limit: limit,
            p_offset: 0,
          });
          if (error) throw error;
          data = d;
          break;
        }
        case 'medical_history': {
          const speciesFilter = speciesFromForm(f.speciesPreset, f.speciesOther);
          const { data: d, error } = await client.rpc('report_medical_history', {
            p_from: pFrom,
            p_to: pTo,
            p_species: speciesFilter,
            p_breed: f.breed.trim() || null,
            p_tz: 'America/Bogota',
            p_limit: limit,
            p_offset: 0,
          });
          if (error) throw error;
          data = d;
          break;
        }
        case 'agenda_occupancy': {
          const { data: d, error } = await client.rpc('report_agenda_occupancy', {
            p_from: pFrom,
            p_to: pTo,
            p_staff_id: f.staffId.trim() || null,
            p_tz: 'America/Bogota',
          });
          if (error) throw error;
          data = d;
          break;
        }
        default:
          data = [];
      }

      this.rows.set(Array.isArray(data) ? (data as ReportRow[]) : []);
    } catch (e) {
      console.error(e);
      this.rows.set([]);
      this.error.set('No se pudo cargar el reporte. Verifica la conexión o los filtros.');
    } finally {
      if (useTableLoading) this.loading.set(false);
    }
  }
}
