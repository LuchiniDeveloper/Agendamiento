import { inject, Injectable } from '@angular/core';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../core/supabase';
import { TenantContextService } from '../../core/tenant-context.service';
import type { BusinessSmtpSettingsSafe } from '../../models/appointment-notifications';

export type SmtpTestResult =
  | { ok: true; to?: string | null; messageId?: string | null }
  | { ok: false; message: string };

@Injectable({ providedIn: 'root' })
export class SmtpSettingsData {
  private readonly supabase = inject(SUPABASE_CLIENT);
  private readonly tenant = inject(TenantContextService);

  getForBusiness() {
    if (!this.supabase) throw new Error('Supabase no configurado');
    return this.supabase.from('business_smtp_settings').select('*').maybeSingle();
  }

  /**
   * Si `smtp_password` viene vacío, no se envía (se mantiene la contraseña actual en servidor).
   */
  async upsert(row: {
    host: string;
    port: number;
    use_tls: boolean;
    username: string;
    smtp_password?: string;
    from_email: string;
    from_name: string | null;
    enabled: boolean;
  }) {
    if (!this.supabase) throw new Error('Supabase no configurado');
    const business_id = this.tenant.businessId();
    if (!business_id) throw new Error('Sin negocio activo');

    const payload: Record<string, unknown> = {
      business_id,
      host: row.host,
      port: row.port,
      use_tls: row.use_tls,
      username: row.username,
      from_email: row.from_email,
      from_name: row.from_name,
      enabled: row.enabled,
      updated_at: new Date().toISOString(),
    };
    if (row.smtp_password != null && row.smtp_password.trim() !== '') {
      payload['smtp_password'] = row.smtp_password.trim();
    }

    return this.supabase.from('business_smtp_settings').upsert(payload).select(`
        business_id,
        host,
        port,
        use_tls,
        username,
        from_email,
        from_name,
        enabled,
        updated_at
      `);
  }

  /** Para mostrar en formulario sin exponer contraseña. */
  mapSafe(row: Record<string, unknown> | null): BusinessSmtpSettingsSafe | null {
    if (!row) return null;
    return {
      business_id: String(row['business_id']),
      host: String(row['host'] ?? ''),
      port: Number(row['port'] ?? 587),
      use_tls: row['use_tls'] !== false,
      username: String(row['username'] ?? ''),
      from_email: String(row['from_email'] ?? ''),
      from_name: (row['from_name'] as string | null) ?? null,
      enabled: !!row['enabled'],
      updated_at: String(row['updated_at'] ?? ''),
    };
  }

  /**
   * Envía un correo de prueba usando la config **ya guardada** en BD.
   * Devuelve el mensaje de error legible del JSON de la Edge Function (no solo el texto genérico de HTTP).
   */
  async sendTestEmail(to?: string | null): Promise<SmtpTestResult> {
    if (!this.supabase) throw new Error('Supabase no configurado');
    const body: Record<string, string> = {};
    if (to?.trim()) body['to'] = to.trim();
    const { data, error, response } = await this.supabase.functions.invoke<{
      ok?: boolean;
      error?: string;
      to?: string;
      messageId?: string | null;
    }>('smtp-test', { body: Object.keys(body).length ? body : {} });

    if (error) {
      if (error instanceof FunctionsHttpError && response) {
        try {
          const ct = (response.headers.get('Content-Type') ?? '').toLowerCase();
          if (ct.includes('application/json')) {
            const j = (await response.json()) as { error?: unknown };
            if (typeof j.error === 'string' && j.error.trim()) {
              return { ok: false, message: j.error.trim() };
            }
          }
        } catch {
          /* ignore */
        }
      }
      return { ok: false, message: error.message?.trim() || 'Error al invocar la función' };
    }

    if (data?.ok) {
      return { ok: true, to: data.to, messageId: data.messageId ?? null };
    }
    if (typeof data?.error === 'string' && data.error.trim()) {
      return { ok: false, message: data.error.trim() };
    }
    return { ok: false, message: 'Respuesta inesperada del servidor de prueba.' };
  }
}
