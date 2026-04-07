import { afterNextRender, Component, DestroyRef, ElementRef, inject, signal, viewChild } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { AuthService } from '../../../core/auth.service';
import { TenantContextService } from '../../../core/tenant-context.service';

function decodeAuthErr(s: string): string {
  try {
    return decodeURIComponent(s.replace(/\+/g, ' '));
  } catch {
    return s;
  }
}

function mapLoginError(e: unknown): string {
  if (!(e instanceof Error)) return 'Error al iniciar sesión';
  const raw = e.message.trim();
  const low = raw.toLowerCase();
  if (low.includes('email not confirmed') || low.includes('email_not_confirmed')) {
    return (
      'Tu correo aún no está confirmado en Supabase Auth. ' +
      'Si te registraste desde la app, revisa el correo de confirmación (y spam) o las URL de redirección en Authentication → URL Configuration. ' +
      'Si un administrador te dio de alta, que abra Authentication → Users, elija tu usuario y confirme el correo (o vuelva a invitarte tras actualizar la función invite-staff).'
    );
  }
  if (
    low.includes('invalid login credentials') ||
    low.includes('invalid_grant') ||
    low.includes('invalid_credentials')
  ) {
    return 'Correo o contraseña incorrectos.';
  }
  return raw || 'Error al iniciar sesión';
}

@Component({
  selector: 'app-login',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
  ],
  templateUrl: './login.html',
  styleUrl: './login.scss',
})
export class Login {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly tenant = inject(TenantContextService);
  private readonly router = inject(Router);

  private readonly videoHost = viewChild<ElementRef<HTMLElement>>('videoHost');

  protected readonly error = signal<string | null>(null);
  protected readonly loading = signal(false);

  form = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(6)]],
  });

  constructor() {
    afterNextRender(() => void this.handleAuthCallbackFromUrl());

    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const host = this.videoHost()?.nativeElement;
      if (!host || matchMedia('(prefers-reduced-motion: reduce)').matches) return;

      const v = document.createElement('video');
      v.muted = true;
      v.defaultMuted = true;
      v.loop = true;
      v.playsInline = true;
      v.setAttribute('playsinline', '');
      v.preload = 'auto';
      v.setAttribute('aria-hidden', 'true');
      Object.assign(v.style, {
        width: '100%',
        height: '100%',
        objectFit: 'cover',
        objectPosition: 'center 28%',
        display: 'block',
      });

      const mp4 = document.createElement('source');
      mp4.src = '/Videos/login-hero.mp4';
      mp4.type = 'video/mp4';
      v.appendChild(mp4);

      const mov = document.createElement('source');
      mov.src = '/Videos/login-hero.mov';
      mov.type = 'video/quicktime';
      v.appendChild(mov);

      host.appendChild(v);
      v.load();

      const resumeIfNeeded = () => {
        if (document.visibilityState !== 'visible') return;
        if (v.paused && !v.ended) void v.play().catch(() => {});
      };
      void v.play().catch(() => {});
      document.addEventListener('visibilitychange', resumeIfNeeded);
      v.addEventListener('pause', resumeIfNeeded);
      destroyRef.onDestroy(() => {
        document.removeEventListener('visibilitychange', resumeIfNeeded);
        v.removeEventListener('pause', resumeIfNeeded);
        v.remove();
      });
    });
  }

  /**
   * Tras invitación/confirmación, Supabase redirige con #access_token=… o con ?error= si falla la URL permitida.
   * Esperamos a que el cliente termine de leer la URL y, si hay sesión, entramos sin pedir contraseña otra vez.
   */
  private async handleAuthCallbackFromUrl() {
    const client = this.auth.client;
    if (!client) return;

    const href = window.location.href;
    const url = new URL(href);
    const hashParams = new URLSearchParams(url.hash.startsWith('#') ? url.hash.slice(1) : '');
    const err =
      url.searchParams.get('error') ||
      url.searchParams.get('error_code') ||
      hashParams.get('error');
    const errDesc =
      url.searchParams.get('error_description') || hashParams.get('error_description');
    if (err || errDesc) {
      this.error.set(
        decodeAuthErr(errDesc?.trim() || err || 'Error al validar el enlace del correo.'),
      );
      window.history.replaceState({}, '', url.pathname);
      return;
    }

    const { data: { session } } = await client.auth.getSession();
    if (session?.user) {
      this.error.set(null);
      const p = await this.tenant.refreshProfile();
      await this.router.navigate(p ? ['/app/dashboard'] : ['/onboarding'], { replaceUrl: true });
    }
  }

  async submit() {
    if (this.form.invalid) return;
    this.error.set(null);
    this.loading.set(true);
    try {
      await this.auth.signIn(this.form.getRawValue().email, this.form.getRawValue().password);
      const p = await this.tenant.refreshProfile();
      await this.router.navigate(p ? ['/app/dashboard'] : ['/onboarding']);
    } catch (e: unknown) {
      this.error.set(mapLoginError(e));
    } finally {
      this.loading.set(false);
    }
  }
}
