/**
 * Validación del RUC peruano (SUNAT) con dígito verificador módulo 11.
 * Prefijos válidos: 10 (persona natural), 15/17 (otros), 20 (persona jurídica).
 */
const WEIGHTS = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];

export function isValidRuc(ruc: string): boolean {
  if (!/^(10|15|17|20)\d{9}$/.test(ruc)) return false;
  const sum = WEIGHTS.reduce((acc, w, i) => acc + w * Number(ruc[i]), 0);
  let check = 11 - (sum % 11);
  if (check === 10) check = 0;
  if (check === 11) check = 1;
  return check === Number(ruc[10]);
}
