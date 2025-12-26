-- Daily/weekly/monthly series for a subset of usernames within a date window
create or replace function campaign_series_usernames(
  start_date date,
  end_date date,
  usernames text[],
  p_interval text default 'daily'
)
returns table (
  bucket_date date,
  views bigint,
  likes bigint,
  comments bigint,
  shares bigint,
  saves bigint
) language sql stable as $$
  with base as (
    select
      case
        when lower(p_interval) = 'monthly' then date_trunc('month', t.post_date)::date
        when lower(p_interval) = 'weekly' then date_trunc('week', t.post_date)::date
        else t.post_date
      end as bucket_date,
      coalesce(t.play_count,0)::bigint as views,
      coalesce(t.digg_count,0)::bigint as likes,
      coalesce(t.comment_count,0)::bigint as comments,
      coalesce(t.share_count,0)::bigint as shares,
      coalesce(t.save_count,0)::bigint as saves
    from tiktok_posts_daily t
    where t.post_date >= start_date
      and t.post_date <= end_date
      and t.username = any(usernames)
  )
  select bucket_date,
         sum(views) as views,
         sum(likes) as likes,
         sum(comments) as comments,
         sum(shares) as shares,
         sum(saves) as saves
  from base
  group by bucket_date
  order by bucket_date asc;
$$;
