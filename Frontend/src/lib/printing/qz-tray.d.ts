/**
 * Minimal type surface for `qz-tray`, which ships none of its own.
 *
 * Declares only what qzTransport.ts actually calls. A fuller definition would
 * be guesswork about an API this app does not use, and guesswork that
 * typechecks is worse than an honest gap.
 */
declare module 'qz-tray' {
  export const websocket: {
    isActive(): boolean;
    connect(options?: { retries?: number; delay?: number }): Promise<void>;
    disconnect(): Promise<void>;
  };

  export const printers: {
    /** The OS default. Used when no printer has been named in settings. */
    getDefault(): Promise<string>;
    find(): Promise<string[]>;
  };

  export const configs: {
    create(printer: string, options?: Record<string, unknown>): unknown;
  };

  /**
   * `raw` + `command` + `base64` is the ESC/POS path — bytes straight to the
   * device, which is the only reason this dependency exists.
   */
  export function print(
    config: unknown,
    data: Array<{ type: string; format: string; flavor: string; data: string }>,
  ): Promise<void>;
}
