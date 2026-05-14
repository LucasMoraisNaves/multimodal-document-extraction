import { buildDocumentQAGraphInstance } from './graph/factory.ts';
import Fastify, { type RouteHandlerMethod } from 'fastify';
import { HumanMessage } from '@langchain/core/messages';
import multipart from '@fastify/multipart';
import { ApiError, normalizeError } from './errors.ts';
import { prepareDocument } from './services/documentProcessor.ts';
import { formatModelResponse } from './responseFormatter.ts';

type UploadedFile = {
    filename: string;
    mimetype: string;
    toBuffer: () => Promise<Buffer>;
};

type MultipartPayload = {
    file?: UploadedFile;
    prompt?: string;
    documentType?: string;
};

export const createServer = () => {
    const app = Fastify({
        logger: false
    });

    app.register(multipart, {
        limits: {
            fileSize: 20 * 1024 * 1024, // 20MB
        },
    });

    const { graph } = buildDocumentQAGraphInstance();

    const extractHandler: RouteHandlerMethod = async function (request, reply) {
        try {
            const payload = await readMultipartPayload(request);
            const data = payload.file;

            if (!data) {
                throw new ApiError(400, 'FILE_REQUIRED', 'O campo file é obrigatório');
            }

            const prompt = payload.prompt?.trim();
            const documentType = payload.documentType;

            if (!prompt || prompt.trim().length < 3) {
                throw new ApiError(400, 'PROMPT_REQUIRED', 'O campo prompt é obrigatório e deve ter pelo menos 3 caracteres');
            }

            const preparedDocument = await prepareDocument(data);

            let response;
            try {
                response = await graph.invoke({
                    messages: [new HumanMessage(prompt)],
                    prompt,
                    documentType,
                    documentMimeType: preparedDocument.mimeType,
                    documentInputKind: preparedDocument.inputKind,
                    documentBase64: preparedDocument.documentBase64,
                    documentContent: preparedDocument.documentContent,
                });
            } catch (error) {
                throw new ApiError(502, 'GRAPH_EXECUTION_ERROR', 'Não foi possível executar o fluxo de análise do documento', {
                    reason: error instanceof Error ? error.message : 'Erro desconhecido',
                });
            }

            if (response.error) {
                throw new ApiError(502, 'MODEL_GENERATION_ERROR', 'Não foi possível gerar a resposta do modelo', {
                    reason: response.error,
                });
            }

            return formatModelResponse(
                response.messages.at(-1)?.text || 'Nenhuma resposta foi gerada',
                response.usage,
            );
        } catch (error) {
            const apiError = normalizeError(error);
            console.error(`Erro ao analisar documento: ${apiError.code} - ${apiError.message}`);
            return reply.status(apiError.statusCode).send(apiError.toJSON());
        }
    };

    app.post('/extract', extractHandler);

    return app;
};

async function readMultipartPayload(request: Parameters<RouteHandlerMethod>[0]): Promise<MultipartPayload> {
    const payload: MultipartPayload = {};

    for await (const part of request.parts()) {
        if (part.type === 'file' && part.fieldname === 'file') {
            let buffer: Buffer;
            try {
                buffer = await part.toBuffer();
            } catch (error) {
                throw new ApiError(400, 'FILE_READ_ERROR', 'Não foi possível ler o arquivo enviado', {
                    reason: error instanceof Error ? error.message : 'Erro desconhecido',
                });
            }

            payload.file = {
                filename: part.filename,
                mimetype: part.mimetype,
                toBuffer: async () => buffer,
            };
            continue;
        }

        if (part.type === 'field' && typeof part.value === 'string') {
            if (part.fieldname === 'prompt') {
                payload.prompt = part.value;
            }

            if (part.fieldname === 'document_type') {
                payload.documentType = part.value;
            }
        }
    }

    return payload;
}
