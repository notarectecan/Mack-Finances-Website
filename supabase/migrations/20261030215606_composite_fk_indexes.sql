drop index if exists public.transactions_category_idx, public.transactions_income_source_idx, public.transactions_account_idx, public.transactions_goal_idx, public.budgets_category_idx;
create index transactions_category_fk_idx on public.transactions(category_id, user_id);
create index transactions_income_source_fk_idx on public.transactions(income_source_id, user_id);
create index transactions_account_fk_idx on public.transactions(account_id, user_id);
create index transactions_goal_fk_idx on public.transactions(goal_id, user_id);
create index budgets_category_fk_idx on public.budgets(category_id, user_id);
