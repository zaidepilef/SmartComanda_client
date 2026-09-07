import { Component } from '@angular/core';

import { ThemeToggle } from '../../components/theme-toggle/theme-toggle';

@Component({
  selector: 'app-qr-landing',
  imports: [ThemeToggle],
  templateUrl: './qr-landing.html',
  styleUrl: './qr-landing.scss',
})
export class QrLandingView {}