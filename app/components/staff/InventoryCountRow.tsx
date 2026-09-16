"use client";

import { useState } from "react";
import CameraProof, { type Proof } from "@/app/components/staff/CameraProof";

// One item's count entry — quantity, expiration, and an optional photo,
// saved together. Modelled on LogForm.tsx's own photo sequencing: the
// count is filed first and the photo follows as a separate request, so
// a slow or failed upload never costs the count itself. See
// app/api/staff/inventory/count/route.ts and .../photo/route.ts.

export interface InventoryRowData {
  item_id: string;
  name: string;
  category: string | null;
  unit: string;
  quantity: string | null;
  expiration_date: string | null;
  note: string | null;
  counted_at: string | null;
  counted_by_name: string | null;
}

function formatWhen(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function InventoryCountRow({ item }: { item: InventoryRowData }) {
  const [quantity, setQuantity] = useState(item.quantity ?? "");
  const [expiration, setExpiration] = useState(item.expiration_date ?? "");
  const [note, setNote] = useState("");
  const [proof, setProof] = useState<Proof | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const lastCounted = formatWhen(item.counted_at);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/staff/inventory/count", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "submit",
          item_id: item.item_id,
          quantity: Number(quantity),
          expiration_date: expiration || null,
          note: note || null,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(
          data?.error === "read_only"
            ? "This clinic's account is read-only right now — the count was not saved."
            : "Could not save — try again."
        );
        return;
      }
      if (proof) {
        const fd = new FormData();
        fd.set("count_id", data.id);
        fd.set("file", new File([proof.blob], "proof.jpg", { type: proof.blob.type }));
        fd.set("caption", item.name);
        await fetch("/api/staff/inventory/photo", { method: "POST", body: fd }).catch(
          () => null
        );
      }
      setSaved(lastCounted ? "Updated" : "Saved");
      setNote("");
      setProof(null);
    } finally {
      setSaving(false);
    }
  }

  return (
    <li className="st-record-row">
      <div className="st-record-main">
        <span className="st-record-title">
          {item.name}
          {item.category && <span className="st-record-citation">{item.category}</span>}
        </span>

        <div className="st-field" style={{ marginTop: 8 }}>
          <span className="st-field-label">Quantity ({item.unit})</span>
          <input
            className="st-input"
            type="number"
            min={0}
            step="any"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            disabled={saving}
          />
        </div>

        <div className="st-field" style={{ marginTop: 8 }}>
          <span className="st-field-label">Expiration (if it has one)</span>
          <input
            className="st-input"
            type="date"
            value={expiration}
            onChange={(e) => setExpiration(e.target.value)}
            disabled={saving}
          />
        </div>

        <div className="st-field" style={{ marginTop: 8 }}>
          <span className="st-field-label">Note (optional)</span>
          <input
            className="st-input"
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. lot number, or what was reordered"
            disabled={saving}
          />
        </div>

        <div style={{ marginTop: 8 }}>
          <CameraProof label="Photo (optional)" onChange={setProof} disabled={saving} />
        </div>

        {error && (
          <p className="st-sign-error" role="alert">
            {error}
          </p>
        )}
      </div>

      <div className="st-record-sig">
        {lastCounted && (
          <span className="st-record-when">
            Last counted {lastCounted}
            {item.counted_by_name ? ` by ${item.counted_by_name}` : ""}
          </span>
        )}
        <button
          className="st-primary"
          type="button"
          onClick={save}
          disabled={saving || quantity === ""}
        >
          {saving ? "Saving…" : saved ? `${saved} — save again` : "Save count"}
        </button>

        {/* Plain form POST, not fetch — no client state depends on the
            result, so there is no reason to route it through the same
            JSON API the count itself uses. */}
        <form method="POST" action="/api/staff/inventory/items">
          <input type="hidden" name="action" value="deactivate" />
          <input type="hidden" name="item_id" value={item.item_id} />
          <button className="st-quiet" type="submit">
            Deactivate
          </button>
        </form>
      </div>
    </li>
  );
}
