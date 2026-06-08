# Deploy contínuo (CD) — backend na VPS

Deploy automático: **merge na `main` → tag `vX.Y.Z` → imagem no ghcr.io → deploy na VPS**.
Tudo no workflow `.github/workflows/release.yml` (jobs `release` e `build-and-deploy`).

```
merge main ─> cria tag ─> build + push (ghcr privado) ─> SSH na VPS: compose pull + up -d
```

A VPS roda só a **imagem pronta** (não builda, não tem o código-fonte). Convive com os outros
apps: Redis sem porta exposta, backend em `127.0.0.1:3003`, Nginx do host faz proxy + TLS.

---

## Parte 1 — Secrets no GitHub (uma vez)

Repo → Settings → Secrets and variables → Actions → **New repository secret**:

| Secret | Valor |
| ------ | ----- |
| `VPS_HOST` | IP ou hostname da VPS |
| `VPS_USER` | usuário SSH (ex.: `root` ou um usuário de deploy) |
| `VPS_SSH_KEY` | **chave privada** do par de deploy (conteúdo completo, formato PEM) |
| `VPS_PORT` | porta SSH (opcional; default 22) |
| `VPS_DEPLOY_DIR` | caminho do deploy na VPS (ex.: `/opt/proexgame-deploy`) |

### Gerar o par de chaves de deploy
Na sua máquina (ou na VPS):
```bash
ssh-keygen -t ed25519 -C "github-deploy-proexgame" -f proexgame_deploy -N ""
# proexgame_deploy      -> conteúdo vai em VPS_SSH_KEY (privada)
# proexgame_deploy.pub  -> adicionar na VPS (passo 2)
```

---

## Parte 2 — Bootstrap da VPS (uma vez)

```bash
# 2.1 Autorizar a chave de deploy
echo "CONTEUDO_DO_proexgame_deploy.pub" >> ~/.ssh/authorized_keys

# 2.2 Login no ghcr (imagem é privada). Use um PAT com escopo read:packages.
#     Settings → Developer settings → Personal access tokens → Tokens (classic).
echo "SEU_PAT_read_packages" | docker login ghcr.io -u SEU_USUARIO_GITHUB --password-stdin
#     Isso fica salvo em ~/.docker/config.json — o CI não precisa passar token a cada deploy.

# 2.3 Diretório de deploy + arquivos (sem código-fonte!)
sudo mkdir -p /opt/proexgame-deploy
cd /opt/proexgame-deploy
#   Copie para cá: docker-compose.prod.yml (mantenha o nome) e .env
#   Ex.: baixe do repo via raw, ou scp, ou cole na mão.
cp /caminho/deploy/docker-compose.prod.yml ./docker-compose.prod.yml
cp /caminho/deploy/.env.example ./.env      # ajuste IMAGE_TAG/BACKEND_PORT se quiser

# 2.4 Primeira subida (a primeira imagem precisa já existir no ghcr — ver Parte 4)
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml ps
curl -sN 'http://127.0.0.1:3003/socket.io/?EIO=4&transport=polling' | head -c 40
```

---

## Parte 3 — Nginx + TLS (uma vez, no host)

```bash
sudo cp /caminho/deploy/nginx/jogo.conf /etc/nginx/sites-available/jogo
sudo sed -i 's/SEU_DOMINIO/seudominio.com/g' /etc/nginx/sites-available/jogo
sudo ln -s /etc/nginx/sites-available/jogo /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d jogo.seudominio.com
```
Lembrar do **A record** `jogo.seudominio.com → IP_DA_VPS` antes do certbot.
O front (build do outro repo) vai em `/var/www/jogo`.

---

## Parte 4 — A partir daqui é automático

Todo merge na `main` cria a tag, publica a imagem e faz o deploy sozinho.

> A **primeira** imagem precisa existir no ghcr antes do primeiro `compose pull`.
> Faça um merge qualquer na main (gera a imagem) **ou** dispare o workflow manualmente
> uma vez. Depois disso, o ciclo roda inteiro a cada merge.

### Rollback
```bash
cd /opt/proexgame-deploy
sed -i 's/^IMAGE_TAG=.*/IMAGE_TAG=0.1.0/' .env   # versão estável anterior (sem o "v": as imagens no ghcr usam new_version)
docker compose -f docker-compose.prod.yml pull && docker compose -f docker-compose.prod.yml up -d
```

### Operação
```bash
docker compose -f docker-compose.prod.yml logs -f backend     # logs
docker compose -f docker-compose.prod.yml ps                  # status
```
