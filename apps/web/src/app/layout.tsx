import type { Metadata } from "next";
import "@carbon/styles/css/styles.css";
import "./globals.scss";

export const metadata: Metadata = {
  title: "Marj | İhracat teklif risk çalışma alanı",
  description:
    "Türk ihracatçıların teklif marjını kur, girdi maliyeti ve CBAM belirsizliği altında sınaması için karar desteği.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="tr">
      <body>{children}</body>
    </html>
  );
}
