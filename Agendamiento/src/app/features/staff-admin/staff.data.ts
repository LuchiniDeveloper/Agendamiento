import { inject, Injectable } from '@angular/core';
import {
  FunctionsFetchError,
  FunctionsHttpError,
  FunctionsRelayError,
  type SupabaseClient,
} from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../core/supabase';

/** Evita spinner infinito si la Edge Function no responde (red, no desplegada, etc.). */
const EDGE_INVOKE_TIMEOUT_MS = 60_000;

async function invokeWithTimeout(
  client: SupabaseClient,
  functionName: string,
  options: { body: object; headers: Record<string, string> },
) {
  const ac = new AbortController();
  const tid = setTimeout(() => ac.abort(), EDGE_INVOKE_TIMEOUT_MS);
  try {
    return await client.functions.invoke(functionName, { ...options, signal: ac.signal });
  } finally {
    clearTimeout(tid);
  }
}

function bodyMsg(v: unknown): string | null {
  if (v && typeof v === 'object' && 'error' in v && typeof (v as { error: unknown }).error === 'string') {
    return (v as { error: string }).error;
  }
  return null;
}

/** Mensaje legible para fallos de `functions.invoke` (red, 404, cuerpo JSON, etc.). */
async function edgeInvokeErrorMessage(
  functionName: string,
  data: unknown,
  error: unknown,
  response: Response | undefined,
): Promise<string> {

  const deployHint =
    'Para desplegarla: en la carpeta del proyecto ejecuta `npx supabase login` (una vez) y luego `npx supabase functions deploy ' +
    functionName +
    '` (el project ref sale en Supabase → Project Settings → General → Reference ID). También puedes desplegar desde el panel: Edge Functions → tu función → Deploy.';

  if (error instanceof FunctionsFetchError) {
    const ctx = error.context;
    if (ctx instanceof DOMException && ctx.name === 'AbortError') {
      return `Tiempo de espera agotado (${EDGE_INVOKE_TIMEOUT_MS / 1000}s) al llamar a «${functionName}». Comprueba red, VPN, bloqueadores y que la función esté desplegada. ${deployHint}`;
    }
    const inner = ctx instanceof Error ? ctx.message : String(ctx ?? '');
    return `No se pudo conectar con el servidor (${inner || 'fallo de red'}). Comprueba la conexión y extensiones que bloqueen peticiones. ${deployHint}`;
  }

  if (error instanceof FunctionsRelayError) {
    return `El servicio no pudo ejecutar la función «${functionName}». ${deployHint}`;
  }

  if (error instanceof FunctionsHttpError && response) {
    const st = response.status;
    try {
      const ct = (response.headers.get('Content-Type') ?? '').toLowerCase();
      if (ct.includes('application/json')) {
        const j = (await response.json()) as { error?: unknown; message?: unknown };
        if (typeof j.error === 'string') return j.error;
        if (typeof j.message === 'string') return j.message;
      }
    } catch {
      /* ignore */
    }
    if (st === 404) {
      return `La función «${functionName}» no está desplegada en este proyecto (HTTP 404). ${deployHint}`;
    }
    const fallback = bodyMsg(data);
    if (fallback) return fallback;
    return `Error al llamar a «${functionName}» (HTTP ${st}). ${deployHint}`;
  }

  let msg = bodyMsg(data) || (error instanceof Error ? error.message.trim() : '');
  if (/failed to send|fetch failed|networkerror/i.test(msg)) {
    return `Fallo de red al invocar «${functionName}». ${deployHint}`;
  }
  if (!msg) {
    return `No se pudo completar la operación. ${deployHint}`;
  }
  return msg;
}

export interface RoleRow {
  id: number;
  name: string;
}

export interface StaffDirectoryRow {
  id: string;
  business_id: string;
  role_id: number;
  name: string;
  phone: string | null;
  email?: string | null;
  active: boolean;
  role?: { name: string };
}

