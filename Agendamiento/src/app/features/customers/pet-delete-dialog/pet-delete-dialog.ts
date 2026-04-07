import { Component, inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';

export interface PetDeleteDialogData {
  petName: string;
}

@Component({
  selector: 'app-pet-delete-dialog',
  imports: [MatDialogModule, MatButtonModule],
  templateUrl: './pet-delete-dialog.html',
})
export class PetDeleteDialog {
  protected readonly ref = inject(MatDialogRef<PetDeleteDialog, boolean>);
  protected readonly data = inject(MAT_DIALOG_DATA) as PetDeleteDialogData;

  cancel() {
    this.ref.close(false);
  }

  confirm() {
    this.ref.close(true);
  }
}
