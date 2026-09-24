import { describe, expect, it } from "vitest";
import { requireGscResponse } from "./gscClient";

describe("feedback GSC availability", () => {
  it("rejects a snapshot window when every Search Console property failed", () => {
    expect(() => requireGscResponse(0)).toThrow("No GSC property responded");
  });

  it("accepts a window when at least one property responded", () => {
    expect(() => requireGscResponse(1)).not.toThrow();
  });
});
