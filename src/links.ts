import type { BobLinearLink, BobLinearLinkInput } from "./types.ts";

export type LinkReconciliation =
  | { kind: "create"; link: BobLinearLink }
  | { kind: "unchanged"; link: BobLinearLink }
  | { kind: "replace"; previous: BobLinearLink; link: BobLinearLink };

export function reconcileBobLinearLink(
  input: BobLinearLinkInput,
  existing: BobLinearLink | undefined,
  updatedAt = new Date().toISOString(),
): LinkReconciliation {
  const link: BobLinearLink = { ...input, updatedAt };
  if (!existing) return { kind: "create", link };
  if (
    existing.bobWorkItemId === link.bobWorkItemId &&
    existing.linearIssueId === link.linearIssueId &&
    existing.linearProjectId === link.linearProjectId
  ) {
    return { kind: "unchanged", link: existing };
  }
  return { kind: "replace", previous: existing, link };
}
