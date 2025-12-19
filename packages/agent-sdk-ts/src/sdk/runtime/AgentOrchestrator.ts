import { EventLog } from './EventLog';
import { ConversationState } from './ConversationState';
import type { ChatCompletionRequest, LLMClient, LLMResponse, LLMStreamChunk } from '../llm';
import type { Message, ToolCall } from '../types';

export interface AgentOrchestratorOptions {
  events?: EventLog;
  state?: ConversationState;
}

export class AgentOrchestrator {
  private readonly events: EventLog;
  private readonly state: ConversationState;

  constructor(private readonly llm: LLMClient, options: AgentOrchestratorOptions = {}) {
    this.events = options.events ?? new EventLog();
    this.state = options.state ?? new ConversationState({ eventLog: this.events });
    this.state.attachEventLog(this.events);
  }

  async runChat(request: ChatCompletionRequest): Promise<LLMResponse> {
    const message: Message = { role: 'assistant', content: [] };
    const toolCalls: Record<string, ToolCall> = {};
    let usage: LLMResponse['usage'];
    let streamText = '';

    for await (const chunk of this.llm.streamChat(request)) {
      streamText = this.applyStateUpdate(chunk, streamText);
      switch (chunk.type) {
        case 'text': {
          const existingText = message.content.find((item) => item.type === 'text');
          if (existingText) {
            existingText.text += chunk.text;
          } else {
            message.content.push({ type: 'text', text: chunk.text });
          }
          break;
        }
        case 'reasoning':
          message.reasoning_content = (message.reasoning_content ?? '') + chunk.reasoning;
          break;
        case 'tool_call_delta': {
          const current = toolCalls[chunk.id] ?? { id: chunk.id, type: 'function', function: { name: chunk.name ?? '', arguments: '' } };
          current.function = {
            name: chunk.name ?? current.function.name,
            arguments: `${current.function.arguments}${chunk.arguments ?? ''}`,
          };
          toolCalls[chunk.id] = current;
          break;
        }
        case 'usage':
          usage = {
            inputTokens: chunk.inputTokens ?? usage?.inputTokens,
            outputTokens: chunk.outputTokens ?? usage?.outputTokens,
            cacheReadTokens: chunk.cacheReadTokens ?? usage?.cacheReadTokens,
            cacheWriteTokens: chunk.cacheWriteTokens ?? usage?.cacheWriteTokens,
          };
          break;
        case 'finish':
          break;
        default:
          break;
      }
    }

    if (Object.keys(toolCalls).length) {
      message.tool_calls = Object.values(toolCalls);
    }

    this.state.persistSnapshot();

    return { message, usage };
  }

  private applyStateUpdate(chunk: LLMStreamChunk, streamText: string): string {
    switch (chunk.type) {
      case 'text': {
        const nextText = `${streamText}${chunk.text}`;
        this.state.setValue(
          'llm_stream',
          nextText,
          false,
        );
        return nextText;
      }
      case 'tool_call_delta':
        this.state.setValue('llm_tool_call', chunk.id, false);
        break;
      case 'usage':
        this.state.setValue('llm_usage', {
          input: chunk.inputTokens,
          output: chunk.outputTokens,
          cacheRead: chunk.cacheReadTokens,
          cacheWrite: chunk.cacheWriteTokens,
        }, false);
        break;
      default:
        break;
    }

    return streamText;
  }
}
