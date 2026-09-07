import { Component, computed, inject } from '@angular/core';

import { ThemeService } from '../../services/theme.service';

@Component({
  selector: 'app-theme-toggle',
  imports: [],
  templateUrl: './theme-toggle.html',
  styleUrl: './theme-toggle.scss',
})
export class ThemeToggle {
  private readonly themeService = inject(ThemeService);

  readonly resolved = this.themeService.resolved;

  readonly icon = computed(() => (this.resolved() === 'dark' ? '☀️' : '🌙'));
  readonly label = computed(() =>
    this.resolved() === 'dark' ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'
  );

  toggle(): void {
    this.themeService.cycle();
  }
}