declare module 'epubjs/src/index.js' {
  interface EpubSection {
    index: number;
    href: string;
    load: () => Promise<Element>;
    hooks: {
      serialize: {
        register(callback: (this: { output: string }, content: string) => void): void;
      };
    };
  }

  interface EpubSpine {
    spineItems: EpubSection[];
  }

  export interface EpubTocItem {
    label: string;
    href: string;
    subitems?: EpubTocItem[];
  }

  interface EpubRendition {
    display(target?: string | number): Promise<unknown>;
    destroy(): void;
  }

  interface EpubBook {
    spine: EpubSpine;
    navigation: { toc: EpubTocItem[] };
    renderTo(element: HTMLElement, options: { width: string; height: string; flow: 'paginated' }): EpubRendition;
    destroy: () => void;
  }

  export default function ePub(input: ArrayBuffer): Promise<EpubBook>;
}
