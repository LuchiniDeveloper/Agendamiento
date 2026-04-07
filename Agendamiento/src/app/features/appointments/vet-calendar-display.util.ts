/**
 * Primer nombre + primer apellido para etiquetas cortas (heurística ES).
 * Ej.: "Sebastian Silva" → igual; "Ana Maria Delgado" → "Ana Delgado";
 * "María José García López" → "María García".
 */
export function vetDisplayShort(full: string | null | undefined): string {
  const p = (full ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (p.length === 0) return '';
  if (p.length === 1) return p[0];
  if (p.length === 2) return `${p[0]} ${p[1]}`;
  if (p.length === 3) return `${p[0]} ${p[2]}`;
  return `${p[0]} ${p[p.length - 2]}`;
}
