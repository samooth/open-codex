import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  getModelPricing,
  MODEL_PRICING,
  resetCachedPricing,
} from "../src/utils/model-pricing";

// Mock the fs, os, and path modules
vi.mock("node:fs");
vi.mock("node:os");
vi.mock("node:path");

describe("getModelPricing", () => {
  beforeEach(() => {
    // Reset the cache before each test to ensure isolation
    resetCachedPricing();

    // Reset all mocks before each test
    vi.resetAllMocks();

    // Mock os.homedir() to provide a consistent fake home directory
    vi.spyOn(os, "homedir").mockReturnValue("/fake/home");

    // Mock path.join to correctly construct the config path
    vi.spyOn(path, "join").mockImplementation((...paths) => {
      // Basic implementation for this test's needs
      return paths.join("/");
    });
  });

  it("should return the correct pricing for a standard model", () => {
    // @ts-expect-error - mock
    fs.existsSync.mockReturnValue(false);
    expect(getModelPricing("gpt-4")).toEqual(MODEL_PRICING["gpt-4"]);
  });

  it("should return null for a model that does not exist", () => {
    // @ts-expect-error - mock
    fs.existsSync.mockReturnValue(false);
    expect(getModelPricing("non-existent-model")).toBeNull();
  });

  it("should prioritize the longest matching key", () => {
    // @ts-expect-error - mock
    fs.existsSync.mockReturnValue(false);
    // This is the important test case. "gpt-4" is a substring of "gpt-4-turbo",
    // but we expect the more specific "gpt-4-turbo" pricing.
    // This requires the implementation to be careful about matching.
    // The current implementation has a bug here, this test will fail until it's fixed.
    expect(getModelPricing("gpt-4-turbo-preview")).toEqual(
      MODEL_PRICING["gpt-4-turbo"],
    );
  });

  it("should load and use user-defined pricing from the config file", () => {
    const userPricing = {
      "custom-model": {
        input: 100.0,
        output: 200.0,
      },
      // User can also override default models
      "gpt-4": {
        input: 99.99,
        output: 199.99,
      },
    };

    // @ts-expect-error - mock
    fs.existsSync.mockReturnValue(true);
    // @ts-expect-error - mock
    fs.readFileSync.mockReturnValue(JSON.stringify(userPricing));

    // Test the custom model
    expect(getModelPricing("custom-model")).toEqual(
      userPricing["custom-model"],
    );

    // Test the overridden model
    expect(getModelPricing("gpt-4")).toEqual(userPricing["gpt-4"]);
  });

  it("should handle a malformed user pricing file gracefully", () => {
    // @ts-expect-error - mock
    fs.existsSync.mockReturnValue(true);
    // @ts-expect-error - mock
    fs.readFileSync.mockReturnValue('{"bad json":,');

    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    // It should not throw and should fall back to the default pricing
    expect(() => getModelPricing("gpt-4")).not.toThrow();
    expect(getModelPricing("gpt-4")).toEqual(MODEL_PRICING["gpt-4"]);
    expect(consoleErrorSpy).toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });
});