@Injectable({ providedIn: 'root' })
export class StaffData {
  private readonly supabase = inject(SUPABASE_CLIENT);

  listRoles() {
    if (!this.supabase) throw new Error('Supabase no configurado');
    return this.supabase.from('role').select('id, name').order('id');
  }

  /** Roles que se pueden asignar en UI (sin Admin). */
  listAssignableRoles() {
    if (!this.supabase) throw new Error('Supabase no configurado');
    return this.supabase.from('role').select('id, name').neq('name', 'Admin').order('id');
  }

  listStaffDirectory() {
    if (!this.supabase) throw new Error('Supabase no configurado');
    return this.supabase
      .from('staff')
      .select('id, business_id, role_id, name, phone, email, active, role:role_id(name)')
      .order('name');
  }

  updateStaff(id: string, row: Partial<Pick<StaffDirectoryRow, 'name' | 'phone' | 'role_id' | 'active'>>) {
    if (!this.supabase) throw new Error('Supabase no configurado');
    return this.supabase.from('staff').update(row).eq('id', id).select('id, active, role_id').single();
  }

  async createStaffMember(payload: {
    email: string;
    password: string;
    name: string;
    role_id: number;
    phone?: string | null;
  }): Promise<{ ok: true } | { ok: false; message: string }> {
    if (!this.supabase) throw new Error('Supabase no configurado');
    const {
      data: { session },
    } = await this.supabase.auth.getSession();
    if (!session?.access_token) {
      return { ok: false, message: 'Sesión expirada. Vuelve a iniciar sesión.' };
    }
    const { data, error, response } = await invokeWithTimeout(this.supabase, 'invite-staff', {
      body: payload,
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    if (error) {
      return { ok: false, message: await edgeInvokeErrorMessage('invite-staff', data, error, response) };
    }
    const d = data as { ok?: boolean; error?: string } | null;
    if (d?.ok === true) {
      return { ok: true };
    }
    return { ok: false, message: bodyMsg(d) || d?.error || 'Respuesta inesperada del servidor' };
  }

  async updateStaffPassword(
    staffId: string,
    password: string,
  ): Promise<{ ok: true } | { ok: false; message: string }> {
    if (!this.supabase) throw new Error('Supabase no configurado');
    const {
      data: { session },
    } = await this.supabase.auth.getSession();
    if (!session?.access_token) {
      return { ok: false, message: 'Sesión expirada. Vuelve a iniciar sesión.' };
    }
    const { data, error, response } = await invokeWithTimeout(this.supabase, 'update-staff-password', {
      body: { staff_id: staffId, password },
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    if (error) {
      return { ok: false, message: await edgeInvokeErrorMessage('update-staff-password', data, error, response) };
    }
    const d = data as { ok?: boolean; error?: string } | null;
    if (d?.ok === true) {
      return { ok: true };
    }
    return { ok: false, message: bodyMsg(d) || d?.error || 'Respuesta inesperada del servidor' };
  }

  async deleteStaffMember(staffId: string): Promise<{ ok: true } | { ok: false; message: string }> {
    if (!this.supabase) throw new Error('Supabase no configurado');
    const {
      data: { session },
    } = await this.supabase.auth.getSession();
    if (!session?.access_token) {
      return { ok: false, message: 'Sesión expirada. Vuelve a iniciar sesión.' };
    }
    const { data, error, response } = await invokeWithTimeout(this.supabase, 'delete-staff-member', {
      body: { staff_id: staffId },
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    if (error) {
      return { ok: false, message: await edgeInvokeErrorMessage('delete-staff-member', data, error, response) };
    }
    const d = data as { ok?: boolean; error?: string } | null;
    if (d?.ok === true) {
      return { ok: true };
    }
    return { ok: false, message: bodyMsg(d) || d?.error || 'Respuesta inesperada del servidor' };
  }
}
