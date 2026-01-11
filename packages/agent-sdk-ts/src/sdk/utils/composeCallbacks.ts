export type Callback<TArgs extends unknown[]> = ((...args: TArgs) => void) | null | undefined;

export function composeCallbacks<TArgs extends unknown[]>(
  callbacks: ReadonlyArray<Callback<TArgs>>,
): (...args: TArgs) => void {
  return (...args: TArgs) => {
    for (const cb of callbacks) {
      cb?.(...args);
    }
  };
}
