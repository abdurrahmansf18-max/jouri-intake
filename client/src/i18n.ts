import type { Locale, ProductStatus, StatusFilter } from "./types";

export const COPY = {
  tr: {
    dir: "ltr" as const,
    appTitle: "Jouri",
    loginTitle: "Jouri Mağazası",
    subtitle: "Ürün Yönetim Paneli",
    // Nav
    navDashboard: "Panel",
    navAddProduct: "Ürün Ekle",
    navProducts: "Ürünler",
    navArchive: "Arşiv",
    // Dashboard
    dashTitle: "Genel Bakış",
    dashPending: "Beklemede",
    dashAiEnhanced: "AI Düzenlendi",
    dashPublished: "Yayınlandı",
    dashArchive: "Arşivde",
    dashTotalImages: "Toplam Görsel",
    dashTotalStock: "Toplam Stok",
    dashRecentActivity: "Son İşlemler",
    dashNoActivity: "Henüz işlem kaydı yok.",
    // Log actions
    logCreate: "Ürün oluşturuldu",
    logUpdate: "Ürün güncellendi",
    logDelete: "Ürün silindi",
    logSell: (n: number) => `${n} adet satıldı`,
    logRestore: "Tekrar satışa alındı",
    logStatusChange: "Durum değiştirildi",
    logAddImages: (n: number) => `${n} görsel eklendi`,
    logResetSales: "Satış sıfırlandı",
    logUnknown: "İşlem yapıldı",
    // Pages
    productsTitle: "Ürünler",
    archiveTitle: "Satıldı Arşivi",
    addProductTitle: "Yeni Ürün Ekle",
    // Product form
    statusOpen: "Kayıt açık",
    aiFolder: "AI klasörü",
    productMetric: "Ürün",
    imageMetric: "Görsel",
    selectedMetric: "Seçili",
    newRecordTitle: "Yeni Ürün Kaydı",
    newRecordSubtitle: "Görsel ve açıklama",
    productImages: "Ürün görselleri",
    chooseGallery: "Galeri veya dosya seç",
    description: "Ürün açıklaması",
    descriptionHelp: (n: number) => `${n} karakter · Ürün adı, renk, beden ve fiyat aynı açıklamada kalsın.`,
    createDetailsTitle: "Ürün bilgileri",
    saveProduct: "Ürünü kaydet",
    saving: "Kaydediliyor...",
    saved: "Kaydedildi",
    // Workflow info
    workflowTitle: "Kayıt akışı",
    originalsTitle: "Orijinaller",
    originalsText: "WhatsApp fotoğrafları",
    enhancedTitle: "AI düzenlenmiş",
    enhancedText: "Photoroom çıktıları",
    shopifyTitle: "Shopify",
    shopifyText: "Onaylı ürünler",
    // Product list
    recentProducts: "Son Ürünler",
    allProductsTitle: "Tüm Ürünler",
    noRecords: "Henüz ürün yok.",
    noFiltered: "Bu filtrede ürün yok.",
    originalFolder: "Orijinal",
    aiFolderLabel: "AI",
    imageCount: (n: number) => `${n} görsel`,
    filterAll: "Tümü",
    statusPending: "Beklemede",
    statusAiEnhanced: "AI Düzenlendi",
    statusPublished: "Yayınlandı",
    statusSoldArchive: "Satıldı",
    searchPlaceholder: "İsim, renk, beden, fiyat veya not ara...",
    openDetail: "Detay",
    // Product detail
    productDetail: "Ürün Detayı",
    editProduct: "Ürün bilgilerini düzenle",
    close: "Kapat",
    saveChanges: "Değişiklikleri kaydet",
    savedChanges: "Değişiklikler kaydedildi.",
    sellOne: "1 adet satıldı",
    markSold: "Satıldı olarak işle",
    saleInfoTitle: "Satış bilgisi",
    saleQuantity: "Satılacak adet",
    saleNote: "Satış notu (opsiyonel)",
    saleNotePlaceholder: "Fiziksel mağaza, online satış, müşteri notu...",
    resetSales: "Satış sayacını sıfırla",
    resetSalesConfirm: "Satış adedi ve satış geçmişi sıfırlansın mı?",
    salesResetDone: "Satış bilgileri sıfırlandı.",
    saleHistory: "Satış geçmişi",
    restoreProduct: "Tekrar satışa al",
    restoreStock: "Geri alınacak stok",
    stockQuantity: "Stok adedi",
    soldQuantity: "Satılan adet",
    lastSoldAt: "Son satış",
    notes: "Notlar",
    notesPlaceholder: "Abladan tekrar sorulacak, stokta 1 adet, defolu olabilir...",
    germanTitle: "Almanca ürün adı",
    rawTitle: "Orijinal ürün adı",
    price: "Fiyat",
    currency: "Para birimi",
    color: "Renk",
    size: "Beden",
    category: "Kategori",
    productType: "Ürün tipi",
    folders: "Klasörler",
    images: "Görseller",
    addImages: "Görsel ekle",
    addImagesHelp: "Bu ürüne yeni WhatsApp fotoğrafları ekle",
    uploadSelectedImages: "Seçili görselleri ekle",
    imagesAdded: "Görseller eklendi.",
    originalDescription: "Orijinal açıklama",
    activeStock: (n: number) => `${n} stok`,
    soldArchiveFolder: "Satıldı arşivi",
    // Delete
    deleteProduct: "Ürünü Sil",
    deleteConfirmTitle: "Ürünü kalıcı olarak sil",
    deleteConfirmText: "Bu ürün ve tüm görselleri kalıcı olarak silinecek. Bu işlem geri alınamaz.",
    deleteConfirm: "Evet, kalıcı sil",
    deleteCancel: "Vazgeç",
    deleted: "Ürün silindi.",
    // Auth
    loginAdminLabel: "Admin Giriş Paneli",
    loginDeveloper: "Geliştirici",
    loginDeveloperName: "Abdurrahman El Shawaf",
    accessIntro: "Devam etmek için authenticator uygulamasındaki 6 haneli kodu gir.",
    accessCode: "Doğrulama kodu",
    codePlaceholder: "6 haneli kod",
    login: "Giriş yap",
    loading: "Yükleniyor...",
    wrongCode: "Yanlış erişim kodu.",
    // Controls
    lightMode: "Açık mod",
    darkMode: "Koyu mod",
    logout: "Çıkış",
    // Validation errors (frontend)
    emptyDesc: "Açıklama boş olamaz.",
    emptyImg: "En az bir görsel seçmelisin.",
    errTitleRequired: "Ürün adı zorunludur.",
    errPriceRequired: "Fiyat zorunludur.",
    errColorRequired: "Renk zorunludur.",
    errSizeRequired: "Beden zorunludur.",
    errStockRequired: "Stok adedi zorunludur (min 1).",
    // API error codes → messages
    errors: {
      ERR_UNAUTHORIZED: "Yetkisiz erişim.",
      ERR_WRONG_CODE: "Yanlış erişim kodu.",
      ERR_PRODUCT_NOT_FOUND: "Ürün bulunamadı.",
      ERR_IMAGE_NOT_FOUND: "Görsel bulunamadı.",
      ERR_TITLE_REQUIRED: "Ürün adı zorunludur.",
      ERR_PRICE_REQUIRED: "Fiyat zorunludur.",
      ERR_COLOR_REQUIRED: "Renk zorunludur.",
      ERR_SIZE_REQUIRED: "Beden zorunludur.",
      ERR_STOCK_REQUIRED: "Stok adedi zorunludur.",
      ERR_IMAGE_REQUIRED: "En az bir görsel seçmelisin.",
      ERR_DESCRIPTION_REQUIRED: "Açıklama boş olamaz.",
      ERR_GENERAL: "Bir hata oluştu. Lütfen tekrar deneyin.",
    } as Record<string, string>,
    // Toast success messages
    toastCreated: "Ürün kaydedildi.",
    toastUpdated: "Değişiklikler kaydedildi.",
    toastDeleted: "Ürün silindi.",
    toastSold: "Satış işlendi.",
    toastRestored: "Ürün tekrar satışa alındı.",
    toastImagesAdded: "Görseller eklendi.",
    toastSalesReset: "Satış bilgileri sıfırlandı.",
    toastStatusUpdated: "Durum güncellendi.",
    // Backup page
    navBackup: "Yedekler",
    backupTitle: "Yedekleme Durumu",
    backupLastRun: "Son yedekleme",
    backupNever: "Henüz yedek yok",
    backupDb: "Veritabanı",
    backupImages: "Görseller",
    backupDrive: "Google Drive",
    backupOk: "Başarılı",
    backupFail: "Başarısız",
    backupAvailable: "Mevcut yedekler",
    backupEmpty: "Henüz yedek oluşturulmadı.",
    backupDeleteConfirm: "Bu yedeği silmek istediğinden emin misin?",
    backupDeleted: "Yedek silindi.",
    backupSchedule: "Her gece 02:00'de otomatik çalışır.",
    backupDriveStorage: "Google Drive'a yüklendi",
    backupLocalStorage: "VPS'te saklanıyor",
    backupRefresh: "Yenile",
    backupDelete: "Sil",
    backupHowTitle: "Yedekleme nasıl çalışır?",
    backupHow1: "Her gece 02:00'de otomatik çalışır",
    backupHow2: "Veritabanı: tüm ürünler, satışlar, loglar",
    backupHow3: "Görseller: artımlı kopyalama (sadece yeni dosyalar)",
    backupHow4: "Google Drive'a otomatik yüklenir",
    backupHow5: "30 günden eski yedekler otomatik silinir",
    // Sample
    sampleDesc: "فستان بناتي مع بوليرو\nبلون واحد تفاحي\nالقياسات :3/2\n40€",
  },
  ar: {
    dir: "rtl" as const,
    appTitle: "Jouri",
    loginTitle: "متجر جوري",
    subtitle: "لوحة إدارة المنتجات",
    // Nav
    navDashboard: "لوحة التحكم",
    navAddProduct: "إضافة منتج",
    navProducts: "المنتجات",
    navArchive: "الأرشيف",
    // Dashboard
    dashTitle: "نظرة عامة",
    dashPending: "في الانتظار",
    dashAiEnhanced: "معالج بالذكاء",
    dashPublished: "منشور",
    dashArchive: "في الأرشيف",
    dashTotalImages: "إجمالي الصور",
    dashTotalStock: "إجمالي المخزون",
    dashRecentActivity: "آخر العمليات",
    dashNoActivity: "لا توجد عمليات مسجلة بعد.",
    // Log actions
    logCreate: "تم إنشاء المنتج",
    logUpdate: "تم تحديث المنتج",
    logDelete: "تم حذف المنتج",
    logSell: (n: number) => `تم بيع ${n} قطعة`,
    logRestore: "تم إرجاعه للبيع",
    logStatusChange: "تم تغيير الحالة",
    logAddImages: (n: number) => `تمت إضافة ${n} صورة`,
    logResetSales: "تم تصفير المبيعات",
    logUnknown: "تمت العملية",
    // Pages
    productsTitle: "المنتجات",
    archiveTitle: "أرشيف المبيعات",
    addProductTitle: "إضافة منتج جديد",
    // Product form
    statusOpen: "التسجيل متاح",
    aiFolder: "مجلد الذكاء الاصطناعي",
    productMetric: "منتج",
    imageMetric: "صورة",
    selectedMetric: "محدد",
    newRecordTitle: "تسجيل منتج جديد",
    newRecordSubtitle: "الصور والوصف",
    productImages: "صور المنتج",
    chooseGallery: "اختاري من المعرض أو الملفات",
    description: "وصف المنتج",
    descriptionHelp: (n: number) => `${n} حرف · اتركي اسم المنتج واللون والمقاس والسعر في نفس الوصف.`,
    createDetailsTitle: "معلومات المنتج",
    saveProduct: "حفظ المنتج",
    saving: "جار الحفظ...",
    saved: "تم الحفظ",
    // Workflow info
    workflowTitle: "مسار الحفظ",
    originalsTitle: "الصور الأصلية",
    originalsText: "صور واتساب",
    enhancedTitle: "الصور المحسنة",
    enhancedText: "نتائج Photoroom",
    shopifyTitle: "Shopify",
    shopifyText: "المنتجات الموافق عليها",
    // Product list
    recentProducts: "آخر المنتجات",
    allProductsTitle: "جميع المنتجات",
    noRecords: "لا توجد منتجات بعد.",
    noFiltered: "لا توجد منتجات لهذا الفلتر.",
    originalFolder: "الأصلية",
    aiFolderLabel: "AI",
    imageCount: (n: number) => `${n} صورة`,
    filterAll: "الكل",
    statusPending: "في الانتظار",
    statusAiEnhanced: "معالج بالذكاء",
    statusPublished: "منشور",
    statusSoldArchive: "مباع",
    searchPlaceholder: "ابحثي بالاسم أو اللون أو المقاس أو السعر أو الملاحظات...",
    openDetail: "التفاصيل",
    // Product detail
    productDetail: "تفاصيل المنتج",
    editProduct: "تعديل معلومات المنتج",
    close: "إغلاق",
    saveChanges: "حفظ التغييرات",
    savedChanges: "تم حفظ التغييرات.",
    sellOne: "تم بيع قطعة واحدة",
    markSold: "تسجيل كمنتج مباع",
    saleInfoTitle: "معلومات البيع",
    saleQuantity: "الكمية المباعة",
    saleNote: "ملاحظة البيع (اختياري)",
    saleNotePlaceholder: "بيع في المحل، بيع أونلاين، ملاحظة الزبون...",
    resetSales: "تصفير عداد البيع",
    resetSalesConfirm: "هل تريدين تصفير الكمية المباعة وسجل البيع؟",
    salesResetDone: "تم تصفير معلومات البيع.",
    saleHistory: "سجل البيع",
    restoreProduct: "إرجاعه للبيع",
    restoreStock: "الكمية عند الإرجاع",
    stockQuantity: "كمية المخزون",
    soldQuantity: "الكمية المباعة",
    lastSoldAt: "آخر بيع",
    notes: "ملاحظات",
    notesPlaceholder: "يجب سؤالها مرة أخرى، قطعة واحدة في المخزون، قد يكون فيه عيب...",
    germanTitle: "اسم المنتج بالألمانية",
    rawTitle: "اسم المنتج الأصلي",
    price: "السعر",
    currency: "العملة",
    color: "اللون",
    size: "المقاس",
    category: "الفئة",
    productType: "نوع المنتج",
    folders: "المجلدات",
    images: "الصور",
    addImages: "إضافة صور",
    addImagesHelp: "أضيفي صور واتساب جديدة لهذا المنتج",
    uploadSelectedImages: "إضافة الصور المختارة",
    imagesAdded: "تمت إضافة الصور.",
    originalDescription: "الوصف الأصلي",
    activeStock: (n: number) => `${n} في المخزون`,
    soldArchiveFolder: "أرشيف المباع",
    // Delete
    deleteProduct: "حذف المنتج",
    deleteConfirmTitle: "حذف المنتج نهائياً",
    deleteConfirmText: "سيتم حذف هذا المنتج وجميع صوره نهائياً. لا يمكن التراجع عن هذا الإجراء.",
    deleteConfirm: "نعم، احذف نهائياً",
    deleteCancel: "إلغاء",
    deleted: "تم حذف المنتج.",
    // Auth
    loginAdminLabel: "لوحة تحكم المدير",
    loginDeveloper: "المطور",
    loginDeveloperName: "عبد الرحمن الشواف",
    accessIntro: "أدخلي الرمز المكون من 6 أرقام من تطبيق المصادقة للمتابعة.",
    accessCode: "رمز التحقق",
    codePlaceholder: "الرمز المكون من 6 أرقام",
    login: "دخول",
    loading: "جار التحميل...",
    wrongCode: "رمز الدخول خاطئ.",
    // Controls
    lightMode: "الوضع الفاتح",
    darkMode: "الوضع الداكن",
    logout: "خروج",
    // Validation errors (frontend)
    emptyDesc: "لا يمكن ترك الوصف فارغًا.",
    emptyImg: "يجب اختيار صورة واحدة على الأقل.",
    errTitleRequired: "اسم المنتج مطلوب.",
    errPriceRequired: "السعر مطلوب.",
    errColorRequired: "اللون مطلوب.",
    errSizeRequired: "المقاس مطلوب.",
    errStockRequired: "كمية المخزون مطلوبة (الحد الأدنى 1).",
    // API error codes → messages
    errors: {
      ERR_UNAUTHORIZED: "وصول غير مصرح.",
      ERR_WRONG_CODE: "رمز الدخول خاطئ.",
      ERR_PRODUCT_NOT_FOUND: "المنتج غير موجود.",
      ERR_IMAGE_NOT_FOUND: "الصورة غير موجودة.",
      ERR_TITLE_REQUIRED: "اسم المنتج مطلوب.",
      ERR_PRICE_REQUIRED: "السعر مطلوب.",
      ERR_COLOR_REQUIRED: "اللون مطلوب.",
      ERR_SIZE_REQUIRED: "المقاس مطلوب.",
      ERR_STOCK_REQUIRED: "كمية المخزون مطلوبة.",
      ERR_IMAGE_REQUIRED: "يجب اختيار صورة واحدة على الأقل.",
      ERR_DESCRIPTION_REQUIRED: "لا يمكن ترك الوصف فارغًا.",
      ERR_GENERAL: "حدث خطأ. يرجى المحاولة مرة أخرى.",
    } as Record<string, string>,
    // Toast success messages
    toastCreated: "تم حفظ المنتج.",
    toastUpdated: "تم حفظ التغييرات.",
    toastDeleted: "تم حذف المنتج.",
    toastSold: "تم تسجيل البيع.",
    toastRestored: "تم إرجاع المنتج للبيع.",
    toastImagesAdded: "تمت إضافة الصور.",
    toastSalesReset: "تم تصفير معلومات البيع.",
    toastStatusUpdated: "تم تحديث الحالة.",
    // Backup page
    navBackup: "النسخ الاحتياطية",
    backupTitle: "حالة النسخ الاحتياطي",
    backupLastRun: "آخر نسخ احتياطي",
    backupNever: "لا توجد نسخ بعد",
    backupDb: "قاعدة البيانات",
    backupImages: "الصور",
    backupDrive: "Google Drive",
    backupOk: "ناجح",
    backupFail: "فشل",
    backupAvailable: "النسخ المتاحة",
    backupEmpty: "لم يتم إنشاء نسخ احتياطية بعد.",
    backupDeleteConfirm: "هل أنت متأكدة من حذف هذه النسخة الاحتياطية؟",
    backupDeleted: "تم حذف النسخة الاحتياطية.",
    backupSchedule: "يعمل تلقائياً كل ليلة الساعة 02:00.",
    backupDriveStorage: "تم الرفع إلى Google Drive",
    backupLocalStorage: "محفوظ على الخادم",
    backupRefresh: "تحديث",
    backupDelete: "حذف",
    backupHowTitle: "كيف يعمل النسخ الاحتياطي؟",
    backupHow1: "يعمل تلقائياً كل ليلة الساعة 02:00",
    backupHow2: "قاعدة البيانات: كل المنتجات والمبيعات والسجلات",
    backupHow3: "الصور: نسخ تدريجي (الملفات الجديدة فقط)",
    backupHow4: "يُرفع إلى Google Drive تلقائياً",
    backupHow5: "يُحذف تلقائياً بعد 30 يوماً",
    // Sample
    sampleDesc: "فستان بناتي مع بوليرو\nبلون واحد تفاحي\nالقياسات :3/2\n40€",
  },
} as const;

