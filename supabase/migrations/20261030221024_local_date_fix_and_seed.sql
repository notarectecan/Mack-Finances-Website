-- txn_date must come from the client's LOCAL calendar date, never the server's UTC clock.
-- (E2E test T09 caught an 11pm Chicago entry landing in the next month via current_date.)
alter table public.transactions alter column txn_date drop default;
alter table public.holdings alter column value_as_of drop default;
alter table public.holdings alter column value_as_of drop not null;
alter table public.profiles add column timezone text not null default 'UTC';

create or replace function public.user_today() returns date
language sql stable security invoker set search_path = '' as $$
  select (now() at time zone coalesce((select timezone from public.profiles where id = auth.uid()), 'UTC'))::date
$$;
grant execute on function public.user_today() to authenticated;

-- "Use demo data": seeds 12 months of history for the CALLING user (security invoker => RLS applies)
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
  update public.profiles set display_name = 'Alex', birth_year = 1994, onboarded = true where id = uid;

  insert into public.goals (name, icon, target_amount, starting_amount, monthly_contribution, target_date, is_primary, sort_order)
    values ('House Deposit','home',60000,21050,1100,'2028-12-01',true,1) returning id into g_house;
  insert into public.goals (name, icon, target_amount, starting_amount, monthly_contribution, target_date, sort_order)
    values ('Emergency Fund','shield',15000,7800,300,'2027-06-01',2) returning id into g_emerg;
  insert into public.goals (name, icon, target_amount, starting_amount, monthly_contribution, target_date, sort_order)
    values ('Japan Trip','plane',5000,150,250,'2027-09-01',3) returning id into g_japan;
  insert into public.goals (name, icon, target_amount, starting_amount, monthly_contribution, target_date, sort_order)
    values ('New Car Fund','car',12000,1400,200,'2029-06-01',4) returning id into g_car;
  insert into public.goals (name, icon, target_amount, starting_amount, monthly_contribution, target_date, sort_order)
    values ('Wedding Fund','gem',20000,0,150,'2030-06-01',5) returning id into g_wed;

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
    values ((mstart + interval '1 month' - interval '1 day')::date, 74000 + m * 2650, 1200);
  end loop;
  insert into public.holdings (name, asset_type, current_value, monthly_contribution, value_as_of) values
    ('Global Index Fund ETF','index_fund',48200,900,today),
    ('Retirement Account (401k)','retirement',31500,0,today),
    ('Individual Stocks','stocks',9800,0,today),
    ('Crypto','crypto',3400,0,today);
  return 'seeded';
end; $$;
revoke execute on function public.seed_demo_data() from public, anon;
grant execute on function public.seed_demo_data() to authenticated;
