import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSlideToggleChange, MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { AuthService } from '../../../core/auth.service';
import {
  TenantContextService,
  businessDisplayNameFromProfile,
} from '../../../core/tenant-context.service';
import { StaffData, type RoleRow, type StaffDirectoryRow } from '../staff.data';
import { StaffCreateDialog } from '../staff-create-dialog/staff-create-dialog';
import { StaffDeleteDialog } from '../staff-delete-dialog/staff-delete-dialog';
import { StaffEditDialog } from '../staff-edit-dialog/staff-edit-dialog';

@Component({
  selector: 'app-staff-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatSlideToggleModule,
    MatSnackBarModule,
    MatTooltipModule,
  ],
  templateUrl: './staff-page.html',
  styleUrl: './staff-page.scss',
})
export class StaffPage implements OnInit {
  private readonly data = inject(StaffData);
  private readonly dialog = inject(MatDialog);
  private readonly snack = inject(MatSnackBar);
  private readonly auth = inject(AuthService);
  private readonly tenant = inject(TenantContextService);

  protected readonly loading = signal(true);
  protected readonly staff = signal<StaffDirectoryRow[]>([]);
  protected readonly roles = signal<RoleRow[]>([]);
  protected readonly togglingId = signal<string | null>(null);
  protected readonly deletingId = signal<string | null>(null);

  protected readonly currentUserId = computed(() => this.auth.user()?.id ?? '');

  protected readonly activeAdminCount = computed(() =>
    this.staff().filter((s) => s.active && s.role?.name === 'Admin').length,
  );

  async ngOnInit() {
    await this.reload();
    this.loading.set(false);
  }

  async reload() {
    const [{ data: rows, error: e1 }, { data: rrows, error: e2 }] = await Promise.all([
      this.data.listStaffDirectory(),
      this.data.listAssignableRoles(),
    ]);
    if (!e1) this.staff.set((rows ?? []) as unknown as StaffDirectoryRow[]);
    if (!e2) this.roles.set((rrows ?? []) as RoleRow[]);
  }

  protected canDeactivateMember(m: StaffDirectoryRow): boolean {
    if (m.id === this.currentUserId()) return false;
    if (m.role?.name === 'Admin' && this.activeAdminCount() <= 1) return false;
    return true;
  }

  protected canDeleteMember(m: StaffDirectoryRow): boolean {
    if (m.id === this.currentUserId()) return false;
    if (m.role?.name === 'Admin' && this.activeAdminCount() <= 1) return false;
    return true;
  }

  protected roleIcon(roleName: string | undefined): string {
    switch (roleName) {
      case 'Admin':
        return 'admin_panel_settings';
      case 'Veterinario':
        return 'pets';
      case 'Recepcionista':
        return 'support_agent';
      default:
        return 'person';
    }
  }

  openCreateMember() {
    const roles = this.roles();
    if (!roles.length) {
      this.snack.open('No se pudieron cargar los roles', 'OK', { duration: 4000 });
      return;
    }
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
        if (ok) {
          this.snack.open('Miembro creado', 'OK', { duration: 3000 });
          void this.reload();
        }
      });
  }

  openEdit(m: StaffDirectoryRow) {
    const roles = this.roles();
    this.dialog
      .open(StaffEditDialog, {
        width: 'min(440px, 100vw)',
        maxHeight: '90vh',
        autoFocus: 'first-tabbable',
        data: { staff: m, roles },
      })
      .afterClosed()
      .subscribe((saved) => {
        if (saved) {
          this.snack.open('Cambios guardados', 'OK', { duration: 2500 });
          void this.reload();
        }
      });
  }

  async onSlideToggleChange(m: StaffDirectoryRow, ev: MatSlideToggleChange) {
    await this.setActive(m, ev.checked);
  }

  onStatusPillClick(m: StaffDirectoryRow) {
    void this.setActive(m, !m.active);
  }

  deleteMember(m: StaffDirectoryRow) {
    if (!this.canDeleteMember(m)) {
      this.snack.open('No puedes eliminar tu cuenta ni al único administrador activo.', 'OK', {
        duration: 4500,
      });
      return;
    }
    this.dialog
      .open(StaffDeleteDialog, {
        width: 'min(440px, 100vw)',
        maxHeight: '90vh',
        autoFocus: 'dialog',
        data: { name: m.name, email: m.email ?? null },
      })
      .afterClosed()
      .subscribe((confirmed) => {
        if (confirmed) void this.executeDeleteMember(m);
      });
  }

  private async executeDeleteMember(m: StaffDirectoryRow) {
    this.deletingId.set(m.id);
    try {
      const res = await this.data.deleteStaffMember(m.id);
      if (!res.ok) {
        this.snack.open(res.message, 'OK', { duration: 6000 });
        return;
      }
      this.snack.open('Usuario eliminado', 'OK', { duration: 2500 });
      await this.reload();
    } finally {
      this.deletingId.set(null);
    }
  }

  private async setActive(m: StaffDirectoryRow, next: boolean) {
    if (typeof next !== 'boolean') return;
    if (m.active === next) return;
    if (!next && !this.canDeactivateMember(m)) {
      this.snack.open(
        'No puedes inactivar al único administrador activo ni tu propia cuenta aquí.',
        'OK',
        { duration: 5000 },
      );
      return;
    }
    this.togglingId.set(m.id);
    const { data, error } = await this.data.updateStaff(m.id, { active: next });
    this.togglingId.set(null);
    if (error || !data) {
      this.snack.open('No se pudo actualizar el estado', 'OK', { duration: 4000 });
      await this.reload();
      return;
    }
    this.staff.update((list) => list.map((x) => (x.id === m.id ? { ...x, active: next } : x)));
    this.snack.open(next ? 'Miembro activado' : 'Miembro inactivado', 'OK', { duration: 2200 });
  }
}
