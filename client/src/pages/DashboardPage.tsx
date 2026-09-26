import { useMemo, useState } from "react";
// React Query, uygulamadaki veri çekme, önbelleğe alma (caching) ve güncellemeleri yönetmek için kullanılır.
import { useQueryClient } from "@tanstack/react-query";
// Lucide-react, ikonları kullanabilmemiz için gerekli kütüphanedir. Her bir import edilen kelime bir ikonu temsil eder.
import {
  Activity, AlertTriangle, ArchiveIcon, Box,
  CheckCircle2, Clock, DollarSign, Images, Loader2,
  LogIn, PackageCheck, PackageX, ShoppingBag, Sparkles, Tag, Trash2,
} from "lucide-react";

// API (Backend) ile iletişim kurmak için tanımladığımız fonksiyonları içeri aktarıyoruz.
import { deleteLog, productImageUrl } from "../api";
// Veritabanı sorgularını daha kolay yönetmek için React Query hook'larını içeri aktarıyoruz.
import { queryKeys, useLogsQuery, useProductsQuery } from "../queries";
// Uygulamanın genel ayarlarını (dil, tema, bildirimler) almak için kullandığımız özel context.
import { useApp } from "../context";
// Çeviriler, class isimlerini birleştirme (cn) ve metin düzenleme (normalize) gibi yardımcı araçlar.
import { COPY, cn, logActionLabel, normalizeCategory, normalizeProductType, statusLabel } from "../i18n";
// Karanlık ve aydınlık tema için önceden hazırladığımız renk ve tasarım ayarları.
import { DARK, LIGHT, type ThemeStyles } from "../theme";
// Ürünlerin durumuna göre (Örn: satıldı, beklemede) renkli etiket (badge) döndüren yardımcı fonksiyon.
import { statusBadge } from "../components/ProductCard";
// TypeScript için veri tiplerini (Ürünlerin ve Logların nasıl bir yapıya sahip olduğunu) içeri aktarıyoruz.
import type { ActivityLog, ProductRecord } from "../types";
// Fiyatları formatlamak (Örn: 100 EUR şeklinde göstermek) için gerekli yardımcı fonksiyonlar.
import { formatPrice, parsePriceAmount } from "../format";

// İsimlendirilmiş bir sayım tutmak için oluşturduğumuz bir veri tipi. (Örn: "Elbise": 5 adet)
type NamedCount = { label: string; count: number };

/**
 * Bir ürün görselinin "Yapay Zeka (AI) tarafından işlenmiş" olup olmadığını kontrol eder.
 * Görselin bulunduğu klasör "enhanced" ise veya dosya adı "ai_" ile başlıyorsa true döner.
 */
function isEnhancedImage(image: ProductRecord["images"][number]): boolean {
  const fileName = image.fileName.toLowerCase();
  return image.folder === "enhanced" || fileName.startsWith("ai_") || fileName.startsWith("ai-");
}

/**
 * Bir ürünün içinde "Yapay Zeka (AI) ile işlenmiş" GÖRSEL olup olmadığını kontrol eder.
 * Yukarıdaki isEnhancedImage fonksiyonunu tüm görseller için çalıştırır.
 */
function hasEnhancedImage(product: ProductRecord): boolean {
  return product.images.some(isEnhancedImage);
}

/**
 * Bir değerin boş, eksik veya anlamsız (Örn: "-", "unknown", "n/a") olup olmadığını kontrol eder.
 * Kullanıcının veya sistemin eksik bilgi girip girmediğini anlamak için kullanılır.
 */
function isMissingValue(value?: string | null): boolean {
  const normalized = (value ?? "").trim().toLowerCase();
  return !normalized
    || normalized === "-"
    || normalized === "—"
    || normalized === "unknown"
    || normalized === "null"
    || normalized === "undefined"
    || normalized === "none"
    || normalized === "n/a"
    || normalized === "na";
}

/**
 * Verilen ürün listesinden belirli bir özelliğe göre (Örn: Kategori) "En çok tekrar edenleri" bulur.
 * Örneğin: 10 Tişört, 5 Pantolon varsa bunları sayar ve en çoktan en aza sıralayıp döndürür.
 * limit parametresi ile kaç tane sonuç döndüreceğini belirleriz (varsayılan: 5).
 */
function topCounts(
  products: ProductRecord[],
  read: (product: ProductRecord) => string, // Hangi özelliğin sayılacağını belirten fonksiyon
  limit = 5,
): NamedCount[] {
  const counts = new Map<string, number>(); // Sayımları tutacağımız geçici hafıza (Sözlük/Map)
  for (const product of products) {
    const label = read(product).trim(); // Ürünün ilgili özelliğini (Örn: Kategorisini) oku
    if (isMissingValue(label)) continue; // Eğer boşsa veya bilinmiyorsa atla
    // Eğer daha önce sayıldıysa sayısını 1 artır, yoksa 1 olarak kaydet
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  // Elde edilen sayımları diziye çevir, büyükten küçüğe sırala ve sadece istenen sayı kadarını (limit) al
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, limit);
}

