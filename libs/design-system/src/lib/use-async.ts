import { useCallback, useEffect, useState } from 'react';

export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

/** Minimal data-loading hook. `deps` re-runs the loader; `reload()` forces it. */
export function useAsync<T>(loader: () => Promise<T>, deps: unknown[] = []): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  // loader identity is intentionally excluded; deps + tick drive re-fetch.
  const run = useCallback(loader, deps);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    run()
      .then((d) => { if (alive) setData(d); })
      .catch((e: unknown) => { if (alive) setError(e instanceof Error ? e.message : 'Error'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [run, tick]);

  return { data, loading, error, reload: () => setTick((t) => t + 1) };
}
