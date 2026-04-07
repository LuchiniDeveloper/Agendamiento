import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { Injectable, PLATFORM_ID, inject, signal } from '@angular/core';

const STORAGE_KEY = 'agendamiento-theme';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly doc = inject(DOCUMENT);
  private readonly platformId = inject(PLATFORM_ID);

  /** true = tema oscuro activo */
  readonly isDark = signal(false);

  constructor() {
    if (isPlatformBrowser(this.platformId)) {
      this.syncFromStorage();
    }
  }

  private syncFromStorage(): void {
    let dark = false;
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === 'dark') dark = true;
      else if (stored === 'light') dark = false;
      else dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    } catch {
      dark = false;
    }
    this.applyDark(dark, false);
  }

  setLight(): void {
    this.applyDark(false, true);
  }

  setDark(): void {
    this.applyDark(true, true);
  }

  private applyDark(dark: boolean, persist: boolean): void {
    this.isDark.set(dark);
    this.doc.documentElement.classList.toggle('app-dark', dark);
    if (persist) {
      try {
        localStorage.setItem(STORAGE_KEY, dark ? 'dark' : 'light');
      } catch {
        /* ignore */
      }
    }
  }
}
