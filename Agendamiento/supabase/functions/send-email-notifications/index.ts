import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { buildEmailForKind, type KindPayload } from '../_shared/email-templates.ts';
import { createSmtpTransport } from '../_shared/smtp-transport.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors });
  }

  if (req.method !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) {
    return json(500, { error: 'Missing Supabase env' });
  }

  const auth = req.headers.get('Authorization');
  if (!auth?.startsWith('Bearer ') || auth.slice(7).trim() !== serviceKey) {
    return json(401, { error: 'Unauthorized' });
  }

  let limit = 20;
  try {
    const body = await req.json().catch(() => ({}));
    if (typeof body?.limit === 'number' && body.limit > 0) limit = Math.min(50, body.limit);
  } catch {
    /* default limit */
  }

  const admin = createClient(supabaseUrl, serviceKey);

  const { data: batch, error: claimErr } = await admin.rpc('claim_pending_notifications', {
    p_limit: limit,
  });
  if (claimErr) {
    console.error(claimErr);
    return json(500, { error: formatUnknownError(claimErr) });
  }

  const rows = (batch ?? []) as NotificationRow[];
  let sent = 0;
  let failed = 0;

  const appPublicUrl = (Deno.env.get('APP_PUBLIC_URL') ?? 'http://localhost:4200').replace(/\/$/, '');

  for (const n of rows) {
    try {
      const r = await processOne(admin, n, appPublicUrl);
      if (r === 'sent') sent++;
      else if (r === 'failed') failed++;
    } catch (e) {
      failed++;
      const msg = formatUnknownError(e);
      console.error(`send failed ${n.id}: ${msg}`);
      await admin.rpc('finish_notification_send', {
        p_id: n.id,
        p_success: false,
        p_error: msg,
        p_provider_id: null,
      });
    }
  }

  return json(200, { ok: true, processed: rows.length, sent, failed });
});

type NotificationRow = {
  id: string;
  business_id: string;
  appointment_id: string;
  kind: string;
  status: string;
  recipient_email: string | null;
  payload_snapshot: { diagnosis_excerpt?: string } | null;
};

type InvoiceLine = { description: string; amount: number };

