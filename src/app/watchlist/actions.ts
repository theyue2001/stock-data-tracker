"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";

/**
 * Watchlist mutations. Currently global (single implicit user) — the MVP has no
 * authentication. When Google login lands, add a userId column to
 * WatchlistItem and scope these queries by the session user; nothing else in
 * the UI needs to change.
 *
 * Duplicate prevention is done here rather than by a database unique
 * constraint because the natural key spans nullable columns, and SQLite (like
 * Postgres) treats NULLs in a unique index as distinct — the constraint would
 * silently never fire.
 */

const VALID_TYPES = new Set(["industry", "stock", "indicator"]);

export async function addWatchlistItem(formData: FormData) {
  const itemType = String(formData.get("itemType") ?? "");
  const targetId = String(formData.get("targetId") ?? "");
  if (!targetId || !VALID_TYPES.has(itemType)) return;

  const key =
    itemType === "industry"
      ? { industryId: targetId }
      : itemType === "stock"
        ? { stockId: targetId }
        : { indicatorId: targetId };

  const existing = await db.watchlistItem.findFirst({ where: { itemType, ...key } });
  if (existing) return;

  await db.watchlistItem.create({ data: { itemType, ...key } });

  revalidatePath("/watchlist");
  revalidatePath("/");
}

export async function removeWatchlistItem(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  await db.watchlistItem.deleteMany({ where: { id } });

  revalidatePath("/watchlist");
  revalidatePath("/");
}

/**
 * Star-toggle used by the ☆/★ control on every screen (design_handoff
 * README → "Watch star"). Called directly from a client component (not via
 * a <form>) so the star can sit inside a clickable row/card without ever
 * triggering the row's own navigation — the caller does
 * `e.stopPropagation()` before calling this.
 *
 * `isWatched` is the state the CALLER believes it's in before toggling; this
 * intentionally re-derives the actual state from the database rather than
 * trusting it, so a stale client never flips the wrong direction.
 */
export async function toggleWatchlistItem(itemType: "industry" | "stock" | "indicator", targetId: string) {
  if (!targetId) return;

  const key =
    itemType === "industry" ? { industryId: targetId } : itemType === "stock" ? { stockId: targetId } : { indicatorId: targetId };

  const existing = await db.watchlistItem.findFirst({ where: { itemType, ...key } });
  if (existing) {
    await db.watchlistItem.delete({ where: { id: existing.id } });
  } else {
    await db.watchlistItem.create({ data: { itemType, ...key } });
  }

  revalidatePath("/", "layout");
}
