import { NextResponse } from "next/server";import { REEDITX_RENDER_FUNCTION_URL, supabaseHeaders } from "@/lib/supabase-config";
export const runtime="nodejs";export const dynamic="force-dynamic";
export async function GET(request:Request,ctx:{params:Promise<{jobId:string}>}){
 const {jobId}=await ctx.params;if(!/^[0-9a-f-]{36}$/i.test(jobId))return NextResponse.json({error:"Invalid render job ID."},{status:400});
 const token=request.headers.get("x-reeditx-job-token")||new URL(request.url).searchParams.get("token")||"";if(!token)return NextResponse.json({error:"A render job token is required."},{status:401});
 try{const r=await fetch(REEDITX_RENDER_FUNCTION_URL+"?action=download&id="+encodeURIComponent(jobId),{headers:supabaseHeaders({"X-ReEditX-Job-Token":token}),cache:"no-store",signal:AbortSignal.timeout(10000)});const d=await r.json().catch(()=>({}));if(!r.ok||typeof d.downloadUrl!=="string")return NextResponse.json(d,{status:r.status||502,headers:{"Cache-Control":"no-store"}});return NextResponse.redirect(d.downloadUrl,{status:302,headers:{"Cache-Control":"no-store"}});}catch{return NextResponse.json({error:"The Supabase render download could not be reached."},{status:502});}
}
