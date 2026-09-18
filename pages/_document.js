import { Html, Head, Main, NextScript } from "next/document";

/**
 * Applies the saved colour-scheme preference before first paint so the
 * page never flashes the wrong theme. Runs inline, in <head>, ahead of
 * any rendering — keep it dependency-free and ES5-safe.
 */
const THEME_BOOTSTRAP = `(function(){try{
var pref=localStorage.getItem("taamdan-theme")||"system";
var dark=pref==="dark"||(pref==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);
var root=document.documentElement;
root.dataset.theme=dark?"dark":"light";
root.dataset.themePref=pref;
var meta=document.querySelector('meta[name="theme-color"]');
if(meta)meta.setAttribute("content",dark?"#0b0f17":"#f7f8fa");
}catch(e){}})();`;

export default function Document() {
  return (
    <Html lang="km">
      <Head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="true" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Noto+Sans+Khmer:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
        <meta name="theme-color" content="#f7f8fa" />
        <meta
          name="description"
          content="តាមដាន — watches Google Maps place_ids and logs the moment a name changes."
        />
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
