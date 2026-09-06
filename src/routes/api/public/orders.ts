import { createFileRoute } from "@tanstack/react-router";
import { catalogItem } from "@/lib/catalog";
import { cookieValue, SESSION_COOKIE, isAdminEmail } from "@/lib/auth";
import { jsonResponse, sameOrigin } from "@/lib/http";
import { clientIp, distributedRateLimit } from "@/lib/rate-limit";

const MAX_QTY=25, MAX_TOTAL=5000, CARD_FEE_PCT=0.045, CARD_FEE_MIN=3.99;
const round2=(n:number)=>Math.round(n*100)/100;
const cardFee=(subtotal:number)=>subtotal<=0?0:round2(Math.max(subtotal*CARD_FEE_PCT,CARD_FEE_MIN));
type Line={id:number;n:string;q:number;p:number};
type Session={email:string;admin:boolean}|null;
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json","cache-control":"no-store"}});
const database=async()=> (await import("@/lib/db")).db();
type Sql=Awaited<ReturnType<typeof database>>;

function priceItems(raw:unknown):{items:Line[];subtotal:number;invalid:number[]} {
  const items:Line[]=[]; const invalid:number[]=[];
  if(!Array.isArray(raw)) return {items,subtotal:0,invalid};
  for(const entry of raw){
    const line=(entry??{}) as Record<string,unknown>; const item=catalogItem(line.id);
    if(!item || item.a!==true){ const id=Number(line.id); if(Number.isInteger(id)) invalid.push(id); continue; }
    const q=Math.max(1,Math.min(MAX_QTY,parseInt(String(line.q??1),10)||1));
    const ex=items.find(x=>x.id===item.id); if(ex) ex.q=Math.min(MAX_QTY,ex.q+q); else items.push({id:item.id,n:item.n,q,p:item.p});
  }
  items.sort((a,b)=>a.id-b.id); const subtotal=round2(items.reduce((s,x)=>s+x.p*x.q,0)); return {items,subtotal,invalid};
}
async function sessionFor(request:Request):Promise<Session>{
  const token=cookieValue(request,SESSION_COOKIE); if(!token) return null;
  const sql=await database(); const rows=(await sql`SELECT email,admin,expires_at FROM auth_sessions WHERE token=${token} LIMIT 1`) as Array<{email:string;admin:boolean;expires_at:string}>;
  const r=rows[0]; if(!r||new Date(r.expires_at).getTime()<Date.now()) return null; return {email:r.email.toLowerCase(),admin:isAdminEmail(r.email)};
}
type OrderRow={code:string;intent_id:string|null;status:string;paid:boolean;email:string|null;roblox_user:string|null;game:string|null;items:unknown;subtotal:string|number;fee:string|number;total:string|number;created_at:string;data?:Record<string,unknown>};
const apiOrder=(o:OrderRow)=>({code:o.code,status:o.status,paid:o.paid,email:o.email||"",robloxUser:o.roblox_user||"",game:o.game||"mm2",items:Array.isArray(o.items)?(o.items as Line[]).map(i=>({id:i.id,name:i.n,q:i.q,price:i.p})):[],subtotal:Number(o.subtotal),fee:Number(o.fee),total:Number(o.total),createdAt:o.created_at});
function validIntent(v:string){return /^MP-[0-9]{10,16}-[a-z0-9]{4,10}$/.test(v)&&v.length<=80;}
async function moonpayVerify(intentId:string,expectedTotal:number,expectedEmail:string):Promise<boolean>{
  const key=(process.env["MOONPAY_SECRET_KEY"]||process.env["MOONPAY_API_KEY"]||process.env["MOONPAY_PUBLISHABLE_KEY"]||"").trim();
  const wallet=(process.env["MOONPAY_WALLET_ADDRESS"]||"0x773760ec19d17815288623c330e56C75e0F2feB2").trim().toLowerCase();
  if(!key||!wallet) return false;
  const endpoint=(process.env["MOONPAY_API_BASE"]||"https://api.moonpay.com").replace(/\/$/,"");
  try{
    const r=await fetch(`${endpoint}/v1/transactions/ext/${encodeURIComponent(intentId)}?apiKey=${encodeURIComponent(key)}`,{headers:{accept:"application/json"},cache:"no-store"});
    if(!r.ok)return false;
    const data=await r.json() as Record<string,unknown>;
    const txs=Array.isArray(data)?data:(Array.isArray(data.data)?data.data:[data]);
    return txs.some((tx:any)=>{
      const status=String(tx.status||"").toLowerCase();
      const amount=Number(tx.baseCurrencyAmount);
      const txWallet=String(tx.walletAddress||"").toLowerCase();
      const currency=String(tx.baseCurrency?.code||tx.baseCurrencyCode||"usd").toLowerCase();
      const customer=String(tx.externalCustomerId||"").trim().toLowerCase();
      return status==="completed" && currency==="usd" && Number.isFinite(amount) && amount+0.01>=expectedTotal && txWallet===wallet && customer===expectedEmail.toLowerCase();
    });
  }catch{return false;}
}
async function cleanupExpired(sql:Sql){
  try{await sql`SELECT release_expired_orders()`;}catch{}
}
async function createOrder(request:Request,body:Record<string,unknown>){
  if(!sameOrigin(request))return json({ok:false,error:"forbidden"},403);
  const session=await sessionFor(request); if(!session)return json({ok:false,error:"unauthorized"},401);
  const sql=await database(); if(!(await distributedRateLimit(sql,`order:create:${clientIp(request)}:${session.email}`,12,3600000)))return json({ok:false,error:"rate_limited"},429);
  await cleanupExpired(sql);
  const intentId=String(body.intentId??body.intent_id??"").trim(); if(!validIntent(intentId))return json({ok:false,error:"invalid_intent"},400);
  const priced=priceItems(body.items); if(priced.invalid.length)return json({ok:false,error:"unavailable_item",itemId:priced.invalid[0]},409); if(!priced.items.length)return json({ok:false,error:"empty_cart"},400);
  const fee=cardFee(priced.subtotal), total=round2(priced.subtotal+fee); if(!Number.isFinite(total)||total<=0||total>MAX_TOTAL)return json({ok:false,error:"invalid_total"},400);
  const existing=(await sql`SELECT code,intent_id,status,paid,email,roblox_user,game,items,subtotal,fee,total,created_at,data FROM orders WHERE intent_id=${intentId} LIMIT 1`) as OrderRow[];
  if(existing[0]){const o=existing[0]; if((o.email||"").toLowerCase()!==session.email&&!session.admin)return json({ok:false,error:"forbidden"},403); return json({ok:true,code:o.code,status:o.status,order:apiOrder(o)});}
  // A card order is created only after the server verifies MoonPay's completed transaction.
  if(!(await moonpayVerify(intentId,total,session.email)))return json({ok:false,error:"payment_not_verified"},402);
  const email=session.email; const robloxUser=String(body.user??"").trim().slice(0,60); const game=String(body.game??"mm2").trim().slice(0,30);
  const items=priced.items.map(i=>({id:i.id,n:i.n,q:i.q,p:i.p})); const code=String(100000+Math.floor(Math.random()*900000));
  try{
    await sql`SELECT create_order_atomic(${code},${intentId},${email},${robloxUser},${game},${JSON.stringify(items)}::jsonb,${priced.subtotal},${fee},${total},${JSON.stringify({pay:"Visa / Card (MoonPay)",paymentVerified:true,intentId})}::jsonb)`;
  }catch(error){
    const raced=(await sql`SELECT code,intent_id,status,paid,email,roblox_user,game,items,subtotal,fee,total,created_at,data FROM orders WHERE intent_id=${intentId} LIMIT 1`) as OrderRow[];
    if(raced[0]){const o=raced[0]; if((o.email||"").toLowerCase()!==email&&!session.admin)return json({ok:false,error:"forbidden"},403); return json({ok:true,code:o.code,status:o.status,order:apiOrder(o)});}
    const msg=error instanceof Error?error.message:""; const m=/out_of_stock:(\d+)/.exec(msg); if(m)return json({ok:false,error:"out_of_stock",itemId:Number(m[1])},409);
    console.error("[orders/create] atomic insert failed",error instanceof Error?error.name:"unknown"); return json({ok:false,error:"create_failed"},500);
  }
  const rows=(await sql`SELECT code,intent_id,status,paid,email,roblox_user,game,items,subtotal,fee,total,created_at,data FROM orders WHERE code=${code} LIMIT 1`) as OrderRow[]; const o=rows[0]!; return json({ok:true,code:o.code,status:o.status,order:apiOrder(o)},201);
}
async function transition(request:Request,body:Record<string,unknown>,action:string){
  if(!sameOrigin(request))return json({ok:false,error:"forbidden"},403); const session=await sessionFor(request); if(!session?.admin)return json({ok:false,error:"forbidden"},403);
  const sql=await database(); if(!(await distributedRateLimit(sql,`order:${action}:${clientIp(request)}:${session.email}`,60,60000)))return json({ok:false,error:"rate_limited"},429);
  const code=String(body.code??"").trim(); if(!/^\d{6}$/.test(code))return json({ok:false,error:"invalid"},400);
  if(action==="confirm"){
    const rows=(await sql`UPDATE orders SET status='delivered',paid=true,updated_at=now() WHERE code=${code} AND status IN ('pending_payment','pending','processing','paid') AND COALESCE((data->>'paymentVerified')::boolean,false)=true RETURNING code`) as Array<{code:string}>;
    if(!rows[0]){const r=(await sql`SELECT status FROM orders WHERE code=${code}`) as Array<{status:string}>; if(!r[0])return json({ok:false,error:"not_found"},404); return json({ok:false,error:"payment_not_verified_or_already_processed",status:r[0].status},409);}
    return json({ok:true,code,status:"delivered"});
  }
  const rows=(await sql`UPDATE orders SET status='cancelled',paid=false,updated_at=now() WHERE code=${code} AND status IN ('pending_payment','pending','processing','paid') RETURNING items`) as Array<{items:unknown}>;
  if(!rows[0]){const r=(await sql`SELECT status FROM orders WHERE code=${code}`) as Array<{status:string}>; if(!r[0])return json({ok:false,error:"not_found"},404); return json({ok:false,error:"already_processed",status:r[0].status},409);}
  const items=Array.isArray(rows[0].items)?(rows[0].items as Line[]).map(i=>({id:i.id,q:i.q})):[]; if(items.length)await sql`SELECT release_stock(${JSON.stringify(items)}::jsonb)`;
  return json({ok:true,code,status:"cancelled"});
}
async function mine(request:Request){const session=await sessionFor(request);if(!session)return json({ok:false,error:"unauthorized"},401);const sql=await database();const rows=(await sql`SELECT code,intent_id,status,paid,email,roblox_user,game,items,subtotal,fee,total,created_at,data FROM orders WHERE email=${session.email} ORDER BY created_at DESC LIMIT 200`) as OrderRow[];return json({ok:true,orders:rows.map(apiOrder)});}
async function list(request:Request){const session=await sessionFor(request);if(!session?.admin)return json({ok:false,error:"forbidden"},403);const sql=await database();const rows=(await sql`SELECT code,intent_id,status,paid,email,roblox_user,game,items,subtotal,fee,total,created_at,data FROM orders ORDER BY created_at DESC LIMIT 500`) as OrderRow[];return json({ok:true,orders:rows.map(apiOrder)});}
export const Route=createFileRoute("/api/public/orders")({server:{handlers:{
  GET:async({request})=>{const s=await sessionFor(request);if(!s)return json({orders:[]});return s.admin&&new URL(request.url).searchParams.get("all")==="1"?list(request):mine(request);},
  POST:async({request})=>{let b:Record<string,unknown>;try{b=(await request.json()) as Record<string,unknown>}catch{return json({ok:false,error:"invalid"},400)}const a=String(b.action??"create").toLowerCase();if(a==="create")return createOrder(request,b);if(a==="confirm"||a==="cancel")return transition(request,b,a);if(a==="mine")return mine(request);if(a==="list")return list(request);return json({ok:false,error:"unknown_action"},400);},
  PATCH:async({request})=>{let b:Record<string,unknown>;try{b=(await request.json()) as Record<string,unknown>}catch{return json({ok:false,error:"invalid"},400)}const a=String(b.action??"").toLowerCase();if(a!=="confirm"&&a!=="cancel")return json({ok:false,error:"unknown_action"},400);return transition(request,b,a);}
}}});
