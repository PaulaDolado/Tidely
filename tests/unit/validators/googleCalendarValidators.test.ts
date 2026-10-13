import { connectQuerySchema } from "../../../src/validators/googleCalendarValidators";

describe("googleCalendarValidators", () => {
  describe("connectQuerySchema", () => {
    it("acepta la query vacía (la web no manda client)", () => {
      expect(connectQuerySchema.validate({}).error).toBeUndefined();
    });

    it("acepta client=mobile y client=web", () => {
      expect(connectQuerySchema.validate({ client: "mobile" }).error).toBeUndefined();
      expect(connectQuerySchema.validate({ client: "web" }).error).toBeUndefined();
    });

    it("rechaza cualquier otro valor de client (incluida una URL)", () => {
      expect(connectQuerySchema.validate({ client: "ios" }).error).toBeDefined();
      expect(connectQuerySchema.validate({ client: "https://evil.example" }).error).toBeDefined();
    });
  });
});
