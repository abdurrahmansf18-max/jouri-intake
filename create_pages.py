import os
import sys
import json
import asyncio
import re

sys.path.insert(0, '/app')
from shopify import _config, _credentials, _graphql_request
import aiohttp

def parse_footer_info():
    with open('/host_data/footer_info', 'r', encoding='utf-8') as f:
        content = f.read()

    pages = {}
    
    # Split by standard headers
    sections = re.split(r'\n(?=İade ve Para İadesi Politikası:|Gizlilik Politikası:|Hizmet Şartları:|Kargo politikası:|İletişim Bilgileri:|Yasal bildirim:)', content)
    
    for section in sections:
        section = section.strip()
        if not section: continue
        
        if section.startswith('İade ve Para İadesi Politikası:'):
            pages['Rückgabe- und Erstattungsrichtlinie'] = section.replace('İade ve Para İadesi Politikası:', '').strip()
        elif section.startswith('Gizlilik Politikası:'):
            pages['Privacy Policy'] = section.replace('Gizlilik Politikası:', '').strip()
        elif section.startswith('Hizmet Şartları:'):
            pages['Terms of Service'] = section.replace('Hizmet Şartları:', '').strip()
        elif section.startswith('Kargo politikası:'):
            pages['Versandrichtlinie'] = section.replace('Kargo politikası:', '').strip()
        elif section.startswith('İletişim Bilgileri:'):
            pages['Contact'] = section.replace('İletişim Bilgileri:', '').strip()
        elif section.startswith('Yasal bildirim:'):
            pages['Impressum'] = section.replace('Yasal bildirim:', '').strip()
            
    return pages

async def main():
    pages_data = parse_footer_info()
    config = _config()
    async with aiohttp.ClientSession() as session:
        creds = await _credentials(session, config)
        
        query = '''
        mutation pageCreate($page: PageCreateInput!) {
            pageCreate(page: $page) {
                page { id handle title }
                userErrors { field message }
            }
        }
        '''
        
        results = {}
        for title, body in pages_data.items():
            # Convert body text to basic HTML paragraphs
            html_body = ''.join(f'<p>{line.strip()}</p>' for line in body.split('\n') if line.strip())
            
            variables = {
                "page": {
                    "title": title,
                    "body": html_body,
                    "isPublished": True
                }
            }
            res = await _graphql_request(session, creds, query, variables)
            if 'data' in res and 'pageCreate' in res['data'] and res['data']['pageCreate']['page']:
                handle = res['data']['pageCreate']['page']['handle']
                print(f"Created: {title} -> /pages/{handle}")
                results[title] = handle
            else:
                print(f"Failed to create {title}: {json.dumps(res)}")

if __name__ == "__main__":
    asyncio.run(main())
