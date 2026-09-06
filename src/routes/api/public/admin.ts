import { createFileRoute } from "@tanstack/react-router";
import { cookieValue, isAdminEmail, SESSION_COOKIE } from "@/lib/auth";
import { jsonResponse, sameOrigin, safeHandler } from "@/lib/http";

type Session = { email: string; admin: boolean } | null;

async function getSession(request: Request): Promise<Session> {
  const token = cookieValue(request, SESSION_COOKIE);
  if (!token || !process.env.DATABASE_URL) return null;
  const { db } = await import("@/lib/db");
  const sql = db();
  const rows = (await sql`SELECT email, expires_at FROM auth_sessions WHERE token=${token} LIMIT 1`) as Array<{email:string;expires_at:string}>;
  const row = rows[0];
  if (!row || new Date(row.expires_at).getTime() <= Date.now()) return null;
  const email = row.email.toLowerCase();
  if (isAdminEmail(email)) return { email, admin: true };
  const staff = (await sql`SELECT status FROM admin_staff WHERE lower(email)=${email} LIMIT 1`) as Array<{status:string}>;
  return { email, admin: staff[0]?.status === "active" };
}

type Role = "owner" | "finance" | "product" | "support" | "moderator";
const ROLE_PERMISSIONS: Record<Role, string[]> = {
  owner: ["all"],
  finance: ["payments", "wallet", "order_status"],
  product: ["products", "promotions"],
  support: ["support", "order_status"],
  moderator: ["support", "order_status"],
};

async function requireAdmin(request: Request) {
  if (!sameOrigin(request)) return { error: jsonResponse(request, {ok:false,error:"forbidden"}, 403) };
  const token = cookieValue(request, SESSION_COOKIE);
  if (!token || !process.env.DATABASE_URL) return { error: jsonResponse(request, {ok:false,error:"forbidden"}, 403) };
  const { db } = await import("@/lib/db"); const sql = db();
  const rows = await sql`SELECT email, expires_at FROM auth_sessions WHERE token=${token} LIMIT 1` as Array<{email:string;expires_at:string}>;
  const row=rows[0];
  if(!row || new Date(row.expires_at).getTime()<=Date.now()) return { error: jsonResponse(request,{ok:false,error:"forbidden"},403) };
  const email=row.email.toLowerCase();
  if(isAdminEmail(email)) return { session:{email,admin:true,role:"owner" as Role,permissions:["all"]} };
  const staff=await sql`SELECT role,status,permissions FROM admin_staff WHERE lower(email)=${email} LIMIT 1` as Array<{role:string;status:string;permissions:unknown}>;
  const st=staff[0];
  if(!st || st.status!=="active" || !(st.role in ROLE_PERMISSIONS)) return { error: jsonResponse(request,{ok:false,error:"forbidden"},403) };
  const role=st.role as Role;
  return { session:{email,admin:true,role,permissions:ROLE_PERMISSIONS[role]} };
}

function can(session:{role:Role;permissions:string[]}, permission:string):boolean {
  return session.permissions.includes("all") || session.permissions.includes(permission);
}

const n = (v: unknown) => Number(v ?? 0) || 0;
const orderOut = (o: any) => ({
  id: o.code, code: o.code, email: o.email || "", robloxUser: o.roblox_user || "",
  game: o.game || "", status: o.status, paid: !!o.paid, total:n(o.total),
  subtotal:n(o.subtotal), fee:n(o.fee), items:Array.isArray(o.items)?o.items:[],
  createdAt:o.created_at, data:o.data || {}
});

async function getDashboard(request: Request) {
  const gate = await requireAdmin(request); if (gate.error) return gate.error;
  const { db } = await import("@/lib/db"); const sql = db();
  const orders = await sql`SELECT code,status,paid,email,roblox_user,game,items,subtotal,fee,total,created_at,data FROM orders ORDER BY created_at DESC LIMIT 500`;
  const totals = (await sql`
    SELECT
      COUNT(*)::int AS orders,
      COUNT(*) FILTER (WHERE paid=true)::int AS paid_orders,
      COALESCE(SUM(total) FILTER (WHERE paid=true),0)::numeric AS revenue,
      COUNT(*) FILTER (WHERE status IN ('pending_payment','pending','processing'))::int AS pending
    FROM orders
  `) as Array<{orders:number;paid_orders:number;revenue:string;pending:number}>;
  const customers = await sql`
    SELECT email, COUNT(*)::int orders, COALESCE(SUM(total) FILTER (WHERE paid=true),0)::numeric spend,
           MAX(created_at) last_order
    FROM orders WHERE email IS NOT NULL AND email <> ''
    GROUP BY email ORDER BY spend DESC LIMIT 200
  `;
  const stockRows = await sql`SELECT item_id,qty,updated_at FROM item_stock ORDER BY qty ASC LIMIT 500`;
  const promos = await sql`SELECT code,offer,usage_limit,usage_count,expires_at,enabled,created_at FROM admin_promotions ORDER BY created_at DESC LIMIT 200`;
  const staff = await sql`SELECT email,name,role,status,permissions,created_at,updated_at FROM admin_staff ORDER BY created_at DESC LIMIT 100`;
  const audit = await sql`SELECT id,admin_email,action,resource,details,created_at FROM admin_audit_logs ORDER BY created_at DESC LIMIT 100`;
  const security = await sql`SELECT id,event_type,severity,actor_email,details,created_at FROM admin_security_events ORDER BY created_at DESC LIMIT 100`;
  return jsonResponse(request, {
    ok:true,
    stats:{orders:totals[0]?.orders??0,paidOrders:totals[0]?.paid_orders??0,revenue:n(totals[0]?.revenue),pending:totals[0]?.pending??0,customers:customers.length},
    orders:(orders as any[]).map(orderOut), customers, stock:stockRows, promotions:promos, staff, audit, security
  });
}

