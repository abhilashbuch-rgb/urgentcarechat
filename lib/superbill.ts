import crypto from "crypto";
import { createServerClient } from "./supabase";
import { sendSms } from "./twilio";

// ============================================================
// Superbill — an itemized receipt the PATIENT (not us, not the
// provider) submits to their own insurance for possible
// out-of-network reimbursement. We never bill insurance directly —
// that's a fee-splitting/kickback problem when it's tied to a
// referral fee like ours. This just hands the patient the paperwork.
// Only generated when the provider enters both a diagnosis and
// procedure code on the visit note — neither field is required.
// ============================================================

interface ProviderRow {
  name: string;
  npi: string | null;
  practice_name: string | null;
  credentials: string | null;
}

export interface SuperbillSnapshot {
  patientFirstName: string;
  patientLastName: string;
  patientDob: string;
  dateOfService: string;
  providerName: string;
  providerCredentials: string | null;
  providerNpi: string | null;
  practiceName: string | null;
  diagnosisCode: string;
  procedureCode: string;
  amountCents: number;
}

// Builds the snapshot and stores it, then texts the patient a link —
// called from the note-submission route BEFORE the EMR push scrubs
// patient_first_name/last_name/dob, since this needs those fields.
export async function generateSuperbill(
  telehealthRequestId: string,
  diagnosisCode: string,
  procedureCode: string,
  origin: string
): Promise<void> {
  const supabase = createServerClient();

  const { data: request, error } = await supabase
    .from("telehealth_requests")
    .select(
      "patient_first_name, patient_last_name, patient_dob, patient_phone, amount_cents, paid_at, created_at, providers(name, npi, practice_name, credentials)"
    )
    .eq("id", telehealthRequestId)
    .maybeSingle();

  if (error || !request) {
    throw new Error(`telehealth_request ${telehealthRequestId} not found`);
  }
  if (!request.patient_first_name || !request.patient_last_name || !request.patient_dob) {
    throw new Error("Missing patient demographics — nothing to generate a superbill from");
  }

  const provider = request.providers as unknown as ProviderRow;

  const snapshot: SuperbillSnapshot = {
    patientFirstName: request.patient_first_name,
    patientLastName: request.patient_last_name,
    patientDob: request.patient_dob,
    dateOfService: (request.paid_at || request.created_at || new Date().toISOString()).slice(0, 10),
    providerName: provider.name,
    providerCredentials: provider.credentials,
    providerNpi: provider.npi,
    practiceName: provider.practice_name,
    diagnosisCode,
    procedureCode,
    amountCents: request.amount_cents,
  };

  const token = crypto.randomBytes(24).toString("hex");

  await supabase
    .from("telehealth_requests")
    .update({
      diagnosis_code: diagnosisCode,
      procedure_code: procedureCode,
      superbill_token: token,
      superbill_snapshot: snapshot,
      superbill_generated_at: new Date().toISOString(),
    })
    .eq("id", telehealthRequestId);

  if (request.patient_phone) {
    try {
      await sendSms(
        request.patient_phone,
        `urgentcare.chat: your visit receipt for insurance reimbursement is ready — ${origin}/telehealth/receipt?token=${token}`
      );
    } catch (smsErr) {
      // Best-effort — the receipt still exists at its link even if this fails.
      console.error("[superbill] patient SMS failed:", smsErr);
    }
  }
}
