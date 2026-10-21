export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://zyoyxjagyglngrlbnkwb.supabase.co";
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp5b3l4amFneWdsbmdybGJua3diIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI1NDcxNjksImV4cCI6MjEwODEyMzE2OX0.TIqVaDVQLyrQaNR7_9t6GC3w7KsakGzCkixbjezIuI8";
export const REEDITX_RENDER_FUNCTION_URL = SUPABASE_URL + "/functions/v1/reeditx-render-api";
export function supabaseHeaders(extra:Record<string,string>={}) { return { apikey:SUPABASE_ANON_KEY, Authorization:"Bearer "+SUPABASE_ANON_KEY, ...extra }; }
