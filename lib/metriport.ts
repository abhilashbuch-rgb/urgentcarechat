import { createServerClient } from "./supabase";
import { sendEmail } from "./email";

// ============================================================
// Metriport adapter — pushes a provider's visit note into the
// patient's medical record via Metriport's Medical API, which routes
// through the Carequality/CommonWell health information exchange
// networks.
//
// CONFIDENCE NOTE (read before relying on this in production):
// Metriport's primary, best-documented use case is AGGREGATING a
// patient's existing records from the network into your app — i.e.
// pulling data IN. Using it to push a custom document OUT so it lands
// in one specific organization's EMR (e.g. AFC Narberth's
// eClinicalWorks chart) is a different capability, and this file is
// built on a good-faith best understanding of their Patient/Document
// API shape, not a verified integration. Two things to confirm
// directly with Metriport support before going live:
//   1. Whether AFC Narberth's EMR is actually reachable as a WRITE
//      target through Carequality/CommonWell (participation doesn't
//      automatically mean every connected org accepts inbound docs).
//   2. The exact Patient resource's required fields — this code
//      assumes firstName/lastName/dob are sufficient, but Metriport
//      may require additional fields (e.g. genderAtBirth, address)
//      we don't currently collect.
// ============================================================

const BASE_URL = "https://api.metriport.com/medical/v1";

export class MetriportNotConfiguredError extends Error {
  constructor() {
    super("Metriport is not configured — set METRIPORT_API_KEY and METRIPORT_FACILITY_ID.");
    this.name = "MetriportNotConfiguredError";
  }
}

function requireConfig(): { apiKey: string; facilityId: string } {
  const apiKey = process.env.METRIPORT_API_KEY;
  const facilityId = process.env.METRIPORT_FACILITY_ID;
  if (!apiKey || !facilityId) throw new MetriportNotConfiguredError();
  return { apiKey, facilityId };
}

async function createPatient(
  apiKey: string,
  facilityId: string,
  patient: { firstName: string; lastName: string; dob: string }
): Promise<string> {
  const res = await fetch(`${BASE_URL}/patient?facilityId=${encodeURIComponent(facilityId)}`, {
    method: "POST",
    headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      firstName: patient.firstName,
      lastName: patient.lastName,
      dob: patient.dob, // expected YYYY-MM-DD
    }),
  });

  if (!res.ok) {
    throw new Error(`Metriport patient create failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  return data.id;
}

async function uploadVisitNoteDocument(
  apiKey: string,
  patientId: string,
  facilityId: string,
  noteText: string,
  providerName: string
): Promise<void> {
  // Best-effort: send the note as a simple text document tied to the
  // patient. If Metriport's actual document-upload contract differs
  // (e.g. requires a presigned URL step, or a specific FHIR
  // DocumentReference shape), this call will fail loudly with the
  // response body logged — check that against Metriport's current
  // API docs rather than assuming this shape is exactly right.
  const res = await fetch(
    `${BASE_URL}/document?facilityId=${encodeURIComponent(facilityId)}`,
    {
      method: "POST",
      headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        patientId,
        description: `Telehealth visit note — ${providerName}`,
        content: noteText,
        contentType: "text/plain",
      }),
    }
  );

  if (!res.ok) {
    throw new Error(`Metriport document upload failed: ${res.status} ${await res.text()}`);
  }
}

// Looks up the telehealth_request and pushes patient + note to
// Metriport. Metriport can't reach every practice — no HIE match, no
// EMR at all, or just not configured — so any failure there falls
// back to emailing the note directly to the provider's own on-file
// address, which works regardless of what (if any) EMR they run.
// Only on success of either channel do we scrub the local note and
// patient demographics, since the record now lives somewhere else.
export async function pushVisitNoteToEmr(telehealthRequestId: string): Promise<void> {
  const supabase = createServerClient();

  const { data: request, error } = await supabase
    .from("telehealth_requests")
    .select("patient_first_name, patient_last_name, patient_dob, visit_note, providers(name, email)")
    .eq("id", telehealthRequestId)
    .maybeSingle();

  if (error || !request) {
    throw new Error(`telehealth_request ${telehealthRequestId} not found`);
  }
  if (!request.patient_first_name || !request.patient_last_name || !request.patient_dob || !request.visit_note) {
    throw new Error("Missing patient demographics or note — nothing to push");
  }

  const provider = request.providers as unknown as { name: string; email: string };

  let status: "pushed" | "emailed" | undefined;
  let lastError: string | undefined;

  try {
    const { apiKey, facilityId } = requireConfig();
    const patientId = await createPatient(apiKey, facilityId, {
      firstName: request.patient_first_name,
      lastName: request.patient_last_name,
      dob: request.patient_dob,
    });
    await uploadVisitNoteDocument(apiKey, patientId, facilityId, request.visit_note, provider.name);
    status = "pushed";
  } catch (err) {
    lastError = err instanceof Error ? err.message : "Unknown error";

    try {
      await sendEmail(
        provider.email,
        "Visit note — action needed (EMR auto-push unavailable)",
        [
          `We couldn't automatically deliver this note into your EMR (${lastError}).`,
          "Please copy it into your patient's chart manually.",
          "",
          `Patient: ${request.patient_first_name} ${request.patient_last_name}`,
          `DOB: ${request.patient_dob}`,
          "",
          request.visit_note,
        ].join("\n")
      );
      status = "emailed";
    } catch (emailErr) {
      lastError = `Metriport: ${lastError}; Email fallback: ${emailErr instanceof Error ? emailErr.message : "Unknown error"}`;
    }
  }

  if (!status) {
    await supabase
      .from("telehealth_requests")
      .update({ emr_push_status: "failed", emr_push_error: lastError })
      .eq("id", telehealthRequestId);
    throw new Error(lastError);
  }

  await supabase
    .from("telehealth_requests")
    .update({
      emr_push_status: status,
      visit_note: null,
      patient_first_name: null,
      patient_last_name: null,
      patient_dob: null,
    })
    .eq("id", telehealthRequestId);
}
