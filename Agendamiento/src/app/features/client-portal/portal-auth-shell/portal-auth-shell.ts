import { booleanAttribute, Component, input, ViewEncapsulation } from '@angular/core';

@Component({
  selector: 'app-portal-auth-shell',
  imports: [],
  templateUrl: './portal-auth-shell.html',
  styleUrl: './portal-auth-shell.scss',
  encapsulation: ViewEncapsulation.None,
  host: { class: 'portal-auth-host' },
})
export class PortalAuthShell {
  /** Formularios largos (p. ej. registro): columna del panel algo más ancha en desktop. */
  readonly widePanel = input(false, { transform: booleanAttribute });
}
