# Prisma 7 runs relation queries for parents that don't exist

With the query compiler (Prisma 7's default, driver adapters, `relationLoadStrategy: "query"`), a `findMany` or `findFirst` that matches no rows still sends one query per nested relation in its `include`/`select`. Each one is rendered with an empty key list as `WHERE "fk" IN (NULL)`, a statement that can't return a row, and nested relations repeat it level by level. The result is correct; the extra statements cost a round trip and a pool connection each. `findUnique` with no match already skips them.

Reported in [prisma/orm#30761](https://github.com/prisma/orm/issues/30761) ([our evidence](https://github.com/prisma/orm/issues/30761#issuecomment-6623824909)).

## Reproduction

Needs a PostgreSQL database. Any empty one works; for example:

```sh
docker run -d --name repro-postgres -p 5432:5432 -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=repro postgres:18
```

Then (set `DATABASE_URL` if yours isn't `postgres://postgres:postgres@localhost:5432/repro`):

```sh
npm install
npm run repro
```

`npm run repro` pushes the schema (three tables, no rows), generates the client and runs [`repro.ts`](repro.ts), which logs every statement each query sends. It exits with 1 while the bug is present.

Output on Prisma 7.10.1:

```
findMany, no parent matches: [], 3 statement(s)
  SELECT "public"."Parent"."id" FROM "public"."Parent" WHERE "public"."Parent"."id" = $1 OFFSET $2
  SELECT "public"."Child"."id", "public"."Child"."parentId", "public"."Child"."tagId" FROM "public"."Child" WHERE "public"."Child"."parentId" IN (NULL) OFFSET $1
  SELECT "public"."Tag"."id" FROM "public"."Tag" WHERE "public"."Tag"."id" IN (NULL) OFFSET $1

findFirst, no parent matches: null, 3 statement(s)
  SELECT "public"."Parent"."id" FROM "public"."Parent" WHERE "public"."Parent"."id" = $1 LIMIT $2 OFFSET $3
  SELECT "public"."Child"."id", "public"."Child"."parentId", "public"."Child"."tagId" FROM "public"."Child" WHERE "public"."Child"."parentId" IN (NULL) OFFSET $1
  SELECT "public"."Tag"."id" FROM "public"."Tag" WHERE "public"."Tag"."id" IN (NULL) OFFSET $1

findUnique, no parent matches: null, 1 statement(s)
  SELECT "public"."Parent"."id" FROM "public"."Parent" WHERE ("public"."Parent"."id" = $1 AND 1=1) LIMIT $2 OFFSET $3

BUG: 4 relation queries ran for parents that don't exist. Each is "IN (NULL)" and can't return a row.
```

## Expected

When the parent query returns no rows, the relation queries are skipped and their results treated as empty: 1 statement for each of the three calls, as `findUnique` already does.

## Actual

The interpreter's `join` node only short-circuits a `null` parent. In `packages/client-engine-runtime/src/interpreter/query-interpreter.ts` at [7.10.1](https://github.com/prisma/orm/blob/7.10.1/packages/client-engine-runtime/src/interpreter/query-interpreter.ts#L251-L266), `case 'join'` checks `parent === null` and otherwise runs every child; its pure twin at line 421 does the same. A `findMany` parent, and a `findFirst` parent before its take-one, is `[]`, so each child query runs with an empty key list, which `render-query.ts` renders as `IN (NULL)` for an empty `parameterTuple`.

`relationJoins` with `relationLoadStrategy: "join"` sends 1 statement for each call here, but in 7.10.1 it's still a preview feature that switches every relation load to a different query shape.

## Environment

- `prisma`, `@prisma/client`, `@prisma/adapter-pg` 7.10.1 (the latest `@prisma/client` release), `prisma-client` generator, `pg` 8.23.1
- PostgreSQL 18.3
- Node.js 24.22.0, npm 11.19.1, macOS 27.2
