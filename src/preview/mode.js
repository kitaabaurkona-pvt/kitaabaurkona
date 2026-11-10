// Frontend preview is isolated from production unless credentials are explicitly supplied.
export const previewMode = !import.meta.env.VITE_SUPABASE_URL || !import.meta.env.VITE_SUPABASE_ANON_KEY;
