# Jouri Intake / Binbon Kids Ürün Yönetim Paneli

Bu repo Binbon Kids ürün yönetim panelinin frontend, backend, veritabanı, yedekleme, Shopify entegrasyonu ve görsel arama servislerini içerir. Bu belge yeni bir VPS kurulumu, mevcut VPS'ten taşıma veya format sonrası sistemi tekrar ayağa kaldırmak için hazırlanmıştır.

## Mimari

Production ortamı Docker Compose ile çalışır:

| Servis | Teknoloji | Görev |
| --- | --- | --- |
| `caddy` | Caddy 2 | HTTPS ve reverse proxy. `/api/*` ve `/ws*` isteklerini API'ye, diğer istekleri frontend'e yönlendirir. |
| `client` | React + Vite + Nginx | Yönetim paneli arayüzü. |
| `api` | FastAPI + Alembic | Ürün, stok, satış, barkod, Shopify, yedekleme ve auth API'si. |
| `db` | PostgreSQL 16 | Ana veritabanı. |
| `vision-search` | FastAPI + Marqo FashionSigLIP | Görsel ile ürün arama. Ürün fotoğraflarını embedding ile karşılaştırır. |
| `ollama` | Ollama | Yerel metin/ürün açıklama işleme için opsiyonel AI servis katmanı. |

Ana dosyalar:

- `docker-compose.prod.yml`: VPS production kurulumu.
- `docker-compose.yml`: lokal geliştirme kurulumu.
- `Caddyfile`: domain ve reverse proxy ayarı.
- `.env.example`: gerekli ortam değişkenleri şablonu.
- `api/`: FastAPI backend.
- `client/`: React frontend.
- `vision-search/`: FashionSigLIP görsel arama servisi.

## Production dizin yapısı

VPS üzerinde önerilen yapı:

```bash
/home/ubuntu/jouri/
  jouri-intake/        # Git repo
  products_photo/      # Ürün fotoğrafları, git'e eklenmez
  backups/             # Yerel yedekler
```

Önemli: `products_photo/`, `backups/`, `.env`, SSH anahtarları ve rclone config dosyaları repoya commit edilmemelidir.

## Gereksinimler

Yeni VPS için:

- Ubuntu 22.04/24.04 benzeri Linux
- Docker Engine
- Docker Compose plugin
- Git
- En az 4 CPU / 16 GB RAM önerilir
- En az 80 GB disk önerilir; ürün fotoğrafları ve model cache büyüyebilir
- Domain DNS kaydı VPS IP'sine yönlenmiş olmalı

Mevcut test edilen VPS durumu:

- ARM CPU üzerinde çalışır.
- `vision-search` CPU stack ile çalışır.
- Marqo FashionSigLIP modeli Docker volume içinde cache'lenir.

## Repo ve güvenlik

Repo private olmalıdır. Kontrol:

```bash
gh repo view --json visibility,url
```

Beklenen:

```json
{"visibility":"PRIVATE"}
```

`.gitignore` içinde hassas dosyalar korunur:

- `.env`
- `.env.*`
- `vps/`
- `client/dist/`
- `node_modules/`
- `../products_photo/`
- log ve build dosyaları

SSH anahtarını repoya koyma. Lokal makinede mevcut anahtar örneği:

```text
vps/vps.txt
```

Bu klasör `.gitignore` içindedir ve Git tarafından takip edilmemelidir. Kontrol:

```bash
git ls-files | grep -E 'vps|\.pem$|\.key$|id_rsa|vps\.txt|secret'
```

Bu komut SSH private key göstermemelidir.

## Yeni VPS kurulumu

### 1. Docker ve Git kur

```bash
sudo apt update
sudo apt install -y git ca-certificates curl gnupg

sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker ubuntu
```

Sonra SSH oturumunu kapatıp tekrar bağlan.

### 2. Dizinleri oluştur

```bash
mkdir -p /home/ubuntu/jouri/products_photo
mkdir -p /home/ubuntu/jouri/backups
mkdir -p /home/ubuntu/.config/rclone
cd /home/ubuntu/jouri
```

### 3. Repoyu çek

```bash
git clone https://github.com/jury80540-art/jouri-intake.git
cd jouri-intake
```

Private repo için GitHub auth gerekir. Tercihen deploy key veya GitHub token kullan.

### 4. `.env` oluştur

