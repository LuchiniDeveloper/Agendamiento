import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const cors: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-requested-with, accept, origin',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

const MIN_PASSWORD_LEN = 6;
const RATE_WINDOW_MS = 60 * 60 * 1000;
const RATE_MAX = 40;
const rateMap = new Map<string, { n: number; t: number }>();

function clientIp(req: Request): string {
  const xf = req.headers.get('x-forwarded-for');
  if (xf) return xf.split(',')[0]!.trim() || 'unknown';
  return 'unknown';
}

function rateOk(ip: string): boolean {
  const now = Date.now();
  const e = rateMap.get(ip);
  if (!e || now - e.t > RATE_WINDOW_MS) {
    rateMap.set(ip, { n: 1, t: now });
    return true;
  }
  if (e.n >= RATE_MAX) return false;
  e.n += 1;
  return true;
}

function normalizeDoc(p: string): string {
  return (p || '').replace(/\D/g, '') || '';
}

/** PostgREST puede devolver una fila como objeto o como array de filas. */
function rpcRows<T extends Record<string, unknown>>(data: unknown): T[] {
  if (data == null) return [];
  if (Array.isArray(data)) return data as T[];
  if (typeof data === 'object') return [data as T];
  return [];
}

async function passwordToken(
  supabaseUrl: string,
  anonKey: string,
  email: string,
  password: string,
): Promise<{ session: Record<string, unknown> } | { error: string }> {
  const res = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
    },
    body: JSON.stringify({ email, password }),
  });
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    const msg =
      typeof json.error_description === 'string'
        ? json.error_description
        : typeof json.msg === 'string'
          ? json.msg
          : 'Credenciales inválidas';
    return { error: msg };
  }
  return { session: json as Record<string, unknown> };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }

  if (req.method !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  const ip = clientIp(req);
  if (!rateOk(ip)) {
    return json(429, { error: 'Demasiados intentos. Probá más tarde.' });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!supabaseUrl || !serviceKey || !anonKey) {
    return json(500, { error: 'Función sin configuración del servidor' });
  }

  const admin = createClient(supabaseUrl, serviceKey);

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return json(400, { error: 'Cuerpo JSON inválido' });
  }

  const action = String(body.action ?? '').trim();

  if (action === 'sign_in') {
    return handleSignIn(admin, supabaseUrl, anonKey, body);
  }
  if (action === 'register') {
    return handleRegister(admin, supabaseUrl, anonKey, body);
  }
  if (action === 'activate') {
    return handleActivate(admin, supabaseUrl, anonKey, body);
  }

  return json(400, { error: 'Acción no válida' });
});

async function handleSignIn(
  admin: ReturnType<typeof createClient>,
  supabaseUrl: string,
  anonKey: string,
  body: Record<string, unknown>,
) {
  const businessId = String(body.business_id ?? '').trim();
  const idDocument = normalizeDoc(String(body.id_document ?? ''));
  const password = String(body.password ?? '');
  if (!businessId || idDocument.length < 5 || password.length < MIN_PASSWORD_LEN) {
    return json(400, { error: 'Datos incompletos' });
  }

  const { data: rawLookup, error: qe } = await admin.rpc('portal_lookup_customer', {
    p_business_id: businessId,
    p_id_document: idDocument,
  });
  if (qe) {
    console.error('portal_lookup_customer', qe);
    return json(500, { error: 'Error al buscar la cédula. Probá más tarde.', error_code: 'LOOKUP_ERROR' });
  }
  const rows = rpcRows<{ customer_id: string; has_portal: boolean }>(rawLookup);
  if (rows.length === 0) {
    return json(401, {
      error:
        'No encontramos esa cédula en esta clínica. Revisá el número, que sea la misma ficha de la clínica y que estés en el enlace correcto del portal.',
      error_code: 'CEDULA_NOT_FOUND',
    });
  }
  const row = rows[0]!;
  if (!row.has_portal) {
    return json(401, {
      error:
        'Tu ficha existe en esta clínica pero el portal no está activado. Usá «Activar cuenta» con el correo que tiene la clínica, o pedí que te habiliten el acceso.',
      error_code: 'PORTAL_NOT_ACTIVATED',
      need_activate: true,
    });
  }

  const { data: acc, error: ae } = await admin
    .from('customer_portal_account')
    .select('login_email_internal')
    .eq('customer_id', row.customer_id)
    .maybeSingle();
  if (ae || !acc?.login_email_internal) {
    console.error('customer_portal_account', ae);
    return json(401, {
      error: 'Tu cuenta del portal está incompleta. Contactá a la clínica.',
      error_code: 'PORTAL_ACCOUNT_INCOMPLETE',
    });
  }

  const tok = await passwordToken(supabaseUrl, anonKey, acc.login_email_internal as string, password);
  if ('error' in tok) {
    return json(401, {
      error: 'La contraseña no coincide con la de tu cuenta del portal.',
      error_code: 'BAD_PASSWORD',
    });
  }

  await admin
    .from('customer_portal_account')
    .update({ last_login_at: new Date().toISOString() })
    .eq('customer_id', row.customer_id);

  return json(200, { ok: true, session: tok.session });
}

