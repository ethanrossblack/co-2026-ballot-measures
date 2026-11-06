// Mutable state shared between modules (imported bindings are read-only, so it lives on one object)
export const state = {
  shapeMode: "circle", // "circle" = equal-area circle (default), "map" = county outline
  tableHoverId: null,  // county id under the pointer in the table, if any
  colors: {}           // CSS colour tokens read for canvas drawing
};
