export type AnnouncementChannel = "status" | "alert";

interface QueueOptions {
  emit: (channel: AnnouncementChannel, text: string) => void;
  schedule?: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
  cancel?: (timer: ReturnType<typeof setTimeout>) => void;
}

interface AnnouncementItem {
  channel: AnnouncementChannel;
  text: string;
}

const BATCH_MS = 30;
const RESET_MS = 50;

function dwellTime(text: string) {
  const words = text.trim().split(/\s+/u).length;
  return Math.max(1200, Math.min(6000, words * 300));
}

/** Serializes clear/set cycles so later status updates cannot erase active speech. */
export class SerializedAnnouncementQueue {
  private readonly emit: QueueOptions["emit"];
  private readonly schedule: NonNullable<QueueOptions["schedule"]>;
  private readonly cancel: NonNullable<QueueOptions["cancel"]>;
  private pending: AnnouncementItem[] = [];
  private delivery: AnnouncementItem[] = [];
  private batchTimer: ReturnType<typeof setTimeout> | null = null;
  private cycleTimer: ReturnType<typeof setTimeout> | null = null;
  private speaking = false;

  constructor(options: QueueOptions) {
    this.emit = options.emit;
    this.schedule = options.schedule ?? setTimeout;
    this.cancel = options.cancel ?? clearTimeout;
  }

  enqueue(text: string, channel: AnnouncementChannel) {
    const trimmed = text.trim();
    if (!trimmed) return;
    this.pending.push({ text: trimmed, channel });
    if (this.batchTimer) return;
    this.batchTimer = this.schedule(() => this.flushBatch(), BATCH_MS);
  }

  dispose() {
    if (this.batchTimer) this.cancel(this.batchTimer);
    if (this.cycleTimer) this.cancel(this.cycleTimer);
    this.batchTimer = null;
    this.cycleTimer = null;
    this.pending = [];
    this.delivery = [];
    this.speaking = false;
  }

  private flushBatch() {
    this.batchTimer = null;
    if (this.pending.length === 0) return;
    const batch = this.pending;
    this.pending = [];
    const channel = batch.some((item) => item.channel === "alert") ? "alert" : "status";
    this.delivery.push({ channel, text: batch.map((item) => item.text).join(" ") });
    this.deliverNext();
  }

  private deliverNext() {
    if (this.speaking || this.delivery.length === 0) return;
    this.speaking = true;
    const item = this.delivery.shift()!;
    this.emit("status", "");
    this.emit("alert", "");
    this.cycleTimer = this.schedule(() => {
      this.cycleTimer = null;
      this.emit(item.channel, item.text);
      this.cycleTimer = this.schedule(() => {
        this.cycleTimer = null;
        this.speaking = false;
        this.deliverNext();
      }, dwellTime(item.text));
    }, RESET_MS);
  }
}
