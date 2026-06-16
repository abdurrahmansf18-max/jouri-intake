from enum import Enum
from typing import Optional
from pydantic import BaseModel, Field


class ProductStatus(str, Enum):
    pending = "pending"
    ai_enhanced = "ai_enhanced"
    published = "published"
    sold_archive = "sold_archive"


class SizeStock(BaseModel):
    size: str
    qty: int


class SoldSizeEntry(BaseModel):
    size: str
    soldAt: str
    note: str = ""


class ParsedProduct(BaseModel):
    titleRaw: str = ""
    categorySuggestion: str = ""
    productTypeSuggestion: str = ""
    priceAmount: str = ""
    currency: str = ""
    colorRaw: str = ""
    season: str = ""
    colorGermanSuggestion: str = ""
    sizesRaw: str = ""
    tags: list[str] = Field(default_factory=list)


class SavedImage(BaseModel):
    fileName: str
    originalName: str
    mimeType: str = "image/jpeg"
    size: int = 0
    relativePath: str = ""
    folder: str = "originals"  # "originals" veya "enhanced"


class SaleRecord(BaseModel):
    soldAt: str
    quantity: int = 1
    size: Optional[str] = None
    note: str = ""


class ImageFolder(BaseModel):
    path: str
    relativePath: str


class ImageFolders(BaseModel):
    originals: ImageFolder
    enhanced: ImageFolder


class ShopifySyncInfo(BaseModel):
    productId: Optional[str] = None
    handle: Optional[str] = None
    syncedAt: Optional[str] = None
    lastError: Optional[str] = None


class ProductRecord(BaseModel):
    id: str
    createdAt: str
    folderName: str
    folderPath: str
    imageFolders: ImageFolders
    description: str
    parsed: ParsedProduct
    images: list[SavedImage]
    status: ProductStatus = ProductStatus.pending
    notes: str = ""
    stockQuantity: int = 1
    soldQuantity: int = 0
    lastSoldAt: Optional[str] = None
    saleHistory: list[SaleRecord] = Field(default_factory=list)
    sizeStocks: list[SizeStock] = Field(default_factory=list)
    soldSizes: list[SoldSizeEntry] = Field(default_factory=list)
    relatedProducts: list[str] = Field(default_factory=list)
    shopify: ShopifySyncInfo = Field(default_factory=ShopifySyncInfo)


class StatusUpdateRequest(BaseModel):
    status: ProductStatus


class AiImageGenerateRequest(BaseModel):
    sourceFileName: str
    sourceFolder: str = "originals"
    gender: str = ""
    age: str = ""
    size: str = ""
    instructions: str = ""


class ParsedProductUpdate(BaseModel):
    titleRaw: Optional[str] = None
    categorySuggestion: Optional[str] = None
    productTypeSuggestion: Optional[str] = None
    priceAmount: Optional[str] = None
    currency: Optional[str] = None
    colorRaw: Optional[str] = None
    colorGermanSuggestion: Optional[str] = None
    season: Optional[str] = None
    sizesRaw: Optional[str] = None
    tags: Optional[list[str]] = None


class ProductUpdateRequest(BaseModel):
    notes: Optional[str] = None
    stockQuantity: Optional[int] = None
    description: Optional[str] = None
    sizeStocks: Optional[list[SizeStock]] = None
    parsed: Optional[ParsedProductUpdate] = None


class BulkUpdateRequest(BaseModel):
    productIds: list[str]
    season: Optional[str] = None


class BulkShopifyPushRequest(BaseModel):
    productIds: list[str]


class SellProductRequest(BaseModel):
    quantity: int = 1
    size: Optional[str] = None
    note: Optional[str] = None


class ResetSalesRequest(BaseModel):
    stockQuantity: Optional[int] = None


class RestoreProductRequest(BaseModel):
    stockQuantity: int = 1


class RestoreSizeRequest(BaseModel):
    size: str


class UpdateRelatedRequest(BaseModel):
    relatedIds: list[str]


class AuthRequest(BaseModel):
    code: str

class ParseRequest(BaseModel):
    text: str
    imageBase64: Optional[str] = None
    imageMimeType: Optional[str] = None


class BulkAISeasonRequest(BaseModel):
    productIds: list[str]
