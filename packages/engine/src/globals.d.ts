/**
 * The package compiles against `lib: ["ES2020"]` only — deliberately NOT `DOM`, so that a stray
 * `document` or `fetch` in this package is a compile error rather than something discovered when
 * a second app tries to run the engine outside a browser.
 *
 * `console` is the one host global the algorithms legitimately use (a handful of diagnostic
 * warnings on degenerate input). It exists in every runtime this package targets, so it is
 * declared here narrowly rather than by pulling in the whole DOM or Node type surface.
 */
declare const console: {
  log(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  debug(...args: unknown[]): void;
};
