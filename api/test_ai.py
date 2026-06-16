import asyncio
from database import SessionLocal
from db_models import Product
from parser import parse_description_ai

async def main():
    db = SessionLocal()
    p = db.query(Product).filter(Product.season == '').first()
    if p:
        print('Testing product:', p.title_raw)
        res = await parse_description_ai(p.title_raw + '\n' + p.description)
        print('Parsed season:', res.season)
        print('Full parsed:', res.model_dump())
    else:
        print('No products with empty season.')

asyncio.run(main())
