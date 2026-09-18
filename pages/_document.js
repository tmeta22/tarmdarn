import { Html, Head, Main, NextScript } from "next/document";

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
        <meta
          name="theme-color"
          media="(prefers-color-scheme: light)"
          content="#f7f8fa"
        />
        <meta
          name="theme-color"
          media="(prefers-color-scheme: dark)"
          content="#0b0f17"
        />
        <meta
          name="description"
          content="តាមដាន — watches Google Maps place_ids and logs the moment a name changes."
        />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
