-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- 1. Profiles Table (Linked to auth.users)
create table public.profiles (
  id uuid references auth.users on delete cascade not null primary key,
  email text not null,
  name text,
  role text check (role in ('admin', 'auditor', 'user')) default 'user',
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Turn on RLS
alter table public.profiles enable row level security;

-- Policies for profiles
create policy "Users can view their own profile." on profiles for select using (auth.uid() = id);
create policy "Admins can view all profiles." on profiles for select using (
  exists (select 1 from profiles where id = auth.uid() and role = 'admin')
);

-- Function to handle new user signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, name, role)
  values (new.id, new.email, new.raw_user_meta_data->>'full_name', 'user');
  return new;
end;
$$ language plpgsql security definer;

-- Trigger to create a profile automatically when a new user signs up
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- 2. Batches Table (For Excel Uploads)
create table public.batches (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references public.profiles(id) not null,
  filename text not null,
  file_url text not null,
  status text check (status in ('uploaded', 'processing', 'completed', 'failed')) default 'uploaded',
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table public.batches enable row level security;
create policy "Users can view their own batches" on batches for select using (auth.uid() = user_id);
create policy "Users can insert their own batches" on batches for insert with check (auth.uid() = user_id);
create policy "Auditors and Admins can view all batches" on batches for select using (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin', 'auditor'))
);

-- 3. Documents Table (For supporting PDFs/Images)
create table public.documents (
  id uuid default uuid_generate_v4() primary key,
  batch_id uuid references public.batches(id) on delete cascade not null,
  filename text not null,
  file_url text not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table public.documents enable row level security;
create policy "Users can view docs if they can view the batch" on documents for select using (
  exists (select 1 from batches where id = documents.batch_id) -- Relies on batch RLS
);
create policy "Users can insert docs into their batches" on documents for insert with check (
  exists (select 1 from batches where id = documents.batch_id and user_id = auth.uid())
);

-- 4. Vouching Results Table (AI Output)
create table public.vouching_results (
  id uuid default uuid_generate_v4() primary key,
  batch_id uuid references public.batches(id) on delete cascade not null,
  txn_id text,
  vendor text,
  amount_dump numeric,
  amount_doc numeric,
  confidence numeric,
  status text check (status in ('matched', 'mismatched', 'flagged', 'manually_resolved')),
  auditor_notes text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table public.vouching_results enable row level security;
create policy "Users can view their own results" on vouching_results for select using (
  exists (select 1 from batches where id = vouching_results.batch_id and user_id = auth.uid())
);
create policy "Auditors and Admins can view and update all results" on vouching_results for all using (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin', 'auditor'))
);

-- 5. Storage Buckets configuration
-- Please create a public storage bucket named "uploads" in your Supabase dashboard
