import type { Fragment } from "./types";

/** Sample content so previews work with no AEM connection. */
export const SAMPLE_FRAGMENTS: Fragment[] = [
  {
    path: "/content/dam/sample/summer-sale",
    name: "summer-sale",
    title: "Summer Sale",
    model: "HeroBanner",
    fields: { headline: "Summer Sale", subhead: "Up to 40% off everything", ctaLabel: "Shop now" },
    source: "sample",
  },
  {
    path: "/content/dam/sample/new-arrivals",
    name: "new-arrivals",
    title: "New Arrivals",
    model: "HeroBanner",
    fields: { headline: "New Arrivals", subhead: "Fresh styles just landed", ctaLabel: "Browse" },
    source: "sample",
  },
  {
    path: "/content/dam/sample/how-to-choose",
    name: "how-to-choose",
    title: "How to choose",
    model: "Article",
    fields: { title: "How to choose a size", body: "Measure twice, order once.", tags: ["guide", "sizing"], published: true },
    source: "sample",
  },
];
