import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noMutateQueriedDomNodeInComponent } from "./no-mutate-queried-dom-node-in-component.js";

describe("no-mutate-queried-dom-node-in-component", () => {
  it("flags classList.add on a queried, component-owned class", () => {
    const result = runRule(
      noMutateQueriedDomNodeInComponent,
      `function Panel() {
        useEffect(() => {
          document.querySelector('.panel').classList.add('open');
        }, []);
        return <div className="panel" />;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a style mutation on a getElementById result bound to a var", () => {
    const result = runRule(
      noMutateQueriedDomNodeInComponent,
      `function Overlay() {
        const el = document.getElementById('main-content');
        el.style.filter = 'blur(3px)';
        return <section id="main-content" />;
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags classList.remove on a queried #id owned by the component", () => {
    const result = runRule(
      noMutateQueriedDomNodeInComponent,
      `function Menu() {
        const container = document.querySelector('#right');
        container.classList.remove('noscroll');
        return <aside id="right" className="noscroll" />;
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a chained getElementById style mutation", () => {
    const result = runRule(
      noMutateQueriedDomNodeInComponent,
      `function Row() {
        document.getElementById('row-1').style.zIndex = '1';
        return <div id="row-1" />;
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag mutating a createElement node", () => {
    const result = runRule(
      noMutateQueriedDomNodeInComponent,
      `function Download() {
        const a = document.createElement('a');
        a.style.display = 'none';
        return <div className="panel" />;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag setAttribute (not in the mutation set)", () => {
    const result = runRule(
      noMutateQueriedDomNodeInComponent,
      `function Panel() {
        document.querySelector('.panel').setAttribute('data-x', '1');
        return <div className="panel" />;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a read-only query call", () => {
    const result = runRule(
      noMutateQueriedDomNodeInComponent,
      `function Panel() {
        document.getElementById('panel').scrollIntoView();
        return <div id="panel" />;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag document.body style mutations", () => {
    const result = runRule(
      noMutateQueriedDomNodeInComponent,
      `function Panel() {
        document.body.style.overflow = 'hidden';
        return <div className="panel" />;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a ref.current style mutation", () => {
    const result = runRule(
      noMutateQueriedDomNodeInComponent,
      `function Panel() {
        const ref = useRef(null);
        ref.current.style.color = 'red';
        return <div ref={ref} className="panel" />;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a selector the component does not render (no ownership link)", () => {
    const result = runRule(
      noMutateQueriedDomNodeInComponent,
      `function Panel() {
        document.querySelector('.external-widget').classList.add('open');
        return <div className="panel" />;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag innerHTML (dropped from the mutation set)", () => {
    const result = runRule(
      noMutateQueriedDomNodeInComponent,
      `function Panel() {
        const el = document.getElementById('x');
        el.innerHTML = html;
        return <div id="x" />;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a dynamic (non-static) query id", () => {
    const result = runRule(
      noMutateQueriedDomNodeInComponent,
      `function Row({ rowId }) {
        document.getElementById(rowId).style.zIndex = '1';
        return <div id="row-1" />;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag mutations outside a component or hook", () => {
    const result = runRule(
      noMutateQueriedDomNodeInComponent,
      `function setup() {
        document.querySelector('.panel').classList.add('open');
      }
      const markup = <div className="panel" />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a shadowed createElement node whose name matches an owned query var (download-link idiom)", () => {
    const result = runRule(
      noMutateQueriedDomNodeInComponent,
      `function Panel() {
        const el = document.getElementById('panel');
        const width = el.offsetWidth;
        const download = () => {
          const el = document.createElement('a');
          el.style.display = 'none';
          document.body.appendChild(el);
        };
        return <div id="panel" onClick={download} />;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a callback parameter that shadows an owned query var (helper decorating its own argument)", () => {
    const result = runRule(
      noMutateQueriedDomNodeInComponent,
      `function List() {
        const item = document.querySelector('.item');
        const top = item.offsetTop;
        const decorate = (item) => {
          item.style.opacity = '0.5';
        };
        return <div className="item" onMouseEnter={decorate} />;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags the queried node when a nested handler shadows a different name", () => {
    const result = runRule(
      noMutateQueriedDomNodeInComponent,
      `function Panel() {
        const el = document.getElementById('panel');
        el.style.filter = 'blur(3px)';
        const download = () => {
          const link = document.createElement('a');
          link.style.display = 'none';
        };
        return <div id="panel" onClick={download} />;
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags style mutation over an owned querySelectorAll forEach callback", () => {
    const result = runRule(
      noMutateQueriedDomNodeInComponent,
      `function List() {
        document.querySelectorAll('.row').forEach((row) => {
          row.style.background = 'red';
        });
        return <div className="row" />;
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags classList mutation inside a for-of over an owned querySelectorAll", () => {
    const result = runRule(
      noMutateQueriedDomNodeInComponent,
      `function List() {
        for (const row of document.querySelectorAll('.row')) {
          row.classList.add('active');
        }
        return <div className="row" />;
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag forEach over a selector the component does not render", () => {
    const result = runRule(
      noMutateQueriedDomNodeInComponent,
      `function List() {
        document.querySelectorAll('.external-row').forEach((row) => {
          row.style.background = 'red';
        });
        return <div className="row" />;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags style.setProperty on an owned queried node", () => {
    const result = runRule(
      noMutateQueriedDomNodeInComponent,
      `function Panel() {
        const el = document.getElementById('panel');
        el.style.setProperty('--width', '10px');
        return <div id="panel" />;
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag style.setProperty on a ref.current node", () => {
    const result = runRule(
      noMutateQueriedDomNodeInComponent,
      `function Panel() {
        const ref = useRef(null);
        ref.current.style.setProperty('--width', '10px');
        return <div ref={ref} className="panel" />;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag the excluded #root token even when rendered", () => {
    const result = runRule(
      noMutateQueriedDomNodeInComponent,
      `function App() {
        document.getElementById('root').style.overflow = 'hidden';
        return <div id="root" />;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: Print-mode class toggled around synchronous window.print()", () => {
    const result = runRule(
      noMutateQueriedDomNodeInComponent,
      `function InvoicePage({ invoice }) {
  const handlePrint = () => {
    const sheet = document.getElementById('invoice-sheet');
    if (!sheet) return;
    sheet.classList.add('print-expanded');
    window.print();
    sheet.classList.remove('print-expanded');
  };
  return (
    <div>
      <button onClick={handlePrint}>Print</button>
      <div id="invoice-sheet">{invoice.total}</div>
    </div>
  );
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: Style saved and restored in try/finally around an html2canvas export", () => {
    const result = runRule(
      noMutateQueriedDomNodeInComponent,
      `function ChartCard({ data }) {
  const exportPng = async () => {
    const node = document.getElementById('revenue-chart');
    if (!node) return;
    const previousShadow = node.style.boxShadow;
    node.style.boxShadow = 'none';
    try {
      const canvas = await html2canvas(node);
      triggerDownload(canvas.toDataURL('image/png'));
    } finally {
      node.style.boxShadow = previousShadow;
    }
  };
  return (
    <section>
      <div id="revenue-chart">{data.length}</div>
      <button onClick={exportPng}>Export</button>
    </section>
  );
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: Synchronous measure with temporary style override then restore", () => {
    const result = runRule(
      noMutateQueriedDomNodeInComponent,
      `function ColumnHeader({ onAutoFit }) {
  const autoFitColumn = () => {
    const cell = document.getElementById('col-title');
    if (!cell) return;
    const previousWidth = cell.style.width;
    cell.style.width = 'auto';
    const naturalWidth = cell.getBoundingClientRect().width;
    cell.style.width = previousWidth;
    onAutoFit(naturalWidth);
  };
  return <th id="col-title" onDoubleClick={autoFitColumn}>Title</th>;
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: Portal host rendered by a sibling component, class toggled with balanced effect cleanup", () => {
    const result = runRule(
      noMutateQueriedDomNodeInComponent,
      `export const ModalHost = () => <div id="modal-host" />;

export const Modal = ({ open, children }) => {
  useEffect(() => {
    if (!open) return;
    const host = document.getElementById('modal-host');
    if (!host) return;
    host.classList.add('has-dialog');
    return () => host.classList.remove('has-dialog');
  }, [open]);
  if (!open) return null;
  return createPortal(children, document.getElementById('modal-host'));
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: Effect cleanup clearing inline styles a third-party player left behind", () => {
    const result = runRule(
      noMutateQueriedDomNodeInComponent,
      `function VideoStage({ src }) {
  useEffect(() => {
    const player = window.jwplayer('video-stage');
    player.setup({ file: src });
    return () => {
      player.remove();
      const stage = document.getElementById('video-stage');
      if (stage) stage.style.cssText = '';
    };
  }, [src]);
  return <div id="video-stage" className="stage" />;
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags an unbalanced class add on an owned node", () => {
    const result = runRule(
      noMutateQueriedDomNodeInComponent,
      `function Banner() {
         const highlight = () => {
           const banner = document.getElementById('promo-banner');
           if (!banner) return;
           banner.classList.add('highlighted');
         };
         return <div id="promo-banner" onMouseEnter={highlight} />;
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a style write that is never restored", () => {
    const result = runRule(
      noMutateQueriedDomNodeInComponent,
      `function Chart() {
         const emphasize = () => {
           const node = document.getElementById('chart');
           if (!node) return;
           node.style.border = '2px solid red';
         };
         return <div id="chart" onClick={emphasize} />;
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });
});
