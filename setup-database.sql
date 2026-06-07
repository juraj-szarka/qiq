-- ============================================================
-- Full Database Setup for qiq (Supabase)
-- Run this in the Supabase SQL Editor
-- ============================================================

-- 0. Extensions
create extension if not exists "pgcrypto";

-- ============================================================
-- 1. TABLES
-- ============================================================

-- 1a. profiles (extends auth.users)
create table if not exists public.profiles (
    id uuid primary key references auth.users on delete cascade,
    username text unique,
    display_name text,
    bio text,
    avatar_url text,
    created_at timestamptz default now()
);

-- 1b. posts
create table if not exists public.posts (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references public.profiles(id) on delete cascade,
    media_url text,
    media_urls text[],
    media_type text,
    description text,
    tags text[],
    views integer default 0,
    engagement_score integer default 0,
    created_at timestamptz default now()
);

-- 1c. likes
create table if not exists public.likes (
    user_id uuid not null references public.profiles(id) on delete cascade,
    post_id uuid not null references public.posts(id) on delete cascade,
    created_at timestamptz default now(),
    primary key (user_id, post_id)
);

-- 1d. comments
create table if not exists public.comments (
    id uuid primary key default gen_random_uuid(),
    post_id uuid not null references public.posts(id) on delete cascade,
    user_id uuid not null references public.profiles(id) on delete cascade,
    content text not null,
    created_at timestamptz default now()
);

-- 1e. follows
create table if not exists public.follows (
    follower_id uuid not null references public.profiles(id) on delete cascade,
    following_id uuid not null references public.profiles(id) on delete cascade,
    created_at timestamptz default now(),
    primary key (follower_id, following_id)
);

-- 1f. group_chats
create table if not exists public.group_chats (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    created_by uuid not null references public.profiles(id) on delete cascade,
    avatar_url text,
    created_at timestamptz default now()
);

-- 1g. group_members
create table if not exists public.group_members (
    group_id uuid not null references public.group_chats(id) on delete cascade,
    user_id uuid not null references public.profiles(id) on delete cascade,
    created_at timestamptz default now(),
    primary key (group_id, user_id)
);

-- 1h. messages
create table if not exists public.messages (
    id uuid primary key default gen_random_uuid(),
    sender_id uuid not null references public.profiles(id) on delete cascade,
    receiver_id uuid references public.profiles(id) on delete cascade,
    group_id uuid references public.group_chats(id) on delete cascade,
    content text,
    file_url text,
    post_id uuid references public.posts(id) on delete set null,
    reply_to_id uuid references public.messages(id) on delete set null,
    liked_by uuid[] default '{}',
    is_read boolean default false,
    created_at timestamptz default now()
);

-- 1i. post_views
create table if not exists public.post_views (
    id uuid primary key default gen_random_uuid(),
    user_id uuid references public.profiles(id) on delete set null,
    post_id uuid not null references public.posts(id) on delete cascade,
    viewed_at timestamptz default now()
);

-- ============================================================
-- 2. INDEXES (for performance)
-- ============================================================

create index if not exists idx_posts_user_id on public.posts(user_id);
create index if not exists idx_posts_created_at on public.posts(created_at desc);
create index if not exists idx_posts_engagement on public.posts(engagement_score desc);
create index if not exists idx_likes_post_id on public.likes(post_id);
create index if not exists idx_comments_post_id on public.comments(post_id);
create index if not exists idx_follows_follower on public.follows(follower_id);
create index if not exists idx_follows_following on public.follows(following_id);
create index if not exists idx_messages_sender on public.messages(sender_id);
create index if not exists idx_messages_receiver on public.messages(receiver_id);
create index if not exists idx_messages_group on public.messages(group_id);
create index if not exists idx_messages_created on public.messages(created_at);
create index if not exists idx_post_views_user on public.post_views(user_id);
create index if not exists idx_post_views_post on public.post_views(post_id);
create index if not exists idx_group_members_user on public.group_members(user_id);

-- ============================================================
-- 3. RPC FUNCTION: record_post_view
-- ============================================================

create or replace function public.record_post_view(p_user_id uuid, p_post_id uuid)
returns void
language plpgsql
security definer
as $$
begin
    -- Insert the view record
    insert into public.post_views (user_id, post_id)
    values (p_user_id, p_post_id);

    -- Increment the view counter on the post
    update public.posts
    set views = coalesce(views, 0) + 1
    where id = p_post_id;
end;
$$;

-- ============================================================
-- 4. STORAGE BUCKETS
-- ============================================================

insert into storage.buckets (id, name, public) values ('media', 'media', true)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public) values ('avatars', 'avatars', true)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public) values ('group_avatars', 'group_avatars', true)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public) values ('chat_files', 'chat_files', true)
on conflict (id) do nothing;

-- ============================================================
-- 5. ROW LEVEL SECURITY (RLS) — Basic public read, authenticated write
-- ============================================================

-- Enable RLS on all tables
alter table public.profiles enable row level security;
alter table public.posts enable row level security;
alter table public.likes enable row level security;
alter table public.comments enable row level security;
alter table public.follows enable row level security;
alter table public.group_chats enable row level security;
alter table public.group_members enable row level security;
alter table public.messages enable row level security;
alter table public.post_views enable row level security;

-- ── profiles ──
drop policy if exists "Profiles are public" on public.profiles;
create policy "Profiles are public" on public.profiles
    for select using (true);

drop policy if exists "Users can insert own profile" on public.profiles;
create policy "Users can insert own profile" on public.profiles
    for insert with check (auth.uid() = id);

drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile" on public.profiles
    for update using (auth.uid() = id);

-- ── posts ──
drop policy if exists "Posts are public" on public.posts;
create policy "Posts are public" on public.posts
    for select using (true);

drop policy if exists "Authenticated users can insert" on public.posts;
create policy "Authenticated users can insert" on public.posts
    for insert with check (auth.role() = 'authenticated');

drop policy if exists "Users can update own posts" on public.posts;
create policy "Users can update own posts" on public.posts
    for update using (auth.uid() = user_id);

drop policy if exists "Users can delete own posts" on public.posts;
create policy "Users can delete own posts" on public.posts
    for delete using (auth.uid() = user_id);

-- ── likes ──
drop policy if exists "Likes are public" on public.likes;
create policy "Likes are public" on public.likes
    for select using (true);

drop policy if exists "Users can manage own likes" on public.likes;
create policy "Users can manage own likes" on public.likes
    for insert with check (auth.uid() = user_id);

drop policy if exists "Users can delete own likes" on public.likes;
create policy "Users can delete own likes" on public.likes
    for delete using (auth.uid() = user_id);

-- ── comments ──
drop policy if exists "Comments are public" on public.comments;
create policy "Comments are public" on public.comments
    for select using (true);

drop policy if exists "Users can insert comments" on public.comments;
create policy "Users can insert comments" on public.comments
    for insert with check (auth.role() = 'authenticated');

-- ── follows ──
drop policy if exists "Follows are public" on public.follows;
create policy "Follows are public" on public.follows
    for select using (true);

drop policy if exists "Users can manage own follows" on public.follows;
create policy "Users can manage own follows" on public.follows
    for insert with check (auth.uid() = follower_id);

drop policy if exists "Users can unfollow" on public.follows;
create policy "Users can unfollow" on public.follows
    for delete using (auth.uid() = follower_id);

-- ── group_chats ──
drop policy if exists "Members can view group" on public.group_chats;
create policy "Members can view group" on public.group_chats
    for select using (
        exists (select 1 from public.group_members where group_id = id and user_id = auth.uid())
    );

drop policy if exists "Users can create groups" on public.group_chats;
create policy "Users can create groups" on public.group_chats
    for insert with check (auth.role() = 'authenticated');

-- ── group_members ──
drop policy if exists "Members visible to members" on public.group_members;
create policy "Members visible to members" on public.group_members
    for select using (
        exists (select 1 from public.group_members gm where gm.group_id = group_id and gm.user_id = auth.uid())
    );

drop policy if exists "Users can add members" on public.group_members;
create policy "Users can add members" on public.group_members
    for insert with check (auth.role() = 'authenticated');

-- ── messages ──
drop policy if exists "Users can see their messages" on public.messages;
create policy "Users can see their messages" on public.messages
    for select using (
        auth.uid() = sender_id or
        auth.uid() = receiver_id or
        exists (select 1 from public.group_members where group_id = messages.group_id and user_id = auth.uid())
    );

drop policy if exists "Users can send messages" on public.messages;
create policy "Users can send messages" on public.messages
    for insert with check (auth.role() = 'authenticated');

drop policy if exists "Users can update own messages" on public.messages;
create policy "Users can update own messages" on public.messages
    for update using (auth.uid() = sender_id);

-- ── post_views ──
drop policy if exists "Views are public" on public.post_views;
create policy "Views are public" on public.post_views
    for select using (true);

drop policy if exists "Anyone can insert views" on public.post_views;
create policy "Anyone can insert views" on public.post_views
    for insert with check (true);

-- ============================================================
-- 6. STORAGE RLS POLICIES
-- ============================================================

-- media bucket
drop policy if exists "Media public read" on storage.objects;
create policy "Media public read" on storage.objects
    for select using (bucket_id = 'media');

drop policy if exists "Media authenticated upload" on storage.objects;
create policy "Media authenticated upload" on storage.objects
    for insert with check (bucket_id = 'media' and auth.role() = 'authenticated');

-- avatars bucket
drop policy if exists "Avatars public read" on storage.objects;
create policy "Avatars public read" on storage.objects
    for select using (bucket_id = 'avatars');

drop policy if exists "Avatars authenticated upload" on storage.objects;
create policy "Avatars authenticated upload" on storage.objects
    for insert with check (bucket_id = 'avatars' and auth.role() = 'authenticated');

-- group_avatars bucket
drop policy if exists "Group avatars public read" on storage.objects;
create policy "Group avatars public read" on storage.objects
    for select using (bucket_id = 'group_avatars');

drop policy if exists "Group avatars authenticated upload" on storage.objects;
create policy "Group avatars authenticated upload" on storage.objects
    for insert with check (bucket_id = 'group_avatars' and auth.role() = 'authenticated');

-- chat_files bucket
drop policy if exists "Chat files public read" on storage.objects;
create policy "Chat files public read" on storage.objects
    for select using (bucket_id = 'chat_files');

drop policy if exists "Chat files authenticated upload" on storage.objects;
create policy "Chat files authenticated upload" on storage.objects
    for insert with check (bucket_id = 'chat_files' and auth.role() = 'authenticated');

-- ============================================================
-- 7. AUTO-CREATE PROFILE ON SIGNUP (trigger)
-- ============================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
    insert into public.profiles (id, username)
    values (
        new.id,
        coalesce(
            new.raw_user_meta_data ->> 'username',
            'user_' || substr(new.id::text, 1, 8)
        )
    );
    return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();
