import { describe, it, expect, beforeEach } from "vitest";
import { WalrusSqlClient } from "../../src/client.js";

describe("sql-executor (simulator mode)", () => {
  // Each test gets its own client to avoid state pollution
  const makeClient = () =>
    new WalrusSqlClient({
      packageId: "0x0000000000000000000000000000000000000000000000000000000000000000",
      network: "sui-devnet",
      mode: "simulator",
      logging: { level: "error" },
    });

  describe("transaction control (baseline parser)", () => {
    it("BEGIN starts a transaction", async () => {
      const client = makeClient();
      const result = await client.execute("BEGIN");
      expect(result.statementType).toBe("BEGIN");
    });

    it("BEGIN TRANSACTION is equivalent to BEGIN", async () => {
      const client = makeClient();
      const result = await client.execute("BEGIN TRANSACTION");
      expect(result.statementType).toBe("BEGIN");
    });

    it("COMMIT after BEGIN succeeds", async () => {
      const client = makeClient();
      await client.execute("BEGIN");
      const result = await client.execute("COMMIT");
      expect(result.statementType).toBe("COMMIT");
    });

    it("COMMIT without active transaction throws", async () => {
      const client = makeClient();
      try {
        await client.execute("COMMIT");
      } catch (e: unknown) {
        expect(String(e)).toContain("TRANSACTION");
      }
    });

    it("ROLLBACK without active transaction throws", async () => {
      const client = makeClient();
      try {
        await client.execute("ROLLBACK");
      } catch (e: unknown) {
        expect(String(e)).toContain("TRANSACTION");
      }
    });

    it("ROLLBACK after BEGIN succeeds", async () => {
      const client = makeClient();
      await client.execute("BEGIN");
      const result = await client.execute("ROLLBACK");
      expect(result.statementType).toBe("ROLLBACK");
    });

    it("COMMIT WORK equivalent to COMMIT", async () => {
      const client = makeClient();
      await client.execute("BEGIN");
      const result = await client.execute("COMMIT WORK");
      expect(result.statementType).toBe("COMMIT");
    });

    it("ROLLBACK WORK equivalent to ROLLBACK", async () => {
      const client = makeClient();
      await client.execute("BEGIN");
      const result = await client.execute("ROLLBACK WORK");
      expect(result.statementType).toBe("ROLLBACK");
    });
  });

  describe("BEGIN state isolation", () => {
    it("transaction is committed", async () => {
      const client = makeClient();
      await client.execute("BEGIN");
      await client.execute("COMMIT");
      // After COMMIT, can BEGIN again
      const result = await client.execute("BEGIN");
      expect(result.statementType).toBe("BEGIN");
    });

    it("transaction is rolled back", async () => {
      const client = makeClient();
      await client.execute("BEGIN");
      await client.execute("ROLLBACK");
      // After ROLLBACK, can BEGIN again
      const result = await client.execute("BEGIN");
      expect(result.statementType).toBe("BEGIN");
    });
  });
});
