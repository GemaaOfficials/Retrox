import { NextResponse } from "next/server";export const dynamic="force-dynamic";
export function GET(){return NextResponse.json({name:"ReEditX",status:"ok",version:"1.0.0",mediaProcessing:"on-device-browser-media-recorder",persistence:"IndexedDB on this device",engine:"deterministic-browser-rules-engine",timestamp:new Date().toISOString()},{headers:{"Cache-Control":"no-store"}});}
