export interface ShareLinkGateInput {
  readonly noScore: boolean;
  readonly share: boolean;
  readonly isCi: boolean;
}

// The one share-link gate: the Share URL prints only for scored, share-enabled,
// non-CI runs. Every renderer (static single-project, multi-project summary,
// interactive TUI) must agree on this, so none of them re-derive it inline.
export const shouldShowShareLink = ({ noScore, share, isCi }: ShareLinkGateInput): boolean =>
  !noScore && share && !isCi;
