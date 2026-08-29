## What changed



## Migrations

<!--
  Merging to main deploys. Applying a migration is a separate manual act in the
  Supabase SQL editor, which is how three merged stages of finance once shipped
  against a database that had never seen them.

  `npm run build` runs scripts/check-migrations.mjs and fails when the target
  database is behind supabase/migrations/, so this should already be enforced.
  This section is for the part a probe cannot check: whether the order is safe.
-->

- [ ] No migration in this PR, **or** every migration is applied to the live database before merge
- [ ] Every new migration declares a `-- @sentinel:` line
- [ ] Anything that DROPs asserts first, and refuses rather than skips

## Verified how


