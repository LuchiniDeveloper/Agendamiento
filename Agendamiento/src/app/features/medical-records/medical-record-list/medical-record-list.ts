import { Component, inject, input, OnInit, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatNativeDateModule } from '@angular/material/core';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatDialog } from '@angular/material/dialog';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TenantContextService } from '../../../core/tenant-context.service';
import { MedicalData, type MedicalRecordRow } from '../medical.data';
import { MedicalRecordDeleteDialog } from '../medical-record-delete-dialog/medical-record-delete-dialog';
import { MedicalRecordFormDialog } from '../medical-record-form-dialog/medical-record-form-dialog';

const DEFAULT_LIMIT = 5;

const APPT_SUMMARY_FMT = new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short' });
const RECORD_DATE_FMT = new Intl.DateTimeFormat('es-CO', { dateStyle: 'short', timeStyle: 'short' });

function startOfDayIso(d: Date): string {
  const s = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
  return s.toISOString();
}

function endOfDayIso(d: Date): string {
  const e = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
  return e.toISOString();
}

@Component({
  selector: 'app-medical-record-list',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatIconModule,
    MatExpansionModule,
    MatFormFieldModule,
    MatInputModule,
    MatDatepickerModule,
    MatNativeDateModule,
  ],
  templateUrl: './medical-record-list.html',
  styleUrl: './medical-record-list.scss',
})
export class MedicalRecordList implements OnInit {
  private readonly data = inject(MedicalData);
  private readonly dialog = inject(MatDialog);
  private readonly snack = inject(MatSnackBar);
  protected readonly tenant = inject(TenantContextService);

  petId = input.required<string>();
  petName = input<string>('');

  protected readonly rows = signal<MedicalRecordRow[]>([]);
  protected readonly loading = signal(true);
  protected readonly expandedById = signal<Record<string, boolean>>({});
  protected readonly limit = signal(DEFAULT_LIMIT);

  filterFrom = new FormControl<Date | null>(null);
  filterTo = new FormControl<Date | null>(null);

  async ngOnInit() {
    await this.load();
  }

  recordTipo(r: MedicalRecordRow): string {
    return r.appointment_id ? 'Cita' : 'Nota';
  }

  formatAppointmentSlot(r: MedicalRecordRow): string {
    const iso = r.appointment?.start_date_time;
    if (!iso) return '—';
    return APPT_SUMMARY_FMT.format(new Date(iso));
  }

  vetSummary(r: MedicalRecordRow): string {
    return r.appointment?.vet?.name?.trim() || '—';
  }

  serviceSummary(r: MedicalRecordRow): string {
    return r.appointment?.service?.name?.trim() || '—';
  }

  /** Una sola línea en el encabezado del acordeón. */
  summaryHeaderLine(r: MedicalRecordRow): string {
    if (r.appointment?.start_date_time) {
      return `Cita: ${this.formatAppointmentSlot(r)} | Veterinario: ${this.vetSummary(r)} | Servicio: ${this.serviceSummary(r)}`;
    }
    const reg = RECORD_DATE_FMT.format(new Date(r.created_at));
    return `Registro: ${reg} · Sin cita vinculada`;
  }

  panelExpanded(id: string): boolean {
    return !!this.expandedById()[id];
  }

  onPanelToggle(id: string, open: boolean) {
    this.expandedById.update((m) => ({ ...m, [id]: open }));
  }

  expandAll() {
    const m: Record<string, boolean> = {};
    for (const r of this.rows()) m[r.id] = true;
    this.expandedById.set(m);
  }

  collapseAll() {
    this.expandedById.set({});
  }

  async applyFilters() {
    this.limit.set(DEFAULT_LIMIT);
    await this.load();
  }

  async clearFilters() {
    this.filterFrom.setValue(null);
    this.filterTo.setValue(null);
    this.limit.set(DEFAULT_LIMIT);
    await this.load();
  }

  async loadMore() {
    this.limit.update((n) => n + DEFAULT_LIMIT);
    await this.load();
  }

  private mergeExpandedState(newRows: MedicalRecordRow[]) {
    const prev = this.expandedById();
    const next: Record<string, boolean> = {};
    for (const r of newRows) {
      if (prev[r.id]) next[r.id] = true;
    }
    this.expandedById.set(next);
  }

  async load() {
    this.loading.set(true);
    try {
      const fromD = this.filterFrom.value;
      const toD = this.filterTo.value;
      const { data, error } = await this.data.listByPet(this.petId(), {
        createdFromIso: fromD ? startOfDayIso(fromD) : undefined,
        createdToIso: toD ? endOfDayIso(toD) : undefined,
        limit: this.limit(),
      });
      if (error) throw error;
      const list = (data ?? []) as MedicalRecordRow[];
      this.rows.set(list);
      this.mergeExpandedState(list);
    } catch (e) {
      console.error(e);
      this.rows.set([]);
    } finally {
      this.loading.set(false);
    }
  }

  addNote() {
    if (!this.tenant.canEditMedical()) return;
    this.dialog
      .open(MedicalRecordFormDialog, {
        width: 'min(520px, 100vw)',
        data: { petId: this.petId() },
      })
      .afterClosed()
      .subscribe(() => void this.load());
  }

  editNote(r: MedicalRecordRow) {
    if (!this.tenant.canEditMedical()) return;
    this.dialog
      .open(MedicalRecordFormDialog, {
        width: 'min(520px, 100vw)',
        data: { petId: this.petId(), record: r },
      })
      .afterClosed()
      .subscribe(() => void this.load());
  }

  deleteNote(r: MedicalRecordRow) {
    if (!this.tenant.canEditMedical()) return;
    this.dialog
      .open(MedicalRecordDeleteDialog, {
        width: 'min(440px, 100vw)',
        autoFocus: 'dialog',
        data: { record: r },
      })
      .afterClosed()
      .subscribe(async (confirm) => {
        if (!confirm) return;
        const { error } = await this.data.delete(r.id);
        if (error) {
          this.snack.open('No se pudo eliminar la nota', 'OK', { duration: 5000 });
          return;
        }
        await this.load();
      });
  }
}
