import { Router } from "express";
import * as authController from "../controllers/authController";
import { authMiddleware } from "../middlewares/authMiddleware";
import { validate } from "../middlewares/validation";
import {
  registerSchema,
  loginSchema,
  refreshSchema,
  updateProfileSchema,
  changePasswordSchema,
  verifyEmailSchema,
  completeOnboardingSchema,
} from "../validators/authValidators";

const router = Router();

/**
 * @openapi
 * /auth/register:
 *   post:
 *     tags: [Auth]
 *     summary: Registro de usuario — elige un nombre de usuario y un email (que habrá que verificar después)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [username, email, password, name]
 *             properties:
 *               username: { type: string, minLength: 3, maxLength: 30 }
 *               email: { type: string, format: email }
 *               password: { type: string, minLength: 8 }
 *               name: { type: string }
 *     responses:
 *       201: { description: Usuario creado, retorna token + refreshToken (el login no exige el email verificado) }
 *       409: { description: El email o el nombre de usuario ya existen }
 */
router.post("/register", validate(registerSchema), authController.register);

/**
 * @openapi
 * /auth/login:
 *   post:
 *     tags: [Auth]
 *     summary: Login con nombre de usuario O email indistintamente
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [identifier, password]
 *             properties:
 *               identifier: { type: string, description: "Username o email" }
 *               password: { type: string }
 *     responses:
 *       200: { description: Login correcto, retorna token + refreshToken }
 *       401: { description: Credenciales inválidas }
 */
router.post("/login", validate(loginSchema), authController.login);

/**
 * @openapi
 * /auth/refresh:
 *   post:
 *     tags: [Auth]
 *     summary: Refrescar token expirado
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [refreshToken]
 *             properties:
 *               refreshToken: { type: string }
 *     responses:
 *       200: { description: Nuevo token + refreshToken }
 *       401: { description: Refresh token inválido o expirado }
 */
router.post("/refresh", validate(refreshSchema), authController.refresh);

/**
 * @openapi
 * /auth/verify-email:
 *   post:
 *     tags: [Auth]
 *     summary: Confirma un email a partir del token del enlace de verificación — no requiere estar logueado
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [token]
 *             properties:
 *               token: { type: string }
 *     responses:
 *       200: { description: Email verificado, retorna el perfil actualizado }
 *       400: { description: Token inválido o caducado }
 */
router.post("/verify-email", validate(verifyEmailSchema), authController.verifyEmail);

/**
 * @openapi
 * /auth/me:
 *   get:
 *     tags: [Auth]
 *     summary: Perfil del usuario autenticado
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ id, email, username, name, lastName, timezone, emailVerified, nextUsernameChangeAllowedAt }" }
 *   put:
 *     tags: [Auth]
 *     summary: Actualizar nombre, apellido, username, email y/o timezone
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Perfil actualizado }
 */
router.get("/me", authMiddleware, authController.getProfile);
router.put("/me", authMiddleware, validate(updateProfileSchema), authController.updateProfile);

/**
 * @openapi
 * /auth/me/onboarding:
 *   put:
 *     tags: [Auth]
 *     summary: Guarda los apartados elegidos en el asistente de bienvenida y marca la cuenta como ya pasada por él
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Perfil actualizado, con onboardingCompleted=true }
 */
router.put(
  "/me/onboarding",
  authMiddleware,
  validate(completeOnboardingSchema),
  authController.completeOnboarding
);

/**
 * @openapi
 * /auth/resend-verification:
 *   post:
 *     tags: [Auth]
 *     summary: Reenvía el email de verificación (no-op si ya está verificado)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Reenviado (o no-op si ya estaba verificado) }
 */
router.post("/resend-verification", authMiddleware, authController.resendVerification);

/**
 * @openapi
 * /auth/me/password:
 *   put:
 *     tags: [Auth]
 *     summary: Cambiar la contraseña del usuario autenticado
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [currentPassword, newPassword]
 *             properties:
 *               currentPassword: { type: string }
 *               newPassword: { type: string, minLength: 8 }
 *     responses:
 *       200: { description: Contraseña actualizada }
 *       401: { description: La contraseña actual no es correcta }
 */
router.put("/me/password", authMiddleware, validate(changePasswordSchema), authController.changePassword);

export default router;
