FROM node:20-alpine

WORKDIR /app

# `node:20-alpine` no trae OpenSSL — sin él, el motor de Prisma ni siquiera sabe qué versión usar
# ("Prisma failed to detect the libssl/openssl version") y termina intentando cargar un binario
# que no encaja con la imagen. El síntoma es engañoso: "Could not parse schema engine response"
# en `prisma migrate deploy` es en realidad un error de carga de librería compartida camuflado de
# JSON inválido, no un problema con el esquema en sí.
RUN apk add --no-cache openssl

COPY package*.json ./
# `npm install` dispara el hook `postinstall` (`prisma generate`, ver package.json), que necesita
# `prisma/schema.prisma` — sin copiarlo antes, esa capa solo tiene package*.json y el postinstall
# falla con "Could not find Prisma Schema". Copiar solo `prisma/` aquí (no todo el repo todavía)
# mantiene el cacheo de capas de Docker: node_modules solo se reinstala si cambian package*.json
# o el propio esquema, no en cada cambio de código de src/.
COPY prisma ./prisma
RUN npm install

COPY . .
RUN npx prisma generate
RUN npm run build

EXPOSE 3000

# Aplica las migraciones pendientes contra la base de datos del contenedor antes de arrancar.
# `migrate deploy` (a diferencia de `migrate dev`) no pide confirmación ni genera migraciones
# nuevas — solo aplica las que ya existen en prisma/migrations, así que es seguro ejecutarlo
# en cada arranque: si ya están aplicadas, no hace nada.
CMD ["sh", "-c", "npx prisma migrate deploy && npm start"]
