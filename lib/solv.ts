// ============================================================
// Solv Health adapter — NOT YET FUNCTIONAL.
//
// Solv doesn't expose a public self-serve API. Real integration
// requires a signed partner agreement with Solv, which provides the
// actual API base URL, auth scheme, and endpoint contracts — none of
// which exist yet for this project. This file defines the shape a
// real integration would need so wiring it in later is a drop-in:
// implement the two functions below once SOLV_API_KEY (and whatever
// else Solv's partner docs require) is actually issued. Until then,
// both functions throw rather than silently returning fake data.
// ============================================================

export class SolvNotConfiguredError extends Error {
  constructor() {
    super(
      "Solv integration is not configured. This requires a signed Solv partner agreement and real API credentials — see lib/solv.ts."
    );
    this.name = "SolvNotConfiguredError";
  }
}

export interface SolvSlot {
  startTime: string; // ISO 8601
  locationId: string;
}

export interface SolvBookingRequest {
  locationId: string;
  startTime: string;
  patientFirstName: string;
  patientLastName: string;
  patientPhone: string;
}

export interface SolvBookingConfirmation {
  bookingId: string;
  confirmationUrl: string;
}

function requireConfigured(): void {
  if (!process.env.SOLV_API_KEY) {
    throw new SolvNotConfiguredError();
  }
}

export async function getAvailability(): Promise<SolvSlot[]> {
  requireConfigured();
  throw new SolvNotConfiguredError();
}

export async function createBooking(
  _request: SolvBookingRequest
): Promise<SolvBookingConfirmation> {
  requireConfigured();
  throw new SolvNotConfiguredError();
}
