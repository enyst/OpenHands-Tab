declare module 'picomatch' {
  export interface PicomatchOptions {
    bash?: boolean;
    dot?: boolean;
    nocase?: boolean;
    noextglob?: boolean;
    nobrace?: boolean;
    noglobstar?: boolean;
  }

  export type PicomatchMatcher = (value: string) => boolean;

  const picomatch: (glob: string | string[], options?: PicomatchOptions) => PicomatchMatcher;
  export default picomatch;
}
