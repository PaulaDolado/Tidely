import { encrypt, decrypt } from "../../../src/utils/encryption";

describe("encryption utils", () => {
  it("cifra y descifra un texto, recuperando exactamente el original", () => {
    const plaintext = "ya29.a0AfH6SMC...token-de-verdad-de-google";
    const ciphertext = encrypt(plaintext);
    expect(ciphertext).not.toBe(plaintext);
    expect(decrypt(ciphertext)).toBe(plaintext);
  });

  it("dos cifrados del mismo texto no son iguales (IV aleatorio por llamada)", () => {
    const plaintext = "mismo-token";
    expect(encrypt(plaintext)).not.toBe(encrypt(plaintext));
  });

  it("decrypt() devuelve tal cual un valor sin el prefijo cifrado (migración perezosa de tokens en claro)", () => {
    const legacyPlaintextToken = "1//0gToken-guardado-antes-de-que-existiera-el-cifrado";
    expect(decrypt(legacyPlaintextToken)).toBe(legacyPlaintextToken);
  });

  it("lanza si el ciphertext fue manipulado (autenticado — GCM detecta la manipulación)", () => {
    const ciphertext = encrypt("dato sensible");
    const tampered = ciphertext.slice(0, -4) + "xxxx";
    expect(() => decrypt(tampered)).toThrow();
  });
});
