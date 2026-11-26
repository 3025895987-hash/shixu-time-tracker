import { integer, sqliteTable, text, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const records = sqliteTable("records", {
  id: text("id").primaryKey(), kind: text("kind").notNull(), mode: text("mode").notNull(),
  start: integer("start"), end: integer("end"), day: text("day"), minutes: integer("minutes"),
}, t => [index("record_start").on(t.start), index("record_day").on(t.day),
  uniqueIndex("one_running_timer").on(t.mode).where(sql`mode = 'timer' AND end IS NULL`)]);
export const settings = sqliteTable("settings", { key: text("key").primaryKey(), value: text("value").notNull() });
export const changes = sqliteTable("changes", { revision: integer("revision").primaryKey(), token: text("token").notNull().unique() });