/**
 * Basit bir yüzde hesaplama fonksiyonu.
 * Örneğin: 20 ürünün 5'i satıldıysa -> (5 / 20) * 100 = %25 döner.
 */
function percent(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// ANA BİLEŞEN: KONTROL PANELİ SAYFASI (DashboardPage)
// ─────────────────────────────────────────────────────────────────────────────
export default function DashboardPage() {
  // Uygulamanın anlık ayarlarını alıyoruz (dil, tema ve bildirim gösterme fonksiyonu)
  const { locale, theme, showToast } = useApp();
  // Geçerli dile göre çevirileri içeren sözlüğü seçiyoruz (t = translations)
  const t = COPY[locale];
  // Temaya göre kullanılacak CSS sınıflarını (renkleri) seçiyoruz
  const s = theme === "dark" ? DARK : LIGHT;
  // React Query'nin cache (önbellek) yöneticisini alıyoruz
  const queryClient = useQueryClient();

  // Silinmekte olan bir log kaydı varsa, silinen kaydın ID'sini tutuyoruz (Yükleniyor animasyonu için)
  const [deletingId, setDeletingId] = useState<number | null>(null);
  
  // API'den tüm ürünleri çekiyoruz (Arka planda otomatik önbelleklenir)
  const productsQuery = useProductsQuery();
  // API'den son 50 işlem kaydını (log) çekiyoruz
  const logsQuery = useLogsQuery(50);

  // Çekilen verileri değişkene atıyoruz (Eğer henüz yükleniyorsa boş dizi [] atıyoruz)
  const products: ProductRecord[] = productsQuery.data ?? [];
  const logs: ActivityLog[] = logsQuery.data ?? [];
  // Hem ürünler hem de loglar yükleniyor mu diye kontrol ediyoruz
  const loading = productsQuery.isLoading || logsQuery.isLoading;

  // ── Hesaplamalar ──────────────────────────────────────────────────────────

  // Satılıp arşive gitmemiş olan tüm "aktif" ürünleri filtreliyoruz.
  // useMemo sayesinde sadece "products" değiştiğinde bu işlem tekrar yapılır, performansı artırır.
  const active = useMemo<ProductRecord[]>(() => products.filter((p: ProductRecord) => p.status !== "sold_archive"), [products]);

  // Ürünlerin durumlarına göre toplam sayılarını hesaplıyoruz
  const counts = {
    pending:      products.filter((p: ProductRecord) => p.status === "pending").length, // Beklemede olanlar
    ai_enhanced:  products.filter((p: ProductRecord) => p.status === "ai_enhanced").length, // Yapay Zeka işlemi bitenler
    published:    products.filter((p: ProductRecord) => p.status === "published").length, // Yayınlananlar
    sold_archive: products.filter((p: ProductRecord) => p.status === "sold_archive").length, // Satılıp arşivlenenler
    // Sadece aktif ürünlerin stok miktarlarını topluyoruz (stok sıfırın altındaysa 0 kabul edilir)
    activeStock: active.reduce((n: number, p: ProductRecord) => n + Math.max(0, p.stockQuantity), 0),
    // Aktif ürünlerin toplam fotoğraf sayısı
    totalImages: active.reduce((n: number, p: ProductRecord) => n + p.images.length, 0),
    // Bugüne kadar satılmış olan toplam ürün adedi (Tüm ürünlerdeki "soldQuantity" toplamı)
    totalSold: products.reduce((n: number, p: ProductRecord) => n + Math.max(0, p.soldQuantity), 0),
  };
  const partialSoldCount = products.filter((p: ProductRecord) => p.status !== "sold_archive" && p.soldSizes.length > 0).length;
  const salesArchiveCount = counts.sold_archive + partialSoldCount;

  // Aktif ürünlerin fotoğraflarının kaç tanesi orijinal, kaç tanesi Yapay Zeka tarafından işlenmiş sayıyoruz
  const imageStats = active.reduce(
    (stats: { original: number; ai: number }, product: ProductRecord) => {
      for (const image of product.images) {
        if (isEnhancedImage(image)) stats.ai += 1;
        else stats.original += 1;
      }
      return stats;
    },
    { original: 0, ai: 0 },
  );

  // Panelin uyarı/tavsiye bölümünde gösterilecek "Akıllı Metrikler" (Eksikler, azalan stoklar vb.)
  const smart = {
    // Fotoğrafları yapay zekadan çıkmış ama kendisi hala "Bekliyor (Pending)" statüsünde kalan ürünler (Yani yayımlanmaya hazır)
    aiReadyPending: active.filter((p: ProductRecord) => p.status === "pending" && hasEnhancedImage(p)).length,
    // İçinde yapay zeka fotoğrafı bulunan toplam ürün sayısı
    aiImageProducts: active.filter(hasEnhancedImage).length,
    // Kategorisi girilmemiş ürünler
    noCategory: active.filter((p: ProductRecord) => isMissingValue(p.parsed.categorySuggestion)).length,
    // Ürün türü girilmemiş ürünler
    noProductType: active.filter((p: ProductRecord) => isMissingValue(p.parsed.productTypeSuggestion)).length,
    // Stok miktarı 1 veya 2 kalmış ürünler
    lowStock: active.filter((p: ProductRecord) => p.stockQuantity > 0 && p.stockQuantity <= 2).length,
    // Stoku tamamen tükenmiş olan aktif ürünler
    outOfStock: active.filter((p: ProductRecord) => p.stockQuantity === 0).length,
    // Yayında olup henüz Shopify'e gönderilmemiş ürünler
    publishedUnsynced: active.filter((p: ProductRecord) => p.status === "published" && !p.shopify?.productId).length,
  };

  // Ürün başına ortalama düşen fotoğraf sayısı (1 ondalık haneye kadar, Örn: 3.2)
  const avgImages = active.length > 0 ? (counts.totalImages / active.length).toFixed(1) : "0";
  // Fotoğrafların yüzde kaçı yapay zeka?
  const aiImagePct = percent(imageStats.ai, counts.totalImages);
  // Fotoğrafların yüzde kaçı orijinal?
  const originalImagePct = percent(imageStats.original, counts.totalImages);
  // Ürünlerin yüzde kaçı yapay zekaya girmiş?
  const aiProductPct = percent(smart.aiImageProducts, active.length);
  // Sistemdeki en popüler ilk 5 kategori
  const topCategories = topCounts(active, (p: ProductRecord) => normalizeCategory(p.parsed.categorySuggestion));
  // Sistemdeki en popüler ilk 5 ürün türü
  const topProductTypes = topCounts(active, (p: ProductRecord) => normalizeProductType(p.parsed.productTypeSuggestion));

  // Toplam Stok Değeri Hesaplaması: Sadece fiyatı girilmiş ve stoku olan aktif ürünlerin (Fiyat x Stok) toplamı
  const stockValue = active.reduce((sum: number, p: ProductRecord) => {
    const price = parsePriceAmount(p.parsed.priceAmount);
    if (price !== null && p.stockQuantity > 0) return sum + price * p.stockQuantity;
    return sum;
  }, 0);

  // Toplam Satış Tutarı Hesaplaması: Fiyatı olan ürünlerin (Fiyat x Satış Miktarı) toplamı
  const totalSalesValue = products.reduce((sum: number, p: ProductRecord) => {
    const price = parsePriceAmount(p.parsed.priceAmount);
    if (price !== null && p.soldQuantity > 0) return sum + price * p.soldQuantity;
    return sum;
  }, 0);

  // "İnceleme Gerektirenler" metrikleri
  const attention = {
    // Fiyatı girilmemiş ürünler
    noPrice:  active.filter((p: ProductRecord) => isMissingValue(p.parsed.priceAmount)).length,
    // Hiç fotoğrafı olmayan ürünler
    noImages: active.filter((p: ProductRecord) => p.images.length === 0).length,
  };
  // Eğer yukarıdaki eksiklerden herhangi biri 0'dan büyükse, uyarı panelini ekranda göstermek için bir değişken oluşturuyoruz
  const hasAttention = attention.noPrice > 0 || attention.noImages > 0
    || smart.noCategory > 0 || smart.noProductType > 0
    || smart.lowStock > 0 || smart.outOfStock > 0
    || smart.aiReadyPending > 0 || smart.publishedUnsynced > 0;

  // İş Akışı Boru Hattı (Workflow Pipeline) için ürün durumlarının sayıları ve renk tasarımları
  const activeTotal = counts.pending + counts.ai_enhanced + counts.published;
  const workflowSteps = [
    { label: t.dashPending,    count: counts.pending,     color: "bg-amber-400",   border: "border-amber-400/40",  text: "text-amber-400" },
    { label: t.dashAiEnhanced, count: counts.ai_enhanced, color: "bg-teal-400",    border: "border-teal-400/40",   text: "text-teal-300" },
    { label: t.dashPublished,  count: counts.published,   color: "bg-emerald-400", border: "border-emerald-400/40",text: "text-emerald-400" },
  ];

  // Tarihleri yerelleştirmek için dil kontrolü (Arapça veya Türkçe ayarlanıyor)
  const dateLocale = locale === "ar" ? "ar" : "tr-TR";

  /**
   * Verilen bir tarihi "3 dakika önce", "5 saat önce" gibi okunabilir metinlere çevirir.
   * 24 saati geçmişse tam tarihi gösterir.
   */
  function timeAgo(iso: string): string {
    const time = new Date(iso).getTime();
    if (!Number.isFinite(time)) return "";
    const diff = (Date.now() - time) / 1000;
    if (diff < 60)    return locale === "ar" ? "الآن" : "az önce";
    if (diff < 3600)  { const m = Math.floor(diff / 60);   return locale === "ar" ? `منذ ${m} دقيقة` : `${m} dk önce`; }
    if (diff < 86400) { const h = Math.floor(diff / 3600); return locale === "ar" ? `منذ ${h} ساعة`  : `${h} sa önce`; }
    return new Date(iso).toLocaleDateString(dateLocale);
  }

  /**
   * Kullanıcı panelden bir kayıt (log) sildiğinde çalışacak fonksiyon.
   * Silme işlemi başarılı olursa API'yi arar ve sonrasında arayüzdeki "logs" önbelleğinden (cache) bu kaydı silerek arayüzü anında günceller.
   */
  async function handleDeleteLog(id: number) {
    setDeletingId(id); // Butonda dönen "loading" ikonu için ID'yi kaydet
    try {
      await deleteLog(id); // API'ye silme isteği at
      // React Query önbelleğini güncelle: Silinen ID'yi listeden çıkart
      queryClient.setQueriesData<ActivityLog[]>(
        { queryKey: queryKeys.logsRoot },
        (current: ActivityLog[] | undefined) => (current ?? []).filter((l: ActivityLog) => l.id !== id),
      );
      // Diğer sayfaların da bu durumdan haberdar olması için tüm log sorgularını iptal edip yeniden çekilmelerini işaretle
      await queryClient.invalidateQueries({ queryKey: queryKeys.logsRoot });
    }
    catch {
      // Hata çıkarsa kırmızı bildirim (Toast) göster
      showToast(t.errors.ERR_GENERAL, "error");
    } finally { setDeletingId(null); } // İşlem bittiğinde yükleniyor ikonunu durdur
  }

  /**
   * Loglardaki (geçmişteki) değişikliklerin ne anlama geldiğini çevirmek için yardımcı fonksiyon.
   * Örn: Sistemde "title" değiştiyse ekranda "Ürün Adı" olarak görünmesini sağlar.
   */
  function fieldLabel(field: string): string {
    const map: Record<string, string> = {
      title: t.logFieldTitle,
      price: t.logFieldPrice, color: t.logFieldColor, size: t.logFieldSize,
      stock: t.logFieldStock, category: t.logFieldCategory,
      product_type: t.logFieldProductType, notes: t.logFieldNotes,
      currency: t.logFieldCurrency, description: t.logFieldDescription,
      image_deleted: t.logFieldImageDeleted,
    };
    return map[field] || field; // Karşılığı yoksa kelimenin ham halini göster
  }

  /**
   * Her bir işlem türü (log action) için uygun bir ikon (resim/şekil) ve renk döndürür.
   * Örn: "sell" (Satış) eylemi için alışveriş çantası (ShoppingBag) ikonunu döndürür.
   */
  function actionIcon(action: string) {
    const cls = "size-4"; // İkon boyutu
    switch (action) {
      case "login":        return <LogIn        className={cn(cls, "text-emerald-400")} />;
      case "create":       return <PackageCheck className={cn(cls, "text-emerald-400")} />;
      case "update":       return <Activity     className={cn(cls, "text-teal-300")} />;
      case "delete":       return <Trash2       className={cn(cls, "text-red-400")} />;
      case "sell":         return <ShoppingBag  className={cn(cls, "text-amber-400")} />;
      case "restore":      return <ArchiveIcon  className={cn(cls, "text-emerald-400")} />;
      case "status_change":return <CheckCircle2 className={cn(cls, "text-lime-300")} />;
      case "add_images":   return <Images       className={cn(cls, "text-sky-400")} />;
      case "ai_generate_images": return <Sparkles className={cn(cls, "text-emerald-400")} />;
      case "shopify_push": return <ShoppingBag  className={cn(cls, "text-emerald-400")} />;
      case "reset_sales":  return <PackageX     className={cn(cls, "text-slate-400")} />;
      default:             return <Activity     className={cn(cls, s.muted)} />;
    }
  }

  // Veriler henüz yükleniyorsa ekranda sadece dönen (Loader2) ikonunu göster.
  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="size-8 animate-spin text-emerald-400" />
      </div>
    );
  }

  // Yükleme bitti, asıl gösterge panelini (Dashboard) ekrana çiziyoruz.
  return (
    <div className="grid gap-6">
      {/* Sayfa Başlığı */}
      <h1 className={cn("text-2xl font-black tracking-tight", s.title)}>{t.dashTitle}</h1>

      {/* ── 1. İŞ AKIŞI BORU HATTI (Workflow Pipeline) ── */}
      {/* Ürünlerin üretim veya yayımlanma aşamalarındaki dağılımını gösterir */}
      <div className={cn("rounded-xl border p-3 sm:p-4", s.panel)}>
        <div className={cn("mb-3 flex items-center gap-2", s.muted)}>
          <Tag className="size-4" />
          <span className="text-xs font-black uppercase tracking-wide">{t.dashWorkflow}</span>
        </div>
        {/* Üç aşamalı gösterge grid'i */}
        <div className="grid grid-cols-3 gap-2">
          {workflowSteps.map((step, i) => {
            // Bu aşamadaki ürünlerin toplam ürünlere olan yüzdesi
            const pct = activeTotal > 0 ? Math.round((step.count / activeTotal) * 100) : 0;
            return (
              <div key={step.label} className={cn("rounded-xl border p-2.5 sm:p-4", step.border, "bg-white/2")}>
                {/* Sayı */}
                <div className={cn("text-xl sm:text-3xl font-black", step.text)}>{step.count}</div>
                {/* Aşama Başlığı (Örn: Beklemede) */}
                <div className={cn("mt-0.5 truncate text-[10px] sm:text-xs font-bold", s.muted)}>{step.label}</div>
                {/* Yüzde Barı Göstergesi */}
                <div className="mt-2 h-1 w-full rounded-full bg-white/5">
                  <div
                    className={cn("h-1 rounded-full transition-all", step.color)}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                {/* Yüzde Metni */}
                <div className={cn("mt-1 text-[10px] font-bold", s.muted)}>{pct}%</div>
                {/* Son kutu hariç, aralara "ok işareti (→)" koy (Akışı simgelemek için) */}
                {i < workflowSteps.length - 1 && (
                  <div className={cn("mt-1.5 text-[10px] font-bold", s.muted)}>
                    {locale === "ar" ? "←" : "→"}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── 2. METRİKLER (Kısa İstatistik Kartları) ── */}
      {/* Ekrandaki ufak kutucuklarda Toplam Stok, Toplam Satış gibi özet bilgileri listeler */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <MetricCard
          icon={<Box className="size-4 text-emerald-400" />}
          label={t.dashActiveStock} // Aktif Stok
          value={counts.activeStock}
          color="text-emerald-400"
          bg="bg-emerald-400/10 border-emerald-400/20"
        />
        <MetricCard
          icon={<DollarSign className="size-4 text-emerald-400" />}
          label={t.dashStockValue} // Stok Değeri
          value={formatPrice(stockValue.toFixed(0), "EUR")}
          color="text-emerald-400"
          bg="bg-emerald-400/10 border-emerald-400/20"
          small
        />
        <MetricCard
          icon={<ShoppingBag className="size-4 text-amber-400" />}
          label={t.dashTotalSold} // Toplam Satış
          value={counts.totalSold}
          color="text-amber-400"
          bg="bg-amber-400/10 border-amber-400/20"
        />
        <MetricCard
          icon={<DollarSign className="size-4 text-amber-400" />}
          label={t.dashSalesValue} // Satış Tutarı
          value={formatPrice(totalSalesValue.toFixed(0), "EUR")}
          color="text-amber-400"
          bg="bg-amber-400/10 border-amber-400/20"
          small
        />
        <MetricCard
          icon={<Images className="size-4 text-sky-400" />}
          label={t.dashTotalImages} // Toplam Görsel
          value={counts.totalImages}
          color="text-sky-400"
          bg="bg-sky-400/10 border-sky-400/20"
        />
        <MetricCard
          icon={<Images className="size-4 text-teal-300" />}
          label={t.dashAiImages} // AI Tarafından İşlenen Görseller
          value={imageStats.ai}
          color="text-teal-300"
          bg="bg-teal-400/10 border-teal-400/20"
        />
        <MetricCard
          icon={<Activity className="size-4 text-lime-300" />}
          label={t.dashAvgImages} // Ürün Başına Ortalama Görsel
          value={avgImages}
          color="text-lime-300"
          bg="bg-lime-400/10 border-lime-400/20"
        />
      </div>

      {/* ── 3. AKILLI ÖZET (Görsel Sağlığı & Akıllı Kontroller) ── */}
      <div className="grid gap-3 lg:grid-cols-[1.1fr_0.9fr]">
        {/* Görsel Sağlığı Paneli */}
        <div className={cn("rounded-xl border", s.panel)}>
          <PanelHeader icon={<Images className="size-5 text-sky-400" />} title={t.dashImageHealth} s={s} />
          <div className="grid gap-4 p-4 sm:grid-cols-3">
            <ImageStat label={t.dashOriginalImages} value={imageStats.original} pct={originalImagePct} color="bg-sky-400" s={s} />
            <ImageStat label={t.dashAiImages} value={imageStats.ai} pct={aiImagePct} color="bg-teal-400" s={s} />
            <ImageStat label={t.dashAiCoverage} value={`${smart.aiImageProducts}/${active.length}`} pct={aiProductPct} color="bg-emerald-400" s={s} />
          </div>
        </div>

        {/* Akıllı Kontroller Paneli */}
        <div className={cn("rounded-xl border", s.panel)}>
          <PanelHeader icon={<AlertTriangle className="size-5 text-amber-400" />} title={t.dashSmartCheck} s={s} />
          <div className="grid divide-y" style={{ borderColor: "inherit" }}>
            <SmartRow label={t.dashAiReadyPending} value={smart.aiReadyPending} tone="blue" s={s} />
            <SmartRow label={t.dashLowStock} value={smart.lowStock} tone="amber" s={s} />
            <SmartRow label={t.dashOutOfStock} value={smart.outOfStock} tone="red" s={s} />
          </div>
        </div>
      </div>

      {/* ── 4. ARŞİV SAYACI ── */}
      {/* Sadece sistemde arşivlenmiş ürün varsa bu bölümü gösterir */}
      {salesArchiveCount > 0 && (
        <div className={cn("flex items-center gap-3 rounded-xl border px-4 py-3", "bg-slate-400/5 border-slate-400/20")}>
          <ArchiveIcon className="size-4 text-slate-400 shrink-0" />
          <span className={cn("text-sm font-bold", s.muted)}>
            {t.dashSalesArchiveSummary(salesArchiveCount, counts.sold_archive, partialSoldCount)}
          </span>
        </div>
      )}

      {/* ── 5. İNCELEME GEREKENLER (Uyarılar ve Eksikler) ── */}
      {/* Sadece eksiklik (Örn: Fiyatı girilmemiş ürün) varsa bu koca paneli gösterir */}
      {hasAttention && (
      <div className={cn("rounded-xl border", s.panel)}>
        <div className={cn("flex items-center gap-3 border-b px-4 sm:px-5 py-3 sm:py-4", s.panelBorder)}>
          <AlertTriangle className="size-5 text-amber-400" />
          <h2 className={cn("text-base font-extrabold", s.title)}>{t.dashNeedsAttention}</h2>
        </div>
        <div className="grid divide-y" style={{ borderColor: "inherit" }}>
          {/* Her bir hata satırını sadece o hata sayısı 0'dan büyükse ekrana çizer */}
          {attention.noPrice > 0 && <AttentionRow icon={<DollarSign className="size-4 text-amber-400" />} text={t.dashNoPrice(attention.noPrice)} s={s} />}
          {attention.noImages > 0 && <AttentionRow icon={<Images className="size-4 text-red-400" />} text={t.dashNoImages(attention.noImages)} s={s} />}
          {smart.noCategory > 0 && <AttentionRow icon={<Tag className="size-4 text-emerald-400" />} text={t.dashNoCategory(smart.noCategory)} s={s} />}
          {smart.noProductType > 0 && <AttentionRow icon={<Box className="size-4 text-sky-400" />} text={t.dashNoProductType(smart.noProductType)} s={s} />}
          {smart.aiReadyPending > 0 && <AttentionRow icon={<PackageCheck className="size-4 text-teal-300" />} text={t.dashAiReadyPendingText(smart.aiReadyPending)} s={s} />}
          {smart.lowStock > 0 && <AttentionRow icon={<Box className="size-4 text-amber-400" />} text={t.dashLowStockText(smart.lowStock)} s={s} />}
          {smart.outOfStock > 0 && <AttentionRow icon={<PackageX className="size-4 text-red-400" />} text={t.dashOutOfStockText(smart.outOfStock)} s={s} />}
          {smart.publishedUnsynced > 0 && <AttentionRow icon={<ShoppingBag className="size-4 text-amber-400" />} text={t.dashPublishedUnsynced(smart.publishedUnsynced)} s={s} />}
        </div>
      </div>
      )}

      {/* ── 6. KATEGORİ VE ÜRÜN TİPİ ÖZETİ (İlk 5 Liste) ── */}
      {/* En çok eklenen kategorileri ve ürün tiplerini sıralar */}
      <div className="grid gap-3 lg:grid-cols-2">
        <TopListPanel
          title={t.dashTopCategories}
          items={topCategories}
          emptyText={t.dashNoCategoryData}
          icon={<Tag className="size-5 text-emerald-400" />}
          s={s}
        />
        <TopListPanel
          title={t.dashTopProductTypes}
          items={topProductTypes}
          emptyText={t.dashNoProductTypeData}
          icon={<Box className="size-5 text-sky-400" />}
          s={s}
        />
      </div>

      {/* ── 7. SON EKLENEN ÜRÜNLER KARTLARI ── */}
      {/* Sisteme en son dahil edilen 6 ürünü görseli, fiyatı ve durumuyla beraber küçük kartlar halinde dizer */}
      {/* ── 8. SON İŞLEMLER (LOGS) ── */}
      {/* Sistemdeki her hareketin (Ekleme, Silme, Güncelleme) listelendiği aktivite günlüğü */}
      <div className={cn("rounded-xl border min-w-0 overflow-hidden", s.panel)}>
        <div className={cn("flex items-center gap-3 border-b px-4 sm:px-5 py-3 sm:py-4", s.panelBorder)}>
          <Activity className="size-5 text-emerald-400" />
          <h2 className={cn("text-base font-extrabold", s.title)}>{t.dashRecentActivity}</h2>
        </div>

        {logs.length === 0 ? (
          // Hiç log yoksa boş olduğunu belirten ikon ve metin göster
          <div className="flex flex-col items-center gap-3 py-12">
            <Clock className={cn("size-10", s.emptyIcon)} />
            <p className={cn("text-sm font-semibold", s.muted)}>{t.dashNoActivity}</p>
          </div>
        ) : (
          <div className="max-h-[28rem] overflow-y-auto">
            {logs.map((log: ActivityLog) => {
              // Log içinde "değişen şeyler" (Örn: fiyattı 100'dü, 200 oldu) verisini çözümle
              const changed = log.action === "update" && log.details?.changed
                ? log.details.changed as Record<string, { from: string; to: string }>
                : null;
              
              return (
                <div
                  key={log.id}
                  className={cn("flex items-start gap-2 sm:gap-3 border-b px-3 sm:px-5 py-3 last:border-b-0", s.panelBorder)}
                >
                  {/* Log İkonu */}
                  <div className={cn("mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg", s.subPanel)}>
                    {actionIcon(log.action)}
                  </div>
                  
                  {/* Log Metni ve İçeriği */}
                  <div className="min-w-0 flex-1">
                    <div className={cn("text-sm font-bold break-words whitespace-normal", s.title)}>
                      {logActionLabel(log.action, locale, log.details)}
                    </div>
                    {/* Hangi ürün üzerinde işlem yapıldıysa ismi */}
                    {log.product_title && (
                      <div className={cn("mt-0.5 truncate text-xs font-semibold", s.muted)}>
                        {log.product_title}
                      </div>
                    )}
                    {/* Değişen Alanlar Varsa Nelerin Değiştiğini Listele */}
                    {changed && Object.keys(changed).length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        <span className={cn("text-[10px] font-bold", s.muted)}>{t.logChanged}:</span>
                        {Object.entries(changed).map(([field, ch]) => (
                          <span
                            key={field}
                            className="inline-flex max-w-full items-center gap-1 rounded-md bg-teal-400/10 px-1.5 py-0.5 text-[10px] font-bold text-teal-200 ring-1 ring-teal-400/20"
                          >
                            <span className="shrink-0">{fieldLabel(field)}:</span>
                            {/* Eski Değer (Üstü Çizili) */}
                            <span className="truncate max-w-[60px] opacity-60 line-through">{ch.from}</span>
                            <span className="shrink-0">→</span>
                            {/* Yeni Değer */}
                            <span className="truncate max-w-[60px]">{ch.to}</span>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  
                  {/* Tarih ve Silme Butonu */}
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    <span className={cn("text-xs font-semibold", s.muted)}>{timeAgo(log.created_at)}</span>
                    <button
                      type="button"
                      title={t.logDeleteEntry}
                      disabled={deletingId === log.id}
                      onClick={() => handleDeleteLog(log.id)}
                      className={cn(
                        "flex size-6 items-center justify-center rounded-md transition hover:bg-red-400/15 hover:text-red-400",
                        s.muted, deletingId === log.id && "opacity-40",
                      )}
                    >
                      {deletingId === log.id
                        ? <Loader2 className="size-3 animate-spin" />
                        : <Trash2 className="size-3" />}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ALT BİLEŞENLER (Yardımcı UI Bileşenleri)
// Yukarıdaki DashboardPage bileşeninin içinde tekrara düşmemek için oluşturulan küçük parçalar.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Toplam Stok, Toplam Satış gibi üst kısımdaki "Basit Metrik Kartları"nı oluşturan bileşen.
 */
function MetricCard({
  icon, label, value, color, bg, small = false,
}: {
  icon: React.ReactNode; label: string;
  value: string | number; color: string; bg: string; small?: boolean;
}) {
  return (
    <div className={cn("rounded-xl border p-3 sm:p-4", bg)}>
      <div className="mb-1 flex items-center gap-1.5">{icon}</div>
      <div className={cn("font-black leading-none", small ? "text-base sm:text-xl" : "text-2xl sm:text-3xl", color)}>{value}</div>
      <div className="mt-1.5 text-[10px] sm:text-xs font-bold text-slate-400 leading-snug">{label}</div>
    </div>
  );
}

/**
 * Kutuların tepesindeki Başlık Kısmını (Örn: İkon ve Yazı) oluşturan ufak bileşen.
 */
function PanelHeader({ icon, title, s }: {
  icon: React.ReactNode; title: string; s: ThemeStyles;
}) {
  return (
    <div className={cn("flex items-center gap-3 border-b px-4 sm:px-5 py-3 sm:py-4", s.panelBorder)}>
      {icon}
      <h2 className={cn("text-base font-extrabold", s.title)}>{title}</h2>
    </div>
  );
}

/**
 * Orijinal ve Yapay Zeka Görsel Yüzdelerini (Progress Bar) Gösteren Bileşen.
 */
function ImageStat({ label, value, pct, color, s }: {
  label: string; value: string | number; pct: number; color: string; s: ThemeStyles;
}) {
  return (
    <div className={cn("rounded-xl border p-3", s.subPanel)}>
      <div className={cn("text-xs font-black", s.muted)}>{label}</div>
      <div className={cn("mt-2 flex items-end justify-between gap-3", s.title)}>
        <span className="text-2xl font-black">{value}</span>
        <span className={cn("text-xs font-extrabold", s.muted)}>{pct}%</span>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-black/10">
        <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/**
 * "Eksik Fiyat" veya "Stok Azalıyor" gibi uyarı satırlarını (Sağdaki ufak kutucuk ile) gösteren bileşen.
 */
function SmartRow({ label, value, tone, s }: {
  label: string; value: number; tone: "blue" | "amber" | "red"; s: ThemeStyles;
}) {
  const color = tone === "blue" ? "text-teal-300" : tone === "amber" ? "text-amber-400" : "text-red-400";
  const bg = tone === "blue" ? "bg-teal-400/10" : tone === "amber" ? "bg-amber-400/10" : "bg-red-400/10";
  return (
    <div className={cn("flex items-center justify-between gap-3 px-4 sm:px-5 py-3", s.panelBorder)}>
      <span className={cn("min-w-0 text-sm font-semibold", s.muted)}>{label}</span>
      <span className={cn("rounded-lg px-2.5 py-1 text-sm font-black", bg, color)}>{value}</span>
    </div>
  );
}

/**
 * En popüler Kategoriler ve Ürün Tiplerini Listeleyen (Bar tablosu) Bileşen.
 */
function TopListPanel({ title, items, emptyText, icon, s }: {
  title: string; items: NamedCount[]; emptyText: string; icon: React.ReactNode; s: ThemeStyles;
}) {
  // Liste içindeki en yüksek sayıyı bulur (Bunu %100 kabul edip bar uzunluğunu ona göre çizeriz)
  const max = Math.max(1, ...items.map((item) => item.count));
  return (
    <div className={cn("rounded-xl border", s.panel)}>
      <PanelHeader icon={icon} title={title} s={s} />
      {items.length === 0 ? (
        <div className={cn("px-4 py-6 text-sm font-semibold", s.muted)}>{emptyText}</div>
      ) : (
        <div className="grid gap-3 p-4">
          {items.map((item) => {
            const pct = Math.max(6, Math.round((item.count / max) * 100));
            return (
              <div key={item.label} className="grid gap-1.5">
                <div className="flex items-center justify-between gap-3">
                  <span className={cn("min-w-0 truncate text-sm font-extrabold", s.title)}>{item.label}</span>
                  <span className={cn("shrink-0 text-xs font-black", s.muted)}>{item.count}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-black/10">
                  <div className="h-full rounded-full bg-emerald-400/80" style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * İnceleme Gerektiren Kırmızı ve Sarı uyarı satırlarını basitleştirilmiş bir listeye çizen bileşen.
 */
function AttentionRow({ icon, text, s }: {
  icon: React.ReactNode; text: string; s: ThemeStyles;
}) {
  return (
    <div className={cn("flex items-center gap-3 px-4 sm:px-5 py-3", s.panelBorder)}>
      <span className="shrink-0">{icon}</span>
      <span className={cn("text-sm font-semibold", s.muted)}>{text}</span>
    </div>
  );
}
