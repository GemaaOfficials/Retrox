import type { FilterPreset } from "@/lib/project-db";

export interface RetroxLookRecipe {
  brightness: number;
  contrast: number;
  saturation: number;
  red: number;
  green: number;
  blue: number;
  vignette: number;
  grain: number;
  monochrome: boolean;
}

export interface RetroxStyleProfile {
  id: FilterPreset;
  name: string;
  description: string;
  engineVersion: number;
  recipe: RetroxLookRecipe;
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://zyoyxjagyglngrlbnkwb.supabase.co";
// This is the project's public anon key. It grants only the read-only recipe policy below; never put service-role keys in client code.
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXAiLCJyZWYiOiJ6eW95eGphZ3lnbG5ncmxibmt3YiIsInJvbGUiOiJhbm9uIiwiaWF0IjoxNzkyNTQ3MTY5LCJleHAiOjIxMDgxMjMxNjl9.TIqVaDVQLyrQaNR_9t6GC3w7KsakGzCkixbjezIuI8";

export const LOCAL_RETROX_PROFILES: Record<FilterPreset, RetroxStyleProfile> = {
  none: {
    id: "none", name: "Original", description: "Keep the source colors clean.", engineVersion: 1,
    recipe: { brightness: 0, contrast: 1, saturation: 1, red: 0, green: 0, blue: 0, vignette: 0, grain: 0, monochrome: false },
  },
  cinema: {
    id: "cinema", name: "Cinema", description: "Deep film contrast with rich color.", engineVersion: 1,
    recipe: { brightness: -0.04, contrast: 1.12, saturation: 1.16, red: 0.015, green: 0, blue: -0.015, vignette: 0.25, grain: 0, monochrome: false },
  },
  mono: {
    id: "mono", name: "Mono", description: "High-contrast black and white.", engineVersion: 1,
    recipe: { brightness: 0, contrast: 1.12, saturation: 0, red: 0, green: 0, blue: 0, vignette: 0.15, grain: 0, monochrome: true },
  },
  dream: {
    id: "dream", name: "Dream", description: "Soft pastel brightness and gentle color.", engineVersion: 1,
    recipe: { brightness: 0.045, contrast: 0.96, saturation: 1.2, red: 0.025, green: 0.005, blue: -0.015, vignette: 0, grain: 0, monochrome: false },
  },
  neon: {
    id: "neon", name: "Neon", description: "Bold saturated color with punchy contrast.", engineVersion: 1,
    recipe: { brightness: 0.005, contrast: 1.16, saturation: 1.55, red: 0.025, green: -0.005, blue: 0.035, vignette: 0.15, grain: 0, monochrome: false },
  },
  "cultural-aura": {
    id: "cultural-aura", name: "Cultural Aura", description: "Warm golden highlights, rich shadows and a subtle film finish.", engineVersion: 1,
    recipe: { brightness: 0.01, contrast: 1.1, saturation: 1.24, red: 0.08, green: 0.02, blue: -0.06, vignette: 0.3, grain: 3, monochrome: false },
  },
  lofi: {
    id: "lofi", name: "Lo-fi", description: "Faded warm colors, soft contrast and gentle film grain.", engineVersion: 1,
    recipe: { brightness: 0.035, contrast: 0.91, saturation: 0.76, red: 0.055, green: 0.01, blue: -0.04, vignette: 0.4, grain: 8, monochrome: false },
  },
  vhs: {
    id: "vhs", name: "Retro VHS", description: "Vintage color, visible grain and a nostalgic finish.", engineVersion: 1,
    recipe: { brightness: 0.01, contrast: 1.07, saturation: 1.18, red: -0.01, green: 0.01, blue: 0.035, vignette: 0.2, grain: 12, monochrome: false },
  },
};

const allowedIds = Object.keys(LOCAL_RETROX_PROFILES) as FilterPreset[];
const clamp = (value: unknown, fallback: number, minimum: number, maximum: number) => {
  const number = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.min(maximum, Math.max(minimum, number));
};

function validateRemoteProfile(value: unknown): RetroxStyleProfile | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || !allowedIds.includes(row.id as FilterPreset)) return null;
  const id = row.id as FilterPreset;
  const base = LOCAL_RETROX_PROFILES[id];
  const raw = row.recipe && typeof row.recipe === "object" ? row.recipe as Record<string, unknown> : {};
  return {
    id,
    name: typeof row.name === "string" && row.name.trim() ? row.name.trim().slice(0, 48) : base.name,
    description: typeof row.description === "string" ? row.description.slice(0, 160) : base.description,
    engineVersion: typeof row.engine_version === "number" && Number.isInteger(row.engine_version) ? Math.max(1, row.engine_version) : base.engineVersion,
    recipe: {
      brightness: clamp(raw.brightness, base.recipe.brightness, -0.25, 0.25),
      contrast: clamp(raw.contrast, base.recipe.contrast, 0.5, 1.8),
      saturation: clamp(raw.saturation, base.recipe.saturation, 0, 2),
      red: clamp(raw.red, base.recipe.red, -0.3, 0.3),
      green: clamp(raw.green, base.recipe.green, -0.3, 0.3),
      blue: clamp(raw.blue, base.recipe.blue, -0.3, 0.3),
      vignette: clamp(raw.vignette, base.recipe.vignette, 0, 1),
      grain: clamp(raw.grain, base.recipe.grain, 0, 20),
      monochrome: typeof raw.monochrome === "boolean" ? raw.monochrome : base.recipe.monochrome,
    },
  };
}

export async function loadRetroxProfiles(): Promise<{ profiles: Record<FilterPreset, RetroxStyleProfile>; source: "supabase" | "local" }> {
  const profiles: Record<FilterPreset, RetroxStyleProfile> = { ...LOCAL_RETROX_PROFILES };
  try {
    const url = new URL("/rest/v1/retrox_style_recipes", SUPABASE_URL);
    url.searchParams.set("select", "id,name,description,engine_version,recipe");
    url.searchParams.set("is_published", "eq.true");
    url.searchParams.set("order", "id.asc");
    const response = await fetch(url.toString(), {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: "Bearer " + SUPABASE_ANON_KEY },
      cache: "no-store",
      signal: AbortSignal.timeout(4500),
    });
    if (!response.ok) throw new Error("Retrox recipe catalog unavailable.");
    const rows: unknown = await response.json();
    if (!Array.isArray(rows) || rows.length === 0) return { profiles, source: "local" };
    for (const row of rows) {
      const profile = validateRemoteProfile(row);
      if (profile) profiles[profile.id] = profile;
    }
    return { profiles, source: "supabase" };
  } catch {
    return { profiles, source: "local" };
  }
}
