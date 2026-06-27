import { useStdout } from "ink";
import { useEffect, useState } from "react";

export interface StdoutDimensions {
  readonly columns: number;
  readonly rows: number;
}

const DEFAULT_COLUMNS = 80;
const DEFAULT_ROWS = 24;

const readDimensions = (stdout: NodeJS.WriteStream | undefined): StdoutDimensions => ({
  columns: stdout?.columns ?? DEFAULT_COLUMNS,
  rows: stdout?.rows ?? DEFAULT_ROWS,
});

/** Live terminal size, re-reading on `resize` so the layout reflows. */
export const useStdoutDimensions = (): StdoutDimensions => {
  const { stdout } = useStdout();
  const [dimensions, setDimensions] = useState(() => readDimensions(stdout));

  useEffect(() => {
    if (!stdout) return;
    const onResize = (): void => setDimensions(readDimensions(stdout));
    stdout.on("resize", onResize);
    return () => {
      stdout.off("resize", onResize);
    };
  }, [stdout]);

  return dimensions;
};
