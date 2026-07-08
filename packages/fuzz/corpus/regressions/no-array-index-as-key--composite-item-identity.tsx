// rule: no-array-index-as-key
// weakness: ast-shape
// source: cross-rule consistency audit (Irev-Dev/cadhub IdeConsole, ant-design ColorPresets).
// NOTE: SAME-item composite keys (`${message} ${index}`) were re-litigated
// in #1077 and now deliberately flag — reordering still remints every key.
// Only identity rooted OUTSIDE the index-binding map, placeholder
// constructions, and bounded numeric counters stay exempt.
export const SectionRows = ({ sections }: { sections: { id: string; rows: string[] }[] }) => (
  <div>
    {sections.map((section) => (
      <ul key={section.id}>
        {section.rows.map((row, index) => (
          <li key={`${section.id}-${index}`}>{row}</li>
        ))}
      </ul>
    ))}
  </div>
);
export const SliderThumbs = ({ values }: { values: number[] }) => (
  <div>
    {Array.from({ length: values.length }, (_, index) => (
      <Swatch key={index} />
    ))}
  </div>
);
export const PlaygroundGrid = ({ count }: { count: number }) => {
  const cols = [];
  for (let i = 0; i < count; i++) {
    cols.push(<Swatch key={i} />);
  }
  return <div>{cols}</div>;
};
declare const Swatch: (props: { key?: string }) => null;
