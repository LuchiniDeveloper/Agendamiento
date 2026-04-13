import { BreakpointObserver } from '@angular/cdk/layout';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { map } from 'rxjs';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatListModule } from '@angular/material/list';
import { MatTooltipModule } from '@angular/material/tooltip';
import { SUPABASE_CLIENT } from '../../../core/supabase';
import { ThemeService } from '../../../core/theme.service';
import { snapshotBusinessId } from '../client-portal-route.utils';

type PortalNavItem = {
  path: string[];
  label: string;
  icon: string;
  exact?: boolean;
};

@Component({
  selector: 'app-client-portal-layout',
  host: { class: 'portal-app' },
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    MatToolbarModule,
    MatButtonModule,
    MatIconModule,
    MatSidenavModule,
    MatListModule,
    MatTooltipModule,
  ],
  templateUrl: './client-portal-layout.html',
  styleUrl: './client-portal-layout.scss',
})
export class ClientPortalLayout implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly supabase = inject(SUPABASE_CLIENT);
  private readonly breakpoint = inject(BreakpointObserver);
  protected readonly theme = inject(ThemeService);

  protected readonly isHandset = toSignal(
    this.breakpoint.observe('(max-width: 768px)').pipe(map((r) => r.matches)),
    { initialValue: false },
  );

  protected readonly handsetDrawerOpen = signal(false);

  protected readonly sidenavOpened = computed(() => (this.isHandset() ? this.handsetDrawerOpen() : true));

  protected readonly businessId = signal('');
  protected readonly clinicName = signal('Mi clínica');

  protected readonly navItems = computed((): PortalNavItem[] => {
    const bid = this.businessId();
    const base = ['/portal', bid];
    return [
      { path: base, label: 'Inicio', icon: 'home', exact: true },
      { path: [...base, 'nueva-cita'], label: 'Nueva cita', icon: 'event_available' },
      { path: [...base, 'citas'], label: 'Mis citas', icon: 'calendar_month' },
      { path: [...base, 'perfil'], label: 'Mi perfil', icon: 'person' },
    ];
  });

  ngOnInit() {
    const bid = snapshotBusinessId(this.route.snapshot) ?? '';
    this.businessId.set(bid);
    void this.loadClinicName(bid);
  }

  private async loadClinicName(bid: string) {
    if (!this.supabase || !bid) return;
    const { data, error } = await this.supabase.rpc('get_public_booking_business', { p_business_id: bid });
    if (error || !data) return;
    const j = data as { name?: string };
    const n = String(j?.name ?? '').trim();
    if (n) this.clinicName.set(n);
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

  async signOut() {
    const bid = this.businessId();
    if (this.supabase) await this.supabase.auth.signOut();
    await this.router.navigate(['/portal', bid, 'login']);
  }
}
