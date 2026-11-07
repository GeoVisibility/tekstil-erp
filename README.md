# Tekstil Üretim Takip (ERP)

Next.js 15 (App Router) · Prisma 6 · PostgreSQL 16 · Tailwind 4

## Kurulum

```bash
npm install
cp .env.example .env          # AUTH_SECRET'i değiştirin
npm run db:up                 # PostgreSQL (Docker, port 5433)
npm run db:migrate            # tabloları oluşturur
npm run db:seed               # Hoodie şablonu + demo kullanıcılar (yalnızca yerel)
npm run dev                   # http://localhost:3000
```

Demo kullanıcıların e-postaları ve geliştirme şifresi `prisma/seed.ts` dosyasında yer alır (yalnızca yerel kullanım).

## Roller

| Rol | Görür / yapar |
|---|---|
| **Developer** | Her şey; firma ekler, her firmanın siparişlerini görür |
| **Firma** | Sipariş açar, parçaları girer, görev atar (kişi + alt firma + tarih), alt firma/müşteri/kullanıcı ekler |
| **Alt Firma** | Yalnızca kendisine atanan görevleri görür; başlatır, tamamlar, engel bildirir |
| **Müşteri** | Kendi siparişlerinin aşama ve ilerlemesini salt okunur izler |

Sayfa erişimleri **tek bir yerde** tanımlıdır: `src/lib/roles.ts` (`NAV_ITEMS`). Hem menü hem `src/middleware.ts` buradan okur.
Veri erişim kapsamı (kim hangi siparişi/görevi görür) `src/lib/scope.ts` içindedir; tüm sorgular buradan geçer.

## Veri modeli (özet)

```
Organization (COMPANY / SUBCOMPANY / CUSTOMER, parentId ile firmaya bağlı)
User (role, organizationId)

ProductType (Hoodie)
 ├─ ComponentTemplate  → varsayılan parçalar (kumaş, ribana, kordon, fermuar, baskı, etiket…)
 └─ ProcessTemplate    → işlem sırası (kumaş testi, kesim, baskı, nakış, dikim, ütü, KK, paketleme, sevkiyat)
                          componentCategories: işlemin hangi parça tiplerine uygulandığı

ProductionOrder (sipariş: model, adet, beden dağılımı, termin, müşteri)
 ├─ OrderComponent  → bu siparişin parçaları + tedarik durumu
 └─ Task            → işlem × parça × atanan (kişi/alt firma) × tarih × durum
```

- **Planı otomatik oluştur:** İşlem şablonlarından görevler sıralı tarihlerle üretilir. Siparişte o kategoride parça yoksa (örn. nakış) adım atlanır.
- **Parçanın aşaması:** Parçanın tamamlanmamış ilk görevinin işlemidir.
- **Sipariş durumu:** Görevler değiştikçe otomatik güncellenir (Planlama → Üretimde → Tamamlandı).

## Yeni ürün eklemek

**Ürün Tanımları** ekranından (`/products`) yapılır. Boş başlanabilir ya da mevcut bir ürünün parça ve işlemleri kopyalanabilir.
Düzenleme sayfasında parça ve işlemler eklenir, düzenlenir, sıralanır ve silinir.

- Parça şablonu değişiklikleri yalnızca yeni siparişleri etkiler (siparişler parçaların kopyasını tutar).
- Görevlerde kullanılan bir işlem silinemez. İşlem adı değiştirilirse mevcut görevlerde de yeni ad görünür.

## Canlıya alma (Vercel + Neon)

1. **Neon**'da bir PostgreSQL projesi açın. İki bağlantı adresi gerekir:
   - `DATABASE_URL`: havuzlu (pooled) adres, host'unda `-pooler` geçer
   - `DIRECT_URL`: havuzsuz (direct) adres, migration'lar bunu kullanır
2. **Vercel**'de projeyi oluşturun ve şu ortam değişkenlerini girin: `DATABASE_URL`, `DIRECT_URL`, `AUTH_SECRET` (yeni ve rastgele bir değer).
   Build sırasında `vercel-build` scripti migration'ları otomatik uygular (`prisma migrate deploy`).
3. Canlı veritabanına ürün şablonlarını yükleyin ve ilk yönetici hesabını oluşturun. Bunu yerelde, canlı adresleri geçici olarak ortam değişkeni yaparak çalıştırın:
   ```bash
   npm run db:seed:prod                                  # yalnızca ürün şablonları, demo kullanıcı YOK
   npm run create-admin -- siz@firma.com "Ad Soyad"      # şifre ekranda sorulur
   ```
4. Developer hesabıyla giriş yapıp **Firmalar** ekranından firmayı, **Kullanıcılar** ekranından firma kullanıcılarını oluşturun.
