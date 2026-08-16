// Service and insurance tags are stored as database slugs. Patients should
// never read "covid_testing" off a clinic card.
//
// Shared by the chat's clinic cards and the tenant portal's location list so
// the same tag can't render two different ways on one page.

const SERVICE_LABELS: Record<string, string> = {
  covid_testing: "COVID testing",
  covid_test: "COVID testing",
  occupational_health: "Occupational health",
  x_ray: "X-ray",
  "x-ray": "X-ray",
  xray: "X-ray",
  lab: "Lab work",
  labs: "Lab work",
  physicals: "Physicals",
  sports_physicals: "Sports physicals",
  school_physicals: "School physicals",
  vaccinations: "Vaccinations",
  flu_shots: "Flu shots",
  pediatric: "Pediatrics",
  pediatrics: "Pediatrics",
  stitches: "Stitches",
  std_testing: "STD testing",
  iv_fluids: "IV fluids",
  ekg: "EKG",
  drug_testing: "Drug testing",
  travel_medicine: "Travel medicine",
};

const INSURANCE_LABELS: Record<string, string> = {
  bcbs: "Blue Cross Blue Shield",
  united: "UnitedHealthcare",
  uhc: "UnitedHealthcare",
  aetna: "Aetna",
  cigna: "Cigna",
  humana: "Humana",
  medicare: "Medicare",
  medicaid: "Medicaid",
  tricare: "TRICARE",
  horizon: "Horizon",
  ibx: "Independence Blue Cross",
  self_pay: "Self-pay",
};

function humanize(slug: string): string {
  const words = slug.replace(/[_-]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function serviceLabel(slug: string): string {
  return SERVICE_LABELS[slug.toLowerCase()] ?? humanize(slug);
}

export function insuranceLabel(slug: string): string {
  return INSURANCE_LABELS[slug.toLowerCase()] ?? humanize(slug);
}
