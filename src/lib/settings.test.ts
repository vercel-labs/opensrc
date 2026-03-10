// Tests environment and persisted settings behavior for file modification permissions.
import { describe, it, expect } from "vitest";
import { isFileModificationDisabledByEnv } from "./settings.js";

describe("isFileModificationDisabledByEnv", () => {
  it("returns true when OPENSRC_DISABLE_MODIFY is 1", () => {
    expect(
      isFileModificationDisabledByEnv({
        OPENSRC_DISABLE_MODIFY: "1",
      }),
    ).toBe(true);
  });

  it("returns false when OPENSRC_DISABLE_MODIFY is missing", () => {
    expect(isFileModificationDisabledByEnv({})).toBe(false);
  });

  it("returns false for non-1 values", () => {
    expect(
      isFileModificationDisabledByEnv({
        OPENSRC_DISABLE_MODIFY: "true",
      }),
    ).toBe(false);
    expect(
      isFileModificationDisabledByEnv({
        OPENSRC_DISABLE_MODIFY: "0",
      }),
    ).toBe(false);
  });
});
