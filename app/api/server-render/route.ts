import { NextResponse } from "next/server";
import { REEDITX_RENDER_FUNCTION_URL, supabaseHeaders } from "@/lib/supabase-config";
export const runtime="nodejs"; export const dynamic="force-dynamic"; export const maxDuration=3600;
export async function POST(request:Request){
 const type=request.headers.get("content-type");if(!type?.toLowerCase().startsWith("multipart/form-data;"))return NextResponse.json({error:"Upload video and optional soundtrack as multipart form data."},{status:415});
 if(!request.body)return NextResponse.json({error:"The media upload body is empty."},{status:400});
 try{const r=await fetch(REEDITX_RENDER_FUNCTION_URL,{method:"POST",headers:supabaseHeaders({"Content-Type":type}),body:request.body,duplex:"half",signal:AbortSignal.timeout(60*60*1000)} as RequestInit & {duplex:"half"});return new Response(r.body,{status:r.status,headers:{"Content-Type":r.headers.get("content-type")||"application/json","Cache-Control":"no-store"}});}catch{return NextResponse.json({error:"The Supabase render API could not be reached."},{status:502});}
}
