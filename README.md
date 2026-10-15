# Topic Feeds admin panel

A static page for running Topic Feeds for Instagram. It's plain HTML, CSS and ES modules, with
no build step. It's hosted on GitHub Pages and talks only to the extension's Supabase project.

- **Plans & access** (`#/plans`): set how many feeds the free plan allows, and see the list of
  everyone who has signed in to the extension with Google.
- **One user** (`#/plans/users/<id>`): their account details, synced feed counts, any paid
  subscription, and the **Give Plus** toggle.

## How it's protected

The page holds only the project URL and the publishable key (`config.js`). Both are public, and
the source of the extension itself contains the same values.

Every read and write goes through a database function (`supabase/migrations/20261015200000_admin_plans.sql`
in the extension's repo). Each function refuses anyone who isn't in `public.admins`, so anyone
else who signs in sees "No admin access".

Never put a secret or `service_role` key in this folder.

## Signing in

Sign-in is Google through Supabase (`/auth/v1/authorize?provider=google`). Supabase sends the
browser back to the page with the session in the URL hash. The session stays in memory and is
refreshed as needed. Reloading the page means signing in again. Every Pages site of the account
shares the `andrusha1220.github.io` origin, so browser storage would expose the admin's token to
all of them.

Do these once in the Supabase project and in Google Cloud:

1. **Supabase**: Authentication › URL Configuration › Redirect URLs. Add
   `https://andrusha1220.github.io/topic-feeds-admin/**`.
2. **Google Cloud**: Google Auth Platform › Clients. On the extension's **Web application**
   client, add `https://mwqlaecfjoucjhpgcptj.supabase.co/auth/v1/callback` under Authorized
   redirect URIs.
3. While the Google app's publishing status is "Testing", only its test users can sign in. The
   admin's account must be one of them.

To add another admin, run this in the SQL editor:

```sql
insert into public.admins (user_id) select id from auth.users where email = 'someone@example.com';
```

## Publishing

This folder lives in the extension's private repo. It's published by itself to the public repo
`Andrusha1220/topic-feeds-admin`, which serves its `main` branch root on Pages. From the
extension repo's root, after committing:

```bash
git subtree push --prefix admin admin-pages main
```

The `admin-pages` remote is `https://github.com/Andrusha1220/topic-feeds-admin.git`.

## Trying it locally

Serve the folder from any static server, for example `python3 -m http.server` run in `admin/`.
Google sign-in only returns to addresses listed in step 1, so locally it's easier to point a
copy of `config.js` at `supabase start`'s local stack.