export type CopyKey = keyof typeof COPY["tr"];

export function cn(...classes: (string | false | undefined | null)[]) {
  return classes.filter(Boolean).join(" ");
}

export function statusLabel(status: ProductStatus, locale: Locale): string {
  const t = COPY[locale];
  if (status === "pending") return t.statusPending;
  if (status === "ai_enhanced") return t.statusAiEnhanced;
  if (status === "published") return t.statusPublished;
  return t.statusSoldArchive;
}

export function filterLabel(filter: StatusFilter, locale: Locale): string {
  if (filter === "all") return COPY[locale].filterAll;
  return statusLabel(filter, locale);
}

export function apiError(err: unknown, locale: Locale): string {
  const t = COPY[locale];
  if (err instanceof Error) {
    const code = err.message;
    if (t.errors[code]) return t.errors[code];
  }
  return t.errors.ERR_GENERAL;
}

export function logActionLabel(action: string, locale: Locale, details?: Record<string, unknown> | null): string {
  const t = COPY[locale];
  switch (action) {
    case "create": return t.logCreate;
    case "update": return t.logUpdate;
    case "delete": return t.logDelete;
    case "sell": {
      const qty = typeof details?.quantity === "number" ? details.quantity : 1;
      return t.logSell(qty);
    }
    case "restore": return t.logRestore;
    case "status_change": return t.logStatusChange;
    case "add_images": {
      const count = typeof details?.count === "number" ? details.count : 1;
      return t.logAddImages(count);
    }
    case "reset_sales": return t.logResetSales;
    default: return t.logUnknown;
  }
}
