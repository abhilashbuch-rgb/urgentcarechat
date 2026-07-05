// US-only E.164 normalization — every provider/patient phone number
// in this app is expected to be a US number.
export function toE164(input: string): string | null {
  const digits = input.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}
