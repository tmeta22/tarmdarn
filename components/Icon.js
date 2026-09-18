const PATHS = {
  /* --- Dashboard --- */
  edit: (
    <>
      <path d="M4 20h4L18.5 9.5a2.12 2.12 0 0 0-3-3L5 17v3Z" />
      <path d="M13.5 6.5 17 10" />
    </>
  ),
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  checkSquare: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <path d="m8.5 12.5 2.5 2.5 4.5-5" />
    </>
  ),
  close: (
    <>
      <path d="M6 6l12 12" />
      <path d="M18 6 6 18" />
    </>
  ),
  history: (
    <>
      <path d="M12 7.5V12l3 1.8" />
      <path d="M3.6 12a8.4 8.4 0 1 0 2.5-5.9" />
      <path d="M3 4v4h4" />
    </>
  ),
  trash: (
    <>
      <path d="M4 7h16" />
      <path d="M10 11.5v5.5M14 11.5v5.5" />
      <path d="M6.5 7 7.5 20h9L17.5 7" />
      <path d="M9.5 7V4h5v3" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 11a8 8 0 0 0-14-4.5L4 8.5" />
      <path d="M4 4.5v4h4" />
      <path d="M4 13a8 8 0 0 0 14 4.5L20 15.5" />
      <path d="M20 19.5v-4h-4" />
    </>
  ),
  merge: (
    <>
      <path d="M7 4v5.5a4 4 0 0 0 4 4h6" />
      <path d="M7 20v-5.5" />
      <path d="m14 10.5 3 3-3 3" />
    </>
  ),
  arrow: <path d="M5 12h13.5M13 6.5l5.5 5.5-5.5 5.5" />,

  /* --- Controls: search & add --- */
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4 4" />
    </>
  ),
  layers: (
    <>
      <path d="m12 4 8 4.5-8 4.5-8-4.5L12 4Z" />
      <path d="m4 13 8 4.5 8-4.5" />
    </>
  ),
  plus: <path d="M12 5.5v13M5.5 12h13" />,
  listPlus: (
    <>
      <path d="M4 7h9M4 12h9M4 17h5" />
      <path d="M17 13.5v6M14 16.5h6" />
    </>
  ),
  chevronDown: <path d="m6.5 9.5 5.5 5.5 5.5-5.5" />,
  upload: (
    <>
      <path d="M12 16V4.5" />
      <path d="m7.5 9 4.5-4.5L16.5 9" />
      <path d="M5 15v3.5a1.5 1.5 0 0 0 1.5 1.5h11a1.5 1.5 0 0 0 1.5-1.5V15" />
    </>
  ),
  play: <path d="M8 5.5v13l10.5-6.5L8 5.5Z" />,
  eraser: (
    <>
      <path d="m6 16 8.5-8.5a2.1 2.1 0 0 1 3 3L9 19H6l-2-2 2-1Z" />
      <path d="M12 19h8" />
    </>
  ),

  /* --- Controls: modes --- */
  user: (
    <>
      <circle cx="12" cy="8.5" r="3.5" />
      <path d="M5.5 19.5a6.5 6.5 0 0 1 13 0" />
    </>
  ),
  badge: (
    <>
      <rect x="3.5" y="5" width="17" height="14" rx="2.5" />
      <circle cx="8.5" cy="11" r="1.8" />
      <path d="M13 10.5h4M13 14h2.5" />
    </>
  ),
  split: (
    <>
      <path d="M4 12h4a4 4 0 0 0 4-4V6" />
      <path d="M4 12h4a4 4 0 0 1 4 4v2" />
      <path d="m15 3.5 2.5 2.5L15 8.5" />
      <path d="m15 15.5 2.5 2.5-2.5 2.5" />
    </>
  ),
  sparkle: (
    <>
      <path d="M12 3.5 13.7 9l5.5 1.7-5.5 1.7L12 18l-1.7-5.6L4.8 10.7 10.3 9 12 3.5Z" />
    </>
  ),

  /* --- Controls: export & alerts --- */
  download: (
    <>
      <path d="M12 4v11.5" />
      <path d="m7.5 11 4.5 4.5L16.5 11" />
      <path d="M5 19h14" />
    </>
  ),
  alert: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V13" />
      <path d="M12 16.2v.3" />
    </>
  ),
};

export default function Icon({ name }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
      {PATHS[name]}
    </svg>
  );
}
