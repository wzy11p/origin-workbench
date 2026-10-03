"""Offline document adapter. Original files remain unchanged."""
import contextlib
import hashlib
import io
import json
import logging
import sys
import zipfile
from pathlib import Path

ALLOWED = {'.pdf', '.docx', '.pptx', '.xlsx', '.csv', '.md', '.txt', '.html', '.htm', '.png', '.jpg', '.jpeg'}
MAX_BYTES = 100 * 1024 * 1024

def _block(text, index, page=None, bbox=None, label='text'):
    return {'id': f'b{index}', 'text': text, 'page': page, 'bbox': bbox, 'label': label}

def _ocr(image, page=1):
    from ocrmac import ocrmac
    rows = ocrmac.OCR(image, recognition_level='accurate', language_preference=['zh-Hans', 'en-US']).recognize()
    return [_block(text, index, page, list(bounds), 'ocr') for index, (text, confidence, bounds) in enumerate(rows) if text.strip()]

def parse_document(path):
    source = Path(path)
    if not source.is_file(): raise ValueError('FILE_NOT_FOUND')
    extension = source.suffix.lower()
    if extension not in ALLOWED: raise ValueError('UNSUPPORTED_FORMAT')
    if source.stat().st_size > MAX_BYTES: raise ValueError('FILE_TOO_LARGE')
    try:
        if extension in {'.docx', '.pptx', '.xlsx'}:
            with zipfile.ZipFile(source) as archive:
                entries = archive.infolist()
                if len(entries) > 10_000 or sum(i.file_size for i in entries) > 300 * 1024 * 1024:
                    raise ValueError('ARCHIVE_TOO_LARGE')
        if extension == '.txt':
            content = source.read_text(encoding='utf-8-sig')
            blocks = [_block(line, i) for i, line in enumerate(content.splitlines()) if line.strip()]
            return {'content': content, 'blocks': blocks, 'parser': 'plain-text', 'status': 'success', 'errors': []}
        if extension in {'.png', '.jpg', '.jpeg'}:
            from PIL import Image
            with Image.open(source) as image:
                if image.width * image.height > 40_000_000: raise ValueError('IMAGE_TOO_LARGE')
                blocks = _ocr(image.convert('RGB'))
            return {'content': '\n\n'.join(b['text'] for b in blocks), 'blocks': blocks, 'parser': 'macOS Vision / ocrmac', 'status': 'success' if blocks else 'partial_success', 'errors': [] if blocks else ['NO_TEXT_DETECTED']}
        from docling.document_converter import DocumentConverter, NativePdfFormatOption, HTMLFormatOption
        from docling.datamodel.base_models import InputFormat
        from docling.datamodel.backend_options import HTMLBackendOptions, MarkdownBackendOptions
        from docling.document_converter import MarkdownFormatOption
        options = {
            InputFormat.PDF: NativePdfFormatOption(),
            InputFormat.HTML: HTMLFormatOption(backend_options=HTMLBackendOptions(enable_remote_fetch=False, enable_local_fetch=False)),
            InputFormat.MD: MarkdownFormatOption(backend_options=MarkdownBackendOptions(enable_remote_fetch=False, enable_local_fetch=False)),
        }
        converter = DocumentConverter(format_options=options)
        result = converter.convert(source, max_num_pages=500, max_file_size=MAX_BYTES, raises_on_error=True)
        doc = result.document
        blocks = []
        for item, _ in doc.iterate_items():
            text = getattr(item, 'text', '')
            if not text and hasattr(item, 'export_to_markdown'):
                text = item.export_to_markdown(doc=doc)
            if not text or getattr(item, 'label', '') in {'picture', 'document_index'} or str(getattr(item,'label','')) in {'DocItemLabel.PICTURE','DocItemLabel.DOCUMENT_INDEX'}: continue
            prov = item.prov[0] if getattr(item, 'prov', []) else None
            blocks.append(_block(text, len(blocks), prov.page_no if prov else None, prov.bbox.model_dump(mode='json') if prov else None, str(item.label)))
        content = doc.export_to_markdown()
        parser = 'Docling 2.129.0'
        errors = []
        if extension == '.pdf':
            import pypdfium2 as pdfium
            pages_with_text = {b['page'] for b in blocks if b.get('page')}
            used_ocr = False
            with pdfium.PdfDocument(source) as pdf:
                for page in range(len(pdf)):
                    if page + 1 in pages_with_text: continue
                    try:
                        pdf_page = pdf[page]
                        try:
                            width, height = pdf_page.get_size()
                            if width * height * 4 > 40_000_000: raise ValueError('IMAGE_TOO_LARGE')
                            bitmap = pdf_page.render(scale=2)
                            try: recognized = _ocr(bitmap.to_pil(), page + 1)
                            finally: bitmap.close()
                        finally: pdf_page.close()
                        used_ocr = True
                        if recognized: blocks.extend(recognized)
                        else: errors.append(f'PAGE_{page + 1}_NO_TEXT')
                    except Exception:
                        errors.append(f'PAGE_{page + 1}_OCR_FAILED')
            blocks.sort(key=lambda b: b.get('page') or 0)
            for index, block in enumerate(blocks): block['id'] = f'b{index}'
            content = '\n\n'.join(b['text'] for b in blocks)
            if used_ocr: parser += ' + macOS Vision'
        status = 'partial_success' if str(result.status.value) == 'partial_success' or not blocks or errors else 'success'
        return {'content': content, 'blocks': blocks, 'parser': parser, 'status': status,
                'document': doc.model_dump(mode='json'), 'errors': errors or (['INCOMPLETE_CONTENT'] if status == 'partial_success' else [])}
    except ValueError as error:
        if str(error) in {'ARCHIVE_TOO_LARGE', 'IMAGE_TOO_LARGE'}: raise
        raise ValueError('PARSE_FAILED') from error
    except Exception as error:
        raise ValueError('PARSE_FAILED') from error

if __name__ == '__main__':
    logging.disable(logging.CRITICAL)
    try:
        with contextlib.redirect_stdout(io.StringIO()): result = parse_document(sys.argv[1])
        print(json.dumps(result, ensure_ascii=False))
    except Exception as error:
        code = str(error) if str(error) in {'FILE_NOT_FOUND', 'FILE_TOO_LARGE', 'UNSUPPORTED_FORMAT', 'ARCHIVE_TOO_LARGE', 'IMAGE_TOO_LARGE'} else 'PARSE_FAILED'
        print(json.dumps({'error': code})); sys.exit(1)
