/**
 * EventBlock.tsx - Render components for agent SDK events
 *
 * This file preserves the public component API while delegating implementation
 * details to smaller modules under `src/webview-src/components/eventBlocks/`.
 */

export {
  ActionEventBlock,
  AgentErrorBlock,
  CondensationBlock,
  ConversationErrorBlock,
  MessageEventBlock,
  ObservationEventBlock,
  StreamingMessageBlock,
  SystemPromptEventBlock,
  UserRejectBlock,
} from './eventBlocks';

