// Single direct Resend transport used by BloxStar transactional email.
// The API key is server-only and must never be exposed through VITE_ variables.
export type ResendPayload = {
  from: string;
  to: string[];
  reply_to?: string;
  subject: string;
  html?: string;
  text?: string;
};

export type ResendResult = { ok: true } | { ok: false; status: number; detail: string };

export function resendConfigured(): boolean {
  const key = (process.env["RESEND_API_KEY"] || "").trim();
  return key.startsWith("re_");
}

export async function sendResendEmail(payload: ResendPayload): Promise<ResendResult> {
  const apiKey = (process.env["RESEND_API_KEY"] || "").trim();
  if (!apiKey || !apiKey.startsWith("re_")) {
    return { ok: false, status: 500, detail: "RESEND_API_KEY is not configured correctly" };
  }
  let res: Response;
  try {
    res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    console.error("[resend] request failed", error instanceof Error ? error.name : "unknown");
    return { ok: false, status: 502, detail: "network_error" };
  }
  if (!res.ok) {
    const detail = await res.text();
    console.error(`[resend] send failed [${res.status}]: ${detail}`);
    return { ok: false, status: res.status, detail };
  }
  return { ok: true };
}
