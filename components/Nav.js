import Link from "next/link";
import { useRouter } from "next/router";
import ThemeToggle from "./ThemeToggle";

const LINKS = [
  {
    href: "/",
    label: "Dashboard",
    icon: (
      <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3 11.5 12 4l9 7.5V20a1 1 0 0 1-1 1h-4v-5h-4v5H4a1 1 0 0 1-1-1v-8.5Z" />
      </svg>
    ),
  },
  {
    href: "/map",
    label: "Map",
    icon: (
      <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M9.2 4.3 3.8 6.1a1 1 0 0 0-.7.95v12.1a1 1 0 0 0 1.3.95l4.8-1.6 5.6 1.9 4.4-1.8a1 1 0 0 0 .65-.95V5.55a1 1 0 0 0-1.3-.95l-4.75 1.6-5.6-1.9Z" />
        <path d="M9.2 4.3v13.2M14.8 6.2v13.2" />
      </svg>
    ),
  },
  {
    href: "/reports",
    label: "Reports",
    icon: (
      <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M6.5 3.5h8L19 8v12.5a1 1 0 0 1-1 1H6.5a1 1 0 0 1-1-1v-16a1 1 0 0 1 1-1Z" />
        <path d="M14.2 3.6V8H19" />
        <path d="M9 13.5h6M9 17h4" />
      </svg>
    ),
  },
  {
    href: "/controls",
    label: "Controls",
    icon: (
      <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h0a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v0a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
      </svg>
    ),
  },
];

export default function Nav() {
  const router = useRouter();
  return (
    <header className="topnav">
      <div className="topnav-inner">
        <Link href="/" className="topnav-brand">
          <span className="brand-mark" aria-hidden="true">ត</span>
          <span>តាមដាន</span>
        </Link>
        <div className="topnav-actions">
          <nav className="topnav-links">
            {LINKS.map((item) => {
              const active =
                item.href === "/"
                  ? router.pathname === "/"
                  : router.pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`topnav-link${active ? " active" : ""}`}
                  title={item.label}
                >
                  {item.icon}
                  <span className="topnav-label">{item.label}</span>
                </Link>
              );
            })}
          </nav>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
