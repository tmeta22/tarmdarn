import Link from "next/link";
import { useRouter } from "next/router";

const LINKS = [
  { href: "/", label: "Dashboard" },
  { href: "/controls", label: "Controls" },
];

export default function Nav() {
  const router = useRouter();
  return (
    <header className="topnav">
      <div className="topnav-inner">
        <Link href="/" className="topnav-brand">
          តាមដាន
        </Link>
        <nav className="topnav-links">
          {LINKS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`topnav-link${router.pathname === item.href ? " active" : ""}`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