async function processOne(
  admin: ReturnType<typeof createClient>,
  n: NotificationRow,
  appPublicUrl: string,
): Promise<'sent' | 'failed' | 'skipped'> {
  const { data: appt, error: apptErr } = await admin
    .from('appointment')
    .select(
      `
      id,
      start_date_time,
      end_date_time,
      business_id,
      customer:customer_id (name, email),
      pet:pet_id (name),
      service:service_id (name, price),
      vet:user_id (name)
    `,
    )
    .eq('id', n.appointment_id)
    .single();

  if (apptErr || !appt) {
    throw new Error('Cita no encontrada');
  }

  const { data: biz, error: bizErr } = await admin
    .from('business')
    .select('id, name, address, phone, email')
    .eq('id', n.business_id)
    .single();

  if (bizErr || !biz) {
    throw new Error('Negocio no encontrado');
  }

  const { data: smtp, error: smtpErr } = await admin
    .from('business_smtp_settings')
    .select('*')
    .eq('business_id', n.business_id)
    .maybeSingle();

  if (smtpErr) throw smtpErr;
  if (!smtp?.enabled || !smtp.host || !smtp.from_email) {
    await admin.rpc('finish_notification_send', {
      p_id: n.id,
      p_success: false,
      p_error: 'SMTP no configurado o desactivado',
      p_provider_id: null,
    });
    return 'failed';
  }

  const pwd = String(smtp.smtp_password ?? '').replace(/\s+/g, '');
  if (!pwd) {
    await admin.rpc('finish_notification_send', {
      p_id: n.id,
      p_success: false,
      p_error: 'Falta contraseña SMTP',
      p_provider_id: null,
    });
    return 'failed';
  }

  const customer = appt.customer as { name: string | null; email: string | null } | null;
  const pet = appt.pet as { name: string | null } | null;
  const service = appt.service as { name: string | null; price?: number | string | null } | null;
  const vet = appt.vet as { name: string | null } | null;

  const whenFormatted = new Intl.DateTimeFormat('es-CO', {
    dateStyle: 'full',
    timeStyle: 'short',
  }).format(new Date(appt.start_date_time as string));

  const payload: KindPayload = {
    kind: n.kind,
    businessName: String(biz.name),
    businessAddress: biz.address,
    businessPhone: biz.phone,
    customerName: String(customer?.name ?? 'Hola'),
    petName: String(pet?.name ?? 'tu mascota'),
    serviceName: String(service?.name ?? 'Consulta'),
    vetName: String(vet?.name ?? 'el equipo'),
    whenFormatted,
  };

  let confirmUrl: string | undefined;
  let rescheduleUrl: string | undefined;

  if (n.kind === 'CONFIRM_REMINDER') {
    const { data: tok, error: tokErr } = await admin.rpc('ensure_appointment_public_token', {
      p_appointment_id: n.appointment_id,
      p_purpose: 'confirm',
      p_ttl_hours: 72,
    });
    if (tokErr) throw tokErr;
    confirmUrl = `${appPublicUrl}/confirm?t=${encodeURIComponent(String(tok))}&b=${encodeURIComponent(n.business_id)}`;
  }

  if (n.kind === 'NOSHOW_RESCHEDULE') {
    const { data: tok, error: tokErr } = await admin.rpc('ensure_appointment_public_token', {
      p_appointment_id: n.appointment_id,
      p_purpose: 'reschedule',
      p_ttl_hours: 168,
    });
    if (tokErr) throw tokErr;
    rescheduleUrl = `${appPublicUrl}/portal/${n.business_id}/guest-book?t=${encodeURIComponent(String(tok))}`;
  }

  if (n.kind === 'COMPLETED_SUMMARY') {
    const { data: med } = await admin
      .from('medical_record')
      .select('diagnosis, treatment, observations, weight, next_visit_date, created_at')
      .eq('appointment_id', n.appointment_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: extrasRows } = await admin
      .from('appointment_extra_charge')
      .select('description, amount')
      .eq('appointment_id', n.appointment_id)
      .order('created_at', { ascending: true });

    const { data: paymentRows } = await admin
      .from('payment')
      .select('id, amount, payment_method, created_at, transfer_channel, transfer_proof_code')
      .eq('appointment_id', n.appointment_id)
      .order('created_at', { ascending: true });

    const extrasLines: InvoiceLine[] = (extrasRows ?? []).map((r) => ({
      description: String((r as { description?: string | null }).description ?? '').trim() || 'Gasto adicional',
      amount: Number((r as { amount?: unknown }).amount ?? 0),
    }));
    const extrasAmount = extrasLines.reduce((sum, l) => sum + l.amount, 0);

    const serviceAmount = Number(service?.price ?? 0);
    const payments = (paymentRows ?? []) as {
      id?: string | null;
      amount?: number | string | null;
      payment_method?: string | null;
      created_at?: string | null;
      transfer_channel?: string | null;
      transfer_proof_code?: string | null;
    }[];
    const totalPaid = payments.reduce((sum, p) => sum + Number(p.amount ?? 0), 0);
    const lastPayment = payments.at(-1) ?? null;
    const paymentMethod = paymentMethodLabel(lastPayment?.payment_method ?? null);
    const paymentLine =
      paymentMethod === 'Transferencia' && (lastPayment?.transfer_channel ?? '').trim()
        ? `${paymentMethod} (${String(lastPayment?.transfer_channel).trim()})`
        : paymentMethod;
    const paymentId = (lastPayment?.id ?? null) as string | null;
    const proofLine = (lastPayment?.transfer_proof_code ?? '').trim() || 'N/A';
    const invoiceNo = `INV-${n.appointment_id.slice(0, 8).toUpperCase()}`;
    const issuedAtIso = lastPayment?.created_at ?? (med?.created_at as string | null) ?? new Date().toISOString();
    const issueLabel = formatDateTime(issuedAtIso);

    const excerpt =
      n.payload_snapshot?.diagnosis_excerpt ||
      [med?.diagnosis, med?.treatment, med?.observations].filter(Boolean).join(' · ') ||
      null;
    payload.diagnosisExcerpt = excerpt;
    payload.diagnosis = (med?.diagnosis as string | null) ?? null;
    payload.treatment = (med?.treatment as string | null) ?? null;
    payload.observations = (med?.observations as string | null) ?? null;
    payload.weight = Number.isFinite(Number(med?.weight)) ? Number(med?.weight) : null;
    payload.nextVisitDate = (med?.next_visit_date as string | null) ?? null;
    payload.invoice = {
      invoiceNo,
      issueLabel,
      appointmentId: n.appointment_id,
      serviceLabel: String(service?.name ?? 'Servicio'),
      serviceAmount,
      extrasLines,
      extrasAmount,
      paymentLine,
      paymentId,
      proofLine,
      totalPaid,
      totalExpected: serviceAmount + extrasAmount,
      customerName: String(customer?.name ?? '—'),
      petName: String(pet?.name ?? '—'),
      vetName: String(vet?.name ?? '—'),
    };
  }

  payload.confirmUrl = confirmUrl;
  payload.rescheduleUrl = rescheduleUrl;

  const { subject, html } = buildEmailForKind(payload);

  const transporter = createSmtpTransport({
    host: String(smtp.host),
    port: smtp.port,
    username: String(smtp.username),
    smtp_password: pwd,
    use_tls: smtp.use_tls !== false,
    from_email: String(smtp.from_email),
  });

  const fromName = (smtp.from_name as string | null)?.trim() || String(biz.name);
  const to = n.recipient_email;
  if (!to?.trim()) {
    await admin.rpc('finish_notification_send', {
      p_id: n.id,
      p_success: false,
      p_error: 'Sin destinatario',
      p_provider_id: null,
    });
    return 'failed';
  }

  let info: { messageId?: string };
  try {
    info = await transporter.sendMail({
      from: `"${fromName}" <${smtp.from_email}>`,
      to: to.trim(),
      subject,
      html,
    });
  } catch (sendErr) {
    throw new Error(formatSmtpSendError(sendErr));
  }

  await admin.rpc('finish_notification_send', {
    p_id: n.id,
    p_success: true,
    p_error: null,
    p_provider_id: info.messageId ?? null,
  });
  return 'sent';
}

