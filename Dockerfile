# --- Stage 1: build ---------------------------------------------------------
FROM node:22-alpine AS builder
WORKDIR /app

# Instala dependências (inclui dev) para compilar o TypeScript.
COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# --- Stage 2: runtime -------------------------------------------------------
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# Apenas dependências de produção na imagem final (menor superfície).
COPY package*.json ./
RUN npm ci --omit=dev

# Artefato compilado do estágio de build.
COPY --from=builder /app/dist ./dist

# Banco de perguntas (lido em runtime por QuestionBankService via <cwd>/questions).
# Sem isto a imagem sobe sem /app/questions e o boot falha com ENOENT (crash loop).
COPY --from=builder /app/questions ./questions

EXPOSE 3000
CMD ["node", "dist/main"]
