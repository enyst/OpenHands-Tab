export type Callback<T> = ((arg: T) => void) | null | undefined;

export function composeCallbacks<T>(callbacks: Array<Callback<T>>): (arg: T) => void {
  return (arg: T) => {
    for (const cb of callbacks) {
      if (cb) cb(arg);
    }
  };
}
