-- Auto-Sync Triggers for Employee Participants
-- Ensures employee_tiktok_participants and employee_instagram_participants 
-- stay in sync with user_*_usernames tables

BEGIN;

-- =====================================================
-- TIKTOK TRIGGERS
-- =====================================================

-- Function: Auto-insert to employee_tiktok_participants when username added
CREATE OR REPLACE FUNCTION fn_sync_tiktok_username_insert()
RETURNS TRIGGER AS $$
BEGIN
  -- Insert to all campaigns for this user
  INSERT INTO public.employee_tiktok_participants (employee_id, campaign_id, tiktok_username, created_at)
  SELECT 
    NEW.user_id,
    c.id,
    NEW.tiktok_username,
    NOW()
  FROM public.campaigns c
  ON CONFLICT (employee_id, campaign_id, tiktok_username) DO NOTHING;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger: After INSERT on user_tiktok_usernames
DROP TRIGGER IF EXISTS trg_sync_tiktok_username_insert ON public.user_tiktok_usernames;
CREATE TRIGGER trg_sync_tiktok_username_insert
  AFTER INSERT ON public.user_tiktok_usernames
  FOR EACH ROW
  EXECUTE FUNCTION fn_sync_tiktok_username_insert();

-- Function: Auto-delete from employee_tiktok_participants when username removed
CREATE OR REPLACE FUNCTION fn_sync_tiktok_username_delete()
RETURNS TRIGGER AS $$
BEGIN
  -- Delete from employee_tiktok_participants
  DELETE FROM public.employee_tiktok_participants
  WHERE employee_id = OLD.user_id 
    AND tiktok_username = OLD.tiktok_username;
  
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

-- Trigger: After DELETE on user_tiktok_usernames
DROP TRIGGER IF EXISTS trg_sync_tiktok_username_delete ON public.user_tiktok_usernames;
CREATE TRIGGER trg_sync_tiktok_username_delete
  AFTER DELETE ON public.user_tiktok_usernames
  FOR EACH ROW
  EXECUTE FUNCTION fn_sync_tiktok_username_delete();

-- Function: Auto-update employee_tiktok_participants when username changed
CREATE OR REPLACE FUNCTION fn_sync_tiktok_username_update()
RETURNS TRIGGER AS $$
BEGIN
  -- If username changed, update all references
  IF OLD.tiktok_username != NEW.tiktok_username THEN
    UPDATE public.employee_tiktok_participants
    SET tiktok_username = NEW.tiktok_username
    WHERE employee_id = NEW.user_id 
      AND tiktok_username = OLD.tiktok_username;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger: After UPDATE on user_tiktok_usernames
DROP TRIGGER IF EXISTS trg_sync_tiktok_username_update ON public.user_tiktok_usernames;
CREATE TRIGGER trg_sync_tiktok_username_update
  AFTER UPDATE ON public.user_tiktok_usernames
  FOR EACH ROW
  EXECUTE FUNCTION fn_sync_tiktok_username_update();

-- =====================================================
-- INSTAGRAM TRIGGERS
-- =====================================================

-- Function: Auto-insert to employee_instagram_participants when username added
CREATE OR REPLACE FUNCTION fn_sync_instagram_username_insert()
RETURNS TRIGGER AS $$
BEGIN
  -- Insert to all campaigns for this user
  INSERT INTO public.employee_instagram_participants (employee_id, campaign_id, instagram_username, created_at)
  SELECT 
    NEW.user_id,
    c.id,
    NEW.instagram_username,
    NOW()
  FROM public.campaigns c
  ON CONFLICT (employee_id, campaign_id, instagram_username) DO NOTHING;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger: After INSERT on user_instagram_usernames
DROP TRIGGER IF EXISTS trg_sync_instagram_username_insert ON public.user_instagram_usernames;
CREATE TRIGGER trg_sync_instagram_username_insert
  AFTER INSERT ON public.user_instagram_usernames
  FOR EACH ROW
  EXECUTE FUNCTION fn_sync_instagram_username_insert();

-- Function: Auto-delete from employee_instagram_participants when username removed
CREATE OR REPLACE FUNCTION fn_sync_instagram_username_delete()
RETURNS TRIGGER AS $$
BEGIN
  -- Delete from employee_instagram_participants
  DELETE FROM public.employee_instagram_participants
  WHERE employee_id = OLD.user_id 
    AND instagram_username = OLD.instagram_username;
  
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

-- Trigger: After DELETE on user_instagram_usernames
DROP TRIGGER IF EXISTS trg_sync_instagram_username_delete ON public.user_instagram_usernames;
CREATE TRIGGER trg_sync_instagram_username_delete
  AFTER DELETE ON public.user_instagram_usernames
  FOR EACH ROW
  EXECUTE FUNCTION fn_sync_instagram_username_delete();

-- Function: Auto-update employee_instagram_participants when username changed
CREATE OR REPLACE FUNCTION fn_sync_instagram_username_update()
RETURNS TRIGGER AS $$
BEGIN
  -- If username changed, update all references
  IF OLD.instagram_username != NEW.instagram_username THEN
    UPDATE public.employee_instagram_participants
    SET instagram_username = NEW.instagram_username
    WHERE employee_id = NEW.user_id 
      AND instagram_username = OLD.instagram_username;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger: After UPDATE on user_instagram_usernames
DROP TRIGGER IF EXISTS trg_sync_instagram_username_update ON public.user_instagram_usernames;
CREATE TRIGGER trg_sync_instagram_username_update
  AFTER UPDATE ON public.user_instagram_usernames
  FOR EACH ROW
  EXECUTE FUNCTION fn_sync_instagram_username_update();

-- =====================================================
-- CAMPAIGN TRIGGERS (Optional)
-- =====================================================

-- Function: Auto-populate new campaign with existing usernames
CREATE OR REPLACE FUNCTION fn_sync_new_campaign_participants()
RETURNS TRIGGER AS $$
BEGIN
  -- Populate TikTok participants for new campaign
  INSERT INTO public.employee_tiktok_participants (employee_id, campaign_id, tiktok_username, created_at)
  SELECT 
    utu.user_id,
    NEW.id,
    utu.tiktok_username,
    NOW()
  FROM public.user_tiktok_usernames utu
  ON CONFLICT (employee_id, campaign_id, tiktok_username) DO NOTHING;
  
  -- Populate Instagram participants for new campaign
  INSERT INTO public.employee_instagram_participants (employee_id, campaign_id, instagram_username, created_at)
  SELECT 
    uiu.user_id,
    NEW.id,
    uiu.instagram_username,
    NOW()
  FROM public.user_instagram_usernames uiu
  ON CONFLICT (employee_id, campaign_id, instagram_username) DO NOTHING;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger: After INSERT on campaigns
DROP TRIGGER IF EXISTS trg_sync_new_campaign_participants ON public.campaigns;
CREATE TRIGGER trg_sync_new_campaign_participants
  AFTER INSERT ON public.campaigns
  FOR EACH ROW
  EXECUTE FUNCTION fn_sync_new_campaign_participants();

COMMIT;

-- Verification: Check triggers are created
SELECT 
  trigger_name,
  event_object_table,
  event_manipulation,
  action_statement
FROM information_schema.triggers
WHERE trigger_schema = 'public'
  AND trigger_name LIKE 'trg_sync%'
ORDER BY event_object_table, trigger_name;
