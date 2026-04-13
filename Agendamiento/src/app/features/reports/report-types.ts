/** Catalog metadata + RPC names (aligned with supabase report_* functions). */

export type ReportId =
  | 'revenue_by_service'
  | 'staff_productivity'
  | 'customer_retention'
  | 'cancellations'
  | 'medical_history'
  | 'agenda_occupancy';

export type DateGrain = 'day' | 'week' | 'month';

export type CancellationFilter = 'Cancelada' | 'NoShow' | 'Ambos';

export interface ReportDefinition {
  id: ReportId;
  rpc: string;
  tag: string;
  title: string;
  description: string;
  insight: string;
  /** Column keys in display order (match SQL JSON keys). */
  columns: { key: string; label: string; format?: 'currency' | 'percent' | 'number' | 'text' }[];
}

export const REPORT_DEFINITIONS: ReportDefinition[] = [
  {
    id: 'revenue_by_service',
    rpc: 'report_revenue_by_service',
    tag: 'Financiero',
    title: 'Ingresos por servicio y período',
    description: 'Cuánto factura cada servicio en el tiempo. Identifica cuáles son los más rentables.',
    insight:
      'Permite detectar estacionalidad: si un servicio cae en ciertos meses, es señal de ajustar disponibilidad o promociones.',
    columns: [
      { key: 'periodo', label: 'Periodo', format: 'text' },
      { key: 'servicio', label: 'Servicio', format: 'text' },
      { key: 'total_citas_completadas', label: 'Citas completadas', format: 'number' },
      { key: 'ingresos_brutos', label: 'Ingresos brutos', format: 'currency' },
      { key: 'gastos_adicionales', label: 'Gastos adicionales', format: 'currency' },
      { key: 'ingreso_promedio_por_cita', label: 'Ingreso prom. por cita', format: 'currency' },
      { key: 'metodo_pago_principal', label: 'Método de pago principal', format: 'text' },
      { key: 'codigo_comprobante_transferencia', label: 'Código comprobante (transferencia)', format: 'text' },
      { key: 'pct_del_total', label: '% del total', format: 'percent' },
    ],
  },
  {
    id: 'staff_productivity',
    rpc: 'report_staff_productivity',
    tag: 'Operacional',
    title: 'Productividad por veterinario',
    description:
      'Rendimiento por veterinario con al menos una cita en el período: citas, ingresos y tasa de completitud.',
    insight:
      'Una tasa de completitud baja puede indicar problemas de agenda, cancelaciones o necesidad de recordatorios más tempranos.',
    columns: [
      { key: 'staff_nombre', label: 'Staff', format: 'text' },
      { key: 'rol', label: 'Rol', format: 'text' },
      { key: 'citas_agendadas', label: 'Citas agendadas', format: 'number' },
      { key: 'citas_completadas', label: 'Completadas', format: 'number' },
      { key: 'canceladas', label: 'Canceladas', format: 'number' },
      { key: 'no_show', label: 'No-show', format: 'number' },
      { key: 'tasa_completitud', label: 'Tasa completitud', format: 'percent' },
      { key: 'ingresos_generados', label: 'Ingresos generados', format: 'currency' },
      { key: 'duracion_promedio_min', label: 'Duración prom. (min)', format: 'number' },
    ],
  },
  {
    id: 'customer_retention',
    rpc: 'report_customer_retention',
    tag: 'Clientes',
    title: 'Retención y valor de clientes',
    description: 'Clientes por frecuencia de visitas y valor pagado. Base para estrategias de fidelización.',
    insight:
      'Clientes con muchos días sin visita y historial de citas son candidatos para campañas de reactivación.',
    columns: [
      { key: 'cliente_nombre', label: 'Cliente', format: 'text' },
      { key: 'telefono', label: 'Teléfono', format: 'text' },
      { key: 'email', label: 'Email', format: 'text' },
      { key: 'total_mascotas', label: 'Mascotas', format: 'number' },
      { key: 'total_citas', label: 'Total citas', format: 'number' },
      { key: 'ultima_cita', label: 'Última cita', format: 'text' },
      { key: 'total_pagado', label: 'Total pagado', format: 'currency' },
      { key: 'dias_sin_visita', label: 'Días sin visita', format: 'number' },
    ],
  },
  {
    id: 'cancellations',
    rpc: 'report_cancellations',
    tag: 'Operacional',
    title: 'Análisis de cancelaciones y no-shows',
    description: 'Identifica patrones: qué días, servicios u horarios concentran más ausentismo.',
    insight:
      'Si ciertos días u horas concentran no-shows, considera mover ese horario o reforzar confirmación.',
    columns: [
      { key: 'fecha', label: 'Fecha', format: 'text' },
      { key: 'dia_semana', label: 'Día', format: 'text' },
      { key: 'hora', label: 'Hora', format: 'text' },
      { key: 'servicio', label: 'Servicio', format: 'text' },
      { key: 'cliente', label: 'Cliente', format: 'text' },
      { key: 'mascota', label: 'Mascota', format: 'text' },
      { key: 'staff', label: 'Staff', format: 'text' },
      { key: 'estado', label: 'Estado', format: 'text' },
      { key: 'recordatorio_enviado', label: 'Recordatorio enviado', format: 'text' },
    ],
  },
  {
    id: 'medical_history',
    rpc: 'report_medical_history',
    tag: 'Mascotas',
    title: 'Historial clínico por especie y raza',
    description:
      'Diagnósticos más frecuentes por tipo de paciente. Útil para planificar insumos y especialidades.',
    insight:
      'Agrupar por diagnóstico permite detectar brotes o tendencias por estación.',
    columns: [
      { key: 'mascota', label: 'Mascota', format: 'text' },
      { key: 'especie', label: 'Especie', format: 'text' },
      { key: 'raza', label: 'Raza', format: 'text' },
      { key: 'edad_aprox', label: 'Edad aprox.', format: 'text' },
      { key: 'peso_kg', label: 'Peso (kg)', format: 'number' },
      { key: 'diagnostico', label: 'Diagnóstico', format: 'text' },
      { key: 'tratamiento', label: 'Tratamiento', format: 'text' },
      { key: 'veterinario', label: 'Veterinario', format: 'text' },
      { key: 'fecha_consulta', label: 'Fecha consulta', format: 'text' },
      { key: 'proxima_visita', label: 'Próxima visita', format: 'text' },
    ],
  },
  {
    id: 'agenda_occupancy',
    rpc: 'report_agenda_occupancy',
    tag: 'Financiero',
    title: 'Ocupación y eficiencia de agenda',
    description:
      'Porcentaje del tiempo disponible usado y slots vacíos. Ingreso potencial no realizado = slots vacíos × precio promedio del servicio del staff en el período.',
    insight:
      'Una ocupación baja en semanas sin festivos indica capacidad desaprovechada. Cruza con cancelaciones para ver si es demanda o ausentismo.',
    columns: [
      { key: 'staff', label: 'Staff', format: 'text' },
      { key: 'semana', label: 'Semana', format: 'text' },
      { key: 'slots_disponibles', label: 'Slots disponibles', format: 'number' },
      { key: 'slots_ocupados', label: 'Slots ocupados', format: 'number' },
      { key: 'slots_vacios', label: 'Slots vacíos', format: 'number' },
      { key: 'tasa_ocupacion_pct', label: 'Tasa ocupación %', format: 'percent' },
      { key: 'ingresos_potenciales_no_realizados', label: 'Ingreso potencial no realizado', format: 'currency' },
    ],
  },
];

export type ReportRow = Record<string, string | number | null>;
