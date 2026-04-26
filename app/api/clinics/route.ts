import { NextRequest, NextResponse } from "next/server";

// ============================================================
// /api/clinics — Clinic search endpoint
// Phase 4 will wire this to Google Places API + Supabase overrides.
// For now, returns mock data matching the original prototype.
// ============================================================

const MOCK_CLINICS = [
  {
    name: "AFC Urgent Care Narberth",
    distance: "0.8 mi",
    address: "101 Montgomery Ave, Narberth, PA",
    phone: "(610) 555-0100",
    open: true,
    hours: "Open until 8pm",
    services: ["X-Ray", "Lab", "COVID Testing"],
    insurance: ["Aetna", "BCBS", "Cigna", "United"],
    rating: 4.8,
    featured: true,
    directionsUrl: "https://maps.google.com/?q=AFC+Urgent+Care+Narberth",
  },
  {
    name: "Main Line Walk-In Clinic",
    distance: "1.4 mi",
    address: "245 Lancaster Ave, Ardmore, PA",
    phone: "(610) 555-0234",
    open: true,
    hours: "Open until 9pm",
    services: ["X-Ray", "Pediatric"],
    insurance: ["Aetna", "BCBS", "Medicare"],
    rating: 4.5,
    featured: false,
    directionsUrl: "https://maps.google.com/?q=Main+Line+Walk-In+Clinic",
  },
  {
    name: "Penn Medicine Express Care",
    distance: "2.1 mi",
    address: "3737 Market St, Philadelphia, PA",
    phone: "(215) 555-0150",
    open: true,
    hours: "Open 24/7",
    services: ["X-Ray", "Lab", "IV Therapy"],
    insurance: ["Aetna", "BCBS", "Cigna", "United", "Medicare", "Medicaid"],
    rating: 4.6,
    featured: false,
    directionsUrl: "https://maps.google.com/?q=Penn+Medicine+Express+Care",
  },
];

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const zip = searchParams.get("zip");
  const insurance = searchParams.get("insurance");

  if (!zip || !/^\d{5}$/.test(zip)) {
    return NextResponse.json(
      { error: "Valid 5-digit zip code required" },
      { status: 400 }
    );
  }

  // STUB: Return mock clinics, optionally filtered by insurance
  let clinics = MOCK_CLINICS;
  if (insurance && insurance.toLowerCase() !== "skip") {
    clinics = clinics.filter((c) =>
      c.insurance.some((i) =>
        i.toLowerCase().includes(insurance.toLowerCase())
      )
    );
  }

  // Featured clinics always sort first
  clinics.sort((a, b) => (b.featured ? 1 : 0) - (a.featured ? 1 : 0));

  return NextResponse.json({ clinics: clinics.slice(0, 5) });
}
