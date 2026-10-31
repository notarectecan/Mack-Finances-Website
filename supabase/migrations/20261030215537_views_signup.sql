-- Views run with the CALLER's permissions (security_invoker) so RLS still applies.
create view public.v_goal_progress with (security_invoker = true) as
select g.*,
  g.starting_amount + coalesce((select sum(t.amount) from public.transactions t
     where t.goal_id = g.id and t.txn_type = 'goal_contribution'), 0) as saved_amount
from public.goals g;

create view public.v_monthly_category_totals with (security_invoker = true) as
select t.user_id,
  date_trunc('month', t.txn_date)::date as month,
  t.txn_type, t.category_id, c.name as category_name,
  t.income_source_id, s.name as income_source_name,
  sum(t.amount)::numeric(14,2) as total,
  count(*) as txn_count
from public.transactions t
left join public.categories c on c.id = t.category_id
left join public.income_sources s on s.id = t.income_source_id
group by 1,2,3,4,5,6,7;

grant select on public.v_goal_progress, public.v_monthly_category_totals to authenticated;

-- New user bootstrap: profile + default categories, income sources, accounts
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare uid uuid := new.id;
begin
  insert into public.profiles (id, display_name)
  values (uid, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)));

  insert into public.categories (user_id, name, kind, icon, color, sort_order) values
    (uid,'Rent/Housing','expense','home','#0F5C3F',1),
    (uid,'Groceries','expense','shopping-basket','#2E8B62',2),
    (uid,'Dining Out','expense','utensils','#C9A227',3),
    (uid,'Transport','expense','car','#4A7C6A',4),
    (uid,'Utilities & Bills','expense','zap','#6B8F71',5),
    (uid,'Subscriptions','expense','repeat','#8FAF9A',6),
    (uid,'Health & Fitness','expense','heart-pulse','#3D6B57',7),
    (uid,'Shopping','expense','shopping-bag','#B08D2A',8),
    (uid,'Entertainment','expense','film','#A3B8A8',9),
    (uid,'Business & Misc','expense','briefcase','#5E655F',10),
    (uid,'Travel','expense','plane','#D4AF37',11),
    (uid,'Other','expense','circle','#9AA19B',12),
    (uid,'Owner''s Draw','income','briefcase','#0F5C3F',1),
    (uid,'Side Income','income','laptop','#2E8B62',2),
    (uid,'Dividends & Interest','income','trending-up','#C9A227',3),
    (uid,'Other Income','income','circle','#9AA19B',4);

  insert into public.income_sources (user_id, name, source_type, expected_monthly) values
    (uid,'Owner''s Draw – Business','business_draw',0),
    (uid,'Side Income – Consulting','side_income',0),
    (uid,'Dividends & Interest','passive',0);

  insert into public.accounts (user_id, name, account_type) values
    (uid,'Main Checking','checking'),
    (uid,'High-Yield Savings','savings'),
    (uid,'Credit Card','credit');
  return new;
end; $$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();
