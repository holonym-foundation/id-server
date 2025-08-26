import axios from "axios";
import chai from "chai";
import chaiAsPromised from "chai-as-promised";
import { getDateAsInt } from "../dist/utils/utils.js";
import dotenv from "dotenv";
dotenv.config();

chai.use(chaiAsPromised);
const expect = chai.expect;

describe("getDateAsInt", async () => {
  it("Should throw error if date is in format yyyy-mm", async () => {
    const date = "1900-01";
    expect(() => getDateAsInt(date)).to.throw();
  });

  it("Should throw error if date is in format dd-mm-yyyy", async () => {
    const date = "01-01-1900";
    expect(() => getDateAsInt(date)).to.throw();
  });

  it("Should throw error if date is in format mm-dd-yyyy", async () => {
    const date = "01-01-1900";
    expect(() => getDateAsInt(date)).to.throw();
  });

  it("Should throw error if date is in format yyyy/mm/dd", async () => {
    const date = "01/01/1900";
    expect(() => getDateAsInt(date)).to.throw();
  });

  // BEGIN 1900 tests

  it("Should throw an error, given 1900-01-32", async () => {
    const date = "1900-01-32";
    expect(() => getDateAsInt(date)).to.throw();
  });

  it("Should convert 1900-01-01 to 0", async () => {
    const date = "1900-01-01";
    const dateAsInt = getDateAsInt(date);
    expect(dateAsInt).to.equal(0);
  });

  it("Should convert 1900-01-02 to 86400", async () => {
    const date = "1900-01-02";
    const dateAsInt = getDateAsInt(date);
    expect(dateAsInt).to.equal(86400);
  });

  it("Should convert 1900-01-31 to 2592000", async () => {
    const date = "1900-01-31";
    const dateAsInt = getDateAsInt(date);
    expect(dateAsInt).to.equal(2592000);
  });

  it("Should convert 1900-02-01 to 2678400", async () => {
    const date = "1900-02-01";
    const dateAsInt = getDateAsInt(date);
    expect(dateAsInt).to.equal(2678400);
  });

  // BEGIN 1970 tests

  it("Should throw an error, given 1970-01-32", async () => {
    const date = "1970-01-32";
    expect(() => getDateAsInt(date)).to.throw();
  });

  it("Should convert 1970-01-01 to 2208988800", async () => {
    const date = "1970-01-01";
    const dateAsInt = getDateAsInt(date);
    expect(dateAsInt).to.equal(2208988800);
  });

  it("Should convert 1970-01-02 to 2208988800+86400", async () => {
    const date = "1970-01-02";
    const dateAsInt = getDateAsInt(date);
    expect(dateAsInt).to.equal(2208988800 + 86400);
  });

  it("Should convert 2099-12-31 to 6311347200", async () => {
    const date = "2099-12-31";
    const dateAsInt = getDateAsInt(date);
    expect(dateAsInt).to.equal(6311347200);
  });
});
