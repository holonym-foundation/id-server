import { describe, it, expect } from "bun:test";
import { getDateAsInt } from "./utils.js";
import dotenv from "dotenv";
dotenv.config();

describe("getDateAsInt", () => {
  it("Should throw error if date is in format yyyy-mm", () => {
    const date = "1900-01";
    expect(() => getDateAsInt(date)).toThrow();
  });

  it("Should throw error if date is in format dd-mm-yyyy", () => {
    const date = "01-01-1900";
    expect(() => getDateAsInt(date)).toThrow();
  });

  it("Should throw error if date is in format mm-dd-yyyy", () => {
    const date = "01-01-1900";
    expect(() => getDateAsInt(date)).toThrow();
  });

  it("Should throw error if date is in format yyyy/mm/dd", () => {
    const date = "01/01/1900";
    expect(() => getDateAsInt(date)).toThrow();
  });

  // BEGIN 1900 tests

  it("Should throw an error, given 1900-01-32", () => {
    const date = "1900-01-32";
    expect(() => getDateAsInt(date)).toThrow();
  });

  it("Should convert 1900-01-01 to 0", () => {
    const date = "1900-01-01";
    const dateAsInt = getDateAsInt(date);
    expect(dateAsInt).toBe(0);
  });

  it("Should convert 1900-01-02 to 86400", () => {
    const date = "1900-01-02";
    const dateAsInt = getDateAsInt(date);
    expect(dateAsInt).toBe(86400);
  });

  it("Should convert 1900-01-31 to 2592000", () => {
    const date = "1900-01-31";
    const dateAsInt = getDateAsInt(date);
    expect(dateAsInt).toBe(2592000);
  });

  it("Should convert 1900-02-01 to 2678400", () => {
    const date = "1900-02-01";
    const dateAsInt = getDateAsInt(date);
    expect(dateAsInt).toBe(2678400);
  });

  // BEGIN 1970 tests

  it("Should throw an error, given 1970-01-32", () => {
    const date = "1970-01-32";
    expect(() => getDateAsInt(date)).toThrow();
  });

  it("Should convert 1970-01-01 to 2208988800", () => {
    const date = "1970-01-01";
    const dateAsInt = getDateAsInt(date);
    expect(dateAsInt).toBe(2208988800);
  });

  it("Should convert 1970-01-02 to 2208988800+86400", () => {
    const date = "1970-01-02";
    const dateAsInt = getDateAsInt(date);
    expect(dateAsInt).toBe(2208988800 + 86400);
  });

  it("Should convert 2099-12-31 to 6311347200", () => {
    const date = "2099-12-31";
    const dateAsInt = getDateAsInt(date);
    expect(dateAsInt).toBe(6311347200);
  });
});
