-- Enforce a username in one campaign can only be assigned to one employee
create unique index if not exists employee_participants_unique_campaign_username
  on employee_participants(campaign_id, tiktok_username);
