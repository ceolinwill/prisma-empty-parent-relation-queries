import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/client.ts";

const connectionString = process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/repro";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
  log: [{ emit: "event", level: "query" }],
});

let statements: string[] = [];
prisma.$on("query", (event) => statements.push(event.query));

const include = { children: { include: { tag: true } } };

const cases = [
  ["findMany, no parent matches", () => prisma.parent.findMany({ include, where: { id: -1 } })],
  ["findFirst, no parent matches", () => prisma.parent.findFirst({ include, where: { id: -1 } })],
  ["findUnique, no parent matches", () => prisma.parent.findUnique({ include, where: { id: -1 } })],
] as const;

let extra = 0;

for (const [label, run] of cases) {
  statements = [];
  const result = await run();
  console.log(`\n${label}: ${JSON.stringify(result)}, ${statements.length} statement(s)`);
  for (const statement of statements) console.log(`  ${statement}`);
  extra += statements.length - 1;
}

await prisma.$disconnect();

console.log(
  extra === 0
    ? "\nOK: a missing parent runs only the parent query."
    : `\nBUG: ${extra} relation queries ran for parents that don't exist. Each is "IN (NULL)" and can't return a row.`,
);

process.exitCode = extra === 0 ? 0 : 1;
