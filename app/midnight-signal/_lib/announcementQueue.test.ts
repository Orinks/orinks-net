import { describe, expect, test } from "vitest";
import { SerializedAnnouncementQueue, type AnnouncementChannel } from "./announcementQueue";

function harness() {
  const emitted: Array<[AnnouncementChannel, string]> = [];
  const timers: Array<() => void> = [];
  const queue = new SerializedAnnouncementQueue({
    emit: (channel, text) => emitted.push([channel, text]),
    schedule: (callback) => {
      timers.push(callback);
      return timers.length as unknown as ReturnType<typeof setTimeout>;
    },
    cancel: () => {},
  });
  return { emitted, queue, timers };
}

describe("serialized announcement queue", () => {
  test("calls browser-like timer functions without an illegal receiver", () => {
    const timers: Array<() => void> = [];
    function receiverSensitiveScheduler(this: unknown, callback: () => void) {
      if (this !== undefined) throw new TypeError("Illegal invocation");
      timers.push(callback);
      return timers.length as unknown as ReturnType<typeof setTimeout>;
    }
    const queue = new SerializedAnnouncementQueue({
      emit: () => {},
      schedule: receiverSensitiveScheduler,
      cancel: () => {},
    });

    expect(() => queue.enqueue("Starting the broadcast.", "status")).not.toThrow();
  });

  test("bundles a mixed batch into the assertive channel only", () => {
    const { emitted, queue, timers } = harness();
    queue.enqueue("Routine update.", "status");
    queue.enqueue("Connection failed.", "alert");
    timers[0]();
    timers[1]();
    expect(emitted).toEqual([
      ["status", ""],
      ["alert", ""],
      ["alert", "Routine update. Connection failed."],
    ]);
  });

  test("does not overwrite the current delivery before its dwell cycle ends", () => {
    const { emitted, queue, timers } = harness();
    queue.enqueue("First.", "status");
    timers[0]();
    timers[1]();
    queue.enqueue("Second.", "status");
    timers[3]();
    expect(emitted.at(-1)).toEqual(["status", "First."]);
    timers[2]();
    timers[4]();
    expect(emitted.at(-1)).toEqual(["status", "Second."]);
  });
});
