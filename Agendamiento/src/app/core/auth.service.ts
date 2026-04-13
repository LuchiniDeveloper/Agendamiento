import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import type { Session, User } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from './supabase';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly supabase = inject(SUPABASE_CLIENT);
  private readonly router = inject(Router);

  private readonly sessionSignal = signal<Session | null>(null);
  readonly session = this.sessionSignal.asReadonly();
  readonly user = computed(() => this.sessionSignal()?.user ?? null);

  constructor() {
    if (!this.supabase) {
      return;
    }
    void this.hydrateSessionFromServer();
    this.supabase.auth.onAuthStateChange((_event, session) => {
      this.sessionSignal.set(session);
    });
  }

  /**
   * `getSession()` solo lee storage; tras borrar usuarios en el panel puede quedar un JWT
   * cuyo `sub` ya no existe en `auth.users` → falla `bootstrap_clinic`. `getUser()` valida con Auth.
   */
  private async hydrateSessionFromServer() {
    const client = this.supabase;
    if (!client) return;
    const {
      data: { session },
    } = await client.auth.getSession();
    if (!session) {
      this.sessionSignal.set(null);
      return;
    }
    const { data: userData, error } = await client.auth.getUser();
    if (error) {
      const transient =
        typeof error.message === 'string' &&
        /fetch|network|timeout|load failed|failed to fetch/i.test(error.message);
      if (transient) {
        this.sessionSignal.set(session);
        return;
      }
      await client.auth.signOut();
      this.sessionSignal.set(null);
      return;
    }
    if (!userData.user) {
      await client.auth.signOut();
      this.sessionSignal.set(null);
      return;
    }
    this.sessionSignal.set(session);
  }

  get client() {
    return this.supabase;
  }

  async signIn(email: string, password: string) {
    if (!this.supabase) throw new Error('Supabase no configurado');
    const { data, error } = await this.supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  }

  /** Devuelve `session` null si el proyecto exige confirmar el correo antes de poder iniciar sesión. */
  async signUp(email: string, password: string) {
    if (!this.supabase) throw new Error('Supabase no configurado');
    const { data, error } = await this.supabase.auth.signUp({ email, password });
    if (error) throw error;
    return { session: data.session ?? null, user: data.user };
  }

  async signOut() {
    if (this.supabase) {
      await this.supabase.auth.signOut();
    }
    this.router.navigate(['/auth/login']);
  }
}
