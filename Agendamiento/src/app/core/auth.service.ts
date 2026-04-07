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
    this.supabase.auth.getSession().then(({ data }) => {
      this.sessionSignal.set(data.session ?? null);
    });
    this.supabase.auth.onAuthStateChange((_event, session) => {
      this.sessionSignal.set(session);
    });
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
