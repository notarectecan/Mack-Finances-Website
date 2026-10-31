-- ============ CSV IMPORTS ============
-- One row per uploaded CSV file. Deleting an import row deletes the transactions it created ("Undo import").
create table public.csv_imports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  file_name text not null check (char_length(file_name) between 1 and 200),
  row_count int not null default 0 check (row_count >= 0),
  imported_count int not null default 0 check (imported_count >= 0),
  skipped_count int not null default 0 check (skipped_count >= 0),
  categories_created int not null default 0 check (categories_created >= 0),
  created_at timestamptz not null default now(),
  unique (id, user_id)
);
create index csv_imports_user_idx on public.csv_imports(user_id, created_at desc);

alter table public.csv_imports enable row level security;
create policy "own rows select" on public.csv_imports for select to authenticated using ((select auth.uid()) = user_id);
create policy "own rows insert" on public.csv_imports for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "own rows update" on public.csv_imports for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own rows delete" on public.csv_imports for delete to authenticated using ((select auth.uid()) = user_id);
revoke all on public.csv_imports from anon;

-- link each imported transaction to its import (same-user composite FK; cascade = undo)
alter table public.transactions add column import_id uuid;
alter table public.transactions add constraint transactions_import_fk
  foreign key (import_id, user_id) references public.csv_imports(id, user_id) on delete cascade;
create index transactions_import_fk_idx on public.transactions(import_id, user_id);

-- ============ IMPORT FUNCTION (atomic; runs as the caller so RLS applies) ============
-- p_rows: [{ "date":"YYYY-MM-DD", "description":"...", "amount":"12.34", "type":"expense|income|transfer|investment|goal_contribution",
--            "category":"Groceries", "notes":"..." }]  amounts are positive decimal strings (sign already resolved by the app)
create or replace function public.import_transactions(
  p_file_name text, p_rows jsonb, p_skip_duplicates boolean default true, p_create_categories boolean default true)
returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  uid uuid := auth.uid();
  imp uuid;
  r jsonb;
  v_date date; v_amount numeric(12,2); v_type public.txn_type; v_desc text; v_notes text; v_cat text;
  v_kind public.category_kind; v_cat_id uuid; v_goal_id uuid; v_source uuid; v_account uuid;
  n_total int := 0; n_ok int := 0; n_dup int := 0; n_cats int := 0;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'rows must be a JSON array'; end if;
  if jsonb_array_length(p_rows) = 0 then raise exception 'the file has no rows to import'; end if;
  if jsonb_array_length(p_rows) > 5000 then raise exception 'too many rows (max 5000 per import)'; end if;

  insert into public.csv_imports (file_name, row_count) values (left(coalesce(nullif(trim(p_file_name),''),'import.csv'),200), jsonb_array_length(p_rows))
  returning id into imp;
  select id into v_account from public.accounts where user_id = uid and account_type = 'checking' and not archived order by created_at limit 1;

  for r in select * from jsonb_array_elements(p_rows) loop
    n_total := n_total + 1;
    begin
      v_date := (r->>'date')::date;
    exception when others then
      raise exception 'row %: invalid date "%"', n_total, r->>'date';
    end;
    begin
      v_amount := round((r->>'amount')::numeric, 2);
    exception when others then
      raise exception 'row %: invalid amount "%"', n_total, r->>'amount';
    end;
    if v_amount is null or v_amount <= 0 then raise exception 'row %: amount must be greater than zero', n_total; end if;
    v_desc := left(trim(coalesce(r->>'description','')), 200);
    if v_desc = '' then raise exception 'row %: description is empty', n_total; end if;
    v_notes := nullif(left(trim(coalesce(r->>'notes','')), 1000), '');
    v_type := coalesce(nullif(lower(trim(r->>'type')),''), 'expense')::public.txn_type;
    v_cat := nullif(left(trim(coalesce(r->>'category','')), 40), '');
    v_cat_id := null; v_goal_id := null; v_source := null;

    -- goal contributions: attach to an existing goal with that name, otherwise keep as a transfer
    if v_type = 'goal_contribution' then
      select id into v_goal_id from public.goals where user_id = uid and lower(name) = lower(coalesce(v_cat, '')) limit 1;
      if v_goal_id is null then v_type := 'transfer'; end if;
    end if;

    if v_type in ('income','expense') and v_cat is not null then
      v_kind := case when v_type = 'income' then 'income' else 'expense' end::public.category_kind;
      select id into v_cat_id from public.categories where user_id = uid and kind = v_kind and lower(name) = lower(v_cat) limit 1;
      if v_cat_id is null and p_create_categories then
        insert into public.categories (name, kind, icon, color, sort_order) values (v_cat, v_kind, 'circle', '#9AA19B', 90)
        returning id into v_cat_id;
        n_cats := n_cats + 1;
      end if;
    end if;
    if v_type = 'income' then
      select id into v_source from public.income_sources where user_id = uid and not archived and lower(name) = lower(coalesce(r->>'income_source','')) limit 1;
    end if;

    if p_skip_duplicates and exists (
      select 1 from public.transactions t where t.user_id = uid and t.txn_date = v_date and t.amount = v_amount
        and t.txn_type = v_type and lower(t.description) = lower(v_desc)) then
      n_dup := n_dup + 1;
      continue;
    end if;

    insert into public.transactions (txn_date, description, amount, txn_type, category_id, income_source_id, account_id, goal_id, notes, category_origin, import_id)
    values (v_date, v_desc, v_amount, v_type, v_cat_id, v_source, v_account, v_goal_id, v_notes, 'manual', imp);
    n_ok := n_ok + 1;
  end loop;

  if n_ok = 0 then
    delete from public.csv_imports where id = imp;
    imp := null;
  else
    update public.csv_imports set imported_count = n_ok, skipped_count = n_dup, categories_created = n_cats where id = imp;
  end if;
  return jsonb_build_object('import_id', imp, 'rows', n_total, 'imported', n_ok, 'skipped_duplicates', n_dup, 'categories_created', n_cats);
end; $$;
revoke execute on function public.import_transactions(text, jsonb, boolean, boolean) from public, anon;
grant execute on function public.import_transactions(text, jsonb, boolean, boolean) to authenticated;
