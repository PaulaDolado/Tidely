import { Request, Response } from "express";
import { AuthRequest } from "../../../src/middlewares/authMiddleware";
import { signGoogleOAuthState } from "../../../src/utils/jwt";
import { getConnectUrl, handleCallback } from "../../../src/controllers/googleCalendarController";
import * as googleCalendarService from "../../../src/services/googleCalendarService";

// El servicio habla con Google y con la BD: aquí solo se prueba la decisión de a dónde redirigir.
jest.mock("../../../src/services/googleCalendarService");
const mockedService = googleCalendarService as jest.Mocked<typeof googleCalendarService>;

function mockRes(): Response {
  return { redirect: jest.fn(), json: jest.fn() } as unknown as Response;
}

function callbackReq(query: Record<string, string>): Request {
  return { query } as unknown as Request;
}

describe("googleCalendarController", () => {
  describe("getConnectUrl", () => {
    const next = jest.fn();

    it("sin client pide la URL como web", async () => {
      mockedService.getAuthUrl.mockReturnValue("https://accounts.google.com/x");
      const res = mockRes();
      await getConnectUrl({ userId: 1, query: {} } as unknown as AuthRequest, res, next);
      expect(mockedService.getAuthUrl).toHaveBeenCalledWith(1, "web");
      expect(res.json).toHaveBeenCalledWith({ url: "https://accounts.google.com/x" });
    });

    it("con client=mobile la pide como móvil", async () => {
      mockedService.getAuthUrl.mockReturnValue("https://accounts.google.com/x");
      await getConnectUrl({ userId: 1, query: { client: "mobile" } } as unknown as AuthRequest, mockRes(), next);
      expect(mockedService.getAuthUrl).toHaveBeenCalledWith(1, "mobile");
    });
  });

  describe("handleCallback", () => {
    it("web: éxito redirige al dashboard con ?google=connected", async () => {
      mockedService.handleOAuthCallback.mockResolvedValue(undefined);
      const res = mockRes();
      await handleCallback(callbackReq({ code: "c", state: signGoogleOAuthState(1) }), res);
      expect(res.redirect).toHaveBeenCalledWith(expect.stringMatching(/\/\?google=connected$/));
    });

    it("web: fallo redirige al dashboard con ?google=error", async () => {
      mockedService.handleOAuthCallback.mockRejectedValue(new Error("boom"));
      const res = mockRes();
      await handleCallback(callbackReq({ code: "c", state: signGoogleOAuthState(1) }), res);
      expect(res.redirect).toHaveBeenCalledWith(expect.stringMatching(/\/\?google=error$/));
    });

    it("móvil: éxito redirige al deep link con status=connected", async () => {
      mockedService.handleOAuthCallback.mockResolvedValue(undefined);
      const res = mockRes();
      await handleCallback(callbackReq({ code: "c", state: signGoogleOAuthState(1, "mobile") }), res);
      expect(res.redirect).toHaveBeenCalledWith("tidely://google?status=connected");
    });

    it("móvil: fallo procesando el callback redirige al deep link con status=error", async () => {
      mockedService.handleOAuthCallback.mockRejectedValue(new Error("boom"));
      const res = mockRes();
      await handleCallback(callbackReq({ code: "c", state: signGoogleOAuthState(1, "mobile") }), res);
      expect(res.redirect).toHaveBeenCalledWith("tidely://google?status=error");
    });

    it("móvil: si el usuario deniega el consentimiento (error + state) también vuelve a la app", async () => {
      const res = mockRes();
      await handleCallback(callbackReq({ error: "access_denied", state: signGoogleOAuthState(1, "mobile") }), res);
      expect(res.redirect).toHaveBeenCalledWith("tidely://google?status=error");
      expect(mockedService.handleOAuthCallback).not.toHaveBeenCalled();
    });

    it("state manipulado o ausente cae al redirect web de error (nunca al deep link)", async () => {
      mockedService.handleOAuthCallback.mockRejectedValue(new Error("state inválido"));
      const tampered = signGoogleOAuthState(1, "mobile").slice(0, -2) + "xx";
      const res = mockRes();
      await handleCallback(callbackReq({ code: "c", state: tampered }), res);
      expect(res.redirect).toHaveBeenCalledWith(expect.stringMatching(/\/\?google=error$/));

      const res2 = mockRes();
      await handleCallback(callbackReq({ code: "c" }), res2);
      expect(res2.redirect).toHaveBeenCalledWith(expect.stringMatching(/\/\?google=error$/));
    });
  });
});
