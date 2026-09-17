/**
 * Pre-flight checks before dispatching a file to athenahealth's
 * POST /v1/{practiceid}/documents/admin.
 *
 * Pure and dependency-free on purpose — this doesn't need a connected
 * practice or a live token to be correct, so it's the one piece of
 * this integration that can be exercised end-to-end before we have
 * athenahealth credentials at all.
 */

const MAX_BYTES = 20 * 1024 * 1024; // athenahealth's documented cap
const PDF_MAGIC = Buffer.from("%PDF-");

export interface DocumentValidationResult {
  ok: boolean;
  reason?: string;
}

/**
 * Validates a compiled binder/report PDF before it's base64-encoded
 * into an /documents/admin payload: under the size cap, actually a PDF
 * (checked by magic bytes, not by filename), and not encrypted — an
 * encrypted PDF is unreadable to whoever pulls it up in athenaOne,
 * which is a worse failure than rejecting it here with a clear reason.
 */
export function validateAdminDocumentFile(bytes: Buffer): DocumentValidationResult {
  if (bytes.length === 0) {
    return { ok: false, reason: "file is empty" };
  }
  if (bytes.length > MAX_BYTES) {
    return {
      ok: false,
      reason: `file is ${(bytes.length / (1024 * 1024)).toFixed(1)}MB, over the 20MB limit`,
    };
  }
  if (!bytes.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC)) {
    return { ok: false, reason: "file does not start with the PDF magic bytes (%PDF-)" };
  }
  // A real encryption dictionary check would need a PDF parser; this is
  // the same shallow signal every quick PDF sniffer uses — an /Encrypt
  // key present anywhere in the trailer area. False negatives are
  // possible on an unusual PDF; that's an acceptable gap for a
  // pre-flight check whose job is to catch the common case cheaply, not
  // to replace athenahealth's own validation.
  if (bytes.includes(Buffer.from("/Encrypt"))) {
    return { ok: false, reason: "file appears to be encrypted; athenahealth requires an unencrypted PDF" };
  }
  return { ok: true };
}

/**
 * Normalizes CRLF/CR to LF in a text metadata field (e.g. a document
 * title or note) going into the same payload. athenahealth's admin
 * document API is documented as rejecting embedded carriage returns in
 * text fields; this is cheap enough to apply unconditionally rather
 * than trying to detect when it's needed.
 */
export function stripCarriageReturns(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}
