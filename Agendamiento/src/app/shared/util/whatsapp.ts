/** Normaliza a dígitos y arma enlace wa.me (Colombia +57 por defecto). */
export function buildWhatsAppLink(phoneRaw: string | null | undefined, message: string): string {
  const digits = (phoneRaw ?? '').replace(/\D/g, '');
  let n = digits;
  if (n.length === 10 && !n.startsWith('57')) {
    n = '57' + n;
  }
  if (!n) return '#';
  const text = encodeURIComponent(message);
  return `https://wa.me/${n}?text=${text}`;
}
