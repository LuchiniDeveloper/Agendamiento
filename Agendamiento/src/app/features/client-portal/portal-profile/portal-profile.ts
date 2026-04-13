import { Component, OnInit, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { SUPABASE_CLIENT } from '../../../core/supabase';

@Component({
  selector: 'app-portal-profile',
  imports: [
    ReactiveFormsModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
  ],
  templateUrl: './portal-profile.html',
  styleUrl: './portal-profile.scss',
})
export class PortalProfile implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly supabase = inject(SUPABASE_CLIENT);
  private readonly snack = inject(MatSnackBar);

  protected readonly loading = signal(true);
  protected readonly saving = signal(false);

  readonly form = this.fb.nonNullable.group({
    name: ['', Validators.required],
    phone: [''],
    email: [''],
    address: [''],
    id_document_display: [{ value: '', disabled: true }],
    password_new: [''],
    password_confirm: [''],
  });

  private customerId = '';

  async ngOnInit() {
    if (!this.supabase) {
      this.loading.set(false);
      return;
    }
    const { data: row, error } = await this.supabase
      .from('customer')
      .select('id, name, phone, email, address, id_document')
      .maybeSingle();
    if (error || !row) {
      this.snack.open('No se pudo cargar tu perfil.', 'OK', { duration: 4000 });
      this.loading.set(false);
      return;
    }
    this.customerId = row.id as string;
    this.form.patchValue({
      name: (row.name as string) ?? '',
      phone: (row.phone as string) ?? '',
      email: (row.email as string) ?? '',
      address: (row.address as string) ?? '',
      id_document_display: (row.id_document as string) ?? '—',
    });
    this.loading.set(false);
  }

  async save() {
    if (this.form.invalid || !this.supabase || !this.customerId) return;
    const v = this.form.getRawValue();
    const np = v.password_new.trim();
    const cp = v.password_confirm.trim();
    if (np || cp) {
      if (!np || np.length < 6) {
        this.snack.open('Completá la nueva contraseña (mínimo 6 caracteres).', 'OK', { duration: 4000 });
        return;
      }
      if (np !== cp) {
        this.snack.open('La confirmación no coincide con la nueva contraseña.', 'OK', { duration: 4000 });
        return;
      }
    }

    this.saving.set(true);
    try {
      const { error } = await this.supabase
        .from('customer')
        .update({
          name: v.name.trim(),
          phone: v.phone.trim() || null,
          email: v.email.trim() || null,
          address: v.address.trim() || null,
        })
        .eq('id', this.customerId);
      if (error) throw error;

      if (np) {
        const { error: pwErr } = await this.supabase.auth.updateUser({ password: np });
        if (pwErr) {
          this.snack.open(
            `Datos guardados, pero no se pudo cambiar la contraseña: ${pwErr.message}`,
            'OK',
            { duration: 6000 },
          );
          return;
        }
        this.form.patchValue({ password_new: '', password_confirm: '' });
        this.snack.open('Perfil y contraseña actualizados.', 'OK', { duration: 3000 });
      } else {
        this.snack.open('Perfil actualizado.', 'OK', { duration: 3000 });
      }
    } catch (e) {
      this.snack.open(e instanceof Error ? e.message : 'Error', 'OK', { duration: 4000 });
    } finally {
      this.saving.set(false);
    }
  }
}
