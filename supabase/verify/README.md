# Verification queries

Read-only. Paste into the Supabase SQL editor, one result set each, and read
the numbers off it.

These exist because the migrations here are applied **by hand** — there is no
migration history table, and merging to main deploys before anything has been
applied. `scripts/check-migrations.mjs` proves a migration *ran*; these prove
it ran **correctly**, which is a different question and the one that matters
when a migration moves money figures between tables.

| file | when |
|---|---|
| `before_008_010.sql` | before applying 008–010 — is the hand-entered opening balance attached to a user who will get an account? |
| `after_008_010.sql`  | after applying 008–010 — the four pinned numbers, plus where the opening balance landed |

`after_008_010.sql` recomputes July and August spend and floor **in SQL**,
rewriting `effectiveMinor` and `classifyRow` from the schema rather than
reading them out of `src/lib/finance/`. That is the point of it: a green test
suite that reads one source field cannot catch a ledger that is internally
consistent and wrong. Two independent derivations landing on the same figure
can.

Pinned from the golden snapshot, expected unchanged across the accounts
migration:

```
July    3,451,961.38    floor 1,419,349.17
August  5,996,954.15    floor 1,438,873.00
153 rows, 153 month-precision
```

## Applying 008–010

There is no bundle file to keep in sync — it is the migrations themselves, in
order:

```sh
cat supabase/migrations/008_accounts.sql \
    supabase/migrations/009_checkpoints.sql \
    supabase/migrations/010_beneficiary.sql | clip.exe
```

The SQL editor runs that as one transaction, so a `RAISE` anywhere in it rolls
the whole thing back.

**011 is not in that list, and not in `migrations/` either.** It lives in
`supabase/deferred/`, because `supabase db push` reads the directory and not
the comments — a file sitting in `migrations/` gets applied by the next push
whatever it says about waiting. To run it, move it into `migrations/` and
push. That is a deliberate act and it shows up in a diff.
