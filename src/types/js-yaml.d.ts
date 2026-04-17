declare module 'js-yaml' {
  interface DumpOptions {
    lineWidth?: number;
    noRefs?: boolean;
    sortKeys?: boolean;
    indent?: number;
  }
  function load(input: string): unknown;
  function dump(input: unknown, options?: DumpOptions): string;
  export default { load, dump };
}
