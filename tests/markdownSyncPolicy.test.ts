import { describe, expect, test } from "bun:test";
import { shouldFetchMarkdownBody } from "../src/lib/markdownSyncPolicy";

describe("shouldFetchMarkdownBody", () => {
  test("fetches when server is newer than local watermark", () => {
    expect(
      shouldFetchMarkdownBody({
        serverUpdatedAt: 100,
        local: { updatedAt: 50, pending: false },
      }),
    ).toBe(true);
  });

  test("skips when local already has server version", () => {
    expect(
      shouldFetchMarkdownBody({
        serverUpdatedAt: 100,
        local: { updatedAt: 100, pending: false },
      }),
    ).toBe(false);
    expect(
      shouldFetchMarkdownBody({
        serverUpdatedAt: 100,
        local: { updatedAt: 101, pending: false },
      }),
    ).toBe(false);
  });

  test("fetches when there is no local cache", () => {
    expect(
      shouldFetchMarkdownBody({
        serverUpdatedAt: 1,
        local: null,
      }),
    ).toBe(true);
  });

  test("never overwrites while local edits are pending", () => {
    expect(
      shouldFetchMarkdownBody({
        serverUpdatedAt: 999,
        local: { updatedAt: 1, pending: true },
      }),
    ).toBe(false);
  });
});
