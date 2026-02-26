-- Prevent NULL from overwriting existing non-NULL values on instagram_posts_daily
-- This trigger fires BEFORE UPDATE and preserves existing taken_at, post_date, caption, code
-- when the new value is NULL but the old value is not.
-- This is a safety net against any code path (fetch-ig, ig-refresh, etc.) that might
-- inadvertently overwrite these fields with NULL during upsert operations.

BEGIN;

CREATE OR REPLACE FUNCTION public.protect_instagram_existing_fields()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Preserve existing taken_at if new value is NULL
  IF NEW.taken_at IS NULL AND OLD.taken_at IS NOT NULL THEN
    NEW.taken_at := OLD.taken_at;
  END IF;

  -- Preserve existing post_date if new value is NULL
  IF NEW.post_date IS NULL AND OLD.post_date IS NOT NULL THEN
    NEW.post_date := OLD.post_date;
  END IF;

  -- Preserve existing caption if new value is NULL or empty
  IF (NEW.caption IS NULL OR NEW.caption = '') AND OLD.caption IS NOT NULL AND OLD.caption != '' THEN
    NEW.caption := OLD.caption;
  END IF;

  -- Preserve existing code if new value is NULL
  IF NEW.code IS NULL AND OLD.code IS NOT NULL THEN
    NEW.code := OLD.code;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_ig_fields ON public.instagram_posts_daily;
CREATE TRIGGER trg_protect_ig_fields
  BEFORE UPDATE ON public.instagram_posts_daily
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_instagram_existing_fields();

COMMIT;