async function handleRegister(
  admin: ReturnType<typeof createClient>,
  supabaseUrl: string,
  anonKey: string,
  body: Record<string, unknown>,
) {
  const businessId = String(body.business_id ?? '').trim();
  const idDocument = normalizeDoc(String(body.id_document ?? ''));
  const name = String(body.name ?? '').trim();
  const password = String(body.password ?? '');
  const phone = String(body.phone ?? '').trim() || null;
  const email = String(body.email ?? '').trim().toLowerCase() || null;
  const petName = String(body.pet_name ?? '').trim() || null;
  const petSpecies = String(body.pet_species ?? '').trim() || null;

  if (!businessId || idDocument.length < 5 || name.length < 2 || password.length < MIN_PASSWORD_LEN) {
    return json(400, { error: 'Nombre, cédula y contraseña son obligatorios' });
  }
  if (!phone && !email) {
    return json(400, { error: 'Indicá teléfono o correo' });
  }

  const { data: biz, error: be } = await admin
    .from('business')
    .select('id')
    .eq('id', businessId)
    .eq('active', true)
    .maybeSingle();
  if (be || !biz) {
    return json(400, { error: 'Clínica no disponible' });
  }

  const { data: rawExisting } = await admin.rpc('portal_lookup_customer', {
    p_business_id: businessId,
    p_id_document: idDocument,
  });
  const existing = rpcRows<{ has_portal: boolean }>(rawExisting);
  if (existing.length) {
    const ex = existing[0]!;
    if (ex.has_portal) {
      return json(409, { error: 'Ya existe una cuenta con esta cédula' });
    }
    return json(409, {
      error: 'Esta cédula ya está registrada en la clínica. Usá “Activar cuenta”.',
      need_activate: true,
    });
  }

  const { data: loginEmail, error: le } = await admin.rpc('portal_internal_login_email', {
    p_business_id: businessId,
    p_id_document: idDocument,
  });
  if (le || !loginEmail) {
    return json(500, { error: 'No se pudo preparar el acceso' });
  }
  const internalEmail = loginEmail as string;

  const { data: created, error: ce } = await admin.auth.admin.createUser({
    email: internalEmail,
    password,
    email_confirm: true,
    app_metadata: {
      portal_customer: true,
      business_id: businessId,
    },
  });
  if (ce || !created.user?.id) {
    const msg = ce?.message ?? 'No se pudo crear el usuario';
    if (/already|duplicate|registered/i.test(msg)) {
      return json(409, { error: 'No se pudo completar el registro' });
    }
    return json(400, { error: msg });
  }
  const userId = created.user.id;

  const { data: custRow, error: insCust } = await admin
    .from('customer')
    .insert({
      business_id: businessId,
      name,
      phone,
      email,
      id_document: idDocument,
    })
    .select('id')
    .single();
  if (insCust || !custRow?.id) {
    await admin.auth.admin.deleteUser(userId);
    return json(500, { error: insCust?.message ?? 'No se pudo crear el cliente' });
  }
  const customerId = custRow.id as string;

  if (petName) {
    const { error: petErr } = await admin.from('pet').insert({
      customer_id: customerId,
      name: petName,
      species: petSpecies,
    });
    if (petErr) {
      await admin.from('customer').delete().eq('id', customerId);
      await admin.auth.admin.deleteUser(userId);
      return json(500, { error: petErr.message });
    }
  }

  const { error: linkErr } = await admin.from('customer_portal_account').insert({
    customer_id: customerId,
    auth_user_id: userId,
    login_email_internal: internalEmail,
  });
  if (linkErr) {
    await admin.from('customer').delete().eq('id', customerId);
    await admin.auth.admin.deleteUser(userId);
    return json(500, { error: linkErr.message });
  }

  const { error: metaErr } = await admin.auth.admin.updateUserById(userId, {
    app_metadata: {
      portal_customer: true,
      business_id: businessId,
      customer_id: customerId,
    },
  });
  if (metaErr) {
    console.error(metaErr);
  }

  const tok = await passwordToken(supabaseUrl, anonKey, internalEmail, password);
  if ('error' in tok) {
    return json(200, { ok: true, need_manual_login: true });
  }
  return json(200, { ok: true, session: tok.session });
}

