import { extname } from 'path';
import { PDFParse } from 'pdf-parse';
import { createWorker } from 'tesseract.js';
import * as XLSX from 'xlsx';
import { ApiError } from '../errors.ts';

export type DocumentInputKind = 'pdf' | 'image' | 'spreadsheet';

export type PreparedDocument = {
  filename: string;
  mimeType: string;
  extension: string;
  inputKind: DocumentInputKind;
  documentBase64?: string;
  documentContent?: string;
};

type OcrContent = {
  filename: string;
  format: 'image_ocr';
  ocr_engine: 'tesseract.js';
  confidence: number | null;
  raw_text: string | null;
};

type PdfOcrPage = {
  page: number | null;
  confidence: number | null;
  raw_text: string | null;
  error?: string;
};

const imageMimeTypes = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
]);

const imageExtensions = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
]);

const spreadsheetMimeTypes = new Set([
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel.sheet.macroenabled.12',
]);

const spreadsheetExtensions = new Set([
  '.xls',
  '.xlsx',
  '.xlsm',
]);

const videoMimeTypes = new Set([
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'video/x-msvideo',
]);

const videoExtensions = new Set([
  '.mp4',
  '.webm',
  '.mov',
  '.avi',
]);

const maxPdfPagesForOcr = 3;

export async function prepareDocument(file: {
  filename: string;
  mimetype: string;
  toBuffer: () => Promise<Buffer>;
}): Promise<PreparedDocument> {
  const filename = file.filename;
  const mimeType = file.mimetype;
  const extension = extname(filename || '').toLowerCase();

  if (!filename || !extension) {
    throw new ApiError(400, 'INVALID_FILE_NAME', 'O arquivo precisa ter nome e extensão válidos');
  }

  const inputKind = detectInputKind(mimeType, extension);

  let buffer: Buffer;
  try {
    buffer = await file.toBuffer();
  } catch (error) {
    throw new ApiError(400, 'FILE_READ_ERROR', 'Não foi possível ler o arquivo enviado', {
      reason: error instanceof Error ? error.message : 'Erro desconhecido',
    });
  }

  if (inputKind === 'spreadsheet') {
    return {
      filename,
      mimeType,
      extension,
      inputKind,
      documentContent: extractSpreadsheetContent(buffer, filename),
    };
  }

  let documentBase64: string;
  try {
    documentBase64 = buffer.toString('base64');
  } catch (error) {
    throw new ApiError(400, 'BASE64_CONVERSION_ERROR', 'Não foi possível converter o arquivo para base64', {
      reason: error instanceof Error ? error.message : 'Erro desconhecido',
    });
  }

  if (inputKind === 'pdf') {
    return {
      filename,
      mimeType,
      extension,
      inputKind,
      documentBase64,
      documentContent: await extractPdfContent(buffer, filename),
    };
  }

  if (inputKind === 'image') {
    return {
      filename,
      mimeType,
      extension,
      inputKind,
      documentBase64,
      documentContent: await extractImageOcrContent(buffer, filename),
    };
  }

  return {
    filename,
    mimeType,
    extension,
    inputKind,
    documentBase64,
  };
}

async function extractPdfContent(buffer: Buffer, filename: string): Promise<string> {
  const parser = new PDFParse({ data: buffer });

  try {
    const [textResult, ocrPages] = await Promise.all([
      parser.getText(),
      extractPdfPagesOcr(parser),
    ]);

    const embeddedText = textResult.text.trim();

    return JSON.stringify({
      filename,
      format: 'pdf_text_and_ocr',
      text_engine: 'pdf-parse',
      ocr_engine: 'tesseract.js',
      embedded_text: embeddedText || null,
      pages_ocr: ocrPages,
    }, null, 2);
  } catch (error) {
    throw new ApiError(400, 'PDF_PROCESSING_ERROR', 'Não foi possível processar o PDF enviado', {
      reason: error instanceof Error ? error.message : 'Erro desconhecido',
    });
  } finally {
    await parser.destroy();
  }
}

