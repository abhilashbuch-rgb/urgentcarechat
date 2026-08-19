import Link from "next/link";
import { notFound } from "next/navigation";
import BrandIcon from "@/app/components/BrandIcon";
import WaitTimeForm from "@/app/components/WaitTimeForm";
import { getWaitByToken } from "@/lib/wait-time";
import { contactMailto, PRODUCT_NAME } from "@/lib/site";
import Wordmark from "@/app/components/Wordmark";

export const metadata = {
  title: `Update wait time — ${PRODUCT_NAME}`,
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function ClinicWaitPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const wait = await getWaitByToken(token);

  if (!wait) notFound();

  return (
    <div className="analytics-page">
      <header className="site-header">
        <div className="brand">
          <BrandIcon />
          <Wordmark />
        </div>
      </header>

      <main className="analytics-main">
        <p className="analytics-eyebrow">Current wait · private link</p>
        <h1 className="analytics-title">{wait.clinicName}</h1>
        <p className="reads-sub">
          Update this whenever it changes — patients coming from
          medicin.io see this number right on your listing. It
          automatically stops showing after 2 hours without an update, so
          there&apos;s no need to clear it at close of day.
        </p>

        <WaitTimeForm token={token} initialWaitMinutes={wait.waitMinutes} />

        <p className="reads-sub" style={{ marginTop: 28 }}>
          Have a live queue or check-in system already? It can push updates
          directly to this same link&apos;s API instead of a person clicking
          buttons —{" "}
          <a href={contactMailto("Wait-time feed integration")}>
            ask us to wire it up
          </a>
          .
        </p>

        <p className="legal-links">
          <Link href="/">Back to medicin.io</Link>
        </p>
      </main>
    </div>
  );
}
