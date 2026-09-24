import Joi from "joi";
import { isValidTimezone } from "../utils/timezone";

// Minúsculas, números, puntos y guiones bajos — igual que el username que hubo temporalmente
// como alias del email (ver historial); ahora es un campo propio, obligatorio al registrarse.
export const USERNAME_PATTERN = /^[a-z0-9_.]{3,30}$/;
const usernameMessage = "El nombre de usuario debe tener 3-30 caracteres: minúsculas, números, puntos o guiones bajos";

// Al menos una letra y un número — no pide mayúsculas/símbolos a propósito (esa exigencia empuja
// a la gente a patrones predecibles tipo "Password1!"), pero sí descarta lo más débil y más común
// en listas de contraseñas filtradas (solo dígitos tipo "12345678", o solo letras tipo
// "contraseña"). max(72) es un límite duro de bcrypt (trunca en silencio pasado ese byte, ver
// hashPassword), no una elección de política.
const PASSWORD_PATTERN = /^(?=.*[A-Za-z])(?=.*\d).*$/;
const passwordMessage = "La contraseña debe tener al menos 8 caracteres, con alguna letra y algún número";

function timezoneSchema() {
  return Joi.string()
    .custom((value, helpers) => {
      if (!isValidTimezone(value)) {
        return helpers.error("any.invalid");
      }
      return value;
    })
    .messages({ "any.invalid": "timezone debe ser una zona horaria IANA válida (ej. 'Europe/Madrid')" });
}

export const registerSchema = Joi.object({
  username: Joi.string().pattern(USERNAME_PATTERN).required().messages({ "string.pattern.base": usernameMessage }),
  email: Joi.string().email().required(),
  password: Joi.string().min(8).max(72).pattern(PASSWORD_PATTERN).required().messages({ "string.pattern.base": passwordMessage }),
  name: Joi.string().min(2).max(100).required(),
  // Opcional: si no se indica, Prisma aplica el default del schema ("Europe/Madrid").
  timezone: timezoneSchema(),
});

// Login por email O por username indistintamente — `identifier` es lo que sea que el usuario
// haya escrito, el service decide con un OR en la query cuál de los dos es.
export const loginSchema = Joi.object({
  identifier: Joi.string().required(),
  password: Joi.string().required(),
});

export const refreshSchema = Joi.object({
  refreshToken: Joi.string().required(),
});

export const updateProfileSchema = Joi.object({
  name: Joi.string().min(2).max(100),
  lastName: Joi.string().min(1).max(100).allow(null, ""),
  username: Joi.string().pattern(USERNAME_PATTERN).messages({ "string.pattern.base": usernameMessage }),
  // Cambiar el email no tiene el cooldown de 15 días (ese es del username) — pero sí dispara
  // una nueva verificación (ver authService.updateProfile).
  email: Joi.string().email(),
  timezone: timezoneSchema(),
})
  .min(1)
  .messages({ "any.invalid": "timezone debe ser una zona horaria IANA válida (ej. 'Europe/Madrid')" });

// Mismas reglas que registerSchema.password (min 8, max 72, letra+número).
// currentPassword no lleva min/max/pattern: se compara tal cual contra el hash guardado, no se
// está creando una contraseña nueva con esa, así que no tiene sentido validarle formato aquí.
export const changePasswordSchema = Joi.object({
  currentPassword: Joi.string().required(),
  newPassword: Joi.string().min(8).max(72).pattern(PASSWORD_PATTERN).required().messages({ "string.pattern.base": passwordMessage }),
});

export const verifyEmailSchema = Joi.object({
  token: Joi.string().required(),
});

// Mismos 7 apartados opcionales que `User.enabledSections` en schema.prisma — "Hoy" y "Agenda"
// no son opcionales, así que no están aquí. Exportada para que el controller/tests puedan
// reutilizarla sin duplicar la lista de valores válidos.
export const ENABLED_SECTIONS = ["planificador", "horario", "objetivos", "galeria", "finanzas", "metasAhorro", "proyectos"] as const;

export const completeOnboardingSchema = Joi.object({
  enabledSections: Joi.array().items(Joi.string().valid(...ENABLED_SECTIONS)).unique().required(),
});

// Ambos campos opcionales (a diferencia de completeOnboardingSchema): reordenar un apartado no
// manda menuLayout, y cambiar de diseño no manda menuOrder — pero al menos uno de los dos tiene
// que venir, si no la petición no cambiaría nada.
export const updateMenuPreferencesSchema = Joi.object({
  menuLayout: Joi.string().valid("default", "compact"),
  menuOrder: Joi.array().items(Joi.string()),
})
  .or("menuLayout", "menuOrder");
