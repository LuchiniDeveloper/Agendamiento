import { Component, inject, OnInit, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { SUPABASE_CLIENT } from '../../../core/supabase';
import { CopCurrencyPipe } from '../../../shared/pipes/cop-currency.pipe';

interface KpiJson {
  revenue?: number;
  appointments_completed?: number;
  appointments_by_status?: { status_name: string; cnt: number }[];
}

@Component({
  selector: 'app-reports-page',
  imports: [
    ReactiveFormsModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    CopCurrencyPipe,
  ],
  templateUrl: './reports-page.html',
  styleUrl: './reports-page.scss',
})
export class ReportsPage implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly supabase = inject(SUPABASE_CLIENT);

  protected readonly loading = signal(false);
  protected readonly kpis = signal<KpiJson | null>(null);

  range = this.fb.nonNullable.group({
    from: [this.defaultFrom()],
    to: [this.defaultTo()],
  });

  private defaultFrom() {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  }

  private defaultTo() {
    return new Date().toISOString().slice(0, 10);
  }

  ngOnInit() {
    void this.fetch();
  }

  async fetch() {
    const client = this.supabase;
    if (!client) return;
    this.loading.set(true);
    try {
      const { from, to } = this.range.getRawValue();
      const pFrom = new Date(from + 'T00:00:00');
      const pTo = new Date(to + 'T23:59:59.999');
      const { data, error } = await client.rpc('get_kpis', {
        p_from: pFrom.toISOString(),
        p_to: pTo.toISOString(),
      });
      if (error) throw error;
      this.kpis.set((data ?? null) as KpiJson);
    } catch (e) {
      console.error(e);
      this.kpis.set(null);
    } finally {
      this.loading.set(false);
    }
  }
}