async function handleActivate(
  admin: ReturnType<typeof createClient>,
  supabaseUrl: string,
  anonKey: string,
  body: Record<string, unknown>,
) {
  const businessId = String(body.business_id ?? '').trim();
  const idDocument = normalizeDoc(String(body.id_document ?? ''));
  const password = String(body.password ?? '');
  const verifyEmail = String(body.verify_email ?? '').trim().toLowerCase() || null;

  if (!businessId || idDocument.length < 5 || password.length < MIN_PASSWORD_LEN) {
    return json(400, { error: 'Datos incompletos' });
  }
  if (!verifyEmail) {
    return json(400, { error: 'Indicá el correo tal cual figura en la clínica.' });
  }

  const { data: rawRows, error: qe } = await admin.rpc('portal_lookup_customer', {
    p_business_id: businessId,
    p_id_document: idDocument,
  });
  if (qe) {
    console.error('portal_lookup_customer activate', qe);
    return json(500, { error: 'Error al buscar la cédula.' });
  }
  const actRows = rpcRows<{ customer_id: string; has_portal: boolean; email: string | null }>(rawRows);
  if (actRows.length === 0) {
    return json(400, { error: 'No encontramos esa cédula en esta clínica' });
  }
  const row = actRows[0]!;
  if (row.has_portal) {
    return json(409, { error: 'Esta cuenta ya está activada. Iniciá sesión.' });
  }

  const emClinic = row.email?.trim().toLowerCase() ?? '';
  if (!emClinic) {
    return json(400, { error: 'La clínica debe tener tu correo cargado en tu ficha para activar el portal.' });
  }
  if (emClinic !== verifyEmail) {
    return json(400, { error: 'El correo no coincide con el registrado en la clínica.' });
  }

  const { data: loginEmail, error: le } = await admin.rpc('portal_internal_login_email', {
    p_business_id: businessId,
    p_id_document: idDocument,
  });
  if (le || !loginEmail) {
    return json(500, { error: 'No se pudo preparar el acceso' });
  }
  const internalEmail = loginEmail as string;

  const { data: created, error: ce } = await admin.auth.admin.createUser({
    email: internalEmail,
    password,
    email_confirm: true,
    app_metadata: {
      portal_customer: true,
      business_id: businessId,
      customer_id: row.customer_id,
    },
  });
  if (ce || !created.user?.id) {
    return json(400, { error: ce?.message ?? 'No se pudo crear el usuario' });
  }
  const userId = created.user.id;

  const { error: linkErr } = await admin.from('customer_portal_account').insert({
    customer_id: row.customer_id,
    auth_user_id: userId,
    login_email_internal: internalEmail,
  });
  if (linkErr) {
    await admin.auth.admin.deleteUser(userId);
    return json(500, { error: linkErr.message });
  }

  const tok = await passwordToken(supabaseUrl, anonKey, internalEmail, password);
  if ('error' in tok) {
    return json(200, { ok: true, need_manual_login: true });
  }
  return json(200, { ok: true, session: tok.session });
}

function json(status: number, payload: Record<string, unknown>) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}
