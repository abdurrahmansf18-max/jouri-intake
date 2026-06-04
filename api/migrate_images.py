import os
from pathlib import Path
from file_manager import _process_image, _STATUS_DIRS
from sqlalchemy.orm import Session
from database import SessionLocal
from models import Product

def migrate_existing_images():
    db: Session = SessionLocal()
    products = db.query(Product).all()
    count = 0
    total_freed = 0
    
    for p in products:
        folder_path = Path(p.folder_path)
        originals_path = folder_path / "originals"
        thumbnails_path = folder_path / "thumbnails"
        
        if not originals_path.exists():
            continue
            
        thumbnails_path.mkdir(parents=True, exist_ok=True)
        
        for file in originals_path.iterdir():
            if not file.is_file():
                continue
                
            ext = file.suffix.lower()
            if ext not in {".jpg", ".jpeg", ".png", ".webp", ".gif", ".heic", ".heif"}:
                continue
                
            orig_size = file.stat().st_size
            try:
                content = file.read_bytes()
                
                # Sıkıştırılmış orijinal
                compressed = _process_image(content, max_size=(1920, 1920), quality=85)
                # Küçük resim
                thumbnail = _process_image(content, max_size=(400, 400), quality=80)
                
                # Yeni dosyayı her ihtimale karşı .jpg olarak kaydediyoruz
                new_file_name = file.stem + ".jpg"
                (originals_path / new_file_name).write_bytes(compressed)
                (thumbnails_path / new_file_name).write_bytes(thumbnail)
                
                # Eğer uzantı değiştiyse eskisini sil
                if new_file_name != file.name:
                    file.unlink()
                
                new_size = len(compressed)
                freed = max(0, orig_size - new_size)
                total_freed += freed
                count += 1
                print(f"Processed: {p.id} / {new_file_name} (Saved: {freed / 1024 / 1024:.2f} MB)")
            except Exception as e:
                print(f"Failed to process {file.name} for {p.id}: {e}")
                
    db.close()
    print(f"\nMigration complete! Processed {count} images.")
    print(f"Total space saved: {total_freed / 1024 / 1024:.2f} MB")

if __name__ == "__main__":
    migrate_existing_images()
