import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatTooltipModule } from '@angular/material/tooltip';
import { firstValueFrom } from 'rxjs';
import { CustomersData, type CustomerRow, type PetRow } from '../customers.data';
import { petAvatarFromSpecies } from '../pet-avatar.util';
import { CustomerFormDialog } from '../customer-form-dialog/customer-form-dialog';
import { PetFormDialog } from '../pet-form-dialog/pet-form-dialog';
import { PetDeleteDialog } from '../pet-delete-dialog/pet-delete-dialog';
import { MedicalRecordList } from '../../medical-records/medical-record-list/medical-record-list';

@Component({
  selector: 'app-customer-detail',
  imports: [
    RouterLink,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    MatExpansionModule,
    MatFormFieldModule,
    MatInputModule,
    MatTooltipModule,
    MedicalRecordList,
  ],
  templateUrl: './customer-detail.html',
  styleUrl: './customer-detail.scss',
})
export class CustomerDetail implements OnInit {
  protected readonly petAvatarFromSpecies = petAvatarFromSpecies;

  /** Vista compacta de notas de mascota en el encabezado del panel. */
  protected petNotePreview(notes: string | null | undefined, max = 72): string {
    const t = (notes ?? '').trim();
    if (t.length <= max) return t;
    return `${t.slice(0, max)}…`;
  }

  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly data = inject(CustomersData);
  private readonly dialog = inject(MatDialog);
  private readonly snack = inject(MatSnackBar);

  protected readonly loading = signal(true);
  protected readonly customer = signal<CustomerRow | null>(null);
  protected readonly pets = signal<PetRow[]>([]);
  protected readonly petsWithHistory = signal<Set<string>>(new Set());
  protected readonly petFilterText = signal('');
  /** Panel de mascota abierto/cerrado (por defecto: todos abiertos si hay ≤3). */
  protected readonly petPanelOpen = signal<Record<string, boolean>>({});
  protected customerId = '';

  protected readonly filteredPets = computed(() => {
    const q = this.petFilterText().trim().toLowerCase();
    const list = this.pets();
    if (!q) return list;
    return list.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.species ?? '').toLowerCase().includes(q) ||
        (p.breed ?? '').toLowerCase().includes(q),
    );
  });

  async ngOnInit() {
    this.customerId = this.route.snapshot.paramMap.get('id') ?? '';
    await this.reload();
  }

  onPetFilterInput(ev: Event) {
    const v = (ev.target as HTMLInputElement).value;
    this.petFilterText.set(v);
  }

  onPetPanelToggle(petId: string, open: boolean) {
    this.petPanelOpen.update((m) => ({ ...m, [petId]: open }));
  }

  private syncPetPanelsFromList(list: PetRow[]) {
    const n = list.length;
    const prev = this.petPanelOpen();
    const next: Record<string, boolean> = {};
    for (const p of list) {
      next[p.id] = prev[p.id] ?? n <= 3;
    }
    this.petPanelOpen.set(next);
  }

  async reload() {
    this.loading.set(true);
    try {
      const { data: c, error: e1 } = await this.data.get(this.customerId);
      if (e1 || !c) {
        void this.router.navigate(['/app/customers']);
        return;
      }
      this.customer.set(c as CustomerRow);
      const { data: p, error: e2 } = await this.data.petsForCustomer(this.customerId);
      if (e2) throw e2;
      const petRows = (p ?? []) as PetRow[];
      this.pets.set(petRows);
      this.syncPetPanelsFromList(petRows);
      const ids = petRows.map((x) => x.id);
      try {
        const hist = await this.data.petIdsWithMedicalHistory(ids);
        this.petsWithHistory.set(hist);
      } catch {
        this.petsWithHistory.set(new Set());
      }
    } finally {
      this.loading.set(false);
      queueMicrotask(() => this.scrollToPetFromQuery());
    }
  }

  /** Desde agenda: ?pet=<uuid> baja hasta la mascota e historia clínica. */
  private scrollToPetFromQuery() {
    const petId = this.route.snapshot.queryParamMap.get('pet');
    if (!petId) return;
    if (!this.pets().some((p) => p.id === petId)) return;
    this.petPanelOpen.update((m) => ({ ...m, [petId]: true }));
    const el = document.getElementById(`pet-clinical-${petId}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  editCustomer() {
    const c = this.customer();
    if (!c) return;
    this.dialog
      .open(CustomerFormDialog, { width: 'min(480px, 100vw)', data: c })
      .afterClosed()
      .subscribe(() => void this.reload());
  }

  addPet() {
    this.dialog
      .open(PetFormDialog, {
        width: 'min(480px, 100vw)',
        data: { customerId: this.customerId },
      })
      .afterClosed()
      .subscribe(() => void this.reload());
  }

  editPet(p: PetRow) {
    this.dialog
      .open(PetFormDialog, {
        width: 'min(480px, 100vw)',
        data: { customerId: this.customerId, pet: p },
      })
      .afterClosed()
      .subscribe(() => void this.reload());
  }

  canDeletePet(p: PetRow): boolean {
    return !this.petsWithHistory().has(p.id);
  }

  async deletePet(p: PetRow) {
    const confirmed = await firstValueFrom(
      this.dialog
        .open(PetDeleteDialog, {
          width: 'min(400px, 100vw)',
          data: { petName: p.name },
        })
        .afterClosed(),
    );
    if (!confirmed) return;
    const { error } = await this.data.deletePet(p.id);
    if (error) {
      const msg = String((error as { message?: string }).message ?? '');
      const blocked =
        msg.includes('PET_HAS_MEDICAL') || msg.includes('historial clínico');
      this.snack.open(
        blocked ? 'No se puede eliminar: la mascota tiene historial clínico.' : 'No se pudo eliminar la mascota.',
        'OK',
        { duration: 5000 },
      );
      return;
    }
    await this.reload();
  }
}
