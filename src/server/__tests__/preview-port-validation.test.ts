import { describe, it, expect } from "vitest";
import { isValidPreviewPort, BLOCKED_PREVIEW_PORTS } from "../routes/preview.js";

describe("Preview port validation (M1)", () => {
  it("allows standard dev server ports", () => {
    expect(isValidPreviewPort(3000)).toBe(true);
    expect(isValidPreviewPort(5173)).toBe(true);
    expect(isValidPreviewPort(8080)).toBe(true);
    expect(isValidPreviewPort(9000)).toBe(true);
  });

  it("rejects ports below 1024", () => {
    expect(isValidPreviewPort(80)).toBe(false);
    expect(isValidPreviewPort(443)).toBe(false);
    expect(isValidPreviewPort(1023)).toBe(false);
  });

  it("allows port 1024 (boundary)", () => {
    expect(isValidPreviewPort(1024)).toBe(true);
  });

  it("allows port 65535 (boundary)", () => {
    expect(isValidPreviewPort(65535)).toBe(true);
  });

  it("rejects ports above 65535", () => {
    expect(isValidPreviewPort(65536)).toBe(false);
    expect(isValidPreviewPort(100000)).toBe(false);
  });

  it("rejects non-integer ports", () => {
    expect(isValidPreviewPort(3000.5)).toBe(false);
    expect(isValidPreviewPort(NaN)).toBe(false);
  });

  it("rejects well-known infrastructure ports", () => {
    for (const port of BLOCKED_PREVIEW_PORTS) {
      expect(isValidPreviewPort(port)).toBe(false);
    }
  });

  it("blocks SSH (22)", () => {
    expect(isValidPreviewPort(22)).toBe(false);
  });

  it("blocks PostgreSQL (5432)", () => {
    expect(isValidPreviewPort(5432)).toBe(false);
  });

  it("blocks Redis (6379)", () => {
    expect(isValidPreviewPort(6379)).toBe(false);
  });

  it("blocks Elasticsearch (9200)", () => {
    expect(isValidPreviewPort(9200)).toBe(false);
  });

  it("blocks MongoDB (27017)", () => {
    expect(isValidPreviewPort(27017)).toBe(false);
  });
});
