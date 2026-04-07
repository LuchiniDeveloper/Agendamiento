import { BreakpointObserver } from '@angular/cdk/layout';
import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { map } from 'rxjs';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatListModule } from '@angular/material/list';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { AuthService } from '../../core/auth.service';
import {
  TenantContextService,
  businessDisplayNameFromProfile,
} from '../../core/tenant-context.service';
import { ThemeService } from '../../core/theme.service';

@Component({
  selector: 'app-main-layout',
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    MatSidenavModule,
    MatToolbarModule,
    MatListModule,
    MatIconModule,
    MatButtonModule,
    MatTooltipModule,
  ],
  templateUrl: './main-layout.html',
  styleUrl: './main-layout.scss',
})
export class MainLayout {
  private readonly auth = inject(AuthService);
  protected readonly tenant = inject(TenantContextService);
  protected readonly theme = inject(ThemeService);
  private readonly breakpoint = inject(BreakpointObserver);

  protected readonly isHandset = toSignal(
    this.breakpoint.observe('(max-width: 768px)').pipe(map((r) => r.matches)),
    { initialValue: false },
  );

  /** Solo móvil: drawer encima; se cierra al elegir ruta o al tocar fuera. */
  protected readonly handsetDrawerOpen = signal(false);

  /** Escritorio: menú siempre visible; esto solo reduce el ancho a iconos. */
  protected readonly sidenavCollapsed = signal(false);

  protected readonly sidenavOpened = computed(() =>
    this.isHandset() ? this.handsetDrawerOpen() : true,
  );

  protected readonly clinicName = computed(() =>
    businessDisplayNameFromProfile(this.tenant.profile()),
  );
  protected readonly userName = computed(() => this.tenant.profile()?.name ?? '');
  navItems: {
    path: string;
    label: string;
    icon: string;
    exact?: boolean;
    adminOnly?: boolean;
    /** Si existe, solo estos roles ven el ítem (además de `adminOnly`). */
    roles?: string[];
  }[] = [
    { path: '/app/dashboard', label: 'Inicio', icon: 'home', exact: true, roles: ['Admin', 'Veterinario'] },
    { path: '/app/appointments', label: 'Agenda', icon: 'calendar_month' },
    { path: '/app/customers', label: 'Clientes', icon: 'people' },
    { path: '/app/services', label: 'Servicios', icon: 'medical_services', roles: ['Admin', 'Veterinario'] },
    { path: '/app/reminders', label: 'Avisos', icon: 'notifications', roles: ['Admin', 'Veterinario'] },
    { path: '/app/reports', label: 'Reportes', icon: 'bar_chart', adminOnly: true },
    { path: '/app/staff', label: 'Personal', icon: 'groups', adminOnly: true },
  ];

  protected filteredNav() {
    const role = this.tenant.roleName();
    return this.navItems.filter((i) => {
      if (i.adminOnly && !this.tenant.isAdmin()) return false;
      if (i.roles?.length && (!role || !i.roles.includes(role))) return false;
      return true;
    });
  }

  protected toggleHandsetDrawer(): void {
    this.handsetDrawerOpen.update((o) => !o);
  }

  protected onSidenavOpenedChange(opened: boolean): void {
    if (this.isHandset()) {
      this.handsetDrawerOpen.set(opened);
    }
  }

  protected onNavClick(): void {
    if (this.isHandset()) {
      this.handsetDrawerOpen.set(false);
    }
  }

  protected toggleSidenavCollapsed(): void {
    if (!this.isHandset()) {
      this.sidenavCollapsed.update((c) => !c);
    }
  }

  logout() {
    void this.auth.signOut();
  }
}
