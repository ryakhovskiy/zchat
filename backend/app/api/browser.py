from fastapi import APIRouter, HTTPException, Query
from playwright.async_api import async_playwright
import logging

router = APIRouter()
logger = logging.getLogger(__name__)

@router.get("/proxy")
async def proxy_browser(url: str = Query(..., description="The URL to visit")):
    if not url.startswith("http"):
        url = "https://" + url
    
    async with async_playwright() as p:
        try:
            browser = await p.chromium.launch(headless=True)
            context = await browser.new_context(
                viewport={'width': 1280, 'height': 800},
                user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            )
            page = await context.new_page()
            
            # Navigate to the page
            await page.goto(url, timeout=60000, wait_until="domcontentloaded")
            
            # Get content
            logger.info(f"Successfully loaded {url}, extracting content")
            content = await page.content()
            
            # Inject base tag to fix relative links
            # This is a naive implementation, but sufficient for simple proxy view
            base_tag = f'<base href="{url}">'
            # Try to insert after head tag
            if "<head" in content:
                # Find the end of head tag opening
                head_pos = content.find("<head")
                head_end_pos = content.find(">", head_pos) + 1
                content = content[:head_end_pos] + base_tag + content[head_end_pos:]
            elif "<html" in content:
                 html_pos = content.find("<html")
                 html_end_pos = content.find(">", html_pos) + 1
                 content = content[:html_end_pos] + "<head>" + base_tag + "</head>" + content[html_end_pos:]
            else:
                 content = f"<head>{base_tag}</head>{content}"

            await browser.close()
            return {"html": content, "url": url}
            
        except Exception as e:
            logger.error(f"Browser error: {str(e)}")
            raise HTTPException(status_code=500, detail=f"Failed to load page: {str(e)}")
