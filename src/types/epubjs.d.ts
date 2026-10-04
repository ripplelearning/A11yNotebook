declare module 'epubjs/src/index.js' {
  interface EpubSection {
    index: number;
    href: string;
    load: () => Promise<Element>;
  }

  interface EpubSpine {
    spineItems: EpubSection[];
  }

  interface EpubBook {
    spine: EpubSpine;
    destroy: () => void;
  }

  export default function ePub(input: ArrayBuffer): Promise<EpubBook>;
}
