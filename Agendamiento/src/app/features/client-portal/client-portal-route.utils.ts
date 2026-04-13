import type { ActivatedRouteSnapshot } from '@angular/router';

/** `businessId` en esta ruta o en un padre (p. ej. `portal/:businessId/...`). */
export function snapshotBusinessId(s: ActivatedRouteSnapshot | null): string | null {
  for (let r: ActivatedRouteSnapshot | null = s; r; r = r.parent ?? null) {
    const b = r.paramMap.get('businessId');
    if (b) return b;
  }
  return null;
}
