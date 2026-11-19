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

// 9 dígitos de celular peruano o fijos con código de área (p.ej. (054) 223344) con separadores opcionales
const PHONE_IN_TEXT =
  /(?:\+?\s?51[\s.-]?)?(?:\(\s*0?\d{1,3}\s*\)[\s.-]?\d(?:[\s.-]?\d){5,8}|\b9(?:[\s.-]?\d){8}\b|\b\d(?:[\s.-]?\d){8,13}\b)/g;
const EMAIL_IN_TEXT = /[\w.+-]+@[\w-]+\.[\w.]+/g;
// Enlaces externos (http/https, www, wa.me, t.me, redes sociales, acortadores y dominios comunes)
const URL_IN_TEXT =
  /(?:https?:\/\/[^\s<>"')]+|\bwww\.[^\s<>"')]+\b|\b(?:wa\.me|api\.whatsapp\.com|chat\.whatsapp\.com|t\.me|telegram\.me|bit\.ly|tinyurl\.com|instagram\.com|ig\.me|facebook\.com|fb\.com|m\.me|tiktok\.com|youtu\.be|youtube\.com|x\.com|twitter\.com|linktr\.ee)(?:\/[^\s<>"')]*)?|\b[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.(?:com|pe|net|org|io|me|ly|co|app|gg|xyz|tv)(?:\.[a-z]{2})?(?:\/[^\s<>"')]*)?)/gi;
const HANDLE_IN_TEXT = /(^|[\s(])@[a-zA-Z0-9_][a-zA-Z0-9_.-]{2,30}\b/g;

export function redactContactInfo(text: string): { body: string; redacted: boolean } {
  let redacted = false;
  const body = text
    .replace(EMAIL_IN_TEXT, () => {
      redacted = true;
      return '[correo oculto 🔒]';
    })
    .replace(URL_IN_TEXT, () => {
      redacted = true;
      return '[enlace oculto 🔒]';
    })
    .replace(PHONE_IN_TEXT, () => {
      redacted = true;
      return '[número oculto 🔒]';
    })
    .replace(HANDLE_IN_TEXT, (_match, prefix: string) => {
      redacted = true;
      return `${prefix}[usuario oculto 🔒]`;
    });
  return { body, redacted };
}
