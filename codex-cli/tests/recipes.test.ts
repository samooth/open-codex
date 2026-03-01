import { describe, it, expect } from "vitest";
import { recipes } from "../src/utils/recipes.js";

describe("Recipe Definitions", () => {
  it("exports an array of recipes", () => {
    expect(Array.isArray(recipes)).toBe(true);
    expect(recipes.length).toBeGreaterThan(0);
  });

  it("each recipe has required fields", () => {
    recipes.forEach((recipe) => {
      expect(typeof recipe.name).toBe("string");
      expect(recipe.name.length).toBeGreaterThan(0);

      expect(typeof recipe.description).toBe("string");
      expect(recipe.description.length).toBeGreaterThan(0);

      expect(typeof recipe.prompt).toBe("string");
      expect(recipe.prompt.length).toBeGreaterThan(0);
    });
  });

  it("has unique names for recipes", () => {
    const names = recipes.map((r) => r.name);
    const uniqueNames = new Set(names);
    expect(uniqueNames.size).toBe(names.length);
  });
});