function json(status: number, payload: Record<string, unknown>) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

function paymentMethodLabel(v: string | null): string {
  if (v === 'Cash') return 'Efectivo';
  if (v === 'Card') return 'Tarjeta';
  if (v === 'Transfer') return 'Transferencia';
  return v || '—';
}

function formatDateTime(iso: string | null | undefined): string {
  const d = iso ? new Date(iso) : new Date();
  return new Intl.DateTimeFormat('es-CO', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(d);
}

/** Texto útil a partir de campos que a veces vienen como objeto (p. ej. `message` anidado en PostgREST). */
function coerceText(v: unknown, max = 900): string | null {
  if (v == null) return null;
  if (typeof v === 'string') {
    const t = v.trim();
    return t.length ? t.slice(0, max) : null;
  }
  if (typeof v === 'number' || typeof v === 'boolean') return String(v).slice(0, max);
  if (v instanceof Uint8Array) {
    try {
      const t = new TextDecoder('utf-8', { fatal: false }).decode(v).trim();
      return t.length ? t.slice(0, max) : null;
    } catch {
      return null;
    }
  }
  if (typeof v === 'object') {
    const s = (v as { toString?: () => string }).toString?.();
    if (typeof s === 'string' && s.trim() && s.trim() !== '[object Object]') {
      return s.trim().slice(0, max);
    }
    try {
      return Deno.inspect(v as object, { depth: 4, colors: false }).slice(0, max);
    } catch {
      return null;
    }
  }
  return null;
}

/** Fallo de `sendMail` (Nodemailer) con campos típicos + buffers en `response`. */
function formatSmtpSendError(err: unknown): string {
  const base = formatUnknownError(err);
  if (err !== null && typeof err === 'object') {
    const o = err as Record<string, unknown>;
    const extra: string[] = [];
    const r = o.response;
    if (r instanceof Uint8Array) {
      const t = coerceText(r);
      if (t) extra.push(`response: ${t}`);
    }
    if (extra.length) return `${base} · ${extra.join(' · ')}`;
  }
  return base;
}

/**
 * Mensaje legible para `finish_notification_send` y logs. Cubre:
 * - PostgREST (message/details/hint/code; `message` a veces no es string)
 * - Nodemailer/SMTP (responseCode, response Buffer, objetos sin stringify estable)
 */
function formatUnknownError(err: unknown): string {
  const max = 1900;

  const clip = (s: string) => (s.length > max ? `${s.slice(0, max)}…` : s);

  if (typeof err === 'string') {
    const t = err.trim();
    return t ? clip(t) : 'Error';
  }

  if (err instanceof Error) {
    const m = err.message?.trim() || err.name || 'Error';
    return clip(m);
  }

  if (err !== null && typeof err === 'object') {
    const o = err as Record<string, unknown>;
    const parts: string[] = [];
    const add = (label: string, v: unknown) => {
      const t = coerceText(v);
      if (t) parts.push(label ? `${label}: ${t}` : t);
    };
    add('message', o.message);
    add('details', o.details);
    add('hint', o.hint);
    if (typeof o.code === 'string' && o.code.trim()) parts.push(`code: ${o.code.trim()}`);
    if (o.responseCode != null) parts.push(`responseCode: ${String(o.responseCode)}`);
    add('response', o.response);
    if (typeof o.command === 'string' && o.command.trim()) parts.push(`command: ${o.command.trim()}`);

    if (parts.length) return clip(parts.join(' · '));

    try {
      const j = JSON.stringify(o);
      if (j !== '{}') return clip(j);
    } catch {
      /* referencias circulares u objeto no serializable */
    }

    try {
      return clip(Deno.inspect(err as object, { depth: 5, colors: false }));
    } catch {
      return 'Error no serializable (revisar logs de send-email-notifications)';
    }
  }

  const s = String(err);
  return clip(s === '[object Object]' ? 'Error desconocido (objeto sin toString útil)' : s);
}
