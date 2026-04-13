import nodemailer from 'https://esm.sh/nodemailer@6.9.16';

export type SmtpRow = {
  host: string;
  port: number | string;
  username: string;
  smtp_password: string;
  use_tls?: boolean;
  from_email: string;
};

/**
 * Gmail: 465 = SSL implícito (no mezclar con requireTLS).
 * 587 = STARTTLS (secure false + requireTLS según use_tls).
 */
export function createSmtpTransport(smtp: SmtpRow) {
  const port = Number(smtp.port) || 587;
  const pass = String(smtp.smtp_password ?? '').replace(/\s+/g, '');
  const useTls = smtp.use_tls !== false;
  const is465 = port === 465;

  return nodemailer.createTransport({
    host: smtp.host,
    port,
    secure: is465,
    requireTLS: !is465 && useTls,
    auth: {
      user: String(smtp.username ?? '').trim(),
      pass,
    },
    tls: {
      minVersion: 'TLSv1.2' as const,
    },
  });
}