```bash
cp .env.example .env
nano .env
```

Minimum production değerleri:

```env
POSTGRES_DB=jouri
POSTGRES_USER=jouri
POSTGRES_PASSWORD=strong-db-password
DATABASE_URL=postgresql://jouri:strong-db-password@db:5432/jouri

USER_PASSWORD=strong-login-password
USER_PASSWORD_2=
TOTP_SECRET=
EDIT_LOCK_CODE=edit-lock-code

GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.5-flash
OLLAMA_MODEL=gemma3:4b-it-qat

OPENAI_API_KEY=
OPENAI_IMAGE_MODEL=gpt-image-1.5
OPENAI_IMAGE_SIZE=1024x1536
OPENAI_IMAGE_QUALITY=medium

SHOPIFY_STORE_URL=
SHOPIFY_CLIENT_ID=
SHOPIFY_CLIENT_SECRET=
SHOPIFY_ACCESS_TOKEN=
SHOPIFY_API_VERSION=2026-04
SHOPIFY_VENDOR=Binbon Kids
SHOPIFY_IMAGE_LIMIT=12
SHOPIFY_WEBHOOK_SECRET=
SHOPIFY_CATEGORY_MAP=

VISION_MODEL=Marqo/marqo-fashionSigLIP
MAX_IMAGES_PER_PRODUCT=3
```

Notlar:

- `USER_PASSWORD` boş kalırsa auth davranışı gevşeyebilir; production'da mutlaka doldur.
- `OPENAI_API_KEY` sadece AI görsel üretimi kullanılacaksa gerekir.
- `GEMINI_API_KEY` ürün metin ayrıştırma kalitesini artırmak için opsiyoneldir.
- Shopify alanları sadece Shopify senkronu kullanılacaksa gerekir.

### 5. Domain ayarı

`Caddyfile` içinde domain şu an:

```caddy
syncra.website {
    reverse_proxy /api/* api:8000
    reverse_proxy /ws api:8000
    reverse_proxy /ws/* api:8000
    reverse_proxy /* client:80
}
```

Başka domain kullanacaksan `syncra.website` değerini değiştir.

DNS tarafında domain A kaydı VPS IP'sine gitmelidir. Caddy otomatik HTTPS sertifikası alır.

### 6. Production deploy

```bash
cd /home/ubuntu/jouri/jouri-intake
docker compose -f docker-compose.prod.yml up --build -d
```

Durum kontrol:

```bash
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs --tail=100 api
docker compose -f docker-compose.prod.yml logs --tail=100 client
docker compose -f docker-compose.prod.yml logs --tail=100 vision-search
```

## Servis detayları

### API

Production image: `api/Dockerfile.prod`

Başlangıç komutu:

```bash
alembic upgrade head && uvicorn main:app --host 0.0.0.0 --port 8000
```

Yani container açılırken migration otomatik çalışır.

Önemli volume'ler:

```yaml
/home/ubuntu/jouri/products_photo:/products_photo
/home/ubuntu/jouri/backups:/backups
/home/ubuntu/.config/rclone:/root/.config/rclone
```

### Client

Production image: `client/Dockerfile`

React/Vite build alır ve Nginx ile servis eder.

### PostgreSQL

Docker volume:

```yaml
postgres_data:/var/lib/postgresql/data
```

DB container dışına SQL dump almak için:

```bash
docker compose -f docker-compose.prod.yml exec -T db \
  pg_dump -U jouri -d jouri > jouri-db.sql
```

Restore:

```bash
cat jouri-db.sql | docker compose -f docker-compose.prod.yml exec -T db \
  psql -U jouri -d jouri
```

### Vision Search / FashionSigLIP

Servis: `vision-search`

Model:

```env
VISION_MODEL=Marqo/marqo-fashionSigLIP
MAX_IMAGES_PER_PRODUCT=3
```

Model kod revision'ı uygulama içinde sabitlenmiştir:

```text
c56244cc94f92419e8369fa71efdaf403b124ce8
```

Servis portu container içinde `8090`.

API bu servise şu URL ile bağlanır:

```env
VISION_SEARCH_URL=http://vision-search:8090
```

Health test:

```bash
docker compose -f docker-compose.prod.yml exec -T vision-search python - <<'PY'
import http.client
conn = http.client.HTTPConnection("localhost", 8090, timeout=30)
conn.request("GET", "/health")
resp = conn.getresponse()
print(resp.status, resp.read().decode())
PY
```

