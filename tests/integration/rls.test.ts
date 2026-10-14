import { prisma } from "../../src/config/database";

// Tidely solo accede a la base desde su API (Prisma, rol propietario), pero Supabase expone por defecto el esquema
// `public` en su Data API: una tabla sin RLS queda abierta a cualquiera con la URL y la clave `anon` (avisos
// rls_disabled_in_public / sensitive_columns_exposed). La migración 20261014090000_enable_rls_all_tables lo cierra
// para las tablas existentes; este test hace que una tabla NUEVA que olvide `ENABLE ROW LEVEL SECURITY` rompa el CI
// en vez de llegar a producción.
describe("Seguridad de la base de datos", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("todas las tablas del esquema public tienen RLS activado", async () => {
    const rows = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT c.relname AS tablename
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relrowsecurity
      ORDER BY c.relname
    `;

    // Si falla: añade `ALTER TABLE "<tabla>" ENABLE ROW LEVEL SECURITY;` a la migración que crea la tabla.
    expect(rows.map((r) => r.tablename)).toEqual([]);
  });
});
