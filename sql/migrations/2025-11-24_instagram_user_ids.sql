-- Cache table for mapping IG username -> numeric user_id (pk)
-- Safe to create; used by API routes and edge function
-- Date: 2025-11-24

BEGIN;

CREATE TABLE IF NOT EXISTS public.instagram_user_ids (
  instagram_username TEXT PRIMARY KEY,
  instagram_user_id TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.instagram_user_ids ENABLE ROW LEVEL SECURITY;

COMMIT;
