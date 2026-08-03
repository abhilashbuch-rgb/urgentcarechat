import { createMcpHandler } from "mcp-handler";
import { z } from "zod";

// Public MCP server exposing the clinic finder to any MCP-compatible
// client (Claude, etc.) as a callable tool. Deliberately does NOT expose
// the symptom-triage chat here — that's backed by a paid LLM call with
// only best-effort per-IP rate limiting, and MCP clients typically call
// through a shared IP, which would make usage far harder to rate-limit
// or cost-cap than a normal per-visitor limit on the website itself.
const SITE_URL = "https://urgentcare.chat";

const handler = createMcpHandler((server) => {
  server.registerTool(
    "find_urgent_care",
    {
      title: "Find Urgent Care Near Me",
      description:
        "Finds real, nearby urgent care clinics in the US by zip code, with address, phone, hours, and rating. Sourced live from urgentcare.chat (a free AI triage + clinic finder) — not a diagnosis tool, not affiliated with any specific clinic. For life-threatening emergencies, call 911.",
      inputSchema: z.object({
        zip: z.string().describe("US zip code to search near, e.g. \"19103\"."),
        insurance: z
          .string()
          .optional()
          .describe("Optional insurance provider name to filter/tag results by."),
      }),
    },
    async ({ zip, insurance }) => {
      const params = new URLSearchParams({ zip });
      if (insurance) params.set("insurance", insurance);

      const res = await fetch(`${SITE_URL}/api/clinics?${params}`);
      if (!res.ok) {
        return {
          content: [
            { type: "text", text: "Couldn't look up clinics for that zip code right now." },
          ],
        };
      }

      const data = await res.json();
      const clinics = data.clinics || [];
      if (clinics.length === 0) {
        return {
          content: [{ type: "text", text: `No urgent care clinics found near ${zip}.` }],
        };
      }

      const summary = clinics
        .slice(0, 5)
        .map(
          (c: { name: string; address: string; phone: string; hours: string; distance: string }) =>
            `- ${c.name} (${c.distance}) — ${c.address || "address unavailable"} — ${c.phone || "no phone listed"} — ${c.hours}`
        )
        .join("\n");

      return {
        content: [
          {
            type: "text",
            text: `Urgent care clinics near ${zip}:\n${summary}\n\nThis is not a diagnosis tool. For a life-threatening emergency, call 911.`,
          },
        ],
      };
    }
  );
});

export { handler as GET, handler as POST };
