import { useState } from "react";

/** Copy-to-clipboard for a place_id, with a fallback for older browsers. */
export default function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className={`copy-btn${copied ? " copied" : ""}`}
      title="Copy place_id"
      aria-label={`Copy place_id ${text}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          const ta = document.createElement("textarea");
          ta.value = text;
          document.body.appendChild(ta);
          ta.select();
          document.execCommand("copy");
          document.body.removeChild(ta);
        }
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      }}
    >
      {copied ? (
        <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="m5 12.5 4.5 4.5L19 7.5" />
        </svg>
      ) : (
        <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
          <rect x="9" y="9" width="11" height="11" rx="2" />
          <path d="M5 15V5a2 2 0 0 1 2-2h10" />
        </svg>
      )}
    </button>
  );
}
