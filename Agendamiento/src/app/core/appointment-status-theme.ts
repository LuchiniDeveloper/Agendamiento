/**
 * Colores de estado de cita: una sola fuente para calendario, dashboard y leyendas.
 * Confirmada = ámbar (no verde/teal, para no confundir con Completada).
 */

export const APPOINTMENT_CALENDAR_STATUS: Record<string, { bg: string; border: string }> = {
  Agendada: { bg: '#c5d0f0', border: '#7c8fd4' },
  Confirmada: { bg: '#fde6c4', border: '#d1982e' },
  Completada: { bg: '#b9deb9', border: '#6aaf6c' },
  Cancelada: { bg: '#cfd8dc', border: '#8fa3ad' },
  NoShow: { bg: '#f0bcb4', border: '#d97d6e' },
};

export const APPOINTMENT_CALENDAR_STATUS_DEFAULT = { bg: '#cad4f5', border: '#8fa3e6' };

/** Hex sólido para gráficas, dona de estados y texto de leyenda en dashboard. */
export const APPOINTMENT_STATUS_CHART_HEX: Record<string, string> = {
  Agendada: '#5c6bc0',
  Confirmada: '#c27803',
  Completada: '#43a047',
  Cancelada: '#9e9e9e',
  NoShow: '#e53935',
};

/** Texto sobre celdas pastel del calendario (claro u oscuro del sitio). */
export const EVENT_TEXT_ON_CALENDAR_PASTEL = '#0f172a';

export function appointmentCalendarCellTheme(statusName: string | undefined) {
  return APPOINTMENT_CALENDAR_STATUS[statusName ?? ''] ?? APPOINTMENT_CALENDAR_STATUS_DEFAULT;
}

export function appointmentStatusChartHex(statusName: string | undefined): string {
  if (!statusName || statusName === '—') return 'var(--mat-sys-outline)';
  return APPOINTMENT_STATUS_CHART_HEX[statusName] ?? 'var(--mat-sys-primary)';
}

/**
 * Solo dashboard — dona «Citas por estado» y puntos de leyenda.
 * Conserva el matiz del borde de la agenda (`border`) y lo oscurece un poco para que no se vea lavado en la tarjeta.
 * No afecta al calendario.
 */
export function appointmentStatusDashboardDonutSliceColor(statusName: string | undefined): string {
  if (!statusName || statusName === '—') return 'var(--mat-sys-outline-variant)';
  const b = appointmentCalendarCellTheme(statusName).border;
  return `color-mix(in srgb, ${b} 74%, black 26%)`;
}
