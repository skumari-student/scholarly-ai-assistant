export interface SectionTemplate {
  key: string;
  title: string;
}

export const DOC_TYPES: Record<string, { label: string; sections: SectionTemplate[] }> = {
  research_paper: {
    label: "Research Paper",
    sections: [
      { key: "title", title: "Title & Abstract" },
      { key: "intro", title: "Introduction" },
      { key: "literature", title: "Literature Review" },
      { key: "method", title: "Methodology" },
      { key: "results", title: "Results" },
      { key: "discussion", title: "Discussion" },
      { key: "conclusion", title: "Conclusion" },
    ],
  },
  review_article: {
    label: "Review Article",
    sections: [
      { key: "title", title: "Title & Abstract" },
      { key: "intro", title: "Introduction" },
      { key: "themes", title: "Thematic Review" },
      { key: "gaps", title: "Gaps & Future Work" },
      { key: "conclusion", title: "Conclusion" },
    ],
  },
  thesis_chapter: {
    label: "Thesis Chapter",
    sections: [
      { key: "intro", title: "Introduction" },
      { key: "literature", title: "Literature Review" },
      { key: "framework", title: "Methodological Framework" },
      { key: "analysis", title: "Analysis" },
      { key: "discussion", title: "Discussion" },
      { key: "conclusion", title: "Conclusion" },
    ],
  },
  book: {
    label: "Book / eBook",
    sections: [
      { key: "preface", title: "Preface" },
      { key: "ch1", title: "Chapter 1" },
      { key: "ch2", title: "Chapter 2" },
      { key: "ch3", title: "Chapter 3" },
      { key: "summary", title: "Summary" },
    ],
  },
  blog: {
    label: "Blog / Article",
    sections: [
      { key: "title", title: "Title & Hook" },
      { key: "body", title: "Body" },
      { key: "conclusion", title: "Conclusion" },
    ],
  },
  policy_brief: {
    label: "Policy Brief",
    sections: [
      { key: "summary", title: "Executive Summary" },
      { key: "context", title: "Context" },
      { key: "findings", title: "Findings" },
      { key: "recommendations", title: "Recommendations" },
    ],
  },
};

export const CITATION_STYLES = ["APA", "MLA", "Chicago", "IEEE"] as const;
export type CitationStyle = (typeof CITATION_STYLES)[number];

export const LANGUAGE_LEVELS = [
  { value: "basic", label: "Basic academic English" },
  { value: "intermediate", label: "Intermediate academic English" },
  { value: "advanced", label: "Advanced academic English" },
];
