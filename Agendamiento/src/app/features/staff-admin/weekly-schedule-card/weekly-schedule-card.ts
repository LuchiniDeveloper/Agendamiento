import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TenantContextService, businessDisplayNameFromProfile } from '../../../core/tenant-context.service';
import { ScheduleEditDialog } from '../../services-schedule/schedule-edit-dialog/schedule-edit-dialog';
import {
  ServicesData,
  staffRowsForScheduling,
  type ScheduleRow,
  type ServiceRow,
  type StaffMini,
} from '../../services-schedule/services.data';
import { StaffCreateDialog } from '../staff-create-dialog/staff-create-dialog';
import { StaffData, type RoleRow } from '../staff.data';

const DAYS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

/** Una fila de tabla: mismo día + mismo servicio, con hasta dos ventanas (H1 / H2). */
interface ScheduleDayServiceGroup {
  key: string;
  day_of_week: number;
  service_id: string | null;
  serviceLabel: string;
  window1: ScheduleRow | null;
  window2: ScheduleRow | null;
}

@Component({
  selector: 'app-weekly-schedule-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatCardModule,
    MatFormFieldModule,
    MatButtonModule,
    MatSelectModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    MatSnackBarModule,
  ],
  templateUrl: './weekly-schedule-card.html',
  styleUrl: './weekly-schedule-card.scss',
})
export class WeeklyScheduleCard implements OnInit {
  private readonly data = inject(ServicesData);
  private readonly staffData = inject(StaffData);
  private readonly dialog = inject(MatDialog);
  private readonly snack = inject(MatSnackBar);
  protected readonly tenant = inject(TenantContextService);

  protected readonly loading = signal(true);
  protected readonly services = signal<ServiceRow[]>([]);
  protected readonly staff = signal<StaffMini[]>([]);
  protected readonly schedules = signal<ScheduleRow[]>([]);
  protected readonly scheduleDayGroups = computed((): ScheduleDayServiceGroup[] => {
    this.services();
    const list = this.schedules();
    const map = new Map<
      string,
      { dow: number; sid: string | null; w1: ScheduleRow | null; w2: ScheduleRow | null }
    >();
    for (const r of list) {
      const key = `${r.day_of_week}|${r.service_id ?? ''}`;
      let g = map.get(key);
      if (!g) {
        g = { dow: r.day_of_week, sid: r.service_id, w1: null, w2: null };
        map.set(key, g);
      }
      const wo = r.window_order === 2 ? 2 : 1;
      if (wo === 2) g.w2 = r;
      else g.w1 = r;
    }
    const dowOrder = (d: number) => (d === 0 ? 7 : d);
    return [...map.values()]
      .sort((a, b) => {
        if (a.dow !== b.dow) return dowOrder(a.dow) - dowOrder(b.dow);
        return this.scheduleServiceLabel(a.sid).localeCompare(this.scheduleServiceLabel(b.sid), 'es', {
          sensitivity: 'base',
        });
      })
      .map((g) => ({
        key: `${g.dow}|${g.sid ?? ''}`,
        day_of_week: g.dow,
        service_id: g.sid,
        serviceLabel: this.scheduleServiceLabel(g.sid),
        window1: g.w1,
        window2: g.w2,
      }));
  });
  protected readonly selectedVetId = signal<string | null>(null);
  protected readonly days = DAYS;

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

  private async reloadServices() {
    const { data, error } = await this.data.listServices();
    if (!error) this.services.set((data ?? []) as ServiceRow[]);
  }

  private async loadSchedule(userId: string) {
    const { data, error } = await this.data.listSchedule(userId);
    if (!error) this.schedules.set((data ?? []) as ScheduleRow[]);
  }

  scheduleServiceLabel(serviceId: string | null): string {
    if (!serviceId) return 'Todos (General)';
    return this.services().find((s) => s.id === serviceId)?.name ?? '—';
  }

  async onVetChange(id: string) {
    this.selectedVetId.set(id);
    await this.loadSchedule(id);
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

  openScheduleGroupEdit(g: ScheduleDayServiceGroup) {
    const uid = this.selectedVetId();
    if (!uid) return;
    const row = g.window1 ?? g.window2;
    if (!row) return;
    this.dialog
      .open(ScheduleEditDialog, {
        width: 'min(520px, 100vw)',
        data: {
          row,
          slotPair: { w1: g.window1, w2: g.window2 },
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

  async removeScheduleGroup(g: ScheduleDayServiceGroup) {
    const uid = this.selectedVetId();
    if (!uid) return;
    if (!g.window1 && !g.window2) return;
    const dayName = this.days[g.day_of_week];
    const both = !!(g.window1 && g.window2);
    const msg = both
      ? `¿Eliminar ambos horarios del ${dayName} para «${g.serviceLabel}»?`
      : `¿Eliminar la franja del ${dayName} para «${g.serviceLabel}»?`;
    if (!globalThis.confirm(msg)) return;

    let anyErr = false;
    if (g.window1) {
      const { error } = await this.data.deleteSchedule(g.window1.id);
      if (error) anyErr = true;
    }
    if (g.window2) {
      const { error } = await this.data.deleteSchedule(g.window2.id);
      if (error) anyErr = true;
    }
    if (anyErr) {
      this.snack.open('No se pudieron eliminar todas las franjas.', 'OK', { duration: 4500 });
    } else {
      this.snack.open(both ? 'Franjas del día eliminadas' : 'Franja eliminada', 'OK', { duration: 2500 });
    }
    await this.loadSchedule(uid);
  }

  async openCreateVetDialog() {
    const { data: rrows, error } = await this.staffData.listAssignableRoles();
    if (error || !(rrows?.length ?? 0)) {
      this.snack.open('No se pudieron cargar los roles', 'OK', { duration: 4000 });
      return;
    }
    const roles = rrows as RoleRow[];
    this.dialog
      .open(StaffCreateDialog, {
        width: 'min(480px, 100vw)',
        maxHeight: '90vh',
        autoFocus: 'first-tabbable',
        data: {
          roles,
          clinicName: businessDisplayNameFromProfile(this.tenant.profile()),
        },
      })
      .afterClosed()
      .subscribe((ok) => {
        if (ok) void this.afterStaffCreated();
      });
  }

  private async afterStaffCreated() {
    const prevIds = new Set(this.staff().map((s) => s.id));
    const prevSelected = this.selectedVetId();
    const { data: s } = await this.data.listStaff();
    const vets = staffRowsForScheduling(s);
    this.staff.set(vets);
    const added = vets.find((v) => !prevIds.has(v.id));
    const nextId = added?.id ?? (prevSelected && vets.some((v) => v.id === prevSelected) ? prevSelected : vets[0]?.id ?? null);
    this.selectedVetId.set(nextId);
    if (nextId) await this.loadSchedule(nextId);
    else this.schedules.set([]);
    this.snack.open('Miembro creado', 'OK', { duration: 3000 });
  }
}
