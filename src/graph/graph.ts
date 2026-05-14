import {
  StateGraph,
  START,
  END,
  MessagesZodMeta,
} from '@langchain/langgraph';
import { withLangGraph } from "@langchain/langgraph/zod";

import { z } from 'zod/v3';
import type { BaseMessage } from '@langchain/core/messages';

import { OpenRouterService } from '../services/openrouterService.ts';
import { createAnswerGenerationNode } from './nodes/answerGenerationNode.ts';
import type { UsageInfo } from '../services/openrouterService.ts';

const DocumentQAStateAnnotation = z.object({
  messages: withLangGraph(
    z.custom<BaseMessage[]>(),
    MessagesZodMeta),

  prompt: z.string(),
  documentMimeType: z.string(),
  documentInputKind: z.enum(['pdf', 'image', 'spreadsheet']),
  documentBase64: z.string().optional(),
  documentContent: z.string().optional(),
  documentType: z.string().optional(),

  usage: z.custom<UsageInfo>().optional(),
  error: z.string().optional(),
});

export type GraphState = z.infer<typeof DocumentQAStateAnnotation>;

export function buildDocumentQAGraph(
  llmClient: OpenRouterService) {
  const workflow = new StateGraph({
    stateSchema: DocumentQAStateAnnotation,
  })
    .addNode('answerGeneration', createAnswerGenerationNode(llmClient))
    .addEdge(START, 'answerGeneration')
    .addEdge('answerGeneration', END);

  return workflow.compile();
}
