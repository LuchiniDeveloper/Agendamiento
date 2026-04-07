import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { AuthService } from '../../../core/auth.service';

@Component({
  selector: 'app-register',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
  ],
  templateUrl: './register.html',
  styleUrl: './register.scss',
})
export class Register {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly error = signal<string | null>(null);
  protected readonly loading = signal(false);
  /** Supabase devolvió usuario pero sin sesión: suele indicar confirmación por correo obligatoria. */
  protected readonly awaitingEmailConfirmation = signal(false);

  form = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(6)]],
  });

  async submit() {
    if (this.form.invalid) return;
    this.error.set(null);
    this.loading.set(true);
    try {
      const { session } = await this.auth.signUp(
        this.form.getRawValue().email,
        this.form.getRawValue().password,
      );
      if (!session) {
        this.awaitingEmailConfirmation.set(true);
        return;
      }
      await this.router.navigate(['/onboarding']);
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al registrarse');
    } finally {
      this.loading.set(false);
    }
  }
}
