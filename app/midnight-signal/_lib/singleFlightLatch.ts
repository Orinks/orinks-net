export class SingleFlightLatch {
  private active = false;

  tryStart() {
    if (this.active) return false;
    this.active = true;
    return true;
  }

  release() {
    this.active = false;
  }
}
