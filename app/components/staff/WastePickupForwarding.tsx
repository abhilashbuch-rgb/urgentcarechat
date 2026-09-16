"use client";

import { useState } from "react";
import type { InboundActivity } from "@/lib/staff/waste-pickup-inbound";

// Setup instructions and a small activity log for the inbound-email
// pipeline — the part that was missing before: an administrator had no
// way to find the address to forward to, or to tell whether forwarding
// mail there was actually doing anything.

const REJECTION_LABELS: Record<string, string> = {
  sender_not_recognized: "Not from Sharps Compliance — ignored.",
  date_not_found: "Couldn't find a date in the email — nothing moved.",
  no_open_obligation: "No pickup currently open to move.",
};

function describe(entry: InboundActivity): string {
  if (entry.action === "obligation_rescheduled_auto") {
    const dueOn = entry.detail.due_on ?? "?";
    const prev = entry.detail.previous_due_on;
    return prev && prev !== dueOn ? `Moved to ${dueOn} (was ${prev}).` : `Set to ${dueOn}.`;
  }
  return REJECTION_LABELS[entry.detail.reason ?? ""] ?? "Not applied.";
}

export default function WastePickupForwarding({
  address,
  configured,
  activity,
}: {
  address: string;
  configured: boolean;
  activity: InboundActivity[];
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(address).catch(() => null);
    setCopied(true);
  }

  return (
    <div className="st-sign">
      {!configured && (
        <div className="st-notice st-notice-warn" role="alert">
          <strong>Setup isn&rsquo;t finished on our end yet.</strong>
          <span>
            The address below is what it will be once it is &mdash; forwarding
            to it now won&rsquo;t do anything until that&rsquo;s done. Ask
            whoever set this feature up for the current status.
          </span>
        </div>
      )}

      <div className="st-field">
        <span className="st-field-label">Forward Sharps&rsquo; emails to</span>
        <div className="st-sv-link">
          <code>{address}</code>
        </div>
        <span className="st-field-hint">
          In your own email (Gmail, Outlook, whatever your clinic uses), add a
          rule that automatically forwards mail from Sharps Compliance to this
          address &mdash; look for &ldquo;Forwarding&rdquo; or &ldquo;Rules&rdquo;
          in your mail settings. Once it&rsquo;s set up you never touch it
          again; every future confirmation just works.
        </span>
      </div>

      <div className="st-run-actions">
        <button className="st-btn st-btn-primary" onClick={copy}>
          {copied ? "Copied" : "Copy address"}
        </button>
      </div>

      <section className="st-section">
        <h2 className="st-h2">Recent activity</h2>
        {activity.length === 0 ? (
          <p className="st-empty">
            Nothing received yet. Once forwarding is set up, anything that
            arrives shows up here &mdash; applied or not.
          </p>
        ) : (
          <div className="st-round-list">
            {activity.map((a, i) => (
              <article key={i} className="st-round">
                <span className="st-round-main">
                  <span className="st-round-title">{describe(a)}</span>
                  <span className="st-round-purpose">
                    {new Date(a.created_at).toLocaleString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </span>
                </span>
                <span
                  className={`st-tag ${
                    a.action === "obligation_rescheduled_auto" ? "st-tag-active" : "st-tag-due"
                  }`}
                >
                  {a.action === "obligation_rescheduled_auto" ? "Applied" : "Skipped"}
                </span>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
