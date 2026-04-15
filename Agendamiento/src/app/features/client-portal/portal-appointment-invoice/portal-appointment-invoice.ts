import { DatePipe } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { SUPABASE_CLIENT } from '../../../core/supabase';
import { snapshotBusinessId } from '../client-portal-route.utils';
import { CopCurrencyPipe } from '../../../shared/pipes/cop-currency.pipe';

type FkName = { name: string } | { name: string }[] | null;

type ExtraRow = { description: string | null; amount: number | string | null };
type PaymentRow = {
  id: string;
  amount: number | string | null;
  payment_method: string | null;
  created_at: string | null;
  transfer_channel: string | null;
  transfer_proof_code: string | null;
};

@Component({
  selector: 'app-portal-appointment-invoice',
  imports: [
    DatePipe,
    RouterLink,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    CopCurrencyPipe,
  ],
  templateUrl: './portal-appointment-invoice.html',
  styleUrl: './portal-appointment-invoice.scss',
})
export class PortalAppointmentInvoice implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly supabase = inject(SUPABASE_CLIENT);
  private readonly snack = inject(MatSnackBar);

  protected readonly businessId = signal(snapshotBusinessId(this.route.snapshot) ?? '');
  protected readonly loading = signal(true);

  protected readonly businessName = signal('Clínica');
  protected readonly customerName = signal('—');
  protected readonly petName = signal('—');
  protected readonly serviceName = signal('Servicio');
  protected readonly vetName = signal('—');
  protected readonly apptStart = signal<string | null>(null);
  protected readonly apptId = signal('');

  protected readonly serviceAmount = signal(0);
  protected readonly extras = signal<{ description: string; amount: number }[]>([]);
  protected readonly extrasAmount = signal(0);
  protected readonly totalExpected = signal(0);

  protected readonly paymentCount = signal(0);
  protected readonly totalPaid = signal(0);
  protected readonly paymentMethod = signal('—');
  protected readonly paymentProof = signal('N/A');
  protected readonly paymentId = signal<string | null>(null);
  protected readonly paidAt = signal<string | null>(null);

  protected readonly invoiceNo = signal('');

  async ngOnInit() {
    const apptId = this.route.snapshot.paramMap.get('appointmentId');
    if (!this.supabase || !apptId) {
      this.loading.set(false);
      return;
    }
    this.apptId.set(apptId);
    this.invoiceNo.set(`INV-${apptId.slice(0, 8).toUpperCase()}`);
    const sb = this.supabase;
    const bid = this.businessId();

    const [{ data: appt, error: e1 }, { data: extrasRows, error: e2 }, { data: payRows, error: e3 }, { data: profile }] =
      await Promise.all([
        sb
          .from('appointment')
          .select(
            `
          id,
          start_date_time,
          customer:customer_id (name),
          pet:pet_id (name),
          service:service_id (name, price),
          vet:user_id (name)
        `,
          )
          .eq('id', apptId)
          .maybeSingle(),
        sb
          .from('appointment_extra_charge')
          .select('description, amount')
          .eq('appointment_id', apptId)
          .order('created_at', { ascending: true }),
        sb
          .from('payment')
          .select('id, amount, payment_method, created_at, transfer_channel, transfer_proof_code')
          .eq('appointment_id', apptId)
          .order('created_at', { ascending: true }),
        bid ? sb.rpc('get_portal_clinic_profile') : Promise.resolve({ data: null as unknown }),
      ]);

    if (profile && typeof profile === 'object' && 'name' in (profile as object)) {
      const n = String((profile as { name?: string }).name ?? '').trim();
      if (n) this.businessName.set(n);
    }

    if (e1 || !appt) {
      if (e1) console.error(e1);
      this.snack.open('No se encontró la cita o no tenés acceso.', 'OK', { duration: 4000 });
      this.loading.set(false);
      return;
    }
    if (e2) console.error(e2);
    if (e3) console.error(e3);

    const a = appt as {
      id: string;
      start_date_time: string;
      customer: FkName;
      pet: FkName;
      service: ({ name: string; price: number | string | null } | { name: string; price: number | string | null }[]) | null;
      vet: FkName;
    };
    this.apptStart.set(a.start_date_time);
    this.customerName.set(this.relName(a.customer) || '—');
    this.petName.set(this.relName(a.pet) || '—');
    this.vetName.set(this.relName(a.vet) || '—');

    const service = Array.isArray(a.service) ? a.service[0] : a.service;
    this.serviceName.set(service?.name?.trim() || 'Servicio');
    this.serviceAmount.set(Number(service?.price ?? 0));

    const extras = ((extrasRows ?? []) as ExtraRow[]).map((r) => ({
      description: String(r.description ?? '').trim() || 'Gasto adicional',
      amount: Number(r.amount ?? 0),
    }));
    const extrasAmount = extras.reduce((sum, x) => sum + x.amount, 0);
    this.extras.set(extras);
    this.extrasAmount.set(extrasAmount);
    this.totalExpected.set(this.serviceAmount() + extrasAmount);

    const payments = (payRows ?? []) as PaymentRow[];
    const totalPaid = payments.reduce((sum, p) => sum + Number(p.amount ?? 0), 0);
    this.totalPaid.set(totalPaid);
    this.paymentCount.set(payments.length);
    const last = payments.at(-1) ?? null;
    if (last) {
      this.paymentMethod.set(this.paymentMethodLabel(last.payment_method, last.transfer_channel));
      this.paymentProof.set((last.transfer_proof_code ?? '').trim() || 'N/A');
      this.paymentId.set(last.id ?? null);
      this.paidAt.set(last.created_at ?? null);
    }

    this.loading.set(false);
  }

  private relName(x: FkName): string {
    if (!x) return '';
    return Array.isArray(x) ? (x[0]?.name ?? '') : x.name;
  }

  private paymentMethodLabel(method: string | null, channel: string | null): string {
    const base =
      method === 'Cash'
        ? 'Efectivo'
        : method === 'Card'
          ? 'Tarjeta'
          : method === 'Transfer'
            ? 'Transferencia'
            : (method || '—');
    const ch = (channel ?? '').trim();
    return base === 'Transferencia' && ch ? `${base} (${ch})` : base;
  }

  protected printPage(): void {
    window.print();
  }
}