async function action(request: Request, body: Record<string,unknown>) {
  const gate = await requireAdmin(request); if (gate.error) return gate.error;
  const { session } = gate;
  const { db } = await import("@/lib/db"); const sql = db();
  const actionName=String(body.action||"");
  const writeAudit=async(resource:string,details:unknown={})=>{
    await sql`INSERT INTO admin_audit_logs(admin_email,action,resource,details) VALUES(${session.email},${actionName},${resource},${JSON.stringify(details)}::jsonb)`;
  };
  if (actionName==="order_status") {
    const code=String(body.code||"").trim(), status=String(body.status||"").trim();
    if(!/^\d{6}$/.test(code) || !["processing","delivered","cancelled","paid"].includes(status)) return jsonResponse(request,{ok:false,error:"invalid"},400);
    if(status==="paid" ? !can(session,"payments") : !can(session,"order_status")) return jsonResponse(request,{ok:false,error:"forbidden"},403);
    if(status==="cancelled") {
      const rows=await sql`UPDATE orders SET status='cancelled',paid=false,updated_at=now() WHERE code=${code} AND status NOT IN ('cancelled','delivered') RETURNING items`;
      if((rows as any[]).length) {
        const items=Array.isArray((rows as any[])[0].items)?(rows as any[])[0].items.map((i:any)=>({id:i.id,q:i.q})):[];
        if(items.length) await sql`SELECT release_stock(${JSON.stringify(items)}::jsonb)`;
      }
    } else {
      await sql`UPDATE orders SET status=${status},paid=${status==="paid"||status==="delivered"},updated_at=now() WHERE code=${code}`;
    }
    await writeAudit(code,{status}); return jsonResponse(request,{ok:true});
  }
  if(actionName==="promotion") {
    if(!can(session,"promotions")) return jsonResponse(request,{ok:false,error:"forbidden"},403);
    const code=String(body.code||"").trim().toUpperCase().slice(0,40), offer=String(body.offer||"").trim().slice(0,200);
    if(!code||!offer) return jsonResponse(request,{ok:false,error:"invalid"},400);
    await sql`INSERT INTO admin_promotions(code,offer,usage_limit,expires_at,enabled) VALUES(${code},${offer},${Math.max(0,Math.floor(n(body.usageLimit)))},${body.expiresAt?String(body.expiresAt):null},true) ON CONFLICT(code) DO UPDATE SET offer=EXCLUDED.offer,usage_limit=EXCLUDED.usage_limit,expires_at=EXCLUDED.expires_at,enabled=true`;
    await writeAudit(code,{offer}); return jsonResponse(request,{ok:true});
  }
  if(actionName==="promotion_toggle") {
    if(!can(session,"promotions")) return jsonResponse(request,{ok:false,error:"forbidden"},403);
    const code=String(body.code||"").trim().toUpperCase();
    await sql`UPDATE admin_promotions SET enabled=NOT enabled WHERE code=${code}`;
    await writeAudit(code); return jsonResponse(request,{ok:true});
  }
  if(actionName==="staff") {
    if(!can(session,"all")) return jsonResponse(request,{ok:false,error:"forbidden"},403);
    const email=String(body.email||"").trim().toLowerCase(), role=String(body.role||"support");
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return jsonResponse(request,{ok:false,error:"invalid_email"},400);
    if(!["owner","finance","product","support","moderator"].includes(role)) return jsonResponse(request,{ok:false,error:"invalid_role"},400);
    const permissions = role==="owner" ? ["all"] : role==="finance" ? ["payments","wallet"] : role==="product" ? ["products"] : ["support"];
    await sql`INSERT INTO admin_staff(email,name,role,status,permissions) VALUES(${email},${String(body.name||"").slice(0,100)},${role},"active",${JSON.stringify(permissions)}::jsonb)
      ON CONFLICT(email) DO UPDATE SET name=EXCLUDED.name,role=EXCLUDED.role,status='active',permissions=EXCLUDED.permissions,updated_at=now()`;
    await writeAudit(email,{role}); return jsonResponse(request,{ok:true});
  }
  if(actionName==="staff_disable") {
    if(!can(session,"all")) return jsonResponse(request,{ok:false,error:"forbidden"},403);
    const email=String(body.email||"").trim().toLowerCase();
    if(isAdminEmail(email)) return jsonResponse(request,{ok:false,error:"protected_admin"},409);
    await sql`UPDATE admin_staff SET status='disabled',updated_at=now() WHERE lower(email)=${email}`;
    await writeAudit(email); return jsonResponse(request,{ok:true});
  }
  return jsonResponse(request,{ok:false,error:"unknown_action"},400);
}

export const Route=createFileRoute("/api/public/admin")({
  server:{handlers:{
    GET:({request})=>safeHandler(request,"admin/dashboard",()=>getDashboard(request)),
    POST:async({request})=>safeHandler(request,"admin/action",async()=>{let body:Record<string,unknown>;try{body=await request.json()}catch{return jsonResponse(request,{ok:false,error:"invalid"},400)}return action(request,body);})
  }}
});
