"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

interface Superbill {
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

function Receipt() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [bill, setBill] = useState<Superbill | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        const res = await fetch(`/api/telehealth/superbill?token=${encodeURIComponent(token)}`);
        const data = await res.json();
        if (!res.ok) {
          setLoadError(data.error || "This link is invalid or has expired.");
          return;
        }
        setBill(data);
      } catch {
        setLoadError("Something went wrong loading this receipt.");
      }
    })();
  }, [token]);

  if (!token) {
    return <div className="lux-card"><p className="lux-card-sub">Missing link token.</p></div>;
  }
  if (loadError) {
    return <div className="lux-card"><p className="lux-card-sub">{loadError}</p></div>;
  }
  if (!bill) {
    return <div className="lux-card lux-loading">Loading receipt…</div>;
  }

  return (
    <div className="lux-card receipt-print">
      <h1 className="lux-card-title">Visit receipt</h1>
      <p className="lux-card-sub">
        Submit this to your insurance for possible out-of-network
        reimbursement — we don&apos;t bill insurance ourselves, so
        whether and how much is reimbursed depends on your specific plan.
      </p>

      <div className="receipt-rows">
        <div><strong>Patient:</strong> {bill.patientFirstName} {bill.patientLastName}</div>
        <div><strong>Date of birth:</strong> {bill.patientDob}</div>
        <div><strong>Date of service:</strong> {bill.dateOfService}</div>
        <div><strong>Place of service:</strong> Telehealth</div>
        <div>
          <strong>Provider:</strong> {bill.providerName}
          {bill.providerCredentials ? `, ${bill.providerCredentials}` : ""}
        </div>
        {bill.providerNpi && <div><strong>Provider NPI:</strong> {bill.providerNpi}</div>}
        {bill.practiceName && <div><strong>Practice:</strong> {bill.practiceName}</div>}
        <div><strong>Diagnosis code (ICD-10):</strong> {bill.diagnosisCode}</div>
        <div><strong>Procedure code (CPT):</strong> {bill.procedureCode}</div>
        <div><strong>Amount paid:</strong> ${(bill.amountCents / 100).toFixed(2)}</div>
      </div>

      <button className="lux-btn" onClick={() => window.print()}>
        Print / save as PDF
      </button>
    </div>
  );
}

export default function ReceiptPage() {
  return (
    <div className="lux-shell">
      <header className="lux-header">
        <div className="brand lux-brand">
          <span className="dot"></span>urgentcare
          <span className="tld">.chat</span>
        </div>
        <div className="lux-tagline">Receipt</div>
      </header>

      <main className="lux-main" style={{ maxWidth: 480 }}>
        <Suspense fallback={<div className="lux-card lux-loading">Loading…</div>}>
          <Receipt />
        </Suspense>
      </main>
    </div>
  );
}
