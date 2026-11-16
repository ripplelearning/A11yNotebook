declare module 'jsdom' {
  export class JSDOM {
    constructor(html?: string, options?: Record<string, unknown>);
    readonly window: {
      document: Document;
      CSS: unknown;
      Event: typeof Event;
    };
  }
}
