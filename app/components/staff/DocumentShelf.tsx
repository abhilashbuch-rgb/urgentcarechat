"use client";

import { useState } from "react";
import {
  DOC_TYPES,
  DOC_TYPE_LABELS,
  type DocType,
  type MyDocument,
} from "@/lib/staff/documents";

// Your own credential shelf: add one, see what is expiring, retire one.
//
// THE DATE IS THE REQUIRED HALF, THE FILE IS OPTIONAL, and that is the
// right way round. The roster can chase an expiry it knows about; it
// cannot chase one nobody entered because they had no scanner to hand.
// A form that demanded the scan would systematically lose the dates
// belonging to the people least likely to have got round to scanning —
// which is exactly the population the roster exists to catch.

const ERRORS: Record<string, string> = {
  uploads_not_enabled:
    "File uploads aren't switched on for this clinic yet. The date is saved either way — that's the part the roster uses.",
  file_too_large: "That file is over 10MB. A photo of the card is plenty.",
  bad_file_type: "PDF, JPEG, PNG, HEIC or WebP.",
  bad_date: "That date didn't parse. Check the day and month.",
  nothing_to_record: "Add an expiry date, a file, or both.",
  missing_title: "Give it a name you'd recognise in a list.",
  upload_failed: "The file didn't upload. Try once more.",
};

const STATUS_LABELS: Record<MyDocument["status"], string> = {
  expired: "Expired",
  expiring: "Expiring",
  no_date: "No date",
  current: "Current",
};

export default function DocumentShelf({
  documents,
  uploadsEnabled,
}: {
  documents: MyDocument[];
  uploadsEnabled: boolean;
}) {
  const [open, setOpen] = useState(documents.length === 0);
  const [docType, setDocType] = useState<DocType>("bls_cpr");
  const [title, setTitle] = useState("");
  const [expiresOn, setExpiresOn] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ready = title.trim().length >= 2 && (expiresOn || file) && !busy;

  async function submit() {
    if (!ready) return;
    setBusy(true);
    setError(null);

    const form = new FormData();
    form.set("doc_type", docType);
    form.set("title", title.trim());
    if (expiresOn) form.set("expires_on", expiresOn);
    if (file) form.set("file", file);

    const res = await fetch("/api/staff/documents", {
      method: "POST",
      body: form,
    }).catch(() => null);

    if (!res?.ok) {
      const body = await res?.json().catch(() => ({}));
      setError(ERRORS[body?.error] ?? "That didn't save. Try once more.");
      setBusy(false);
      return;
    }
    window.location.reload();
  }

  async function retire(id: string) {
    const res = await fetch(`/api/staff/documents?id=${id}`, {
      method: "DELETE",
    }).catch(() => null);
    if (res?.ok) window.location.reload();
  }

  return (
    <>
      {documents.length > 0 && (
        <div className="st-doc-shelf">
          {documents.map((d) => (
            <article key={d.id} className={`st-shelf-item st-shelf-${d.status}`}>
              <div className="st-shelf-main">
                <p className="st-shelf-title">{d.title}</p>
                <p className="st-shelf-type">
                  {DOC_TYPE_LABELS[d.doc_type] ?? d.doc_type}
                </p>
              </div>
              <div className="st-shelf-meta">
                <span className={`st-tag st-tag-${d.status}`}>
                  {STATUS_LABELS[d.status]}
                </span>
                {d.expires_on && (
                  <span className="st-shelf-date">Expires {d.expires_on}</span>
                )}
                {/* Verified means somebody senior looked at it. Said
                    plainly in both directions, because "verified" is the
                    word a surveyor reads and it has to be true. */}
                <span className="st-shelf-verify">
                  {d.verified_on
                    ? `Checked by ${d.verified_by_name ?? "a lead"}`
                    : "Not checked yet"}
                </span>
              </div>
              <div className="st-shelf-actions">
                {d.has_file && (
                  <a
                    className="st-btn st-btn-quiet"
                    href={`/api/staff/documents/file?id=${d.id}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open
                  </a>
                )}
                <button
                  className="st-btn st-btn-quiet"
                  onClick={() => retire(d.id)}
                >
                  Remove
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {!open ? (
        <button className="st-btn st-btn-primary" onClick={() => setOpen(true)}>
          Add a document
        </button>
      ) : (
        <div className="st-sign">
          <label className="st-field">
            <span className="st-field-label">What is it</span>
            <select
              className="st-input"
              value={docType}
              onChange={(e) => setDocType(e.target.value as DocType)}
            >
              {DOC_TYPES.map((t) => (
                <option key={t} value={t}>
                  {DOC_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </label>

          <label className="st-field">
            <span className="st-field-label">Name it</span>
            <input
              className="st-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="AHA BLS card 2026"
            />
          </label>

          <label className="st-field">
            <span className="st-field-label">
              Expires
              <span className="st-field-optional">
                Optional, but this is what the roster reads
              </span>
            </span>
            <input
              className="st-input"
              type="date"
              value={expiresOn}
              onChange={(e) => setExpiresOn(e.target.value)}
            />
          </label>

          {uploadsEnabled ? (
            <label className="st-field">
              <span className="st-field-label">
                A scan or photo
                <span className="st-field-optional">Optional</span>
              </span>
              <input
                className="st-input"
                type="file"
                accept="application/pdf,image/jpeg,image/png,image/heic,image/webp"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              <span className="st-field-hint">
                PDF or a photo of the card, up to 10MB.
              </span>
            </label>
          ) : (
            <p className="st-sign-fine">
              File uploads aren&rsquo;t switched on for this clinic yet, so this
              records the date only &mdash; which is the part the roster reads.
            </p>
          )}

          {error && (
            <p className="st-run-error" role="alert">
              {error}
            </p>
          )}

          <div className="st-run-actions">
            <button className="st-btn" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button
              className="st-btn st-btn-primary"
              onClick={submit}
              disabled={!ready}
            >
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
