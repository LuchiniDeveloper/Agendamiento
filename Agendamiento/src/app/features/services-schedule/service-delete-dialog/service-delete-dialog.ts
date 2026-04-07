import { Component, inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import type { ServiceRow } from '../services.data';

export interface ServiceDeleteDialogData {
  service: ServiceRow;
}

@Component({
  selector: 'app-service-delete-dialog',
  imports: [MatDialogModule, MatButtonModule, MatIconModule],
  templateUrl: './service-delete-dialog.html',
  styleUrl: './service-delete-dialog.scss',
})
export class ServiceDeleteDialog {
  protected readonly ref = inject(MatDialogRef<ServiceDeleteDialog, boolean>);
  protected readonly data = inject(MAT_DIALOG_DATA) as ServiceDeleteDialogData;

  cancel() {
    this.ref.close(false);
  }

  confirm() {
    this.ref.close(true);
  }
}
