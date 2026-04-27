import { Component, inject, OnInit, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { debounceTime, distinctUntilChanged } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatTooltipModule } from '@angular/material/tooltip';
import {
  customerHasPortalAccount,
  CustomersData,
  type CustomerAppointmentIndicators,
  type CustomerPetIndicator,
  type CustomerRow,
} from '../customers.data';
import { CustomerFormDialog } from '../customer-form-dialog/customer-form-dialog';

@Component({
  selector: 'app-customers-list',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatDialogModule,
    MatTooltipModule,
  ],
  templateUrl: './customers-list.html',
  styleUrl: './customers-list.scss',
})
export class CustomersList implements OnInit {
  private readonly data = inject(CustomersData);
  private readonly router = inject(Router);
  private readonly dialog = inject(MatDialog);

  protected readonly loading = signal(true);
  protected readonly rows = signal<(CustomerRow & { created_at?: string })[]>([]);
  protected readonly petIndicators = signal<Map<string, CustomerPetIndicator[]>>(new Map());
  protected readonly appointmentIndicators = signal<Map<string, CustomerAppointmentIndicators>>(new Map());
  search = new FormControl('', { nonNullable: true });

  constructor() {
    this.search.valueChanges
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntilDestroyed())
      .subscribe(() => this.load());
  }

  async ngOnInit() {
    await this.load();
  }

  notePreview(notes: string | null | undefined): string {
    const s = (notes ?? '').trim();
    if (!s) return '—';
    return s.length <= 50 ? s : `${s.slice(0, 50)}…`;
  }

  noteTooltip(notes: string | null | undefined): string {
    const s = (notes ?? '').trim();
    return s.length > 0 ? s : '';
  }

  protected hasPortalAccount(c: CustomerRow): boolean {
    return customerHasPortalAccount(c);
  }

  async load() {
    this.loading.set(true);
    try {
      const q = this.search.value.trim();
      const res = q
        ? await this.data.searchByPhone(q)
        : await this.data.list();
      if (res.error) throw res.error;
      const list = (res.data ?? []) as (CustomerRow & { created_at?: string })[];
      const withPortal = await this.data.mergePortalAccountFlags(list);
      const ids = list.map((r) => r.id);
      const [petsByCustomer, apptByCustomer] = await Promise.all([
        this.data.petIndicatorsForCustomers(ids),
        this.data.appointmentIndicatorsForCustomers(ids),
      ]);
      const sortedByAppointments = [...withPortal].sort((a, b) => {
        const aStats = apptByCustomer.get(a.id) ?? { attended: 0, cancelled: 0, noShow: 0 };
        const bStats = apptByCustomer.get(b.id) ?? { attended: 0, cancelled: 0, noShow: 0 };
        const aTotal = aStats.attended + aStats.cancelled + aStats.noShow;
        const bTotal = bStats.attended + bStats.cancelled + bStats.noShow;
        if (bTotal !== aTotal) return bTotal - aTotal;
        return a.name.localeCompare(b.name, 'es');
      });
      this.rows.set(sortedByAppointments);
      this.petIndicators.set(petsByCustomer);
      this.appointmentIndicators.set(apptByCustomer);
    } catch (e) {
      console.error(e);
      this.rows.set([]);
      this.petIndicators.set(new Map());
      this.appointmentIndicators.set(new Map());
    } finally {
      this.loading.set(false);
    }
  }

  protected customerPetIndicators(customerId: string): CustomerPetIndicator[] {
    return this.petIndicators().get(customerId) ?? [];
  }

  protected customerAppointmentIndicators(customerId: string): CustomerAppointmentIndicators {
    return this.appointmentIndicators().get(customerId) ?? { attended: 0, cancelled: 0, noShow: 0 };
  }

  openNew() {
    this.dialog
      .open(CustomerFormDialog, { width: 'min(480px, 100vw)', data: null })
      .afterClosed()
      .subscribe((id: string | undefined) => {
        if (id) void this.router.navigate(['/app/customers', id]);
        void this.load();
      });
  }

  openEdit(c: CustomerRow) {
    this.dialog
      .open(CustomerFormDialog, { width: 'min(480px, 100vw)', data: c })
      .afterClosed()
      .subscribe(() => void this.load());
  }
}
