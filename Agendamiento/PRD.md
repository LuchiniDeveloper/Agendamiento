# PRD - Plataforma SaaS de Agendamiento Veterinario (v1 Objetivo)

## 1. Executive Summary

- **Problem Statement**: Las clínicas veterinarias pequeñas pierden ingresos por inasistencias (no-shows), cancelaciones tardías y procesos manuales de agenda/seguimiento. Esto genera huecos improductivos, presión operativa en el equipo y baja rentabilidad.
- **Proposed Solution**: Construir una plataforma cloud (SaaS) de gestión veterinaria enfocada en agenda digital, confirmaciones automáticas, historial clínico estructurado, comunicación con tutores y reportes operativos/financieros accionables.
- **Success Criteria (KPIs medibles)**:
  - Reducir la **tasa de no-shows** al menos un **30%** en los primeros 90 días tras implementación.
  - Lograr una **tasa de retención anual de clientes >= 75%** por clínica.
  - Mantener/optimizar el **Ingreso Medio por Cliente (ACT)** dentro de un rango saludable definido por clínica (con alerta cuando se desvíe por exceso de emergencias o baja venta de preventivos).
  - Alcanzar **>= 90% de citas con confirmación previa** (correo y/o WhatsApp) antes de la hora programada.
  - Reducir en **>= 40%** el tiempo administrativo semanal dedicado a coordinación de agenda y recordatorios.

## 2. User Experience & Functionality

- **User Personas**:
  - **Administrador de clínica (2-5 empleados)**: configura negocio, equipo, servicios, reportes y canales de comunicación.
  - **Veterinario/a**: gestiona citas, registra atención médica, indica próximos controles y monitorea agenda diaria.
  - **Recepción/Auxiliar**: agenda/reagenda, confirma citas, registra pagos y mantiene datos de clientes/mascotas.
  - **Tutor de mascota (cliente final)**: reserva citas, confirma asistencia, consulta próximas citas e historial básico desde portal.

- **User Stories**:
  - Como **recepcionista**, quiero **crear/reagendar citas en una agenda digital con disponibilidad real**, para **evitar solapamientos y llenar horarios productivos**.
  - Como **tutor**, quiero **recibir confirmaciones y recordatorios automáticos por correo y WhatsApp**, para **reducir olvidos y asistir a tiempo**.
  - Como **veterinario**, quiero **registrar historia clínica con estructura SOAP** y próximos controles, para **estandarizar la calidad médica y facilitar seguimiento**.
  - Como **administrador**, quiero **ver KPIs operativos y financieros** (no-shows, ocupación, ingresos, productividad), para **tomar decisiones rápidas basadas en datos**.
  - Como **administrador**, quiero **gestionar personal y roles**, para **delegar funciones con control de permisos**.
  - Como **tutor**, quiero **agendar en línea y revisar citas/documentos de forma segura en portal**, para **tener una experiencia digital sin fricción**.
  - Como **equipo clínico**, quiero **registrar cobros y métodos de pago**, para **tener trazabilidad financiera por cita**.

- **Acceptance Criteria (por historia)**:
  - **Agenda y disponibilidad**:
    - El sistema bloquea doble reserva por profesional y franja horaria.
    - La disponibilidad se calcula por servicio, duración, horario del staff y zona horaria de la clínica.
    - No se permiten reservas en horarios pasados.
  - **Recordatorios y confirmaciones**:
    - Cada cita nueva genera evento de notificación con estado trazable (pendiente/enviado/fallido).
    - El sistema permite marcar/envíar recordatorios y registrar fecha/hora de envío.
    - El tutor puede confirmar desde enlace seguro y la cita actualiza su estado.
  - **Historia clínica SOAP**:
    - Cada atención permite capturar al menos: Subjetivo, Objetivo, Evaluación y Plan.
    - Se registra peso, diagnóstico, tratamiento, observaciones y próxima visita sugerida.
    - El historial por mascota es consultable en orden cronológico con vínculo a cita.
  - **Reportes y KPIs**:
    - Deben existir reportes de ingresos por servicio, productividad del staff, cancelaciones/no-show, ocupación y retención.
    - Exportación a Excel disponible para al menos 50k filas.
    - Dashboard con lectura diaria y tendencias 1/7/30 días.
  - **Roles y seguridad**:
    - Solo Admin accede a configuración sensible (staff, SMTP, reportes avanzados).
    - Veterinario/Admin pueden editar información clínica.
    - Cada usuario solo visualiza datos de su clínica (aislamiento multi-tenant).
  - **Portal de cliente**:
    - Permite registro/login, visualización de citas, perfil y resumen/factura de cita.
    - Permite nueva cita en portal y modo de reserva invitado.
    - No se exponen datos de otros clientes.
  - **Pagos y trazabilidad**:
    - Se registran pagos por cita (efectivo, tarjeta, transferencia) y cargos extra.
    - Se conserva historial de movimientos asociados a la cita.

