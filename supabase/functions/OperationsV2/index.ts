import { createClient } from "jsr:@supabase/supabase-js@2";
import { normalizeRole, OPERATIONAL_ROLES } from "../_shared/contracts.ts";
import { corsHeaders, createRequestId, isOriginAllowed, jsonResponse } from "../_shared/http.ts";
import { optionalString, requiredString, ValidationError } from "../_shared/validation.ts";

const URL=Deno.env.get("SUPABASE_URL")!;
const KEY=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db=createClient(URL,KEY,{auth:{persistSession:false}});
const corsOptions={allowedOriginsEnv:Deno.env.get("ABSEN_ALLOWED_ORIGINS")||"",productionOrigin:"https://absen-sppg.pages.dev",previewSuffix:".absen-sppg.pages.dev",localOrigins:["http://localhost:4173","http://127.0.0.1:4173"]};
type Auth={idUser:string;role:string};

async function authenticate(tokenValue:unknown):Promise<Auth>{
  const token=requiredString(tokenValue,"token",{min:16,max:512});
  const session=await db.from("Sessions").select("ID_User,Type,Expires_At").eq("Token",token).maybeSingle();
  if(session.error||!session.data?.ID_User||String(session.data.Type).toLowerCase()!=="user"||new Date(session.data.Expires_At).getTime()<=Date.now())throw new Error("SESSION_EXPIRED");
  const user=await db.from("Users").select("ID_User,Role,Status_Aktif").eq("ID_User",session.data.ID_User).maybeSingle();
  const active=user.data?.Status_Aktif===true||["TRUE","1"].includes(String(user.data?.Status_Aktif||"").toUpperCase());
  if(user.error||!user.data||!active)throw new Error("ACCOUNT_INACTIVE");
  return{idUser:String(user.data.ID_User),role:normalizeRole(user.data.Role)};
}
function requireOperational(auth:Auth){if(!OPERATIONAL_ROLES.includes(auth.role as typeof OPERATIONAL_ROLES[number]))throw new Error("FORBIDDEN");}
function requireSuperAdmin(auth:Auth){if(auth.role!=="SUPER ADMIN")throw new Error("FORBIDDEN");}

async function route(action:string,body:Record<string,unknown>,auth:Auth){
  if(action==="listFeatureFlags"){
    requireOperational(auth);const r=await db.from("Release_Feature_Flags").select("*").order("Flag_Key");if(r.error)throw r.error;return r.data||[];
  }
  if(action==="setFeatureFlag"){
    requireSuperAdmin(auth);const key=requiredString(body.key,"key",{max:100});const enabled=Boolean(body.enabled);const scope=optionalString(body.scopeSppg,200);const config=typeof body.config==="object"&&body.config?body.config:{};
    const r=await db.from("Release_Feature_Flags").upsert({Flag_Key:key,Enabled:enabled,Scope_SPPG:scope,Config:config,Updated_By:auth.idUser,Updated_At:new Date().toISOString()}).select().maybeSingle();if(r.error)throw r.error;return r.data;
  }
  if(action==="transitionPayroll"){
    requireOperational(auth);const r=await db.rpc("transition_payroll_workflow",{p_slip_id:requiredString(body.slipId,"slipId",{max:200}),p_user_id:requiredString(body.userId,"userId",{max:100}),p_to_status:requiredString(body.toStatus,"toStatus",{max:50}).toUpperCase(),p_actor_id:auth.idUser,p_reason:optionalString(body.reason,2000),p_idempotency_key:optionalString(body.idempotencyKey,200)});if(r.error)throw r.error;return r.data;
  }
  if(action==="listPayrollWorkflow"){
    requireOperational(auth);let q=db.from("Payroll_Workflow_State").select("*").order("Updated_At",{ascending:false}).limit(200);if(body.status)q=q.eq("Status",String(body.status).toUpperCase());const r=await q;if(r.error)throw r.error;return r.data||[];
  }
  if(action==="logComplaintIdentityAccess"){
    requireSuperAdmin(auth);const r=await db.rpc("log_complaint_identity_access",{p_complaint_id:requiredString(body.complaintId,"complaintId",{max:200}),p_actor_id:auth.idUser,p_actor_role:auth.role,p_reason:requiredString(body.reason,"reason",{min:10,max:2000}),p_request_id:optionalString(body.requestId,200)});if(r.error)throw r.error;return{accessId:r.data};
  }
  if(action==="listComplaintPrivacyLog"){
    requireSuperAdmin(auth);const r=await db.from("Complaint_Privacy_Access_Log").select("*").order("Created_At",{ascending:false}).limit(300);if(r.error)throw r.error;return r.data||[];
  }
  if(action==="listUserAccess"){
    requireOperational(auth);let q=db.from("User_SPPG_Access_V2").select("*").order("Created_At",{ascending:false}).limit(500);if(body.userId)q=q.eq("ID_User",String(body.userId));const r=await q;if(r.error)throw r.error;return r.data||[];
  }
  if(action==="grantUserAccess"){
    requireSuperAdmin(auth);const row={ID_User:requiredString(body.userId,"userId",{max:100}),SPPG:requiredString(body.sppg,"sppg",{max:200}),Role_Scope:optionalString(body.roleScope,100),Active:true,Valid_Until:body.validUntil||null,Granted_By:auth.idUser};const r=await db.from("User_SPPG_Access_V2").upsert(row,{onConflict:"ID_User,SPPG,Role_Scope"}).select().maybeSingle();if(r.error)throw r.error;return r.data;
  }
  if(action==="recordUserSecurityEvent"){
    requireOperational(auth);const r=await db.from("User_Security_Events").insert({ID_User:requiredString(body.userId,"userId",{max:100}),Event_Type:requiredString(body.eventType,"eventType",{max:100}),Actor_ID:auth.idUser,Session_ID:optionalString(body.sessionId,200),Device_ID:optionalString(body.deviceId,200),Before_Data:body.beforeData||{},After_Data:body.afterData||{},Reason:optionalString(body.reason,2000)}).select().maybeSingle();if(r.error)throw r.error;return r.data;
  }
  throw new ValidationError("ACTION_NOT_SUPPORTED","action");
}

Deno.serve(async(req)=>{
  const id=createRequestId();const origin=req.headers.get("origin");const headers=corsHeaders(origin,corsOptions);
  if(req.method==="OPTIONS")return new Response(null,{status:isOriginAllowed(origin,corsOptions)?204:403,headers});
  if(req.method!=="POST")return jsonResponse({success:false,code:"METHOD_NOT_ALLOWED",message:"Gunakan POST.",requestId:id},405,headers,id);
  try{const body=await req.json();const auth=await authenticate(body.token);const result=await route(String(body.action||""),body,auth);return jsonResponse({success:true,result,requestId:id},200,headers,id);}catch(error){
    const msg=error instanceof Error?error.message:String(error);let status=500,code="INTERNAL_ERROR",message="Terjadi kesalahan pada server.";
    if(error instanceof ValidationError){status=422;code=error.code;message=error.message;}else if(msg==="SESSION_EXPIRED"){status=401;code=msg;message="Sesi telah berakhir.";}else if(msg==="ACCOUNT_INACTIVE"||msg==="FORBIDDEN"){status=403;code=msg;message="Akses ditolak.";}else if(msg.includes("FINAL_STATE")||msg.includes("IDEMPOTENCY")){status=409;code=msg;message="Status workflow tidak dapat diubah.";}
    console.error(JSON.stringify({requestId:id,code,error:msg}));return jsonResponse({success:false,code,message,requestId:id},status,headers,id);
  }
});
