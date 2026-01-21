## Environment variables (local + Netlify)

Create a file named `.env.local` in the project root (do not commit it) with:

```txt
VITE_SUPABASE_URL=YOUR_SUPABASE_URL
VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
```

On Netlify:

- Site settings → Build & deploy → Environment → add the same two variables.

