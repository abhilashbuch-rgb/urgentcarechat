function twilioAuthHeader(): string {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) {
    throw new Error("Missing TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN env var");
  }
  return `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`;
}

// Sends an SMS via Twilio's REST API directly (no SDK dependency needed).
export async function sendSms(to: string, body: string): Promise<void> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const from = process.env.TWILIO_FROM_NUMBER;

  if (!sid || !from) {
    throw new Error("Missing TWILIO_ACCOUNT_SID or TWILIO_FROM_NUMBER env var");
  }

  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: twilioAuthHeader(),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: to, From: from, Body: body }),
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Twilio send failed: ${res.status} ${text}`);
  }
}

interface ProxyParticipant {
  sid: string;
  identifier: string;
  proxyIdentifier: string;
}

export interface MaskedCallSession {
  sessionSid: string;
  patient: ProxyParticipant;
  provider: ProxyParticipant;
}

// ============================================================
// Twilio Proxy — masked two-party calling ("no phone numbers exchanged").
// Creates a Proxy session with the patient and provider as participants.
// Twilio assigns each participant a proxy number; when the OTHER
// participant calls that proxy number, Twilio relays the call to this
// participant's real number without exposing it.
//
// Requires a Proxy Service created once in the Twilio console (Console →
// Proxy → create a Service, add at least one voice-capable number to its
// pool) and its Service SID set as TWILIO_PROXY_SERVICE_SID. This is a
// real, documented Twilio product built for exactly this use case, but
// hasn't been exercised against a live account from this environment —
// test it end-to-end with a Twilio trial account before relying on it
// for real patients.
// ============================================================
export async function createMaskedCallSession(
  patientPhone: string,
  providerPhone: string,
  uniqueName: string
): Promise<MaskedCallSession> {
  const serviceSid = process.env.TWILIO_PROXY_SERVICE_SID;
  if (!serviceSid) {
    throw new Error("Missing TWILIO_PROXY_SERVICE_SID env var");
  }

  const base = `https://proxy.twilio.com/v1/Services/${serviceSid}`;
  const authHeader = twilioAuthHeader();

  const sessionRes = await fetch(`${base}/Sessions`, {
    method: "POST",
    headers: {
      Authorization: authHeader,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      UniqueName: uniqueName,
      Ttl: String(2 * 60 * 60), // 2-hour session covering a 30-min call plus buffer
    }),
  });

  if (!sessionRes.ok) {
    throw new Error(`Twilio Proxy session create failed: ${sessionRes.status} ${await sessionRes.text()}`);
  }
  const session = await sessionRes.json();

  async function addParticipant(identifier: string, friendlyName: string): Promise<ProxyParticipant> {
    const res = await fetch(`${base}/Sessions/${session.sid}/Participants`, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ Identifier: identifier, FriendlyName: friendlyName }),
    });
    if (!res.ok) {
      throw new Error(`Twilio Proxy participant add failed: ${res.status} ${await res.text()}`);
    }
    const data = await res.json();
    return {
      sid: data.sid,
      identifier: data.identifier,
      proxyIdentifier: data.proxy_identifier,
    };
  }

  const patient = await addParticipant(patientPhone, "patient");
  const provider = await addParticipant(providerPhone, "provider");

  return { sessionSid: session.sid, patient, provider };
}