- **Non-Goals**:
  - No se incluye ERP contable completo ni inventario farmacéutico avanzado en v1.
  - No se incluye telemedicina en tiempo real ni video-consulta.
  - No se incluye app móvil nativa (solo web responsive).
  - No se automatiza facturación electrónica país por país en MVP (solo preparación e interfaces base).
  - No se implementan modelos predictivos de IA clínica en esta fase.

## 3. AI System Requirements (If Applicable)

- **Tool Requirements**:
  - v1 no depende de IA generativa para operación core.
  - Opcional futuro (v1.1+): clasificación automática de riesgo de no-show, priorización de recordatorios y sugerencias de reactivación de clientes inactivos.
- **Evaluation Strategy**:
  - Si se activa IA en fases posteriores:
    - Precision de priorización de no-show >= 80% en validación retrospectiva.
    - Lift de asistencia >= 10% en cohortes con intervención vs control.
    - Revisión humana obligatoria para recomendaciones con impacto clínico/financiero.

## 4. Technical Specifications

- **Architecture Overview**:
  - Frontend web en Angular (SPA/SSR opcional) con módulos de autenticación, onboarding, agenda, clientes/mascotas, historial clínico, reportes, recordatorios y portal cliente.
  - Backend gestionado en Supabase (Postgres, Auth, Realtime, RPC SQL y Edge Functions).
  - Multi-tenant por `business_id`, con contexto de clínica cargado por perfil de staff.
  - Flujos críticos implementados por RPC: bootstrap/unión de clínica, disponibilidad de agenda, booking público, reportes y confirmación de citas.
  - Eventos de notificación persistidos para trazabilidad por cita.

- **Integration Points**:
  - **Auth**: Supabase Auth para staff y portal cliente.
  - **DB**: Postgres con tablas de negocio (appointment, medical_record, staff, customer, pet, service, payment, reminder, appointment_notification, etc.).
  - **Realtime**: actualización de historial de notificaciones por cita.
  - **Edge Functions**:
    - Invitación/gestión de personal.
    - Prueba/envío SMTP.
    - Integraciones de mensajería (base para WhatsApp Business API).
  - **Comunicación**:
    - Email transaccional por SMTP configurable por clínica.
    - WhatsApp: v1 con enlace directo y módulo preparado para API oficial.
  - **Exportación**: Excel para reportes operativos y financieros.
  - **Integración fiscal (preparación)**:
    - Diseño de capa de adaptación para DIAN (Colombia), Verifactu (España) y equivalentes.

- **Security & Privacy**:
  - Aislamiento de datos por clínica (RLS y políticas por tenant en Supabase).
  - Cifrado en tránsito (TLS) y cifrado en reposo del proveedor cloud.
  - Gestión de roles (Admin, Veterinario y otros) con control de acceso por ruta/acción.
  - Registro de auditoría mínimo para eventos sensibles (autenticación, cambios críticos, notificaciones, pagos).
  - Cumplimiento de protección de datos personales aplicable en LATAM (consentimiento, minimización de datos, retención y eliminación controlada).
  - Respaldos automáticos y estrategia de recuperación ante desastres.

## 5. Risks & Roadmap

- **Phased Rollout**:
  - **MVP (0-3 meses)**:
    - Agenda digital con disponibilidad por profesional/servicio.
    - Gestión de clientes y mascotas.
    - Recordatorios base por email y contacto WhatsApp.
    - Estado de citas (agendada, confirmada, cancelada, no-show, completada).
    - Registro de pagos básicos y dashboard inicial.
  - **v1.1 (3-6 meses)**:
    - Historia clínica estructurada SOAP completa.
    - Portal cliente robusto (autogestión de citas, historial y documentos por cita).
    - Reportes ampliados (retención, productividad avanzada, cohortes de inasistencia).
    - Integración oficial con WhatsApp Business API para envíos automáticos.
  - **v2.0 (6-12 meses)**:
    - Conectores fiscales por país (DIAN/Verifactu u otros).
    - Automatización avanzada de seguimiento preventivo.
    - Motor de reglas para campañas de reactivación y prevención de no-show.

- **Technical Risks**:
  - Dependencia de APIs externas (correo, WhatsApp, fiscal) y posibles cambios de política/costo.
  - Variabilidad regulatoria por país para datos personales y facturación electrónica.
  - Riesgo de adopción en PYMEs si la configuración inicial es compleja.
  - Calidad inconsistente de datos históricos (migración desde agenda física o procesos manuales).
  - Picos de latencia en consultas/reportes extensos sin estrategia de particionado/índices.

- **Mitigaciones**:
  - Diseño API-first con capa de integración desacoplada por proveedor/país.
  - Onboarding guiado y plantillas de configuración por tipo de clínica.
  - Observabilidad de notificaciones/fallos y reintentos controlados.
  - Buenas prácticas de índice y consultas en Postgres desde la fase MVP.
  - Entrega incremental con validación temprana de KPIs por cohorte de clínicas piloto.
