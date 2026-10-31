-- Mack Finances — core schema
-- Risk controls: RLS on every table (user_id = auth.uid()), money as numeric(12,2), txn_date as DATE,
-- composite FKs so a row can only reference the SAME user's categories/goals/accounts.

create type public.txn_type as enum ('income','expense','transfer','goal_contribution','investment');
create type public.category_kind as enum ('income','expense');
create type public.income_source_type as enum ('business_draw','salary','side_income','passive','other');
create type public.asset_type as enum ('index_fund','retirement','stocks','crypto','cash','property','bonds','other');
create type public.category_origin as enum ('manual','ai');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  currency_code char(3) not null default 'USD',
  theme text not null default 'system' check (theme in ('light','dark','system')),
  month_start_day smallint not null default 1 check (month_start_day between 1 and 28),
  withdrawal_rate numeric(5,2) not null default 4.00 check (withdrawal_rate > 0 and withdrawal_rate <= 20),
  expected_return numeric(5,2) not null default 7.00 check (expected_return between -50 and 50),
  annual_expenses_override numeric(12,2) check (annual_expenses_override >= 0),
  birth_year smallint check (birth_year between 1900 and 2100),
  onboarded boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  kind public.category_kind not null default 'expense',
  icon text not null default 'circle',
  color text not null default '#2E8B62',
  sort_order int not null default 0,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, kind, name),
  unique (id, user_id)
);

create table public.income_sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  source_type public.income_source_type not null default 'other',
  expected_monthly numeric(12,2) not null default 0 check (expected_monthly >= 0),
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, name),
  unique (id, user_id)
);

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  account_type text not null default 'checking' check (account_type in ('checking','savings','credit','cash','business','other')),
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, name),
  unique (id, user_id)
);

create table public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  icon text not null default 'target',
  target_amount numeric(12,2) not null check (target_amount > 0),
  starting_amount numeric(12,2) not null default 0 check (starting_amount >= 0),
  monthly_contribution numeric(12,2) not null default 0 check (monthly_contribution >= 0),
  target_date date,
  is_primary boolean not null default false,
  show_on_dashboard boolean not null default true,
  sort_order int not null default 0,
  completed_at date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);
create unique index goals_one_primary_per_user on public.goals(user_id) where is_primary;

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  txn_date date not null default current_date,  -- default dropped in local_date_fix
  description text not null check (char_length(description) between 1 and 200),
  amount numeric(12,2) not null check (amount > 0),
  txn_type public.txn_type not null,
  category_id uuid,
  income_source_id uuid,
  account_id uuid,
  goal_id uuid,
  category_origin public.category_origin not null default 'manual',
  notes text check (char_length(notes) <= 1000),
  is_recurring boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (category_id, user_id) references public.categories(id, user_id) on delete set null (category_id),
  foreign key (income_source_id, user_id) references public.income_sources(id, user_id) on delete set null (income_source_id),
  foreign key (account_id, user_id) references public.accounts(id, user_id) on delete set null (account_id),
  foreign key (goal_id, user_id) references public.goals(id, user_id) on delete set null (goal_id),
  check (txn_type <> 'goal_contribution' or goal_id is not null)
);
create index transactions_user_date_idx on public.transactions(user_id, txn_date desc);
create index transactions_category_idx on public.transactions(category_id);
create index transactions_income_source_idx on public.transactions(income_source_id);
create index transactions_account_idx on public.transactions(account_id);
create index transactions_goal_idx on public.transactions(goal_id);

create table public.budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  category_id uuid not null,
  month date not null check (extract(day from month) = 1),
  amount numeric(12,2) not null check (amount >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (category_id, user_id) references public.categories(id, user_id) on delete cascade,
  unique (user_id, category_id, month)
);
create index budgets_category_idx on public.budgets(category_id);

create table public.holdings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  asset_type public.asset_type not null default 'other',
  current_value numeric(14,2) not null default 0 check (current_value >= 0),
  monthly_contribution numeric(12,2) not null default 0 check (monthly_contribution >= 0),
  counts_toward_freedom boolean not null default true,
  notes text,
  value_as_of date not null default current_date,  -- default dropped in local_date_fix
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index holdings_user_idx on public.holdings(user_id);

create table public.net_worth_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  snapshot_date date not null,
  assets numeric(14,2) not null default 0,
  liabilities numeric(14,2) not null default 0,
  net_worth numeric(14,2) generated always as (assets - liabilities) stored,
  created_at timestamptz not null default now(),
  unique (user_id, snapshot_date)
);

create table public.ai_insights (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  question text,
  answer text not null,
  model text,
  created_at timestamptz not null default now(),
  check (period_end >= period_start)
);
create index ai_insights_user_idx on public.ai_insights(user_id, created_at desc);

create index categories_user_idx on public.categories(user_id);
create index income_sources_user_idx on public.income_sources(user_id);
create index accounts_user_idx on public.accounts(user_id);
create index goals_user_idx on public.goals(user_id);
create index budgets_user_idx on public.budgets(user_id, month);
create index nws_user_idx on public.net_worth_snapshots(user_id, snapshot_date);

create or replace function public.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end; $$;

create trigger trg_profiles_upd before update on public.profiles for each row execute function public.set_updated_at();
create trigger trg_goals_upd before update on public.goals for each row execute function public.set_updated_at();
create trigger trg_txn_upd before update on public.transactions for each row execute function public.set_updated_at();
create trigger trg_budgets_upd before update on public.budgets for each row execute function public.set_updated_at();
create trigger trg_holdings_upd before update on public.holdings for each row execute function public.set_updated_at();

-- ROW LEVEL SECURITY on every table
alter table public.profiles enable row level security;
create policy "own profile select" on public.profiles for select to authenticated using ((select auth.uid()) = id);
create policy "own profile update" on public.profiles for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

do $$
declare t text;
begin
  foreach t in array array['categories','income_sources','accounts','goals','transactions','budgets','holdings','net_worth_snapshots','ai_insights'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "own rows select" on public.%I for select to authenticated using ((select auth.uid()) = user_id)', t);
    execute format('create policy "own rows insert" on public.%I for insert to authenticated with check ((select auth.uid()) = user_id)', t);
    execute format('create policy "own rows update" on public.%I for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)', t);
    execute format('create policy "own rows delete" on public.%I for delete to authenticated using ((select auth.uid()) = user_id)', t);
  end loop;
end $$;

revoke all on all tables in schema public from anon;
