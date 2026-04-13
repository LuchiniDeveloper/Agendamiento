import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { buildSmtpTestEmail } from '../_shared/email-templates.ts';
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
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!supabaseUrl || !anonKey) {
    return json(500, { error: 'Missing Supabase env' });
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return json(401, { error: 'No autorizado' });
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const {
    data: { user },
    error: userErr,
  } = await userClient.auth.getUser();
  if (userErr || !user) {
    return json(401, { error: 'Sesión inválida' });
  }

  const { data: staff, error: staffErr } = await userClient
    .from('staff')
    .select('business_id, email, role:role_id(name)')
    .eq('id', user.id)
    .eq('active', true)
    .maybeSingle();

  if (staffErr || !staff) {
    return json(403, { error: 'Sin perfil de staff' });
  }

  const roleName = (staff.role as { name?: string } | null)?.name;
  if (roleName !== 'Admin') {
    return json(403, { error: 'Solo administradores pueden probar SMTP' });
  }

  const bid = staff.business_id as string;

  const { data: smtp, error: smtpErr } = await userClient
    .from('business_smtp_settings')
    .select('*')
    .eq('business_id', bid)
    .maybeSingle();

  if (smtpErr) {
    return json(500, { error: smtpErr.message });
  }
  if (!smtp?.host || !smtp.from_email) {
    return json(400, { error: 'Guardá primero la configuración SMTP (servidor y remitente).' });
  }

  const pwd = String(smtp.smtp_password ?? '').replace(/\s+/g, '');
  if (!pwd) {
    return json(400, { error: 'Falta la contraseña SMTP. Guardala en el formulario y volvé a intentar.' });
  }

  let body: { to?: string };
  try {
    body = (await req.json()) as { to?: string };
  } catch {
    body = {};
  }

  const { data: biz } = await userClient.from('business').select('name').eq('id', bid).maybeSingle();
  const businessName = String(biz?.name ?? 'Clínica');

  const rawTo = typeof body.to === 'string' ? body.to.trim().toLowerCase() : '';
  const staffEmail = typeof staff.email === 'string' ? staff.email.trim().toLowerCase() : '';
  const fromEmail = String(smtp.from_email).trim().toLowerCase();

  const to =
    rawTo ||
    (staffEmail || null) ||
    fromEmail ||
    (typeof user.email === 'string' ? user.email.trim().toLowerCase() : '');

  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    return json(400, {
      error:
        'Indicá un correo de destino en el formulario de prueba o cargá tu correo en el perfil de staff / remitente.',
    });
  }

  const { subject, html } = buildSmtpTestEmail(businessName);

  let messageId: string | undefined;
  try {
    const transporter = createSmtpTransport({
      host: String(smtp.host),
      port: smtp.port,
      username: String(smtp.username),
      smtp_password: pwd,
      use_tls: smtp.use_tls !== false,
      from_email: String(smtp.from_email),
    });

    const fromName = (smtp.from_name as string | null)?.trim() || businessName;
    const info = await transporter.sendMail({
      from: `"${fromName}" <${smtp.from_email}>`,
      to,
      subject,
      html,
    });
    messageId = info.messageId;
    console.log('smtp-test sent', { to, messageId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return json(400, { error: `SMTP: ${msg}` });
  }

  return json(200, {
    ok: true,
    to,
    messageId: messageId ?? null,
    message: 'Revisá bandeja de entrada y spam del destinatario indicado.',
  });
});

function json(status: number, payload: Record<string, unknown>) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}
