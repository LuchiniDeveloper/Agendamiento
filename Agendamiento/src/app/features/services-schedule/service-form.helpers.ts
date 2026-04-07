import { AbstractControl, ValidationErrors } from '@angular/forms';

export const DESC_MAX = 250;

export function digitsOnly(s: string): string {
  return String(s ?? '').replace(/\D/g, '');
}

/** Miles con punto (es-CO), solo parte entera; envío a BD sin separadores. */
export function formatThousandsFromDigits(digits: string): string {
  const d = digitsOnly(digits);
  if (!d) return '';
  return d.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

export function parsePriceToNumber(value: unknown): number {
  const d = digitsOnly(String(value ?? ''));
  if (!d) return NaN;
  return parseInt(d, 10);
}

export function copPriceValidator(control: AbstractControl): ValidationErrors | null {
  const n = parsePriceToNumber(control.value);
  if (digitsOnly(String(control.value ?? '')) === '') return { required: true };
  if (Number.isNaN(n) || n < 0) return { min: true };
  return null;
}

export function descCounterTone(len: number): string {
  if (len >= DESC_MAX) return 'full';
  if (len >= 235) return 'near';
  if (len >= 200) return 'mid';
  return 'ok';
}

export function priceToFormattedInput(price: number): string {
  const n = Math.round(Number(price));
  if (Number.isNaN(n) || n < 0) return '0';
  return formatThousandsFromDigits(String(n));
}

/** Formato con miles mientras el usuario escribe (solo dígitos → puntos). */
export function formatPriceInputLive(value: unknown): string {
  return formatThousandsFromDigits(digitsOnly(String(value ?? '')));
}
