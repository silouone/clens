// Sibling-tab barrel (overview-moat-refactor). Pre-wired in Wave 0 so the
// BottomPanel dispatcher imports every tab from here and Wave 2 builders only
// ever touch their own tab file — never this barrel.
export { BacktracksTab } from "./BacktracksTab";
export { CommunicationTab } from "./CommunicationTab";
export { EditsTab } from "./EditsTab";
export { TimelineTab } from "./TimelineTab";
