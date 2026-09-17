/**
 * Deck build pipeline.
 *
 * Phase 2 fills this in: validate YAML against the Zod schema, then emit
 * deck.full.json, deck.public.json, deck.friendly.json, indexes.json,
 * credits.json, viability.md and simulation.md.
 *
 * See ARCHITECTURE.md §6.
 */

async function main(): Promise<void> {
  console.log("deck: no players yet — build pipeline lands in Phase 2");
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
