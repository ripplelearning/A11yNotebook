export interface DocumentTextSection {
  label: string;
  text: string;
}

export interface DocumentReaderModel {
  readonly sections: readonly DocumentTextSection[];
  findSections(query: string): number[];
}

export function createDocumentReaderModel(sections: DocumentTextSection[]): DocumentReaderModel {
  return {
    sections,
    findSections(query: string): number[] {
      const needle = query.trim().toLocaleLowerCase();
      return needle
        ? sections.flatMap((section, index) => (section.text.toLocaleLowerCase().includes(needle) ? [index] : []))
        : [];
    },
  };
}