İlk gerçek görsel arama model yükleme/cache yüzünden biraz yavaş olabilir. Sonraki istekler daha hızlıdır.

### Ollama

Servis: `ollama`

API `OLLAMA_URL=http://ollama:11434/v1` ile bağlanır.

Model indirmek gerekirse:

```bash
docker compose -f docker-compose.prod.yml exec ollama ollama pull gemma3:4b-it-qat
```

## Lokal geliştirme

Lokal geliştirme için:

```bash
cp .env.example .env
docker compose up --build
```

Servisler:

- Frontend: `http://127.0.0.1:5173`
- API: `http://127.0.0.1:8000`
- DB: Docker içi PostgreSQL
- Vision search: Docker içi `vision-search:8090`

Lokal compose şu klasörleri bekler:

```text
../products_photo
../backups
```

## Güncelleme / deploy akışı

Localde değişiklik:

```bash
git status
npm run build --prefix client
git add .
git commit -m "mesaj"
git push origin master
```

VPS'te deploy:

```bash
cd /home/ubuntu/jouri/jouri-intake
git pull --ff-only origin master
docker compose -f docker-compose.prod.yml up --build -d client api caddy vision-search
docker compose -f docker-compose.prod.yml ps
```

Local ve VPS aynı commit mi:

Local:

```bash
git rev-parse --short HEAD
```

VPS:

```bash
cd /home/ubuntu/jouri/jouri-intake
git rev-parse --short HEAD
```

İki değer aynı olmalıdır.

## Taşıma senaryosu

Eski VPS'ten alınacaklar:

1. Git repo son commit'i GitHub'a push edilmiş olmalı.
2. `.env` dosyası güvenli şekilde kopyalanmalı.
3. `/home/ubuntu/jouri/products_photo` klasörü kopyalanmalı.
4. PostgreSQL dump alınmalı.
5. `/home/ubuntu/jouri/backups` klasörü gerekiyorsa kopyalanmalı.
6. `/home/ubuntu/.config/rclone` gerekiyorsa kopyalanmalı.

Eski VPS'te DB dump:

```bash
cd /home/ubuntu/jouri/jouri-intake
docker compose -f docker-compose.prod.yml exec -T db \
  pg_dump -U jouri -d jouri > /home/ubuntu/jouri/jouri-db.sql
```

Dosyaları yeni VPS'e kopyalama örneği:

```bash
rsync -avz /home/ubuntu/jouri/products_photo/ ubuntu@NEW_VPS:/home/ubuntu/jouri/products_photo/
rsync -avz /home/ubuntu/jouri/backups/ ubuntu@NEW_VPS:/home/ubuntu/jouri/backups/
scp /home/ubuntu/jouri/jouri-db.sql ubuntu@NEW_VPS:/home/ubuntu/jouri/jouri-db.sql
scp /home/ubuntu/jouri/jouri-intake/.env ubuntu@NEW_VPS:/home/ubuntu/jouri/jouri-intake/.env
```

Yeni VPS'te restore:

```bash
cd /home/ubuntu/jouri/jouri-intake
docker compose -f docker-compose.prod.yml up -d db
cat /home/ubuntu/jouri/jouri-db.sql | docker compose -f docker-compose.prod.yml exec -T db \
  psql -U jouri -d jouri
docker compose -f docker-compose.prod.yml up --build -d
```

## Yedekleme

Panel içinde yedekleme ekranı vardır. Backend yedekleri `/backups` container path'ine yazar; production'da bu path şuraya bağlıdır:

```text
/home/ubuntu/jouri/backups
```

Google Drive/rclone için config:

```text
/home/ubuntu/.config/rclone
```

Container içindeki karşılığı:

```text
/root/.config/rclone
```

Drive hedefi varsayılan:

```env
BACKUP_DRIVE_ROOT=gdrive:jouri-backups
```

İstersen `.env` içine ekleyerek değiştirebilirsin.

## Shopify entegrasyonu

Gerekli env'ler:

```env
SHOPIFY_STORE_URL=your-store.myshopify.com
SHOPIFY_CLIENT_ID=
SHOPIFY_CLIENT_SECRET=
SHOPIFY_ACCESS_TOKEN=
SHOPIFY_API_VERSION=2026-04
SHOPIFY_WEBHOOK_SECRET=
```

