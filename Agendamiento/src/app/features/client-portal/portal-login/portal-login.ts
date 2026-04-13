import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { ClientPortalAuthService } from '../client-portal-auth.service';
import { snapshotBusinessId } from '../client-portal-route.utils';
import { PortalAuthShell } from '../portal-auth-shell/portal-auth-shell';

@Component({
  selector: 'app-portal-login',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    PortalAuthShell,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
  ],
  templateUrl: './portal-login.html',
})
export class PortalLogin {
  private readonly fb = inject(FormBuilder);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly portalAuth = inject(ClientPortalAuthService);

  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly businessId = signal('');

  readonly form = this.fb.nonNullable.group({
    id_document: ['', [Validators.required, Validators.minLength(5)]],
    password: ['', [Validators.required, Validators.minLength(6)]],
  });

  constructor() {
    const bid = snapshotBusinessId(this.route.snapshot) ?? '';
    this.businessId.set(bid);
  }

  async submit() {
    if (this.form.invalid) return;
    const bid = this.businessId();
    if (!bid) return;
    const v = this.form.getRawValue();
    const idDigits = v.id_document.trim().replace(/\D/g, '');
    if (idDigits.length < 5) {
      this.error.set('La cédula debe tener al menos 5 dígitos (podés ingresarla con o sin puntos o guiones).');
      return;
    }
    this.error.set(null);
    this.saving.set(true);
    try {
      const res = await this.portalAuth.signIn(bid, idDigits, v.password);
      if ('error' in res) {
        this.error.set(res.error);
        return;
      }
      const ok = await this.portalAuth.applySessionIfPresent(res);
      if (!ok) {
        this.error.set('No se pudo iniciar sesión. Probá de nuevo.');
        return;
      }
      await this.router.navigate(['/portal', bid]);
    } finally {
      this.saving.set(false);
    }
  }
}
