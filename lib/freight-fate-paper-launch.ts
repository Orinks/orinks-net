// Whether the site may mention the driver newspaper outside its own pages.
// While it is false the paper is unannounced: the privacy page keeps the
// Profile sharing wording that predates it. It is a build-time switch, apart
// from the backend's FREIGHT_FATE_PAPER, so dev can reach main before the
// paper launches. Set to true on 2026-11-26, ahead of the backend switch, so
// the privacy page says what the paper may print before it reads anything.
// The paper's What's New entry stays a draft until the first issue is out:
// its link is a not-found page until then. Take `draft` off that day, with
// that day's date.
export const PAPER_ANNOUNCED = true;
