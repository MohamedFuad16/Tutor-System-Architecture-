import sys
import json
import base64
import os
import contextlib
import io
import pymupdf

MAX_VISION_PAGES = 20
VISION_ZOOM = 1.6

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Missing PDF file path"}))
        sys.exit(1)
        
    pdf_path = sys.argv[1]
    if not os.path.exists(pdf_path):
        print(json.dumps({"error": f"File not found: {pdf_path}"}))
        sys.exit(1)

    try:
        doc = pymupdf.open(pdf_path)
    except Exception as e:
        print(json.dumps({"error": f"Failed to open PDF: {str(e)}"}))
        sys.exit(1)

    total_pages = len(doc)
    if total_pages == 0:
        print(json.dumps({"error": "Empty PDF"}))
        sys.exit(1)

    # Classify the PDF
    # We'll count how many pages have significant text vs no text.
    # We can also check for image count.
    
    pages_with_text = 0
    pages_data = []

    for page_num in range(total_pages):
        page = doc.load_page(page_num)
        text = page.get_text()
        images = page.get_images(full=True)
        
        has_text = len(text.strip()) > 10 # Heuristic: >10 chars means it has text
        if has_text:
            pages_with_text += 1
            
        pages_data.append({
            "page_num": page_num,
            "has_text": has_text,
            "image_count": len(images)
        })

    text_ratio = pages_with_text / total_pages
    
    if text_ratio > 0.8:
        classification = "Native"
    elif text_ratio < 0.2:
        classification = "Scanned"
    else:
        classification = "Mixed"

    result = {
        "classification": classification,
        "extraction_mode": "pymupdf4llm" if classification == "Native" else (
            "hybrid-pymupdf4llm-vision" if classification == "Mixed" else "vision-ocr"
        ),
        "total_pages": total_pages,
        "pages_with_text": pages_with_text,
        "content": "",
        "pages": [],
        "images": [],
        "vision_page_limit": MAX_VISION_PAGES,
    }

    if classification == "Native" or classification == "Mixed":
        try:
            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                import pymupdf4llm
                # Single-pass, page-indexed extraction. page_chunks=True returns
                # one dict per page so we can hand the model the exact page the
                # learner is looking at, and it is no slower than the plain
                # whole-document call.
                page_chunks = pymupdf4llm.to_markdown(doc, page_chunks=True)
            pages = []
            content_parts = []
            for index, chunk in enumerate(page_chunks):
                page_text = (chunk.get("text") if isinstance(chunk, dict) else str(chunk)) or ""
                meta = chunk.get("metadata", {}) if isinstance(chunk, dict) else {}
                page_num = meta.get("page", index) if isinstance(meta, dict) else index
                pages.append({"page_num": int(page_num), "text": page_text})
                # Keep an explicit page marker in the joined markdown so the
                # whole-document excerpt retains page boundaries.
                content_parts.append(f"<!-- page {int(page_num) + 1} -->\n{page_text}")
            result["pages"] = pages
            result["content"] = "\n\n".join(content_parts)
        except Exception as e:
            doc.close()
            result["error"] = f"Failed to extract markdown: {str(e)}"
            print(json.dumps(result))
            sys.exit(1)

    if classification == "Scanned" or classification == "Mixed":
        # Extract images of the pages for Vision parsing
        # We will render each page to an image and return as base64
        extracted_images = []
        for page_num in range(min(total_pages, MAX_VISION_PAGES)):
            page = doc.load_page(page_num)
            pix = page.get_pixmap(matrix=pymupdf.Matrix(VISION_ZOOM, VISION_ZOOM))
            img_bytes = pix.tobytes("jpeg")
            img_b64 = base64.b64encode(img_bytes).decode("utf-8")
            extracted_images.append({
                "page_num": page_num,
                "mime_type": "image/jpeg",
                "data": img_b64
            })
        result["images"] = extracted_images

    doc.close()
    
    print(json.dumps(result))

if __name__ == "__main__":
    main()
