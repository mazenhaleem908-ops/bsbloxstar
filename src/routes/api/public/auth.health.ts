import { createFileRoute } from "@tanstack/react-router";
import { requestOrigin } from "@/lib/auth";
import { jsonResponse, preflight } from "@/lib/http";

export const Route = createFileRoute("/api/public/auth/health")({
  server: { handlers: {
    OPTIONS: async ({ request }) => preflight(request),
    GET: async ({ request }) => {
      const resendKey = (process.env["RESEND_API_KEY"] || "").trim();
      const env = {
        DATABASE_URL: !!process.env["DATABASE_URL"],
        RESEND_API_KEY: !!resendKey,
        RESEND_MODE: !resendKey ? "missing" : resendKey.startsWith("re_") ? "direct" : "invalid-key",
        GOOGLE_CLIENT_ID: !!process.env["GOOGLE_CLIENT_ID"],
        GOOGLE_CLIENT_SECRET: !!process.env["GOOGLE_CLIENT_SECRET"],
        MOONPAY_SECRET_KEY: !!process.env["MOONPAY_SECRET_KEY"],
        APP_ORIGIN: process.env["APP_ORIGIN"] || null,
      };
      let dbOk=false, dbError:string|null=null;
      if(env.DATABASE_URL){try{const {db}=await import("@/lib/db");await db()`SELECT 1`;dbOk=true}catch(e){dbError=e instanceof Error?e.message:"unknown"}}
      const googleReady=env.GOOGLE_CLIENT_ID&&env.GOOGLE_CLIENT_SECRET;
      const ok=env.DATABASE_URL&&env.RESEND_API_KEY&&googleReady&&dbOk;
      return jsonResponse(request,{ok,origin:requestOrigin(request),env,database:dbOk,databaseError:dbError,googleReady},ok?200:503);
    },
  }},
});
