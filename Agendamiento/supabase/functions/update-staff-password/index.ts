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
    return json(403, { error: 'Solo administradores pueden cambiar contraseñas' });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return json(400, { error: 'Cuerpo JSON inválido' });
  }

  const staffUserId = String(body.staff_id ?? '').trim();
  const password = String(body.password ?? '');

  if (!staffUserId) {
    return json(400, { error: 'Falta el usuario' });
  }

  if (password.length < MIN_PASSWORD_LEN) {
    return json(400, {
      error: `La contraseña debe tener al menos ${MIN_PASSWORD_LEN} caracteres`,
    });
  }

  const { data: targetStaff, error: targetErr } = await adminClient
    .from('staff')
    .select('id, business_id')
    .eq('id', staffUserId)
    .maybeSingle();

  if (targetErr || !targetStaff) {
    return json(404, { error: 'Usuario no encontrado' });
  }

  if (targetStaff.business_id !== callerStaff.business_id) {
    return json(403, { error: 'No autorizado' });
  }

  const { error: updErr } = await adminClient.auth.admin.updateUserById(staffUserId, {
    password,
  });

  if (updErr) {
    return json(400, { error: updErr.message || 'No se pudo actualizar la contraseña' });
  }

  return json(200, { ok: true });
});

function json(status: number, payload: Record<string, unknown>) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}
