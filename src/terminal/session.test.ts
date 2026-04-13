import { beforeEach, describe, expect, it } from "vitest";
import { getResumeHandler, hasPendingResume, setResumeHandler } from "@/terminal/session";

// Resume-handler state is module-scoped — reset before every test so case
// ordering is irrelevant.
describe("resume handler state", () => {
  beforeEach(() => {
    setResumeHandler(null);
  });

  it("starts empty", () => {
    expect(hasPendingResume()).toBe(false);
    expect(getResumeHandler()).toBeNull();
  });

  it("setResumeHandler stores the handler and flips hasPendingResume", () => {
    const h = (_: string): void => {};
    setResumeHandler(h);
    expect(getResumeHandler()).toBe(h);
    expect(hasPendingResume()).toBe(true);
  });

  it("setResumeHandler(null) clears the handler", () => {
    setResumeHandler((_: string): void => {});
    setResumeHandler(null);
    expect(getResumeHandler()).toBeNull();
    expect(hasPendingResume()).toBe(false);
  });
});
