// Whether the site may mention the driver newspaper outside its own pages.
// While it is false the paper is unannounced: the privacy page keeps the
// Profile sharing wording that predates it. It is a build-time switch, apart
// from the backend's FREIGHT_FATE_PAPER, so dev can reach main before the
// paper launches. At launch, one commit sets it to true and takes `draft`
// off the paper's What's New entry, with that day's date.
export const PAPER_ANNOUNCED = false;
