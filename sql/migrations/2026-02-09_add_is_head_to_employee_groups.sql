BEGIN;

-- Add is_head column to employee_groups to designate group leaders
ALTER TABLE public.employee_groups 
ADD COLUMN IF NOT EXISTS is_head BOOLEAN DEFAULT FALSE;

COMMIT;