async function extractPdfPagesOcr(parser: PDFParse): Promise<PdfOcrPage[]> {
  try {
    const screenshotResult = await parser.getScreenshot({
      first: maxPdfPagesForOcr,
      desiredWidth: 1800,
      imageDataUrl: false,
      imageBuffer: true,
    });

    const pages = [];
    for (const page of screenshotResult.pages) {
      const pageBuffer = Buffer.from(page.data);
      const ocrContent = parseOcrContent(await extractImageOcrContent(pageBuffer, `pagina-${page.pageNumber}.png`));

      pages.push({
        page: page.pageNumber,
        confidence: ocrContent.confidence,
        raw_text: ocrContent.raw_text,
      });
    }

    return pages;
  } catch (error) {
    return [{
      page: null,
      confidence: null,
      raw_text: null,
      error: error instanceof Error ? error.message : 'Erro desconhecido ao executar OCR do PDF',
    }];
  }
}

async function extractImageOcrContent(buffer: Buffer, filename: string): Promise<string> {
  let worker: Awaited<ReturnType<typeof createWorker>> | undefined;

  try {
    worker = await createWorker('por+eng');
    const result = await worker.recognize(buffer);
    const text = result.data.text.trim();
    const confidence = Number.isFinite(result.data.confidence) ? result.data.confidence : null;

    const content: OcrContent = {
      filename,
      format: 'image_ocr',
      ocr_engine: 'tesseract.js',
      confidence,
      raw_text: text || null,
    };

    return JSON.stringify(content, null, 2);
  } catch (error) {
    throw new ApiError(400, 'IMAGE_OCR_ERROR', 'Não foi possível executar OCR na imagem enviada', {
      reason: error instanceof Error ? error.message : 'Erro desconhecido',
    });
  } finally {
    await worker?.terminate();
  }
}

function parseOcrContent(value: string): OcrContent {
  const parsed = JSON.parse(value) as OcrContent;

  return {
    filename: parsed.filename,
    format: 'image_ocr',
    ocr_engine: 'tesseract.js',
    confidence: typeof parsed.confidence === 'number' ? parsed.confidence : null,
    raw_text: typeof parsed.raw_text === 'string' ? parsed.raw_text : null,
  };
}

function detectInputKind(mimeType: string, extension: string): DocumentInputKind {
  if (mimeType === 'application/pdf' && extension === '.pdf') {
    return 'pdf';
  }

  if (imageMimeTypes.has(mimeType) && imageExtensions.has(extension)) {
    return 'image';
  }

  if (spreadsheetMimeTypes.has(mimeType) && spreadsheetExtensions.has(extension)) {
    return 'spreadsheet';
  }

  if (videoMimeTypes.has(mimeType) || videoExtensions.has(extension)) {
    throw new ApiError(415, 'VIDEO_NOT_SUPPORTED', 'Arquivos de vídeo ainda não são suportados por esta implementação', {
      mimeType,
      extension,
    });
  }

  throw new ApiError(415, 'UNSUPPORTED_FILE_TYPE', 'Tipo de arquivo não suportado no momento', {
    mimeType,
    extension,
    supportedTypes: ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'xls', 'xlsx', 'xlsm'],
  });
}

function extractSpreadsheetContent(buffer: Buffer, filename: string): string {
  try {
    const workbook = XLSX.read(buffer, {
      type: 'buffer',
      cellDates: true,
    });

    const sheets = workbook.SheetNames.map((sheetName) => {
      const worksheet = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, {
        defval: null,
        raw: false,
      });

      return {
        name: sheetName,
        rows,
      };
    });

    return JSON.stringify({
      filename,
      format: 'spreadsheet',
      sheets,
    }, null, 2);
  } catch (error) {
    throw new ApiError(400, 'SPREADSHEET_PROCESSING_ERROR', 'Não foi possível processar a planilha enviada', {
      reason: error instanceof Error ? error.message : 'Erro desconhecido',
    });
  }
}
