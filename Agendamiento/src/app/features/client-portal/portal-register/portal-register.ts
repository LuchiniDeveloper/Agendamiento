import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { ClientPortalAuthService } from '../client-portal-auth.service';
import { snapshotBusinessId } from '../client-portal-route.utils';
import { PortalAuthShell } from '../portal-auth-shell/portal-auth-shell';
import {
  PET_SPECIES_GROUPS,
  PET_SPECIES_OTHER,
  speciesFromForm,
} from '../../customers/pet-form-dialog/pet-species.options';

@Component({
  selector: 'app-portal-register',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    PortalAuthShell,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatSelectModule,
  ],
  templateUrl: './portal-register.html',
  styleUrl: './portal-register.scss',
})
export class PortalRegister {
  private readonly fb = inject(FormBuilder);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly portalAuth = inject(ClientPortalAuthService);

  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly businessId = signal('');
  /** 0 = datos del titular, 1 = mascota */
  protected readonly step = signal(0);

  protected readonly speciesGroups = PET_SPECIES_GROUPS;
  protected readonly speciesOther = PET_SPECIES_OTHER;

  readonly form = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.minLength(2)]],
    id_document: ['', [Validators.required, Validators.minLength(5)]],
    password: ['', [Validators.required, Validators.minLength(6)]],
    phone: [''],
    email: ['', [Validators.required, Validators.email]],
    pet_name: [''],
    pet_species_preset: [''],
    pet_species_other: [''],
  });

  constructor() {
    this.businessId.set(snapshotBusinessId(this.route.snapshot) ?? '');
  }

  /** Paso 1: el botón Continuar solo se habilita con datos del titular y correo válido. */
  protected canContinueStep1(): boolean {
    const { name, id_document, password, email } = this.form.controls;
    return name.valid && id_document.valid && password.valid && email.valid;
  }

  protected goToPetStep() {
    const keys = ['name', 'id_document', 'password', 'email'] as const;
    for (const k of keys) {
      const c = this.form.controls[k];
      c.markAsTouched();
      if (c.invalid) return;
    }
    this.error.set(null);
    this.step.set(1);
  }

  protected backToClientStep() {
    this.step.set(0);
  }

  protected async registerWithoutPet() {
    await this.submit(false);
  }

  protected async registerWithPet() {
    await this.submit(true);
  }

  private async submit(includePet: boolean) {
    const v = this.form.getRawValue();
    const keys = ['name', 'id_document', 'password', 'email'] as const;
    for (const k of keys) {
      this.form.controls[k].markAsTouched();
      if (this.form.controls[k].invalid) return;
    }

    let petName: string | undefined;
    let petSpecies: string | undefined;
    if (includePet) {
      const pn = v.pet_name.trim();
      if (!pn) {
        this.error.set('Indicá el nombre de la mascota o elegí «Sin mascota por ahora».');
        return;
      }
      const spec = speciesFromForm(v.pet_species_preset, v.pet_species_other);
      if (!spec) {
        this.error.set('Seleccioná la especie en la lista o completá «Otro».');
        return;
      }
      petName = pn;
      petSpecies = spec;
    }

    if (this.form.invalid) return;
    const bid = this.businessId();
    if (!bid) return;
    this.error.set(null);
    this.saving.set(true);
    try {
      const res = await this.portalAuth.register({
        business_id: bid,
        id_document: v.id_document.trim().replace(/\D/g, ''),
        name: v.name.trim(),
        password: v.password,
        phone: v.phone.trim() || undefined,
        email: v.email.trim() || undefined,
        pet_name: petName,
        pet_species: petSpecies,
      });
      if ('error' in res) {
        this.error.set(res.need_activate ? `${res.error} Podés usar “Activar cuenta”.` : res.error);
        return;
      }
      const ok = await this.portalAuth.applySessionIfPresent(res);
      if (!ok) {
        await this.router.navigate(['/portal', bid, 'login']);
        return;
      }
      await this.router.navigate(['/portal', bid]);
    } finally {
      this.saving.set(false);
    }
  }
}
