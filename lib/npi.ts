// NPI (National Provider Identifier) verification against the real,
// public CMS NPPES Registry API — no API key required.
// https://npiregistry.cms.hhs.gov/api-docs

export function isValidNpiFormat(npi: string): boolean {
  const digits = npi.trim();
  if (!/^\d{10}$/.test(digits)) return false;

  // Luhn check with the healthcare-industry prefix "80840" per CMS spec.
  const withPrefix = `80840${digits}`;
  let sum = 0;
  let alternate = false;
  for (let i = withPrefix.length - 1; i >= 0; i--) {
    let n = parseInt(withPrefix[i], 10);
    if (alternate) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alternate = !alternate;
  }
  return sum % 10 === 0;
}

export interface NpiRecord {
  found: boolean;
  active: boolean;
  firstName?: string;
  lastName?: string;
  credential?: string;
  licenseStates: string[];
}

export async function lookupNpi(npi: string): Promise<NpiRecord> {
  const res = await fetch(
    `https://npiregistry.cms.hhs.gov/api/?number=${encodeURIComponent(npi)}&version=2.1`
  );

  if (!res.ok) {
    throw new Error(`NPPES lookup failed: ${res.status}`);
  }

  const data = await res.json();
  const result = data.results?.[0];

  if (!result) {
    return { found: false, active: false, licenseStates: [] };
  }

  const taxonomies: { state?: string; license?: string; primary?: boolean }[] =
    result.taxonomies || [];

  return {
    found: true,
    active: result.basic?.status === "A",
    firstName: result.basic?.first_name,
    lastName: result.basic?.last_name,
    credential: result.basic?.credential,
    licenseStates: taxonomies.map((t) => t.state).filter((s): s is string => !!s),
  };
}