Yeni Shopify app sistemi için `SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET` tercih edilir. Eski/custom token varsa `SHOPIFY_ACCESS_TOKEN` da desteklenir.

Siparişten stok düşme webhook'u için `SHOPIFY_WEBHOOK_SECRET` gerekir.

## OpenAI / AI görsel üretimi

AI görsel üretimi opsiyoneldir.

```env
OPENAI_API_KEY=
OPENAI_IMAGE_MODEL=gpt-image-1.5
OPENAI_IMAGE_SIZE=1024x1536
OPENAI_IMAGE_QUALITY=medium
```

`OPENAI_API_KEY` boşsa uygulama çalışır, sadece AI görsel üretim özelliği hata mesajıyla pasif kalır.

## Barkod ve görsel arama

Sistemde üç arama yöntemi vardır:

1. Yazılı arama: isim, ürün kodu, barkod, beden, kategori, ürün tipi, renk, açıklama.
2. Barkod arama: arama alanındaki barkod ikonu ile kameradan veya manuel kodla.
3. Görsel arama: kamera/görsel seçimi ile FashionSigLIP önerileri.

Barkod zorunlu değildir:

- Yeni tek ürün eklerken genel ürün barkodu opsiyoneldir.
- Çoklu ürün eklerken genel barkod ve beden barkodu opsiyoneldir.
- Ürün detay/düzenleme ekranında barkod sonradan eklenebilir/güncellenebilir.

Kamera ile barkod okuma tarayıcının `BarcodeDetector` desteğine bağlıdır. Destek yoksa manuel yazma alanı kullanılabilir.

## Sık kullanılan komutlar

Loglar:

```bash
docker compose -f docker-compose.prod.yml logs -f api
docker compose -f docker-compose.prod.yml logs -f client
docker compose -f docker-compose.prod.yml logs -f vision-search
docker compose -f docker-compose.prod.yml logs -f caddy
```

Servis restart:

```bash
docker compose -f docker-compose.prod.yml restart api
docker compose -f docker-compose.prod.yml restart client
docker compose -f docker-compose.prod.yml restart vision-search
```

Disk kontrol:

```bash
df -h /
docker system df
```

Güvenli Docker temizlik:

```bash
docker image prune
docker builder prune
```

Not: Volume silme komutları (`docker volume prune`, `down -v`) veritabanı/model cache gibi kalıcı verileri silebilir. Emin olmadan çalıştırma.

## Sorun giderme

### Site açılmıyor

```bash
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs --tail=100 caddy
```

DNS'in VPS IP'sine gittiğini kontrol et.

### API migration hatası

```bash
docker compose -f docker-compose.prod.yml logs --tail=200 api
```

`DATABASE_URL`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` değerleri uyumlu olmalı.

### Görsel arama çalışmıyor

```bash
docker compose -f docker-compose.prod.yml logs --tail=200 vision-search
docker compose -f docker-compose.prod.yml exec -T vision-search python - <<'PY'
import http.client
conn = http.client.HTTPConnection("localhost", 8090, timeout=30)
conn.request("GET", "/health")
resp = conn.getresponse()
print(resp.status, resp.read().decode())
PY
```

Kontrol edilecekler:

- `/home/ubuntu/jouri/products_photo` var mı?
- `vision_model_cache` volume dolu/bozuk mu?
- VPS disk alanı yeterli mi?
- İlk model yüklemesi için internet erişimi var mı?

### Fotoğraflar görünmüyor

Production compose içinde API ve vision servisleri şu path'i kullanır:

```text
/home/ubuntu/jouri/products_photo
```

Bu klasör taşınmadıysa ürün kayıtları gelir ama fotoğraflar görünmeyebilir.

### Login çalışmıyor

`.env` içindeki auth değerlerini kontrol et:

```env
USER_PASSWORD=
USER_PASSWORD_2=
TOTP_SECRET=
```

Değişiklikten sonra:

```bash
docker compose -f docker-compose.prod.yml restart api
```

## Son bilinen production deploy kontrolü

Beklenen çalışan servisler:

```text
api
caddy
client
db
ollama
vision-search
```

Kontrol:

```bash
docker compose -f docker-compose.prod.yml ps --services --filter status=running
```

