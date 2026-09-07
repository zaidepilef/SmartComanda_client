import { Injectable, computed, signal } from '@angular/core';

export type ThemeChoice = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'sc-theme';
const FALLBACK: ThemeChoice = 'system';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly media = window.matchMedia('(prefers-color-scheme: dark)');

  readonly choice = signal<ThemeChoice>(this.readChoice());

  readonly resolved = computed<ResolvedTheme>(() => {
    const choice = this.choice();

    if (choice === 'system') {
      return this.media.matches ? 'dark' : 'light';
    }

    return choice;
  });

  constructor() {
    this.apply(this.resolved());

    this.media.addEventListener('change', () => this.apply(this.resolved()));
  }

  setChoice(choice: ThemeChoice): void {
    this.choice.set(choice);
    localStorage.setItem(STORAGE_KEY, choice);
    this.apply(this.resolved());
  }

  cycle(): void {
    const order: ThemeChoice[] = ['light', 'dark', 'system'];
    const next = order[(order.indexOf(this.choice()) + 1) % order.length];
    this.setChoice(next);
  }

  private readChoice(): ThemeChoice {
    const stored = localStorage.getItem(STORAGE_KEY);

    if (stored === 'light' || stored === 'dark' || stored === 'system') {
      return stored;
    }

    return FALLBACK;
  }

  private apply(theme: ResolvedTheme): void {
    document.documentElement.dataset['theme'] = theme;
  }
}