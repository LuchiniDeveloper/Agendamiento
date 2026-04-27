/**
 * Plantillas HTML alineadas al tema del panel (azul clínico + acento cyan, DM Sans).
 * Textos en tono cercano y respetuoso para tutores de mascotas.
 */

export const BRAND = {
  primary: '#1a5fb4',
  primaryDark: '#0d47a1',
  accent: '#00838f',
  surface: '#f4f8fc',
  onSurface: '#1c2b3a',
  muted: '#5c6b7a',
  subtle: '#94a3b8',
  card: '#ffffff',
} as const;

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export type EmailLayoutCtx = {
  title: string;
  preheader: string;
  businessName: string;
  innerHtml: string;
  footerLine?: string;
};

export function emailLayout(ctx: EmailLayoutCtx): string {
  const footer = ctx.footerLine?.trim()
    ? esc(ctx.footerLine)
    : 'Si tenés alguna duda, podés responder a este correo o contactarnos por los medios habituales. Estamos para ayudarte a cuidar a tu compañero.';
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width" />
  <title>${esc(ctx.title)}</title>
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,600;0,9..40,700&display=swap" rel="stylesheet" />
</head>
<body style="margin:0;background:${BRAND.surface};font-family:'DM Sans',Segoe UI,Roboto,Helvetica,sans-serif;color:${BRAND.onSurface};">
  <span style="display:none!important;visibility:hidden;opacity:0;height:0;width:0;overflow:hidden;">${esc(ctx.preheader)}</span>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.surface};padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:${BRAND.card};border-radius:16px;overflow:hidden;box-shadow:0 14px 44px -14px rgba(22,45,72,0.11);border:1px solid #e3edf5;">
          <tr>
            <td style="padding:24px 28px 8px 28px;background:linear-gradient(135deg,${BRAND.primary} 0%,${BRAND.primaryDark} 55%,${BRAND.accent} 130%);">
              <p style="margin:0;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:rgba(255,255,255,0.85);">Tu clínica de confianza</p>
              <h1 style="margin:6px 0 0 0;font-size:22px;line-height:1.25;color:#ffffff;font-weight:700;">${esc(ctx.businessName)}</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 28px 8px 28px;">
              ${ctx.innerHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:0 28px 24px 28px;">
              <p style="margin:16px 0 0 0;font-size:13px;line-height:1.55;color:${BRAND.muted};">${footer}</p>
            </td>
          </tr>
        </table>
        <p style="margin:16px 0 0;font-size:11px;color:${BRAND.subtle};">Este mensaje fue enviado automáticamente por el sistema de citas de ${esc(ctx.businessName)}.</p>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function ctaButton(label: string, url: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px 0;">
  <tr>
    <td bgcolor="${BRAND.primary}" style="border-radius:10px;">
      <a href="${esc(url)}" style="display:inline-block;padding:12px 22px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;font-family:'DM Sans',Segoe UI,sans-serif;">${esc(label)}</a>
    </td>
  </tr>
</table>`;
}

export type KindPayload = {
  kind: string;
  businessName: string;
  businessAddress?: string | null;
  businessPhone?: string | null;
  customerName: string;
  petName: string;
  serviceName: string;
  vetName: string;
  whenFormatted: string;
  earlierSlotWhenFormatted?: string;
  confirmUrl?: string;
  rescheduleUrl?: string;
  diagnosisExcerpt?: string | null;
  diagnosis?: string | null;
  treatment?: string | null;
  observations?: string | null;
  weight?: number | null;
  nextVisitDate?: string | null;
  invoice?: {
    invoiceNo: string;
    issueLabel: string;
    appointmentId: string;
    serviceLabel: string;
    serviceAmount: number;
    extrasLines: { description: string; amount: number }[];
    extrasAmount: number;
    paymentLine: string;
    paymentId: string | null;
    proofLine: string;
    totalPaid: number;
    totalExpected: number;
    customerName: string;
    petName: string;
    vetName: string;
  };
};

function money(v: number): string {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(Number(v ?? 0));
}

export function buildEmailForKind(p: KindPayload): { subject: string; html: string; preheader: string } {
  const name = p.customerName.trim() || 'Hola';
  const pet = p.petName.trim() || 'tu mascota';

  switch (p.kind) {
    case 'CREATED': {
      const pre = `Ya reservamos un turno para ${pet} en ${p.businessName}.`;
      const inner = `
        <p style="margin:0 0 12px 0;font-size:16px;line-height:1.55;color:${BRAND.onSurface};">${esc(name)}, gracias por confiar en nosotros.</p>
        <p style="margin:0 0 12px 0;font-size:15px;line-height:1.6;color:${BRAND.muted};">Queríamos confirmarte que ya dejamos registrada la visita de <strong>${esc(pet)}</strong> para el <strong>${esc(p.whenFormatted)}</strong>. El motivo de la consulta es <strong>${esc(p.serviceName)}</strong> y el equipo estará atento a lo que necesiten.</p>
        <p style="margin:0;font-size:15px;line-height:1.6;color:${BRAND.muted};">Si necesitás cambiar algo o contarnos un detalle importante sobre su salud o comportamiento, respondé a este mensaje y con gusto te ayudamos.</p>`;
      return {
        subject: `${p.businessName}: cita agendada para ${pet}`,
        preheader: pre,
        html: emailLayout({
          title: 'Cita agendada',
          preheader: pre,
          businessName: p.businessName,
          innerHtml: inner,
          footerLine: [p.businessAddress, p.businessPhone].filter(Boolean).join(' · ') || undefined,
        }),
      };
    }
    case 'CONFIRM_REMINDER': {
      const pre = `Recordatorio: ${pet} tiene cita hoy.`;
      const inner = `
        <p style="margin:0 0 12px 0;font-size:16px;line-height:1.55;color:${BRAND.onSurface};">${esc(name)}, ¿cómo estás?</p>
        <p style="margin:0 0 12px 0;font-size:15px;line-height:1.6;color:${BRAND.muted};">Sabemos que el día puede ser intenso. Te escribimos para recordarte que <strong>${esc(pet)}</strong> tiene cita el <strong>${esc(p.whenFormatted)}</strong> con <strong>${esc(p.vetName)}</strong> (${esc(p.serviceName)}).</p>
        <p style="margin:0 0 16px 0;font-size:15px;line-height:1.6;color:${BRAND.muted};">Si podés confirmar con un clic, nos ayuda a organizar mejor la sala de espera. Si no podés venir, también podés avisarnos para liberar el turno a otra familia.</p>
        ${p.confirmUrl ? ctaButton('Confirmar asistencia', p.confirmUrl) : ''}`;
      return {
        subject: `Recordatorio: cita de ${pet} · ${p.businessName}`,
        preheader: pre,
        html: emailLayout({
          title: 'Recordatorio de cita',
          preheader: pre,
          businessName: p.businessName,
          innerHtml: inner,
        }),
      };
    }
    case 'COMPLETED_SUMMARY': {
      const pre = `Información después de la consulta de ${pet}.`;
      const diag = (p.diagnosisExcerpt ?? '').trim();
      const diagBlock = diag
        ? `<p style="margin:12px 0 0 0;padding:14px 16px;background:${BRAND.surface};border-radius:12px;border-left:4px solid ${BRAND.accent};font-size:14px;line-height:1.55;color:${BRAND.onSurface};"><strong>Resumen:</strong> ${esc(diag)}</p>`
        : `<p style="margin:12px 0 0 0;font-size:15px;line-height:1.6;color:${BRAND.muted};">Dejamos registrada la consulta en la historia clínica de ${esc(pet)}. Si el equipo compartió indicaciones específicas, las encontrarás también en la clínica.</p>`;
      const clinicalRows = [
        p.diagnosis ? `<tr><td style="padding:8px 10px;color:${BRAND.muted};font-size:13px;">Diagnóstico</td><td style="padding:8px 10px;color:${BRAND.onSurface};font-size:13px;">${esc(p.diagnosis)}</td></tr>` : '',
        p.treatment ? `<tr><td style="padding:8px 10px;color:${BRAND.muted};font-size:13px;">Tratamiento</td><td style="padding:8px 10px;color:${BRAND.onSurface};font-size:13px;">${esc(p.treatment)}</td></tr>` : '',
        p.observations ? `<tr><td style="padding:8px 10px;color:${BRAND.muted};font-size:13px;">Observaciones</td><td style="padding:8px 10px;color:${BRAND.onSurface};font-size:13px;">${esc(p.observations)}</td></tr>` : '',
        p.weight != null ? `<tr><td style="padding:8px 10px;color:${BRAND.muted};font-size:13px;">Peso</td><td style="padding:8px 10px;color:${BRAND.onSurface};font-size:13px;">${esc(String(p.weight))} kg</td></tr>` : '',
        p.nextVisitDate ? `<tr><td style="padding:8px 10px;color:${BRAND.muted};font-size:13px;">Próxima visita sugerida</td><td style="padding:8px 10px;color:${BRAND.onSurface};font-size:13px;">${esc(p.nextVisitDate)}</td></tr>` : '',
      ]
        .filter(Boolean)
        .join('');

      const inv = p.invoice;
      const extrasRows =
        inv?.extrasLines
          ?.map(
            (l) =>
              `<tr><td style="padding:8px 10px;border-bottom:1px solid #e6eef6;color:${BRAND.onSurface};font-size:13px;">${esc(l.description)}</td><td style="padding:8px 10px;border-bottom:1px solid #e6eef6;color:${BRAND.onSurface};font-size:13px;text-align:right;">${money(l.amount)}</td></tr>`,
          )
          .join('') ?? '';
      const invoiceBlock = inv
        ? `<div style="margin-top:16px;border:1px solid #dbe8f5;border-radius:12px;overflow:hidden;background:#fff;">
            <div style="padding:14px 16px;background:linear-gradient(135deg,${BRAND.primary} 0%,${BRAND.primaryDark} 65%,${BRAND.accent} 130%);color:#fff;">
              <p style="margin:0;font-size:11px;letter-spacing:.08em;text-transform:uppercase;opacity:.9;">Factura</p>
              <p style="margin:4px 0 0 0;font-size:18px;font-weight:700;">${esc(inv.invoiceNo)}</p>
              <p style="margin:4px 0 0 0;font-size:12px;opacity:.9;">Emitida: ${esc(inv.issueLabel)} · Cita: ${esc(inv.appointmentId)}</p>
            </div>
            <div style="padding:12px 16px;background:#f7fbff;border-bottom:1px solid #e6eef6;font-size:13px;color:${BRAND.onSurface};">
              <strong>${esc(inv.customerName)}</strong> · ${esc(inv.petName)} · Vet: ${esc(inv.vetName)}
            </div>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
              <thead>
                <tr>
                  <th style="padding:9px 10px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:${BRAND.muted};border-bottom:1px solid #e6eef6;">Concepto</th>
                  <th style="padding:9px 10px;text-align:right;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:${BRAND.muted};border-bottom:1px solid #e6eef6;">Valor</th>
                </tr>
              </thead>
              <tbody>
                <tr><td style="padding:8px 10px;border-bottom:1px solid #e6eef6;color:${BRAND.onSurface};font-size:13px;">${esc(inv.serviceLabel)}</td><td style="padding:8px 10px;border-bottom:1px solid #e6eef6;color:${BRAND.onSurface};font-size:13px;text-align:right;">${money(inv.serviceAmount)}</td></tr>
                ${extrasRows}
              </tbody>
            </table>
            <div style="padding:12px 16px;border-top:1px solid #e6eef6;background:#fbfdff;">
              <p style="margin:0 0 6px 0;font-size:13px;color:${BRAND.muted};">Método de pago: <strong style="color:${BRAND.onSurface};">${esc(inv.paymentLine)}</strong></p>
              <p style="margin:0 0 6px 0;font-size:13px;color:${BRAND.muted};">Comprobante: <strong style="color:${BRAND.onSurface};">${esc(inv.proofLine)}</strong></p>
              <p style="margin:0 0 6px 0;font-size:13px;color:${BRAND.muted};">ID pago: <strong style="color:${BRAND.onSurface};">${esc(inv.paymentId ?? '—')}</strong></p>
              <p style="margin:0 0 4px 0;font-size:13px;color:${BRAND.muted};">Total facturado: <strong style="color:${BRAND.onSurface};">${money(inv.totalExpected)}</strong></p>
              <p style="margin:0;font-size:16px;font-weight:700;color:${BRAND.primaryDark};">Total pagado: ${money(inv.totalPaid)}</p>
            </div>
          </div>`
        : '';
      const clinicalBlock = clinicalRows
        ? `<div style="margin-top:16px;border:1px solid #dbe8f5;border-radius:12px;overflow:hidden;background:#fff;">
            <div style="padding:12px 16px;background:#f7fbff;border-bottom:1px solid #e6eef6;">
              <p style="margin:0;font-size:13px;font-weight:700;color:${BRAND.onSurface};">Historial clínico de la consulta</p>
            </div>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
              ${clinicalRows}
            </table>
          </div>`
        : '';
      const inner = `
        <p style="margin:0 0 12px 0;font-size:16px;line-height:1.55;color:${BRAND.onSurface};">${esc(name)}, gracias por acompañar a ${esc(pet)}.</p>
        <p style="margin:0 0 12px 0;font-size:15px;line-height:1.6;color:${BRAND.muted};">Te enviamos un breve resumen después de la visita del <strong>${esc(p.whenFormatted)}</strong>. Si algo no quedó claro o preferís comentarlo con calma, podés responder a este correo.</p>
        ${diagBlock}
        ${invoiceBlock}
        ${clinicalBlock}
        <p style="margin:16px 0 0 0;font-size:15px;line-height:1.6;color:${BRAND.muted};">Si notás algo que te preocupa en casa, no dudes en escribirnos: preferimos que preguntes de más antes que quedarte con la duda.</p>`;
      return {
        subject: `Después de la consulta de ${pet} · ${p.businessName}`,
        preheader: pre,
        html: emailLayout({
          title: 'Información de la consulta',
          preheader: pre,
          businessName: p.businessName,
          innerHtml: inner,
        }),
      };
    }
    case 'CANCELLED_ACK': {
      const pre = `La cita de ${pet} quedó cancelada.`;
      const inner = `
        <p style="margin:0 0 12px 0;font-size:16px;line-height:1.55;color:${BRAND.onSurface};">${esc(name)}, te escribimos por un tema práctico.</p>
        <p style="margin:0 0 12px 0;font-size:15px;line-height:1.6;color:${BRAND.muted};">Registramos la cancelación de la visita de <strong>${esc(pet)}</strong> prevista para el <strong>${esc(p.whenFormatted)}</strong>. Si fue por un imprevisto, no pasa nada: cuando quieras volver a agendar, estamos acá.</p>
        <p style="margin:0;font-size:15px;line-height:1.6;color:${BRAND.muted};">Si la cancelación fue un error o querés otro turno, respondé a este mensaje y lo vemos juntos.</p>`;
      return {
        subject: `Cita cancelada · ${p.businessName}`,
        preheader: pre,
        html: emailLayout({
          title: 'Cita cancelada',
          preheader: pre,
          businessName: p.businessName,
          innerHtml: inner,
        }),
      };
    }
    case 'NOSHOW_RESCHEDULE': {
      const pre = `Podés elegir un nuevo turno para ${pet} cuando quieras.`;
      const inner = `
        <p style="margin:0 0 12px 0;font-size:16px;line-height:1.55;color:${BRAND.onSurface};">${esc(name)}, ¿cómo estás?</p>
        <p style="margin:0 0 12px 0;font-size:15px;line-height:1.6;color:${BRAND.muted};">Notamos que no pudieron asistir a la cita de <strong>${esc(pet)}</strong> del <strong>${esc(p.whenFormatted)}</strong>. A veces el día se complica y lo entendemos perfectamente.</p>
        <p style="margin:0 0 16px 0;font-size:15px;line-height:1.6;color:${BRAND.muted};">Si querés un nuevo turno, podés elegir horario aquí abajo, sin trámites complicados. Nos encantará volver a verlos cuando les quede bien.</p>
        ${p.rescheduleUrl ? ctaButton('Elegir nuevo turno', p.rescheduleUrl) : ''}`;
      return {
        subject: `Nuevo turno para ${pet} · ${p.businessName}`,
        preheader: pre,
        html: emailLayout({
          title: 'Volver a agendar',
          preheader: pre,
          businessName: p.businessName,
          innerHtml: inner,
        }),
      };
    }
    case 'EARLIER_SLOT_AVAILABLE': {
      const pre = `Se liberó un horario más temprano para ${pet}.`;
      const earlierWhen = p.earlierSlotWhenFormatted?.trim() || p.whenFormatted;
      const inner = `
        <p style="margin:0 0 12px 0;font-size:16px;line-height:1.55;color:${BRAND.onSurface};">${esc(name)}, tenemos una opción mejor para ustedes.</p>
        <p style="margin:0 0 12px 0;font-size:15px;line-height:1.6;color:${BRAND.muted};">Se liberó un espacio para <strong>${esc(pet)}</strong> el <strong>${esc(earlierWhen)}</strong>, más temprano que tu cita actual (<strong>${esc(p.whenFormatted)}</strong>).</p>
        <p style="margin:0 0 16px 0;font-size:15px;line-height:1.6;color:${BRAND.muted};">Podés intentar reagendar con el siguiente botón. El cupo se asigna por orden de confirmación, así que puede ocuparse mientras revisás el mensaje.</p>
        ${p.rescheduleUrl ? ctaButton('Intentar reagendar a horario más temprano', p.rescheduleUrl) : ''}`;
      return {
        subject: `Horario más temprano disponible para ${pet} · ${p.businessName}`,
        preheader: pre,
        html: emailLayout({
          title: 'Horario más temprano disponible',
          preheader: pre,
          businessName: p.businessName,
          innerHtml: inner,
        }),
      };
    }
    default:
      return {
        subject: `Notificación · ${p.businessName}`,
        preheader: '',
        html: emailLayout({
          title: 'Notificación',
          preheader: '',
          businessName: p.businessName,
          innerHtml: `<p style="margin:0;font-size:15px;color:${BRAND.muted};">Mensaje del sistema.</p>`,
        }),
      };
  }
}

/** Correo de prueba SMTP (mismo layout que el panel). */
export function buildSmtpTestEmail(businessName: string): { subject: string; html: string } {
  const inner = `
    <p style="margin:0 0 12px 0;font-size:16px;line-height:1.55;color:${BRAND.onSurface};">Este es un <strong>correo de prueba</strong>.</p>
    <p style="margin:0;font-size:15px;line-height:1.6;color:${BRAND.muted};">Si lo recibiste, la configuración SMTP está bien. Podés activar el envío automático de avisos a tus clientes cuando quieras.</p>`;
  return {
    subject: `Prueba SMTP · ${businessName}`,
    html: emailLayout({
      title: 'Prueba de correo',
      preheader: 'Correo de prueba — verificación SMTP.',
      businessName,
      innerHtml: inner,
    }),
  };
}
