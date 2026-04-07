import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MIN_PASSWORD_LEN = 6;

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
    return json(500, { error: 'Función sin configuración del servidor' });
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return json(401, { error: 'No autorizado' });
  }

  const token = authHeader.slice('Bearer '.length).trim();
  const adminClient = createClient(supabaseUrl, serviceKey);

  const {
    data: { user: caller },
    error: callerErr,
  } = await adminClient.auth.getUser(token);
  if (callerErr || !caller) {
    return json(401, { error: 'Sesión inválida' });
  }

  const { data: callerStaff, error: staffReadErr } = await adminClient
    .from('staff')
    .select('id, business_id, active, role:role_id(name)')
    .eq('id', caller.id)
    .maybeSingle();

  if (staffReadErr || !callerStaff?.active) {
    return json(403, { error: 'Sin acceso' });
  }

  const roleName = (callerStaff.role as { name: string } | undefined)?.name;
  if (roleName !== 'Admin') {
    return json(403, { error: 'Solo administradores pueden crear personal' });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return json(400, { error: 'Cuerpo JSON inválido' });
  }

  const email = String(body.email ?? '')
    .trim()
    .toLowerCase();
  const name = String(body.name ?? '').trim();
  const role_id = Number(body.role_id);
  const password = String(body.password ?? '');
  const phoneRaw = body.phone;
  const phone =
    phoneRaw === null || phoneRaw === undefined
      ? null
      : String(phoneRaw).trim() || null;

  if (!email || !name || !Number.isFinite(role_id)) {
    return json(400, { error: 'Correo, nombre y rol son obligatorios' });
  }

  if (password.length < MIN_PASSWORD_LEN) {
    return json(400, {
      error: `La contraseña debe tener al menos ${MIN_PASSWORD_LEN} caracteres`,
    });
  }

  const { data: roleRow, error: roleErr } = await adminClient
    .from('role')
    .select('name')
    .eq('id', role_id)
    .maybeSingle();
  if (roleErr || !roleRow || roleRow.name === 'Admin') {
    return json(400, { error: 'Rol no permitido' });
  }

  const { data: dup } = await adminClient
    .from('staff')
    .select('id')
    .eq('business_id', callerStaff.business_id)
    .ilike('email', email)
    .maybeSingle();

  if (dup) {
    return json(409, { error: 'Ya existe un miembro con ese correo en la clínica' });
  }

  const { data: created, error: createErr } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name },
  });

  if (createErr) {
    const msg = createErr.message || 'No se pudo crear el usuario';
    if (/already been registered|already exists|duplicate/i.test(msg)) {
      return json(409, { error: 'Ese correo ya está registrado en el sistema' });
    }
    return json(400, { error: msg });
  }

  const newUserId = created.user?.id;
  if (!newUserId) {
    return json(500, { error: 'Respuesta de creación incompleta' });
  }

  // Refuerzo: en algunos entornos createUser con email_confirm no deja email_confirmed_at; forzamos confirmación.
  const { error: confirmErr } = await adminClient.auth.admin.updateUserById(newUserId, {
    email_confirm: true,
  });
  if (confirmErr) {
    await adminClient.auth.admin.deleteUser(newUserId);
    return json(500, { error: confirmErr.message || 'No se pudo confirmar el correo del usuario' });
  }

  const { error: insErr } = await adminClient.from('staff').insert({
    id: newUserId,
    business_id: callerStaff.business_id,
    role_id,
    name,
    phone,
    email,
    active: true,
  });

  if (insErr) {
    await adminClient.auth.admin.deleteUser(newUserId);
    return json(500, { error: insErr.message || 'No se pudo crear el perfil de staff' });
  }

  return json(200, { ok: true, user_id: newUserId });
});

function json(status: number, payload: Record<string, unknown>) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}
