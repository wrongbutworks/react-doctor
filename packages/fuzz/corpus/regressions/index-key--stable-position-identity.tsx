// rule: no-array-index-as-key
// weakness: library-idiom
// source: FP-FIX history (string characters: position IS the identity).
// NOTE: `.split()` fragments were re-litigated in #1077 (bulwarkmail /
// tracecat corpus misses) and now deliberately flag — only proven
// single-string character slices stay exempt.
export const MatchedName = ({ name }: { name: string }) => (
  <span>
    {[...name].map((char, index) => (
      <em key={index}>{char}</em>
    ))}
  </span>
);
export const Initials = ({ name }: { name: string }) => (
  <span>
    {Array.from(name).map((char, index) => (
      <b key={index}>{char}</b>
    ))}
  </span>
);
