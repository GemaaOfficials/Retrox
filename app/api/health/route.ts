import { NextResponse } from "next/server";export const dynamic="force-dynamic";
export function GET(){return NextResponse.json({name:"ReEditX",status:"ok",version:"1.0.0",mediaProcessing:"supabase-queue-with-ffmpeg-runner",persistence:"IndexedDB + Supabase Postgres/Storage",engine:"deterministic-browser-rules-engine",timestamp:new Date().toISOString()},{headers:{"Cache-Control":"no-store"}});}
