"use client";

import { useEffect, useState } from "react";
import Home from "../page";

const SNIPPET = `<iframe
  src="https://urgentcare.chat/widget"
  style="width:100%;max-width:480px;height:640px;border:1px solid #e6e1d6;border-radius:8px;"
  title="urgentcare.chat triage assistant"
></iframe>`;

function EmbedDocs() {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(SNIPPET);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable — the snippet is still selectable/visible.
    }
  };

  return (
    <div className="widget-docs">
      <header className="site-header">
        <div className="brand">
          <span className="dot"></span>urgentcare
          <span className="tld">.chat</span>
        </div>
        <div className="tagline">Embed this widget</div>
      </header>

      <main className="widget-docs-main">
        <h1 className="widget-docs-title">Add the triage chat to your site</h1>
        <p className="widget-docs-sub">
          Drop this iframe snippet anywhere on your page. It&apos;s the same
          free AI triage + clinic finder, chrome-less and sized to fit
          alongside your content.
        </p>

        <div className="widget-snippet">
          <pre>{SNIPPET}</pre>
          <button className="widget-copy-btn" onClick={copy}>
            {copied ? "Copied!" : "Copy snippet"}
          </button>
        </div>

        <h2 className="widget-preview-label">Live preview</h2>
        <iframe
          src="/widget"
          className="widget-preview-frame"
          title="urgentcare.chat widget preview"
        />
      </main>
    </div>
  );
}

export default function WidgetPage() {
  const [isFramed, setIsFramed] = useState<boolean | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsFramed(window.self !== window.top);
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  if (isFramed === null) return null;
  if (isFramed) return <Home embed />;
  return <EmbedDocs />;
}
