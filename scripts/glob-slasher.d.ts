
declare module 'glob-slasher' {
  function slasher(glob: string): string;
  function slasher(glob: Record<string, string>): Record<string, string>;
  export default slasher;
}
