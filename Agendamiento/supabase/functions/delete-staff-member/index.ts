import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

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

  const { data: callerStaff, error: callerStaffErr } = await adminClient
    .from('staff')
    .select('id, business_id, active, role:role_id(name)')
    .eq('id', caller.id)
    .maybeSingle();
  if (callerStaffErr || !callerStaff?.active) {
    return json(403, { error: 'Sin acceso' });
  }
  const roleName = (callerStaff.role as { name: string } | undefined)?.name;
  if (roleName !== 'Admin') {
    return json(403, { error: 'Solo administradores pueden eliminar personal' });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return json(400, { error: 'Cuerpo JSON inválido' });
  }
  const staffId = String(body.staff_id ?? '').trim();
  if (!staffId) {
    return json(400, { error: 'Falta el usuario' });
  }
  if (staffId === caller.id) {
    return json(400, { error: 'No puedes eliminar tu propia cuenta' });
  }

  const { data: targetStaff, error: targetErr } = await adminClient
    .from('staff')
    .select('id, business_id, role:role_id(name)')
    .eq('id', staffId)
    .maybeSingle();
  if (targetErr || !targetStaff) {
    return json(404, { error: 'Usuario no encontrado' });
  }
  if (targetStaff.business_id !== callerStaff.business_id) {
    return json(403, { error: 'No autorizado' });
  }

  const targetRole = (targetStaff.role as { name: string } | undefined)?.name;
  if (targetRole === 'Admin') {
    const { data: activeRows, error: cntErr } = await adminClient
      .from('staff')
      .select('id, role:role_id(name)')
      .eq('business_id', callerStaff.business_id)
      .eq('active', true);
    if (cntErr) {
      return json(500, { error: cntErr.message || 'No se pudo validar administradores activos' });
    }
    const activeAdminCount = (activeRows ?? []).filter(
      (r) => (r.role as { name: string } | undefined)?.name === 'Admin',
    ).length;
    if (activeAdminCount <= 1) {
      return json(400, { error: 'No puedes eliminar al único administrador activo' });
    }
  }

  const { error: delStaffErr } = await adminClient.from('staff').delete().eq('id', staffId);
  if (delStaffErr) {
    if (delStaffErr.code === '23503') {
      return json(409, {
        error:
          'No se puede eliminar este usuario porque tiene registros asociados (por ejemplo, citas).',
      });
    }
    return json(500, { error: delStaffErr.message || 'No se pudo eliminar el perfil de staff' });
  }

  const { error: delUserErr } = await adminClient.auth.admin.deleteUser(staffId);
  if (delUserErr) {
    return json(500, {
      error:
        delUserErr.message ||
        'Se eliminó de staff pero falló la eliminación en Auth. Revisa usuarios en Supabase.',
    });
  }

  return json(200, { ok: true });
});

function json(status: number, payload: Record<string, unknown>) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}
