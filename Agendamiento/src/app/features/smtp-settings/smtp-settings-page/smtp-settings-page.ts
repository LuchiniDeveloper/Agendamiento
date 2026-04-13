import { Component, inject, OnInit, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDividerModule } from '@angular/material/divider';
import { SmtpSettingsData } from '../smtp-settings.data';

@Component({
  selector: 'app-smtp-settings-page',
  imports: [
    ReactiveFormsModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatSlideToggleModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    MatDividerModule,
  ],
  templateUrl: './smtp-settings-page.html',
  styleUrl: './smtp-settings-page.scss',
})
export class SmtpSettingsPage implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly data = inject(SmtpSettingsData);
  private readonly snack = inject(MatSnackBar);

  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly testing = signal(false);

  form = this.fb.nonNullable.group({
    host: ['smtp.gmail.com', Validators.required],
    port: [587, [Validators.required, Validators.min(1)]],
    use_tls: [true],
    username: ['', Validators.required],
    smtp_password: [''],
    from_email: ['', [Validators.required, Validators.email]],
    from_name: [''],
    enabled: [false],
    /** Destino opcional para la prueba; si está vacío, usa el correo del admin en staff o el remitente. */
    test_to: [''],
  });

  async ngOnInit() {
    try {
      const { data, error } = await this.data.getForBusiness();
      if (error) throw error;
      const row = data as Record<string, unknown> | null;
      if (row) {
        this.form.patchValue({
          host: String(row['host'] ?? 'smtp.gmail.com'),
          port: Number(row['port'] ?? 587),
          use_tls: row['use_tls'] !== false,
          username: String(row['username'] ?? ''),
          smtp_password: '',
          from_email: String(row['from_email'] ?? ''),
          from_name: String(row['from_name'] ?? ''),
          enabled: !!row['enabled'],
        });
      }
    } catch (e) {
      console.error(e);
    } finally {
      this.loading.set(false);
    }
  }

  async save() {
    if (this.form.invalid) return;
    this.saving.set(true);
    try {
      const v = this.form.getRawValue();
      const { data: existing } = await this.data.getForBusiness();
      const hasRow = !!existing;
      if (!hasRow && !v.smtp_password.trim()) {
        this.snack.open('Ingresá la contraseña de aplicación para el primer guardado.', 'OK', {
          duration: 4000,
        });
        return;
      }
      const { error } = await this.data.upsert({
        host: v.host.trim(),
        port: v.port,
        use_tls: v.use_tls,
        username: v.username.trim(),
        smtp_password: v.smtp_password.trim() || undefined,
        from_email: v.from_email.trim(),
        from_name: v.from_name.trim() || null,
        enabled: v.enabled,
      });
      if (error) throw error;
      this.form.patchValue({ smtp_password: '' });
      this.snack.open('Configuración guardada', 'OK', { duration: 2500 });
    } catch (e) {
      this.snack.open(e instanceof Error ? e.message : 'Error al guardar', 'OK', { duration: 4000 });
    } finally {
      this.saving.set(false);
    }
  }

  async sendTest() {
    this.testing.set(true);
    try {
      const to = this.form.controls.test_to.value?.trim();
      const res = await this.data.sendTestEmail(to || undefined);
      if (res.ok) {
        const mid = res.messageId ? ` ID: ${res.messageId}` : '';
        this.snack.open(
          `Enviado a ${res.to ?? 'tu correo'}.${mid} Revisá entrada y spam.`,
          'OK',
          { duration: 6000 },
        );
      } else {
        this.snack.open(res.message, 'OK', { duration: 8000 });
      }
    } catch (e) {
      this.snack.open(e instanceof Error ? e.message : 'Error en la prueba', 'OK', { duration: 5000 });
    } finally {
      this.testing.set(false);
    }
  }
}
