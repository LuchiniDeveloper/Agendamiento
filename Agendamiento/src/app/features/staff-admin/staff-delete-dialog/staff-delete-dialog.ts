import { Component, inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

export interface StaffDeleteDialogData {
  name: string;
  email: string | null;
}

@Component({
  selector: 'app-staff-delete-dialog',
  imports: [MatDialogModule, MatButtonModule, MatIconModule],
  templateUrl: './staff-delete-dialog.html',
  styleUrl: './staff-delete-dialog.scss',
})
export class StaffDeleteDialog {
  protected readonly ref = inject(MatDialogRef<StaffDeleteDialog, boolean>);
  protected readonly data = inject(MAT_DIALOG_DATA) as StaffDeleteDialogData;

  cancel() {
    this.ref.close(false);
  }

  confirm() {
    this.ref.close(true);
  }
}
