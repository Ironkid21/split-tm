/**
 * CSV safety layer. Translation text is data and must never be executed as a spreadsheet formula.
 * A field that would start a formula in Excel/Sheets/LibreOffice (leading = + - @, optionally after whitespace,
 * or a leading TAB/CR) gets ONE leading apostrophe. The original text is kept in full and stays visible;
 * the original value is recovered by removing that first character.
 */
const FORMULA_START = /^(?:\s*[=+\-@]|[\t\r])/;

export const neutralizeFormula = (v: string): string => (FORMULA_START.test(v) ? `'${v}` : v);

/** RFC 4180 quoting for commas, quotes and line breaks; Unicode is passed through unchanged. */
export function csvField(v: string, protect = true): string {
  const s = protect ? neutralizeFormula(v) : v;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
