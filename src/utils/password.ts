import bcrypt from "bcrypt";

// 10 (el default histórico de bcrypt) ya se considera bajo para 2025+ con el hardware actual —
// 12 es la referencia habitual hoy (OWASP), y en un login/registro (no en un hot path repetido)
// el coste extra de CPU es imperceptible para el usuario.
const SALT_ROUNDS = 12;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export async function comparePassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
