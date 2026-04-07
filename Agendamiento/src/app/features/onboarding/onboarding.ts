import { Component, inject, OnInit, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { SUPABASE_CLIENT } from '../../core/supabase';
import { TenantContextService } from '../../core/tenant-context.service';

export const ONBOARDING_CREATE_NEW = '__create_new__';

export interface BusinessOption {
  id: string;
  name: string;
}

@Component({
  selector: 'app-onboarding',
  imports: [
    ReactiveFormsModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatSelectModule,
    MatProgressSpinnerModule,
  ],
  templateUrl: './onboarding.html',
  styleUrl: './onboarding.scss',
})
export class Onboarding implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly supabase = inject(SUPABASE_CLIENT);
  private readonly tenant = inject(TenantContextService);
  private readonly router = inject(Router);

  protected readonly error = signal<string | null>(null);
  protected readonly loading = signal(false);
  protected readonly listLoading = signal(true);
  protected readonly businesses = signal<BusinessOption[]>([]);
  protected readonly isCreatingNew = signal(false);

  protected readonly createNewValue = ONBOARDING_CREATE_NEW;

  form = this.fb.nonNullable.group({
    clinicChoice: ['', Validators.required],
    businessName: [''],
    displayName: [''],
  });

  async ngOnInit() {
    this.form.controls.clinicChoice.valueChanges.subscribe((v) => {
      const creating = v === ONBOARDING_CREATE_NEW;
      this.isCreatingNew.set(creating);
      const nameCtrl = this.form.controls.businessName;
      if (creating) {
        nameCtrl.setValidators([Validators.required, Validators.minLength(2)]);
      } else {
        nameCtrl.clearValidators();
        nameCtrl.setValue('');
      }
      nameCtrl.updateValueAndValidity({ emitEvent: false });
    });
    await this.loadBusinesses();
  }

  private async loadBusinesses() {
    this.listLoading.set(true);
    if (!this.supabase) {
      this.listLoading.set(false);
      this.form.patchValue({ clinicChoice: ONBOARDING_CREATE_NEW });
      this.isCreatingNew.set(true);
      this.form.controls.businessName.setValidators([Validators.required, Validators.minLength(2)]);
      this.form.controls.businessName.updateValueAndValidity({ emitEvent: false });
      return;
    }
    const { data, error } = await this.supabase
      .from('business')
      .select('id, name')
      .eq('active', true)
      .order('name');
    this.listLoading.set(false);
    if (error) {
      console.error(error);
      this.form.patchValue({ clinicChoice: ONBOARDING_CREATE_NEW });
      this.isCreatingNew.set(true);
      this.form.controls.businessName.setValidators([Validators.required, Validators.minLength(2)]);
      this.form.controls.businessName.updateValueAndValidity({ emitEvent: false });
      return;
    }
    const rows = (data ?? []) as BusinessOption[];
    this.businesses.set(rows);
    if (rows.length === 0) {
      this.form.patchValue({ clinicChoice: ONBOARDING_CREATE_NEW });
      this.isCreatingNew.set(true);
      this.form.controls.businessName.setValidators([Validators.required, Validators.minLength(2)]);
      this.form.controls.businessName.updateValueAndValidity({ emitEvent: false });
    }
  }

  protected submitLabel(): string {
    return this.isCreatingNew() ? 'Crear y continuar' : 'Unirme a la clínica';
  }

  async submit() {
    if (!this.supabase) return;
    this.error.set(null);
    const choice = this.form.controls.clinicChoice.value;
    if (!choice) {
      this.form.markAllAsTouched();
      return;
    }
    if (choice === ONBOARDING_CREATE_NEW) {
      const name = this.form.controls.businessName.value.trim();
      if (name.length < 2) {
        this.form.controls.businessName.markAsTouched();
        return;
      }
    }
    this.loading.set(true);
    try {
      const displayName = this.form.controls.displayName.value.trim() || null;
      if (choice === ONBOARDING_CREATE_NEW) {
        const businessName = this.form.controls.businessName.value.trim();
        const { error: err } = await this.supabase.rpc('bootstrap_clinic', {
          p_business_name: businessName,
          p_display_name: displayName,
        });
        if (err) throw err;
      } else {
        const { error: err } = await this.supabase.rpc('join_clinic', {
          p_business_id: choice,
          p_display_name: displayName,
        });
        if (err) throw err;
      }
      await this.tenant.refreshProfile();
      await this.router.navigate(['/app/dashboard']);
    } catch (e: unknown) {
      const msg =
        e && typeof e === 'object' && 'message' in e && typeof (e as { message: string }).message === 'string'
          ? (e as { message: string }).message
          : e instanceof Error
            ? e.message
            : 'No se pudo completar el registro';
      this.error.set(msg);
    } finally {
      this.loading.set(false);
    }
  }
}
