import { createFileRoute } from "@tanstack/react-router";
import { cookieValue, SESSION_COOKIE } from "@/lib/auth";
import { jsonResponse, sameOrigin, safeHandler } from "@/lib/http";
import { clientIp, distributedRateLimit } from "@/lib/rate-limit";

const MAX_BYTES=100_000;
const BASE_KEYS=["bs_profiles","bs_profiles_v26","bs_avatar_choice","bs_promo_codes","bs_roblox_user","bs_user"];
function sessionEmail(request:Request):Promise<string|null>{
  const token=cookieValue(request,SESSION_COOKIE); if(!token||!process.env.DATABASE_URL)return Promise.resolve(null);
  return import("@/lib/db").then(({db})=>db()).then(async sql=>{const rows=await sql`SELECT email,expires_at FROM auth_sessions WHERE token=${token} LIMIT 1`;const r=(rows as any[])[0];return r&&new Date(r.expires_at).getTime()>Date.now()?String(r.email).trim().toLowerCase():null}).catch(()=>null);
}
function cleanData(email:string,input:unknown){
  if(!input||typeof input!=="object"||Array.isArray(input))return null;
  const obj=input as Record<string,unknown>, allowed=new Set(BASE_KEYS.concat([`bs_wishlist_${email}`])), out:Record<string,string>={};
  for(const [k,v] of Object.entries(obj)){
    if(!allowed.has(k)||typeof v!=="string"||v.length>20_000)continue;
    out[k]=v;
  }
  const bytes=new TextEncoder().encode(JSON.stringify(out)).byteLength;
  return bytes<=MAX_BYTES?out:null;
}
export const Route=createFileRoute("/api/public/account")({server:{handlers:{
  GET:({request})=>safeHandler(request,"account/get",async()=>{
    if(!sameOrigin(request))return jsonResponse(request,{ok:false,error:"forbidden"},403);
    const email=await sessionEmail(request); if(!email)return jsonResponse(request,{ok:false,error:"unauthorized"},401);
    const {db}=await import("@/lib/db"); const sql=db();
    if(!(await distributedRateLimit(sql,`account:get:${clientIp(request)}:${email}`,120,60000)))return jsonResponse(request,{ok:false,error:"rate_limited"},429);
    const rows=await sql`SELECT data FROM user_account_data WHERE email=${email} LIMIT 1` as Array<{data:Record<string,string>}>;
    return jsonResponse(request,{ok:true,data:rows[0]?.data||{}});
  }),
  POST:({request})=>safeHandler(request,"account/save",async()=>{
    if(!sameOrigin(request))return jsonResponse(request,{ok:false,error:"forbidden"},403);
    const email=await sessionEmail(request); if(!email)return jsonResponse(request,{ok:false,error:"unauthorized"},401);
    const {db}=await import("@/lib/db"); const sql=db();
    if(!(await distributedRateLimit(sql,`account:save:${clientIp(request)}:${email}`,60,60000)))return jsonResponse(request,{ok:false,error:"rate_limited"},429);
    let body:Record<string,unknown>;try{body=await request.json() as Record<string,unknown>}catch{return jsonResponse(request,{ok:false,error:"invalid"},400)}
    if(String(body.action||"")!=="save")return jsonResponse(request,{ok:false,error:"unknown_action"},400);
    const data=cleanData(email,body.data); if(!data)return jsonResponse(request,{ok:false,error:"invalid_data"},400);
    await sql`INSERT INTO user_account_data(email,data) VALUES(${email},${JSON.stringify(data)}::jsonb) ON CONFLICT(email) DO UPDATE SET data=EXCLUDED.data,updated_at=now()`;
    return jsonResponse(request,{ok:true});
  })
}}});
