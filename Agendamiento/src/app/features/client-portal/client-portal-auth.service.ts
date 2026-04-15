import { Injectable, inject } from '@angular/core';
import { environment } from '../../../environments/environment';
import { SUPABASE_CLIENT } from '../../core/supabase';

type PortalAuthOk = {
  ok: true;
  session?: Record<string, unknown>;
  need_manual_login?: boolean;
  can_register?: boolean;
};
type PortalAuthErr = { error: string; need_activate?: boolean; error_code?: string };
export type PortalAuthResult = PortalAuthOk | PortalAuthErr;

@Injectable({ providedIn: 'root' })
export class ClientPortalAuthService {
  private readonly supabase = inject(SUPABASE_CLIENT);

  private portalAuthUrl(): string {
    const path = '/functions/v1/portal-auth';
    if (environment.functionsViaDevProxy && typeof window !== 'undefined') {
      return `${window.location.origin}${path}`;
    }
    const base = environment.supabaseUrl?.replace(/\/$/, '') ?? '';
    return `${base}${path}`;
  }

  private async post(body: Record<string, unknown>): Promise<PortalAuthResult> {
    const key = environment.supabaseAnonKey;
    const res = await fetch(this.portalAuthUrl(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
      return {
        error: typeof json['error'] === 'string' ? (json['error'] as string) : `Error ${res.status}`,
        need_activate: json['need_activate'] === true,
        error_code: typeof json['error_code'] === 'string' ? (json['error_code'] as string) : undefined,
      };
    }
    return json as PortalAuthOk;
  }

  /** Establece sesión Supabase si la respuesta incluye tokens. */
  async applySessionIfPresent(data: PortalAuthResult): Promise<boolean> {
    if (!this.supabase || !('ok' in data) || !data.ok || !data.session) return false;
    const s = data.session as {
      access_token?: string;
      refresh_token?: string;
    };
    if (!s.access_token || !s.refresh_token) return false;
    const { error } = await this.supabase.auth.setSession({
      access_token: s.access_token,
      refresh_token: s.refresh_token,
    });
    return !error;
  }

  async signIn(businessId: string, idDocument: string, password: string): Promise<PortalAuthResult> {
    return this.post({ action: 'sign_in', business_id: businessId, id_document: idDocument, password });
  }

  async register(payload: {
    business_id: string;
    id_document: string;
    name: string;
    password: string;
    phone?: string;
    email?: string;
    pet_name?: string;
    pet_species?: string;
  }): Promise<PortalAuthResult> {
    return this.post({ action: 'register', ...payload });
  }

  async registerPrecheck(payload: { business_id: string; id_document: string }): Promise<PortalAuthResult> {
    return this.post({ action: 'register_precheck', ...payload });
  }

  async activate(payload: {
    business_id: string;
    id_document: string;
    password: string;
    verify_email: string;
  }): Promise<PortalAuthResult> {
    return this.post({ action: 'activate', ...payload });
  }
}
