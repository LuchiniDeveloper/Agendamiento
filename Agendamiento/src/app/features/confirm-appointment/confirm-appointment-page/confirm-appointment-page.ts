import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { SUPABASE_CLIENT } from '../../../core/supabase';

@Component({
  selector: 'app-confirm-appointment-page',
  imports: [MatCardModule, MatButtonModule, MatIconModule, MatProgressSpinnerModule, RouterLink],
  templateUrl: './confirm-appointment-page.html',
  styleUrl: './confirm-appointment-page.scss',
})
export class ConfirmAppointmentPage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly supabase = inject(SUPABASE_CLIENT);

  protected readonly loading = signal(true);
  protected readonly ok = signal<boolean | null>(null);
  protected readonly message = signal('');
  /** Clínica para enlazar al portal del cliente (login). */
  protected readonly portalBusinessId = signal<string | null>(null);

  /** Ruta del botón principal: portal del tutor, no panel de staff. */
  protected readonly clientEntryLink = computed(() => {
    const id = this.portalBusinessId();
    return id ? ['/portal', id, 'login'] : ['/auth/login'];
  });

  protected readonly clientEntryLabel = computed(() =>
    this.portalBusinessId() ? 'Portal del cliente' : 'Ir al inicio de sesión',
  );

  async ngOnInit() {
    const token = this.route.snapshot.queryParamMap.get('t');
    const bFromQuery = this.route.snapshot.queryParamMap.get('b')?.trim() || null;
    if (!token || !this.supabase) {
      this.ok.set(false);
      this.message.set('Enlace inválido o sesión no disponible.');
      this.loading.set(false);
      return;
    }
    try {
      const { data, error } = await this.supabase.rpc('confirm_appointment_by_token', {
        p_token: token,
      });
      if (error) throw error;
      const j = data as { ok?: boolean; error?: string; business_id?: string | null };
      const bid = (j?.business_id as string | undefined)?.trim();
      const err = j?.error ?? 'UNKNOWN';
      if (bid) {
        this.portalBusinessId.set(bid);
      } else if (bFromQuery && err !== 'INVALID_TOKEN') {
        this.portalBusinessId.set(bFromQuery);
      }
      if (j?.ok) {
        this.ok.set(true);
        this.message.set('Listo: registramos tu confirmación. ¡Te esperamos!');
      } else {
        this.ok.set(false);
        const map: Record<string, string> = {
          INVALID_TOKEN: 'El enlace no es válido o ya caducó.',
          ALREADY_USED: 'Esta confirmación ya fue usada.',
          EXPIRED: 'El enlace expiró. Podés llamar a la clínica o escribirnos.',
          NOT_PENDING: 'La cita ya no está pendiente de confirmación.',
        };
        this.message.set(map[err] ?? 'No pudimos confirmar la cita.');
      }
    } catch (e) {
      this.ok.set(false);
      this.message.set(e instanceof Error ? e.message : 'Error de conexión.');
    } finally {
      this.loading.set(false);
    }
  }
}
