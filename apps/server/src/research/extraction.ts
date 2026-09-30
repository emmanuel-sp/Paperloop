import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import type { ExtractionStatus } from '@paperloop/contracts';
import type { PublicResource } from './public-fetch.js';

export interface ExtractedDocument {
  title?: string;
  content?: string;
  status: ExtractionStatus;
  error?: string;
}
const maximumCharacters = 5_000_000;
export async function extractResource(
  resource: PublicResource,
): Promise<ExtractedDocument> {
  try {
    if (
      resource.contentType.includes('pdf') ||
      Buffer.from(resource.body.subarray(0, 5)).toString() === '%PDF-'
    ) {
      const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
      const task = getDocument({
        data: Uint8Array.from(resource.body),
        useSystemFonts: true,
      });
      try {
        const pdf = await task.promise;
        const pages: string[] = [];
        let length = 0;
        const count = Math.min(pdf.numPages, 200);
        for (let number = 1; number <= count; number++) {
          const page = await pdf.getPage(number);
          const text = await page.getTextContent();
          const content = text.items
            .map((item) =>
              'str' in item ? `${item.str}${item.hasEOL ? '\n' : ' '}` : '',
            )
            .join('');
          pages.push(content);
          length += content.length;
          page.cleanup();
          if (length >= maximumCharacters) break;
        }
        const content = pages.join('\n\n').trim().slice(0, maximumCharacters);
        if (!content)
          return {
            status: 'unavailable',
            error: 'No extractable PDF text; OCR is not supported.',
          };
        const partial =
          pages.length < pdf.numPages ||
          length >= maximumCharacters ||
          pages.some((page) => !page.trim());
        return {
          status: partial ? 'partial' : 'complete',
          content,
          ...(partial
            ? {
                error:
                  'Some pages have no text or exceeded extraction limits (200 pages / 5 million characters).',
              }
            : {}),
        };
      } finally {
        await task.destroy();
      }
    }
    const raw = new TextDecoder().decode(resource.body);
    if (
      resource.contentType.includes('html') ||
      /^\s*<!doctype html|^\s*<html/i.test(raw)
    ) {
      // No scripts, subresource loading, or navigation in this DOM.
      const dom = new JSDOM(raw, { url: resource.url });
      try {
        const article = new Readability(dom.window.document).parse();
        const content = article?.textContent?.trim();
        if (!content)
          return {
            status: 'unavailable',
            error: 'No readable article text was found.',
          };
        return {
          title: article?.title || dom.window.document.title || resource.url,
          status: content.length > maximumCharacters ? 'partial' : 'complete',
          content: content.slice(0, maximumCharacters),
        };
      } finally {
        dom.window.close();
      }
    }
    if (resource.contentType.startsWith('text/plain')) {
      const content = raw.trim();
      return content
        ? {
            status: content.length > maximumCharacters ? 'partial' : 'complete',
            content: content.slice(0, maximumCharacters),
          }
        : { status: 'unavailable', error: 'The document contains no text.' };
    }
    return {
      status: 'unavailable',
      error: 'Only HTML articles, plain text, and text PDFs are supported.',
    };
  } catch (error) {
    return {
      status: 'failed',
      error: (error instanceof Error
        ? error.message
        : 'Extraction failed.'
      ).slice(0, 2000),
    };
  }
}
