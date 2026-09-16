import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = join(__dirname, "..");
const jsonPath = join(root, "techlist.cleaned.json");

type Event = {
  date_label: string;
  start_time_display: string;
  title: string;
  host: string;
  neighborhood: string;
  labels: string[];
  event_url: string;
  source_row: number;
  city?: "sf" | "la";
};

type Catalog = { notes: string[]; events: Event[]; snapshot_generated_at?: string; [key: string]: unknown };

const before = JSON.parse(readFileSync(jsonPath, "utf8")) as Catalog;
let updatedCount = 0;
for (const event of before.events) {
  if (!event.city) {
    event.city = "sf";
    updatedCount++;
  }
}
if (updatedCount > 0) {
  writeFileSync(jsonPath, JSON.stringify(before, null, 2) + "\n", "utf8");
  console.log(`Backfilled ${updatedCount} event(s) with city: "sf".`);
} else {
  console.log("No events required backfill.");
}

