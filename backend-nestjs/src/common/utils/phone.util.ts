/**
 * Privacidad y antifraude telefónico.
 *  - Normalización a E.164 (+51 por defecto para Perú).
 *  - Enmascaramiento para mostrar a terceros: +51 9•• ••• 222
 *  - Redacción de números/correos dentro de mensajes del chat interno, para
 *    que nadie pueda filtrar su teléfono y ser víctima de extorsión.
 */
export function normalizePhone(raw: string): string | null {
  const digits = (raw || '').replace(/[^\d+]/g, '');
  let e164: string;
  if (digits.startsWith('+')) e164 = digits;
  else if (/^9\d{8}$/.test(digits)) e164 = `+51${digits}`; // celular peruano
  else if (/^51\d{9}$/.test(digits)) e164 = `+${digits}`;
  else return null;
  return /^\+[1-9]\d{7,14}$/.test(e164) ? e164 : null;
}

export function maskPhone(e164: string): string {
  if (!e164 || e164.length < 7) return '•••';
  return `${e164.slice(0, 3)} ${e164.slice(3, 4)}•• ••• ${e164.slice(-3)}`;
}

// 9 dígitos de celular peruano con separadores opcionales, o secuencias largas de dígitos
const PHONE_IN_TEXT = /(\+?\s?51[\s.-]?)?\b9(?:[\s.-]?\d){8}\b|\b\d(?:[\s.-]?\d){8,13}\b/g;
const EMAIL_IN_TEXT = /[\w.+-]+@[\w-]+\.[\w.]+/g;

export function redactContactInfo(text: string): { body: string; redacted: boolean } {
  let redacted = false;
  const body = text
    .replace(PHONE_IN_TEXT, () => {
      redacted = true;
      return '[número oculto 🔒]';
    })
    .replace(EMAIL_IN_TEXT, () => {
      redacted = true;
      return '[correo oculto 🔒]';
    });
  return { body, redacted };
}
