-- Fix: 'Load demo data' failed with goals_one_primary_per_user when the user already had a primary goal.
-- Seeder now reuses existing goals by name, never adds a second primary goal, keeps the user's name,
-- and skips snapshots/holdings that already exist.
create or replace function public.seed_demo_data() returns text
language plpgsql security invoker set search_path = '' as $$
declare
  uid uuid := auth.uid();
  today date := public.user_today();
  m int; mstart date; d date;
  c record;
  g_house uuid; g_emerg uuid; g_japan uuid; g_car uuid; g_wed uuid;
  s_draw uuid; s_side uuid; s_div uuid;
  a_chk uuid;
  has_primary boolean;
  cat jsonb := '{}'::jsonb;
  spend jsonb := '{"Rent/Housing":1650,"Groceries":470,"Dining Out":260,"Transport":245,"Utilities & Bills":205,"Subscriptions":92,"Health & Fitness":95,"Shopping":240,"Entertainment":150,"Business & Misc":190,"Travel":150}';
  budget jsonb := '{"Rent/Housing":1650,"Groceries":500,"Dining Out":300,"Transport":280,"Utilities & Bills":220,"Subscriptions":90,"Health & Fitness":120,"Shopping":250,"Entertainment":180,"Business & Misc":250,"Travel":300}';
  wiggle numeric;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if exists (select 1 from public.transactions where user_id = uid) then
    return 'skipped: account already has transactions';
  end if;
  for c in select id, name from public.categories where user_id = uid loop
    cat := cat || jsonb_build_object(c.name, c.id);
  end loop;
  select id into s_draw from public.income_sources where user_id = uid and source_type = 'business_draw' limit 1;
  select id into s_side from public.income_sources where user_id = uid and source_type = 'side_income' limit 1;
  select id into s_div  from public.income_sources where user_id = uid and source_type = 'passive' limit 1;
  select id into a_chk  from public.accounts where user_id = uid and account_type = 'checking' limit 1;
  update public.income_sources set expected_monthly = 5500 where id = s_draw;
  update public.income_sources set expected_monthly = 1200 where id = s_side;
  update public.income_sources set expected_monthly = 85   where id = s_div;
  update public.profiles set onboarded = true,
    display_name = case when coalesce(display_name,'') = '' then 'Alex' else display_name end,
    birth_year = coalesce(birth_year, 1994)
  where id = uid;

  select exists (select 1 from public.goals where user_id = uid and is_primary) into has_primary;

  -- reuse a goal the user already has (same name, case-insensitive); otherwise create it
  select id into g_house from public.goals where user_id = uid and lower(name) = 'house deposit' order by created_at limit 1;
  if g_house is null then
    insert into public.goals (name, icon, target_amount, starting_amount, monthly_contribution, target_date, is_primary, sort_order)
      values ('House Deposit','home',60000,21050,1100,'2028-12-01', not has_primary, 1) returning id into g_house;
  end if;
  select id into g_emerg from public.goals where user_id = uid and lower(name) = 'emergency fund' order by created_at limit 1;
  if g_emerg is null then
    insert into public.goals (name, icon, target_amount, starting_amount, monthly_contribution, target_date, sort_order)
      values ('Emergency Fund','shield',15000,7800,300,'2027-06-01',2) returning id into g_emerg;
  end if;
  select id into g_japan from public.goals where user_id = uid and lower(name) = 'japan trip' order by created_at limit 1;
  if g_japan is null then
    insert into public.goals (name, icon, target_amount, starting_amount, monthly_contribution, target_date, sort_order)
      values ('Japan Trip','plane',5000,150,250,'2027-09-01',3) returning id into g_japan;
  end if;
  select id into g_car from public.goals where user_id = uid and lower(name) = 'new car fund' order by created_at limit 1;
  if g_car is null then
    insert into public.goals (name, icon, target_amount, starting_amount, monthly_contribution, target_date, sort_order)
      values ('New Car Fund','car',12000,1400,200,'2029-06-01',4) returning id into g_car;
  end if;
  select id into g_wed from public.goals where user_id = uid and lower(name) = 'wedding fund' order by created_at limit 1;
  if g_wed is null then
    insert into public.goals (name, icon, target_amount, starting_amount, monthly_contribution, target_date, sort_order)
      values ('Wedding Fund','gem',20000,0,150,'2030-06-01',5) returning id into g_wed;
  end if;

  for m in 0..11 loop
    mstart := (date_trunc('month', today) - make_interval(months => 11 - m))::date;
    wiggle := ((m * 37) % 9 - 4)::numeric;
    insert into public.transactions (txn_date, description, amount, txn_type, category_id, income_source_id, account_id) values
      (mstart + 13, 'Owner''s Draw – Business', 2750, 'income', (cat->>'Owner''s Draw')::uuid, s_draw, a_chk),
      (mstart + 27, 'Owner''s Draw – Business', 2750, 'income', (cat->>'Owner''s Draw')::uuid, s_draw, a_chk),
      (mstart + 9,  'Consulting invoice', 600 + wiggle * 15, 'income', (cat->>'Side Income')::uuid, s_side, a_chk),
      (mstart + 25, 'Consulting invoice', 600 - wiggle * 10, 'income', (cat->>'Side Income')::uuid, s_side, a_chk),
      (mstart + 27, 'Dividends & interest', 85, 'income', (cat->>'Dividends & Interest')::uuid, s_div, a_chk);
    for c in select key, value::numeric as v from jsonb_each_text(spend) loop
      d := mstart + ((length(c.key) * 3 + m) % 26);
      insert into public.transactions (txn_date, description, amount, txn_type, category_id, account_id)
      values (d, c.key, round(c.v * (1 + wiggle / 100.0), 2), 'expense', (cat->>c.key)::uuid, a_chk);
      insert into public.budgets (category_id, month, amount)
      values ((cat->>c.key)::uuid, mstart, (budget->>c.key)::numeric) on conflict do nothing;
    end loop;
    insert into public.transactions (txn_date, description, amount, txn_type, goal_id, account_id) values
      (mstart + 14, 'House Deposit contribution', 550, 'goal_contribution', g_house, a_chk),
      (mstart + 24, 'House Deposit contribution', 550, 'goal_contribution', g_house, a_chk),
      (mstart + 14, 'Emergency Fund contribution', 300, 'goal_contribution', g_emerg, a_chk),
      (mstart + 14, 'Japan Trip contribution', 167, 'goal_contribution', g_japan, a_chk),
      (mstart + 14, 'New Car Fund contribution', 200, 'goal_contribution', g_car, a_chk),
      (mstart + 14, 'Wedding Fund contribution', 100, 'goal_contribution', g_wed, a_chk),
      (mstart + 19, 'ETF purchase', 900, 'investment', null, a_chk);
    insert into public.net_worth_snapshots (snapshot_date, assets, liabilities)
    values ((mstart + interval '1 month' - interval '1 day')::date, 74000 + m * 2650, 1200)
    on conflict (user_id, snapshot_date) do nothing;
  end loop;
  if not exists (select 1 from public.holdings where user_id = uid) then
    insert into public.holdings (name, asset_type, current_value, monthly_contribution, value_as_of) values
      ('Global Index Fund ETF','index_fund',48200,900,today),
      ('Retirement Account (401k)','retirement',31500,0,today),
      ('Individual Stocks','stocks',9800,0,today),
      ('Crypto','crypto',3400,0,today);
  end if;
  return 'seeded';
end; $$;
revoke execute on function public.seed_demo_data() from public, anon;
grant execute on function public.seed_demo_data() to authenticated;
