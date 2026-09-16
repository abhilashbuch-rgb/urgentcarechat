import { redirect } from "next/navigation";

// /staff/clinical-ai — an alias, kept because the URL appears in
// internal documents and somebody will type it.
//
// IT REDIRECTS RATHER THAN RENDERING, and the destination is called
// Protocols. What the feature does is rank passages of the clinic's own
// documents against the words you typed and show them verbatim with
// their source. That is a good search box and it is not artificial
// intelligence, and a nav label promising the second while delivering
// the first is a promise broken to a clinician — who notices in one
// query and trusts the rest of the product less afterwards.
//
// See lib/staff/protocols.ts: there is no model in the path and no
// column anywhere for a generated answer.
//
// POINTS AT /staff/learning#protocols, NOT A STANDALONE /staff/protocols
// PAGE ANYMORE — the two were folded into one door (see the header of
// app/staff/learning/page.tsx). The fragment targets the collapsed
// <details id="protocols"> there; every evergreen browser opens a
// <details> to reveal a fragment target inside it, so this still lands
// someone on an expanded protocol search, not a page that no longer
// exists.

export default function ClinicalAiAlias() {
  redirect("/staff/learning#protocols");
}
