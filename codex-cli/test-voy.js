import { Voy } from "voy-search";

try {
  const index = new Voy();
  console.log("Voy initialized successfully");
  index.add({
    id: "test",
    title: "test",
    body: "test content",
    embeddings: [0.1, 0.2, 0.3]
  });
  console.log("Item added successfully");
  const results = index.search([0.1, 0.2, 0.3], 1);
  console.log("Search result:", results.neighbors[0].id);
} catch (err) {
  console.error("Voy failed:", err);
}
