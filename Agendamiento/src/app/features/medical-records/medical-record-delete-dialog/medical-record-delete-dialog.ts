import { Component, inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import type { MedicalRecordRow } from '../medical.data';

export interface MedicalRecordDeleteDialogData {
  record: MedicalRecordRow;
}

@Component({
  selector: 'app-medical-record-delete-dialog',
  imports: [MatDialogModule, MatButtonModule, MatIconModule],
  templateUrl: './medical-record-delete-dialog.html',
  styleUrl: './medical-record-delete-dialog.scss',
})
export class MedicalRecordDeleteDialog {
  protected readonly ref = inject(MatDialogRef<MedicalRecordDeleteDialog, boolean>);
  protected readonly data = inject(MAT_DIALOG_DATA) as MedicalRecordDeleteDialogData;

  cancel() {
    this.ref.close(false);
  }

  confirm() {
    this.ref.close(true);
  }
}
