import { previewMode } from '../preview/mode';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(
  previewMode ? 'http://127.0.0.1:9' : supabaseUrl,
  previewMode ? 'frontend-preview-no-backend' : supabaseAnonKey,
);
